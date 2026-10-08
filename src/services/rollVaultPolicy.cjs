'use strict'

function mayPurgeVerifiedRoll(evidence) {
  return (
    Number.isInteger(evidence.expectedFrames) &&
    evidence.expectedFrames > 0 &&
    evidence.verifiedFrames === evidence.expectedFrames &&
    evidence.workerComplete === true &&
    evidence.finalizedAssets === true &&
    evidence.ownerAndCollectionMatch === true &&
    evidence.metadataAndHashesMatch === true
  )
}

module.exports = { mayPurgeVerifiedRoll }
