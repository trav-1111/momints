import { getClusterRpc } from '../store/network'

/** A timeout, missing stage, or HTTP rejection alone cannot prove a mint is
 * unpaid. Clear only with finalized expiry + absent signature AND asset. */
export async function quickAttemptDidNotLand(entry: {
  signature: string
  assetAddress?: string
  lastValidBlockHeight?: string
}): Promise<boolean> {
  if (!entry.lastValidBlockHeight || !/^\d+$/.test(entry.lastValidBlockHeight)) return false
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  const rpc = async (method: string, params: unknown[]) => {
    const response = await fetch(getClusterRpc(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    if (!response.ok) throw new Error('Transaction outcome unavailable')
    const body = await response.json()
    if (body.error || !Object.hasOwn(body, 'result')) throw new Error('Transaction outcome unavailable')
    return body.result
  }
  try {
    const [statuses, account, height, transaction] = await Promise.all([
      rpc('getSignatureStatuses', [[entry.signature], { searchTransactionHistory: true }]),
      entry.assetAddress
        ? rpc('getAccountInfo', [entry.assetAddress, { commitment: 'finalized', encoding: 'base64' }])
        : Promise.resolve({ value: null }),
      rpc('getBlockHeight', [{ commitment: 'finalized' }]),
      rpc('getTransaction', [entry.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 }]),
    ])
    if (
      !Array.isArray(statuses?.value) ||
      statuses.value.length !== 1 ||
      !account ||
      !Object.hasOwn(account, 'value') ||
      !Number.isSafeInteger(height)
    )
      return false
    const status = statuses.value[0]
    return (
      account.value === null &&
      ((status?.err != null && status.confirmationStatus === 'finalized') ||
        (status === null && transaction === null && BigInt(height) > BigInt(entry.lastValidBlockHeight)))
    )
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
