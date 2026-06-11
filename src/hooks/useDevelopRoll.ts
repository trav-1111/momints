import { useCallback } from 'react'
import { Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { usePhotoStore } from '../store/photos'
import { useSessionStore } from '../store/session'
import { useMintQueue } from '../store/mintQueue'
import { useWalletDomain } from './useWalletDomain'

/**
 * Develop the active roll: auto-queue every frame with generated titles
 * ("RollName — Frame N") and the wallet domain as artist, then go straight
 * to the minting progress screen. No per-frame forms.
 *
 * Single source of truth — used by the gallery roll card and the camera's
 * roll-full prompt.
 */
export function useDevelopRoll() {
  const router = useRouter()
  const { account, connect } = useMobileWallet()
  const walletAddress = account?.address?.toString() ?? null
  const { domain } = useWalletDomain(walletAddress)

  const developRoll = useCallback((): boolean => {
    const { activeRoll } = useSessionStore.getState()
    if (!activeRoll || activeRoll.frameIds.length === 0) {
      Alert.alert('Empty Roll', 'Shoot at least one frame before developing.')
      return false
    }

    if (!account || !walletAddress) {
      Alert.alert(
        'Wallet Required',
        'Connect your Solana wallet to develop and mint this roll.',
        [
          { text: 'Not Now', style: 'cancel' },
          { text: 'Connect', onPress: () => connect() },
        ]
      )
      return false
    }

    const { photos, setAction } = usePhotoStore.getState()
    const { addToQueue } = useMintQueue.getState()

    // Resolve frames to photos in capture order; skip missing and renumber
    const frames = activeRoll.frameIds
      .map((fid) => photos.find((p) => p.id === fid))
      .filter((p): p is NonNullable<typeof p> => p !== undefined)

    if (frames.length === 0) {
      Alert.alert('Empty Roll', 'No frames found for this roll.')
      return false
    }

    // Frame numbers reflect what's actually being developed — an
    // early-developed 8-frame roll reads "Frame 3 of 8", not "3 of 36"
    const totalFrames = frames.length
    const artist =
      domain ?? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`

    frames.forEach((photo, i) => {
      const frameNumber = i + 1
      addToQueue({
        photoId: photo.id,
        photoUri: photo.uri,
        title: `${activeRoll.name} — Frame ${frameNumber}`,
        artist,
        capturedAt: photo.capturedAt,
        captureMeta: photo.meta,
        rollContext: {
          rollId: activeRoll.id,
          rollName: activeRoll.name,
          frameNumber,
          totalFrames,
        },
      })
      setAction(photo.id, 'mint')
    })

    router.push('/mint/progress')
    return true
  }, [account, walletAddress, domain, connect, router])

  return { developRoll }
}
