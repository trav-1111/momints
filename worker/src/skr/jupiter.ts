import { withBackoff } from '../lib/retry'
import { SKR_MINT_ADDRESS } from './config'

const JUPITER_QUOTE_URL = 'https://lite-api.jup.ag/swap/v1/quote'
const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112'
const QUOTE_TIMEOUT_MS = 10_000
const SLIPPAGE_BPS = 50

/** Above this, the route is thin/stale enough that the quote is not trustworthy — reject rather than store it. */
const MAX_PRICE_IMPACT_PCT = 0.2

interface JupiterQuoteResponse {
  outAmount?: string
  priceImpactPct?: string
}

/** Jupiter is unreachable, rate-limited past retry, or returned something unusable. Always retryable — nothing has been charged yet. */
export class SkrQuoteUnavailableError extends Error {}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

/**
 * How much $SKR (atomic units, 6 decimals) is worth `lamports` of SOL right
 * now, per Jupiter's public quote API (no key needed — same "lite-api" host
 * family already used elsewhere in this repo for price data).
 *
 * `lamports` here is already the DISCOUNTED fee (sol_fee x SKR_DISCOUNT,
 * applied by the caller) — this function only ever does the currency
 * conversion, never the discount math.
 */
export async function quoteSolToSkr(lamports: bigint): Promise<bigint> {
  if (lamports <= 0n) {
    throw new SkrQuoteUnavailableError(`Cannot quote a non-positive lamport amount (${lamports})`)
  }

  const url = `${JUPITER_QUOTE_URL}?inputMint=${WRAPPED_SOL_MINT}&outputMint=${SKR_MINT_ADDRESS}&amount=${lamports}&slippageBps=${SLIPPAGE_BPS}`

  let body: JupiterQuoteResponse
  try {
    body = await withBackoff('jupiter-quote', async () => {
      const res = await fetch(url, { signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS) })
      if (!res.ok) {
        throw new Error(`Jupiter quote failed: ${res.status} ${(await safeText(res)).slice(0, 300)}`)
      }
      return (await res.json()) as JupiterQuoteResponse
    })
  } catch (err) {
    throw new SkrQuoteUnavailableError(
      `Jupiter quote request failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // Guard: reject a garbled or missing amount rather than store garbage —
  // same "validate before trusting an external read" discipline as the
  // cost-plus fee recompute's own guards (fees/compute.ts).
  const outAmount = body.outAmount ? BigInt(body.outAmount) : null
  if (outAmount === null || outAmount <= 0n) {
    throw new SkrQuoteUnavailableError(`Jupiter quote had no usable outAmount: ${JSON.stringify(body)}`)
  }
  const priceImpact = body.priceImpactPct ? Number(body.priceImpactPct) : 0
  if (Number.isFinite(priceImpact) && Math.abs(priceImpact) > MAX_PRICE_IMPACT_PCT) {
    throw new SkrQuoteUnavailableError(
      `Jupiter quote price impact too high (${body.priceImpactPct}) — route may be too thin`,
    )
  }

  return outAmount
}
