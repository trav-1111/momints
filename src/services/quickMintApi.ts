import type { MintMetadataBase } from './ipfs'
import { request } from './rollApi'

/**
 * Typed client for the Worker's quick-mint fee flow. Errors are `RollApiError`
 * (from rollApi.ts) — including its `resumable` rule, which the finalize path
 * leans on: a 503 there means "we could not check yet", never "you did not pay".
 *
 * The three calls bracket a single wallet signature:
 *
 *   stage    park the image, learn the terms   (nothing spent, nothing signed)
 *   [client mints: placeholder URI + fee, one signature]
 *   finalize prove the fee landed              (the Worker starts spending)
 *   status   watch the placeholder get swapped (optional)
 */

// Stage streams an image of up to ~3 MiB; finalize does RPC verification plus
// an enqueue. Neither waits on an Arweave upload — that happens on the queue.
const STAGE_TIMEOUT_MS = 60_000
const FINALIZE_TIMEOUT_MS = 30_000
const READ_TIMEOUT_MS = 20_000

export interface StageQuickMintParams {
  wallet: string
  /** Local file URI of the photo. */
  photoUri: string
  metadata: MintMetadataBase
}

/**
 * Everything needed to build the mint transaction. All of it comes from the
 * server so the app cannot drift from what finalize will verify — in
 * particular, never hardcode the fee or the treasury app-side.
 */
export interface StageQuickMintResponse {
  stagingKey: string
  placeholderUri: string
  feeLamports: number
  treasury: string
  updateAuthority: string
  maxImageBytes: number
}

export interface FinalizeQuickMintParams {
  stagingKey: string
  signature: string
  assetAddress: string
}

export interface FinalizeQuickMintResponse {
  stagingKey: string
  assetAddress: string
  signature: string
  status: 'FINALIZING' | 'FINALIZED' | 'DEAD'
  metadataUri: string | null
  imageUri: string | null
  alreadyFinalizing: boolean
}

export interface QuickMintStatusResponse {
  assetAddress: string
  wallet: string
  status: 'STAGED' | 'FINALIZING' | 'FINALIZED' | 'DEAD'
  imageUri: string | null
  metadataUri: string | null
  signature: string | null
  createdAt: string
  finalizedAt: string | null
}

/** Park the image and get the terms for the transaction the user will sign. */
export function stageQuickMint(params: StageQuickMintParams): Promise<StageQuickMintResponse> {
  const form = new FormData()
  // React Native's FormData file part — streams straight from the file URI
  // instead of pulling a multi-MB JPEG into JS memory (same as mintWorkerFrame).
  form.append('image', {
    uri: params.photoUri,
    name: 'quick.jpg',
    type: 'image/jpeg',
  } as unknown as Blob)
  form.append('wallet', params.wallet)
  form.append('metadata', JSON.stringify(params.metadata))

  // No explicit content-type: the runtime sets it with the multipart boundary.
  return request<StageQuickMintResponse>('/quick/stage', { method: 'POST', body: form }, STAGE_TIMEOUT_MS)
}

/**
 * Hand the Worker the landed transaction so it can verify the fee and start
 * the Arweave upload.
 *
 * Idempotent by `stagingKey`: re-calling with the same signature returns the
 * in-flight state instead of paying twice, which is what makes it safe for the
 * app to retry this from its persisted queue as often as it likes.
 */
export function finalizeQuickMint(params: FinalizeQuickMintParams): Promise<FinalizeQuickMintResponse> {
  return request<FinalizeQuickMintResponse>(
    '/quick/finalize',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    },
    FINALIZE_TIMEOUT_MS,
  )
}

/**
 * Give back a stage the user abandoned by declining the wallet prompt.
 *
 * Best-effort and deliberately swallowing: it exists to free a quota slot and
 * an R2 object, so failing to reach the Worker is not worth surfacing on top of
 * a cancellation the user already knows about. The 24h sweep is the backstop.
 *
 * ONLY safe for a mint that was never signed. Once a signature exists the fee
 * may have landed, and the Worker refuses (409) rather than destroy the record
 * of work it owes — but the caller should not rely on that guard alone.
 */
export async function releaseQuickStage(stagingKey: string): Promise<void> {
  try {
    await request<unknown>(`/quick/stage/${stagingKey}`, { method: 'DELETE' }, READ_TIMEOUT_MS)
  } catch (err) {
    console.warn(`[quickMint] could not release stage ${stagingKey}:`, err instanceof Error ? err.message : err)
  }
}

/** Where a quick mint got to. 404s (RollApiError, status 404) if unknown. */
export function getQuickMintStatus(assetAddress: string): Promise<QuickMintStatusResponse> {
  return request<QuickMintStatusResponse>(`/quick/${assetAddress}`, { method: 'GET' }, READ_TIMEOUT_MS)
}
