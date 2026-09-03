// One-off operator recovery for a quick mint whose finalize never ran: the
// asset is minted, real, and owned by the shooter, but its URI still points at
// the "Developing…" placeholder forever, because the Worker never learned the
// fee had landed. See worker/README.md "Re-driving a stuck quick mint" for how
// this can happen (the finalize call was never made, and the row that would
// have tracked it was reaped) — this script is the manual completion of that
// interrupted flow: upload the real image + metadata, then update() the asset
// to point at it, exactly like quick/consumer.ts's swapAssetUri would have.
//
// PREPARED FOR THIS INCIDENT, NOT RUN: asset 33fVzva6aZq2sKGUimz6pFivhaDfhieXycNyjXLzbQ9S
// (name "Some stairs") is the default target below. Reusable for a future
// occurrence via --asset.
//
// Plain .mjs on purpose, same as upload-placeholder.mjs: runs on Node against
// the operator's funding key, not in the Worker.
//
// REQUIRES THE REAL IMAGE BYTES, WHICH THIS SCRIPT CANNOT SUPPLY. The
// finalize consumer never ran, so nothing was ever uploaded anywhere the
// Worker can reach — the staged copy in R2 is long expired under the bucket's
// 24h lifecycle rule by the time anyone notices a stuck placeholder. The only
// remaining source is the shooter's own device (the app's local photo store,
// or their device gallery if they saved a copy there). If that photo is truly
// gone, this asset cannot be completed — see the no-image message below.
//
// Default behaviour is DRY RUN: reads on-chain state and reports what it
// would do, uploads nothing, signs nothing. Real action needs --confirm, and
// even then this signs and uploads and sends a real mainnet transaction the
// moment it runs — an operator call, not something to invoke speculatively.
//
// Usage (from worker/):
//   node scripts/recover-quick-mint.mjs <path-to-real-image> [options]
//
//   --asset <address>       default: 33fVzva6aZq2sKGUimz6pFivhaDfhieXycNyjXLzbQ9S
//   --name <string>         default: "Some stairs" (matches the on-chain inline name)
//   --description <string>  default: a generic "Shot on Seeker" line — supply the
//                            real one if you still have it (artist name, etc.)
//   --confirm                actually upload + send; omit for a dry run
//
// Env (not printed, not logged):
//   IRYS_FUNDING_KEY   the signing key — MUST be the one that actually holds this
//                      asset's update authority right now, checked before anything
//                      is sent. Use the REAL DEPLOYED secret (wherever it's stored
//                      securely) — NOT whatever is in a local .dev.vars, which can
//                      be a stale or different value (confirmed 2026-09-03: this
//                      asset's on-chain authority is 6cpYU6dXcioCqVdBhF93qCruSThroGPrqPVA3h57pV1V,
//                      cross-checked against the live Worker's own reported Turbo
//                      balance via payment.ardrive.io — that IS the currently
//                      deployed key, so this recovery is straightforward with the
//                      real secret; no key rotation or authority problem here).
//   SOLANA_RPC_URL     mainnet RPC (same one the Worker uses)

import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { createData, SolanaSigner } from '@dha-team/arbundles/web'
import bs58 from 'bs58'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { mplCore, safeFetchAssetV1, update, updateAuthorityToBase } from '@metaplex-foundation/mpl-core'
import { publicKey, some, keypairIdentity } from '@metaplex-foundation/umi'
import { base58 } from '@metaplex-foundation/umi/serializers'

const TURBO_UPLOAD = 'https://upload.ardrive.io/v1'
const ARWEAVE_GATEWAY = 'https://arweave.net'
const TOKEN = 'solana'

const DEFAULT_ASSET = '33fVzva6aZq2sKGUimz6pFivhaDfhieXycNyjXLzbQ9S'
const DEFAULT_NAME = 'Some stairs'
const DEFAULT_DESCRIPTION = 'Shot on Seeker.'
const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

