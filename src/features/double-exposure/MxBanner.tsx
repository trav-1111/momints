import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, fonts } from '../../theme'

interface MxBannerProps {
  isMxActive: boolean
  firstExposureUri: string | null
  onReset: () => void
}

/**
 * Floating status banner for Multiple Exposure (MX) mode.
 * Shows exposure progress (e.g. "EXPOSURE 1/2 RECORDED • ALIGN NEXT SHOT") and provides a reset button.
 */
export const MxBanner: React.FC<MxBannerProps> = ({
  isMxActive,
  firstExposureUri,
  onReset,
}) => {
  if (!isMxActive) return null

  const isAwaitingSecondShot = !!firstExposureUri

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.badge,
          isAwaitingSecondShot ? styles.badgeActive : styles.badgeArmed,
        ]}
      >
        <View
          style={[
            styles.dot,
            isAwaitingSecondShot ? styles.dotActive : styles.dotArmed,
          ]}
        />
        <Text style={styles.text}>
          {isAwaitingSecondShot
            ? 'MX: 1/2 RECORDED • ALIGN SHOT 2'
            : 'DOUBLE EXPOSURE ARMED'}
        </Text>

        {isAwaitingSecondShot && (
          <Pressable
            onPress={onReset}
            style={({ pressed }) => [
              styles.resetButton,
              pressed && styles.resetButtonPressed,
            ]}
            hitSlop={8}
          >
            <Text style={styles.resetText}>✕ DISCARD</Text>
          </Pressable>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 64,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 35,
    pointerEvents: 'box-none',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: 'rgba(10, 15, 26, 0.88)',
    borderWidth: 1,
  },
  badgeArmed: {
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  badgeActive: {
    borderColor: colors.yellow,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 8,
  },
  dotArmed: {
    backgroundColor: '#9ca3af',
  },
  dotActive: {
    backgroundColor: colors.yellow,
  },
  text: {
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: '#ffffff',
  },
  resetButton: {
    marginLeft: 10,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.25)',
    borderWidth: 0.5,
    borderColor: 'rgba(239, 68, 68, 0.5)',
  },
  resetButtonPressed: {
    opacity: 0.7,
  },
  resetText: {
    fontFamily: fonts.mono,
    fontSize: 9,
    fontWeight: '700',
    color: '#ef4444',
  },
})
