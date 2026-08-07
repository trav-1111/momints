import { Paths, File as ExpoFile, Directory } from 'expo-file-system'
import { v4 as uuidv4 } from 'uuid'
import { PinataSDK, AuthenticationError } from 'pinata'

/**
 * Pluggable off-chain storage. Every cover and frame upload goes through this
 * interface so swapping Pinata/IPFS for Arweave/Irys (or anything else) is a
 * provider change here, not a rewrite of the mint pipeline.
 */
export interface StorageProvider {
  /** Upload a JSON document. Returns a resolvable URI (e.g. ipfs://CID). */
  uploadJSON(obj: unknown): Promise<string>
  /** Upload raw image bytes. Returns a resolvable URI (e.g. ipfs://CID). */
  uploadImage(bytes: Uint8Array, mime: string): Promise<string>
  /** Resolve a storage URI (ipfs://…) to a fetchable https gateway URL. */
  resolveUrl(uri: string): string
}

// ─── Pinata (IPFS) provider ───────────────────────────────────────────────────

function normalizeExpoPublicJwt(raw: string | undefined): string {
  let s = (raw ?? '').trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim()
  }
  return s
}

const PINATA_JWT = normalizeExpoPublicJwt(process.env.EXPO_PUBLIC_PINATA_JWT)
const PINATA_GATEWAY = (process.env.EXPO_PUBLIC_PINATA_GATEWAY ?? 'gateway.pinata.cloud').trim()

/** React Native FormData file field — avoids Blob/JS File (read-only `name` getter issues with Pinata). */
function rnFormDataFilePart(uri: string, filename: string, mimeType: string) {
  return { uri, name: filename, type: mimeType } as unknown as File
}

function rethrowIfPinataAuthFail(e: unknown, what: string): void {
  const authFail =
    e instanceof AuthenticationError ||
    (e instanceof Error && (/401|Not Authorized|Authentication failed/i.test(e.message) || e.message.includes('Not Authorized')))
  if (authFail) {
    throw new Error(
      `Pinata rejected this JWT (401) on ${what} upload. Create a new API JWT in Pinata (app.pinata.cloud → API Keys) with permission to upload files, put it in EXPO_PUBLIC_PINATA_JWT, run npm run check:pinata-env, then npx expo start --clear.`,
      { cause: e },
    )
  }
}

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export class PinataProvider implements StorageProvider {
  private pinata = new PinataSDK({
    pinataJwt: PINATA_JWT,
    pinataGateway: PINATA_GATEWAY,
  })

  private assertConfigured(): void {
    if (!PINATA_JWT) {
      throw new Error(
        'Pinata JWT missing at runtime. Add EXPO_PUBLIC_PINATA_JWT to project root .env, then restart Expo with cache clear (e.g. npx expo start --clear). Run: npm run check:pinata-env',
      )
    }
  }

  // Pinata's RN upload path wants a file URI, so bytes take a round-trip
  // through the cache directory.
  private async uploadTempFile(contents: string | Uint8Array, filename: string, mime: string): Promise<string> {
    this.assertConfigured()
    const tmpDir = new Directory(Paths.cache, 'momints-uploads')
    if (!tmpDir.exists) tmpDir.create()
    const tmpFile = new ExpoFile(tmpDir, filename)
    try {
      if (tmpFile.exists) tmpFile.delete()
      tmpFile.create()
      tmpFile.write(contents)
      const { cid } = await this.pinata.upload.public.file(rnFormDataFilePart(tmpFile.uri, filename, mime))
      return `ipfs://${cid}`
    } catch (e) {
      rethrowIfPinataAuthFail(e, mime === 'application/json' ? 'metadata' : 'image')
      throw e
    } finally {
      try {
        if (tmpFile.exists) tmpFile.delete()
      } catch {
        /* best-effort cleanup */
      }
    }
  }

  async uploadJSON(obj: unknown): Promise<string> {
    return this.uploadTempFile(JSON.stringify(obj), `${uuidv4()}.json`, 'application/json')
  }

  async uploadImage(bytes: Uint8Array, mime: string): Promise<string> {
    const ext = MIME_EXT[mime] ?? 'bin'
    return this.uploadTempFile(bytes, `${uuidv4()}.${ext}`, mime)
  }

  resolveUrl(uri: string): string {
    if (uri.startsWith('ipfs://')) {
      return `https://${PINATA_GATEWAY}/ipfs/${uri.slice('ipfs://'.length)}`
    }
    return uri
  }
}

// ─── Provider selection ───────────────────────────────────────────────────────

// Swap point for a future Arweave/Irys provider — return a different
// implementation here (e.g. keyed off an env var) and nothing else changes.
let _provider: StorageProvider | null = null

export function getStorageProvider(): StorageProvider {
  if (!_provider) {
    _provider = new PinataProvider()
  }
  return _provider
}
