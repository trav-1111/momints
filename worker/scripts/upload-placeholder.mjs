// One-time: upload the quick-mint placeholder to genuine Arweave via Turbo,
// and print its URI.
//
// Every quick mint is minted against this ONE permanent metadata document
// before its real image exists, then swapped to the real URI seconds later by
// the finalize consumer. Uploading it once and reusing it forever is the whole
// point — do not re-run this per mint, and do not wire it into the Worker.
//
// The placeholder window is short but real, and wallets will render whatever
// is there. It must therefore be valid, deliberate-looking NFT metadata, not a
// broken image.
//
// Plain .mjs on purpose: this runs on Node against the operator's funding key,
// not in the Worker, so it stays outside tsconfig's `include` and needs no
// build step.
//
// PREPARED, NOT RUN: this script signs and uploads for real the moment it's
// invoked (Turbo's small-item free tier covers a placeholder this size, but it
// is still a genuine spend/action) — that's an operator call, not something
// done automatically while building the Turbo swap.
//
// Usage (from worker/):
//   IRYS_FUNDING_KEY=<base58> node scripts/upload-placeholder.mjs ../CollectionPlaceholder.png
//
// Then paste the printed URI into wrangler.toml [vars] QUICK_PLACEHOLDER_URI,
// replacing the old gateway.irys.xyz one.

import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
// Explicit /web subpath — the lean build (no file/ subpath, so no transitive
// axios dependency, no ethers/cosmjs). Matches providers/turboClient.ts, and
// matters here specifically: plain Node has no bundler to prefer the lean
// build for a bare specifier, so it resolves the heavier node/ build instead.
import { createData, SolanaSigner } from '@dha-team/arbundles/web'
import bs58 from 'bs58'
import { PhotonImage, SamplingFilter, resize } from '@cf-wasm/photon/node'

const TURBO_UPLOAD = 'https://upload.ardrive.io/v1'
const ARWEAVE_GATEWAY = 'https://arweave.net'
const TOKEN = 'solana'

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

// The placeholder is loaded by a wallet in the seconds between the mint landing
// and the real URI going live. A multi-megabyte source (the app's
// CollectionPlaceholder.png is ~3.4 MB) would still be spinning when it gets
// replaced — which looks exactly like the broken image the placeholder exists
// to avoid. Same reasoning as assets/base-cover.jpg in rolls/cover.ts.
const MAX_PLACEHOLDER_EDGE = 1024
const MAX_PLACEHOLDER_BYTES = 200 * 1024
const JPEG_QUALITIES = [82, 70, 55, 40]

/** Downscale to a size a wallet can actually load in a few seconds. */
function normalizeArtwork(bytes) {
  const img = PhotonImage.new_from_byteslice(new Uint8Array(bytes))
  try {
    const width = img.get_width()
    const height = img.get_height()
    const scale = Math.min(1, MAX_PLACEHOLDER_EDGE / Math.max(width, height))
    const target =
      scale < 1
        ? resize(img, Math.round(width * scale), Math.round(height * scale), SamplingFilter.Lanczos3)
        : img

    try {
      for (const quality of JPEG_QUALITIES) {
        const out = target.get_bytes_jpeg(quality)
        if (out.byteLength <= MAX_PLACEHOLDER_BYTES) {
          return { bytes: out, mime: 'image/jpeg', width: target.get_width(), height: target.get_height(), quality }
        }
      }
      throw new Error(
        `Could not get the placeholder under ${MAX_PLACEHOLDER_BYTES} bytes at any quality — use smaller artwork.`,
      )
    } finally {
      if (target !== img) target.free()
    }
  } finally {
    img.free()
  }
}

/**
 * Trimmed, because the usual way to run this is by sourcing .dev.vars — and on
 * Windows that file has CRLF endings, so the value arrives with a trailing \r.
 * A base58 key with an invisible \r fails deep inside the signer as
 * "Non-base58 character", which is a long way from the actual cause.
 */
function requireEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) {
    console.error(`Missing ${name}. See the usage comment at the top of this file.`)
    process.exit(1)
  }
  return value
}

/**
 * Sign an ANS-104 data item and POST it to Turbo — the same lean path as the
 * Worker's TurboClient (providers/turboClient.ts), so the placeholder lands
 * through the identical signing + upload path every real mint uses.
 */
async function uploadToTurbo(signer, data, contentType) {
  const item = createData(data, signer, { tags: [{ name: 'Content-Type', value: contentType }] })
  await item.sign(signer)

  const res = await fetch(`${TURBO_UPLOAD}/tx/${TOKEN}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: item.getRaw(),
  })
  const text = await res.text()
  if (res.status === 402) {
    throw new Error(`Turbo refused the upload — insufficient credit balance (402): ${text}`)
  }
  if (!res.ok) {
    throw new Error(`Turbo upload failed: ${res.status} ${text}`)
  }
  const body = JSON.parse(text)
  if (!body.id) {
    throw new Error('Turbo upload succeeded but returned no id')
  }
  return body.id
}

const imagePath = process.argv[2]
if (!imagePath) {
  console.error('Usage: node scripts/upload-placeholder.mjs <path-to-image>')
  process.exit(1)
}

if (!MIME_BY_EXT[extname(imagePath).toLowerCase()]) {
  console.error(`Unsupported image type for ${basename(imagePath)} — use .png, .jpg, or .webp`)
  process.exit(1)
}

const fundingKey = requireEnv('IRYS_FUNDING_KEY')
const signer = new SolanaSigner(fundingKey)
const signingAddress = bs58.encode(signer.publicKey)
console.log(`Signing as ${signingAddress} — make sure this wallet's Turbo credit balance is funded.`)

const source = await readFile(imagePath)
const art = normalizeArtwork(source)
console.log(
  `${basename(imagePath)}: ${source.byteLength} bytes -> ${art.bytes.byteLength} bytes ` +
    `(${art.width}x${art.height} JPEG q${art.quality})`,
)

console.log('Uploading image to Turbo…')
const imageId = await uploadToTurbo(signer, Buffer.from(art.bytes), art.mime)
const imageUri = `${ARWEAVE_GATEWAY}/${imageId}`
console.log(`  image: ${imageUri}`)

const metadata = {
  name: 'Developing…',
  symbol: 'MOMINT',
  description:
    'This Momint is still developing. Its permanent image is being written to Arweave and will appear here ' +
    'automatically in a few moments.',
  image: imageUri,
  external_url: 'https://momints.xyz',
  attributes: [
    { trait_type: 'Status', value: 'Developing' },
    { trait_type: 'Minted With', value: 'Momints' },
  ],
  properties: {
    files: [{ uri: imageUri, type: art.mime }],
    category: 'image',
  },
}

console.log('Uploading metadata to Turbo…')
const metadataId = await uploadToTurbo(signer, JSON.stringify(metadata), 'application/json')
const metadataUri = `${ARWEAVE_GATEWAY}/${metadataId}`

console.log(
  '\nArweave mining takes a few minutes — the URI below will 403/404 briefly before it resolves. ' +
    'That is expected; Turbo has already accepted and bundled it.\n',
)
console.log('Done. Put this in wrangler.toml [vars], replacing the old gateway.irys.xyz value:\n')
console.log(`QUICK_PLACEHOLDER_URI = "${metadataUri}"\n`)
