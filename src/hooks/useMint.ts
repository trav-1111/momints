import { useCallback } from 'react'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { buildMintMetadata } from '../services/ipfs'
import { formatCapturedAt, resolveLocation } from '../services/captureMetadata'
import { mintNFTBatch, type QuickMintTerms } from '../services/mint'
import { finalizeQuickMint, releaseQuickStage, stageQuickMint } from '../services/quickMintApi'
import { mintWorkerFrame, RollApiError } from '../services/rollApi'
import { clearPendingFinalize, recordPendingFinalize } from '../store/quickFinalize'
import { getClusterRpc } from '../store/network'
import type { RollContext } from '../store/mintQueue'
import type { CaptureMeta } from '../store/photos'

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
}

export type BatchItemUpdate =
  | { status: 'uploading' | 'signing' | 'confirming' }
  | { status: 'success'; signature: string; mintAddress?: string }
  | { status: 'failed'; error: string }

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
 */
async function stageAndRecord(params: {
  wallet: string
  photoUri: string
  metadata: ReturnType<typeof buildMintMetadata>
}): Promise<{ stagingKey: string; placeholderUri: string; terms: QuickMintTerms }> {
  const staged = await stageQuickMint({
    wallet: params.wallet,
    photoUri: params.photoUri,
    metadata: params.metadata,
  })
  return {
    stagingKey: staged.stagingKey,
    placeholderUri: staged.placeholderUri,
    terms: {
      treasury: staged.treasury,
      feeLamports: staged.feeLamports,
      updateAuthority: staged.updateAuthority,
    },
  }
}

/**
 * Tell the Worker the fee landed, so it can buy the bytes and swap the
 * placeholder. A failure here is NOT a failed mint — the asset exists and is
 * paid for — so it never fails the item; the persisted queue retries.
 */
async function finalizeAndClear(entry: { stagingKey: string; signature: string; assetAddress: string }): Promise<void> {
  try {
    await finalizeQuickMint(entry)
    await clearPendingFinalize(entry.stagingKey)
  } catch (err) {
    console.warn(`[mint] finalize deferred for ${entry.assetAddress}:`, err instanceof Error ? err.message : err)
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
    async (items: BatchItemInput[], onItem: (photoId: string, update: BatchItemUpdate) => void): Promise<BatchSummary> => {
      const summary: BatchSummary = { succeeded: 0, failed: 0, aborted: false }

      if (!account) {
        items.forEach((item) => onItem(item.photoId, { status: 'failed', error: 'Wallet not connected' }))
        summary.failed = items.length
        return summary
      }
      const walletAddress = account.address.toString()

      const workerItems = items.filter(isWorkerFrame)
      // A roll frame that reaches here without a usable collection address is
      // a bug (rollContext set, but isWorkerFrame() rejected it) — report it
      // failed rather than quietly minting it as an unrelated, unpaid asset.
      const malformedRollItems = items.filter((item) => !isWorkerFrame(item) && item.rollContext)
      const clientItems = items.filter((item) => !isWorkerFrame(item) && !item.rollContext)

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
          const res = await mintWorkerFrame({
            collectionAddress: collectionAddress!,
            frameIndex: frameNumber,
            photoUri: item.photoUri,
            description: `Shot on Seeker by ${item.artist}`,
            attributes: workerFrameAttributes(item),
          })
          summary.succeeded++
          onItem(item.photoId, {
            status: 'success',
            // A resumed frame can come back without its original signature;
            // the asset address is what identifies the mint either way.
            signature: res.signature ?? '',
            mintAddress: res.assetAddress,
          })
        } catch (err) {
          summary.failed++
          onItem(item.photoId, { status: 'failed', error: describeWorkerError(err) })
        }
      }

      for (let start = 0; start < clientItems.length; start += MINT_CHUNK_SIZE) {
        const chunk = clientItems.slice(start, start + MINT_CHUNK_SIZE)

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
        // Which quick items got as far as a signature. Anything NOT in here on
        // failure was never paid for, so its stage can safely be given back.
        const signedPhotoIds = new Set<string>()

        ready.forEach(({ item }) => onItem(item.photoId, { status: 'signing' }))
        try {
          const results = await mintNFTBatch(
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
              // committed, so the record has to outlive a crash.
              onItemSigned: (photoId, { signature, mintAddress }) => {
                const quick = quickByPhotoId.get(photoId)
                if (quick) {
                  signedPhotoIds.add(photoId)
                  void recordPendingFinalize({ stagingKey: quick.stagingKey, signature, assetAddress: mintAddress })
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
                summary.succeeded++
                onItem(result.id, { status: 'success', signature: result.signature, mintAddress: result.mintAddress })
              } else {
                summary.failed++
                onItem(result.id, {
                  status: 'failed',
                  error: categorizeError(new Error(result.error ?? 'Minting failed')),
                })
              }
            },
          )

          // Finalize after the chunk, not per item: the mints are already
          // reported as successful, and a finalize failure must not turn a paid
          // mint into a failed one — the persisted queue retries it instead.
          for (const result of results) {
            const quick = quickByPhotoId.get(result.id)
            if (quick && result.success && result.signature && result.mintAddress) {
              await finalizeAndClear({
                stagingKey: quick.stagingKey,
                signature: result.signature,
                assetAddress: result.mintAddress,
              })
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
