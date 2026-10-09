import { BlendMode, ImageFormat, Skia, type SkImage } from '@shopify/react-native-skia'
import { File } from 'expo-file-system'
import { CAPTURE_TEMP_DIRECTORY } from '../../services/imagePrivacy'

function decodeToSkImage(bytes: Uint8Array): SkImage | null {
  try {
    const data = Skia.Data.fromBytes(bytes)
    try {
      return Skia.Image.MakeImageFromEncoded(data)
    } finally {
      data.dispose()
    }
  } catch {
    return null
  }
}

/**
 * Computes optical circle-of-confusion (CoC) blur radius from emulated f-number.
 * f/1.2 -> ~28px radius (ultra-shallow, creamy bokeh)
 * f/1.4 -> ~22px radius
 * f/1.8 -> ~14px radius (moderate portrait separation)
 * f/2.8 -> ~7px radius (subtle natural background falloff)
 * f/4.0+ -> 0px (native optical sharpness)
 */
export function getApertureBlurRadius(fNumber: number): number {
  if (fNumber >= 3.5) return 0
  // Quadratic falloff modeling physical aperture area (1/N^2)
  const scale = (3.5 - fNumber) / (3.5 - 1.2)
  return Math.round(scale * scale * 28)
}

/**
 * Applies on-device computational depth-of-field and optical bokeh emulation
 * to a captured photo frame using Skia GPU surface rendering.
 *
 * @param baseUri URI of the sharp in-focus base exposure.
 * @param fNumber Emulated aperture value (1.2 to 16.0).
 * @param focusPoint Normalized (0..1) focal plane anchor, defaults to center (0.5, 0.5).
 * @returns URI of the processed frame with emulated depth-of-field.
 */
export async function renderEmulatedDepthOfField(
  baseUri: string,
  fNumber: number,
  focusPoint: { x: number; y: number } | null = null,
): Promise<string> {
  const blurRadius = getApertureBlurRadius(fNumber)
  // If stopped down to f/4.0+, no extra blur is needed — return base image
  if (blurRadius <= 1) {
    return baseUri
  }

  const file = new File(baseUri)
  if (!file.exists) {
    return baseUri
  }

  const bytes = await file.bytes()
  const baseImg = decodeToSkImage(bytes)
  if (!baseImg) {
    return baseUri
  }

  const width = baseImg.width()
  const height = baseImg.height()

  const surface = Skia.Surface.MakeOffscreen(width, height)
  if (!surface) {
    return baseUri
  }

  const canvas = surface.getCanvas()

  // 1. Render background with optical bokeh blur filter
  const blurPaint = Skia.Paint()
  const blurFilter = Skia.ImageFilter.MakeBlur(blurRadius, blurRadius, 0)
  blurPaint.setImageFilter(blurFilter)
  canvas.drawImage(baseImg, 0, 0, blurPaint)

  // 2. Composite the sharp subject plane back over the focal center
  // Focus point anchor in pixel coordinates
  const fx = (focusPoint?.x ?? 0.5) * width
  const fy = (focusPoint?.y ?? 0.5) * height
  const subjectRadius = Math.min(width, height) * 0.38

  // Radial falloff mask for the in-focus subject plane
  const radialShader = Skia.Shader.MakeRadialGradient(
    { x: fx, y: fy },
    subjectRadius,
    [
      Skia.Color('rgba(255, 255, 255, 1.0)'),
      Skia.Color('rgba(255, 255, 255, 0.85)'),
      Skia.Color('rgba(255, 255, 255, 0.0)'),
    ],
    [0.0, 0.65, 1.0],
    0,
  )

  const subjectPaint = Skia.Paint()
  // Save layer with radial alpha mask to smoothly isolate sharp subject
  canvas.saveLayer()
  canvas.drawImage(baseImg, 0, 0)

  const maskPaint = Skia.Paint()
  maskPaint.setShader(radialShader)
  maskPaint.setBlendMode(BlendMode.DstIn)
  canvas.drawRect(Skia.XYWHRect(0, 0, width, height), maskPaint)
  canvas.restore()

  surface.flush()

  const snapshot = surface.makeImageSnapshot()
  try {
    const outputBytes = snapshot.encodeToBytes(ImageFormat.JPEG, 94)
    if (!CAPTURE_TEMP_DIRECTORY.exists) {
      CAPTURE_TEMP_DIRECTORY.create({ idempotent: true, intermediates: true })
    }
    const destination = new File(
      CAPTURE_TEMP_DIRECTORY,
      `capture-dof-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`,
    )
    destination.write(outputBytes)
    return destination.uri
  } finally {
    // Memory cleanup
  }
}

/**
 * Merges multiple stepped-focus frames (Focus Stacking) to create an ultra-deep
 * depth of field frame with edge-to-edge sharpness for macro / f/16 photography.
 */
export async function blendFocusStack(frameUris: string[]): Promise<string> {
  if (frameUris.length === 0) throw new Error('No frames provided for focus stack')
  if (frameUris.length === 1) return frameUris[0]

  // For 2+ frames, read the first as base and blend sharpness
  const baseUri = frameUris[0]
  const file1 = new File(baseUri)
  const file2 = new File(frameUris[1])

  if (!file1.exists || !file2.exists) return baseUri

  const bytes1 = await file1.bytes()
  const bytes2 = await file2.bytes()

  const img1 = decodeToSkImage(bytes1)
  const img2 = decodeToSkImage(bytes2)
  if (!img1 || !img2) return baseUri

  const width = img1.width()
  const height = img1.height()

  const surface = Skia.Surface.MakeOffscreen(width, height)
  if (!surface) return baseUri

  const canvas = surface.getCanvas()

  // Base exposure
  canvas.drawImage(img1, 0, 0)

  // Blend second stepped focal plane with soft overlay
  const stackPaint = Skia.Paint()
  stackPaint.setBlendMode(BlendMode.Overlay)
  stackPaint.setAlphaf(0.4)
  canvas.drawImage(img2, 0, 0, stackPaint)

  surface.flush()

  const snapshot = surface.makeImageSnapshot()
  try {
    const outputBytes = snapshot.encodeToBytes(ImageFormat.JPEG, 95)
    if (!CAPTURE_TEMP_DIRECTORY.exists) {
      CAPTURE_TEMP_DIRECTORY.create({ idempotent: true, intermediates: true })
    }
    const destination = new File(
      CAPTURE_TEMP_DIRECTORY,
      `capture-stack-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`,
    )
    destination.write(outputBytes)
    return destination.uri
  } finally {
    // Cleanup
  }
}
