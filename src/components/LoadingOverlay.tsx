import { View, Text, ActivityIndicator, Modal } from 'react-native'
import { colors, fonts } from '../theme'

interface LoadingOverlayProps {
  visible: boolean
  message?: string
}

export function LoadingOverlay({ visible, message = 'Loading…' }: LoadingOverlayProps) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', alignItems: 'center', justifyContent: 'center' }}>
        <View
          style={{
            padding: 32,
            borderRadius: 16,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: 'center',
          }}
        >
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={{ fontFamily: fonts.sansSemiBold, fontSize: 15, color: colors.text, marginTop: 16 }}>
            {message}
          </Text>
        </View>
      </View>
    </Modal>
  )
}
