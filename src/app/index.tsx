import { useEffect } from 'react'
import { View, Text, ActivityIndicator, Image } from 'react-native'
import { useRouter } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import { useSessionStore } from '../store/session'
import { colors, fonts, splashGradient, tracking } from '../theme'

export default function SplashScreen() {
  const router = useRouter()

  useEffect(() => {
    const timer = setTimeout(() => {
      const { hasSetMode } = useSessionStore.getState()
      router.replace(hasSetMode ? '/camera' : '/mode-select')
    }, 1500)

    return () => clearTimeout(timer)
  }, [router])

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
      </LinearGradient>
    </View>
  )
}
