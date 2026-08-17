// Branded roll-cover generator (@cf-wasm/photon — `sharp` does not run in
// Workers). Composites the roll's date and exposure label onto the base
// film-canister artwork. The cover is STATIC for the roll's life: generated
// once at creation, never swapped for frame 01, never mutated.
//
// assets/base-cover.jpg is the real branded artwork. If it is ever swapped,
// keep it JPEG and modest (<100 KB) so the Worker bundle and the <200 KB
// output budget both hold.
import baseCoverArt from '../../assets/base-cover.jpg'
import { COVER_MAX_BYTES, type RollSize } from './config'

const JPEG_QUALITIES = [82, 70, 55] as const

export interface CoverResult {
  bytes: Uint8Array
  mime: 'image/jpeg'
}

/**
 * Render the cover: base artwork + `yyyy-mm-dd` + `12 EXP`/`24 EXP`.
 * Output is guaranteed < 200 KB (steps down JPEG quality if needed).
 */
export async function generateCover(dateLabel: string, size: RollSize): Promise<CoverResult> {
  // The workerd entry initializes its bundled WASM synchronously at import.
  const photon = await import('@cf-wasm/photon/workerd')

  const img = photon.PhotonImage.new_from_byteslice(new Uint8Array(baseCoverArt))
  try {
    const width = img.get_width()
    const height = img.get_height()
    // Text scale is proportional so a swapped base artwork keeps the layout.
    const fontSize = Math.round(height * 0.055)
    const margin = Math.round(height * 0.06)

    const exposureLabel = `${size} EXP`
    photon.draw_text(img, dateLabel, margin, Math.round(height - margin - fontSize * 2.4), fontSize)
    photon.draw_text(img, exposureLabel, margin, Math.round(height - margin - fontSize), fontSize)

    for (const quality of JPEG_QUALITIES) {
      const bytes = img.get_bytes_jpeg(quality)
      if (bytes.byteLength < COVER_MAX_BYTES) {
        return { bytes, mime: 'image/jpeg' }
      }
    }
    throw new Error(
      `Cover render exceeded the ${COVER_MAX_BYTES} byte budget at every quality step ` +
        `(base art ${width}x${height}) — shrink the base artwork.`,
    )
  } finally {
    img.free()
  }
}
