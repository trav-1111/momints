import { Text, Pressable } from 'react-native'
import { useMobileWallet } from '@wallet-ui/react-native-kit'

interface WalletStatusProps {
  compact?: boolean
}

export function WalletStatus({ compact = false }: WalletStatusProps) {
  const { account, connect, disconnect } = useMobileWallet()

  if (!account) {
    return (
      <Pressable
        onPress={connect}
        className={`bg-purple-600 rounded-full ${compact ? 'px-3 py-1' : 'px-4 py-2'}`}
      >
        <Text className={`text-white font-bold ${compact ? 'text-xs' : 'text-sm'}`}>
          Connect Wallet
        </Text>
      </Pressable>
    )
  }

  const address = account.address.toString()
  const shortAddress = `${address.slice(0, 4)}...${address.slice(-4)}`

  return (
    <Pressable
      onPress={disconnect}
      className={`bg-green-600/80 rounded-full ${compact ? 'px-3 py-1' : 'px-4 py-2'}`}
    >
      <Text className={`text-white font-medium ${compact ? 'text-xs' : 'text-sm'}`}>
        {shortAddress}
      </Text>
    </Pressable>
  )
}
