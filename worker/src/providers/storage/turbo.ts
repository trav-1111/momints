import type { StorageProvider } from '../types'
import type { TurboClient } from '../turboClient'

const ARWEAVE_GATEWAY = 'https://arweave.net'

/**
 * PRIMARY StorageProvider: Turbo -> genuine Arweave. Permanent storage — this
 * is the impl that backs the app's permanence claim. Replaces the old
 * IrysProvider, which wrote to Irys's L1 (gateway.irys.xyz) — NOT Arweave; it
 * 404s on arweave.net (see ARWEAVE_PATH_OPTIONS.md).
 *
 * Assumes the Turbo credit balance is PRE-FUNDED (from SOL, via
 * TurboFunding). An insufficient balance surfaces as a 402 from Turbo, which
 * TurboClient turns into TurboFundingShortError — callers turn that into an
 * operator-facing error, same discipline as the old Irys 402 path.
 *
 * Returns `https://arweave.net/<dataItemId>` — the canonical, proven-to-resolve
 * form (see ARWEAVE_PATH_OPTIONS.md "URI form"). Old `gateway.irys.xyz` /
 * `ipfs://` URIs from past mints are untouched by this change and keep
 * resolving through their own gateways.
 */
export class TurboProvider implements StorageProvider {
  constructor(private readonly turbo: TurboClient) {}

  async uploadJSON(obj: unknown): Promise<string> {
    const { id } = await this.turbo.upload(JSON.stringify(obj), 'application/json')
    return `${ARWEAVE_GATEWAY}/${id}`
  }

  async uploadImage(bytes: Uint8Array, mime: string): Promise<string> {
    const { id } = await this.turbo.upload(bytes, mime)
    return `${ARWEAVE_GATEWAY}/${id}`
  }
}
