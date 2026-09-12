import { Text, Pressable, View } from 'react-native'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { colors, fonts } from '../theme'
import { useWalletDomain, formatWalletDisplay } from '../hooks/useWalletDomain'

interface WalletStatusProps {
  compact?: boolean
}

export function WalletStatus({ compact = false }: WalletStatusProps) {
  const { account, connect, disconnect } = useMobileWallet()
  const address = account?.address?.toString() ?? null
  const { domain } = useWalletDomain(address)

  if (!account || !address) {
    return (
      <Pressable
        onPress={connect}
        style={{
          paddingVertical: compact ? 6 : 8,
          paddingHorizontal: compact ? 12 : 14,
          borderRadius: 999,
          backgroundColor: colors.accentTint,
          borderWidth: 1,
          borderColor: colors.accent,
        }}
      >
        <Text style={{ fontFamily: fonts.mono, fontSize: compact ? 10 : 11, color: colors.accentSoft }}>CONNECT</Text>
      </Pressable>
    )
  }

  return (
    <Pressable
      onPress={disconnect}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        paddingVertical: compact ? 6 : 8,
        paddingHorizontal: compact ? 10 : 12,
        borderRadius: 999,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.green }} />
      <Text style={{ fontFamily: fonts.mono, fontSize: compact ? 10 : 11, color: colors.text }}>
        {formatWalletDisplay(address, domain)}
      </Text>
    </Pressable>
  )
}
