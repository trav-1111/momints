import { View, Text, ActivityIndicator, Modal } from 'react-native'

interface LoadingOverlayProps {
  visible: boolean
  message?: string
}

export function LoadingOverlay({ visible, message = 'Loading...' }: LoadingOverlayProps) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View className="flex-1 bg-black/80 items-center justify-center">
        <View className="bg-gray-900 p-8 rounded-2xl items-center">
          <ActivityIndicator size="large" color="#8B5CF6" />
          <Text className="text-white text-lg mt-4">{message}</Text>
        </View>
      </View>
    </Modal>
  )
}
