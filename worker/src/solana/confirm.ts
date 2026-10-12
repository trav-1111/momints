// HTTP-only transaction send + confirm. Umi's own confirmTransaction relies
// on a websocket subscription (web3.js Connection), which is not dependable
// in the Workers runtime — so the send goes through umi.rpc (plain HTTP
// sendRawTransaction) and confirmation is a bounded poll of
// getSignatureStatuses over raw JSON-RPC fetch. This is a bounded per-request
// wait, not continuous background polling.
import type { Transaction, Umi } from '@metaplex-foundation/umi'
import bs58 from 'bs58'
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

/** One entry of `meta.preTokenBalances`/`postTokenBalances` — indexed by `accountIndex`, NOT positionally aligned like preBalances/postBalances (SPL balances only exist for the subset of accounts that hold a token account). */
export interface ParsedTokenBalance {
  accountIndex: number
  mint: string
  owner?: string
  uiTokenAmount: { amount: string; decimals: number }
}

/**
 * A landed transaction, as much of it as verification needs. `preBalances` and
 * `postBalances` are positionally aligned with `accountKeys`, which is what
 * lets a fee be read as a balance delta rather than by decoding instructions.
 * `preTokenBalances`/`postTokenBalances` are the SPL-token equivalent, used
 * for the $SKR fee check (skr/verify helpers) the same way.
 */
export interface ParsedTransaction {
  slot: number
  blockTime: number | null
  transaction: {
    message: {
      accountKeys: ParsedTransactionAccount[]
      instructions?: any[]
    }
  }
  meta: {
    err: unknown
    fee: number
    preBalances: number[]
    postBalances: number[]
    preTokenBalances?: ParsedTokenBalance[]
    postTokenBalances?: ParsedTokenBalance[]
    logMessages?: string[] | null
    innerInstructions?: { instructions: any[] }[] | null
  } | null
}

/**
 * Extract all SPL Memo strings from a confirmed transaction.
 * Inspects parsed instructions, raw base58 instruction data, inner
 * instructions, and Solana runtime program execution logs.
 */
export function extractTransactionMemos(tx: ParsedTransaction): string[] {
  const memos: string[] = []

  function checkInstruction(ix: any) {
    if (!ix) return
    const program = typeof ix.program === 'string' ? ix.program : ''
    const programId = typeof ix.programId === 'string' ? ix.programId : ''
    const isMemo =
      program === 'spl-memo' ||
      programId === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' ||
      programId === 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo'

    if (isMemo) {
      if (typeof ix.parsed === 'string') {
        memos.push(ix.parsed)
      } else if (ix.parsed && typeof ix.parsed === 'object' && typeof ix.parsed.info?.memo === 'string') {
        memos.push(ix.parsed.info.memo)
      } else if (typeof ix.data === 'string') {
        try {
          const decoded = bs58.decode(ix.data)
          memos.push(new TextDecoder().decode(decoded))
        } catch {
          // ignore invalid base58
        }
      }
    }
  }

  const instructions = (tx.transaction?.message as any)?.instructions
  if (Array.isArray(instructions)) {
    for (const ix of instructions) {
      checkInstruction(ix)
    }
  }

  const inner = tx.meta?.innerInstructions
  if (Array.isArray(inner)) {
    for (const group of inner) {
      if (Array.isArray(group?.instructions)) {
        for (const ix of group.instructions) {
          checkInstruction(ix)
        }
      }
    }
  }

  const logs = tx.meta?.logMessages
  if (Array.isArray(logs)) {
    for (const log of logs) {
      const match = /^Program log: Memo \(len \d+\): ("?)(.*?)\1$/.exec(log)
      if (match && match[2]) {
        memos.push(match[2])
      }
    }
  }

  return Array.from(new Set(memos))
}

/** Lamport balance of any account — dashboard wallet reads (ops/dashboard.ts). Zero for an unfunded/nonexistent account, same as the RPC itself. */
export async function getSolBalance(rpcUrl: string, address: string): Promise<number> {
  const result = await withBackoff('getBalance', () => rpcCall<{ value: number }>(rpcUrl, 'getBalance', [address]))
  return result.value
}

/** One SPL token account's raw balance — dashboard wallet reads. Null when the account doesn't exist yet, not an error (mirrors TurboClient.getBalance()'s 404-is-zero pattern). */
export async function getTokenAccountBalance(
  rpcUrl: string,
  tokenAccount: string,
): Promise<{ amount: string; decimals: number } | null> {
  const result = await withBackoff('getTokenAccountBalance', () =>
    rpcCall<{ value: { amount: string; decimals: number } | null } | null>(rpcUrl, 'getTokenAccountBalance', [
      tokenAccount,
    ]).catch((err: unknown) => {
      // A never-initialized token account 400s ("could not find account") rather than returning value: null.
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('could not find account')) return { value: null }
      throw err
    }),
  )
  return result?.value ?? null
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

export async function getFinalizedBlockHeight(rpcUrl: string): Promise<number> {
  return rpcCall<number>(rpcUrl, 'getBlockHeight', [{ commitment: 'finalized' }])
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
