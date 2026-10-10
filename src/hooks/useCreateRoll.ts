import { useState, useCallback, useRef } from 'react'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { payRollFee, paySkrRollFee } from '../services/rollCollection'
import { sanitizeArtistName } from '../services/rollIdentity'
import { getWorkerRoll, type CreateRollResponse } from '../services/rollApi'
import { useRollRegistry } from '../store/rollRegistry'
import { useSessionStore, type FilmSettings, type AspectRatio } from '../store/session'
import { getClusterRpc } from '../store/network'
import type { PrepaidRollSize } from '../config/roll'
import { ensureFilmStockRecipe } from '../services/filmstocks'
import { rollEligible, useFilmStockStore } from '../store/filmstocks'
import {
  createOrRecoverRoll,
  getPendingRollPurchase,
  RollPaymentNotSentError,
  type RollPurchase,
} from '../services/rollCreation'

export type CreateRollPhase = 'cover' | 'uploading' | 'signing' | 'confirming' | 'creating'
export const SKR_UNAVAILABLE_MESSAGE = "$SKR payment isn't available right now — pay with SOL instead."
export interface CreateRollOptions {
  size: PrepaidRollSize
  artist: string
  skrHandle: string | null
  film: FilmSettings
  aspect: AspectRatio
  payment?: 'SOL' | 'SKR'
}

async function loadPurchasedRoll(roll: CreateRollResponse, purchase: RollPurchase): Promise<boolean> {
  if (roll.status !== 'OPEN')
    throw new Error(
      `Your paid roll ${roll.name} is already closed. Its receipt is saved; contact support to resolve the unused allowance.`,
    )
  const session = useSessionStore.getState()
  if (session.activeRoll?.collectionAddress === roll.collectionAddress) {
    session.resumeRoll()
    return true
  }
  if (session.activeRoll) throw new Error('Keep your current local roll safe before recovering a different one.')
  // Pending remote frames also reserve indices. Never fabricate photographs
  // or reuse frame one when this device lacks the original vault.
  const detail = await getWorkerRoll(roll.collectionAddress)
  if (detail.frames.length || detail.mintedCount)
    throw new Error(
      'This roll already contains frames. Recover its original device vault before shooting more; its unused allowance has been preserved.',
    )
  const stock = useFilmStockStore.getState().catalogue.find((item) => item.filmStockId === purchase.film.filmStockId)
  if (!stock) throw new Error('The original film recipe is unavailable. Your paid roll is saved for recovery.')
  await ensureFilmStockRecipe(stock)
  useRollRegistry.getState().addRoll({
    collectionAddress: roll.collectionAddress,
    wallet: purchase.wallet,
    name: roll.name,
    size: purchase.size,
    artist: purchase.artist,
    skrIdentity: purchase.skrIdentity,
    film: purchase.film.mode,
    filmStockId: purchase.film.filmStockId,
    aspect: purchase.aspect,
    framesMinted: roll.mintedCount,
    status: 'open',
    createdAt: purchase.createdAt,
  })
  const started = session.startRoll(roll.name, purchase.size, purchase.film, purchase.aspect, roll.collectionAddress)
  if (started) {
    useFilmStockStore.getState().recordUse(purchase.film.filmStockId)
  }
  // Keep the receipt while OPEN: best-effort session persistence may disappear.
  return started
}

