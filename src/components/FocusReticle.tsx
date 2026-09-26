import React, { useRef, useMemo } from 'react'
import {
  View,
  Text,
  Pressable,
  Animated,
  StyleSheet,
  PanResponder,
} from 'react-native'
import Svg, { Line } from 'react-native-svg'
import * as Haptics from 'expo-haptics'
import { colors, fonts } from '../theme'
import { IconLock, IconSun } from './icons'
import type { CameraLockMode } from '../hooks/useManualCameraState'

interface Props {
  focusPoint: { x: number; y: number } | null
  exposurePoint: { x: number; y: number } | null
  isSeparated: boolean
  lockMode: CameraLockMode
  isHolding: boolean
  holdProgress: Animated.Value
  ev: number
  minExposure?: number
  maxExposure?: number
  onEvChange: (newEv: number) => void
  onCycleLock: () => void
  onToggleSeparate: () => void
  onUnlock: () => void
  onFocusPointChange?: (point: { x: number; y: number }) => void
  onExposurePointChange?: (point: { x: number; y: number }) => void
  opacity: Animated.Value
  screenW: number
  screenH: number
}

const FOCUS_BOX_SIZE = 76
const HALF_FOCUS = FOCUS_BOX_SIZE / 2
const EXP_BOX_SIZE = 64
const HALF_EXP = EXP_BOX_SIZE / 2
const SLIDER_HEIGHT = 90
const MAX_TRAVEL = 38 // pixels up or down

