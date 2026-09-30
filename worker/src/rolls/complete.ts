export interface CompletableRoll {
  collection_address: string
  name: string
  size: number
  minted_count: number
  status: 'OPEN' | 'COMPLETE'
}

export interface CompleteRollDeps {
  closeRoll(collectionAddress: string): Promise<void>
  retryHandoff(collectionAddress: string): Promise<void>
}

export interface CompleteRollResult {
  collectionAddress: string
  name: string
  size: number
  mintedCount: number
  status: 'COMPLETE'
  alreadyComplete: boolean
}

/**
 * Close an authorized roll idempotently and always re-drive its delegate
 * handoff. A request can be lost after D1 commits or after the on-chain revoke
 * lands; neither case may turn a safe retry into a false failure.
 */
export async function completeAuthorizedRoll(
  deps: CompleteRollDeps,
  roll: CompletableRoll,
): Promise<CompleteRollResult> {
  const alreadyComplete = roll.status === 'COMPLETE'
  if (!alreadyComplete) await deps.closeRoll(roll.collection_address)
  await deps.retryHandoff(roll.collection_address)
  return {
    collectionAddress: roll.collection_address,
    name: roll.name,
    size: roll.size,
    mintedCount: roll.minted_count,
    status: 'COMPLETE',
    alreadyComplete,
  }
}
