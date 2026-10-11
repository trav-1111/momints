import { useCallback } from 'react'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { buildMintMetadata } from '../services/ipfs'
import { formatCapturedAt, resolveLocation } from '../services/captureMetadata'
import { mintNFTBatch, type QuickMintTerms } from '../services/mint'
import { finalizeQuickMint, releaseQuickStage, stageQuickMint } from '../services/quickMintApi'
import { mintWorkerFrame, RollApiError } from '../services/rollApi'
import { isSkrQuoteUnavailable, quoteSkrFee } from '../services/skrApi'
import { formatSkr } from '../config/skr'
import {
  checkPriorAttempt,
  clearPendingFinalize,
  recordPendingFinalize,
  startPendingFinalizePolling,
} from '../store/quickFinalize'
import { getClusterRpc } from '../store/network'
import type { MintFilmUsed, RollContext } from '../store/mintQueue'
import type { CaptureMeta, PhotoArtifact } from '../store/photos'
import type { AspectRatio } from '../store/session'
import { tryPermanentQuickImage } from '../services/permanentAsset'
import { isPermanentImagePending, verifyPermanentImage } from '../services/imagePrivacy'
import { isRollVaultPhotoUri, withDecryptedRollFrame } from '../services/rollVault'

const SKR_UNAVAILABLE_NOTE = '$SKR unavailable — paying with SOL instead'

/** Frames per wallet approval. MWA signs a whole chunk in one prompt; kept
 * small so the shared blockhash never expires before send, and so parallel
 * sends + confirmation polls don't trip public-RPC rate limits. */
export const MINT_CHUNK_SIZE = 3

export interface BatchItemInput {
  photoId: string
  photoUri: string
  title: string
  artist: string
  capturedAt: number
  rollContext?: RollContext
  captureMeta?: CaptureMeta
  filmUsed?: MintFilmUsed
  aspect?: AspectRatio
  artifact?: PhotoArtifact
  /** Quick mint only. Defaults 'SOL'. A Worker quote failure falls back to SOL automatically. */
  paymentCurrency?: 'SOL' | 'SKR'
}

export type BatchItemUpdate =
  | { status: 'uploading' | 'signing'; note?: string }
  | {
      status: 'confirming'
      note?: string
      signature?: string
      mintAddress?: string
      imageUri?: string
      artifact?: MintArtifactReceipt
    }
  | { status: 'success'; signature: string; mintAddress: string; imageUri: string; artifact?: MintArtifactReceipt }
  | { status: 'failed'; error: string }

export type MintArtifactReceipt = Pick<PhotoArtifact, 'imageHash' | 'width' | 'height'>

export interface BatchSummary {
  succeeded: number
  failed: number
  /** True when a wallet-sign failure stopped the run — untouched items were
   * never reported and remain pending. */
  aborted: boolean
}

export const WALLET_SESSION_EXPIRED = 'Wallet session expired — reconnect your wallet and try again'

export function categorizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const msg = raw.toLowerCase()

  // Stale MWA auth token: wallet declines the session without showing UI.
  // Must be checked before the cancel branch ('wallet sign failed' matches both).
  if (msg.includes('authorization request failed') || msg.includes('auth_token not valid')) {
    return WALLET_SESSION_EXPIRED
  }

  if (
    msg.includes('wallet sign failed') ||
    msg.includes('cancel') ||
    msg.includes('declined') ||
    msg.includes('rejected') ||
    msg.includes('user dismissed') ||
    msg.includes('user closed')
  ) {
    return 'Transaction cancelled'
  }

  if (msg.includes('insufficient') || msg.includes('balance') || msg.includes('lamport')) {
    return 'Insufficient SOL balance'
  }

  if (msg.includes('timed out') || msg.includes('timeout')) {
    return 'Transaction timed out — network may be congested'
  }

  if (
    msg.includes('rpc send failed') ||
    msg.includes('network') ||
    msg.includes('connection') ||
    msg.includes('fetch') ||
    msg.includes('503') ||
    msg.includes('429')
  ) {
    return 'Network error — please retry'
  }

  return raw
}

/**
 * Roll frames mint through the Worker: it signs with its own key and sets the
 * shooter as owner, so they cost no wallet approval.
 */
function isWorkerFrame(item: BatchItemInput): boolean {
  return Boolean(item.rollContext?.collectionAddress) && Number.isInteger(item.rollContext?.frameNumber)
}

