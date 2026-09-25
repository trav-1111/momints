'use strict'

const MAX_CATALOGUE_AGE_MS = 24 * 60 * 60 * 1000

function isCurrentlyStocked(stock, serverTimeMs) {
  if (stock.evergreen) return false
  return (
    (stock.availableFrom === null || serverTimeMs >= Date.parse(stock.availableFrom)) &&
    (stock.availableUntil === null || serverTimeMs < Date.parse(stock.availableUntil))
  )
}

function catalogueIsRecent(receivedAtDeviceMs, deviceNowMs) {
  return receivedAtDeviceMs > 0 && deviceNowMs - receivedAtDeviceMs <= MAX_CATALOGUE_AGE_MS
}

function canLoadRoll(stock, access, deviceNowMs) {
  if (stock.evergreen || access.unlockedIds.includes(stock.filmStockId)) return true
  const serverNow = deviceNowMs + access.serverClockOffsetMs
  return catalogueIsRecent(access.catalogueReceivedAtMs, deviceNowMs) && isCurrentlyStocked(stock, serverNow)
}

function canUseQuick(stock, unlockedIds) {
  return stock.evergreen || unlockedIds.includes(stock.filmStockId)
}

module.exports = { MAX_CATALOGUE_AGE_MS, isCurrentlyStocked, catalogueIsRecent, canLoadRoll, canUseQuick }
