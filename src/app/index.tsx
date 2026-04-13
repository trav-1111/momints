import { useEffect } from 'react'
import { View, Text, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'

export default function SplashScreen() {
  const router = useRouter()

  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace('/camera')
    }, 1500)

    return () => clearTimeout(timer)
  }, [router])

  return (
    <View className="flex-1 bg-black items-center justify-center">
      <Text className="text-5xl font-bold text-white mb-4">Momints</Text>
      <Text className="text-lg text-gray-400 mb-8">Capture. Mint. Own.</Text>
      <ActivityIndicator size="large" color="#8B5CF6" />
    </View>
  )
}
