import '../global.css'

import { Slot } from 'expo-router'
import { View } from 'react-native'
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
import { useNetworkStore, getClusterRpc } from '../store/network'
import { colors } from '../theme'

const identity = {
  name: 'Momints',
  uri: 'https://momints.app',
}

export default function Layout() {
  const cluster = useNetworkStore((s) => s.cluster)
  const rpc = getClusterRpc(cluster)

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
