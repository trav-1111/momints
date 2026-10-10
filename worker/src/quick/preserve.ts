import type { QuickMintRow, RollDb } from '../db'
import { HttpError } from '../lib/http'

/** Move verified-paid bytes outside the quick-staging/ 24-hour lifecycle.
 * Copy -> verify -> D1 pointer; keep the source until its normal expiry.
 * Uncertain receipts require operator review, never an age-based deletion. */
export async function preserveQuickAttempt(db: RollDb, bucket: R2Bucket, row: QuickMintRow): Promise<void> {
  if (row.image_uri || !row.staging_key || row.staging_key.startsWith('quick-recovery/')) return
  const target = `quick-recovery/${row.id}`
  let preserved = await bucket.head(target)
  if (!preserved) {
    const source = await bucket.get(row.staging_key)
    if (!source)
      throw new HttpError(
        503,
        'Original staged image is missing. Preserve this transaction receipt for support; do not mint again.',
      )
    await bucket.put(target, source.body, { httpMetadata: source.httpMetadata, customMetadata: source.customMetadata })
    preserved = await bucket.head(target)
    if (!preserved || preserved.size !== source.size)
      throw new HttpError(503, 'Image recovery copy is not verified yet. Retry the same receipt.')
  }
  await db.preserveQuickStaging(row.id, row.staging_key, target)
}
