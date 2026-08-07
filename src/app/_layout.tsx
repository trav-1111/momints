import '../global.css'

import { Slot } from 'expo-router'
import { useEffect } from 'react'
import { AppState, View } from 'react-native'
import { useFonts } from 'expo-font'
import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk'
import { SpaceMono_400Regular, SpaceMono_700Bold } from '@expo-google-fonts/space-mono'
import { MobileWalletProvider, createSolanaMainnet, createSolanaDevnet } from '@wallet-ui/react-native-kit'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { isWorkerRollEnabled } from '../config/rollApi'
import { useNetworkStore, getClusterRpc } from '../store/network'
import { drainPendingFinalizes } from '../store/quickFinalize'
import { colors } from '../theme'

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
      drainPendingFinalizes().catch(() => {
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

export default function Layout() {
  const cluster = useNetworkStore((s) => s.cluster)
  const rpc = getClusterRpc(cluster)

  useQuickFinalizeDrain()

  const [fontsLoaded] = useFonts({
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
    SpaceMono_400Regular,
    SpaceMono_700Bold,
  })

  const solanaCluster = cluster === 'devnet' ? createSolanaDevnet({ url: rpc }) : createSolanaMainnet({ url: rpc })

  // Hold on a blank brand-dark frame for the moment fonts decode
  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* key forces MobileWalletProvider to remount on cluster change */}
      <MobileWalletProvider key={cluster} cluster={solanaCluster} identity={identity}>
        <Slot />
      </MobileWalletProvider>
    </GestureHandlerRootView>
  )
}
