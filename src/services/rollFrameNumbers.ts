import type { PhotoArtifact } from '../store/photos'
import type { WorkerFrameSummary } from './rollApi'

export interface NumberedRollFrame {
  id: string
  frameNumber: number
  artifact?: PhotoArtifact
}

/** Preserve every server-reserved slot; only relocate unreserved local duplicates. */
export function planRollFrameNumbers(
  local: NumberedRollFrame[],
  remote: WorkerFrameSummary[],
  size: number,
  mintedPhotoIds: ReadonlySet<string>,
): Map<string, number> {
  const valid = (number: number) => Number.isInteger(number) && number >= 1 && number <= size
  if (
    local.length > size ||
    new Set(local.map((frame) => frame.id)).size !== local.length ||
    local.some((frame) => !valid(frame.frameNumber))
  )
    throw new Error('The encrypted roll has invalid frame numbering. Its photos have been preserved.')

  const numbers = new Map<string, number>()
  const reserved = new Set<number>()
  const confirmedIds = new Set<string>()
  for (const frame of remote) {
    if (!valid(frame.frameIndex) || reserved.has(frame.frameIndex))
      throw new Error('The server frame reservations are inconsistent. Nothing was renumbered.')
    const matches = local.filter(
      ({ artifact }) =>
        artifact &&
        artifact.imageHash === frame.imageHash &&
        artifact.mime === frame.mime &&
        artifact.byteLength === frame.byteLength &&
        artifact.width === frame.width &&
        artifact.height === frame.height,
    )
    if (matches.length !== 1 || numbers.has(matches[0].id))
      throw new Error('A server frame cannot be matched uniquely to the encrypted original. Nothing was renumbered.')
    numbers.set(matches[0].id, frame.frameIndex)
    reserved.add(frame.frameIndex)
    if (frame.status === 'MINTED') confirmedIds.add(matches[0].id)
  }
  for (const id of mintedPhotoIds) {
    if (!confirmedIds.has(id))
      throw new Error('A locally minted photo is not confirmed by the server. Nothing was renumbered.')
  }
  // Keep valid unreserved numbers before filling holes, so later photographs
  // do not move merely because an earlier burst accidentally reused a slot.
  for (const frame of local) {
    if (!numbers.has(frame.id) && !reserved.has(frame.frameNumber)) {
      numbers.set(frame.id, frame.frameNumber)
      reserved.add(frame.frameNumber)
    }
  }
  let next = 1
  for (const frame of local) {
    if (numbers.has(frame.id)) continue
    while (reserved.has(next)) next++
    if (next > size) throw new Error('No unused prepaid frame slot is available. Nothing was renumbered.')
    numbers.set(frame.id, next)
    reserved.add(next)
  }
  return numbers
}
