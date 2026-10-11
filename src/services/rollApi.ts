import { ROLL_API_BASE } from '../config/rollApi'
import { Buffer } from '@craftzdog/react-native-buffer'
import {
  bindStagedRollCapability,
  clearRecoveryRollCapability,
  createRollCapability,
  getPendingRecoveryRollCapability,
  getRollCapability,
  hashRollCapability,
  saveRollCapability,
  stageRecoveryRollCapability,
} from './rollCapability'

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
  quoteId?: string
  aspect?: 'full' | '1:1' | '4:3' | '16:9'
  filmMode?: 'color' | 'bw'
  wallet: string
  size: 12 | 24
  /** Immutable recipe identity selected before loading the roll. */
  filmStockId: string
  /** User-editable vanity display name. */
  artist?: string
  /** Verified SKR handle, resolved app-side. Defaults to the wallet address. */
  skrIdentity?: string
  /** yyyy-mm-dd, so the roll is named for the shooter's day, not UTC. */
  localDate?: string
  /** Signature of the wallet's fee transfer to the treasury — verified on-chain by the Worker before it spends anything. */
  feeSignature: string
  /** Which currency paid the fee. Defaults 'SOL'. See services/skrApi.ts. */
  payment?: 'SOL' | 'SKR'
  /** Device-held 256-bit bearer capability; Worker persists only its hash. */
  rollCapability: string
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
  status: 'OPEN' | 'COMPLETE'
  mintedCount: number
  fundingWarning: string | null
  filmStockId: string
}

export interface RollPurchaseQuote {
  quoteId: string
  amount: number
  expiresAt: string
  treasurySkrAta?: string
}

export function prepareWorkerRoll(body: {
  wallet: string
  size: 12 | 24
  payment: 'SOL' | 'SKR'
  rollCapability: string
}): Promise<RollPurchaseQuote> {
  return request(
    '/rolls/quote',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    READ_TIMEOUT_MS,
  )
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
  mime: 'image/jpeg'
  byteLength: number
  width: number
  height: number
  imageHash: string
}

async function rollAuthorization(collectionAddress: string): Promise<Record<string, string>> {
  const capability = await getRollCapability(collectionAddress)
  if (!capability) {
    throw new RollApiError(428, 'This roll is missing its device authorization and cannot be changed safely.')
  }
  return { Authorization: `Roll ${capability}` }
}

// Two calls for the same frame must never both be in flight at once: the
// Worker checkpoints make a *sequential* retry safe, but nothing on the wire
// stops a concurrent one from racing its own create() transaction against an
// earlier attempt that's still running (this is exactly what happened when a
// client navigation left a frame request running in the background and a
// later retry raced it — see worker/src/rolls/frames.ts's per-frame lock for
// the server-side half of this fix). Keyed module-level rather than in any
// component's state, so it holds across navigating away from and back to the
// mint-progress screen, or a fresh remount calling mintWorkerFrame again.
const inFlightFrameMints = new Map<string, Promise<MintFrameResponse>>()

export function hasInFlightRollFrameMints(collectionAddress: string): boolean {
  return [...inFlightFrameMints.keys()].some((key) => key.startsWith(`${collectionAddress}:`))
}

/**
 * Mint one frame. Idempotent by (collection, frameIndex): re-POSTing a frame
 * that already minted returns the existing asset, and a partially-processed
 * frame resumes from its checkpoint without re-uploading or re-minting. So
 * retrying a failed frame is always safe — and a retry for a frame whose
 * earlier attempt hasn't resolved yet reuses that attempt instead of sending
 * a second, concurrent request.
 */
export function mintWorkerFrame(params: MintFrameParams): Promise<MintFrameResponse> {
  const { collectionAddress, frameIndex, photoUri, description, attributes } = params
  const key = `${collectionAddress}:${frameIndex}`

  const inFlight = inFlightFrameMints.get(key)
  if (inFlight) return inFlight

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
  const promise = rollAuthorization(collectionAddress)
    .then((headers) =>
      request<MintFrameResponse>(
        `/rolls/${collectionAddress}/frames`,
        { method: 'POST', headers, body: form },
        FRAME_TIMEOUT_MS,
      ),
    )
    .finally(() => {
      inFlightFrameMints.delete(key)
    })
  inFlightFrameMints.set(key, promise)
  return promise
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
  if (openRoll) await bindStagedRollCapability(wallet, openRoll.collectionAddress)
  return openRoll
}

