import { useState, useEffect } from 'react'

const METASAL_API = 'https://api.metasal.xyz/api/reverse'

const domainCache = new Map<string, string | null>()

interface MetasalDomain {
  name: string
  tld: string
  fullName: string
  createdAt: string
  expiresAt: string | null
}

interface MetasalResponse {
  address: string
  domains: MetasalDomain[]
  count: number
  mainDomain: string | null
  tldFilter: string
  success: boolean
}

function isSkrFullName(value: string | null | undefined): boolean {
  if (!value || typeof value !== 'string') return false
  return value.trim().toLowerCase().endsWith('.skr')
}

function pickSkrDomain(data: MetasalResponse): string | null {
  if (data.mainDomain && isSkrFullName(data.mainDomain)) {
    return data.mainDomain.trim()
  }
  for (const d of data.domains ?? []) {
    if (isSkrFullName(d.fullName)) {
      return d.fullName.trim()
    }
  }
  return null
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
      setDomain(domainCache.get(walletAddress) ?? null)
      return
    }

    const fetchDomain = async () => {
      setIsLoading(true)
      try {
        const response = await fetch(`${METASAL_API}/${walletAddress}?tld=skr`)
        const data: MetasalResponse = await response.json()

        if (data.success && data.count > 0) {
          const fullDomain = pickSkrDomain(data)
          domainCache.set(walletAddress, fullDomain)
          setDomain(fullDomain)
        } else {
          domainCache.set(walletAddress, null)
          setDomain(null)
        }
      } catch (error) {
        console.log('Domain lookup failed:', error)
        domainCache.set(walletAddress, null)
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
    if (domain.length <= maxLength) {
      return domain
    }
    const extension = domain.includes('.') ? domain.slice(domain.lastIndexOf('.')) : ''
    const name = domain.slice(0, domain.lastIndexOf('.'))
    const availableLength = maxLength - extension.length - 3
    if (availableLength > 0) {
      return `${name.slice(0, availableLength)}...${extension}`
    }
    return domain.slice(0, maxLength - 3) + '...'
  }

  return `${address.slice(0, 4)}...${address.slice(-4)}`
}
