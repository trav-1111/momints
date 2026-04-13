import { View, Text, Pressable } from 'react-native'

interface HeaderProps {
  title: string
  onBack?: () => void
  rightAction?: React.ReactNode
}

export function Header({ title, onBack, rightAction }: HeaderProps) {
  return (
    <View className="pt-12 pb-4 px-6 flex-row items-center justify-between border-b border-gray-800">
      {onBack ? (
        <Pressable onPress={onBack} className="p-2 -ml-2">
          <Text className="text-white text-2xl">←</Text>
        </Pressable>
      ) : (
        <View className="w-10" />
      )}
      <Text className="text-white text-xl font-bold">{title}</Text>
      {rightAction || <View className="w-10" />}
    </View>
  )
}
