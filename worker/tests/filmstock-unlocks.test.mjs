import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const buildDir = await mkdtemp(path.resolve('node_modules/.filmstock-unlock-test-'))
await build({
  entryPoints: ['src/filmstocks/das.ts'],
  outdir: buildDir,
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  target: 'node22',
  logLevel: 'silent',
})
const { deriveUnlockedFilmStocks } = await import(pathToFileURL(path.join(buildDir, 'das.js')).href)
after(() => rm(buildDir, { recursive: true, force: true }))

const wallet = '11111111111111111111111111111111'
const authority = 'So11111111111111111111111111111111111111112'
const otherWallet = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const rpc = 'https://rpc.invalid'
const uri = 'https://arweave.net/test-roll'

function collection(overrides = {}) {
  return {
    interface: 'MplCoreCollection',
    content: { json_uri: uri },
    creators: [{ address: wallet, share: 100, verified: true }],
    plugins: {
      verified_creators: { data: { signatures: [{ address: authority, verified: true }] } },
    },
    ...overrides,
  }
}

function metadata(creator = wallet, filmStockId = 'bali-400-v1') {
  return {
    attributes: [
      { trait_type: 'creatorAddress', value: creator },
      { trait_type: 'filmStockId', value: filmStockId },
    ],
  }
}

async function query(items, offchain = metadata()) {
  const originalFetch = globalThis.fetch
  let metadataRequests = 0
  globalThis.fetch = async (url, options) => {
    if (url === rpc) {
      const request = JSON.parse(options.body)
      assert.equal(request.method, 'getAssetsByAuthority')
      assert.equal(request.params.authorityAddress, wallet)
      return Response.json({ result: { items } })
    }
    assert.equal(url, uri)
    metadataRequests++
    return Response.json(offchain)
  }
  try {
    return { ids: await deriveUnlockedFilmStocks(rpc, wallet, authority), metadataRequests }
  } finally {
    globalThis.fetch = originalFetch
  }
}

test('Core VerifiedCreators marker unlocks a film even when royalties name only the shooter', async () => {
  assert.deepEqual((await query([collection(), collection()])).ids, ['bali-400-v1'])
})

test('top-level royalty creators cannot substitute for the developed marker', async () => {
  const result = await query([collection({ plugins: {}, creators: [{ address: authority, verified: true }] })])
  assert.deepEqual(result.ids, [])
  assert.equal(result.metadataRequests, 0)
})

test('unverified and foreign markers and child assets cannot unlock films', async () => {
  const items = [
    collection({ plugins: { verified_creators: { data: { signatures: [{ address: authority, verified: false }] } } } }),
    collection({
      plugins: { verified_creators: { data: { signatures: [{ address: otherWallet, verified: true }] } } },
    }),
    collection({ interface: 'MplCoreAsset' }),
    collection({ plugins: { verified_creators: {} } }),
  ]
  const result = await query(items)
  assert.deepEqual(result.ids, [])
  assert.equal(result.metadataRequests, 0)
})

test('marker still requires the original shooter and a known film in permanent metadata', async () => {
  assert.deepEqual((await query([collection()], metadata(otherWallet))).ids, [])
  assert.deepEqual((await query([collection()], metadata(wallet, 'unknown-film'))).ids, [])
  assert.deepEqual((await query([collection({ content: { json_uri: 'https://untrusted.invalid/roll' } })])).ids, [])
})
