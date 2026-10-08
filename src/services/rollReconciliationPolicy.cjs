'use strict'

function readyWorkerFrames(frameIds, history, frames) {
  const existingIds = new Set(history.map((item) => item.id))
  const existingAssets = new Set(history.map((item) => item.mintAddress))

  return frames.flatMap((frame) => {
    const photoId = frameIds[frame.frameIndex - 1]
    if (
      !photoId ||
      frame.status !== 'MINTED' ||
      typeof frame.assetAddress !== 'string' ||
      typeof frame.imageUri !== 'string' ||
      typeof frame.signature !== 'string' ||
      existingIds.has(photoId) ||
      existingAssets.has(frame.assetAddress)
    ) {
      return []
    }
    return [{ photoId, frame }]
  })
}

function reconciledFrameCount(history, collectionAddress, frameIds) {
  const expectedIds = new Set(frameIds)
  const frameNumbers = new Set()
  for (const item of history) {
    if (
      expectedIds.has(item.id) &&
      item.rollContext?.collectionAddress === collectionAddress &&
      Number.isInteger(item.rollContext.frameNumber)
    ) {
      frameNumbers.add(item.rollContext.frameNumber)
    }
  }
  return frameNumbers.size
}

module.exports = { readyWorkerFrames, reconciledFrameCount }
