import * as SecureStore from 'expo-secure-store'
import { localDateLabel } from '../config/rollApi'
import type { FilmSettings, AspectRatio } from '../store/session'
import { assertRollCapability, createRollCapability, saveRollCapability, stageRollCapability } from './rollCapability'
import { createWorkerRoll, getOpenWorkerRoll, prepareWorkerRoll, type RollPurchaseQuote } from './rollApi'
import { quickAttemptDidNotLand } from './quickAttemptOutcome'

export interface RollPurchase {
  wallet: string
  size: 12 | 24
  artist: string
  skrIdentity: string
  film: FilmSettings
  aspect: AspectRatio
  payment: 'SOL' | 'SKR'
  createdAt: number
  localDate: string
  rollCapability: string
  quote?: RollPurchaseQuote
  state: 'prepared' | 'signing' | 'signed' | 'confirmed'
  signature?: string
  blockhash?: string
  lastValidBlockHeight?: string
  collectionAddress?: string
}

/** Only the signing-only payer may assert that no broadcast was attempted. */
export class RollPaymentNotSentError extends Error {}

export type SignedRollPayment = { signature: string; blockhash: string; lastValidBlockHeight: string }
export type PayRollPurchase = (
  purchase: RollPurchase,
  onSigned: (receipt: SignedRollPayment) => Promise<void>,
) => Promise<string>
const options = {
  keychainService: 'app.momints.roll-purchases.v1',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
}
const inFlight = new Map<string, Promise<Awaited<ReturnType<typeof run>>>>()

function key(wallet: string) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) throw new Error('Invalid roll wallet')
  return `roll-purchase-${wallet}`
}

/** No best-effort writes here: payment must never precede durable recovery state. */
async function save(purchase: RollPurchase) {
  const serialized = JSON.stringify(purchase)
  await SecureStore.setItemAsync(key(purchase.wallet), serialized, options)
  if ((await SecureStore.getItemAsync(key(purchase.wallet), options)) !== serialized) {
    throw new Error('Could not verify saved roll payment. Payment has been stopped.')
  }
}

export async function getPendingRollPurchase(wallet: string): Promise<RollPurchase | null> {
  const raw = await SecureStore.getItemAsync(key(wallet), options)
  if (!raw) return null
  const value = JSON.parse(raw) as RollPurchase
  if (
    value.wallet !== wallet ||
    (value.size !== 12 && value.size !== 24) ||
    !['SOL', 'SKR'].includes(value.payment) ||
    !value.film?.filmStockId ||
    !['prepared', 'signing', 'signed', 'confirmed'].includes(value.state) ||
    ((value.state === 'signed' || value.state === 'confirmed') && typeof value.signature !== 'string')
  ) {
    throw new Error('Saved roll purchase is unreadable. Resolve it before paying for another roll.')
  }
  assertRollCapability(value.rollCapability)
  return value
}

/** Retain until the matching roll is durably registered locally, or explicitly closed. */
export async function acknowledgeRollPurchase(wallet: string, signature: string) {
  const purchase = await getPendingRollPurchase(wallet)
  if (purchase?.signature === signature) await SecureStore.deleteItemAsync(key(wallet), options)
}

/** Explicit cancellation is allowed only before a signed receipt exists. */
export async function cancelUnpaidRollPurchase(wallet: string) {
  if (inFlight.has(wallet)) throw new Error('Wait for the current wallet request to finish.')
  const purchase = await getPendingRollPurchase(wallet)
  if (!purchase) return
  if (purchase.state !== 'prepared' || purchase.signature)
    throw new Error('This purchase needs receipt recovery before it can be cleared.')
  await SecureStore.deleteItemAsync(key(wallet), options)
}

