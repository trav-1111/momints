import { useState, useEffect } from 'react'
import { Connection } from '@solana/web3.js'
import { TldParser } from '@onsol/tldparser'
import { getClusterRpc } from '../store/network'

// TLD preference order — .skr first for Seeker users
const TLD_PRIORITY = ['.skr', '.sol', '.abc', '.bonk', '.poor', '.gm']

// Only cache successful lookups — failures retry on next render
const domainCache = new Map<string, string>()

let _parser: TldParser | null = null
function getParser(): TldParser {
  if (!_parser) {
    const rpc = getClusterRpc()
    _parser = new TldParser(new Connection(rpc, 'confirmed'))
  }
  return _parser
}

async function fetchBestDomain(walletAddress: string): Promise<string | null> {
  try {
    const parser = getParser()
    // getParsedAllUserDomains accepts a string address directly
    const domains = await parser.getParsedAllUserDomains(walletAddress)
    if (!Array.isArray(domains) || domains.length === 0) return null

    // Pick the highest-priority TLD
    for (const priority of TLD_PRIORITY) {
      const match = domains.find((d) => d.domain.endsWith(priority))
      if (match) return match.domain
    }

    // Fall back to whichever domain exists
    return domains[0].domain ?? null
  } catch {
    return null
  }
}

export function useWalletDomain(walletAddress: string | null) {
  const [domain, setDomain] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!walletAddress) {
      setDomain(null)
      return
    }

    if (domainCache.has(walletAddress)) {
      setDomain(domainCache.get(walletAddress)!)
      return
    }

    let cancelled = false

    const fetchDomain = async () => {
      setIsLoading(true)
      try {
        const best = await fetchBestDomain(walletAddress)
        if (cancelled) return
        if (best) {
          domainCache.set(walletAddress, best)
          setDomain(best)
        } else {
          setDomain(null)
        }
      } catch {
        if (!cancelled) setDomain(null)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    fetchDomain()
    return () => {
      cancelled = true
    }
  }, [walletAddress])

  return { domain, isLoading }
}

export function formatWalletDisplay(
  address: string,
  domain: string | null,
  maxLength: number = 12
): string {
  if (domain) {
    if (domain.length <= maxLength) return domain
    const extension = domain.includes('.') ? domain.slice(domain.lastIndexOf('.')) : ''
    const name = domain.slice(0, domain.lastIndexOf('.'))
    const availableLength = maxLength - extension.length - 3
    if (availableLength > 0) return `${name.slice(0, availableLength)}...${extension}`
    return domain.slice(0, maxLength - 3) + '...'
  }
  return `${address.slice(0, 4)}...${address.slice(-4)}`
}
