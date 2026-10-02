'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { sourceLoader } = require('./helpers/load-source.cjs')
const {
  MAX_CATALOGUE_AGE_MS,
  isCurrentlyStocked,
  catalogueIsRecent,
  canLoadRoll,
  canUseQuick,
} = require('../src/services/filmstockPolicy.cjs')

const rotating = {
  filmStockId: 'amber-200-v1',
  evergreen: false,
  availableFrom: '2026-10-01T00:00:00.000Z',
  availableUntil: '2026-11-15T00:00:00.000Z',
}

test('availability starts inclusively and ends exclusively on server time', () => {
  assert.equal(isCurrentlyStocked(rotating, Date.parse('2026-09-30T23:59:59.999Z')), false)
  assert.equal(isCurrentlyStocked(rotating, Date.parse(rotating.availableFrom)), true)
  assert.equal(isCurrentlyStocked(rotating, Date.parse('2026-11-14T23:59:59.999Z')), true)
  assert.equal(isCurrentlyStocked(rotating, Date.parse(rotating.availableUntil)), false)
})

test('server time offset, not a wrong device clock, determines rotation', () => {
  const deviceNow = Date.parse('2031-01-01T00:00:00.000Z')
  const serverNow = Date.parse('2026-10-10T12:00:00.000Z')
  assert.equal(
    canLoadRoll(
      rotating,
      {
        unlockedIds: [],
        serverClockOffsetMs: serverNow - deviceNow,
        catalogueReceivedAtMs: deviceNow,
      },
      deviceNow,
    ),
    true,
  )
})

test('an expired catalogue cannot authorize a new rotating roll offline', () => {
  const deviceNow = Date.parse('2026-10-10T12:00:00.000Z')
  assert.equal(catalogueIsRecent(deviceNow - MAX_CATALOGUE_AGE_MS, deviceNow), true)
  assert.equal(catalogueIsRecent(deviceNow - MAX_CATALOGUE_AGE_MS - 1, deviceNow), false)
  assert.equal(
    canLoadRoll(
      rotating,
      { unlockedIds: [], serverClockOffsetMs: 0, catalogueReceivedAtMs: deviceNow - MAX_CATALOGUE_AGE_MS - 1 },
      deviceNow,
    ),
    false,
  )
})

test('unlock survives expiry and recipe presence alone grants nothing', () => {
  const afterRotation = Date.parse('2026-12-01T00:00:00.000Z')
  assert.equal(
    canLoadRoll(
      rotating,
      { unlockedIds: ['amber-200-v1'], serverClockOffsetMs: 0, catalogueReceivedAtMs: 0 },
      afterRotation,
    ),
    true,
  )
  assert.equal(
    canLoadRoll(rotating, { unlockedIds: [], serverClockOffsetMs: 0, catalogueReceivedAtMs: 0 }, afterRotation),
    false,
  )
})

test('Quick Shoot accepts house and unlocked films, never stocked-only films', () => {
  assert.equal(canUseQuick({ ...rotating, evergreen: true }, []), true)
  assert.equal(canUseQuick(rotating, ['amber-200-v1']), true)
  assert.equal(canUseQuick(rotating, []), false)
})

async function accessHarness(files = new Map(), fetchUnlocks = async () => []) {
  class File {
    constructor(...parts) {
      this.path = parts.join('/')
    }
    get exists() {
      return files.has(this.path)
    }
    async text() {
      return files.get(this.path)
    }
    write(value) {
      files.set(this.path, value)
    }
  }
  const catalogue = {
    filmstocks: [{ filmStockId: 'house', evergreen: true }, rotating],
    serverTime: new Date().toISOString(),
    receivedAtDeviceMs: Date.now(),
  }
  const load = sourceLoader({
    'expo-file-system': { Paths: { document: 'documents' }, File },
    'src/services/filmstocks.ts': {
      DEFAULT_COLOR_FILM_ID: 'house',
      FALLBACK_HOUSE_CATALOGUE: catalogue,
      fetchFilmStockCatalogue: async () => catalogue,
      readCachedFilmStockCatalogue: async () => catalogue,
      fetchUnlockedFilmStockIds: fetchUnlocks,
    },
  })
  const module = load('src/store/filmstocks.ts')
  await module.filmStockHydrated
  return {
    store: module.useFilmStockStore,
    eligible: () => module.quickEligible(rotating, module.useFilmStockStore.getState()),
    files,
  }
}

test('earned film survives foreground refresh and cold restart without leaking to another wallet', async () => {
  const first = await accessHarness()
  await first.store.getState().refresh('wallet-a')
  first.store.getState().unlockLocally('wallet-a', rotating.filmStockId)
  first.store.getState().selectQuickFilm(rotating.filmStockId)
  await first.store.getState().refresh('wallet-a')
  assert.equal(first.eligible(), true)
  assert.equal(first.store.getState().quickFilmStockId, rotating.filmStockId)

  const restarted = await accessHarness(first.files)
  await restarted.store.getState().refresh('wallet-a')
  assert.equal(restarted.eligible(), true)
  assert.equal(restarted.store.getState().quickFilmStockId, rotating.filmStockId)
  await restarted.store.getState().refresh('wallet-b')
  assert.equal(restarted.eligible(), false)
  await restarted.store.getState().refresh(null)
  assert.equal(restarted.eligible(), false)
  await restarted.store.getState().refresh('wallet-a')
  assert.equal(restarted.eligible(), true)
})

test('an unlock earned while a refresh is pending survives its empty response', async () => {
  let finish
  const h = await accessHarness(
    new Map(),
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const pending = h.store.getState().refresh('wallet-a')
  h.store.getState().unlockLocally('wallet-a', rotating.filmStockId)
  finish([])
  await pending
  assert.equal(h.eligible(), true)
})

test('backend reconstruction adds films without removing earned films or duplicating them', async () => {
  const h = await accessHarness(new Map(), async () => [rotating.filmStockId, 'other-earned-film'])
  h.store.getState().unlockLocally('wallet-a', rotating.filmStockId)
  await h.store.getState().refresh('wallet-a')
  await h.store.getState().refresh('wallet-a')
  assert.deepEqual(h.store.getState().unlocksByWallet['wallet-a'], [rotating.filmStockId, 'other-earned-film'])
})

test('failed backend lookup preserves earned film access', async () => {
  const h = await accessHarness(new Map(), async () => {
    throw new Error('Metadata unavailable')
  })
  h.store.getState().unlockLocally('wallet-a', rotating.filmStockId)
  await h.store.getState().refresh('wallet-a')
  assert.equal(h.eligible(), true)
  assert.equal(h.store.getState().error, 'Metadata unavailable')
})
