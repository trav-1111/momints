// Metaplex Core account byte-size model, ported from the read-only
// scripts/mainnet-rent-quote.mjs (validated there against 5/5 real mainnet
// Core assets and cross-checked live against getMinimumBalanceForRentExemption
// — see that script's header comment). Used to turn a live rent-sysvar rate
// into real lamports for the two shapes Momints actually mints, without
// needing to mint anything to find out.
//
// Kept in sync by hand with rolls/frames.ts and lib/royalties.ts's actual
// plugin sets — same discipline as the app/worker fee-constant duplication
// elsewhere in this repo (no shared module between the plain-Node script and
// this Worker).
import { ARWEAVE_URI_LEN } from './config'

const ACCOUNT_STORAGE_OVERHEAD = 128

const PLUGIN_DATA = { VerifiedCreators: 38, Royalties: 41, UpdateDelegate: 5 } as const
type PluginType = keyof typeof PLUGIN_DATA
type Authority = 'Address' | 'UpdateAuthority'
interface PluginSpec {
  type: PluginType
  authority: Authority
}

function authoritySize(authority: Authority): number {
  return authority === 'Address' ? 1 + 32 : 1
}

/** Plugin header + each plugin's own data + the registry that indexes them. */
function pluginAreaSize(plugins: PluginSpec[]): number {
  if (plugins.length === 0) return 0
  const header = 1 + 8
  const data = plugins.reduce((n, p) => n + PLUGIN_DATA[p.type], 0)
  const records = plugins.reduce((n, p) => n + 1 + authoritySize(p.authority) + 8, 0)
  const registry = 1 + 4 + records + 4
  return header + data + registry
}

function assetSize(args: {
  nameLen: number
  uriLen: number
  updateAuthority: 'Collection' | 'Address' | 'None'
  plugins: PluginSpec[]
}): number {
  const { nameLen, uriLen, updateAuthority, plugins } = args
  return 1 + 32 + (updateAuthority === 'None' ? 1 : 33) + 4 + nameLen + 4 + uriLen + 1 + pluginAreaSize(plugins)
}

/**
 * A roll frame (rolls/frames.ts's `create()` call): update authority is the
 * roll's collection, one VerifiedCreators plugin (unverified — the Worker
 * signs on the shooter's behalf), name like "yyyy-mm-dd.NN.001".
 */
export function rollFrameAssetSizeBytes(): number {
  return assetSize({
    nameLen: 17, // yyyy-mm-dd.NN.001
    uriLen: ARWEAVE_URI_LEN,
    updateAuthority: 'Collection',
    plugins: [{ type: 'VerifiedCreators', authority: 'UpdateAuthority' }],
  })
}

/**
 * A quick-mint asset (mint.ts's `buildQuickCoreTransaction`): update
 * authority is the Worker (until the finalize URI swap hands it to the
 * owner), Royalties + VerifiedCreators (verified — the owner co-signs).
 * Reference only — the user's own wallet pays this rent, never the operator,
 * so it never feeds a fee formula (see fees/compute.ts).
 */
export function quickAssetSizeBytes(): number {
  return assetSize({
    nameLen: 20, // typical; MAX_NAME_LENGTH in quick/stage.ts is 64
    uriLen: ARWEAVE_URI_LEN,
    updateAuthority: 'Address',
    plugins: [
      { type: 'Royalties', authority: 'UpdateAuthority' },
      { type: 'VerifiedCreators', authority: 'UpdateAuthority' },
    ],
  })
}

/** Rent-exempt minimum for an account of `sizeBytes`, at `lamportsPerByte`. */
export function rentForSize(sizeBytes: number, lamportsPerByte: number): number {
  return Math.round((ACCOUNT_STORAGE_OVERHEAD + sizeBytes) * lamportsPerByte)
}
