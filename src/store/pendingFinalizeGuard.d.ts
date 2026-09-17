export interface PendingEntryLike {
  stagingKey: string
}

export function mergePendingDrain<T extends PendingEntryLike>(current: T[], snapshot: T[], survivors: T[]): T[]
