import { request } from './rollApi'

/**
 * Typed client for the Worker's $SKR quote endpoint (worker/src/skr/quote.ts,
 * `worker/README.md` "Pay with $SKR"). The Worker computes and PERSISTS the
 * quote — this call never decides an amount itself, it only asks for and
 * displays one.
 */

const QUOTE_TIMEOUT_MS = 15_000

export type SkrQuoteRequest =
  | { context: 'quick'; stagingKey: string }
  | { context: 'roll'; wallet: string; size: 12 | 24 }

export interface SkrQuoteSuccess {
  /** Atomic $SKR units (6 decimals) — the exact amount the transaction must transfer. */
  skrAmount: number
  expiresAt: string
  treasurySkrAta: string
}

export interface SkrQuoteUnavailable {
  unavailable: true
  reason: string
}

export type SkrQuoteResult = SkrQuoteSuccess | SkrQuoteUnavailable

export function quoteSkrFee(req: SkrQuoteRequest): Promise<SkrQuoteResult> {
  return request<SkrQuoteResult>(
    '/skr/quote',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    },
    QUOTE_TIMEOUT_MS,
  )
}

export function isSkrQuoteUnavailable(result: SkrQuoteResult): result is SkrQuoteUnavailable {
  return 'unavailable' in result && result.unavailable === true
}
