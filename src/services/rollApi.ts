import { ROLL_API_BASE } from '../config/rollApi'

/**
 * Typed client for the roll backend Worker. Mirrors the endpoints documented
 * in `worker/README.md`; response shapes come from `worker/src/rolls/*.ts`.
 */

export class RollApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'RollApiError'
  }

  /**
   * The Worker checkpoints every step in D1, so these leave the frame's work
   * intact and re-POSTing the same frame resumes it: 503 is an operator
   * funding stall, 504 is a mint that was sent but not confirmed in time
   * (re-POST checks the chain rather than double-minting).
   */
  get resumable(): boolean {
    return this.status === 503 || this.status === 504
  }

  /** Wallet already has an open roll — finish or complete it first. */
  get isOpenRollConflict(): boolean {
    return this.status === 409
  }
}

// A frame request does an Arweave upload plus an on-chain mint and confirm
// server-side; roll creation additionally renders and uploads the cover.
const FRAME_TIMEOUT_MS = 90_000
const CREATE_TIMEOUT_MS = 90_000
const READ_TIMEOUT_MS = 20_000

/**
 * Shared transport for every Worker call — rolls and quick mints alike.
 * Exported so quickMintApi.ts gets the same timeout-to-504 mapping and the
 * same error shape rather than a second, subtly different fetch wrapper.
 */
export async function request<T>(path: string, init: RequestInit, timeoutMs: number): Promise<T> {
  if (!ROLL_API_BASE) {
    throw new RollApiError(0, 'Roll backend not configured — set EXPO_PUBLIC_ROLL_API in .env and restart Expo')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(`${ROLL_API_BASE}${path}`, { ...init, signal: controller.signal })
  } catch (e) {
    if (controller.signal.aborted) {
      // Surfaced as 504 so callers treat a client-side timeout the same as the
      // Worker's own confirm timeout: resumable, never a reason to re-mint.
      throw new RollApiError(504, `Roll backend timed out after ${Math.round(timeoutMs / 1000)}s — retry to resume`)
    }
    throw new RollApiError(0, `Roll backend unreachable: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    clearTimeout(timer)
  }

  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    /* non-JSON error body — fall back to the raw text below */
  }

  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : text || `HTTP ${res.status}`
    throw new RollApiError(res.status, message)
  }
  return body as T
}

// ─── Create a roll ────────────────────────────────────────────────────────────

export interface CreateRollBody {
  wallet: string
  size: 12 | 24
  /** User-editable vanity display name. */
  artist?: string
  /** Verified SKR handle, resolved app-side. Defaults to the wallet address. */
  skrIdentity?: string
  /** yyyy-mm-dd, so the roll is named for the shooter's day, not UTC. */
  localDate?: string
  /** Signature of the wallet's fee transfer to the treasury — verified on-chain by the Worker before it spends anything. */
  feeSignature: string
}

export interface CreateRollResponse {
  collectionAddress: string
  name: string
  size: number
  artist: string
  skrIdentity: string
  coverUri: string
  metadataUri: string
  feeLamports: number
  signature: string
  status: 'OPEN'
  mintedCount: number
  fundingWarning: string | null
}

export function createWorkerRoll(body: CreateRollBody): Promise<CreateRollResponse> {
  return request<CreateRollResponse>(
    '/rolls',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    CREATE_TIMEOUT_MS,
  )
}

// ─── Mint a frame ─────────────────────────────────────────────────────────────

export interface MintFrameParams {
  collectionAddress: string
  /** 1-based position in the roll. The client owns frame ordering. */
  frameIndex: number
  /** Local file URI of the frame image. */
  photoUri: string
  description?: string
  attributes?: { trait_type: string; value: string }[]
}

export interface MintFrameResponse {
  collectionAddress: string
  frameIndex: number
  frameName: string
  assetAddress: string
  imageUri: string
  metadataUri: string
  signature: string | null
  alreadyMinted: boolean
  rollStatus: 'OPEN' | 'COMPLETE'
  mintedCount: number
  fundingWarning: string | null
}

/**
 * Mint one frame. Idempotent by (collection, frameIndex): re-POSTing a frame
 * that already minted returns the existing asset, and a partially-processed
 * frame resumes from its checkpoint without re-uploading or re-minting. So
 * retrying a failed frame is always safe.
 */
export function mintWorkerFrame(params: MintFrameParams): Promise<MintFrameResponse> {
  const { collectionAddress, frameIndex, photoUri, description, attributes } = params

  const form = new FormData()
  // React Native's FormData file part — a JS File/Blob would need the bytes in
  // memory; this streams straight from the file URI.
  form.append('image', {
    uri: photoUri,
    name: `frame-${String(frameIndex).padStart(3, '0')}.jpg`,
    type: 'image/jpeg',
  } as unknown as Blob)
  form.append('frameIndex', String(frameIndex))
  if (description) form.append('description', description)
  if (attributes?.length) form.append('attributes', JSON.stringify(attributes))

  // No explicit content-type: the runtime sets it with the multipart boundary.
  return request<MintFrameResponse>(
    `/rolls/${collectionAddress}/frames`,
    { method: 'POST', body: form },
    FRAME_TIMEOUT_MS,
  )
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export interface OpenRollSummary {
  collectionAddress: string
  name: string
  size: number
  mintedCount: number
  status: 'OPEN' | 'COMPLETE'
}

/** The wallet's open roll, or null. The Worker allows at most one. */
export async function getOpenWorkerRoll(wallet: string): Promise<OpenRollSummary | null> {
  const { openRoll } = await request<{ openRoll: OpenRollSummary | null }>(
    `/rolls/open?wallet=${encodeURIComponent(wallet)}`,
    { method: 'GET' },
    READ_TIMEOUT_MS,
  )
  return openRoll
}

export interface CompleteRollResponse {
  collectionAddress: string
  name: string
  size: number
  mintedCount: number
  status: 'COMPLETE'
  alreadyComplete: boolean
}

/**
 * Close a roll early, freeing the wallet's single open-roll slot. A roll only
 * auto-completes once every frame of its purchased size has minted, so a
 * discarded roll — or one with a frame that never minted — needs this to avoid
 * blocking every future roll. Idempotent.
 */
export function completeWorkerRoll(collectionAddress: string): Promise<CompleteRollResponse> {
  return request<CompleteRollResponse>(`/rolls/${collectionAddress}/complete`, { method: 'POST' }, READ_TIMEOUT_MS)
}

export interface WorkerFrameSummary {
  frameIndex: number
  status: 'IMAGE_UPLOADED' | 'METADATA_UPLOADED' | 'MINT_PENDING' | 'MINTED'
  assetAddress: string | null
  imageUri: string | null
  metadataUri: string | null
  signature: string | null
  updatedAt: string
}

export interface WorkerRollDetail extends OpenRollSummary {
  wallet: string
  artist: string
  skrIdentity: string
  coverUri: string
  metadataUri: string
  createdAt: string
  frames: WorkerFrameSummary[]
}

export function getWorkerRoll(collectionAddress: string): Promise<WorkerRollDetail> {
  return request<WorkerRollDetail>(`/rolls/${collectionAddress}`, { method: 'GET' }, READ_TIMEOUT_MS)
}
