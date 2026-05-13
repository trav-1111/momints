import { useState, useCallback } from 'react'
import { View, Text, Pressable, TextInput } from 'react-native'
import { useRouter } from 'expo-router'
import { useSessionStore } from '../store/session'
import type { AppMode, RollSize } from '../store/session'

const ROLL_SIZES: RollSize[] = [12, 24, 36]

export default function ModeSelectScreen() {
  const router = useRouter()
  const selectQuickMode = useSessionStore((s) => s.selectQuickMode)
  const startRoll = useSessionStore((s) => s.startRoll)

  const [selectedMode, setSelectedMode] = useState<AppMode>('quick')
  const [rollName, setRollName] = useState('')
  const [rollSize, setRollSize] = useState<RollSize>(36)

  const handleLoadCamera = useCallback(() => {
    if (selectedMode === 'quick') {
      selectQuickMode()
      router.replace('/camera')
    } else {
      startRoll(rollName.trim() || 'Untitled Roll', rollSize)
      router.replace('/camera')
    }
  }, [selectedMode, rollName, rollSize, selectQuickMode, startRoll, router])

  return (
    <View className="flex-1 bg-black px-6">
      {/* Title */}
      <View className="pt-16 pb-8 items-center">
        <Text className="text-white text-3xl font-bold">Choose your mode</Text>
        <Text className="text-gray-500 text-sm mt-2">You can change this anytime</Text>
      </View>

      {/* Mode Cards */}
      <View className="flex-row gap-4 mb-6">
        {/* Quick Mint */}
        <Pressable
          onPress={() => setSelectedMode('quick')}
          className={`flex-1 rounded-2xl p-5 items-center border-2 ${
            selectedMode === 'quick'
              ? 'bg-purple-900/60 border-purple-500'
              : 'bg-gray-900 border-gray-700'
          }`}
        >
          <Text className="text-3xl mb-3">⚡</Text>
          <Text className="text-white font-bold text-base mb-1">Quick Mint</Text>
          <Text className="text-gray-400 text-xs text-center">Mint individual shots</Text>
        </Pressable>

        {/* Lomo Roll */}
        <Pressable
          onPress={() => setSelectedMode('roll')}
          className={`flex-1 rounded-2xl p-5 items-center border-2 ${
            selectedMode === 'roll'
              ? 'bg-purple-900/60 border-purple-500'
              : 'bg-gray-900 border-gray-700'
          }`}
        >
          <Text className="text-3xl mb-3">🎞️</Text>
          <Text className="text-white font-bold text-base mb-1">Lomo Roll</Text>
          <Text className="text-gray-400 text-xs text-center">Shoot a roll, mint as collection</Text>
        </Pressable>
      </View>

      {/* Roll Options — revealed when Lomo Roll is selected */}
      {selectedMode === 'roll' && (
        <View className="mb-6">
          <Text className="text-gray-400 text-sm mb-2">Roll name (optional)</Text>
          <TextInput
            value={rollName}
            onChangeText={setRollName}
            placeholder="e.g. Golden Hour"
            placeholderTextColor="#6B7280"
            className="bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white text-base mb-4"
            maxLength={40}
            returnKeyType="done"
          />

          <Text className="text-gray-400 text-sm mb-2">Number of frames</Text>
          <View className="flex-row gap-3">
            {ROLL_SIZES.map((size) => (
              <Pressable
                key={size}
                onPress={() => setRollSize(size)}
                className={`flex-1 py-3 rounded-full items-center border ${
                  rollSize === size
                    ? 'bg-purple-600 border-purple-500'
                    : 'bg-gray-900 border-gray-700'
                }`}
              >
                <Text className={`font-bold text-base ${rollSize === size ? 'text-white' : 'text-gray-400'}`}>
                  {size}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <View className="flex-1" />

      <Pressable
        onPress={handleLoadCamera}
        className="w-full py-4 rounded-xl items-center bg-purple-600 mb-12"
      >
        <Text className="text-white font-bold text-lg">Load Camera</Text>
      </Pressable>
    </View>
  )
}
