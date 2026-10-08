import type { RollDb, RollRow } from '../db'
import { HttpError } from '../lib/http'
import bs58 from 'bs58'

const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/
const AUTH_PATTERN = /^Roll ([A-Za-z0-9_-]{43})$/

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function assertRollCapability(capability: unknown): asserts capability is string {
  if (typeof capability !== 'string' || !CAPABILITY_PATTERN.test(capability)) {
    throw new HttpError(400, 'rollCapability must be a 256-bit base64url token')
  }
}

export async function hashRollCapability(capability: string): Promise<string> {
  assertRollCapability(capability)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(capability))
  return hex(new Uint8Array(digest))
}

function equalHash(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let different = 0
  for (let index = 0; index < left.length; index++) {
    different |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return different === 0
}

export function readRollCapability(request: Request): string {
  const authorization = request.headers.get('authorization')
  if (!authorization) throw new HttpError(401, 'Roll authorization is required')
  const match = AUTH_PATTERN.exec(authorization)
  if (!match) throw new HttpError(401, 'Roll authorization must use Authorization: Roll <capability>')
  return match[1]
}

/**
 * Authorize before parsing a multipart body or performing any mutation.
 * Protocol-v1 rows intentionally have no bearer secret and require an
 * explicit migration path; they are never silently treated as authorized.
 */
export async function authorizeRollRequest(db: RollDb, request: Request, collectionAddress: string): Promise<RollRow> {
  const roll = await db.getRoll(collectionAddress)
  if (!roll) throw new HttpError(404, `No roll with collection address ${collectionAddress}`)
  if (!roll.auth_hash) {
    throw new HttpError(428, 'This pre-contract roll must be securely recovered before it can be changed.')
  }
  const actualHash = await hashRollCapability(readRollCapability(request))
  if (!equalHash(actualHash, roll.auth_hash)) throw new HttpError(403, 'Roll authorization was refused')
  return roll
}

export function legacyClaimMessage(input: {
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

export async function verifyLegacyClaimSignature(input: {
  collectionAddress: string
  wallet: string
  capabilityHash: string
  issuedAt: string
  signature: string
}): Promise<boolean> {
  const timestamp = Date.parse(input.issuedAt)
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) {
    throw new HttpError(400, 'Legacy roll authorization has expired')
  }
  let publicKeyBytes: Uint8Array
  let signatureBytes: Uint8Array
  try {
    publicKeyBytes = bs58.decode(input.wallet)
    signatureBytes = Uint8Array.from(atob(input.signature), (character) => character.charCodeAt(0))
  } catch {
    throw new HttpError(400, 'Legacy roll authorization has invalid encoding')
  }
  if (publicKeyBytes.length !== 32 || signatureBytes.length !== 64) {
    throw new HttpError(400, 'Legacy roll authorization has invalid key or signature length')
  }
  const publicKey = await crypto.subtle.importKey('raw', publicKeyBytes, { name: 'Ed25519' }, false, ['verify'])
  const message = new TextEncoder().encode(legacyClaimMessage(input))
  return crypto.subtle.verify({ name: 'Ed25519' }, publicKey, signatureBytes, message)
}
