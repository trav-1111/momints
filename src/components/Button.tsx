import { Pressable, Text, ActivityIndicator, View } from 'react-native'

interface ButtonProps {
  onPress: () => void
  title: string
  variant?: 'primary' | 'secondary' | 'danger' | 'success'
  disabled?: boolean
  loading?: boolean
  icon?: string
  fullWidth?: boolean
}

export function Button({
  onPress,
  title,
  variant = 'primary',
  disabled = false,
  loading = false,
  icon,
  fullWidth = true,
}: ButtonProps) {
  const getVariantStyles = () => {
    switch (variant) {
      case 'primary':
        return disabled ? 'bg-gray-700' : 'bg-purple-600 active:bg-purple-700'
      case 'secondary':
        return disabled ? 'bg-gray-700' : 'bg-gray-800 active:bg-gray-700'
      case 'danger':
        return disabled ? 'bg-gray-700' : 'bg-red-600 active:bg-red-700'
      case 'success':
        return disabled ? 'bg-gray-700' : 'bg-green-600 active:bg-green-700'
      default:
        return 'bg-purple-600'
    }
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      className={`py-4 rounded-xl items-center justify-center flex-row ${getVariantStyles()} ${fullWidth ? 'w-full' : 'px-6'}`}
    >
      {loading ? (
        <ActivityIndicator color="white" size="small" />
      ) : (
        <View className="flex-row items-center gap-2">
          {icon && <Text className="text-lg">{icon}</Text>}
          <Text className="text-white font-bold text-lg">{title}</Text>
        </View>
      )}
    </Pressable>
  )
}
