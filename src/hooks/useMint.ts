import { useState, useCallback } from 'react'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { uploadToIPFS } from '../services/ipfs'
import { mintNFT, mintNFTBatch, type MintPhaseCallback } from '../services/mint'
import { useNetworkStore, getClusterRpc } from '../store/network'
import type { RollContext } from '../store/mintQueue'
import type { CaptureMeta } from '../store/photos'

interface MintParams {
  photoUri: string
  title: string
  artist: string
  capturedAt: number
  rollContext?: RollContext
  captureMeta?: CaptureMeta
  onMintPhase?: MintPhaseCallback
}

interface MintResult {
  success: boolean
  signature?: string
  mintAddress?: string
  error?: string
}

/** Frames per wallet approval. MWA signs a whole chunk in one prompt; kept
 * small so the shared blockhash never expires before send. */
export const MINT_CHUNK_SIZE = 6

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

type MintStatus = 'idle' | 'uploading' | 'signing' | 'confirming' | 'success' | 'error'

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

export function useMint() {
  const { account, client, signTransaction, disconnect } = useMobileWallet()
  const [status, setStatus] = useState<MintStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const cluster = useNetworkStore((s) => s.cluster)

  const mint = useCallback(
    async (params: MintParams): Promise<MintResult> => {
      if (!account) {
        return { success: false, error: 'Wallet not connected' }
      }

      setStatus('uploading')
      setError(null)

      try {
        const { metadataUri } = await uploadToIPFS({ ...params, creatorAddress: account.address.toString() })

        const result = await mintNFT(
          {
            metadataUri,
            name: params.title,
            symbol: 'MOMINT',
            walletAddress: account.address.toString(),
            rpc: getClusterRpc(cluster),
            cluster,
            onPhase: (phase) => {
              if (phase === 'signing') setStatus('signing')
              if (phase === 'confirming') setStatus('confirming')
              params.onMintPhase?.(phase)
            },
          },
          {
            client,
            signTransaction,
          },
        )

        setStatus('success')
        return {
          success: true,
          signature: result.signature,
          mintAddress: result.mintAddress,
        }
      } catch (err) {
        const errorMessage = categorizeError(err)
        setStatus('error')
        setError(errorMessage)
        if (errorMessage === WALLET_SESSION_EXPIRED) {
          // Drop the dead session so the badge offers a fresh connect
          disconnect().catch(() => {})
        }
        return { success: false, error: errorMessage }
      }
    },
    [account, client, signTransaction, disconnect, cluster],
  )

  /**
   * Mint many photos in chunks of MINT_CHUNK_SIZE — one wallet approval per
   * chunk instead of one per photo. Per-item progress streams through onItem.
   *
   * Upload failures are per-item and don't stop the run. A wallet-sign failure
   * (decline / dead session) fails the whole chunk and aborts the remaining
   * chunks — those items are never reported and stay pending for a retry.
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

      for (let start = 0; start < items.length; start += MINT_CHUNK_SIZE) {
        const chunk = items.slice(start, start + MINT_CHUNK_SIZE)

        chunk.forEach((item) => onItem(item.photoId, { status: 'uploading' }))
        const uploads = await Promise.all(
          chunk.map(async (item) => {
            try {
              const { metadataUri } = await uploadToIPFS({ ...item, creatorAddress: walletAddress })
              return { item, metadataUri }
            } catch (err) {
              onItem(item.photoId, { status: 'failed', error: categorizeError(err) })
              summary.failed++
              return null
            }
          }),
        )
        const ready = uploads.filter((u): u is NonNullable<typeof u> => u !== null)
        if (ready.length === 0) continue

        ready.forEach(({ item }) => onItem(item.photoId, { status: 'signing' }))
        try {
          await mintNFTBatch(
            ready.map(({ item, metadataUri }) => ({
              id: item.photoId,
              metadataUri,
              name: item.title,
              symbol: 'MOMINT',
              collectionAddress: item.rollContext?.collectionAddress,
            })),
            {
              walletAddress,
              rpc: getClusterRpc(cluster),
              cluster,
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
        } catch (err) {
          // Wallet sign failed — nothing in this chunk was sent
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
    [account, client, signTransaction, disconnect, cluster],
  )

  const reset = useCallback(() => {
    setStatus('idle')
    setError(null)
  }, [])

  return {
    mint,
    mintBatch,
    reset,
    status,
    error,
    isLoading: status !== 'idle' && status !== 'success' && status !== 'error',
  }
}
