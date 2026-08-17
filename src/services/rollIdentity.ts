export const ARTIST_NAME_MAX_LENGTH = 48

// C0 controls, DEL, C1 controls, zero-width/bidi formatting chars, line/para
// separators, BOM — anything invisible that could corrupt metadata JSON.
const INVISIBLE_CHARS = new RegExp(
  '[\\u0000-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u2028\\u2029\\uFEFF]',
  'g',
)

/**
 * Clean a user-entered artist display name for metadata JSON: strip control
 * and invisible characters, collapse whitespace runs, trim, cap the length.
 */
export function sanitizeArtistName(raw: string): string {
  return raw
    .replace(INVISIBLE_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ARTIST_NAME_MAX_LENGTH)
}
