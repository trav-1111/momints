import '../global.css'

import { Slot } from 'expo-router'
import { MobileWalletProvider, createSolanaMainnet } from '@wallet-ui/react-native-kit'
import { GestureHandlerRootView } from 'react-native-gesture-handler'

const SOLANA_RPC = process.env.EXPO_PUBLIC_SOLANA_RPC || 'https://api.mainnet-beta.solana.com'

const cluster = createSolanaMainnet({ url: SOLANA_RPC })
const identity = {
  name: 'Momints',
  uri: 'https://momints.app',
}

export default function Layout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <MobileWalletProvider cluster={cluster} identity={identity}>
        <Slot />
      </MobileWalletProvider>
    </GestureHandlerRootView>
  )
}
