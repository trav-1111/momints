import { ImageFormat, PaintStyle, Skia, matchFont, type SkFont } from '@shopify/react-native-skia'
import { File } from 'expo-file-system'
import {
  createContactSheetInputDirectory,
  createContactSheetOutputFile,
  deleteAppOwnedImage,
  deleteContactSheetRenderDirectory,
} from './imagePrivacy'
import { runWithCleanup } from './privacyPathGuard.cjs'

export type ContactSheetFilm = string
export type ContactSheetAspect = '1:1' | '4:3' | '16:9' | 'Original' | 'Mixed'

export interface ContactSheetFrame {
  imageUri: string
  name: string
  width?: number
  height?: number
}

export interface ContactSheetMetadata {
  title: string
  artist: string
  date: string
  filmUsed: ContactSheetFilm
  aspect?: ContactSheetAspect
  logoUri: string
}

export interface ContactSheetRenderResult {
  uri: string
  width: number
  height: number
  columns: 3 | 4
  frameCount: number
  aspectUsed: ContactSheetAspect
}

const OUTPUT_WIDTH = 1600
const OUTER_MARGIN = 72
const HEADER_HEIGHT = 236
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
    const response = await fetch(uri, { headers: { 'Cache-Control': 'no-store' }, cache: 'no-store' })
    if (!response.ok) throw new Error(`Image request failed (${response.status})`)
    return new Uint8Array(await response.arrayBuffer())
  }
  return new File(uri).bytes()
}

async function imageDimensions(uri: string, name: string): Promise<{ width: number; height: number }> {
  let data: ReturnType<typeof Skia.Data.fromBytes> | null = null
  let image: ReturnType<typeof Skia.Image.MakeImageFromEncoded> = null
  try {
    data = Skia.Data.fromBytes(await readImageBytes(uri))
    image = Skia.Image.MakeImageFromEncoded(data)
    if (!image) throw new Error('Image could not be decoded')
    return { width: image.width(), height: image.height() }
  } catch (error) {
    throw new Error(`Could not load “${name}”.`, { cause: error instanceof Error ? error : undefined })
  } finally {
    image?.dispose()
    data?.dispose()
  }
}

function classifyAspect(width: number, height: number): Exclude<ContactSheetAspect, 'Mixed'> {
  const ratio = Math.max(width, height) / Math.min(width, height)
  if (Math.abs(ratio - 1) < 0.025) return '1:1'
  if (Math.abs(ratio - 4 / 3) < 0.04) return '4:3'
  if (Math.abs(ratio - 16 / 9) < 0.05) return '16:9'
  return 'Original'
}

