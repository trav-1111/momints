// HTTP-only transaction send + confirm. Umi's own confirmTransaction relies
// on a websocket subscription (web3.js Connection), which is not dependable
// in the Workers runtime — so the send goes through umi.rpc (plain HTTP
// sendRawTransaction) and confirmation is a bounded poll of
// getSignatureStatuses over raw JSON-RPC fetch. This is a bounded per-request
// wait, not continuous background polling.
import type { Transaction, Umi } from '@metaplex-foundation/umi'
import { withBackoff } from '../lib/retry'
import { signatureToBase58 } from './client'

const CONFIRM_POLL_INTERVAL_MS = 1500
const CONFIRM_TIMEOUT_MS = 45_000

interface SignatureStatus {
  confirmationStatus?: 'processed' | 'confirmed' | 'finalized'
  err: unknown
}

async function rpcCall<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (!res.ok) {
    throw new Error(`RPC ${method} failed: ${res.status} ${await res.text()}`)
  }
  const body = (await res.json()) as { result?: T; error?: { code: number; message: string } }
  if (body.error) {
    throw new Error(`RPC ${method} error ${body.error.code}: ${body.error.message}`)
  }
  return body.result as T
}

/** One entry of a jsonParsed transaction's account list, in balance-array order. */
export interface ParsedTransactionAccount {
  pubkey: string
  signer: boolean
  writable: boolean
}

/**
 * A landed transaction, as much of it as verification needs. `preBalances` and
 * `postBalances` are positionally aligned with `accountKeys`, which is what
 * lets a fee be read as a balance delta rather than by decoding instructions.
 */
export interface ParsedTransaction {
  slot: number
  blockTime: number | null
  transaction: { message: { accountKeys: ParsedTransactionAccount[] } }
  meta: {
    err: unknown
    fee: number
    preBalances: number[]
    postBalances: number[]
  } | null
}

/**
 * Fetch a landed transaction. Returns null when the RPC has no record of it —
 * which is NOT proof it failed: a very recent signature can be invisible for a
 * few seconds. Callers must treat null as "ask again", never as "rejected".
 */
export async function getTransaction(rpcUrl: string, signature: string): Promise<ParsedTransaction | null> {
  const result = await withBackoff('getTransaction', () =>
    rpcCall<ParsedTransaction | null>(rpcUrl, 'getTransaction', [
      signature,
      { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 },
    ]),
  )
  return result ?? null
}

export async function getSignatureStatus(rpcUrl: string, signature: string): Promise<SignatureStatus | null> {
  const result = await withBackoff('getSignatureStatuses', () =>
    rpcCall<{ value: (SignatureStatus | null)[] }>(rpcUrl, 'getSignatureStatuses', [
      [signature],
      { searchTransactionHistory: true },
    ]),
  )
  return result.value[0] ?? null
}

/**
 * Send a signed transaction and poll until 'confirmed' (or better). Throws on
 * on-chain error or timeout. A timeout does NOT mean the transaction failed —
 * it may still land; callers that need to know (frame mints) persist a
 * MINT_PENDING checkpoint with the signature first and re-check on resume.
 */
export async function sendAndConfirm(umi: Umi, rpcUrl: string, tx: Transaction): Promise<string> {
  const sigBytes = await withBackoff('sendTransaction', () => umi.rpc.sendTransaction(tx, { skipPreflight: false }))
  const signature = signatureToBase58(sigBytes)

  const deadline = Date.now() + CONFIRM_TIMEOUT_MS
  while (Date.now() < deadline) {
    const status = await getSignatureStatus(rpcUrl, signature)
    if (status?.err) {
      throw new Error(`Transaction ${signature} failed on-chain: ${JSON.stringify(status.err)}`)
    }
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      return signature
    }
    await new Promise((resolve) => setTimeout(resolve, CONFIRM_POLL_INTERVAL_MS))
  }
  throw new ConfirmTimeoutError(signature)
}

/** The send went out but confirmation didn't arrive in time — resolvable on resume. */
export class ConfirmTimeoutError extends Error {
  constructor(readonly signature: string) {
    super(
      `Transaction ${signature} was sent but not confirmed within ${CONFIRM_TIMEOUT_MS / 1000}s. ` +
        'It may still land — retry the operation; checkpointed paths will re-check before re-minting.',
    )
  }
}
