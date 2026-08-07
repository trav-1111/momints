export const MAX_DISPLAY_NAME_LENGTH = 48

// Codepoints that can break metadata rendering or spoof display: C0/C1
// control chars + DEL, zero-width/joiner chars, line/paragraph separators,
// bidi controls, and the BOM. Compared numerically so the source stays free
// of invisible literals.
function isDisallowed(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    code === 0x2028 ||
    code === 0x2029 ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2069) ||
    code === 0xfeff
  )
}

/**
 * Sanitize user-supplied text for NFT metadata: trim, strip
 * control/invisible/bidi characters, collapse internal whitespace, cap length.
 */
export function sanitizeText(raw: string, maxLength: number): string {
  let cleaned = ''
  for (const ch of raw) {
    if (!isDisallowed(ch.codePointAt(0) ?? 0)) {
      cleaned += ch
    }
  }
  return cleaned.replace(/\s+/g, ' ').trim().slice(0, maxLength).trim()
}

/**
 * Sanitize a display name — the 48-char cap is a NAME budget specifically.
 * Longer free text (a description) must use sanitizeText with its own limit,
 * or it silently loses its tail.
 */
export function sanitizeDisplayName(raw: string): string {
  return sanitizeText(raw, MAX_DISPLAY_NAME_LENGTH)
}

export const MAX_ATTRIBUTES = 24
const MAX_TRAIT_TYPE_LENGTH = 64
const MAX_TRAIT_VALUE_LENGTH = 256

export interface MetadataAttribute {
  trait_type: string
  value: string
}

/**
 * Coerce a client-supplied `attributes` array into the shape that goes onto
 * permanent storage: well-formed entries only, bounded in both count and
 * length. Anything malformed is dropped rather than rejected — a bad trait is
 * not worth failing a mint the user has paid for.
 */
export function sanitizeAttributes(raw: unknown): MetadataAttribute[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((a) => a && typeof a === 'object' && typeof a.trait_type === 'string' && a.value != null)
    .slice(0, MAX_ATTRIBUTES)
    .map((a) => ({
      trait_type: String(a.trait_type).slice(0, MAX_TRAIT_TYPE_LENGTH),
      value: String(a.value).slice(0, MAX_TRAIT_VALUE_LENGTH),
    }))
}
