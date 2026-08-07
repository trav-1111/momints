// Base58 (Bitcoin alphabet — no 0, O, I, l) at Solana's public-key length.
// A shape check, not a curve check: it rejects typos and junk before they
// reach an RPC, and callers that need real proof fetch the account.
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export function isBase58Address(value: unknown): value is string {
  return typeof value === 'string' && BASE58_ADDRESS.test(value)
}
