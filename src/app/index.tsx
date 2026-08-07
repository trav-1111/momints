import { useEffect, useCallback } from 'react'
import { View, Text, ActivityIndicator, Pressable, Image } from 'react-native'
import { useRouter } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import { useNetworkStore } from '../store/network'
import { useSessionStore } from '../store/session'
import { colors, fonts, splashGradient, tracking } from '../theme'

export default function SplashScreen() {
  const router = useRouter()
  const cluster = useNetworkStore((s) => s.cluster)
  const setCluster = useNetworkStore((s) => s.setCluster)

  useEffect(() => {
    const timer = setTimeout(() => {
      const { hasSetMode } = useSessionStore.getState()
      router.replace(hasSetMode ? '/camera' : '/mode-select')
    }, 1500)

    return () => clearTimeout(timer)
  }, [router])

  const toggleCluster = useCallback(() => {
    setCluster(cluster === 'mainnet' ? 'devnet' : 'mainnet')
  }, [cluster, setCluster])

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <LinearGradient
        colors={[...splashGradient.colors]}
        locations={[...splashGradient.locations]}
        start={splashGradient.start}
        end={splashGradient.end}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
      >
        {/* Aperture logo — the brand art */}
        <Image
          source={require('../../assets/adaptive-icon.png')}
          style={{ width: 176, height: 176, marginBottom: 30 }}
          resizeMode="contain"
        />
        <Text
          style={{
            fontFamily: fonts.sans,
            fontSize: 42,
            letterSpacing: tracking(-0.02, 42),
            color: colors.text,
            lineHeight: 44,
          }}
        >
          Momints
        </Text>
        <Text
          style={{
            fontFamily: fonts.mono,
            fontSize: 12,
            letterSpacing: tracking(0.26, 12),
            color: '#9aa0b8',
            marginTop: 16,
          }}
        >
          POINT · SHOOT · MINT
        </Text>

        <ActivityIndicator size="small" color={colors.accentSoft} style={{ marginTop: 46 }} />

        {/* Network pill — active side lit, tap to switch */}
        <Pressable
          onPress={toggleCluster}
          style={{
            position: 'absolute',
            bottom: 34,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingVertical: 9,
            paddingHorizontal: 15,
            borderRadius: 999,
            backgroundColor: 'rgba(10,12,22,0.55)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.1)',
          }}
        >
          <View
            style={{
              width: 7,
              height: 7,
              borderRadius: 4,
              backgroundColor: cluster === 'devnet' ? colors.yellow : colors.green,
            }}
          />
          <Text
            style={{
              fontFamily: fonts.mono,
              fontSize: 11,
              color: cluster === 'devnet' ? colors.textSoft : colors.textMuted,
            }}
          >
            DEVNET
          </Text>
          <View style={{ width: 1, height: 12, backgroundColor: 'rgba(255,255,255,0.14)' }} />
          <Text
            style={{
              fontFamily: fonts.mono,
              fontSize: 11,
              color: cluster === 'mainnet' ? colors.textSoft : colors.textMuted,
            }}
          >
            MAINNET
          </Text>
        </Pressable>
      </LinearGradient>
    </View>
  )
}
