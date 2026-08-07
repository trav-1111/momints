// One-time: upload the quick-mint placeholder to Arweave and print its URI.
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
// Usage (from worker/):
//   IRYS_FUNDING_KEY=<base58> SOLANA_RPC_URL=<helius devnet> \
//     node scripts/upload-placeholder.mjs ../CollectionPlaceholder.png
//
// Then paste the printed URI into wrangler.toml [vars] QUICK_PLACEHOLDER_URI.

import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { Uploader } from '@irys/upload'
import { Solana } from '@irys/upload-solana'
import { PhotonImage, SamplingFilter, resize } from '@cf-wasm/photon/node'

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
const rpcUrl = requireEnv('SOLANA_RPC_URL')

const source = await readFile(imagePath)
const art = normalizeArtwork(source)
console.log(
  `${basename(imagePath)}: ${source.byteLength} bytes -> ${art.bytes.byteLength} bytes ` +
    `(${art.width}x${art.height} JPEG q${art.quality})`,
)

// Matches the Worker's uploader exactly (providers/irysUploader.ts) so the
// placeholder lands on the same node and is paid from the same balance.
const uploader = await Uploader(Solana).withWallet(fundingKey).withRpc(rpcUrl).devnet()

console.log('Uploading image…')
const image = await uploader.upload(Buffer.from(art.bytes), {
  tags: [{ name: 'Content-Type', value: art.mime }],
})
const imageUri = `https://gateway.irys.xyz/${image.id}`
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

const doc = await uploader.upload(Buffer.from(JSON.stringify(metadata)), {
  tags: [{ name: 'Content-Type', value: 'application/json' }],
})
const metadataUri = `https://gateway.irys.xyz/${doc.id}`

console.log('\nDone. Put this in wrangler.toml [vars]:\n')
console.log(`QUICK_PLACEHOLDER_URI = "${metadataUri}"\n`)
