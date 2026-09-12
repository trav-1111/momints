import { File, Paths } from 'expo-file-system'
import { ROLL_API_BASE } from '../config/rollApi'

export const RESOLVER_VERSION = 2
export const DOMAIN_CACHE_MS = 24 * 60 * 60_000
export const DOMAIN_TIMEOUT_MS = 8_000
const CACHE_FILE = 'wallet-domain-cache-v2.json'

type CacheRecord = { walletAddress: string; domain: string | null; resolvedAt: string; resolverVersion: number }
export type DomainErrorCode = 'http' | 'timeout' | 'rpc' | 'invalid-response' | 'invalid-address' | 'unavailable'
export class WalletDomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    readonly httpStatus?: number,
  ) {
    super(`Wallet name lookup failed (${code})`)
    this.name = 'WalletDomainError'
  }
}
export interface WalletDomainResult {
  status: 'resolved' | 'not-found'
  domain: string | null
  expiresAt: number
}

const cache = new Map<string, CacheRecord>()
const inFlight = new Map<string, Promise<WalletDomainResult>>()
let cacheReady: Promise<void> | null = null

function cacheFile(): File {
  return new File(Paths.document, CACHE_FILE)
}
function validAddress(address: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)
}
function validDomain(domain: unknown): domain is string {
  return typeof domain === 'string' && /^[^.]+\.skr$/i.test(domain)
}
function log(message: string, details?: string): void {
  if (__DEV__) console.log(`[wallet-domain] ${message}${details ? ` ${details}` : ''}`)
}

async function loadCache(): Promise<void> {
  try {
    const file = cacheFile()
    if (!file.exists) return
    const raw = JSON.parse(await file.text()) as unknown
    if (!Array.isArray(raw)) return
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const record = item as Partial<CacheRecord>
      if (
        record.resolverVersion !== RESOLVER_VERSION ||
        typeof record.walletAddress !== 'string' ||
        typeof record.resolvedAt !== 'string'
      )
        continue
      if (record.domain !== null && !validDomain(record.domain)) continue
      cache.set(record.walletAddress, record as CacheRecord)
    }
  } catch {
    log('cache read failed')
  }
}
function ensureCache(): Promise<void> {
  return (cacheReady ??= loadCache())
}
async function persistCache(): Promise<void> {
  try {
    cacheFile().write(JSON.stringify([...cache.values()]))
  } catch {
    log('cache write failed')
  }
}

export function getCachedWalletDomain(address: string): WalletDomainResult | undefined {
  const record = cache.get(address)
  if (
    !record ||
    !Number.isFinite(Date.parse(record.resolvedAt)) ||
    Date.now() - Date.parse(record.resolvedAt) > DOMAIN_CACHE_MS
  ) {
    if (record) cache.delete(address)
    return undefined
  }
  return {
    status: record.domain ? 'resolved' : 'not-found',
    domain: record.domain,
    expiresAt: Date.parse(record.resolvedAt) + DOMAIN_CACHE_MS,
  }
}

export async function clearWalletDomainCache(): Promise<void> {
  cache.clear()
  try {
    const file = cacheFile()
    if (file.exists) file.delete()
  } catch {
    /* development helper */
  }
}

async function requestDomain(address: string): Promise<WalletDomainResult> {
  if (!validAddress(address)) throw new WalletDomainError('invalid-address')
  if (!ROLL_API_BASE) throw new WalletDomainError('unavailable')
  log('lookup started', `${address.slice(0, 4)}...${address.slice(-4)}`)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DOMAIN_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(`${ROLL_API_BASE}/identity/skr?wallet=${encodeURIComponent(address)}`, {
      signal: controller.signal,
    })
  } catch {
    throw new WalletDomainError(controller.signal.aborted ? 'timeout' : 'rpc')
  } finally {
    clearTimeout(timer)
  }
  log('worker HTTP status', String(response.status))
  if (response.status === 503 || response.status === 429)
    throw new WalletDomainError(response.status === 429 ? 'http' : 'rpc', response.status)
  if (!response.ok) throw new WalletDomainError('http', response.status)
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new WalletDomainError('invalid-response')
  }
  if (!body || typeof body !== 'object' || !('domain' in body)) throw new WalletDomainError('invalid-response')
  const domain = (body as { domain: unknown }).domain
  if (domain !== null && !validDomain(domain)) throw new WalletDomainError('invalid-response')
  const now = new Date().toISOString()
  const result = {
    status: domain ? ('resolved' as const) : ('not-found' as const),
    domain,
    expiresAt: Date.now() + DOMAIN_CACHE_MS,
  }
  cache.set(address, { walletAddress: address, domain, resolvedAt: now, resolverVersion: RESOLVER_VERSION })
  await persistCache()
  log(domain ? 'domain found' : 'confirmed no-domain', domain ?? '')
  return result
}

export async function resolveWalletDomain(address: string): Promise<WalletDomainResult> {
  await ensureCache()
  const cached = getCachedWalletDomain(address)
  if (cached) {
    log('cache hit', `${address.slice(0, 4)}...${address.slice(-4)}`)
    return cached
  }
  log('cache miss', `${address.slice(0, 4)}...${address.slice(-4)}`)
  const pending = inFlight.get(address)
  if (pending) return pending
  const request = requestDomain(address).finally(() => inFlight.delete(address))
  inFlight.set(address, request)
  return request
}
