import { useState, useCallback } from 'react'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { getStorageProvider } from '../services/storage'
import { generateRollCover } from '../services/rollCover'
import { createRollCollection } from '../services/rollCollection'
import { sanitizeArtistName, buildRollName } from '../services/rollIdentity'
import { categorizeError } from './useMint'
import { useRollRegistry } from '../store/rollRegistry'
import { useSessionStore, type FilmSettings, type AspectRatio } from '../store/session'
import { useNetworkStore, getClusterRpc } from '../store/network'
import type { PrepaidRollSize } from '../config/roll'

export type CreateRollPhase = 'cover' | 'uploading' | 'signing' | 'confirming'

export interface CreateRollOptions {
  size: PrepaidRollSize
  /** Raw artist display name from the form — sanitized here. */
  artist: string
  /** Resolved SKR handle, or null to fall back to the wallet address. */
  skrHandle: string | null
  film: FilmSettings
  aspect: AspectRatio
}

/**
 * The prepaid roll creation pipeline: generate the branded cover, upload
 * cover + collection metadata through the storage provider, then pay the roll
 * fee and create the Metaplex Core collection in one wallet-signed
 * transaction. On success the roll is registered (status OPEN, 0 frames
 * minted) and loaded as the active shooting session.
 */
export function useCreateRoll() {
  const { account, client, signTransaction } = useMobileWallet()
  const cluster = useNetworkStore((s) => s.cluster)
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

      setError(null)
      try {
        const now = Date.now()
        const rollsToday = useRollRegistry.getState().countRollsCreatedOn(walletAddress, now)
        const name = buildRollName(now, rollsToday)

        setPhase('cover')
        const coverBytes = generateRollCover({ rollName: name, artist, size: opts.size })

        setPhase('uploading')
        const storage = getStorageProvider()
        const coverUri = await storage.uploadImage(coverBytes, 'image/png')
        const metadataUri = await storage.uploadJSON({
          name,
          symbol: 'MOMINT',
          description: `A ${opts.size}-exposure Momints roll by ${artist}`,
          image: coverUri,
          external_url: 'https://momints.app',
          attributes: [
            { trait_type: 'skr_identity', value: skrIdentity },
            { trait_type: 'artist', value: artist },
            { trait_type: 'Exposures', value: String(opts.size) },
            { trait_type: 'Minted With', value: 'Momints' },
          ],
          properties: { files: [{ uri: coverUri, type: 'image/png' }], category: 'image' },
        })

        const { collectionAddress } = await createRollCollection(
          {
            walletAddress,
            name,
            metadataUri,
            size: opts.size,
            rpc: getClusterRpc(cluster),
            onPhase: (p) => setPhase(p),
          },
          { client, signTransaction },
        )

        useRollRegistry.getState().addRoll({
          collectionAddress,
          wallet: walletAddress,
          name,
          size: opts.size,
          artist,
          skrIdentity,
          framesMinted: 0,
          status: 'open',
          createdAt: now,
        })

        const session = useSessionStore.getState()
        const started = session.startRoll(name, opts.size, opts.film, opts.aspect)
        if (started) session.setCollectionAddress(collectionAddress)
        return started
      } catch (err) {
        setError(categorizeError(err))
        return false
      } finally {
        setPhase(null)
      }
    },
    [account, client, signTransaction, cluster],
  )

  return { createRoll, phase, error, isCreating: phase !== null }
}
