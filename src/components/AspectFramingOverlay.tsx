import { View } from 'react-native'
import type { AspectRatio } from '../store/session'

interface Props {
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

const MASK = 'rgba(0,0,0,0.55)'
const BAR = { position: 'absolute' as const, backgroundColor: MASK }

/**
 * Letterbox framing guide over a full-screen camera preview: darkens the area
 * outside the crop the current aspect ratio will keep. Purely a framing aid —
 * pointer events pass through to the camera.
 */
export function AspectFramingOverlay({ aspect, width, height }: Props) {
  if (aspect === 'full' || width === 0 || height === 0) return null

  const r = RATIO[aspect]
  // Fit the crop box within the screen, keeping full width when possible.
  let boxW = width
  let boxH = width * r
  if (boxH > height) {
    boxH = height
    boxW = height / r
  }

  const vBar = Math.max(0, (height - boxH) / 2) // top & bottom
  const hBar = Math.max(0, (width - boxW) / 2) // left & right

  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, width, height }}>
      {vBar > 0 && (
        <>
          <View style={[BAR, { top: 0, left: 0, right: 0, height: vBar }]} />
          <View style={[BAR, { bottom: 0, left: 0, right: 0, height: vBar }]} />
        </>
      )}
      {hBar > 0 && (
        <>
          <View style={[BAR, { top: 0, left: 0, bottom: 0, width: hBar }]} />
          <View style={[BAR, { top: 0, right: 0, bottom: 0, width: hBar }]} />
        </>
      )}
    </View>
  )
}
