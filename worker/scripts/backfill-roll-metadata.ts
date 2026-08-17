// One-time: bring existing roll collections up to the conformant metadata
// schema (properties.files / category / creators / external_url).
//
// Rolls created before worker/src/lib/metadata.ts emitted metadata that omitted
// `properties` entirely, which the Metaplex spec lists as REQUIRED. This
// rebuilds each collection's JSON with the real builder, re-uploads it, and
// repoints the on-chain collection at it. The cover image is untouched — it was
// always correct and is already permanent.
//
// .ts, not .mjs, deliberately: it imports the SAME buildNftMetadata the Worker
// uses. Duplicating that logic in a plain .mjs script would recreate exactly the
// drift the shared builder was written to end. Node strips the types at run
// time, which is why the import below needs its explicit .ts extension.
//
// ORDERING — this must run BEFORE roll collections are handed to their
// shooters, and before any collection plugins are added to existing rolls.
// Once update authority moves, the Worker can no longer touch a collection and
// those rolls keep whatever metadata they had.
//
// Usage (from worker/). Dry run is the default and needs no credentials:
//   node --experimental-strip-types scripts/backfill-roll-metadata.ts
// Then, to actually upload and send:
//   IRYS_FUNDING_KEY=<base58> SOLANA_RPC_URL=<helius devnet> \
//     node --experimental-strip-types scripts/backfill-roll-metadata.ts --apply

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { keypairIdentity, publicKey } from '@metaplex-foundation/umi'
import { base58 } from '@metaplex-foundation/umi/serializers'
import { mplCore, updateCollection } from '@metaplex-foundation/mpl-core'
import { Uploader } from '@irys/upload'
import { Solana } from '@irys/upload-solana'
import { buildNftMetadata } from '../src/lib/metadata.ts'

const APPLY = process.argv.includes('--apply')

interface RollRow {
  collection_address: string
  wallet: string
  name: string
  size: number
  artist: string
  skr_identity: string
  cover_uri: string
  metadata_uri: string
}

/** Trimmed — sourcing .dev.vars on Windows leaves a trailing \r that fails base58. */
function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    console.error(`Missing ${name}. See the usage comment at the top of this file.`)
    process.exit(1)
  }
  return value
}

// wrangler's own JS entry, run through this same node binary. Avoids `npx`,
// which on Windows is a .cmd and so needs `shell: true` — and a shell re-splits
// the argv, so SQL containing spaces arrives as a dozen unknown arguments.
// (`--file` sidesteps quoting but makes wrangler report summary statistics
// instead of rows, so it is not usable for reads.)
const WRANGLER = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url))

/** D1 is only reachable through wrangler, so the script shells out to it. */
function d1<T>(sql: string): T[] {
  const out = execFileSync(
    process.execPath,
    [WRANGLER, 'd1', 'execute', 'momints-rolls', '--remote', '--json', '--command', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  // Anchor on a line that is exactly `[` — wrangler can interleave progress
  // lines into stdout, and those contain brackets of their own.
  const stripped = out.replace(/\[[0-9;]*m/g, '')
  const match = stripped.match(/^\[[\s\S]*$/m)
  if (!match) throw new Error(`No JSON payload in wrangler output:\n${stripped}`)
  return JSON.parse(match[0])[0].results as T[]
}

// Only ever interpolated into SQL after this check — these are Arweave gateway
// URLs, so anything containing a quote is not one.
const SAFE_URI = /^https:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/

async function buildSigners() {
  const fundingKey = requireEnv('IRYS_FUNDING_KEY')
  const rpcUrl = requireEnv('SOLANA_RPC_URL')
  const umi = createUmi(rpcUrl).use(mplCore())
  umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(base58.serialize(fundingKey))))
  const uploader = await Uploader(Solana).withWallet(fundingKey).withRpc(rpcUrl).devnet()
  return { umi, uploader }
}

const rolls = d1<RollRow>(
  "SELECT collection_address, wallet, name, size, artist, skr_identity, cover_uri, metadata_uri FROM rolls WHERE collection_address = 'GUgSVnj4CUyU3He6gw5XwFYLpW1dDjSj6hV8ZtzTqrt7'",
)
console.log(`${rolls.length} roll(s) found. Mode: ${APPLY ? 'APPLY' : 'dry run (pass --apply to execute)'}\n`)

// Credentials and the uploader are only built for a real run, so a dry run
// works with nothing configured — which is what makes it useful for checking
// the output shape before committing to an upload.
const signers = APPLY ? await buildSigners() : null

for (const roll of rolls) {
  const metadata = buildNftMetadata({
    name: roll.name,
    symbol: 'MOMINTS',
    description: `Momints roll ${roll.name} — ${roll.size} exposures by ${roll.artist}.`,
    imageUri: roll.cover_uri,
    mime: 'image/jpeg',
    attributes: [
      { trait_type: 'skr_identity', value: roll.skr_identity },
      { trait_type: 'artist', value: roll.artist },
      { trait_type: 'exposures', value: String(roll.size) },
    ],
    creators: [{ address: roll.wallet, share: 100 }],
  })

  console.log(`--- ${roll.name} (${roll.collection_address})`)
  console.log(`  current metadata : ${roll.metadata_uri}`)

  if (!signers) {
    console.log(`  would upload     : ${JSON.stringify(metadata)}`)
    continue
  }

  const receipt = await signers.uploader.upload(Buffer.from(JSON.stringify(metadata)), {
    tags: [{ name: 'Content-Type', value: 'application/json' }],
  })
  const newUri = `https://gateway.irys.xyz/${receipt.id}`
  if (!SAFE_URI.test(newUri)) throw new Error(`Refusing to store an unexpected URI: ${newUri}`)
  console.log(`  new metadata     : ${newUri}`)

  await updateCollection(signers.umi, {
    collection: publicKey(roll.collection_address),
    uri: newUri,
  }).sendAndConfirm(signers.umi, { confirm: { commitment: 'confirmed' } })
  console.log('  on-chain uri     : updated')

  // D1 last: if it fails, re-running is safe — it just re-uploads and repoints.
  d1(`UPDATE rolls SET metadata_uri = '${newUri}' WHERE collection_address = '${roll.collection_address}'`)
  console.log('  D1               : updated')
}

console.log(`\n${APPLY ? 'Backfill complete.' : 'Dry run complete — re-run with --apply.'}`)