function requireEnv(name) {
  // Trimmed for the same reason upload-placeholder.mjs trims it: sourcing
  // .dev.vars on Windows leaves a trailing \r that turns into a baffling
  // "Non-base58 character" deep inside the signer.
  const value = process.env[name]?.trim()
  if (!value) {
    console.error(`Missing ${name}.`)
    process.exit(1)
  }
  return value
}

function parseArgs(argv) {
  const positional = []
  const opts = { asset: DEFAULT_ASSET, name: DEFAULT_NAME, description: DEFAULT_DESCRIPTION, confirm: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--asset') opts.asset = argv[++i]
    else if (a === '--name') opts.name = argv[++i]
    else if (a === '--description') opts.description = argv[++i]
    else if (a === '--confirm') opts.confirm = true
    else positional.push(a)
  }
  opts.imagePath = positional[0]
  return opts
}

async function uploadToTurbo(signer, data, contentType) {
  const item = createData(data, signer, { tags: [{ name: 'Content-Type', value: contentType }] })
  await item.sign(signer)
  const res = await fetch(`${TURBO_UPLOAD}/tx/${TOKEN}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: item.getRaw(),
  })
  const text = await res.text()
  if (res.status === 402) throw new Error(`Turbo refused the upload — insufficient credit balance (402): ${text}`)
  if (!res.ok) throw new Error(`Turbo upload failed: ${res.status} ${text}`)
  const body = JSON.parse(text)
  if (!body.id) throw new Error('Turbo upload succeeded but returned no id')
  return body.id
}

/** Raw JSON-RPC — used only for signature-status polling, matching solana/confirm.ts's HTTP-only approach. */
async function rpcCall(rpcUrl, method, params) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const body = await res.json()
  if (body.error) throw new Error(`RPC ${method} failed: ${body.error.code} ${body.error.message}`)
  return body.result
}

/**
 * Send via umi's own rpc.sendTransaction (proven — the same call
 * solana/confirm.ts makes) and poll for confirmation over plain HTTP, exactly
 * like the Worker does, rather than umi's websocket-based confirm.
 */
async function sendAndConfirm(umi, rpcUrl, signedTx) {
  const sigBytes = await umi.rpc.sendTransaction(signedTx, { skipPreflight: false })
  const signature = base58.deserialize(sigBytes)[0]

  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    const statuses = await rpcCall(rpcUrl, 'getSignatureStatuses', [[signature]])
    const status = statuses.value[0]
    if (status?.err) throw new Error(`Transaction ${signature} failed on-chain: ${JSON.stringify(status.err)}`)
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return signature
    await new Promise((r) => setTimeout(r, 1500))
  }
  throw new Error(`Transaction ${signature} sent but not confirmed within 45s — check Solscan before retrying`)
}

const opts = parseArgs(process.argv.slice(2))

if (!opts.imagePath) {
  console.error(
    'No image path given. The real photo was never uploaded anywhere the Worker can reach (finalize never ran), ' +
      'and the staged copy in R2 is long expired. If the shooter no longer has the original, this asset cannot ' +
      "be completed as-is — the operator's options are to leave it pointed at the placeholder (it is real, " +
      'owned, tradeable, just permanently mislabeled) or ask the shooter to re-shoot and quick-mint again.\n\n' +
      'Usage: node scripts/recover-quick-mint.mjs <path-to-real-image> [--asset <address>] [--name <string>] ' +
      '[--description <string>] [--confirm]',
  )
  process.exit(1)
}
if (!MIME_BY_EXT[extname(opts.imagePath).toLowerCase()]) {
  console.error(`Unsupported image type for ${opts.imagePath} — use .png, .jpg, or .webp`)
  process.exit(1)
}

const rpcUrl = requireEnv('SOLANA_RPC_URL')
const fundingKey = requireEnv('IRYS_FUNDING_KEY')
const signer = new SolanaSigner(fundingKey)
const signingAddress = bs58.encode(signer.publicKey)

console.log(`Recovering asset ${opts.asset}`)
console.log(`Signing as ${signingAddress} — make sure this wallet's Turbo credit balance is funded.`)

// ---- Read the asset first, via mpl-core's own deserializer (same as the
// Worker) rather than hand-decoding AssetV1's layout — getting the
// update-authority/owner fields right is exactly the point of this check.
// safeFetchAssetV1 returning null covers "does not exist" too. ----
const umi = createUmi(rpcUrl, { commitment: 'confirmed' }).use(mplCore())
const secretKeyBytes = base58.serialize(fundingKey)
const keypair = umi.eddsa.createKeypairFromSecretKey(secretKeyBytes)
umi.use(keypairIdentity(keypair))

const asset = await safeFetchAssetV1(umi, publicKey(opts.asset))
if (!asset) {
  console.error(`Asset ${opts.asset} does not exist, or could not be read via mpl-core — check the address and RPC.`)
  process.exit(1)
}
console.log(`Current URI: ${asset.uri}`)
console.log(`Owner: ${asset.owner.toString()}`)

const authority = asset.updateAuthority
if (authority.type !== 'Address' || authority.address?.toString() !== signingAddress) {
  console.error(
    `Asset ${opts.asset}'s update authority is ${authority.type === 'Address' ? authority.address?.toString() : authority.type}, ` +
      `not the signing wallet ${signingAddress}. This script cannot update it — the Worker no longer controls this asset.`,
  )
  process.exit(1)
}

console.log('\nUpdate authority confirmed. This asset is recoverable.\n')

if (!opts.confirm) {
  console.log('DRY RUN — nothing uploaded, nothing signed, nothing sent. Re-run with --confirm to actually recover it.')
  console.log(`Would upload: ${opts.imagePath}`)
  console.log(`Would set name: ${opts.name}`)
  console.log(`Would set description: ${opts.description}`)
  process.exit(0)
}

const source = await readFile(opts.imagePath)
const mime = MIME_BY_EXT[extname(opts.imagePath).toLowerCase()]

console.log('Uploading real image to Turbo…')
const imageId = await uploadToTurbo(signer, Buffer.from(source), mime)
const imageUri = `${ARWEAVE_GATEWAY}/${imageId}`
console.log(`  image: ${imageUri}`)

const metadata = {
  name: opts.name,
  symbol: 'MOMINT',
  description: opts.description,
  external_url: 'https://momints.xyz',
  image: imageUri,
  attributes: [
    { trait_type: 'Device', value: 'Solana Seeker' },
    { trait_type: 'Minted With', value: 'Momints' },
    { trait_type: 'Recovered', value: 'true' },
  ],
  properties: {
    files: [{ uri: imageUri, type: mime }],
    category: 'image',
    creators: [{ address: asset.owner.toString(), share: 100 }],
  },
}

console.log('Uploading metadata to Turbo…')
const metadataId = await uploadToTurbo(signer, JSON.stringify(metadata), 'application/json')
const metadataUri = `${ARWEAVE_GATEWAY}/${metadataId}`
console.log(`  metadata: ${metadataUri}`)

console.log('Building update() transaction — sets the real URI and hands update authority to the owner…')
const blockhash = await umi.rpc.getLatestBlockhash()
const tx = await update(umi, {
  asset,
  uri: metadataUri,
  // Matches quick/consumer.ts's swapAssetUri exactly: the mint is finished
  // once this lands, so the asset becomes fully the owner's in the same
  // instruction that sets the real URI.
  newUpdateAuthority: some(updateAuthorityToBase({ type: 'Address', address: asset.owner })),
})
  .setBlockhash(blockhash)
  .buildAndSign(umi)

console.log('Sending…')
const signature = await sendAndConfirm(umi, rpcUrl, tx)
console.log(`\nDone. Signature: ${signature}`)
console.log(`Asset ${opts.asset} now points at ${metadataUri} and update authority is the owner (${asset.owner.toString()}).`)
