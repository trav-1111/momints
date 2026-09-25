import { publicKey } from '@metaplex-foundation/umi'
import type { Umi } from '@metaplex-foundation/umi'
import { withBackoff } from '../lib/retry'
import { sendAndConfirm } from '../solana/confirm'

/**
 * Add the Momints verified-creator marker only after all prepaid frames mint.
 * Only the creator can unverify its own signature, so the shooter's update
 * authority cannot forge a Momints verification. This is the on-chain
 * developed evidence consumed by the stateless DAS unlock scan.
 */
export async function markRollDeveloped(umi: Umi, rpcUrl: string, collectionAddress: string): Promise<string | null> {
  const { addCollectionPlugin, safeFetchCollectionV1 } = await import('@metaplex-foundation/mpl-core')
  const collectionKey = publicKey(collectionAddress)
  const collection = await withBackoff('fetchCollectionForDevelopedMarker', () =>
    safeFetchCollectionV1(umi, collectionKey),
  )
  if (!collection) throw new Error(`Collection ${collectionAddress} not found while marking developed`)

  const existing = collection.verifiedCreators?.signatures.find(
    (creator) => creator.address.toString() === umi.identity.publicKey.toString() && creator.verified,
  )
  if (existing) return null

  const blockhash = await withBackoff('getLatestBlockhash', () => umi.rpc.getLatestBlockhash())
  const tx = await addCollectionPlugin(umi, {
    collection: collectionKey,
    authority: umi.identity,
    plugin: {
      type: 'VerifiedCreators',
      signatures: [{ address: umi.identity.publicKey, verified: true }],
    },
  })
    .setBlockhash(blockhash)
    .buildAndSign(umi)
  return await sendAndConfirm(umi, rpcUrl, tx)
}