async function run(
  wallet: string,
  opts: Omit<RollPurchase, 'wallet' | 'createdAt' | 'localDate' | 'rollCapability' | 'state'> | undefined,
  pay?: PayRollPurchase,
) {
  let purchase = await getPendingRollPurchase(wallet)
  if (!purchase) {
    if (!opts || !pay) throw new Error('No saved roll payment to recover.')
    const open = await getOpenWorkerRoll(wallet)
    if (open) throw new Error(`You have an open roll (${open.name}). Resume it before buying another.`)
    const now = Date.now()
    purchase = {
      ...opts,
      wallet,
      createdAt: now,
      localDate: localDateLabel(now),
      rollCapability: createRollCapability(),
      state: 'prepared',
    }
    await save(purchase)
    await stageRollCapability(wallet, purchase.rollCapability)
  }
  if (!purchase.signature) {
    if (purchase.state !== 'prepared')
      throw new Error(
        'A previous wallet signing request is pending without a saved signature. Resolve that wallet request before another payment.',
      )
    if (!pay) throw new Error('This roll has not been paid for. Load the saved roll to continue.')
    purchase.quote = await prepareWorkerRoll({
      wallet,
      size: purchase.size,
      payment: purchase.payment,
      rollCapability: purchase.rollCapability,
    })
    purchase.state = 'signing'
    await save(purchase)
    const current = purchase
    let signature: string
    try {
      signature = await pay(current, async (receipt) => {
        Object.assign(current, receipt, { state: 'signed' })
        await save(current) // awaited before the transaction can be broadcast
      })
    } catch (err) {
      if (err instanceof RollPaymentNotSentError && !current.signature) {
        current.state = 'prepared'
        await save(current)
      }
      if (current.signature)
        throw new Error(
          `Roll payment outcome needs recovery. Receipt: ${current.signature}. No new payment will be requested. ${err instanceof Error ? err.message : String(err)}`,
        )
      throw err
    }
    if (!current.signature || current.signature !== signature)
      throw new Error('Roll payment did not save its signed receipt. Resolve the pending purchase before paying again.')
    current.state = 'confirmed'
    await save(current)
  }
  try {
    const roll = await createWorkerRoll({
      wallet,
      size: purchase.size,
      filmStockId: purchase.film.filmStockId,
      artist: purchase.artist,
      skrIdentity: purchase.skrIdentity,
      localDate: purchase.localDate,
      feeSignature: purchase.signature!,
      payment: purchase.payment,
      rollCapability: purchase.rollCapability,
      quoteId: purchase.quote?.quoteId,
      aspect: purchase.aspect,
      filmMode: purchase.film.mode,
    })
    purchase.state = 'confirmed'
    await save(purchase)
    await saveRollCapability(roll.collectionAddress, purchase.rollCapability)
    purchase.collectionAddress = roll.collectionAddress
    await save(purchase)
    if (roll.status === 'COMPLETE' && roll.mintedCount >= roll.size) {
      await acknowledgeRollPurchase(wallet, purchase.signature!)
      throw new Error('Your previous roll is fully minted. Select Load Camera again to start a new purchase.')
    }
    return { roll, purchase }
  } catch (err) {
    if (
      purchase.state === 'signed' &&
      (await quickAttemptDidNotLand({
        signature: purchase.signature!,
        lastValidBlockHeight: purchase.lastValidBlockHeight,
      }))
    ) {
      // A signed-only attempt can fail before send. A finalized expiry read,
      // absent transaction and absent historical status permit a fresh prompt.
      // Never clear a receipt we already observed confirmed.
      purchase.state = 'prepared'
      delete purchase.signature
      delete purchase.blockhash
      delete purchase.lastValidBlockHeight
      await save(purchase)
      throw new Error(
        'The original payment did not land and its transaction expired. No roll fee was charged. Load the saved purchase again to approve a new payment.',
      )
    }
    throw new Error(
      `Roll payment needs recovery. Receipt: ${purchase.signature}. Retry recovery to check this payment; no new payment will be requested. ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/** Wallet-scoped single flight also survives screen unmounts. Saved terms always win on retry. */
export function createOrRecoverRoll(wallet: string, opts?: Parameters<typeof run>[1], pay?: PayRollPurchase) {
  const existing = inFlight.get(wallet)
  if (existing) return existing
  const task = run(wallet, opts, pay).finally(() => inFlight.delete(wallet))
  inFlight.set(wallet, task)
  return task
}
