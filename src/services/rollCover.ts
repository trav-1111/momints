import { Skia, matchFont, ImageFormat, TileMode, type SkCanvas, type SkFont } from '@shopify/react-native-skia'
import { colors } from '../theme'

export interface RollCoverParams {
  /** Collection name, e.g. `2026-07-19.01`. */
  rollName: string
  /** Vanity artist display name. */
  artist: string
  size: number
}

const SIZE = 1024
const SPROCKET_STRIP = 64
const SPROCKET_STEP = 74
const SPROCKET_W = 26
const SPROCKET_H = 36

function drawSprocketStrip(canvas: SkCanvas, x: number): void {
  const strip = Skia.Paint()
  strip.setColor(Skia.Color('rgba(0,0,0,0.45)'))
  canvas.drawRect(Skia.XYWHRect(x, 0, SPROCKET_STRIP, SIZE), strip)

  const hole = Skia.Paint()
  hole.setColor(Skia.Color('rgba(0,0,0,0.85)'))
  const holeX = x + (SPROCKET_STRIP - SPROCKET_W) / 2
  for (let y = SPROCKET_STEP / 2; y < SIZE; y += SPROCKET_STEP) {
    canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(holeX, y, SPROCKET_W, SPROCKET_H), 7, 7), hole)
  }
}

function drawCenteredText(canvas: SkCanvas, text: string, y: number, font: SkFont, color: string): void {
  const paint = Skia.Paint()
  paint.setColor(Skia.Color(color))
  paint.setAntiAlias(true)
  const width = font.measureText(text).width
  canvas.drawText(text, (SIZE - width) / 2, y, paint, font)
}

/**
 * Generate the roll's branded collection cover as PNG bytes — film-strip
 * motif in the app's indigo palette, with the roll name, artist and exposure
 * count baked in. Pure Skia offscreen drawing; no UI involvement.
 */
export function generateRollCover({ rollName, artist, size }: RollCoverParams): Uint8Array {
  const surface = Skia.Surface.MakeOffscreen(SIZE, SIZE) ?? Skia.Surface.Make(SIZE, SIZE)
  if (!surface) {
    throw new Error('Could not create drawing surface for the roll cover')
  }
  const canvas = surface.getCanvas()

  // Background — the splash's navy → plum sweep
  const bg = Skia.Paint()
  bg.setShader(
    Skia.Shader.MakeLinearGradient(
      { x: SIZE * 0.12, y: 0 },
      { x: SIZE * 0.88, y: SIZE },
      [Skia.Color('#17253f'), Skia.Color('#101528'), Skia.Color('#15102a'), Skia.Color('#1b1229')],
      [0, 0.4, 0.74, 1],
      TileMode.Clamp,
    ),
  )
  canvas.drawRect(Skia.XYWHRect(0, 0, SIZE, SIZE), bg)

  // Soft accent glow behind the title block
  const glow = Skia.Paint()
  glow.setShader(
    Skia.Shader.MakeRadialGradient(
      { x: SIZE / 2, y: SIZE * 0.46 },
      SIZE * 0.55,
      [Skia.Color('rgba(125,123,240,0.22)'), Skia.Color('rgba(125,123,240,0)')],
      [0, 1],
      TileMode.Clamp,
    ),
  )
  canvas.drawRect(Skia.XYWHRect(0, 0, SIZE, SIZE), glow)

  // 35mm sprocket edges
  drawSprocketStrip(canvas, 0)
  drawSprocketStrip(canvas, SIZE - SPROCKET_STRIP)

  // Type block. System monospace keeps this dependency-free — the cover is
  // generated headless, where the app's bundled fonts aren't loaded.
  const eyebrowFont = matchFont({ fontFamily: 'monospace', fontSize: 34, fontWeight: 'bold' })
  const titleFont = matchFont({ fontFamily: 'monospace', fontSize: 104, fontWeight: 'bold' })
  const artistFont = matchFont({ fontFamily: 'sans-serif', fontSize: 46, fontWeight: 'bold' })
  const footerFont = matchFont({ fontFamily: 'monospace', fontSize: 30 })

  drawCenteredText(canvas, 'M O M I N T S', SIZE * 0.3, eyebrowFont, colors.accent)
  drawCenteredText(canvas, rollName, SIZE * 0.46, titleFont, colors.text)
  drawCenteredText(canvas, artist, SIZE * 0.56, artistFont, colors.textSoft)

  // Divider
  const divider = Skia.Paint()
  divider.setColor(Skia.Color('rgba(255,255,255,0.16)'))
  canvas.drawRect(Skia.XYWHRect(SIZE * 0.38, SIZE * 0.63, SIZE * 0.24, 2), divider)

  drawCenteredText(canvas, `${size} EXPOSURES · SHOT ON SEEKER`, SIZE * 0.7, footerFont, colors.textSecondary)

  const image = surface.makeImageSnapshot()
  const bytes = image.encodeToBytes(ImageFormat.PNG, 100)
  if (!bytes || bytes.length === 0) {
    throw new Error('Cover image encoding failed')
  }
  return bytes
}
