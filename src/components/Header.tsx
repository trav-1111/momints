import { View, Text, Pressable } from 'react-native'
import { colors, fonts } from '../theme'
import { IconBack } from './icons'

interface HeaderProps {
  title: string
  onBack?: () => void
  rightAction?: React.ReactNode
}

export function Header({ title, onBack, rightAction }: HeaderProps) {
  return (
    <View
      style={{
        paddingTop: 52,
        paddingBottom: 16,
        paddingHorizontal: 22,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {onBack && (
          <Pressable onPress={onBack} hitSlop={8}>
            <IconBack size={21} color={colors.text} strokeWidth={1.7} />
          </Pressable>
        )}
        <Text style={{ fontFamily: fonts.sansBold, fontSize: 18, color: colors.text }}>{title}</Text>
      </View>
      {rightAction ?? <View style={{ width: 24 }} />}
    </View>
  )
}
