import { useState, useCallback, useRef } from 'react'
import { View, Text, ScrollView } from 'react-native'
import { useRouter } from 'expo-router'
import { Button } from '../../components/Button'
import { runIrysSpike, type SpikeEvent } from '../../services/irysSpike'
import { colors, fonts, tracking } from '../../theme'

/**
 * Dev-only harness for the Irys storage spike (Phase 0 of the Arweave
 * migration). Devnet-only, throwaway keypair — safe to run repeatedly.
 */
export default function IrysSpikeScreen() {
  const router = useRouter()
  const [events, setEvents] = useState<SpikeEvent[]>([])
  const [running, setRunning] = useState(false)
  const scrollRef = useRef<ScrollView>(null)

  const run = useCallback(async () => {
    if (running) return
    setRunning(true)
    setEvents([])
    await runIrysSpike((e) => {
      setEvents((prev) => [...prev, e])
      scrollRef.current?.scrollToEnd({ animated: true })
    })
    setRunning(false)
  }, [running])

  if (!__DEV__) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: fonts.mono, fontSize: 12, color: colors.textMuted }}>Dev builds only</Text>
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingHorizontal: 22, paddingTop: 52 }}>
      <Text
        style={{
          fontFamily: fonts.mono,
          fontSize: 11,
          letterSpacing: tracking(0.24, 11),
          color: colors.yellow,
          marginBottom: 10,
        }}
      >
        DEV · DEVNET ONLY
      </Text>
      <Text
        style={{
          fontFamily: fonts.sansBold,
          fontSize: 26,
          letterSpacing: tracking(-0.02, 26),
          color: colors.text,
          marginBottom: 4,
        }}
      >
        Irys storage spike
      </Text>
      <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.textSecondary, marginBottom: 18 }}>
        Throwaway keypair → airdrop → fund → upload → gateway fetch. Nothing touches your wallet.
      </Text>

      <ScrollView
        ref={scrollRef}
        style={{
          flex: 1,
          borderRadius: 12,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
        }}
        contentContainerStyle={{ padding: 14 }}
      >
        {events.length === 0 && !running && (
          <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.textMuted }}>
            Output will appear here.
          </Text>
        )}
        {events.map((e, i) => (
          <Text
            key={i}
            selectable
            style={{
              fontFamily: fonts.mono,
              fontSize: 10.5,
              lineHeight: 16,
              marginBottom: 6,
              color:
                e.kind === 'ok'
                  ? colors.greenSoft
                  : e.kind === 'err'
                    ? colors.redSoft
                    : e.kind === 'warn'
                      ? colors.yellow
                      : colors.textSoft,
            }}
          >
            {e.kind === 'ok' ? '✓ ' : e.kind === 'err' ? '✗ ' : e.kind === 'warn' ? '⚠ ' : '· '}
            {e.text}
          </Text>
        ))}
      </ScrollView>

      <View style={{ paddingVertical: 16, gap: 10 }}>
        <Button title={running ? 'Running…' : 'Run spike'} onPress={run} loading={running} />
        <Button title="Back" variant="secondary" onPress={() => router.back()} />
      </View>
    </View>
  )
}
