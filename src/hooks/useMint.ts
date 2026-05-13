import { useState, useCallback } from 'react'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { uploadToIPFS } from '../services/ipfs'
import { mintNFT, type MintPhaseCallback } from '../services/mint'
import { useNetworkStore, getClusterRpc } from '../store/network'

interface MintParams {
  photoUri: string
  title: string
  artist: string
  capturedAt: number
  onMintPhase?: MintPhaseCallback
}

interface MintResult {
  success: boolean
  signature?: string
  mintAddress?: string
  error?: string
}

type MintStatus = 'idle' | 'uploading' | 'signing' | 'confirming' | 'success' | 'error'

function categorizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const msg = raw.toLowerCase()

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
  const { account, client, signTransaction } = useMobileWallet()
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
        const { metadataUri } = await uploadToIPFS(params)

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
        return { success: false, error: errorMessage }
      }
    },
    [account, client, signTransaction, cluster],
  )

  const reset = useCallback(() => {
    setStatus('idle')
    setError(null)
  }, [])

  return {
    mint,
    reset,
    status,
    error,
    isLoading: status !== 'idle' && status !== 'success' && status !== 'error',
  }
}
