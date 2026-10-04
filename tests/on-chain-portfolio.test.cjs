const test = require('node:test')
const assert = require('node:assert/strict')
const { sourceLoader } = require('./helpers/load-source.cjs')

const WALLET = '9ybS1vSt3EkAQs8RTUXHqubusumc1ZMDeVM9oEsk2zB1'

function setup(mockResponse) {
  let requests = 0
  global.fetch = async (_url, options) => {
    requests++
    if (mockResponse instanceof Error) throw mockResponse
    if (typeof mockResponse === 'function') return mockResponse(_url, options)
    return mockResponse
  }

  const load = sourceLoader({
    'src/store/network.ts': {
      getClusterRpc: () => 'https://mock-rpc.example.test',
    },
  })

  return {
    service: load('src/services/onChainPortfolio.ts'),
    requests: () => requests,
  }
}

const mockDasSuccess = (items = []) =>
  new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'momints-portfolio-query',
      result: {
        total: items.length,
        limit: 100,
        page: 1,
        items,
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )

test('normalizeArweaveUrl converts ar:// URIs to https://arweave.net/', () => {
  const { service } = setup(mockDasSuccess([]))
  assert.equal(service.normalizeArweaveUrl('ar://abc123xyz'), 'https://arweave.net/abc123xyz')
  assert.equal(service.normalizeArweaveUrl('https://arweave.net/tx999'), 'https://arweave.net/tx999')
  assert.equal(service.normalizeArweaveUrl('https://gateway.irys.xyz/tx888'), 'https://gateway.irys.xyz/tx888')
  assert.equal(service.normalizeArweaveUrl(''), '')
})

test('fetchUserOnChainMints filters Momints assets and parses metadata fields', async () => {
  const mockItems = [
    {
      id: 'AssetMomints111',
      interface: 'MplCoreAsset',
      content: {
        json_uri: 'https://arweave.net/meta1',
        metadata: {
          name: 'Momints #0001 — Bali 400',
          symbol: 'MOMINTS',
          attributes: [
            { trait_type: 'Minted With', value: 'Momints' },
            { trait_type: 'Device', value: 'Solana Seeker' },
            { trait_type: 'filmStockId', value: 'bali-400-v1' },
            { trait_type: 'Roll', value: 'Summer Roll' },
            { trait_type: 'Frame', value: '01/24' },
            { trait_type: 'Artist', value: 'zaaci.skr' },
            { trait_type: 'Captured', value: '2026-10-04T12:00:00.000Z' },
          ],
        },
        links: {
          image: 'https://arweave.net/image1.jpg',
        },
      },
      grouping: [{ group_key: 'collection', group_value: 'CollectionMomints1' }],
    },
    {
      id: 'AssetNonMomints',
      interface: 'V1_NFT',
      content: {
        metadata: {
          name: 'Random NFT',
          symbol: 'RND',
          attributes: [{ trait_type: 'Rarity', value: 'Legendary' }],
        },
      },
    },
  ]

  const { service, requests } = setup(mockDasSuccess(mockItems))
  service.clearPortfolioCache()

  const res = await service.fetchUserOnChainMints(WALLET)

  assert.equal(requests(), 1)
  assert.equal(res.source, 'chain')
  assert.equal(res.items.length, 1)

  const asset = res.items[0]
  assert.equal(asset.id, 'AssetMomints111')
  assert.equal(asset.name, 'Momints #0001 — Bali 400')
  assert.equal(asset.filmStock, 'Bali 400')
  assert.equal(asset.rollName, 'Summer Roll')
  assert.equal(asset.frameNumber, '01/24')
  assert.equal(asset.artist, 'zaaci.skr')
  assert.equal(asset.imageUri, 'https://arweave.net/image1.jpg')
  assert.equal(asset.collectionAddress, 'CollectionMomints1')
})

test('fetchUserOnChainMints uses in-memory cache on subsequent calls', async () => {
  const mockItems = [
    {
      id: 'AssetMomints222',
      content: {
        metadata: {
          name: 'Momints #0002 — B&W',
          symbol: 'MOMINTS',
        },
        links: { image: 'https://arweave.net/img2' },
      },
    },
  ]

  const { service, requests } = setup(mockDasSuccess(mockItems))
  service.clearPortfolioCache()

  const first = await service.fetchUserOnChainMints(WALLET)
  assert.equal(first.source, 'chain')
  assert.equal(requests(), 1)

  const second = await service.fetchUserOnChainMints(WALLET)
  assert.equal(second.source, 'cache')
  assert.equal(requests(), 1) // No new request
  assert.equal(second.items.length, 1)
})

test('mergeMintPortfolio deduplicates by mint address and sorts newest first', () => {
  const { service } = setup(mockDasSuccess([]))

  const onChainMints = [
    {
      id: 'MintAAA',
      name: 'On-Chain Photo 1',
      imageUri: 'https://arweave.net/img1',
      mintedAt: '2026-10-04T10:00:00Z',
      source: 'chain',
    },
    {
      id: 'MintBBB',
      name: 'On-Chain Photo 2',
      imageUri: 'https://arweave.net/img2',
      mintedAt: '2026-10-04T12:00:00Z',
      source: 'chain',
    },
  ]

  const localHistory = [
    {
      id: 'Local1',
      mintAddress: 'MintAAA', // Same asset as on-chain MintAAA
      title: 'Local Photo 1',
      imageUri: 'https://arweave.net/img1',
      artist: 'zaaci.skr',
      transactionSignature: 'sig111',
      mintedAt: '2026-10-04T10:00:00Z',
    },
    {
      id: 'Local2',
      mintAddress: 'MintCCC', // Fresh local mint
      title: 'Local Photo 3',
      imageUri: 'https://arweave.net/img3',
      artist: 'zaaci.skr',
      transactionSignature: 'sig333',
      mintedAt: '2026-10-04T14:00:00Z',
      filmUsed: 'Bali 400',
    },
  ]

  const merged = service.mergeMintPortfolio(onChainMints, localHistory)

  // Total unique assets: MintBBB (12:00), MintCCC (14:00), MintAAA (10:00) -> 3 items
  assert.equal(merged.length, 3)

  // Newest first: MintCCC (14:00) -> MintBBB (12:00) -> MintAAA (10:00)
  assert.equal(merged[0].id, 'MintCCC')
  assert.equal(merged[0].name, 'Local Photo 3')
  assert.equal(merged[0].filmStock, 'Bali 400')

  assert.equal(merged[1].id, 'MintBBB')
  assert.equal(merged[2].id, 'MintAAA')
  assert.equal(merged[2].transactionSignature, 'sig111') // enriched from local
})
