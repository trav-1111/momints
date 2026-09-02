import { useState, useCallback } from 'react'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { payRollFee } from '../services/rollCollection'
import { sanitizeArtistName } from '../services/rollIdentity'
import { createWorkerRoll, getOpenWorkerRoll, RollApiError } from '../services/rollApi'
import { categorizeError } from './useMint'
import { useRollRegistry } from '../store/rollRegistry'
import { useSessionStore, type FilmSettings, type AspectRatio } from '../store/session'
import { getClusterRpc } from '../store/network'
import { localDateLabel } from '../config/rollApi'
import type { PrepaidRollSize } from '../config/roll'

export type CreateRollPhase = 'cover' | 'uploading' | 'signing' | 'confirming' | 'creating'

export interface CreateRollOptions {
  size: PrepaidRollSize
  /** Raw artist display name from the form — sanitized here. */
  artist: string
  /** Resolved SKR handle, or null to fall back to the wallet address. */
  skrHandle: string | null
  film: FilmSettings
  aspect: AspectRatio
}

/** What both creation paths must produce before the roll is registered locally. */
interface CreatedRoll {
  collectionAddress: string
  name: string
}

/**
 * The prepaid roll creation pipeline.
 *
 * The fee is paid in its own wallet-signed transfer, verified on-chain by the
 * Worker (worker/src/rolls/verify.ts) before it spends anything, and the
 * Worker does the rest: renders the cover, stores it on Arweave, and creates
 * the collection under its own key.
 *
 * The roll ends up registered (status OPEN, 0 frames minted) and loaded as
 * the active shooting session.
 */
export function useCreateRoll() {
  const { account, client, signTransaction } = useMobileWallet()
  const [phase, setPhase] = useState<CreateRollPhase | null>(null)
  const [error, setError] = useState<string | null>(null)

  const createRoll = useCallback(
    async (opts: CreateRollOptions): Promise<boolean> => {
      if (!account) {
        setError('Wallet not connected')
        return false
      }

      const walletAddress = account.address.toString()
      // Provenance is the verified handle when there is one, the raw wallet
      // address otherwise — never the user-editable display name.
      const skrIdentity = opts.skrHandle ?? walletAddress
      const artist = sanitizeArtistName(opts.artist) || skrIdentity
      const rpc = getClusterRpc()

      setError(null)
      try {
        const now = Date.now()
        let created: CreatedRoll

        // Check for an open roll BEFORE taking any money: the Worker allows
        // one open roll per wallet and would 409 after the fee had already
        // moved.
        const open = await getOpenWorkerRoll(walletAddress)
        if (open) {
          setError(
            `You already have an open roll (${open.name}, ${open.mintedCount}/${open.size} minted). ` +
              'Finish it before starting another.',
          )
          return false
        }

        const { signature: feeSignature } = await payRollFee(
          { walletAddress, size: opts.size, rpc, onPhase: (p) => setPhase(p) },
          { client, signTransaction },
        )

        setPhase('creating')
        try {
          const roll = await createWorkerRoll({
            wallet: walletAddress,
            size: opts.size,
            artist,
            skrIdentity,
            localDate: localDateLabel(now),
            feeSignature,
          })
          created = { collectionAddress: roll.collectionAddress, name: roll.name }
        } catch (err) {
          // The fee already moved. Surface the signature so the charge is
          // traceable and refundable rather than silently lost.
          const base = err instanceof RollApiError ? err.message : err instanceof Error ? err.message : String(err)
          throw new Error(`Roll fee was paid (${feeSignature}) but the roll could not be created: ${base}`, {
            cause: err instanceof Error ? err : undefined,
          })
        }

        useRollRegistry.getState().addRoll({
          collectionAddress: created.collectionAddress,
          wallet: walletAddress,
          name: created.name,
          size: opts.size,
          artist,
          skrIdentity,
          framesMinted: 0,
          status: 'open',
          createdAt: now,
        })

        const session = useSessionStore.getState()
        const started = session.startRoll(created.name, opts.size, opts.film, opts.aspect)
        if (started) session.setCollectionAddress(created.collectionAddress)
        return started
      } catch (err) {
        setError(categorizeError(err))
        return false
      } finally {
        setPhase(null)
      }
    },
    [account, client, signTransaction],
  )

  return { createRoll, phase, error, isCreating: phase !== null }
}
