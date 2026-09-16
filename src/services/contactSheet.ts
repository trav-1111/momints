import { ImageFormat, PaintStyle, Skia, matchFont, type SkFont } from '@shopify/react-native-skia'
import { File, Paths } from 'expo-file-system'

export type ContactSheetFilm = 'Color' | 'B&W' | 'Mixed'

export interface ContactSheetFrame {
  imageUri: string
  name: string
}

export interface ContactSheetMetadata {
  artist: string
  date: string
  filmUsed: ContactSheetFilm
}

export interface ContactSheetRenderResult {
  uri: string
  width: number
  height: number
  columns: 3 | 4
  frameCount: number
}

const OUTPUT_WIDTH = 1600
const OUTER_MARGIN = 72
const HEADER_HEIGHT = 198
const COLUMN_GAP = 22
const ROW_GAP = 30
const LABEL_HEIGHT = 58
const SHEET_BG = '#101010'
const IMAGE_BG = '#050505'
const BORDER = '#5f5f5b'
const TEXT = '#f0efe8'
const MUTED = '#aaa99f'

export function getContactSheetColumns(frameCount: number): 3 | 4 {
  return frameCount <= 9 ? 3 : 4
}

async function readImageBytes(uri: string): Promise<Uint8Array> {
  if (/^https?:\/\//i.test(uri)) {
    const response = await fetch(uri)
    if (!response.ok) throw new Error(`Image request failed (${response.status})`)
    return new Uint8Array(await response.arrayBuffer())
  }
  return new File(uri).bytes()
}

function containRect(sourceWidth: number, sourceHeight: number, x: number, y: number, width: number, height: number) {
  const scale = Math.min(width / sourceWidth, height / sourceHeight)
  const drawnWidth = sourceWidth * scale
  const drawnHeight = sourceHeight * scale
  return Skia.XYWHRect(x + (width - drawnWidth) / 2, y + (height - drawnHeight) / 2, drawnWidth, drawnHeight)
}

function ellipsize(text: string, font: SkFont, maxWidth: number): string {
  if (font.measureText(text).width <= maxWidth) return text
  let value = text
  while (value.length > 1 && font.measureText(`${value}…`).width > maxWidth) value = value.slice(0, -1)
  return `${value}…`
}

/**
 * Render the already-stored frame images into a clean contact sheet. This is a
 * compositor only: it never applies film processing, colour changes, or crops.
 */
