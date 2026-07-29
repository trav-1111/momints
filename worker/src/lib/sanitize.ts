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
 * Sanitize a user-supplied display name for NFT metadata: trim, strip
 * control/invisible/bidi characters, collapse internal whitespace, cap at 48.
 */
export function sanitizeDisplayName(raw: string): string {
  let cleaned = ''
  for (const ch of raw) {
    if (!isDisallowed(ch.codePointAt(0) ?? 0)) {
      cleaned += ch
    }
  }
  return cleaned.replace(/\s+/g, ' ').trim().slice(0, MAX_DISPLAY_NAME_LENGTH).trim()
}