export function FocusReticle({
  focusPoint,
  exposurePoint,
  isSeparated,
  lockMode,
  isHolding,
  holdProgress,
  ev,
  minExposure = -2,
  maxExposure = 2,
  onEvChange,
  onCycleLock,
  onToggleSeparate,
  onUnlock,
  onFocusPointChange,
  onExposurePointChange,
  opacity,
  screenW,
  screenH,
}: Props) {
  if (!focusPoint) return null

  const isLocked = lockMode !== 'none'
  const expPoint = isSeparated && exposurePoint ? exposurePoint : focusPoint

  // Focus box clamp coordinates
  const focusLeft = Math.max(12, Math.min(screenW - FOCUS_BOX_SIZE - 12, focusPoint.x - HALF_FOCUS))
  const focusTop = Math.max(76, Math.min(screenH - FOCUS_BOX_SIZE - 180, focusPoint.y - HALF_FOCUS))

  // Exposure box clamp coordinates
  const expLeft = Math.max(12, Math.min(screenW - EXP_BOX_SIZE - 48, expPoint.x - HALF_EXP))
  const expTop = Math.max(76, Math.min(screenH - EXP_BOX_SIZE - 180, expPoint.y - HALF_EXP))

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

  // PanResponder for moving the Exposure Box across the screen
  const expPanResponder = useMemo(() => {
    let startX = 0
    let startY = 0
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startX = expPoint.x
        startY = expPoint.y
        Haptics.selectionAsync()
      },
      onPanResponderMove: (_, gestureState) => {
        if (onExposurePointChange) {
          const newX = Math.max(20, Math.min(screenW - 20, startX + gestureState.dx))
          const newY = Math.max(80, Math.min(screenH - 180, startY + gestureState.dy))
          onExposurePointChange({ x: newX, y: newY })
        }
      },
    })
  }, [expPoint, onExposurePointChange, screenW, screenH])

  // PanResponder for vertical EV adjustment next to the exposure reticle
  const lastEvRef = useRef(ev)
  lastEvRef.current = ev

  const evPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          Haptics.selectionAsync()
        },
        onPanResponderMove: (_, gestureState) => {
          const range = maxExposure - minExposure
          const deltaEv = (-gestureState.dy / MAX_TRAVEL) * (range / 2)
          let targetEv = lastEvRef.current + deltaEv
          targetEv = Math.max(minExposure, Math.min(maxExposure, targetEv))
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

  // Map current EV to vertical knob offset
  const knobTravel = Math.max(
    -MAX_TRAVEL,
    Math.min(
      MAX_TRAVEL,
      -(ev / ((maxExposure - minExposure) / 2 || 1)) * MAX_TRAVEL,
    ),
  )

  // Hold-to-lock animated feedback: interpolations
  const holdScale = holdProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1.25, 0.95],
  })

  const holdProgressWidth = holdProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  })

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity }]} pointerEvents="box-none">
      {/* SVG Connecting line between separated Focus and Exposure boxes */}
      {isSeparated && (
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          <Line
            x1={focusPoint.x}
            y1={focusPoint.y}
            x2={expPoint.x}
            y2={expPoint.y}
            stroke="rgba(255, 213, 102, 0.55)"
            strokeWidth="1.5"
            strokeDasharray="4, 4"
          />
        </Svg>
      )}

      {/* ============================================================== */}
      {/* 1. FOCUS BOX (Target coordinate for Auto-focus / Lens distance) */}
      {/* ============================================================== */}
      <View
        style={[
          styles.boxContainer,
          {
            left: focusLeft,
            top: focusTop,
            width: FOCUS_BOX_SIZE,
            height: FOCUS_BOX_SIZE,
          },
        ]}
        pointerEvents="box-none"
      >
        {/* Top Control Header above Focus Box */}
        <View style={styles.badgeWrapper} pointerEvents="box-none">
          {/* Active Hold-to-Lock Visual Feedback */}
          {isHolding && !isLocked && (
            <View style={styles.holdBanner}>
              <Text style={styles.holdBannerText}>HOLD TO LOCK</Text>
              <View style={styles.progressBarTrack}>
                <Animated.View style={[styles.progressBarFill, { width: holdProgressWidth }]} />
              </View>
            </View>
          )}

          {/* Locked Badge and Separate / Join Button */}
          {isLocked && (
            <View style={styles.pillRow} pointerEvents="box-none">
              <Pressable
                onPress={(e) => {
                  e.stopPropagation()
                  Haptics.selectionAsync()
                  onCycleLock()
                }}
                accessibilityRole="button"
                accessibilityLabel={`${lockLabel}, tap to cycle lock mode`}
                style={[styles.lockPill, { borderColor: lockColor }]}
              >
                <IconLock size={12} color={lockColor} strokeWidth={2.2} />
                <Text style={[styles.lockPillText, { color: lockColor }]}>
                  {isSeparated ? 'AF LOCK' : lockLabel}
                </Text>
              </Pressable>

              {/* Separate / Join Exposure Box toggle */}
              <Pressable
                onPress={(e) => {
                  e.stopPropagation()
                  Haptics.selectionAsync()
                  onToggleSeparate()
                }}
                accessibilityRole="button"
                accessibilityLabel={isSeparated ? 'Join Exposure to Focus' : 'Separate Exposure Box'}
                style={styles.separateBtn}
              >
                <Text style={styles.separateBtnText}>{isSeparated ? 'JOIN AE' : 'SEP AE'}</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* Reticle Focus Square */}
        <Animated.View
          style={[
            styles.reticleBox,
            {
              width: FOCUS_BOX_SIZE,
              height: FOCUS_BOX_SIZE,
              borderColor: isLocked ? lockColor : colors.accentSoft,
              borderWidth: isLocked ? 1.5 : 1,
              transform: isHolding && !isLocked ? [{ scale: holdScale }] : [],
            },
          ]}
        >
          {/* Corner Brackets */}
          <View style={[styles.corner, styles.topLeft, { borderColor: isLocked ? lockColor : colors.accentSoft }]} />
          <View style={[styles.corner, styles.topRight, { borderColor: isLocked ? lockColor : colors.accentSoft }]} />
          <View style={[styles.corner, styles.bottomLeft, { borderColor: isLocked ? lockColor : colors.accentSoft }]} />
          <View style={[styles.corner, styles.bottomRight, { borderColor: isLocked ? lockColor : colors.accentSoft }]} />

          {/* Center Target Dot */}
          <View
            style={[
              styles.centerDot,
              { backgroundColor: isLocked ? lockColor : colors.accentSoft },
            ]}
          />
        </Animated.View>
      </View>

      {/* ============================================================== */}
      {/* 2. EXPOSURE BOX (Target coordinate for Spot Metering / EV bias)*/}
      {/* ============================================================== */}
      {/* Rendered either separated or alongside the focus box */}
      {(isSeparated || !isSeparated) && (
        <View
          style={[
            styles.boxContainer,
            {
              left: isSeparated ? expLeft : focusLeft,
              top: isSeparated ? expTop : focusTop,
              width: isSeparated ? EXP_BOX_SIZE : FOCUS_BOX_SIZE,
              height: isSeparated ? EXP_BOX_SIZE : FOCUS_BOX_SIZE,
            },
          ]}
          pointerEvents="box-none"
        >
          {/* Separated Exposure Reticle (Circle with Sun Icon) */}
          {isSeparated && (
            <View {...expPanResponder.panHandlers} style={styles.expCircleWrapper}>
              <View style={styles.expPillBadge}>
                <Text style={styles.expPillText}>☀️ AE LOCK</Text>
              </View>

              <View style={styles.expCircle}>
                <IconSun size={20} color="#FFA726" strokeWidth={1.8} />
              </View>
            </View>
          )}

          {/* EV Vertical Slider Track attached to Exposure Reticle */}
          <View
            style={[
              styles.sliderTrackContainer,
              {
                left: (isSeparated ? EXP_BOX_SIZE : FOCUS_BOX_SIZE) + 8,
                top: ((isSeparated ? EXP_BOX_SIZE : FOCUS_BOX_SIZE) - SLIDER_HEIGHT) / 2,
              },
            ]}
            pointerEvents="box-none"
          >
            {/* Guide Rail */}
            <View style={styles.verticalRail} />
            <View style={styles.zeroTick} />

            {/* Draggable Sun Knob */}
            <View
              {...evPanResponder.panHandlers}
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
                <IconSun size={17} color={ev !== 0 ? colors.accent : '#FFF'} strokeWidth={1.8} />
              </Pressable>

              {/* EV Readout Badge */}
              {Math.abs(ev) > 0.05 && (
                <View style={styles.evBadge}>
                  <Text style={styles.evBadgeText}>
                    {ev > 0 ? `+${ev.toFixed(1)}` : ev.toFixed(1)}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>
      )}
    </Animated.View>
  )
}

const CORNER_LEN = 11
const CORNER_WIDTH = 2

const styles = StyleSheet.create({
  boxContainer: {
    position: 'absolute',
  },
  badgeWrapper: {
    position: 'absolute',
    top: -36,
    left: -40,
    right: -40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  holdBanner: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 15, 18, 0.9)',
    borderWidth: 1,
    borderColor: colors.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  holdBannerText: {
    fontFamily: fonts.monoBold,
    fontSize: 9,
    color: colors.accentSoft,
    letterSpacing: 0.8,
  },
  progressBarTrack: {
    width: 64,
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 2,
    marginTop: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.accentSoft,
  },
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  lockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 3.5,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(14, 14, 18, 0.92)',
    borderWidth: 1.2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
  },
  lockPillText: {
    fontFamily: fonts.monoBold,
    fontSize: 9.5,
    letterSpacing: 0.6,
  },
  separateBtn: {
    paddingVertical: 3.5,
    paddingHorizontal: 7,
    borderRadius: 12,
    backgroundColor: 'rgba(25, 25, 32, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  separateBtnText: {
    fontFamily: fonts.monoBold,
    fontSize: 8.5,
    color: '#EEE',
    letterSpacing: 0.5,
  },
  reticleBox: {
    borderRadius: 8,
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
    borderTopLeftRadius: 5,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderTopRightRadius: 5,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderBottomLeftRadius: 5,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderBottomRightRadius: 5,
  },
  centerDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    opacity: 0.85,
  },
  expCircleWrapper: {
    width: EXP_BOX_SIZE,
    height: EXP_BOX_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expPillBadge: {
    position: 'absolute',
    top: -24,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: 'rgba(14, 14, 18, 0.92)',
    borderWidth: 1,
    borderColor: '#FFA726',
  },
  expPillText: {
    fontFamily: fonts.monoBold,
    fontSize: 8.5,
    color: '#FFA726',
    letterSpacing: 0.5,
  },
  expCircle: {
    width: EXP_BOX_SIZE,
    height: EXP_BOX_SIZE,
    borderRadius: EXP_BOX_SIZE / 2,
    borderWidth: 1.5,
    borderColor: '#FFA726',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 167, 38, 0.08)',
  },
  sliderTrackContainer: {
    position: 'absolute',
    width: 34,
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
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
  },
  sunKnobWrapper: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sunKnob: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(18, 18, 22, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  evBadge: {
    position: 'absolute',
    left: 34,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: 'rgba(18, 18, 22, 0.92)',
    borderWidth: 1,
    borderColor: colors.accent,
  },
  evBadgeText: {
    fontFamily: fonts.monoBold,
    fontSize: 9.5,
    color: colors.accentSoft,
  },
})
