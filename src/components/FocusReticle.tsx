import React, { useRef, useMemo } from 'react'
import {
  View,
  Text,
  Pressable,
  Animated,
  StyleSheet,
  PanResponder,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import { colors, fonts } from '../theme'
import { IconLock, IconSun } from './icons'
import type { CameraLockMode } from '../hooks/useManualCameraState'

interface Props {
  point: { x: number; y: number } | null
  lockMode: CameraLockMode
  ev: number
  minExposure?: number
  maxExposure?: number
  onEvChange: (newEv: number) => void
  onCycleLock: () => void
  onUnlock: () => void
  opacity: Animated.Value
  screenW: number
  screenH: number
}

const RETICLE_SIZE = 76
const HALF_SIZE = RETICLE_SIZE / 2
const SLIDER_HEIGHT = 100
const MAX_TRAVEL = 42 // pixels up or down from center

export function FocusReticle({
  point,
  lockMode,
  ev,
  minExposure = -2,
  maxExposure = 2,
  onEvChange,
  onCycleLock,
  onUnlock,
  opacity,
  screenW,
  screenH,
}: Props) {
  if (!point) return null

  const isLocked = lockMode !== 'none'

  // Clamp reticle position inside visible bounds so badge and slider stay on-screen
  const left = Math.max(16, Math.min(screenW - RETICLE_SIZE - 48, point.x - HALF_SIZE))
  const top = Math.max(76, Math.min(screenH - RETICLE_SIZE - 170, point.y - HALF_SIZE))

  // Color theme according to lock mode
  const lockColor = useMemo(() => {
    switch (lockMode) {
      case 'AE':
        return '#FFA726' // Warm golden amber for AE
      case 'AF':
        return '#26C6DA' // Sharp cyan for AF
      case 'AF/AE':
      default:
        return '#FFD566' // Bright gold for combined AF/AE
    }
  }, [lockMode])

  const lockLabel = useMemo(() => {
    switch (lockMode) {
      case 'AE':
        return 'AE LOCK'
      case 'AF':
        return 'AF LOCK'
      case 'AF/AE':
      default:
        return 'AF/AE LOCK'
    }
  }, [lockMode])

  // PanResponder for vertical EV adjustment next to the reticle
  const lastEvRef = useRef(ev)
  lastEvRef.current = ev

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          Haptics.selectionAsync()
        },
        onPanResponderMove: (_, gestureState) => {
          // Negative dy is drag UP (brighter / positive EV)
          // Positive dy is drag DOWN (darker / negative EV)
          const range = maxExposure - minExposure
          const deltaEv = (-gestureState.dy / MAX_TRAVEL) * (range / 2)
          let targetEv = lastEvRef.current + deltaEv
          targetEv = Math.max(minExposure, Math.min(maxExposure, targetEv))
          // Round to 1 decimal place (e.g. +0.7)
          const roundedEv = Math.round(targetEv * 10) / 10
          if (roundedEv !== ev) {
            onEvChange(roundedEv)
          }
        },
        onPanResponderRelease: () => {
          Haptics.selectionAsync()
        },
      }),
    [ev, minExposure, maxExposure, onEvChange],
  )

  // Map current EV to vertical knob offset (-MAX_TRAVEL to +MAX_TRAVEL)
  const knobTravel = Math.max(
    -MAX_TRAVEL,
    Math.min(
      MAX_TRAVEL,
      -(ev / ((maxExposure - minExposure) / 2 || 1)) * MAX_TRAVEL,
    ),
  )

  return (
    <Animated.View
      style={[
        styles.container,
        {
          left,
          top,
          opacity,
        },
      ]}
      pointerEvents="box-none"
    >
      {/* Lock Badge Pill positioned above the reticle */}
      {isLocked && (
        <View style={styles.badgeWrapper} pointerEvents="box-none">
          <Pressable
            onPress={(e) => {
              e.stopPropagation()
              Haptics.selectionAsync()
              onCycleLock()
            }}
            accessibilityRole="button"
            accessibilityLabel={`${lockLabel}, tap to cycle lock mode`}
            style={[
              styles.lockPill,
              {
                borderColor: lockColor,
              },
            ]}
          >
            <IconLock size={12} color={lockColor} strokeWidth={2.2} />
            <Text style={[styles.lockPillText, { color: lockColor }]}>{lockLabel}</Text>
          </Pressable>
        </View>
      )}

      {/* Main Reticle Box with 4 corner brackets and center dot */}
      <View
        style={[
          styles.reticleBox,
          isLocked && {
            borderColor: lockColor,
            borderWidth: 1.5,
          },
        ]}
      >
        {/* Corner Brackets */}
        <View style={[styles.corner, styles.topLeft, { borderColor: isLocked ? lockColor : colors.accentSoft }]} />
        <View style={[styles.corner, styles.topRight, { borderColor: isLocked ? lockColor : colors.accentSoft }]} />
        <View style={[styles.corner, styles.bottomLeft, { borderColor: isLocked ? lockColor : colors.accentSoft }]} />
        <View style={[styles.corner, styles.bottomRight, { borderColor: isLocked ? lockColor : colors.accentSoft }]} />

        {/* Center reticle target dot */}
        <View
          style={[
            styles.centerDot,
            { backgroundColor: isLocked ? lockColor : colors.accentSoft },
          ]}
        />
      </View>

      {/* EV Sun Slider on right flank */}
      <View style={styles.sliderTrackContainer} pointerEvents="box-none">
        {/* Thin vertical rail */}
        <View style={styles.verticalRail} />
        {/* Center zero-tick mark */}
        <View style={styles.zeroTick} />

        {/* Draggable Sun Knob */}
        <View
          {...panResponder.panHandlers}
          style={[
            styles.sunKnobWrapper,
            {
              transform: [{ translateY: knobTravel }],
            },
          ]}
        >
          <Pressable
            onPress={() => {
              if (ev !== 0) {
                Haptics.selectionAsync()
                onEvChange(0)
              }
            }}
            style={styles.sunKnob}
          >
            <IconSun size={18} color={ev !== 0 ? colors.accent : '#FFF'} strokeWidth={1.8} />
          </Pressable>

          {/* EV numerical readout when non-zero */}
          {Math.abs(ev) > 0.05 && (
            <View style={styles.evBadge}>
              <Text style={styles.evBadgeText}>
                {ev > 0 ? `+${ev.toFixed(1)}` : ev.toFixed(1)}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Animated.View>
  )
}

const CORNER_LEN = 12
const CORNER_WIDTH = 2

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    width: RETICLE_SIZE,
    height: RETICLE_SIZE,
  },
  badgeWrapper: {
    position: 'absolute',
    top: -34,
    left: -20,
    right: -20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(14, 14, 18, 0.88)',
    borderWidth: 1.2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
    elevation: 4,
  },
  lockPillText: {
    fontFamily: fonts.monoBold,
    fontSize: 10,
    letterSpacing: 0.6,
  },
  reticleBox: {
    width: RETICLE_SIZE,
    height: RETICLE_SIZE,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  corner: {
    position: 'absolute',
    width: CORNER_LEN,
    height: CORNER_LEN,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderTopLeftRadius: 6,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderTopRightRadius: 6,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderBottomLeftRadius: 6,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderBottomRightRadius: 6,
  },
  centerDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    opacity: 0.8,
  },
  sliderTrackContainer: {
    position: 'absolute',
    left: RETICLE_SIZE + 10,
    top: (RETICLE_SIZE - SLIDER_HEIGHT) / 2,
    width: 38,
    height: SLIDER_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verticalRail: {
    position: 'absolute',
    width: 1,
    height: SLIDER_HEIGHT - 12,
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
  },
  zeroTick: {
    position: 'absolute',
    width: 8,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },
  sunKnobWrapper: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sunKnob: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(18, 18, 22, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  evBadge: {
    position: 'absolute',
    left: 36,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(18, 18, 22, 0.9)',
    borderWidth: 1,
    borderColor: colors.accent,
  },
  evBadgeText: {
    fontFamily: fonts.monoBold,
    fontSize: 10,
    color: colors.accentSoft,
  },
})
