import { View, Text, Pressable, Alert } from 'react-native'
import type { ActiveRoll } from '../store/session'
import { colors, fonts, tracking } from '../theme'
import { IconFilm, IconMint } from './icons'

interface RollCardProps {
  roll: ActiveRoll
  // Frames of this roll already minted on-chain — drives partial-mint copy.
  mintedCount?: number
  // Fully shot roll → queue its frames and open the mint queue.
  onMint?: () => void
  onDiscard?: () => void
}

function Badge({ label }: { label: string }) {
  return (
    <Text
      style={{
        fontFamily: fonts.mono,
        fontSize: 9,
        letterSpacing: tracking(0.08, 9),
        color: colors.textSecondary,
        paddingVertical: 2,
        paddingHorizontal: 7,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: 'hidden',
      }}
    >
      {label}
    </Text>
  )
}

// A status card only — a roll is shot blind, so its frames are never shown
// here. They first appear as thumbnails in the mint queue.
export function RollCard({ roll, mintedCount = 0, onMint, onDiscard }: RollCardProps) {
  const count = roll.frameIds.length
  const remaining = count - mintedCount
  const partiallyMinted = roll.developed && mintedCount > 0 && remaining > 0

  const confirmDiscard = () => {
    if (!onDiscard) return
    Alert.alert('Discard roll', `Delete "${roll.name}" and its ${count} frame(s) without minting?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onDiscard },
    ])
  }

  return (
    <View
      style={{
        padding: 15,
        paddingHorizontal: 16,
        borderRadius: 16,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        marginBottom: 18,
      }}
    >
      {/* Header row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            backgroundColor: colors.accentTint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <IconFilm size={16} color={colors.accent} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontFamily: fonts.sansBold, fontSize: 14, color: colors.text }}>
            {roll.name}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 3 }}>
            {roll.film.mode === 'bw' && <Badge label="B&W" />}
            {roll.aspect !== 'full' && <Badge label={roll.aspect} />}
            {roll.film.mode !== 'bw' && roll.aspect === 'full' && <Badge label="COLOR" />}
          </View>
        </View>
        <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.textMuted }}>
          {roll.developed ? `${count} FRAME${count === 1 ? '' : 'S'}` : `${count} / ${roll.size}`}
        </Text>
      </View>

      {/* Status line */}
      <Text style={{ fontFamily: fonts.sans, fontSize: 11.5, color: colors.textSecondary, marginBottom: 12 }}>
        {!roll.developed
          ? `Undeveloped — shots stay hidden until the roll is finished. ${roll.size - count} left.`
          : mintedCount >= count && count > 0
            ? 'All frames minted — open the roll to finish it.'
            : partiallyMinted
              ? `${mintedCount} of ${count} frames minted — mint the remaining ${remaining}.`
              : 'Roll finished — mint it to see your frames.'}
      </Text>

      {/* Actions */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {/* Only a finished roll offers an action — an in-progress roll is shot,
            not managed. */}
        {roll.developed && (
          <Pressable
            onPress={onMint}
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              paddingVertical: 11,
              borderRadius: 12,
              backgroundColor: colors.accent,
            }}
          >
            <IconMint size={15} color={colors.white} strokeWidth={1.7} />
            <Text style={{ fontFamily: fonts.sansBold, fontSize: 13, color: colors.white }}>
              {partiallyMinted ? `Mint Remaining (${remaining})` : 'Mint Roll'}
            </Text>
          </Pressable>
        )}
        {onDiscard && (
          <Pressable onPress={confirmDiscard} hitSlop={10}>
            <Text
              style={{
                fontFamily: fonts.mono,
                fontSize: 10,
                letterSpacing: tracking(0.08, 10),
                color: colors.textMuted,
              }}
            >
              DISCARD
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  )
}
