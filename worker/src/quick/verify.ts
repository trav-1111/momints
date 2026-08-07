import type { Umi } from '@metaplex-foundation/umi'
import { getTransaction, type ParsedTransaction } from '../solana/confirm'
import { QUICK_MINT_FEE_LAMPORTS } from './config'

/**
 * Proof that a quick mint was paid for.
 *
 * This module is the enforcement point for the treasury-safety invariant: no
 * Arweave spend without a confirmed, fee-paying mint already on-chain. Every
 * fact below is read from the LANDED transaction and the on-chain account —
 * nothing the client sends is trusted, including the fee amount, the payer,
 * and which asset the payment belongs to.
 */
export interface QuickVerifyRequest {
  signature: string
  assetAddress: string
  /** Wallet recorded at stage time. The transaction must have been paid by it. */
  wallet: string
  treasury: string
  placeholderUri: string
}

/**
 * `retryable` is the whole reason this is a result type rather than a thrown
 * error. By the time verification runs the USER HAS ALREADY PAID, so
 * "I couldn't check" and "this is invalid" must never collapse into the same
 * response: the first has to leave the stage intact for another attempt, the
 * second is a definitive refusal.
 */
export type QuickVerifyResult =
  | { ok: true; feeLamports: number; owner: string }
  | { ok: false; retryable: boolean; reason: string }

function retry(reason: string): QuickVerifyResult {
  return { ok: false, retryable: true, reason }
}

function reject(reason: string): QuickVerifyResult {
  return { ok: false, retryable: false, reason }
}

/**
 * Read what the treasury actually received in this transaction.
 *
 * Deliberately a balance delta rather than an instruction decode: it is
 * indifferent to instruction ordering, to extra instructions, to CPI, and to
 * whether the transfer was a plain System transfer at all. Whatever route the
 * lamports took, this is the net that landed.
 */
function lamportsReceived(tx: ParsedTransaction, address: string): number | null {
  const keys = tx.transaction.message.accountKeys
  const index = keys.findIndex((k) => k.pubkey === address)
  if (index === -1 || !tx.meta) return null
  const pre = tx.meta.preBalances[index]
  const post = tx.meta.postBalances[index]
  if (typeof pre !== 'number' || typeof post !== 'number') return null
  return post - pre
}

/**
 * Verify that `signature` is a landed transaction which both paid the quick-mint
 * fee and created `assetAddress` on the placeholder URI.
 *
 * The checks are ordered cheapest-first, but the two that carry the weight are
 * the last two: the asset account must have been CREATED BY THIS TRANSACTION
 * (so an unrelated fee transfer cannot be pointed at a pre-existing asset), and
 * the on-chain asset must actually look like one of ours. Together with the
 * UNIQUE constraint on quick_mints.signature, that makes one payment buy
 * exactly one upload.
 */
export async function verifyQuickMintPayment(
  umi: Umi,
  rpcUrl: string,
  req: QuickVerifyRequest,
): Promise<QuickVerifyResult> {
  let tx: ParsedTransaction | null
  try {
    tx = await getTransaction(rpcUrl, req.signature)
  } catch (err) {
    return retry(`RPC could not be reached to verify ${req.signature}: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Absent is not invalid — a signature confirmed seconds ago may not be
  // queryable yet. Anything that says "not paid" has to come from data we
  // actually read.
  if (!tx || !tx.meta) {
    return retry(`Transaction ${req.signature} is not visible to the RPC yet`)
  }
  if (tx.meta.err !== null) {
    return reject(`Transaction ${req.signature} failed on-chain: ${JSON.stringify(tx.meta.err)}`)
  }

  const feePayer = tx.transaction.message.accountKeys[0]?.pubkey
  if (feePayer !== req.wallet) {
    return reject(`Transaction ${req.signature} was paid by ${feePayer ?? 'nobody'}, not by the staging wallet ${req.wallet}`)
  }

  const received = lamportsReceived(tx, req.treasury)
  if (received === null) {
    return reject(`Transaction ${req.signature} does not touch the treasury account ${req.treasury}`)
  }
  if (received < QUICK_MINT_FEE_LAMPORTS) {
    return reject(`Transaction ${req.signature} paid the treasury ${received} lamports, below the ${QUICK_MINT_FEE_LAMPORTS} required`)
  }

  // The asset account must be NEW in this transaction. Without this, a wallet
  // could pay the fee once and then claim any number of previously-minted
  // assets against separate staged images.
  const keys = tx.transaction.message.accountKeys
  const assetIndex = keys.findIndex((k) => k.pubkey === req.assetAddress)
  if (assetIndex === -1) {
    return reject(`Asset ${req.assetAddress} does not appear in transaction ${req.signature}`)
  }
  if (tx.meta.preBalances[assetIndex] !== 0 || (tx.meta.postBalances[assetIndex] ?? 0) <= 0) {
    return reject(`Asset ${req.assetAddress} was not created by transaction ${req.signature}`)
  }

  const { safeFetchAssetV1 } = await import('@metaplex-foundation/mpl-core')
  const { publicKey } = await import('@metaplex-foundation/umi')

  let asset
  try {
    asset = await safeFetchAssetV1(umi, publicKey(req.assetAddress))
  } catch (err) {
    return retry(`Could not read asset ${req.assetAddress}: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!asset) {
    // The transaction says it was created, so this is a lagging read, not a lie.
    return retry(`Asset ${req.assetAddress} is not readable yet`)
  }

  if (asset.uri !== req.placeholderUri) {
    return reject(`Asset ${req.assetAddress} was minted against ${asset.uri}, not the quick-mint placeholder`)
  }
  if (asset.owner.toString() !== req.wallet) {
    return reject(`Asset ${req.assetAddress} is owned by ${asset.owner.toString()}, not the paying wallet ${req.wallet}`)
  }
  // Without update authority the Worker cannot swap the placeholder later, so
  // accepting the fee here would take money for work it can never do.
  const authority = asset.updateAuthority
  const workerPubkey = umi.identity.publicKey.toString()
  if (authority.type !== 'Address' || authority.address?.toString() !== workerPubkey) {
    return reject(
      `Asset ${req.assetAddress} did not set the Worker (${workerPubkey}) as update authority, ` +
        'so its placeholder URI could never be finalized',
    )
  }

  return { ok: true, feeLamports: received, owner: asset.owner.toString() }
}
