export const PERMANENT_IMAGE_MIME = 'image/jpeg' as const

/** Worker rejection boundary. New permanent images must never exceed this. */
export const PERMANENT_IMAGE_MAX_BYTES = 3 * 1024 * 1024

/** Client target leaves deterministic headroom below the Worker boundary. */
export const PERMANENT_IMAGE_TARGET_BYTES = 2_900_000

/** Seeker launch envelope. This bounds decoded/GPU memory, not JPEG storage. */
export const PERMANENT_IMAGE_MAX_PIXELS = 12_000_000
export const PERMANENT_IMAGE_MAX_LONG_EDGE = 4_000

export interface PermanentImageArtifact {
  mime: typeof PERMANENT_IMAGE_MIME
  byteLength: number
  width: number
  height: number
}

export function assertPermanentImageGeometry(artifact: Pick<PermanentImageArtifact, 'width' | 'height'>): void {
  const { width, height } = artifact
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Permanent image has invalid dimensions')
  }
  if (width * height > PERMANENT_IMAGE_MAX_PIXELS || Math.max(width, height) > PERMANENT_IMAGE_MAX_LONG_EDGE) {
    throw new Error(
      `Permanent image dimensions ${width}x${height} exceed the ${PERMANENT_IMAGE_MAX_PIXELS}-pixel ` +
        `${PERMANENT_IMAGE_MAX_LONG_EDGE}-pixel-edge contract`,
    )
  }
}

export function assertPermanentImageArtifact(
  artifact: PermanentImageArtifact,
  maximumBytes = PERMANENT_IMAGE_TARGET_BYTES,
): void {
  if (artifact.mime !== PERMANENT_IMAGE_MIME) throw new Error('Permanent image must be an sRGB JPEG')
  if (!Number.isInteger(artifact.byteLength) || artifact.byteLength <= 0 || artifact.byteLength > maximumBytes) {
    throw new Error(`Permanent image is ${artifact.byteLength} bytes; maximum is ${maximumBytes}`)
  }
  assertPermanentImageGeometry(artifact)
}
