import { useState, useEffect } from 'react'

const ALLDOMAINS_API = 'https://api.alldomains.id/v1/owner'

// TLD preference order — .skr first for Seeker users
const TLD_PRIORITY = ['.skr', '.sol', '.abc', '.bonk', '.poor', '.gm']

// Only cache successful lookups — failures retry on next render
const domainCache = new Map<string, string>()

interface DomainRecord {
  domain: string // full domain e.g. "user.skr"
  tld: string    // may or may not have leading dot e.g. "skr" or ".skr"
}

function normaliseTld(tld: string): string {
  return tld.startsWith('.') ? tld.toLowerCase() : `.${tld.toLowerCase()}`
}

async function fetchBestDomain(walletAddress: string): Promise<string | null> {
  const res = await fetch(`${ALLDOMAINS_API}/${walletAddress}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) return null

  const records: DomainRecord[] = await res.json()
  if (!Array.isArray(records) || records.length === 0) return null

  for (const priority of TLD_PRIORITY) {
    const match = records.find((r) => normaliseTld(r.tld) === priority)
    if (match) return match.domain.trim()
  }

  return records[0].domain.trim()
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

    const fetchDomain = async () => {
      setIsLoading(true)
      try {
        const best = await fetchBestDomain(walletAddress)
        if (best) {
          domainCache.set(walletAddress, best)
          setDomain(best)
        } else {
          setDomain(null)
        }
      } catch (error) {
        console.log('Domain lookup failed:', error)
        setDomain(null)
      } finally {
        setIsLoading(false)
      }
    }

    fetchDomain()
  }, [walletAddress])

  return { domain, isLoading }
}

export function formatWalletDisplay(address: string, domain: string | null, maxLength: number = 12): string {
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
