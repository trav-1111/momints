import { View, Text, Pressable, Image, ScrollView } from 'react-native'
import type { ActiveRoll } from '../store/session'
import type { Photo } from '../store/photos'

interface RollCardProps {
  roll: ActiveRoll
  frames: Photo[]
  onDevelop: () => void
}

const THUMB_SIZE = 56

export function RollCard({ roll, frames, onDevelop }: RollCardProps) {
  const isFull = frames.length >= roll.size
  const emptySlots = Math.max(0, Math.min(roll.size - frames.length, 8))

  return (
    <View className="bg-gray-900 rounded-2xl border border-gray-800 p-4 mb-4">
      {/* Header row */}
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center gap-2 flex-1">
          <Text className="text-xl">🎞️</Text>
          <Text className="text-white font-bold text-base" numberOfLines={1}>
            {roll.name}
          </Text>
        </View>
        <Text className="text-gray-400 text-sm">
          {frames.length} / {roll.size} frames
        </Text>
      </View>

      {/* Thumbnail strip */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4">
        <View className="flex-row gap-2">
          {frames.map((photo) => (
            <Image
              key={photo.id}
              source={{ uri: photo.uri }}
              style={{ width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 8 }}
              resizeMode="cover"
            />
          ))}
          {Array.from({ length: emptySlots }).map((_, i) => (
            <View
              key={`empty-${i}`}
              style={{ width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 8 }}
              className="bg-gray-800 border border-gray-700 items-center justify-center"
            >
              <Text className="text-gray-600 text-xs">{frames.length + i + 1}</Text>
            </View>
          ))}
          {roll.size - frames.length > emptySlots && (
            <View
              style={{ width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 8 }}
              className="bg-gray-800 border border-gray-700 items-center justify-center"
            >
              <Text className="text-gray-500 text-xs">
                +{roll.size - frames.length - emptySlots}
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Develop button */}
      <Pressable
        onPress={onDevelop}
        disabled={frames.length === 0}
        className={`py-3 rounded-xl items-center ${
          frames.length > 0 ? 'bg-purple-600' : 'bg-gray-700'
        }`}
      >
        <Text className="text-white font-bold">
          {frames.length === 0
            ? 'No frames yet'
            : isFull
            ? '🧪 Develop Roll'
            : `🧪 Develop Early (${frames.length}/${roll.size})`}
        </Text>
      </Pressable>
    </View>
  )
}