/**
 * Stage a quick shot and mint it against the placeholder, paying the fee in
 * the same transaction. Returns what finalize needs.
 *
 * The pending-finalize entry is written from `onSigned` — before the send —
 * so the fee can never be paid without a persisted record of who owes the
 * upload. See store/quickFinalize.ts.
 *
 * If `paymentCurrency` is 'SKR', quotes the Worker HERE — at mint-start,
 * right after staging returns a stagingKey — never earlier. A quote failure
 * (Jupiter unreachable, etc.) falls back to the SOL terms staging already
 * returned; it never blocks the mint or forces a re-pick of currency.
 */
async function stageAndRecord(params: {
  wallet: string
  photoUri: string
  metadata: ReturnType<typeof buildMintMetadata>
  paymentCurrency?: 'SOL' | 'SKR'
  artifact: PhotoArtifact
}): Promise<{
  stagingKey: string
  placeholderUri: string
  terms: QuickMintTerms
  artifact: MintArtifactReceipt
  note?: string
}> {
  const staged = await stageQuickMint({
    wallet: params.wallet,
    photoUri: params.photoUri,
    metadata: params.metadata,
  })
  const terms: QuickMintTerms = {
    treasury: staged.treasury,
    feeLamports: staged.feeLamports,
    updateAuthority: staged.updateAuthority,
  }
  if (
    staged.mime !== params.artifact.mime ||
    staged.byteLength !== params.artifact.byteLength ||
    staged.width !== params.artifact.width ||
    staged.height !== params.artifact.height ||
    staged.imageHash !== params.artifact.imageHash
  ) {
    throw new Error('The Worker-derived quick image receipt does not match the developed capture.')
  }

  let note: string | undefined
  if (params.paymentCurrency === 'SKR') {
    try {
      const quote = await quoteSkrFee({ context: 'quick', stagingKey: staged.stagingKey })
      if (isSkrQuoteUnavailable(quote)) {
        note = SKR_UNAVAILABLE_NOTE
      } else {
        terms.skr = { atomicAmount: quote.skrAmount, treasurySkrAta: quote.treasurySkrAta }
        note = `Paying ${formatSkr(quote.skrAmount)}`
      }
    } catch {
      note = SKR_UNAVAILABLE_NOTE
    }
  }

  return {
    stagingKey: staged.stagingKey,
    placeholderUri: staged.placeholderUri,
    terms,
    artifact: { imageHash: staged.imageHash, width: staged.width, height: staged.height },
    note,
  }
}

/**
 * Tell the Worker the fee landed, so it can buy the bytes and swap the
 * placeholder. A failure here is NOT a failed mint — the asset exists and is
 * paid for — so it never fails the item; the persisted queue retries.
 */
async function finalizeAndCheck(entry: {
  stagingKey: string
  signature: string
  assetAddress: string
}): Promise<string | null> {
  try {
    const finalized = await finalizeQuickMint(entry)
    let imageUri = await tryPermanentQuickImage(entry.assetAddress, finalized.imageUri)
    if (imageUri) return imageUri

    // If the Worker enqueued the Arweave upload to a queue, poll briefly (up to 4.5s)
    // so the item can resolve to 'success' in the foreground without delay.
    for (let attempt = 0; attempt < 3; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      imageUri = await tryPermanentQuickImage(entry.assetAddress)
      if (imageUri) return imageUri
    }
    return null
  } catch (err) {
    console.warn(`[mint] finalize deferred for ${entry.assetAddress}:`, err instanceof Error ? err.message : err)
    throw err
  }
}

/** Capture extras only — the Worker writes skr_identity, artist, roll and frame itself. */
function workerFrameAttributes(item: BatchItemInput): { trait_type: string; value: string }[] {
  return [
    { trait_type: 'Device', value: 'Solana Seeker' },
    { trait_type: 'Captured', value: formatCapturedAt(item.capturedAt) },
    { trait_type: 'Minted With', value: 'Momints' },
    { trait_type: 'Location', value: resolveLocation(item.captureMeta) },
  ]
}

function describeWorkerError(err: unknown): string {
  if (err instanceof RollApiError) {
    // Every frame is checkpointed server-side, so a resumable failure loses no
    // upload and can never double-mint on retry — say so.
    return err.resumable ? `${err.message} — retry to resume` : err.message
  }
  return categorizeError(err)
}