function legacyClaimMessage(input: {
  collectionAddress: string
  wallet: string
  capabilityHash: string
  issuedAt: string
}): string {
  return [
    'Momints roll authorization v1',
    `Collection: ${input.collectionAddress}`,
    `Wallet: ${input.wallet}`,
    `Capability SHA-256: ${input.capabilityHash}`,
    `Issued at: ${input.issuedAt}`,
  ].join('\n')
}

export function extractSignatureBytes(signedPayload: Uint8Array): Uint8Array {
  if (signedPayload.length < 64) {
    throw new Error(`Invalid signature from wallet: expected at least 64 bytes, got ${signedPayload.length}`)
  }
  return signedPayload.length === 64 ? signedPayload : signedPayload.subarray(signedPayload.length - 64)
}

/** One-time wallet-signed capability recovery for a pre-contract open roll. */
export async function ensureWorkerRollAuthorization(
  collectionAddress: string,
  wallet: string,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>,
): Promise<void> {
  // Reuse a staged recovery capability (from a previous retry or dropped response),
  // or an existing local capability for this collection.
  let rollCapability =
    (await getPendingRecoveryRollCapability(collectionAddress)) || (await getRollCapability(collectionAddress))

  if (!rollCapability) {
    rollCapability = createRollCapability()
    await stageRecoveryRollCapability(collectionAddress, rollCapability)
  }

  const issuedAt = new Date().toISOString()
  const capabilityHash = hashRollCapability(rollCapability)
  const message = legacyClaimMessage({ collectionAddress, wallet, capabilityHash, issuedAt })
  const signedPayload = await signMessage(new TextEncoder().encode(message))
  const signature = extractSignatureBytes(signedPayload)
  await request(
    `/rolls/${collectionAddress}/authorize`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        wallet,
        rollCapability,
        issuedAt,
        signature: Buffer.from(signature).toString('base64'),
      }),
    },
    READ_TIMEOUT_MS,
  )
  await saveRollCapability(collectionAddress, rollCapability)
  await clearRecoveryRollCapability(collectionAddress)
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
export async function completeWorkerRoll(
  collectionAddress: string,
  reason: 'user-discard' | 'user-close-unused' = 'user-close-unused',
): Promise<CompleteRollResponse> {
  const headers = await rollAuthorization(collectionAddress)
  return request<CompleteRollResponse>(
    `/rolls/${collectionAddress}/complete`,
    { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ reason }) },
    READ_TIMEOUT_MS,
  )
}

export interface WorkerFrameSummary {
  frameIndex: number
  status: 'IMAGE_UPLOADED' | 'METADATA_UPLOADED' | 'MINT_PENDING' | 'MINTED'
  assetAddress: string | null
  imageUri: string | null
  metadataUri: string | null
  signature: string | null
  mime: string | null
  byteLength: number | null
  width: number | null
  height: number | null
  imageHash: string | null
  updatedAt: string
}

export interface WorkerRollDetail extends OpenRollSummary {
  filmStockId?: string | null
  filmMode?: 'color' | 'bw' | null
  aspect?: 'full' | '1:1' | '4:3' | '16:9' | null
  wallet: string
  artist: string
  skrIdentity: string
  coverUri: string
  metadataUri: string
  createdAt: string
  /** Worker added the verified developed marker before revoking its delegate. */
  developedOnChain: boolean
  frames: WorkerFrameSummary[]
}

export async function getWorkerRoll(collectionAddress: string): Promise<WorkerRollDetail> {
  const headers = await rollAuthorization(collectionAddress)
  return request<WorkerRollDetail>(`/rolls/${collectionAddress}`, { method: 'GET', headers }, READ_TIMEOUT_MS)
}

// ─── Fees ─────────────────────────────────────────────────────────────────────

/**
 * Cost-plus mint fees (worker/src/fees/compute.ts), recomputed every 3h from
 * live rent + storage cost. This is the SAME cache the Worker's own
 * verify.ts checks payment against for a roll — so a roll fee must be
 * fetched here right before paying (see rollCollection.ts's payRollFee),
 * never hardcoded or read from a value captured when a screen opened.
 */
export interface WorkerFeesResponse {
  quickFeeLamports: number
  rollFee12Lamports: number
  rollFee24Lamports: number
  computedAt: string
  lastGood: boolean
}

export function getWorkerFees(): Promise<WorkerFeesResponse> {
  return request<WorkerFeesResponse>('/fees', { method: 'GET' }, READ_TIMEOUT_MS)
}
