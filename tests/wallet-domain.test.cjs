const test = require('node:test')
const assert = require('node:assert/strict')
const { sourceLoader } = require('./helpers/load-source.cjs')

const WALLET = '9ybS1vSt3EkAQs8RTUXHqubusumc1ZMDeVM9oEsk2zB1'
const OTHER = '11111111111111111111111111111112'

function setup(response, files = new Map()) {
  let requests = 0
  global.fetch = async (url) => {
    requests++
    if (response instanceof Error) throw response
    if (typeof response === 'function') return response(url)
    return response
  }
  class File {
    constructor(_dir, name) {
      this.name = name
    }
    get exists() {
      return files.has(this.name)
    }
    async text() {
      return files.get(this.name) ?? ''
    }
    write(value) {
      files.set(this.name, value)
    }
    delete() {
      files.delete(this.name)
    }
  }
  const load = sourceLoader({
    'expo-file-system': { Paths: { document: 'document' }, File },
    'src/config/rollApi.ts': { ROLL_API_BASE: 'https://worker.example.test' },
  })
  return { service: load('src/services/walletDomain.ts'), requests: () => requests, files }
}
const ok = (domain) => new Response(JSON.stringify({ domain }), { status: 200 })

test('one uncached wallet uses one Worker request and selects trav.skr', async () => {
  const h = setup(ok('trav.skr'))
  const [a, b] = await Promise.all([h.service.resolveWalletDomain(WALLET), h.service.resolveWalletDomain(WALLET)])
  assert.equal(h.requests(), 1)
  assert.equal(a.domain, 'trav.skr')
  assert.equal(b.domain, 'trav.skr')
})

test('successful result persists and survives a service reload with zero requests', async () => {
  const files = new Map()
  const first = setup(ok('trav.skr'), files)
  await first.service.resolveWalletDomain(WALLET)
  const second = setup(new Error('should not fetch'), files)
  const result = await second.service.resolveWalletDomain(WALLET)
  assert.equal(result.domain, 'trav.skr')
  assert.equal(second.requests(), 0)
  const stored = JSON.parse(files.get('wallet-domain-cache-v2.json'))[0]
  assert.equal(stored.walletAddress, WALLET)
  assert.equal(stored.resolverVersion, 2)
})

test('confirmed no-domain is distinct and cached without a second request', async () => {
  const h = setup(ok(null))
  const first = await h.service.resolveWalletDomain(OTHER)
  const second = await h.service.resolveWalletDomain(OTHER)
  assert.equal(first.status, 'not-found')
  assert.equal(second.domain, null)
  assert.equal(h.requests(), 1)
})

test('429, HTTP, malformed and timeout failures remain errors and are never cached', async () => {
  for (const response of [
    new Response('', { status: 429 }),
    new Response('', { status: 503 }),
    new Response('{}', { status: 200 }),
    new Error('offline'),
  ]) {
    const h = setup(response)
    await assert.rejects(h.service.resolveWalletDomain(WALLET))
    assert.equal(h.requests(), 1)
    assert.equal(h.service.getCachedWalletDomain(WALLET), undefined)
  }
})

test('invalid wallet is rejected before the Worker request', async () => {
  const h = setup(ok('trav.skr'))
  await assert.rejects(h.service.resolveWalletDomain('not-a-wallet'), /invalid-address/)
  assert.equal(h.requests(), 0)
})

test('display formatter never duplicates suffix and falls back to shortened address', () => {
  const h = setup(ok('trav.skr'))
  const { formatWalletDisplay } = sourceLoader({
    'react-native': {},
    'expo-file-system': { Paths: { document: 'document' }, File: class {} },
    'src/config/rollApi.ts': { ROLL_API_BASE: '' },
  })('src/hooks/useWalletDomain.ts')
  assert.equal(formatWalletDisplay(WALLET, 'trav.skr'), 'trav.skr')
  assert.equal(formatWalletDisplay(WALLET, null), '9ybS...2zB1')
  assert.equal(h.requests(), 0)
})
