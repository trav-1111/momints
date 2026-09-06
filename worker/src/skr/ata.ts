import { publicKey, publicKeyBytes, type PublicKey, type Umi } from '@metaplex-foundation/umi'

// Well-known, network-wide program ids — never configuration, never secrets.
const TOKEN_PROGRAM_ID = publicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const ASSOCIATED_TOKEN_PROGRAM_ID = publicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')

/**
 * The standard Associated Token Account for `owner` holding `mint` — a pure,
 * local PDA derivation (no RPC call, no dependency on the account existing).
 *
 * Deliberately hand-derived via `umi.eddsa.findPda` rather than pulling in
 * `@metaplex-foundation/mpl-toolbox` or `@solana/spl-token` for one function —
 * `umi` (already a dependency here) exposes everything this needs. Mirrored
 * by hand in the app (src/services/mint.ts's deriveOwnerSkrAta) for the
 * user's own ATA — kept in sync by hand, same discipline as
 * KNOWN_LAMPORTS_PER_BYTE's app/worker duplication elsewhere in this repo.
 */
export function deriveAta(umi: Umi, owner: PublicKey, mint: PublicKey): PublicKey {
  const [pda] = umi.eddsa.findPda(ASSOCIATED_TOKEN_PROGRAM_ID, [
    publicKeyBytes(owner),
    publicKeyBytes(TOKEN_PROGRAM_ID),
    publicKeyBytes(mint),
  ])
  return pda
}