export function useMint() {
  const { account, client, signTransaction, disconnect } = useMobileWallet()

  /**
   * Mint many photos. Per-item progress streams through onItem.
   *
   * Roll frames go to the Worker first — one request per frame, no wallet
   * approval, failures strictly per-frame and resumable.
   *
   * Quick shots mint on-device in chunks of MINT_CHUNK_SIZE, one wallet
   * approval per chunk. There, upload failures are per-item and don't stop the
   * run, but a wallet-sign failure (decline / dead session) fails the whole
   * chunk and aborts the remaining chunks — those items are never reported and
   * stay pending for a retry.
   */
  const mintBatch = useCallback(
    async (
      items: BatchItemInput[],
      onItem: (photoId: string, update: BatchItemUpdate) => void,
    ): Promise<BatchSummary> => {
      const summary: BatchSummary = { succeeded: 0, failed: 0, aborted: false }

      if (!account) {
        items.forEach((item) => onItem(item.photoId, { status: 'failed', error: 'Wallet not connected' }))
        summary.failed = items.length
        return summary
      }
      const walletAddress = account.address.toString()

      const missingReceiptItems = items.filter((item) => !item.artifact)
      for (const item of missingReceiptItems) {
        summary.failed++
        onItem(item.photoId, {
          status: 'failed',
          error: 'This capture has no verified development receipt and cannot enter the mint queue.',
        })
      }
      const verifiedItems = items.filter((item): item is BatchItemInput & { artifact: PhotoArtifact } =>
        Boolean(item.artifact),
      )
      const workerItems = verifiedItems.filter(isWorkerFrame)
      // A roll frame that reaches here without a usable collection address is
      // a bug (rollContext set, but isWorkerFrame() rejected it) — report it
      // failed rather than quietly minting it as an unrelated, unpaid asset.
      const malformedRollItems = verifiedItems.filter((item) => !isWorkerFrame(item) && item.rollContext)
      const clientItems = verifiedItems.filter((item) => !isWorkerFrame(item) && !item.rollContext)

      for (const item of malformedRollItems) {
        summary.failed++
        onItem(item.photoId, {
          status: 'failed',
          error: 'Roll frame is missing its collection address or frame number — not minted, not charged.',
        })
      }

      // One frame per request, sequentially: each does an Arweave upload plus
      // an on-chain mint server-side. Failures are per-frame and never abort
      // the run — the Worker checkpoints every step, so a retry resumes rather
      // than re-uploading or re-minting.
      for (const item of workerItems) {
        const { collectionAddress, frameNumber } = item.rollContext!
        onItem(item.photoId, { status: 'uploading' })
        try {
          const mintFrame = (photoUri: string) =>
            mintWorkerFrame({
              collectionAddress: collectionAddress!,
              frameIndex: frameNumber,
              photoUri,
              description: `Shot on Seeker by ${item.artist}`,
              attributes: workerFrameAttributes(item),
            })
          const res = isRollVaultPhotoUri(item.photoUri)
            ? await withDecryptedRollFrame(item.photoUri, async (photoUri, _artifact, reference) => {
                if (
                  reference.rollId !== item.rollContext!.rollId ||
                  reference.photoId !== item.photoId ||
                  reference.frameNumber !== frameNumber
                ) {
                  throw new Error('The encrypted frame does not match this roll queue entry.')
                }
                return mintFrame(photoUri)
              })
            : await mintFrame(item.photoUri)
          if (
            res.mime !== item.artifact.mime ||
            res.byteLength !== item.artifact.byteLength ||
            res.width !== item.artifact.width ||
            res.height !== item.artifact.height ||
            res.imageHash !== item.artifact.imageHash
          ) {
            throw new Error('The Worker-derived roll image receipt does not match the encrypted developed frame.')
          }
          let imageUri: string
          try {
            imageUri = await verifyPermanentImage(res.imageUri)
          } catch (error) {
            if (!isPermanentImagePending(error)) throw error

            // The Worker has returned the minted asset and permanent URI. Gateway
            // propagation (arweave.net returning 404) takes 8–12 min, but the
            // on-chain Metaplex asset is already created. Rather than halting the
            // queue in status: 'confirming', record the permanent imageUri: res.imageUri
            // as successful so the user is not held hostage on this screen.
            imageUri = res.imageUri
          }
          summary.succeeded++
          onItem(item.photoId, {
            status: 'success',
            // A resumed frame can come back without its original signature;
            // the asset address is what identifies the mint either way.
            signature: res.signature ?? '',
            mintAddress: res.assetAddress,
            imageUri,
            artifact: { imageHash: res.imageHash, width: res.width, height: res.height },
          })
        } catch (err) {
          summary.failed++
          onItem(item.photoId, { status: 'failed', error: describeWorkerError(err) })
        }
      }

      // Recovery pass: BEFORE staging anything new, check whether each quick
      // item already has a signed-but-unresolved attempt from earlier — a
      // previous mintBatch call whose confirmation timed out, or a user
      // tapping RETRY on exactly that. A "failed" item in the UI is not proof
      // nothing happened (see checkPriorAttempt's doc): the transaction may
      // already be paid for and minted. Only items cleared here ever reach
      // staging, so a retry can never mint a second paid asset for a photo
      // whose first attempt may still land.
      const freshMintItems: BatchItemInput[] = []
      for (const item of clientItems) {
        const check = await checkPriorAttempt(item.photoId)
        if (check.action === 'resolved') {
          try {
            summary.succeeded++
            onItem(item.photoId, {
              status: 'success',
              signature: check.signature,
              mintAddress: check.assetAddress,
              imageUri: check.imageUri,
              artifact: check.artifact,
            })
            await clearPendingFinalize(check.stagingKey)
          } catch (err) {
            summary.failed++
            onItem(item.photoId, { status: 'failed', error: categorizeError(err) })
          }
        } else if (check.action === 'wait') {
          // A prior attempt may still land. Do not mint again yet — the
          // background drain, or the next retry (which re-checks), resolves it.
          onItem(item.photoId, {
            status: 'confirming',
            signature: check.signature,
            mintAddress: check.assetAddress,
            note: 'Signed attempt awaiting verification · checking the same receipt before any new payment',
          })
          void startPendingFinalizePolling().catch(() => {})
        } else {
          // 'none' (no prior attempt) or 'clear' (a prior attempt is
          // confirmed dead) — a fresh mint is safe.
          freshMintItems.push(item)
        }
      }

      for (let start = 0; start < freshMintItems.length; start += MINT_CHUNK_SIZE) {
        const chunk = freshMintItems.slice(start, start + MINT_CHUNK_SIZE)

        chunk.forEach((item) => onItem(item.photoId, { status: 'uploading' }))
        const uploads = await Promise.all(
          chunk.map(async (item) => {
            try {
              // Stage to the Worker and mint against the placeholder; the fee
              // rides in the same wallet-signed transaction.
              const quick = await stageAndRecord({
                wallet: walletAddress,
                photoUri: item.photoUri,
                metadata: buildMintMetadata(item),
                paymentCurrency: item.paymentCurrency,
                artifact: item.artifact!,
              })
              return { item, metadataUri: quick.placeholderUri, quick }
            } catch (err) {
              onItem(item.photoId, { status: 'failed', error: categorizeError(err) })
              summary.failed++
              return null
            }
          }),
        )
        const ready = uploads.filter((u): u is NonNullable<typeof u> => u !== null)
        if (ready.length === 0) continue

        const quickByPhotoId = new Map(ready.map((r) => [r.item.photoId, r.quick] as const))
        const itemByPhotoId = new Map(ready.map((r) => [r.item.photoId, r.item] as const))
        // Which quick items got as far as a signature. Anything NOT in here on
        // failure was never paid for, so its stage can safely be given back.
        const signedPhotoIds = new Set<string>()
        // The signature/mintAddress captured AT SIGNING TIME, independent of
        // whether mintNFTBatch's own confirmation polling later succeeds. See
        // the finalize loop below for why this — not `result` — is what drives it.
        const signedInfo = new Map<string, { signature: string; mintAddress: string }>()

        // note carries the quoted $SKR amount ("Paying 12.50 $SKR") or a
        // fallback notice ($SKR unavailable this attempt) — see
        // stageAndRecord's doc comment. Shown right before the wallet prompt,
        // matching the requirement that the exact amount is visible before
        // signing.
        ready.forEach(({ item, quick }) => onItem(item.photoId, { status: 'signing', note: quick.note }))
        try {
          // Return value intentionally unused: per-item UI reporting happens
          // inline via the onItemResult callback below, and the finalize loop
          // after this call is driven by signedInfo, not by these results.
          await mintNFTBatch(
            ready.map(({ item, metadataUri, quick }) => ({
              id: item.photoId,
              metadataUri,
              name: item.title,
              symbol: 'MOMINT',
              quick: quick.terms,
            })),
            {
              walletAddress,
              rpc: getClusterRpc(),
              // Persist before anything is sent: past this point the fee is
              // committed, so the record has to outlive a crash. Awaited by
              // mintNFTBatch before it sends anything — see its onItemSigned
              // doc — so the write has actually happened, not just started,
              // before the transaction that spends the fee goes out.
              onItemSigned: async (photoId, { signature, mintAddress, lastValidBlockHeight }) => {
                const quick = quickByPhotoId.get(photoId)
                const sourceItem = itemByPhotoId.get(photoId)
                if (quick && sourceItem) {
                  signedPhotoIds.add(photoId)
                  signedInfo.set(photoId, { signature, mintAddress })
                  await recordPendingFinalize({
                    stagingKey: quick.stagingKey,
                    signature,
                    lastValidBlockHeight,
                    assetAddress: mintAddress,
                    photoId,
                    history: {
                      title: sourceItem.title,
                      artist: sourceItem.artist,
                      capturedAt: sourceItem.capturedAt,
                      filmUsed: sourceItem.filmUsed,
                      aspect: sourceItem.aspect,
                      artifact: quick.artifact,
                    },
                  })
                }
              },
              onPhase: (phase) => {
                if (phase === 'confirming') {
                  ready.forEach(({ item }) => onItem(item.photoId, { status: 'confirming' }))
                }
              },
            },
            {
              client,
              signTransactions: (txs) => signTransaction(txs),
            },
            (result) => {
              if (result.success && result.signature) {
                onItem(result.id, { status: 'confirming' })
              } else if (!signedInfo.has(result.id)) {
                summary.failed++
                onItem(result.id, {
                  status: 'failed',
                  error: categorizeError(new Error(result.error ?? 'Minting failed')),
                })
              }
            },
          )

          // Finalize after the chunk. A mint is not reported as successful
          // until its permanent Arweave image is returned and retrievable.
          //
          // Driven by signedInfo (captured at signing time), NOT by
          // result.success/result.signature — a confirmation TIMEOUT in
          // sendAndConfirm throws before ever setting those fields on `result`,
          // even when the transaction actually landed. That used to skip this
          // call entirely for a landed-but-client-unconfirmed mint, silently
          // stranding it on nothing but the persisted queue's own retry (next
          // app launch/foreground) to ever notice. finalizeQuickMint reads the
          // chain itself and is authoritative either way: it succeeds if the
          // transaction landed, or returns a retryable 503 if it is not visible
          // yet — never a hard failure just because OUR polling gave up early.
          for (const [photoId, quick] of quickByPhotoId) {
            const info = signedInfo.get(photoId)
            if (info) {
              try {
                const imageUri = await finalizeAndCheck({
                  stagingKey: quick.stagingKey,
                  signature: info.signature,
                  assetAddress: info.mintAddress,
                })
                if (imageUri) {
                  summary.succeeded++
                  onItem(photoId, {
                    status: 'success',
                    signature: info.signature,
                    mintAddress: info.mintAddress,
                    imageUri,
                    artifact: quick.artifact,
                  })
                  await clearPendingFinalize(quick.stagingKey)
                } else {
                  onItem(photoId, {
                    status: 'confirming',
                    signature: info.signature,
                    mintAddress: info.mintAddress,
                    artifact: quick.artifact,
                    note: 'Paid · finalizing',
                  })
                  void startPendingFinalizePolling().catch(() => {})
                }
              } catch {
                // A signed mint may already have landed. Keep it in recovery
                // instead of offering a second paid transaction.
                onItem(photoId, {
                  status: 'confirming',
                  signature: info.signature,
                  mintAddress: info.mintAddress,
                  artifact: quick.artifact,
                  note: 'Mint submitted · confirming payment and permanent storage',
                })
                void startPendingFinalizePolling().catch(() => {})
              }
            }
          }
        } catch (err) {
          // Wallet sign failed — nothing in this chunk was sent. Give back every
          // stage that never reached a signature; keyed off signedPhotoIds
          // rather than assuming the throw was pre-signature, so a paid mint can
          // never be released by a future change to where this throws from.
          for (const [photoId, quick] of quickByPhotoId) {
            if (!signedPhotoIds.has(photoId)) {
              void releaseQuickStage(quick.stagingKey)
            }
          }
          const errorMessage = categorizeError(err)
          ready.forEach(({ item }) => onItem(item.photoId, { status: 'failed', error: errorMessage }))
          summary.failed += ready.length
          summary.aborted = true
          if (errorMessage === WALLET_SESSION_EXPIRED) {
            disconnect().catch(() => {})
          }
          break
        }
      }

      return summary
    },
    [account, client, signTransaction, disconnect],
  )

  return { mintBatch }
}
