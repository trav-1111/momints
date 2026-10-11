const { test } = require('node:test')
const assert = require('node:assert/strict')
const { captureBurst } = require('./helpers/burst-capture.cjs')

test('burst frames keep unique numbers in both photo and encrypted vault records', async () => {
  for (const start of [1, 4]) {
    const result = await captureBurst({ start })
    assert.deepEqual(
      result.photos.map((photo) => photo.rollFrameNumber),
      [start + 1, start + 2],
    )
    assert.deepEqual(
      result.persisted.map((frame) => frame.frameNumber),
      [start + 1, start + 2],
    )
    assert.deepEqual(
      result.persisted.map((frame) => frame.sessionCountBeforeCommit),
      [start, start + 1],
    )
    assert.equal(result.roll.frameIds.length, start + 2)
  }
})

test('overlapping burst callbacks cannot allocate the same exposure twice', async () => {
  const result = await captureBurst({ concurrent: true })
  assert.equal(result.captured, 2)
  assert.deepEqual(
    result.photos.map((photo) => photo.rollFrameNumber),
    [2, 3],
  )
})

test('a callback from an older render respects the current remaining exposure count', async () => {
  const result = await captureBurst({
    start: 1,
    count: 4,
    beforeStart: (session) => {
      const roll = session.getState().activeRoll
      session.setState({ activeRoll: { ...roll, frameIds: Array.from({ length: 10 }, (_, i) => `prior-${i}`) } })
    },
  })
  assert.equal(result.captured, 2)
  assert.deepEqual(
    result.photos.map((photo) => photo.rollFrameNumber),
    [11, 12],
  )
})

test('burst uses the last available exposure and develops a full roll', async () => {
  const result = await captureBurst({ start: 10, count: 4 })
  assert.equal(result.captured, 2)
  assert.deepEqual(
    result.photos.map((photo) => photo.rollFrameNumber),
    [11, 12],
  )
  assert.equal(result.roll.developed, true)
  assert.equal(result.alerts.filter(([title]) => title === 'Roll Complete! 🎞️').length, 1)
})

test('quick burst keeps sequence identity without adding roll exposures', async () => {
  const result = await captureBurst({ mode: 'quick' })
  assert.deepEqual(
    result.photos.map((photo) => photo.kinoIndex),
    [0, 1],
  )
  assert.ok(result.photos.every((photo) => photo.rollFrameNumber === undefined))
  assert.equal(result.persisted.length, 0)
  assert.equal(result.roll.frameIds.length, 1)
})

test('a failed encrypted commit does not consume a prepaid exposure', async () => {
  const result = await captureBurst({
    beforePersist: () => {
      throw Error('disk full')
    },
  })
  assert.equal(result.persisted.length, 0)
  assert.equal(result.roll.frameIds.length, 1)
  assert.equal(result.photos.length, 0)
  assert.ok(result.alerts.some(([title]) => title === 'Error'))
})

test('changing the active roll during burst rendering cannot register photos on the old roll', async () => {
  const result = await captureBurst({ beforeRender: (session) => session.setState({ activeRoll: null }) })
  assert.equal(result.persisted.length, 0)
  assert.equal(result.photos.length, 0)
})

test('changing rolls during an encrypted commit cannot consume an exposure on the replacement roll', async () => {
  const result = await captureBurst({
    beforePersist: (_photo, _number, session) => {
      session.setState({ activeRoll: { ...session.getState().activeRoll, id: 'replacement-roll' } })
    },
  })
  assert.equal(result.persisted.length, 1)
  assert.equal(result.roll.id, 'replacement-roll')
  assert.equal(result.roll.frameIds.length, 1)
  assert.equal(result.photos[0].rollId, 'test-roll')
  assert.match(result.photos[0].uri, /^test-vault:/)
})
