import type { Umi } from '@metaplex-foundation/umi'
import type { QuickMintRow, RollDb } from '../db'
import { buildNftMetadata } from '../lib/metadata'
import { withBackoff } from '../lib/retry'
import type { FundingProvider, StorageProvider } from '../providers/types'
import { ESTIMATED_METADATA_BYTES } from '../rolls/config'
import { sendAndConfirm } from '../solana/confirm'
import type { StagedMetadata } from './stage'

/**
 * The notification primitive, injected rather than imported: the consumer's job
 * is to finish paid work, not to know that alerting happens over Discord.
 * index.ts binds this to ops/discord's postDiscordAlert.
 */
export type AlertFn = (alert: {
  severity: 'low' | 'critical'
  title: string
  description?: string
  fields: { name: string; value: string }[]
  mention?: boolean
}) => Promise<void>

export interface FinalizeConsumerDeps {
  db: RollDb
  bucket: R2Bucket
  rpcUrl: string
  getUmi: () => Promise<Umi>
  getSeams: () => Promise<{ storage: StorageProvider; funding: FundingProvider }>
  alert: AlertFn
}

/**
 * `retry` carries a delay because the two reasons to retry have very different
 * clocks: an RPC blip clears in seconds, an empty Irys balance clears when a
 * human tops it up.
 */
export type FinalizeOutcome = { kind: 'done' } | { kind: 'retry'; delaySeconds: number; reason: string }

/** Long enough that a funding stall does not burn the retry budget in minutes. */
const FUNDING_RETRY_DELAY_SECONDS = 900

/**
 * Finish a quick mint: staged image -> Arweave -> real URI on-chain.
 *
 * Every row that reaches here represents money ALREADY COLLECTED and an asset
 * ALREADY MINTED on the placeholder. That inverts the usual failure posture —
 * giving up strands a paying user, so this retries rather than aborts, and only
 * genuinely impossible states are allowed to throw through to the dead-letter
 * queue (where they become an operator alert, never a silent loss).
 *
 * Checkpointed in D1 at each step, exactly like rolls/frames.ts, so a retry
 * resumes instead of re-spending:
 *
 *   (none)      -> upload image        -> image_uri
 *   image_uri   -> upload metadata     -> arweave_uri
 *   arweave_uri -> swap URI on-chain   -> FINALIZED
 */
export async function finalizeQuickMintJob(deps: FinalizeConsumerDeps, quickMintId: string): Promise<FinalizeOutcome> {
  const { db, bucket, rpcUrl, getUmi, getSeams, alert } = deps

  const row = await db.getQuickMint(quickMintId)
  if (!row) {
    console.warn(`[quick] finalize job for unknown row ${quickMintId} — nothing to do`)
    return { kind: 'done' }
  }
  if (row.status === 'FINALIZED') {
    return { kind: 'done' }
  }
  if (row.status === 'STAGED') {
    // No fee was ever verified for this row, so there is nothing owed. Enqueuing
    // only happens after the claim, so this means a stale or forged message.
    console.warn(`[quick] finalize job for un-claimed row ${quickMintId} — refusing to spend`)
    return { kind: 'done' }
  }

  // ---- Bytes still owed (a resumed job owes nothing for what already uploaded) ----
  let imageBytes: Uint8Array | null = null
  if (!row.image_uri) {
    const object = await bucket.get(row.staging_key ?? '')
    if (!object) {
      throw new Error(
        `Quick mint ${row.id} has no image_uri and its staged object (${row.staging_key}) is gone — ` +
          'the image cannot be recovered. Asset ' + (row.asset_address ?? '?') + ' is stuck on the placeholder.',
      )
    }
    imageBytes = new Uint8Array(await object.arrayBuffer())
  }

  const { storage, funding } = await getSeams()
  const bytesStillToUpload = (imageBytes?.byteLength ?? 0) + (row.arweave_uri ? 0 : ESTIMATED_METADATA_BYTES)

  if (bytesStillToUpload > 0) {
    const status = await funding.ensureFunded(bytesStillToUpload)
    if (!status.sufficient) {
      // NOT a dead-letter: the fee is collected and the asset is minted, so the
      // only correct behaviour is to keep waiting for the operator.
      await alert({
        severity: 'low',
        title: 'Quick mint waiting on Irys balance',
        description:
          'A paid quick mint cannot finalize until the Irys balance is topped up. It will retry automatically.',
        fields: [
          { name: 'Asset', value: row.asset_address ?? '—' },
          { name: 'Quick mint', value: row.id },
          { name: 'Balance', value: `${status.balanceAtomic} atomic` },
          { name: 'Required', value: `${status.requiredAtomic} atomic` },
        ],
      })
      return {
        kind: 'retry',
        delaySeconds: FUNDING_RETRY_DELAY_SECONDS,
        reason: `Irys balance insufficient (have ${status.balanceAtomic}, need ${status.requiredAtomic})`,
      }
    }
  }

  // ---- Step 1: image ----
  let imageUri = row.image_uri
  if (!imageUri) {
    imageUri = await storage.uploadImage(imageBytes!, row.mime)
    await db.saveQuickMintUpload(row.id, { imageUri })
  }

  // ---- Step 2: metadata (the image URI only exists now, so it is injected here) ----
  let arweaveUri = row.arweave_uri
  if (!arweaveUri) {
    const staged = JSON.parse(row.metadata_json) as StagedMetadata
    arweaveUri = await storage.uploadJSON(
      buildNftMetadata({
        name: staged.name,
        symbol: staged.symbol,
        description: staged.description,
        externalUrl: staged.external_url,
        imageUri,
        mime: row.mime,
        attributes: staged.attributes,
        creators: staged.creators,
      }),
    )
    await db.saveQuickMintUpload(row.id, { arweaveUri })
  }

  // ---- Step 3: swap the placeholder for the real URI ----
  await swapAssetUri(await getUmi(), rpcUrl, row, arweaveUri)

  await db.markQuickMintFinalized(row.id)
  if (row.staging_key) {
    await bucket.delete(row.staging_key).catch((err: unknown) => {
      // The row is already FINALIZED; a leftover object is a rounding error the
      // bucket lifecycle rule will reap. Never fail a finished mint over it.
      console.warn(`[quick] could not delete staged object ${row.staging_key}:`, err)
    })
  }
  return { kind: 'done' }
}

