// Read-only MAINNET rent read for cost-plus fee pricing (fees/compute.ts).
// Deliberately MAINNET, not the Worker's own devnet SOLANA_RPC_URL: the
// SIMD-0437 rent reduction is a mainnet rollout, and Guard 2 validates the
// read against mainnet's known lamports_per_byte schedule (fees/config.ts) —
// a devnet read would not track it. Mirrors the read-only approach already
// proven out in scripts/mainnet-rent-quote.mjs.
//
// Read-only: getAccountInfo on the rent sysvar, no transaction ever sent.
//
// KNOWN RISK, not yet resolved: live-tested 2026-09-02, the public
// api.mainnet-beta.solana.com endpoint 403s ("Your IP or provider is
// blocked from this endpoint") from at least one cloud/datacenter egress IP
// — a blanket provider block, not the "SENDS only" behavior env.ts documents
// for api.devnet.solana.com. Whether Cloudflare Workers' production egress
// IPs are also blocked is UNCONFIRMED (untested from an actual deployed
// Worker — see README "Cost-plus fee pricing"). Guard 3 (fees/compute.ts)
// means this can never break minting even if it fails on every cycle — fees
// just stay frozen at the last successful compute — but the operator should
// set SOLANA_RPC_URL_MAINNET to a dedicated provider (e.g. Helius mainnet,
// same vendor as SOLANA_RPC_URL) rather than trust the public fallback here.
import { quickAssetSizeBytes, rentForSize, rollFrameAssetSizeBytes } from './coreSize'

const RENT_SYSVAR_ADDRESS = 'SysvarRent111111111111111111111111111111111'
const DEFAULT_MAINNET_RPC = 'https://api.mainnet-beta.solana.com'
const RPC_TIMEOUT_MS = 15_000

export interface RentReading {
  /** Effective lamports/byte this cycle — validated by the caller against Guard 2's known SIMD-0437 set. */
  lamportsPerByte: number
  /** Rent for one roll-frame Core asset. Feeds roll_fee_12/24 (fees/compute.ts). */
  rollFrameRentLamports: number
  /** Rent for a quick-mint asset. Reference only — never fed into a fee formula (see coreSize.ts). */
  quickAssetRentLamports: number
}

function decodeRentSysvar(base64: string): { lamportsPerByteYear: bigint; exemptionThreshold: number } {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {
    lamportsPerByteYear: view.getBigUint64(0, true),
    exemptionThreshold: view.getFloat64(8, true),
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300)
  } catch {
    return ''
  }
}

/** `rpcUrlOverride` is env.SOLANA_RPC_URL_MAINNET — optional; falls back to the same public endpoint the script uses. */
export async function readMainnetRent(rpcUrlOverride: string | undefined): Promise<RentReading> {
  const url = rpcUrlOverride?.trim() || DEFAULT_MAINNET_RPC

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getAccountInfo',
      params: [RENT_SYSVAR_ADDRESS, { encoding: 'base64' }],
    }),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(`Mainnet rent sysvar read failed: ${res.status} ${await safeText(res)}`)
  }
  const body = (await res.json()) as {
    result?: { value?: { data?: [string, string] } | null }
    error?: { message: string }
  }
  if (body.error) {
    throw new Error(`Mainnet rent sysvar read failed: ${body.error.message}`)
  }
  const dataB64 = body.result?.value?.data?.[0]
  if (!dataB64) {
    throw new Error('Mainnet rent sysvar read returned no account data')
  }

  const { lamportsPerByteYear, exemptionThreshold } = decodeRentSysvar(dataB64)
  const lamportsPerByte = Math.round(Number(lamportsPerByteYear) * exemptionThreshold)

  return {
    lamportsPerByte,
    rollFrameRentLamports: rentForSize(rollFrameAssetSizeBytes(), lamportsPerByte),
    quickAssetRentLamports: rentForSize(quickAssetSizeBytes(), lamportsPerByte),
  }
}
