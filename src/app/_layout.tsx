import '../global.css'

import { Slot } from 'expo-router'
import { useEffect, useState } from 'react'
import { AppState, View } from 'react-native'
import { useFonts } from 'expo-font'
import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk'
import { SpaceMono_400Regular, SpaceMono_700Bold } from '@expo-google-fonts/space-mono'
import { MobileWalletProvider, createSolanaMainnet, useMobileWallet } from '@wallet-ui/react-native-kit'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { isWorkerRollEnabled } from '../config/rollApi'
import { getClusterRpc } from '../store/network'
import { startPendingFinalizePolling } from '../store/quickFinalize'
import { colors } from '../theme'
import { runPrivacyStartupSweep } from '../services/imagePrivacy'
import { sessionHydrated, useSessionStore } from '../store/session'
import { usePhotoStore } from '../store/photos'
import { consumeVerifiedRollReceipt, restoreRollVault } from '../services/rollVault'
import { useRollRegistry } from '../store/rollRegistry'
import { filmStockHydrated, useFilmStockStore } from '../store/filmstocks'
import {
  reconcileActiveRollFrames,
  ROLL_RECONCILIATION_INTERVAL_MS,
  ROLL_RECONCILIATION_WINDOW_MS,
} from '../services/rollReconciliation'

const identity = {
  name: 'Momints',
  uri: 'https://momints.xyz',
}

/**
 * Retry any quick mint that was paid for but never confirmed to the Worker.
 *
 * The fee rides inside the mint transaction, so a shot that was signed and
 * landed is paid whether or not the app survived long enough to say so. Drain
 * on launch and on every return to the foreground; finalize is idempotent, so
 * an extra pass costs one request and never double-charges.
 */
function useQuickFinalizeDrain(): void {
  useEffect(() => {
    if (!isWorkerRollEnabled()) return

    const drain = () => {
      startPendingFinalizePolling().catch(() => {
        // Offline or Worker down — entries persist for the next foreground.
      })
    }

    drain()
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') drain()
    })
    return () => subscription.remove()
  }, [])
}

function usePrivacyStartupCleanup(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    void (async () => {
      await Promise.all([sessionHydrated, filmStockHydrated])
      await runPrivacyStartupSweep()
      usePhotoStore.getState().clearSession()
      const roll = useSessionStore.getState().activeRoll
      if (roll) {
        try {
          if (await consumeVerifiedRollReceipt(roll)) {
            if (roll.collectionAddress) useRollRegistry.getState().closeRoll(roll.collectionAddress)
            useSessionStore.getState().completeRoll()
          } else {
            const restored = await restoreRollVault(roll.id, roll.film.filmStockId)
            if (restored.frameIds.length < roll.frameIds.length) {
              throw new Error('The encrypted roll vault is missing one or more recorded frames.')
            }
            usePhotoStore.getState().restoreRollPhotos(restored.photos)
            useSessionStore.getState().restoreRollFrames(restored.frameIds)
          }
        } catch (error) {
          // Never reset or overwrite a paid roll after a vault error. Keeping
          // its durable frame ids blocks accidental replacement; a later
          // launch can retry hydration once the underlying issue is resolved.
          console.error('[roll-vault] Failed to restore encrypted roll:', error)
        }
      }
      setReady(true)
    })()
  }, [])
  return ready
}

const solanaCluster = createSolanaMainnet({ url: getClusterRpc() })

function FilmStockWalletSync() {
  const { account } = useMobileWallet()
  const wallet = account?.address?.toString() ?? null
  useEffect(() => {
    const refresh = () => void useFilmStockStore.getState().refresh(wallet)
    refresh()
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh()
    })
    return () => subscription.remove()
  }, [wallet])
  return null
}

/**
 * A Worker frame may be fully minted before its Arweave image is visible.
 * Reconcile checkpointed frames for forty minutes after minting begins, and
 * always make one fresh pass on launch/foreground even after that window.
 */
function RollFrameReconciliationSync() {
  const { account } = useMobileWallet()
  const wallet = account?.address?.toString() ?? null
  const rollKey = useSessionStore((state) => {
    const roll = state.activeRoll
    return roll?.developed && roll.collectionAddress
      ? `${roll.collectionAddress}:${roll.mintStartedAt ?? 'legacy'}`
      : null
  })

  useEffect(() => {
    if (!isWorkerRollEnabled() || !rollKey) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const startedAt = useSessionStore.getState().activeRoll?.mintStartedAt
    const deadline = startedAt ? startedAt + ROLL_RECONCILIATION_WINDOW_MS : Date.now() + ROLL_RECONCILIATION_WINDOW_MS

    const poll = async (continueWindow: boolean) => {
      try {
        const result = await reconcileActiveRollFrames(wallet)
        if (cancelled || result.state === 'idle' || result.state === 'awaiting-wallet' || result.vaultVerified) return
      } catch {
        // Offline/Worker unavailable: retain the roll and retry below or on
        // the next foreground transition.
      }
      if (!cancelled && continueWindow && Date.now() < deadline) {
        timer = setTimeout(() => void poll(true), ROLL_RECONCILIATION_INTERVAL_MS)
      }
    }

    const restart = () => {
      if (timer) clearTimeout(timer)
      void poll(Date.now() < deadline)
    }

    restart()
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') restart()
      else if (timer) clearTimeout(timer)
    })
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      subscription.remove()
    }
  }, [rollKey, wallet])

  return null
}

export default function Layout() {
  const storageReady = usePrivacyStartupCleanup()
  useQuickFinalizeDrain()

  const [fontsLoaded] = useFonts({
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
    SpaceMono_400Regular,
    SpaceMono_700Bold,
  })

  // Hold on a blank brand-dark frame for the moment fonts decode
  if (!fontsLoaded || !storageReady) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <MobileWalletProvider cluster={solanaCluster} identity={identity}>
        <FilmStockWalletSync />
        <RollFrameReconciliationSync />
        <Slot />
      </MobileWalletProvider>
    </GestureHandlerRootView>
  )
}