function detectedAspect(dimensions: { width: number; height: number }[]): ContactSheetAspect {
  const values = new Set(dimensions.map((item) => classifyAspect(item.width, item.height)))
  return values.size === 1 ? [...values][0] : 'Mixed'
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
async function renderPreparedContactSheet(
  frames: ContactSheetFrame[],
  metadata: ContactSheetMetadata,
): Promise<ContactSheetRenderResult> {
  if (frames.length === 0 || frames.length > 24) {
    throw new Error('A contact sheet requires between 1 and 24 frames.')
  }

  const columns = getContactSheetColumns(frames.length)
  const rows = Math.ceil(frames.length / columns)
  const cellWidth = Math.floor((OUTPUT_WIDTH - OUTER_MARGIN * 2 - COLUMN_GAP * (columns - 1)) / columns)
  // First pass reads only dimensions. The border for every frame then uses its
  // stored pixel ratio exactly, rather than forcing a square or landscape crop.
  const frameDimensions: { width: number; height: number }[] = []
  for (const frame of frames) {
    frameDimensions.push(
      Number.isInteger(frame.width) && Number.isInteger(frame.height) && frame.width! > 0 && frame.height! > 0
        ? { width: frame.width!, height: frame.height! }
        : await imageDimensions(frame.imageUri, frame.name),
    )
  }
  const frameHeights = frameDimensions.map(({ width, height }) => Math.round((cellWidth * height) / width))
  const rowImageHeights = Array.from({ length: rows }, (_, row) =>
    Math.max(...frameHeights.slice(row * columns, (row + 1) * columns)),
  )
  const aspectUsed = metadata.aspect ?? detectedAspect(frameDimensions)
  const outputHeight =
    OUTER_MARGIN +
    HEADER_HEIGHT +
    rowImageHeights.reduce((total, height) => total + height + LABEL_HEIGHT, 0) +
    (rows - 1) * ROW_GAP +
    OUTER_MARGIN

  // Contact-sheet export is an infrequent, sequential operation. A CPU-backed
  // raster surface avoids leaving a large reusable GPU allocation beside the
  // camera/film renderer after a 24-frame sheet has been encoded.
  const surface = Skia.Surface.Make(OUTPUT_WIDTH, outputHeight)
  if (!surface) throw new Error('Could not create the contact-sheet canvas.')
  const owned: { dispose(): void }[] = []
  const own = <T extends { dispose(): void }>(value: T): T => {
    owned.push(value)
    return value
  }
  let snapshot: ReturnType<typeof surface.makeImageSnapshot> | null = null
  let output: File | null = null
  let outputComplete = false

  try {
    const canvas = surface.getCanvas()
    const fillPaint = own(Skia.Paint())
    fillPaint.setAntiAlias(true)
    fillPaint.setColor(Skia.Color(SHEET_BG))
    canvas.drawRect(Skia.XYWHRect(0, 0, OUTPUT_WIDTH, outputHeight), fillPaint)

    const titleFont = own(matchFont({ fontFamily: 'sans-serif', fontSize: 46, fontWeight: '700' }))
    const metaFont = own(matchFont({ fontFamily: 'monospace', fontSize: 24, fontWeight: '500' }))
    const labelFont = own(matchFont({ fontFamily: 'monospace', fontSize: 23, fontWeight: '500' }))
    const textPaint = own(Skia.Paint())
    textPaint.setAntiAlias(true)
    textPaint.setColor(Skia.Color(TEXT))
    const mutedPaint = own(Skia.Paint())
    mutedPaint.setAntiAlias(true)
    mutedPaint.setColor(Skia.Color(MUTED))

    const headerTop = OUTER_MARGIN
    const logoSize = 94
    const titleMaxWidth = OUTPUT_WIDTH - OUTER_MARGIN * 2 - logoSize - 38
    canvas.drawText(
      ellipsize(metadata.title, titleFont, titleMaxWidth),
      OUTER_MARGIN,
      headerTop + 50,
      textPaint,
      titleFont,
    )
    try {
      // Standalone Android builds resolve bundled images to drawable resource
      // names, which Expo File cannot read. Skia handles those and file/HTTP URIs.
      const logoData = await Skia.Data.fromURI(metadata.logoUri)
      let logo: ReturnType<typeof Skia.Image.MakeImageFromEncoded> = null
      try {
        logo = Skia.Image.MakeImageFromEncoded(logoData)
        if (!logo) throw new Error('Logo could not be decoded')
        const logoX = OUTPUT_WIDTH - OUTER_MARGIN - logoSize
        const logoY = headerTop - 18
        canvas.drawImageRect(
          logo,
          Skia.XYWHRect(0, 0, logo.width(), logo.height()),
          containRect(logo.width(), logo.height(), logoX, logoY, logoSize, logoSize),
          textPaint,
        )
      } finally {
        logo?.dispose()
        logoData.dispose()
      }
    } catch (error) {
      throw new Error('Could not load the Momints logo.', { cause: error instanceof Error ? error : undefined })
    }

    const metaY = headerTop + 132
    const metaColumn = (OUTPUT_WIDTH - OUTER_MARGIN * 2) / 4
    const headerValues = [
      ['ARTIST', metadata.artist || 'Unknown'],
      ['DATE', metadata.date],
      ['FILM', metadata.filmUsed],
      ['ASPECT', aspectUsed],
    ] as const
    headerValues.forEach(([label, value], index) => {
      const x = OUTER_MARGIN + index * metaColumn
      canvas.drawText(label, x, metaY, mutedPaint, metaFont)
      canvas.drawText(ellipsize(value, metaFont, metaColumn - 28), x, metaY + 40, textPaint, metaFont)
    })

    const dividerPaint = own(Skia.Paint())
    dividerPaint.setColor(Skia.Color(BORDER))
    dividerPaint.setStrokeWidth(2)
    canvas.drawLine(
      OUTER_MARGIN,
      headerTop + HEADER_HEIGHT - 16,
      OUTPUT_WIDTH - OUTER_MARGIN,
      headerTop + HEADER_HEIGHT - 16,
      dividerPaint,
    )

    const imagePaint = own(Skia.Paint())
    imagePaint.setAntiAlias(true)
    const imageBackgroundPaint = own(Skia.Paint())
    imageBackgroundPaint.setColor(Skia.Color(IMAGE_BG))
    const borderPaint = own(Skia.Paint())
    borderPaint.setAntiAlias(true)
    borderPaint.setColor(Skia.Color(BORDER))
    borderPaint.setStyle(PaintStyle.Stroke)
    borderPaint.setStrokeWidth(2)

    const gridTop = OUTER_MARGIN + HEADER_HEIGHT
    const rowOffsets: number[] = []
    let nextRowY = gridTop
    rowImageHeights.forEach((height) => {
      rowOffsets.push(nextRowY)
      nextRowY += height + LABEL_HEIGHT + ROW_GAP
    })
    for (let index = 0; index < frames.length; index++) {
      const frame = frames[index]
      const column = index % columns
      const row = Math.floor(index / columns)
      const x = OUTER_MARGIN + column * (cellWidth + COLUMN_GAP)
      const imageHeight = frameHeights[index]
      const y = rowOffsets[row] + rowImageHeights[row] - imageHeight
      const destination = Skia.XYWHRect(x, y, cellWidth, imageHeight)

      canvas.drawRect(destination, imageBackgroundPaint)
      try {
        const data = Skia.Data.fromBytes(await readImageBytes(frame.imageUri))
        let image: ReturnType<typeof Skia.Image.MakeImageFromEncoded> = null
        try {
          image = Skia.Image.MakeImageFromEncoded(data)
          if (!image) throw new Error('Image could not be decoded')
          canvas.drawImageRect(
            image,
            Skia.XYWHRect(0, 0, image.width(), image.height()),
            containRect(image.width(), image.height(), x, y, cellWidth, imageHeight),
            imagePaint,
          )
        } finally {
          image?.dispose()
          data.dispose()
        }
      } catch (error) {
        throw new Error(`Could not load “${frame.name}”.`, { cause: error instanceof Error ? error : undefined })
      }
      canvas.drawRect(destination, borderPaint)
      canvas.drawText(
        ellipsize(frame.name, labelFont, cellWidth),
        x,
        rowOffsets[row] + rowImageHeights[row] + 37,
        textPaint,
        labelFont,
      )
    }

    surface.flush()
    snapshot = surface.makeImageSnapshot()
    const png = snapshot.encodeToBytes(ImageFormat.PNG)
    output = createContactSheetOutputFile()
    output.write(png)
    outputComplete = true

    return {
      uri: output.uri,
      width: OUTPUT_WIDTH,
      height: outputHeight,
      columns,
      frameCount: frames.length,
      aspectUsed,
    }
  } finally {
    if (!outputComplete && output) deleteAppOwnedImage(output.uri)
    snapshot?.dispose()
    for (let index = owned.length - 1; index >= 0; index--) owned[index].dispose()
    surface.dispose()
  }
}

export async function renderContactSheet(
  frames: ContactSheetFrame[],
  metadata: ContactSheetMetadata,
): Promise<ContactSheetRenderResult> {
  const temporaryInputs = createContactSheetInputDirectory()
  return runWithCleanup(
    async () => {
      const prepared: ContactSheetFrame[] = []
      for (let index = 0; index < frames.length; index++) {
        const frame = frames[index]
        if (/^https?:\/\//i.test(frame.imageUri)) {
          const destination = new File(temporaryInputs, `frame-${String(index).padStart(2, '0')}.img`)
          const response = await fetch(frame.imageUri, {
            headers: { 'Cache-Control': 'no-store' },
            cache: 'no-store',
          })
          if (!response.ok) throw new Error(`Image request failed (${response.status})`)
          destination.write(new Uint8Array(await response.arrayBuffer()))
          prepared.push({ ...frame, imageUri: destination.uri })
        } else {
          prepared.push(frame)
        }
      }
      return renderPreparedContactSheet(prepared, metadata)
    },
    () => {
      deleteContactSheetRenderDirectory(temporaryInputs)
    },
  )
}
