import { Buffer } from 'node:buffer'
import type { StorageProvider } from '../types'
import type { IrysUploader } from '../irysUploader'

const GATEWAY = 'https://gateway.irys.xyz'

/**
 * PRIMARY StorageProvider: Irys -> Arweave. Permanent storage — this is the
 * impl that backs the app's permanence claim.
 *
 * Assumes the bundler balance is PRE-FUNDED. It never calls .fund(): an
 * insufficient balance surfaces as a 402 from the node, which callers turn
 * into an operator-facing error (the FundingProvider pre-check exists to
 * catch this before any bytes move).
 */
export class IrysProvider implements StorageProvider {
  constructor(private readonly uploader: IrysUploader) {}

  async uploadJSON(obj: unknown): Promise<string> {
    const receipt = await this.uploader.upload(Buffer.from(JSON.stringify(obj)), {
      tags: [{ name: 'Content-Type', value: 'application/json' }],
    })
    return `${GATEWAY}/${receipt.id}`
  }

  async uploadImage(bytes: Uint8Array, mime: string): Promise<string> {
    const receipt = await this.uploader.upload(Buffer.from(bytes), {
      tags: [{ name: 'Content-Type', value: mime }],
    })
    return `${GATEWAY}/${receipt.id}`
  }
}
