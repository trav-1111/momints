// ============================================================================
// DIAGNOSTIC SPIKE — Camera2 RAW Bayer & Adobe DNG Capture Test.
// Deep link: adb shell am start -d "momints://spike-camera-raw" -a android.intent.action.VIEW com.momints.app
// ============================================================================
import { useState, useEffect } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, Image } from 'react-native'
import { isRawSupported, getRawSensorInfo, captureRawDng, type RawSensorInfo, type RawCaptureResult } from '../../modules/camera-raw'

export default function CameraRawSpike() {
  const [supported, setSupported] = useState<boolean | null>(null)
  const [sensorInfo, setSensorInfo] = useState<RawSensorInfo | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [result, setResult] = useState<RawCaptureResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])

  const addLog = (msg: string) => {
    console.log('[CameraRawSpike]', msg)
    setLogs((prev) => [msg, ...prev].slice(0, 20))
  }

  useEffect(() => {
    try {
      addLog('Probing Camera2 RAW capability on Camera 0...')
      const isSupp = isRawSupported('0')
      setSupported(isSupp)
      addLog(`isRawSupported('0') => ${isSupp}`)

      const info = getRawSensorInfo('0')
      setSensorInfo(info)
      if (info) {
        addLog(`Sensor: ${info.width}x${info.height}, CFA=${info.cfaPatternName}, WhiteLevel=${info.whiteLevel}`)
      }
    } catch (e: any) {
      setError(e.message)
      addLog(`Error during probe: ${e.message}`)
    }
  }, [])

  const handleCapture = async () => {
    if (capturing) return
    setCapturing(true)
    setError(null)
    addLog('Initiating Camera2 RAW DNG capture...')
    try {
      const res = await captureRawDng({
        cameraId: '0',
        includeJpeg: true,
      })
      setResult(res)
      addLog(`SUCCESS! Captured RAW DNG (${(res.dngByteLength / 1024 / 1024).toFixed(2)} MB)`)
      if (res.jpegByteLength) {
        addLog(`Captured simultaneous JPEG (${(res.jpegByteLength / 1024 / 1024).toFixed(2)} MB)`)
      }
    } catch (e: any) {
      setError(e.message)
      addLog(`Capture failed: ${e.message}`)
    } finally {
      setCapturing(false)
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.header}>Camera2 RAW Probe</Text>
      <Text style={styles.subHeader}>Solana Seeker Hardware Verification</Text>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Hardware Capability</Text>
        <Text style={styles.row}>
          RAW Supported:{' '}
          <Text style={[styles.bold, { color: supported ? '#4ade80' : '#f87171' }]}>
            {supported === null ? 'Checking...' : supported ? 'YES (RAW_SENSOR available)' : 'NO'}
          </Text>
        </Text>
        {sensorInfo && (
          <>
            <Text style={styles.row}>Resolution: {sensorInfo.width} × {sensorInfo.height} (12 MP)</Text>
            <Text style={styles.row}>Bayer Pattern: {sensorInfo.cfaPatternName} ({sensorInfo.cfaPattern})</Text>
            <Text style={styles.row}>White Level: {sensorInfo.whiteLevel}</Text>
            <Text style={styles.row}>Black Level: [{sensorInfo.blackLevel.join(', ')}]</Text>
            <Text style={styles.row}>OIS Supported: {sensorInfo.hasOis ? 'YES' : 'NO'}</Text>
            <Text style={styles.row}>ISO Range: {sensorInfo.isoRange.min} – {sensorInfo.isoRange.max}</Text>
          </>
        )}
      </View>

      <Pressable
        onPress={handleCapture}
        disabled={capturing || !supported}
        style={[styles.button, (!supported || capturing) && styles.buttonDisabled]}
      >
        {capturing ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Capture RAW DNG + JPEG</Text>
        )}
      </Pressable>

      {error && (
        <View style={[styles.card, styles.errorCard]}>
          <Text style={styles.errorText}>Error: {error}</Text>
        </View>
      )}

      {result && (
        <View style={[styles.card, styles.successCard]}>
          <Text style={styles.sectionTitle}>Capture Result</Text>
          <Text style={styles.row}>DNG File: {result.dngPath.split('/').pop()}</Text>
          <Text style={styles.row}>DNG Size: {(result.dngByteLength / 1024 / 1024).toFixed(2)} MB</Text>
          {result.jpegPath && (
            <>
              <Text style={styles.row}>JPEG File: {result.jpegPath.split('/').pop()}</Text>
              <Text style={styles.row}>JPEG Size: {((result.jpegByteLength || 0) / 1024 / 1024).toFixed(2)} MB</Text>
              {result.jpegUri && (
                <Image source={{ uri: result.jpegUri }} style={styles.previewImage} resizeMode="cover" />
              )}
            </>
          )}
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Diagnostic Log</Text>
        {logs.map((log, i) => (
          <Text key={i} style={styles.logText}>› {log}</Text>
        ))}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#090a0f' },
  content: { padding: 20, paddingTop: 60, paddingBottom: 60 },
  header: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  subHeader: { fontSize: 14, color: '#94a3b8', marginBottom: 20 },
  card: { backgroundColor: '#13151f', borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#232736' },
  errorCard: { borderColor: '#ef4444', backgroundColor: '#2d1515' },
  successCard: { borderColor: '#22c55e', backgroundColor: '#14291c' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 12 },
  row: { fontSize: 13, color: '#cbd5e1', marginBottom: 6, fontFamily: 'monospace' },
  bold: { fontWeight: 'bold' },
  button: { backgroundColor: '#6366f1', paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginBottom: 16 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  errorText: { color: '#fca5a5', fontSize: 13, fontFamily: 'monospace' },
  logText: { color: '#94a3b8', fontSize: 11, fontFamily: 'monospace', marginBottom: 4 },
  previewImage: { width: '100%', height: 200, borderRadius: 12, marginTop: 12 },
})
