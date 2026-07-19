import type { ReactNode } from 'react'
import { View, Text } from 'react-native'
import { colors, fonts } from '../theme'
import { IconCamera } from './icons'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
}

export function EmptyState({ icon, title, description }: EmptyStateProps) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
      <View style={{ marginBottom: 16 }}>{icon ?? <IconCamera size={40} color={colors.textMuted} />}</View>
      <Text
        style={{
          fontFamily: fonts.sansBold,
          fontSize: 18,
          color: colors.text,
          textAlign: 'center',
          marginBottom: 8,
        }}
      >
        {title}
      </Text>
      {description && (
        <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.textSecondary, textAlign: 'center' }}>
          {description}
        </Text>
      )}
    </View>
  )
}
