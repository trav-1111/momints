import { useState, useEffect } from 'react'
import { AppState } from 'react-native'
import { getClusterRpc } from '../store/network'
import { getCachedWalletDomain, resolveWalletDomain, WalletDomainError } from '../services/walletDomain'

interface DomainState {
  address: string | null
  rpc: string
  domain: string | null
  status: 'idle' | 'loading' | 'resolved' | 'not-found' | 'error'
  error: WalletDomainError | null
}

function initialState(address: string | null, rpc: string): DomainState {
  const cached = address ? getCachedWalletDomain(address, rpc) : undefined
  return {
    address,
    rpc,
    domain: cached?.domain ?? null,
    status: cached?.status ?? (address ? 'loading' : 'idle'),
    error: null,
  }
}

export function useWalletDomain(walletAddress: string | null) {
  const rpc = getClusterRpc()
  const [state, setState] = useState<DomainState>(() => initialState(walletAddress, rpc))

  useEffect(() => {
    let cancelled = false
    let running = false
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    setState(initialState(walletAddress, rpc))
    if (!walletAddress) return

    const refresh = async () => {
      if (cancelled || running || AppState.currentState === 'background') return
      running = true
      clearTimeout(refreshTimer)
      setState(initialState(walletAddress, rpc))
      try {
        const result = await resolveWalletDomain(walletAddress, rpc)
        if (cancelled) return
        setState({ address: walletAddress, rpc, domain: result.domain, status: result.status, error: null })
        refreshTimer = setTimeout(refresh, Math.max(1, result.expiresAt - Date.now()))
      } catch (error) {
        if (cancelled) return
        setState({
          address: walletAddress,
          rpc,
          domain: null,
          status: 'error',
          error: error instanceof WalletDomainError ? error : new WalletDomainError('rpc'),
        })
        // The resolver already tried three times. A foreground event or a
        // reconnect starts another bounded attempt; failures are never cached.
      } finally {
        running = false
      }
    }

    void refresh()
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active') void refresh()
    })
    return () => {
      cancelled = true
      clearTimeout(refreshTimer)
      subscription.remove()
    }
  }, [walletAddress, rpc])

  // Effects run after render: guard here too, so even the first frame of an
  // account switch cannot show the old wallet's name or seed an artist field.
  const current = state.address === walletAddress && state.rpc === rpc ? state : initialState(walletAddress, rpc)
  return { domain: current.domain, isLoading: current.status === 'loading', status: current.status, error: current.error }
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
