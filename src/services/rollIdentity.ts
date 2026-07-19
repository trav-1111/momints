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

/** Local date as `yyyy-mm-dd`. */
export function formatRollDate(now: number): string {
  const d = new Date(now)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/**
 * Collection name for the wallet's next roll: `yyyy-mm-dd.NN`, where NN is a
 * 2-digit zero-padded same-day index. `rollsCreatedToday` is how many rolls
 * (open or closed) this wallet already created today — first roll = `.01`.
 */
export function buildRollName(now: number, rollsCreatedToday: number): string {
  const index = String(rollsCreatedToday + 1).padStart(2, '0')
  return `${formatRollDate(now)}.${index}`
}
