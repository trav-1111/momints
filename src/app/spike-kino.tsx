// ============================================================================
// DIAGNOSTIC SPIKE — LomoKino Mechanical Shutter & Burst Reel Simulator.
// Deep link: adb shell am start -d "momints://spike-kino" -a android.intent.action.VIEW com.momints.app
//
// Mounts the real Kino settings store, tests rotary shutter blade timing,
// simulates cranking cadence (3, 5, 8 FPS), and audits blackout guarantees
// without needing to open the full camera viewfinder.
// ============================================================================
import { useState, useEffect, useRef } from 'react'
import { View, Text, Pressable, StyleSheet, Animated, Vibration, ScrollView } from 'react-native'
import {
  useKinoSettingsStore,
  KINO_CAPTURE_SPEEDS,
  KINO_PLAYBACK_SPEEDS,
  KINO_SHUTTER_GAPS,
  KINO_SHUTTER_GAP_LABELS,
  getShutterBlackoutMs,
  CAPTURE_CADENCE_MS,
  type KinoCaptureSpeed,
  type KinoPlaybackSpeed,
  type KinoShutterGap,
} from '../features/kino'
import { KinoBanners } from '../features/kino'
import { colors, fonts } from '../theme'

export default function SpikeKino() {
  const {
    captureFps,
    playbackFps,
    shutterGap,
    setCaptureFps,
    setPlaybackFps,
    setShutterGap,
  } = useKinoSettingsStore()

  const [simulatedCranking, setSimulatedCranking] = useState(false)
  const [crankCount, setCrankCount] = useState(0)
  const [simulatedDeveloping, setSimulatedDeveloping] = useState<number | null>(null)
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0)

  const rotaryAnim = useRef(new Animated.Value(0)).current
  const crankIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const playbackIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Rotary Blade Rotation Animation
  useEffect(() => {
    if (simulatedCranking) {
      const period = CAPTURE_CADENCE_MS[captureFps] ?? 200
      const loop = Animated.loop(
        Animated.timing(rotaryAnim, {
          toValue: 1,
          duration: period,
          useNativeDriver: true,
        }),
      )
      loop.start()
      return () => loop.stop()
    } else {
      rotaryAnim.setValue(0)
    }
  }, [simulatedCranking, captureFps, rotaryAnim])

  // Playback Simulation Loop
  useEffect(() => {
    const period = 1000 / playbackFps
    playbackIntervalRef.current = setInterval(() => {
      setCurrentFrameIndex((prev) => (prev + 1) % 12)
    }, period)

    return () => {
      if (playbackIntervalRef.current) clearInterval(playbackIntervalRef.current)
    }
  }, [playbackFps])

  // Simulated Cranking Action
  const handleStartCranking = () => {
    setSimulatedCranking(true)
    setCrankCount(0)
    Vibration.vibrate(30)

    const interval = CAPTURE_CADENCE_MS[captureFps] ?? 200
    crankIntervalRef.current = setInterval(() => {
      setCrankCount((c) => {
        const next = c + 1
        Vibration.vibrate(15)
        if (next >= 16) {
          // Auto-stop after 16 frames
          handleStopCranking(next)
        }
        return next
      })
    }, interval)
  }

  const handleStopCranking = (finalCount?: number) => {
    if (crankIntervalRef.current) clearInterval(crankIntervalRef.current)
    setSimulatedCranking(false)
    const count = finalCount ?? crankCount
    if (count > 0) {
      setSimulatedDeveloping(count)
      setTimeout(() => {
        setSimulatedDeveloping(null)
      }, 2000)
    }
  }

  const spin = rotaryAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  })

  const blackoutMs = getShutterBlackoutMs(shutterGap, playbackFps)
  const framePeriodMs = Math.round(1000 / playbackFps)

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>🎞️ LOMOKINO TEST SPIKE</Text>
      <Text style={styles.subtitle}>Rotary Blade Shutter & Burst Reel Auditor</Text>

      {/* Rotary Shutter Visualizer */}
      <View style={styles.visualizerCard}>
        <Text style={styles.cardHeader}>ROTARY SHUTTER SIMULATOR</Text>
        <View style={styles.bladeContainer}>
          <Animated.View style={[styles.bladeDisc, { transform: [{ rotate: spin }] }]}>
            <View style={styles.bladeCutout} />
          </Animated.View>
          <View style={styles.apertureWindow}>
            <Text style={styles.frameCounterText}>FRAME {currentFrameIndex + 1}</Text>
          </View>
        </View>

        <View style={styles.telemetryRow}>
          <Text style={styles.telemetryText}>
            FRAME PERIOD: <Text style={styles.telemetryValue}>{framePeriodMs}ms</Text>
          </Text>
          <Text style={styles.telemetryText}>
            BLACKOUT: <Text style={styles.telemetryValue}>{blackoutMs}ms</Text>
          </Text>
        </View>
      </View>

      {/* Cranking Control */}
      <View style={styles.controlCard}>
        <Text style={styles.cardHeader}>BURST CRANK TRIGGER</Text>
        <Pressable
          onPressIn={handleStartCranking}
          onPressOut={() => handleStopCranking()}
          style={({ pressed }) => [styles.crankButton, pressed && styles.crankButtonPressed]}
        >
          <Text style={styles.crankButtonText}>
            {simulatedCranking ? `CRANKING (${crankCount} FRAMES)...` : 'HOLD TO CRANK BURST'}
          </Text>
        </Pressable>
      </View>

      {/* Capture Cadence Selector */}
      <View style={styles.controlCard}>
        <Text style={styles.cardHeader}>CAPTURE CADENCE (MOTOR DRIVE)</Text>
        <View style={styles.chipRow}>
          {KINO_CAPTURE_SPEEDS.map((fps) => (
            <Pressable
              key={fps}
              onPress={() => setCaptureFps(fps)}
              style={[styles.chip, captureFps === fps && styles.chipActive]}
            >
              <Text style={[styles.chipText, captureFps === fps && styles.chipTextActive]}>
                {fps === 8 ? '8 FPS · F5' : `${fps} FPS`}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Playback FPS Selector */}
      <View style={styles.controlCard}>
        <Text style={styles.cardHeader}>PLAYBACK VELOCITY</Text>
        <View style={styles.chipRow}>
          {KINO_PLAYBACK_SPEEDS.map((fps) => (
            <Pressable
              key={fps}
              onPress={() => setPlaybackFps(fps)}
              style={[styles.chip, playbackFps === fps && styles.chipActive]}
            >
              <Text style={[styles.chipText, playbackFps === fps && styles.chipTextActive]}>
                {fps} FPS
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Mechanical Rotary Shutter Gap */}
      <View style={styles.controlCard}>
        <Text style={styles.cardHeader}>MECHANICAL SHUTTER GAP</Text>
        <View style={styles.chipRow}>
          {KINO_SHUTTER_GAPS.map((gap) => (
            <Pressable
              key={gap}
              onPress={() => setShutterGap(gap)}
              style={[styles.chip, shutterGap === gap && styles.chipActive]}
            >
              <Text style={[styles.chipText, shutterGap === gap && styles.chipTextActive]}>
                {KINO_SHUTTER_GAP_LABELS[gap]}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Banners Preview */}
      <KinoBanners
        isCranking={simulatedCranking}
        crankCount={crankCount}
        captureFps={captureFps}
        kinoDevelopingCount={simulatedDeveloping}
      />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0c',
  },
  content: {
    padding: 24,
    paddingTop: 56,
    paddingBottom: 220,
    gap: 16,
  },
  title: {
    fontFamily: fonts.monoBold,
    fontSize: 20,
    color: '#fff',
    letterSpacing: 1.2,
  },
  subtitle: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: '#888',
    marginBottom: 8,
  },
  visualizerCard: {
    backgroundColor: '#121216',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#24242e',
    alignItems: 'center',
  },
  cardHeader: {
    fontFamily: fonts.monoBold,
    fontSize: 11,
    color: '#aaa',
    letterSpacing: 1,
    marginBottom: 16,
    alignSelf: 'flex-start',
  },
  bladeContainer: {
    width: 140,
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginVertical: 12,
  },
  bladeDisc: {
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 3,
    borderColor: '#f39c12',
    borderTopColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bladeCutout: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#f39c12',
  },
  apertureWindow: {
    position: 'absolute',
    width: 80,
    height: 60,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameCounterText: {
    fontFamily: fonts.monoBold,
    fontSize: 12,
    color: '#fff',
  },
  telemetryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1c1c24',
  },
  telemetryText: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: '#777',
  },
  telemetryValue: {
    color: colors.accent,
    fontFamily: fonts.monoBold,
  },
  controlCard: {
    backgroundColor: '#121216',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#24242e',
  },
  crankButton: {
    backgroundColor: '#27ae60',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  crankButtonPressed: {
    backgroundColor: '#219653',
    transform: [{ scale: 0.98 }],
  },
  crankButtonText: {
    fontFamily: fonts.monoBold,
    fontSize: 14,
    color: '#fff',
    letterSpacing: 0.8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#1a1a22',
    borderWidth: 1,
    borderColor: '#2c2c38',
  },
  chipActive: {
    backgroundColor: colors.accentTint,
    borderColor: colors.accent,
  },
  chipText: {
    fontFamily: fonts.sansBold,
    fontSize: 12,
    color: '#888',
  },
  chipTextActive: {
    color: colors.accentSoft,
  },
})