export async function renderContactSheet(
  frames: ContactSheetFrame[],
  metadata: ContactSheetMetadata,
): Promise<ContactSheetRenderResult> {
  if (frames.length === 0 || frames.length > 24) {
    throw new Error('A contact sheet requires between 1 and 24 frames.')
  }

  const columns = getContactSheetColumns(frames.length)
  const rows = Math.ceil(frames.length / columns)
  const cellWidth = Math.floor((OUTPUT_WIDTH - OUTER_MARGIN * 2 - COLUMN_GAP * (columns - 1)) / columns)
  const imageHeight = Math.round(cellWidth * 0.82)
  const rowHeight = imageHeight + LABEL_HEIGHT
  const outputHeight = OUTER_MARGIN + HEADER_HEIGHT + rows * rowHeight + (rows - 1) * ROW_GAP + OUTER_MARGIN

  const surface = Skia.Surface.MakeOffscreen(OUTPUT_WIDTH, outputHeight)
  if (!surface) throw new Error('Could not create the contact-sheet canvas.')

  const canvas = surface.getCanvas()
  const fillPaint = Skia.Paint()
  fillPaint.setAntiAlias(true)
  fillPaint.setColor(Skia.Color(SHEET_BG))
  canvas.drawRect(Skia.XYWHRect(0, 0, OUTPUT_WIDTH, outputHeight), fillPaint)

  const titleFont = matchFont({ fontFamily: 'sans-serif', fontSize: 42, fontWeight: '700' })
  const metaFont = matchFont({ fontFamily: 'monospace', fontSize: 24, fontWeight: '500' })
  const labelFont = matchFont({ fontFamily: 'monospace', fontSize: 23, fontWeight: '500' })
  const textPaint = Skia.Paint()
  textPaint.setAntiAlias(true)
  textPaint.setColor(Skia.Color(TEXT))
  const mutedPaint = Skia.Paint()
  mutedPaint.setAntiAlias(true)
  mutedPaint.setColor(Skia.Color(MUTED))

  const headerTop = OUTER_MARGIN
  canvas.drawText('CONTACT SHEET', OUTER_MARGIN, headerTop + 42, textPaint, titleFont)
  const metaY = headerTop + 104
  const metaColumn = (OUTPUT_WIDTH - OUTER_MARGIN * 2) / 3
  const headerValues = [
    ['ARTIST', metadata.artist || 'Unknown'],
    ['DATE', metadata.date],
    ['FILM', metadata.filmUsed],
  ] as const
  headerValues.forEach(([label, value], index) => {
    const x = OUTER_MARGIN + index * metaColumn
    canvas.drawText(label, x, metaY, mutedPaint, metaFont)
    canvas.drawText(ellipsize(value, metaFont, metaColumn - 28), x, metaY + 40, textPaint, metaFont)
  })

  const dividerPaint = Skia.Paint()
  dividerPaint.setColor(Skia.Color(BORDER))
  dividerPaint.setStrokeWidth(2)
  canvas.drawLine(
    OUTER_MARGIN,
    headerTop + HEADER_HEIGHT - 16,
    OUTPUT_WIDTH - OUTER_MARGIN,
    headerTop + HEADER_HEIGHT - 16,
    dividerPaint,
  )

  const imagePaint = Skia.Paint()
  imagePaint.setAntiAlias(true)
  const imageBackgroundPaint = Skia.Paint()
  imageBackgroundPaint.setColor(Skia.Color(IMAGE_BG))
  const borderPaint = Skia.Paint()
  borderPaint.setAntiAlias(true)
  borderPaint.setColor(Skia.Color(BORDER))
  borderPaint.setStyle(PaintStyle.Stroke)
  borderPaint.setStrokeWidth(2)

  const gridTop = OUTER_MARGIN + HEADER_HEIGHT
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index]
    const column = index % columns
    const row = Math.floor(index / columns)
    const x = OUTER_MARGIN + column * (cellWidth + COLUMN_GAP)
    const y = gridTop + row * (rowHeight + ROW_GAP)
    const destination = Skia.XYWHRect(x, y, cellWidth, imageHeight)

    canvas.drawRect(destination, imageBackgroundPaint)
    try {
      const data = Skia.Data.fromBytes(await readImageBytes(frame.imageUri))
      const image = Skia.Image.MakeImageFromEncoded(data)
      if (!image) throw new Error('Image could not be decoded')
      canvas.drawImageRect(
        image,
        Skia.XYWHRect(0, 0, image.width(), image.height()),
        containRect(image.width(), image.height(), x, y, cellWidth, imageHeight),
        imagePaint,
      )
      image.dispose()
    } catch (error) {
      throw new Error(`Could not load “${frame.name}”.`, { cause: error instanceof Error ? error : undefined })
    }
    canvas.drawRect(destination, borderPaint)
    canvas.drawText(ellipsize(frame.name, labelFont, cellWidth), x, y + imageHeight + 37, textPaint, labelFont)
  }

  surface.flush()
  const snapshot = surface.makeImageSnapshot()
  const png = snapshot.encodeToBytes(ImageFormat.PNG)
  const output = new File(Paths.cache, `momints-contact-sheet-${Date.now()}.png`)
  output.write(png)

  return { uri: output.uri, width: OUTPUT_WIDTH, height: outputHeight, columns, frameCount: frames.length }
}
