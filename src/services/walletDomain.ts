import { Connection, PublicKey } from '@solana/web3.js'
import { TldParser } from '@onsol/tldparser'

export const DOMAIN_CACHE_MS = 5 * 60_000
export const DOMAIN_MISS_CACHE_MS = 60_000
export const DOMAIN_TIMEOUT_MS = 10_000
const RETRY_DELAYS_MS = [1_000, 3_000]
const MAX_CACHE_ENTRIES = 64

export type DomainErrorCode = 'rpc' | 'timeout' | 'invalid-response' | 'invalid-address'

export class WalletDomainError extends Error {
  constructor(readonly code: DomainErrorCode) {
    // RPC exceptions can contain the endpoint's API key. Never expose the raw
    // exception through UI state or logs.
    super(`Wallet name lookup failed (${code})`)
    this.name = 'WalletDomainError'
  }
}

export interface WalletDomainResult {
  status: 'resolved' | 'not-found'
  domain: string | null
  expiresAt: number
}

// Display-only, bounded, in-memory state. Nothing is written to disk or used
// as a transaction identity. Include the RPC so a changed endpoint can recover.
const cache = new Map<string, WalletDomainResult>()
const inFlight = new Map<string, Promise<WalletDomainResult>>()
const cacheKey = (address: string, rpc: string) => `${rpc}\n${address}`

export function getCachedWalletDomain(address: string, rpc: string): WalletDomainResult | undefined {
  const key = cacheKey(address, rpc)
  const result = cache.get(key)
  if (result && result.expiresAt > Date.now()) return result
  cache.delete(key)
}

function selectSkrDomain(records: unknown): string | null {
  if (!Array.isArray(records)) throw new WalletDomainError('invalid-response')
  const names = records.map((record: unknown) => {
    if (!record || typeof record !== 'object' || !('domain' in record) || typeof record.domain !== 'string') {
      throw new WalletDomainError('invalid-response')
    }
    const domain = record.domain.trim()
    if (!domain || /[\s\u0000-\u001f\u007f]/.test(domain)) throw new WalletDomainError('invalid-response')
    return domain
  })
  // The SDK already returns the suffix. Sort independently of RPC ordering
  // and device locale; no primary-domain record is required.
  return names.filter(name => /^[^.]+\.skr$/i.test(name)).sort()[0] ?? null
}

async function lookupSkrDomain(address: string, rpc: string): Promise<string | null> {
  let owner: PublicKey
  try {
    owner = new PublicKey(address)
  } catch {
    throw new WalletDomainError('invalid-address')
  }

  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const connection = new Connection(rpc, {
      commitment: 'confirmed',
      // Retry the small lookup as a unit, rather than multiplying the SDK's
      // per-request 429 retries across every mounted wallet-name consumer.
      disableRetryOnRateLimit: true,
      fetch: (url, init) => fetch(url, { ...init, signal: controller.signal }),
    })
    const parser = new TldParser(connection)
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(new WalletDomainError('timeout'))
        controller.abort()
      }, DOMAIN_TIMEOUT_MS)
    })
    // Enumerating ALL TLDs repeatedly fetches this wallet's NFT metadata for
    // unrelated namespaces. The targeted API retains wrapped-domain support.
    const records = await Promise.race([parser.getParsedAllUserDomainsFromTld(owner, 'skr'), deadline])
    return selectSkrDomain(records)
  } catch (error) {
    throw error instanceof WalletDomainError ? error : new WalletDomainError('rpc')
  } finally {
    clearTimeout(timeout)
    controller.abort()
  }
}

export function resolveWalletDomain(address: string, rpc: string): Promise<WalletDomainResult> {
  const cached = getCachedWalletDomain(address, rpc)
  if (cached) return Promise.resolve(cached)
  const key = cacheKey(address, rpc)
  const pending = inFlight.get(key)
  if (pending) return pending

  const request = (async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const domain = await lookupSkrDomain(address, rpc)
        const result: WalletDomainResult = {
          status: domain ? 'resolved' : 'not-found',
          domain,
          expiresAt: Date.now() + (domain ? DOMAIN_CACHE_MS : DOMAIN_MISS_CACHE_MS),
        }
        for (const [entryKey, entry] of cache) {
          if (entry.expiresAt <= Date.now()) cache.delete(entryKey)
        }
        if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!)
        cache.set(key, result)
        return result
      } catch (error) {
        if (
          !(error instanceof WalletDomainError) ||
          error.code === 'invalid-address' ||
          error.code === 'invalid-response' ||
          attempt >= RETRY_DELAYS_MS.length
        ) throw error
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS_MS[attempt]))
      }
    }
  })().finally(() => inFlight.delete(key))
  inFlight.set(key, request)
  return request
}
