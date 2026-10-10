import React, { useRef, useState, useMemo } from 'react'
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  PanResponder,
  type LayoutChangeEvent,
  type ViewStyle,
  type StyleProp,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import { colors, fonts } from '../theme'

export interface ZoomSliderProps {
  zoom: number
  minZoom?: number
  maxZoom?: number
  onZoomChange: (newZoom: number) => void
  style?: StyleProp<ViewStyle>
}

const DEFAULT_PRESETS = [1, 2, 3, 5, 8]

export function ZoomSlider({
  zoom,
  minZoom = 1,
  maxZoom = 8,
  onZoomChange,
  style,
}: ZoomSliderProps) {
  const [trackWidth, setTrackWidth] = useState(240)
  const trackRef = useRef<View>(null)
  const trackPageX = useRef(0)
  const lastHapticZoom = useRef(Math.round(zoom * 2))

  const presets = useMemo(() => {
    const list = DEFAULT_PRESETS.filter((p) => p >= minZoom && p <= maxZoom)
    if (!list.includes(minZoom)) list.unshift(minZoom)
    return list
  }, [minZoom, maxZoom])

  const safeRange = Math.max(0.1, maxZoom - minZoom)
  const progress = Math.max(0, Math.min(1, (zoom - minZoom) / safeRange))

  const updateFromPosition = (relativeX: number) => {
    const clampedX = Math.max(0, Math.min(trackWidth, relativeX))
    const ratio = clampedX / trackWidth
    const newZoom = minZoom + ratio * safeRange
    const rounded = Math.round(newZoom * 10) / 10

    const hapticKey = Math.round(rounded * 2)
    if (hapticKey !== lastHapticZoom.current) {
      lastHapticZoom.current = hapticKey
      Haptics.selectionAsync()
    }
    onZoomChange(rounded)
  }

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          updateFromPosition(evt.nativeEvent.locationX)
        },
        onPanResponderMove: (evt) => {
          // Calculate relative position inside the track
          const relativeX = evt.nativeEvent.pageX - trackPageX.current
          updateFromPosition(relativeX)
        },
      }),
    [trackWidth, minZoom, safeRange, onZoomChange],
  )

  const handleTrackLayout = (e: LayoutChangeEvent) => {
    const width = e.nativeEvent.layout.width
    if (width > 0) {
      setTrackWidth(width)
    }
    trackRef.current?.measure((_x, _y, _w, _h, pageX) => {
      if (typeof pageX === 'number') {
        trackPageX.current = pageX
      }
    })
  }

  return (
    <View style={[styles.container, style]}>
      {/* Top Row: Preset Buttons & Live Readout */}
      <View style={styles.topRow}>
        <View style={styles.presetsRow}>
          {presets.map((p) => {
            const isSelected = Math.abs(zoom - p) < 0.15
            return (
              <Pressable
                key={p}
                onPress={() => {
                  Haptics.selectionAsync()
                  onZoomChange(p)
                }}
                accessibilityRole="button"
                accessibilityLabel={`Zoom ${p}x`}
                style={[styles.presetChip, isSelected && styles.presetChipActive]}
              >
                <Text style={[styles.presetText, isSelected && styles.presetTextActive]}>
                  {p}×
                </Text>
              </Pressable>
            )
          })}
        </View>

        <View style={styles.readoutBadge}>
          <Text style={styles.readoutText}>{zoom.toFixed(1)}×</Text>
        </View>
      </View>

      {/* Bottom Row: Continuous Scrubbing Track */}
      <View
        ref={trackRef}
        onLayout={handleTrackLayout}
        {...panResponder.panHandlers}
        style={styles.trackContainer}
      >
        <View style={styles.railLine} />

        {/* Notched minor ticks */}
        <View style={styles.ticksContainer} pointerEvents="none">
          {Array.from({ length: 17 }).map((_, idx) => (
            <View
              key={idx}
              style={[
                styles.tickMark,
                idx % 4 === 0 ? styles.majorTickMark : styles.minorTickMark,
              ]}
            />
          ))}
        </View>

        {/* Draggable Scrubber Thumb */}
        <View
          pointerEvents="none"
          style={[
            styles.scrubberThumb,
            {
              left: `${progress * 100}%`,
            },
          ]}
        >
          <View style={styles.thumbCenter} />
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(8, 10, 18, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 6,
    gap: 8,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  presetsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  presetChip: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  presetChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  presetText: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.textSoft,
  },
  presetTextActive: {
    fontFamily: fonts.monoBold,
    color: '#000',
  },
  readoutBadge: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  readoutText: {
    fontFamily: fonts.monoBold,
    fontSize: 12,
    color: colors.accentSoft,
    letterSpacing: 0.5,
  },
  trackContainer: {
    height: 24,
    justifyContent: 'center',
    position: 'relative',
  },
  railLine: {
    height: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 1,
    width: '100%',
  },
  ticksContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tickMark: {
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
    width: 1.5,
  },
  minorTickMark: {
    height: 6,
  },
  majorTickMark: {
    height: 12,
    backgroundColor: colors.text,
  },
  scrubberThumb: {
    position: 'absolute',
    top: 2,
    width: 20,
    height: 20,
    marginLeft: -10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbCenter: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: '#FFF',
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 3,
  },
})
