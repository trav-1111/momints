import { View, Text } from 'react-native'

interface EmptyStateProps {
  icon?: string
  title: string
  description?: string
}

export function EmptyState({ icon = '📷', title, description }: EmptyStateProps) {
  return (
    <View className="flex-1 items-center justify-center px-8">
      <Text className="text-6xl mb-4">{icon}</Text>
      <Text className="text-white text-xl font-bold text-center mb-2">{title}</Text>
      {description && (
        <Text className="text-gray-400 text-center">{description}</Text>
      )}
    </View>
  )
}
