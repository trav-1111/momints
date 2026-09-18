export interface RollVaultPurgeEvidence {
  expectedFrames: number
  verifiedFrames: number
  workerComplete: boolean
  finalizedAssets: boolean
  ownerAndCollectionMatch: boolean
  metadataAndHashesMatch: boolean
}

export function mayPurgeVerifiedRoll(evidence: RollVaultPurgeEvidence): boolean
