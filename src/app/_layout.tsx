import '../global.css'

import { Slot } from 'expo-router'
import { MobileWalletProvider, createSolanaMainnet, createSolanaDevnet } from '@wallet-ui/react-native-kit'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useNetworkStore, getClusterRpc } from '../store/network'

const identity = {
  name: 'Momints',
  uri: 'https://momints.app',
}

export default function Layout() {
  const cluster = useNetworkStore((s) => s.cluster)
  const rpc = getClusterRpc(cluster)

  const solanaCluster =
    cluster === 'devnet'
      ? createSolanaDevnet({ url: rpc })
      : createSolanaMainnet({ url: rpc })

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* key forces MobileWalletProvider to remount on cluster change */}
      <MobileWalletProvider key={cluster} cluster={solanaCluster} identity={identity}>
        <Slot />
      </MobileWalletProvider>
    </GestureHandlerRootView>
  )
}
