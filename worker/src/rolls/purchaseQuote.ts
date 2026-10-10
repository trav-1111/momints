import type { CreateRollDeps } from './create'
import { publicKey } from '@metaplex-foundation/umi'
import { HttpError } from '../lib/http'
import { assertRollCapability, hashRollCapability } from './auth'
import { isRollSize } from './config'
import { deriveAta } from '../skr/ata'
import { SKR_MINT_ADDRESS, QUOTE_VALIDITY_MS } from '../skr/config'
import { SKR_DISCOUNT } from '../fees/config'
import { quoteSolToSkr } from '../skr/jupiter'

export async function prepareRollPurchase(
  deps: CreateRollDeps,
  req: { wallet: string; size: number; payment: 'SOL' | 'SKR'; rollCapability: string },
) {
  if (
    !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(req.wallet) ||
    !isRollSize(req.size) ||
    !['SOL', 'SKR'].includes(req.payment)
  )
    throw new HttpError(400, 'Invalid roll purchase quote')
  assertRollCapability(req.rollCapability)
  const open = await deps.db.getOpenRoll(req.wallet)
  if (open) throw new HttpError(409, 'Resume the existing open roll before paying for another.')
  if (await deps.creations.hasPendingWallet(req.wallet))
    throw new HttpError(409, 'A paid roll is still being created. Recover its original receipt before paying again.')
  const fees = await deps.feeCache.get()
  if (!fees) throw new HttpError(503, 'Roll fee quote is unavailable. No payment should be sent.')
  let amount = req.size === 12 ? fees.rollFee12Lamports : fees.rollFee24Lamports
  let treasurySkrAta: string | undefined
  if (req.payment === 'SKR') {
    try {
      amount = Number(await quoteSolToSkr(BigInt(Math.round(amount * (1 - SKR_DISCOUNT)))))
    } catch {
      throw new HttpError(503, '$SKR payment is unavailable. No payment should be sent.')
    }
    const umi = await deps.getUmi()
    treasurySkrAta = deriveAta(umi, publicKey(deps.treasuryAddress), publicKey(SKR_MINT_ADDRESS)).toString()
  }
  const quoteId = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + QUOTE_VALIDITY_MS).toISOString()
  await deps.creations.putQuote({
    id: quoteId,
    wallet: req.wallet,
    size: req.size,
    currency: req.payment,
    amount,
    treasury_ata: treasurySkrAta ?? null,
    auth_hash: await hashRollCapability(req.rollCapability),
    created_at: new Date().toISOString(),
    expires_at: expiresAt,
  })
  return { quoteId, amount, expiresAt, treasurySkrAta }
}
