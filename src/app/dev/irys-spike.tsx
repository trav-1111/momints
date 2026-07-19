import { useState, useCallback, useEffect, useRef } from 'react'
import { View, Text, ScrollView, Pressable } from 'react-native'
import { useRouter } from 'expo-router'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import type { Umi } from '@metaplex-foundation/umi'
import { Button } from '../../components/Button'
import { runIrysSpike, type SpikeEvent } from '../../services/irysSpike'
import { getStoragePayerAddress, getStoragePayerLamports, requestDevnetAirdrop } from '../../services/storagePayer'
import { getClusterRpc } from '../../store/network'
import { formatSol } from '../../config/roll'
import { colors, fonts, tracking } from '../../theme'

/**
 * Dev-only harness for the Irys storage spike and the storage payer
 * (Phases 0–1 of the Arweave migration). Devnet-only.
 */

function MiniButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        paddingVertical: 7,
        paddingHorizontal: 14,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text style={{ fontFamily: fonts.mono, fontSize: 10.5, color: colors.textSoft }}>{label}</Text>
    </Pressable>
  )
}

export default function IrysSpikeScreen() {
  const router = useRouter()
  const [events, setEvents] = useState<SpikeEvent[]>([])
  const [running, setRunning] = useState(false)
  const [payerAddress, setPayerAddress] = useState<string | null>(null)
  const [payerLamports, setPayerLamports] = useState<bigint | null>(null)
  const [payerBusy, setPayerBusy] = useState(false)
  const scrollRef = useRef<ScrollView>(null)
  // One lightweight devnet umi for payer info — no uploader plugin needed.
  const umiRef = useRef<Umi | null>(null)
  const getUmi = useCallback(() => {
    if (!umiRef.current) umiRef.current = createUmi(getClusterRpc('devnet'))
    return umiRef.current
  }, [])

  const refreshPayer = useCallback(async () => {
    setPayerBusy(true)
    try {
      const umi = getUmi()
      setPayerAddress(await getStoragePayerAddress(umi))
      setPayerLamports(await getStoragePayerLamports(umi))
    } catch {
      // RPC hiccup — leave last known values
    } finally {
      setPayerBusy(false)
    }
  }, [getUmi])

  useEffect(() => {
    refreshPayer()
  }, [refreshPayer])

  const airdrop = useCallback(async () => {
    setPayerBusy(true)
    try {
      const result = await requestDevnetAirdrop(getUmi())
      setPayerLamports(result.lamports)
      setEvents((prev) => [
        ...prev,
        result.outcome === 'landed'
          ? { text: `Airdrop landed: ${result.lamports} lamports`, kind: 'ok' as const }
          : {
              text:
                result.outcome === 'pending'
                  ? 'Airdrop requested but not credited within 30s'
                  : `Airdrop failed: ${result.error} — fund the payer at faucet.solana.com instead`,
              kind: 'warn' as const,
            },
      ])
    } finally {
      setPayerBusy(false)
    }
  }, [getUmi])

  const run = useCallback(async () => {
    if (running) return
    setRunning(true)
    setEvents([])
    await runIrysSpike((e) => {
      setEvents((prev) => [...prev, e])
      scrollRef.current?.scrollToEnd({ animated: true })
    })
    setRunning(false)
    refreshPayer()
  }, [running, refreshPayer])

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
      <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.textSecondary, marginBottom: 14 }}>
        Storage payer → free upload → funded upload → gateway fetch. Nothing touches your wallet.
      </Text>

      {/* Storage payer panel */}
      <View
        style={{
          borderRadius: 12,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          padding: 14,
          marginBottom: 12,
        }}
      >
        <Text
          style={{
            fontFamily: fonts.mono,
            fontSize: 10,
            letterSpacing: tracking(0.16, 10),
            color: colors.textMuted,
            marginBottom: 7,
          }}
        >
          STORAGE PAYER · SECURE STORE
        </Text>
        <Text selectable style={{ fontFamily: fonts.mono, fontSize: 10.5, color: colors.textSoft, marginBottom: 9 }}>
          {payerAddress ?? 'loading…'}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ flex: 1, fontFamily: fonts.monoBold, fontSize: 12, color: colors.accentSoft }}>
            {payerLamports === null ? '…' : formatSol(Number(payerLamports))}
          </Text>
          <MiniButton label="REFRESH" onPress={refreshPayer} disabled={payerBusy} />
          <MiniButton label="AIRDROP" onPress={airdrop} disabled={payerBusy} />
        </View>
      </View>

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
