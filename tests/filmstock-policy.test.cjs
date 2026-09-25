'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
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
