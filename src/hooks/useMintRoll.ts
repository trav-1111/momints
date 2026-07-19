import { useCallback } from 'react'
import { Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { usePhotoStore } from '../store/photos'
import { useSessionStore } from '../store/session'
import { useMintQueue } from '../store/mintQueue'
import { useRollRegistry } from '../store/rollRegistry'
import { useWalletDomain } from './useWalletDomain'

/**
 * Mint the active (developed) roll: auto-queue every remaining frame with
 * generated titles ("RollName — Frame N") and the wallet domain as artist,
 * then go straight to the minting progress screen. No per-frame forms.
 *
 * Runs after the roll has been developed (closed) and culled on the develop
 * screen. Single source of truth for kicking off a roll mint.
 */
export function useMintRoll() {
  const router = useRouter()
  const { account, connect } = useMobileWallet()
  const walletAddress = account?.address?.toString() ?? null
  const { domain } = useWalletDomain(walletAddress)

  const mintRoll = useCallback((): boolean => {
    const { activeRoll } = useSessionStore.getState()
    if (!activeRoll || activeRoll.frameIds.length === 0) {
      Alert.alert('Empty Roll', 'Shoot at least one frame before minting.')
      return false
    }

    if (!account || !walletAddress) {
      Alert.alert('Wallet Required', 'Connect your Solana wallet to mint this roll.', [
        { text: 'Not Now', style: 'cancel' },
        { text: 'Connect', onPress: () => connect() },
      ])
      return false
    }

    const { photos, setAction } = usePhotoStore.getState()
    const { addToQueue, mintHistory } = useMintQueue.getState()

    // Resolve frames to photos in capture order; skip missing and renumber
    const frames = activeRoll.frameIds
      .map((fid) => photos.find((p) => p.id === fid))
      .filter((p): p is NonNullable<typeof p> => p !== undefined)

    if (frames.length === 0) {
      Alert.alert('Empty Roll', 'No frames found for this roll.')
      return false
    }

    // Never queue a frame that's already on-chain (this session or a previous
    // one) — mint history ids are photo ids.
    const mintedIds = new Set(mintHistory.map((h) => h.id))
    const isMinted = (p: { id: string; action: string }) => p.action === 'minted' || mintedIds.has(p.id)
    const framesToMint = frames.filter((p) => !isMinted(p))

    if (framesToMint.length === 0) {
      const { completeRoll } = useSessionStore.getState()
      if (activeRoll.collectionAddress) {
        useRollRegistry.getState().closeRoll(activeRoll.collectionAddress)
      }
      completeRoll()
      Alert.alert('Roll Minted', 'Every frame on this roll is already minted — the roll is complete.')
      return false
    }

    // Frame numbers reflect the reviewed roll — a culled 8-frame roll reads
    // "Frame 3 of 8", not "3 of 36". Numbered over ALL surviving frames (minted
    // ones included) so a partial re-mint keeps its original numbering.
    const totalFrames = frames.length

    // Prepaid rolls carry their creation-time artist name; older rolls fall
    // back to the resolved domain / truncated address.
    const registryRecord = activeRoll.collectionAddress
      ? useRollRegistry.getState().getRoll(activeRoll.collectionAddress)
      : undefined
    const artist = registryRecord?.artist ?? domain ?? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`

    frames.forEach((photo, i) => {
      if (isMinted(photo)) return
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
          collectionAddress: activeRoll.collectionAddress,
        },
      })
      setAction(photo.id, 'mint')
    })

    router.push('/mint/progress')
    return true
  }, [account, walletAddress, domain, connect, router])

  return { mintRoll }
}
