import { ruleSet } from '@metaplex-foundation/mpl-core'
import type { PublicKey } from '@metaplex-foundation/umi'

// Momints earns on the mint fee, not on secondary sales. 100% of the royalty
// goes to the shooter; there is no platform cut. This is a DECIDED value, not
// a placeholder — unlike QUICK_MINT_FEE_LAMPORTS and ROLL_FEE_LAMPORTS_* in
// rolls/config.ts, do not fold this into a future pricing pass without a
// deliberate discussion first.
export const ROYALTY_BASIS_POINTS = 500 // 5%

/**
 * The Royalties plugin, enforced on-chain (unlike `properties.creators` in the
 * off-chain JSON, which is display-only). Shared between roll collections and
 * quick-mint assets so the split can't drift between the two paths.
 */
export function royaltiesPlugin(creator: PublicKey) {
  return {
    type: 'Royalties' as const,
    basisPoints: ROYALTY_BASIS_POINTS,
    creators: [{ address: creator, percentage: 100 }],
    ruleSet: ruleSet('None'),
  }
}

/**
 * The VerifiedCreators plugin for one creator. `verified` must reflect
 * whether that address actually signed the transaction creating the asset —
 * a Core asset created by the shooter's own wallet (quick mints) can be
 * verified immediately; one created by the Worker's key on the shooter's
 * behalf (roll frames) cannot, and is added unverified so the shooter can
 * self-verify later.
 */
export function verifiedCreatorPlugin(creator: PublicKey, verified: boolean) {
  return {
    type: 'VerifiedCreators' as const,
    signatures: [{ address: creator, verified }],
  }
}
