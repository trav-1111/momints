'use strict'

/**
 * Merge a completed drain pass with the live queue. Entries recorded after
 * the drain snapshot are preserved; snapshot entries survive only when the
 * pass explicitly returned them for another poll.
 */
function mergePendingDrain(current, snapshot, survivors) {
  const snapshotKeys = new Set(snapshot.map((entry) => entry.stagingKey))
  const survivorByKey = new Map(survivors.map((entry) => [entry.stagingKey, entry]))
  return current.flatMap((entry) => {
    if (!snapshotKeys.has(entry.stagingKey)) return [entry]
    const survivor = survivorByKey.get(entry.stagingKey)
    return survivor ? [survivor] : []
  })
}

module.exports = { mergePendingDrain }
