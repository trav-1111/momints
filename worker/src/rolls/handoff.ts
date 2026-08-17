import { publicKey } from '@metaplex-foundation/umi'
import type { Umi } from '@metaplex-foundation/umi'
import type { RollDb, RollRow } from '../db'
import { withBackoff } from '../lib/retry'
import { sendAndConfirm } from '../solana/confirm'

export interface RollHandoffDeps {
  db: RollDb
  rpcUrl: string
  getUmi: () => Promise<Umi>
}

/**
 * Revoke the Worker's UpdateDelegate on a completed roll's collection.
 *
 * The shooter has been the collection's update authority since creation
 * (rolls/create.ts) — the Worker only ever held a scoped delegate so it could
 * mint frames. Once the roll is COMPLETE there is nothing left to mint, so the
 * delegate is dropped and the shooter holds sole control, exactly as a quick
 * mint's owner does after finalize/consumer.ts:swapAssetUri.
 *
 * No-op (not an error) when the roll isn't COMPLETE yet, or the handoff is
 * already recorded — callers can invoke this freely from more than one place
 * without coordinating.
 *
 * THROWS on real failure (RPC error, revoke tx rejected). Every caller is
 * expected to treat that as non-fatal to whatever it was doing: a revoke that
 * doesn't land yet is a nuisance, not damage — the delegate is dropped from a
 * completed roll, so at worst the Worker retains a mint capability it no
 * longer has any use for, until the next retry (the scheduled sweep, or the
 * next completion attempt) succeeds.
 */
export async function revokeRollDelegate(deps: RollHandoffDeps, roll: RollRow): Promise<void> {
  if (roll.status !== 'COMPLETE' || roll.handoff_signature) return

  const { db, rpcUrl, getUmi } = deps
  const umi = await getUmi()
  const { safeFetchCollectionV1, revokeCollectionPluginAuthority } = await import('@metaplex-foundation/mpl-core')

  const collection = await withBackoff('fetchCollection', () =>
    safeFetchCollectionV1(umi, publicKey(roll.collection_address)),
  )
  if (!collection) {
    // A roll's collection should always exist — this means something is
    // seriously wrong upstream. Not this function's job to fix; surface it
    // as a failure so the caller's non-fatal handling logs it, and leave the
    // checkpoint null so it keeps getting retried rather than silently
    // marked done.
    throw new Error(`Roll ${roll.name}: collection ${roll.collection_address} not found`)
  }

  // Fetch-before-write, same discipline as quick/consumer.ts:swapAssetUri —
  // load-bearing here specifically because revoking is one-way. A blind retry
  // of an already-successful revoke would fail on an authority the Worker no
  // longer holds, and mistake "already done, D1 write was lost" for a fresh
  // failure.
  // PluginAuthority is `{ type, address? }` rather than a discriminated union
  // (address stays optional regardless of type), hence the explicit check.
  const delegate = collection.updateDelegate?.authority
  const stillDelegated =
    delegate?.type === 'Address' && delegate.address !== undefined && delegate.address.toString() === umi.identity.publicKey.toString()
  if (!stillDelegated) {
    await db.markRollHandoff(roll.collection_address, 'already-revoked')
    return
  }

  const blockhash = await withBackoff('getLatestBlockhash', () => umi.rpc.getLatestBlockhash())
  const tx = await revokeCollectionPluginAuthority(umi, {
    collection: publicKey(roll.collection_address),
    authority: umi.identity,
    plugin: { type: 'UpdateDelegate' },
  })
    .setBlockhash(blockhash)
    .buildAndSign(umi)

  const signature = await sendAndConfirm(umi, rpcUrl, tx)
  await db.markRollHandoff(roll.collection_address, signature)
}

/**
 * `revokeRollDelegate`, but never throws — for call sites where the handoff is
 * a courtesy riding along on something that already succeeded (a frame mint,
 * a completion request) and must not turn that success into a failure. Errors
 * are logged; the sweep in worker/src/index.ts is the retry path.
 */
export async function revokeRollDelegateSafely(deps: RollHandoffDeps, collectionAddress: string): Promise<void> {
  try {
    const roll = await deps.db.getRoll(collectionAddress)
    if (!roll) return
    await revokeRollDelegate(deps, roll)
  } catch (err) {
    console.error(
      `[handoff] revoke failed for ${collectionAddress}:`,
      err instanceof Error ? err.message : String(err),
    )
  }
}
