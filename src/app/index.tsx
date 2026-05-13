import { useEffect, useCallback } from 'react'
import { View, Text, ActivityIndicator, Pressable } from 'react-native'
import { useRouter } from 'expo-router'
import { useNetworkStore } from '../store/network'
import { useSessionStore } from '../store/session'

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
    <View className="flex-1 bg-black items-center justify-center">
      <Text className="text-5xl font-bold text-white mb-4">Momints</Text>
      <Text className="text-lg text-gray-400 mb-8">Capture. Mint. Own.</Text>
      <ActivityIndicator size="large" color="#8B5CF6" />

      <Pressable
        onPress={toggleCluster}
        className="absolute bottom-12 flex-row items-center gap-2 px-4 py-2 rounded-full bg-gray-900 border border-gray-700"
      >
        <View
          className={`w-2 h-2 rounded-full ${cluster === 'devnet' ? 'bg-yellow-400' : 'bg-green-400'}`}
        />
        <Text className={`text-xs font-medium ${cluster === 'devnet' ? 'text-yellow-400' : 'text-green-400'}`}>
          {cluster === 'devnet' ? 'Devnet' : 'Mainnet'}
        </Text>
      </Pressable>
    </View>
  )
}
