import type { ReactNode } from 'react'
import { Pressable, Text, ActivityIndicator, View } from 'react-native'
import { colors, fonts } from '../theme'

interface ButtonProps {
  onPress: () => void
  title: string
  variant?: 'primary' | 'secondary' | 'danger' | 'success'
  disabled?: boolean
  loading?: boolean
  icon?: ReactNode
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
  const bg = disabled
    ? colors.surface
    : variant === 'primary'
      ? colors.accent
      : variant === 'danger'
        ? colors.red
        : variant === 'success'
          ? colors.green
          : colors.surface
  const border = disabled ? colors.border : variant === 'secondary' ? colors.border : bg
  const label = disabled ? colors.textMuted : variant === 'secondary' ? colors.textSoft : colors.white

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={{
        paddingVertical: 15,
        paddingHorizontal: fullWidth ? 0 : 24,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: border,
        width: fullWidth ? '100%' : undefined,
      }}
    >
      {loading ? (
        <ActivityIndicator color={colors.accentSoft} size="small" />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          {icon}
          <Text style={{ fontFamily: fonts.sansBold, fontSize: 14, color: label }}>{title}</Text>
        </View>
      )}
    </Pressable>
  )
}