/**
 * Point the asset at its permanent metadata and hand update authority to the
 * owner, in one instruction.
 *
 * The read comes FIRST and is not an optimization. Handing over update
 * authority is one-way: after it succeeds the Worker can no longer sign an
 * update, so a retry that blindly re-issued the instruction would fail
 * permanently on a mint that had in fact completed. Checking the on-chain URI
 * first makes the step idempotent by construction.
 */
async function swapAssetUri(umi: Umi, rpcUrl: string, row: QuickMintRow, arweaveUri: string): Promise<void> {
  const { safeFetchAssetV1, update, updateAuthorityToBase } = await import('@metaplex-foundation/mpl-core')
  const { publicKey, some } = await import('@metaplex-foundation/umi')

  const assetAddress = row.asset_address
  if (!assetAddress) {
    throw new Error(`Quick mint ${row.id} is ${row.status} without an asset address — cannot finalize`)
  }

  const asset = await withBackoff('safeFetchAssetV1', () => safeFetchAssetV1(umi, publicKey(assetAddress)))
  if (!asset) {
    // Verified to exist at finalize time, so this is a lagging read.
    throw new Error(`Asset ${assetAddress} is not readable — retrying quick mint ${row.id}`)
  }
  if (asset.uri === arweaveUri) {
    return // A previous attempt landed the swap; only the D1 write was lost.
  }

  const authority = asset.updateAuthority
  if (authority.type !== 'Address' || authority.address?.toString() !== umi.identity.publicKey.toString()) {
    throw new Error(
      `Asset ${assetAddress} is no longer under the Worker's update authority, so its placeholder URI ` +
        `cannot be swapped. Quick mint ${row.id} needs manual attention.`,
    )
  }

  // HTTP send + polled confirm, never umi's own sendAndConfirm — its confirm
  // rides a websocket subscription that is not dependable in Workers (see
  // solana/confirm.ts). A confirm timeout is safe here: the next attempt's
  // fetch-first check sees the landed URI and completes.
  const blockhash = await withBackoff('getLatestBlockhash', () => umi.rpc.getLatestBlockhash())
  const tx = await update(umi, {
    asset,
    uri: arweaveUri,
    // The mint is finished; the NFT becomes fully the owner's. Drop this line
    // to keep the Worker able to fix metadata later.
    newUpdateAuthority: some(updateAuthorityToBase({ type: 'Address', address: asset.owner })),
  })
    .setBlockhash(blockhash)
    .buildAndSign(umi)

  await sendAndConfirm(umi, rpcUrl, tx)
}
