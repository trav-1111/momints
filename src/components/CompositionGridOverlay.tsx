import { View, StyleSheet } from 'react-native'
import type { AspectRatio } from '../store/session'

export type GridMode = 'off' | '3x3' | 'cross'

interface Props {
  mode: GridMode
  aspect: AspectRatio
  width: number
  height: number
}

// Long : short for each croppable ratio (portrait orientation).
const RATIO: Record<Exclude<AspectRatio, 'full'>, number> = {
  '1:1': 1,
  '4:3': 4 / 3,
  '16:9': 16 / 9,
}

const LINE_COLOR = 'rgba(255, 255, 255, 0.28)'
const MARK_COLOR = 'rgba(255, 255, 255, 0.55)'

/**
 * Composition grid overlay for professional framing.
 * Supports:
 * - 'off': disabled
 * - '3x3': Classic Rule-of-Thirds grid with subtle intersection marks
 * - 'cross': 3x3 grid plus center precision crosshair
 */
export function CompositionGridOverlay({ mode, aspect, width, height }: Props) {
  if (mode === 'off' || width === 0 || height === 0) return null

  let boxW = width
  let boxH = height

  if (aspect !== 'full') {
    const r = RATIO[aspect]
    boxH = width * r
    if (boxH > height) {
      boxH = height
      boxW = height / r
    }
  }

  const vBar = Math.max(0, (height - boxH) / 2) // top & bottom margin
  const hBar = Math.max(0, (width - boxW) / 2) // left & right margin

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: vBar,
        left: hBar,
        width: boxW,
        height: boxH,
      }}
    >
      {/* Horizontal Rule of Thirds lines */}
      <View style={[styles.hLine, { top: '33.33%' }]} />
      <View style={[styles.hLine, { top: '66.67%' }]} />

      {/* Vertical Rule of Thirds lines */}
      <View style={[styles.vLine, { left: '33.33%' }]} />
      <View style={[styles.vLine, { left: '66.67%' }]} />

      {/* Intersection power points */}
      <IntersectionTick xPercent={33.33} yPercent={33.33} />
      <IntersectionTick xPercent={66.67} yPercent={33.33} />
      <IntersectionTick xPercent={33.33} yPercent={66.67} />
      <IntersectionTick xPercent={66.67} yPercent={66.67} />

      {/* Center precision crosshair if requested */}
      {mode === 'cross' && (
        <View
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: 20,
            height: 20,
            transform: [{ translateX: -10 }, { translateY: -10 }],
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Horizontal crosshair ticks */}
          <View style={[styles.crossTick, { left: 0, top: 9.5, width: 6, height: 1 }]} />
          <View style={[styles.crossTick, { right: 0, top: 9.5, width: 6, height: 1 }]} />
          {/* Vertical crosshair ticks */}
          <View style={[styles.crossTick, { top: 0, left: 9.5, width: 1, height: 6 }]} />
          <View style={[styles.crossTick, { bottom: 0, left: 9.5, width: 1, height: 6 }]} />
          {/* Center pinpoint ring */}
          <View
            style={{
              width: 4,
              height: 4,
              borderRadius: 2,
              borderWidth: 1,
              borderColor: MARK_COLOR,
            }}
          />
        </View>
      )}
    </View>
  )
}

function IntersectionTick({ xPercent, yPercent }: { xPercent: number; yPercent: number }) {
  return (
    <View
      style={{
        position: 'absolute',
        left: `${xPercent}%`,
        top: `${yPercent}%`,
        width: 8,
        height: 8,
        transform: [{ translateX: -4 }, { translateY: -4 }],
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View style={{ position: 'absolute', width: 8, height: 1, backgroundColor: MARK_COLOR }} />
      <View style={{ position: 'absolute', width: 1, height: 8, backgroundColor: MARK_COLOR }} />
    </View>
  )
}

const styles = StyleSheet.create({
  hLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: LINE_COLOR,
  },
  vLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: LINE_COLOR,
  },
  crossTick: {
    position: 'absolute',
    backgroundColor: MARK_COLOR,
  },
})