export function useCreateRoll() {
  const { account, client, signTransaction } = useMobileWallet()
  const currentWallet = useRef(account?.address.toString())
  currentWallet.current = account?.address.toString()
  const [phase, setPhase] = useState<CreateRollPhase | null>(null)
  const [error, setError] = useState<string | null>(null)
  const perform = useCallback(
    async (opts?: CreateRollOptions): Promise<boolean> => {
      if (!account) {
        setError('Wallet not connected')
        return false
      }
      const wallet = account.address.toString()
      setError(null)
      setPhase('creating')
      try {
        const pending = await getPendingRollPurchase(wallet)
        if ((!pending || pending.state === 'prepared') && opts) {
          const filmState = useFilmStockStore.getState()
          const stock = filmState.catalogue.find(
            (item) => item.filmStockId === (pending?.film.filmStockId ?? opts.film.filmStockId),
          )
          if (!stock || !rollEligible(stock, filmState))
            throw new Error('That film is no longer available. Refresh the Film Shelf.')
          await ensureFilmStockRecipe(stock)
        }
        const skrIdentity = opts?.skrHandle ?? wallet
        const result = await createOrRecoverRoll(
          wallet,
          opts
            ? {
                size: opts.size,
                artist: sanitizeArtistName(opts.artist) || skrIdentity,
                skrIdentity,
                film: opts.film,
                aspect: opts.aspect,
                payment: opts.payment ?? 'SOL',
              }
            : undefined,
          opts
            ? async (purchase, onSigned) => {
                const pay = purchase.payment === 'SKR' ? paySkrRollFee : payRollFee
                let signed = false
                try {
                  const result = await pay(
                    {
                      walletAddress: wallet,
                      size: purchase.size,
                      rpc: getClusterRpc(),
                      quote: purchase.quote,
                      onPhase: (p) => setPhase(p),
                      onSigned: async (receipt) => {
                        signed = true
                        await onSigned(receipt)
                      },
                    },
                    { client, signTransaction },
                  )
                  setPhase('creating')
                  return result.signature
                } catch (err) {
                  if (!signed) throw new RollPaymentNotSentError(err instanceof Error ? err.message : String(err))
                  throw err
                }
              }
            : undefined,
        )
        if (currentWallet.current !== wallet)
          throw new Error('Reconnect the original roll wallet to resume its saved purchase.')
        return await loadPurchasedRoll(result.roll, result.purchase)
      } catch (err) {
        // Preserve the receipt; generic network categorization used to erase it.
        setError(err instanceof Error ? err.message : String(err))
        return false
      } finally {
        setPhase(null)
      }
    },
    [account, client, signTransaction],
  )
  const recoverRoll = useCallback(
    async (collectionAddress?: string): Promise<boolean> => {
      if (!account) {
        setError('Connect the original roll wallet first.')
        return false
      }
      const wallet = account.address.toString()
      setError(null)
      setPhase('creating')
      try {
        const pending = await getPendingRollPurchase(wallet)
        if (pending || !collectionAddress) {
          if (pending?.state === 'prepared')
            return await perform({
              size: pending.size,
              artist: pending.artist,
              skrHandle: pending.skrIdentity,
              film: pending.film,
              aspect: pending.aspect,
              payment: pending.payment,
            })
          return await perform()
        }
        const detail = await getWorkerRoll(collectionAddress)
        if (detail.wallet !== wallet) throw new Error('Connect the original roll wallet first.')
        let filmStockId = detail.filmStockId
        if (!filmStockId) {
          const response = await fetch(detail.metadataUri)
          if (!response.ok) throw new Error('Original roll metadata is unavailable. Your allowance is preserved.')
          const metadata = (await response.json()) as { attributes?: { trait_type: string; value: string }[] }
          filmStockId =
            metadata.attributes?.find((item) => item.trait_type === 'filmStockId')?.value ?? 'momints-color-v1'
        }
        const stock = useFilmStockStore.getState().catalogue.find((item) => item.filmStockId === filmStockId)
        if (!stock || (detail.size !== 12 && detail.size !== 24))
          throw new Error('The original roll settings could not be recovered safely.')
        if (currentWallet.current !== wallet)
          throw new Error('Reconnect the original roll wallet to resume its saved purchase.')
        return await loadPurchasedRoll(
          { ...detail, filmStockId, signature: '', feeLamports: 0, fundingWarning: null },
          {
            wallet,
            size: detail.size,
            artist: detail.artist,
            skrIdentity: detail.skrIdentity,
            film: { mode: detail.filmMode ?? stock.baseMode, filmStockId },
            aspect: detail.aspect ?? 'full',
            payment: 'SOL',
            createdAt: Date.parse(detail.createdAt),
            localDate: '',
            rollCapability: '',
            state: 'confirmed',
          },
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        return false
      } finally {
        setPhase(null)
      }
    },
    [account, perform],
  )
  return { createRoll: perform, recoverRoll, phase, error, isCreating: phase !== null }
}
