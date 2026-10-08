export function canonicalFilePath(uri: unknown): string | null
export function isFileUriInsideDirectory(uri: unknown, directoryUri: unknown): boolean
export function isLegacyRootCacheImageName(name: unknown): boolean
export function isPermanentArweaveUri(uri: unknown): uri is string
export function runWithCleanup<T>(work: () => Promise<T>, cleanup: () => void | Promise<void>): Promise<T>
