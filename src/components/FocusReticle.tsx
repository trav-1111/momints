import React, { useRef, useMemo } from 'react'
import { View, Text, Pressable, Animated, StyleSheet, PanResponder } from 'react-native'
import Svg, { Line } from 'react-native-svg'
import * as Haptics from 'expo-haptics'
import { colors, fonts } from '../theme'
import { IconSun } from './icons'
import type { CameraLockMode } from '../hooks/useManualCameraState'

interface Props {
  focusPoint: { x: number; y: number } | null
  exposurePoint: { x: number; y: number } | null
  isSeparated: boolean
  isAePlaced?: boolean
  lockMode: CameraLockMode
  isHolding: boolean
  holdProgress: Animated.Value
  ev: number
  minExposure?: number
  maxExposure?: number
  onEvChange: (newEv: number) => void
  onCycleLock?: () => void
  onToggleSeparate?: () => void
  onUnlock?: () => void
  onFocusPointChange?: (point: { x: number; y: number }) => void
  onExposurePointChange?: (point: { x: number; y: number }) => void
  opacity: Animated.Value
  screenW: number
  screenH: number
  uiRotationAnim?: Animated.Value
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
  isAePlaced = true,
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
  uiRotationAnim,
}: Props) {
  const safeFocusPoint = focusPoint ?? { x: 0, y: 0 }
  const isLocked = lockMode !== 'none'
  const expPoint = isSeparated && exposurePoint ? exposurePoint : safeFocusPoint

  // Focus box clamp coordinates
  const focusLeft = Math.max(12, Math.min(screenW - FOCUS_BOX_SIZE - 12, safeFocusPoint.x - HALF_FOCUS))
  const focusTop = Math.max(76, Math.min(screenH - FOCUS_BOX_SIZE - 180, safeFocusPoint.y - HALF_FOCUS))

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

  // Stable refs for Exposure Box PanResponder to prevent tear-down mid-drag
  const expPointRef = useRef(expPoint)
  expPointRef.current = expPoint
  const onExposurePointChangeRef = useRef(onExposurePointChange)
  onExposurePointChangeRef.current = onExposurePointChange
  const expStartXRef = useRef(0)
  const expStartYRef = useRef(0)
  const screenWRef = useRef(screenW)
  screenWRef.current = screenW
  const screenHRef = useRef(screenH)
  screenHRef.current = screenH

  const expPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 1 || Math.abs(gestureState.dy) > 1
      },
      onPanResponderGrant: () => {
        expStartXRef.current = expPointRef.current.x
        expStartYRef.current = expPointRef.current.y
        Haptics.selectionAsync()
      },
      onPanResponderMove: (_, gestureState) => {
        if (onExposurePointChangeRef.current) {
          const newX = Math.max(20, Math.min(screenWRef.current - 20, expStartXRef.current + gestureState.dx))
          const newY = Math.max(80, Math.min(screenHRef.current - 180, expStartYRef.current + gestureState.dy))
          onExposurePointChangeRef.current({ x: newX, y: newY })
        }
      },
      onPanResponderRelease: () => {
        Haptics.selectionAsync()
      },
    }),
  ).current

  // Stable refs for EV Adjustment PanResponder
  const lastEvRef = useRef(ev)
  lastEvRef.current = ev
  const evStartRef = useRef(ev)
  const onEvChangeRef = useRef(onEvChange)
  onEvChangeRef.current = onEvChange
  const minExposureRef = useRef(minExposure)
  minExposureRef.current = minExposure
  const maxExposureRef = useRef(maxExposure)
  maxExposureRef.current = maxExposure

  const evPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dy) > 3
      },
      onPanResponderGrant: () => {
        evStartRef.current = lastEvRef.current
        Haptics.selectionAsync()
      },
      onPanResponderMove: (_, gestureState) => {
        // Comfortable calibration: 20 pixels of vertical drag equals 1.0 EV stop.
        // Full +2.0 EV to -2.0 EV travel spans 80 pixels (~0.5 inches of natural thumb flick).
        const PIXELS_PER_EV = 20
        const deltaEv = -gestureState.dy / PIXELS_PER_EV
        let targetEv = evStartRef.current + deltaEv
        targetEv = Math.max(minExposureRef.current, Math.min(maxExposureRef.current, targetEv))
        const roundedEv = Math.round(targetEv * 10) / 10
        if (roundedEv !== lastEvRef.current) {
          lastEvRef.current = roundedEv
          onEvChangeRef.current(roundedEv)
          Haptics.selectionAsync()
        }
      },
      onPanResponderRelease: () => {
        Haptics.selectionAsync()
      },
    }),
  ).current

  // Map current EV to vertical knob offset
  const knobTravel = Math.max(
    -MAX_TRAVEL,
    Math.min(MAX_TRAVEL, -(ev / ((maxExposure - minExposure) / 2 || 1)) * MAX_TRAVEL),
  )

  // Hold-to-lock animated feedback: interpolations
  const holdScale = holdProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1.25, 0.95],
  })

  // Edge boundary checks:
  const currentExpBoxLeft = isSeparated ? expLeft : focusLeft
  const currentExpBoxSize = isSeparated ? EXP_BOX_SIZE : FOCUS_BOX_SIZE

  // 1. If reticle is near the right screen edge, place EV slider on the left of the box so it remains accessible.
  const isSliderOnLeft = currentExpBoxLeft + currentExpBoxSize + 48 > screenW
  const sliderLeft = isSliderOnLeft ? -44 : currentExpBoxSize + 8

  // Landscape mode UI rotation: rotate words and icons to reflect layout
  const uiRotationDeg = uiRotationAnim
    ? uiRotationAnim.interpolate({
        inputRange: [-360, 360],
        outputRange: ['-360deg', '360deg'],
      })
    : '0deg'
  const hudRotateStyle = { transform: [{ rotate: uiRotationDeg }] }

  if (!focusPoint) return null

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
          <View
            style={[styles.corner, styles.bottomRight, { borderColor: isLocked ? lockColor : colors.accentSoft }]}
          />

          {/* Center Target Dot */}
          <View style={[styles.centerDot, { backgroundColor: isLocked ? lockColor : colors.accentSoft }]} />
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
                left: sliderLeft,
                top: (currentExpBoxSize - SLIDER_HEIGHT) / 2,
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
                <Animated.View style={hudRotateStyle}>
                  <IconSun size={17} color={ev !== 0 ? colors.accent : '#FFF'} strokeWidth={1.8} />
                </Animated.View>
              </Pressable>

              {/* EV Readout Badge */}
              {Math.abs(ev) > 0.05 && (
                <Animated.View
                  style={[
                    styles.evBadge,
                    isSliderOnLeft ? { right: 36, left: undefined } : { left: 36 },
                    hudRotateStyle,
                  ]}
                >
                  <Text style={styles.evBadgeText} numberOfLines={1}>
                    {ev > 0 ? `+${ev.toFixed(1)}` : ev.toFixed(1)}
                  </Text>
                </Animated.View>
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
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: 'rgba(18, 18, 22, 0.92)',
    borderWidth: 1,
    borderColor: colors.accent,
    minWidth: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  evBadgeText: {
    fontFamily: fonts.monoBold,
    fontSize: 9.5,
    color: colors.accentSoft,
    textAlign: 'center',
  },
})
