import { useState, useCallback } from 'react'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { uploadToIPFS } from '../services/ipfs'
import { mintNFT, type MintPhaseCallback } from '../services/mint'

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

export function useMint() {
  const { account, client, signTransaction } = useMobileWallet()
  const [status, setStatus] = useState<MintStatus>('idle')
  const [error, setError] = useState<string | null>(null)

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
        const errorMessage = err instanceof Error ? err.message : 'Unknown error'
        setStatus('error')
        setError(errorMessage)
        return { success: false, error: errorMessage }
      }
    },
    [account, client, signTransaction],
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
