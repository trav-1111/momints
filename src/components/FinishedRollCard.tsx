import { View, Text, Image } from 'react-native'
import type { Photo } from '../store/photos'
import { colors, fonts, tracking } from '../theme'
import { IconCheck, IconFilm } from './icons'

interface FinishedRollCardProps {
  name: string
  frames: Photo[]
}

const THUMB = 44
const MAX_THUMBS = 6

// A roll that is no longer the session's active roll. Read-only: its frames are
// minted (or abandoned mid-mint) and can never re-enter a mint flow, so the card
// offers no actions — it exists so finished rolls stay visible and grouped
// instead of spilling their frames into the quick-photo grid.
export function FinishedRollCard({ name, frames }: FinishedRollCardProps) {
  const count = frames.length
  const mintedCount = frames.filter((f) => f.action === 'minted').length
  const allMinted = mintedCount === count && count > 0
  const shown = frames.slice(0, MAX_THUMBS)
  const overflow = count - shown.length

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
            {name}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 }}>
            {allMinted && <IconCheck size={11} color={colors.accent} strokeWidth={2} />}
            <Text
              style={{
                fontFamily: fonts.mono,
                fontSize: 9,
                letterSpacing: tracking(0.08, 9),
                color: colors.textSecondary,
              }}
            >
              {allMinted ? 'ALL FRAMES MINTED' : `${mintedCount} OF ${count} MINTED`}
            </Text>
          </View>
        </View>
        <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.textMuted }}>
          {count} FRAME{count === 1 ? '' : 'S'}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {shown.map((frame) => (
          <Image
            key={frame.id}
            source={{ uri: frame.uri }}
            style={{ width: THUMB, height: THUMB, borderRadius: 6, backgroundColor: colors.bg }}
          />
        ))}
        {overflow > 0 && (
          <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.textMuted, marginLeft: 2 }}>
            +{overflow}
          </Text>
        )}
      </View>
    </View>
  )
}
