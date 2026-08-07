import type { RollDb } from '../db'
import { isBase58Address } from '../lib/address'
import { HttpError } from '../lib/http'
import { sanitizeAttributes, sanitizeText, type MetadataAttribute } from '../lib/sanitize'
import { ALLOWED_MIME } from '../rolls/config'
import {
  MAX_QUICK_IMAGE_BYTES,
  MAX_STAGES_PER_WALLET_PER_DAY,
  QUICK_MINT_FEE_LAMPORTS,
  stagingKeyFor,
} from './config'

/**
 * Metadata as it is stored between stage and finalize.
 *
 * `image` and `properties.files` are deliberately absent: the real image URI
 * does not exist until the consumer uploads it, and the consumer is what fills
 * them in. What arrives from the client is whitelisted down to these fields —
 * arbitrary client JSON must not ride through onto permanent storage.
 */
export interface StagedMetadata {
  name: string
  symbol: string
  description: string
  external_url?: string
  attributes: MetadataAttribute[]
  creators: { address: string; share: number }[]
}

export interface StageQuickMintRequest {
  wallet: string
  imageBytes: Uint8Array
  mime: string
  /** Raw parsed client metadata, before whitelisting. */
  metadata: unknown
}

export interface StageQuickMintDeps {
  db: RollDb
  bucket: R2Bucket
  placeholderUri: string
  treasury: string
  workerPubkey: string
}

export interface StageQuickMintResult {
  stagingKey: string
  placeholderUri: string
  feeLamports: number
  treasury: string
  updateAuthority: string
  maxImageBytes: number
}

const DAY_MS = 24 * 60 * 60 * 1000

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

const MAX_NAME_LENGTH = 64
const MAX_DESCRIPTION_LENGTH = 512
const MAX_EXTERNAL_URL_LENGTH = 256

function optionalString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  return sanitizeText(value, max) || undefined
}

function whitelistMetadata(raw: unknown, wallet: string): StagedMetadata {
  const source = asRecord(raw)

  const name = optionalString(source.name, MAX_NAME_LENGTH)
  if (!name) {
    throw new HttpError(400, 'metadata.name is required and must be non-empty after sanitization')
  }

  return {
    name,
    symbol: 'MOMINT',
    description: optionalString(source.description, MAX_DESCRIPTION_LENGTH) ?? 'Shot on Seeker',
    // https only: this lands in permanent metadata that wallets will render.
    ...(typeof source.external_url === 'string' && source.external_url.startsWith('https://')
      ? { external_url: source.external_url.slice(0, MAX_EXTERNAL_URL_LENGTH) }
      : {}),
    attributes: sanitizeAttributes(source.attributes),
    // Provenance comes from the paying wallet, which finalize proves on-chain —
    // never from a client-supplied creators list.
    creators: [{ address: wallet, share: 100 }],
  }
}

/**
 * Park a quick-mint image and its metadata so the client can mint against the
 * placeholder URI.
 *
 * NOTHING IS SPENT HERE. No fee is required, no Arweave bytes are bought, and
 * no on-chain transaction exists yet. That is what makes it safe for this
 * endpoint to be unauthenticated: the `wallet` field is claimed, not proven,
 * and the only cost of a bogus stage is an R2 object that the bucket's
 * lifecycle rule reaps within a day.
 *
 * The response is the single source of truth for the transaction the app is
 * about to build — fee, treasury, update authority and placeholder all come
 * from the server, so pricing can move without an app release and the app can
 * never drift out of sync with what finalize will verify.
 */
export async function stageQuickMint(
  deps: StageQuickMintDeps,
  req: StageQuickMintRequest,
): Promise<StageQuickMintResult> {
  const { db, bucket, placeholderUri, treasury, workerPubkey } = deps

  if (!isBase58Address(req.wallet)) {
    throw new HttpError(400, 'wallet must be a base58 Solana address')
  }
  if (!ALLOWED_MIME.has(req.mime)) {
    throw new HttpError(400, `Unsupported image MIME "${req.mime}" — use image/jpeg, image/png, or image/webp`)
  }
  if (req.imageBytes.byteLength === 0) {
    throw new HttpError(400, 'Empty image body')
  }
  // The fee is priced against this ceiling, so exceeding it would sell
  // permanent storage below cost. Hard reject, never a silent downscale.
  if (req.imageBytes.byteLength > MAX_QUICK_IMAGE_BYTES) {
    throw new HttpError(
      413,
      `Image is ${req.imageBytes.byteLength} bytes; the quick-mint ceiling is ${MAX_QUICK_IMAGE_BYTES}. ` +
        'Compress before staging.',
    )
  }

  const metadata = whitelistMetadata(req.metadata, req.wallet)

  const since = new Date(Date.now() - DAY_MS).toISOString()
  const staged = await db.countQuickStagesSince(req.wallet, since)
  if (staged >= MAX_STAGES_PER_WALLET_PER_DAY) {
    throw new HttpError(
      429,
      `Wallet ${req.wallet} has staged ${staged} quick mints in the last 24 hours ` +
        `(limit ${MAX_STAGES_PER_WALLET_PER_DAY}). Try again later.`,
    )
  }

  const id = crypto.randomUUID()
  const key = stagingKeyFor(req.wallet, id)

  await bucket.put(key, req.imageBytes, { httpMetadata: { contentType: req.mime } })
  try {
    await db.insertQuickMint({
      id,
      wallet: req.wallet,
      metadataJson: JSON.stringify(metadata),
      stagingKey: key,
      mime: req.mime,
    })
  } catch (err) {
    // No row means nothing will ever finalize or sweep this object — delete it
    // now rather than leaving bytes nobody tracks.
    await bucket.delete(key).catch(() => {})
    throw err
  }

  return {
    stagingKey: id,
    placeholderUri,
    feeLamports: QUICK_MINT_FEE_LAMPORTS,
    treasury,
    updateAuthority: workerPubkey,
    maxImageBytes: MAX_QUICK_IMAGE_BYTES,
  }
}
