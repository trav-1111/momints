import { useState, useEffect } from 'react'
import { getCachedWalletDomain, resolveWalletDomain, WalletDomainError } from '../services/walletDomain'

interface DomainState {
  address: string | null
  domain: string | null
  status: 'idle' | 'loading' | 'resolved' | 'not-found' | 'error'
  error: WalletDomainError | null
}
function initialState(address: string | null): DomainState {
  const cached = address ? getCachedWalletDomain(address) : undefined
  return {
    address,
    domain: cached?.domain ?? null,
    status: cached?.status ?? (address ? 'loading' : 'idle'),
    error: null,
  }
}

export function useWalletDomain(walletAddress: string | null) {
  const [state, setState] = useState<DomainState>(() => initialState(walletAddress))
  useEffect(() => {
    let cancelled = false
    setState(initialState(walletAddress))
    if (!walletAddress) return
    const resolve = async () => {
      try {
        const result = await resolveWalletDomain(walletAddress)
        if (cancelled) return
        setState({ address: walletAddress, domain: result.domain, status: result.status, error: null })
        if (__DEV__) console.log('[wallet-domain] UI identity state updated', result.domain ?? 'address fallback')
      } catch (error) {
        if (cancelled) return
        const safeError = error instanceof WalletDomainError ? error : new WalletDomainError('rpc')
        if (__DEV__) console.log('[wallet-domain] lookup error', safeError.code)
        setState({ address: walletAddress, domain: null, status: 'error', error: safeError })
      }
    }
    void resolve()
    return () => {
      cancelled = true
    }
  }, [walletAddress])
  const current = state.address === walletAddress ? state : initialState(walletAddress)
  return {
    domain: current.domain,
    isLoading: current.status === 'loading',
    status: current.status,
    error: current.error,
  }
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
