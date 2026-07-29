import type { StorageProvider } from '../types'

/**
 * ⚠️ TEST-ONLY StorageProvider — Pinata / IPFS.
 *
 * IPFS pinning is NOT permanent storage: content survives only while someone
 * keeps pinning it. This impl exists purely as a development/test fallback
 * and MUST NOT back any user-facing permanence claim. Production is
 * IrysProvider (Arweave). Selected only by explicitly setting
 * STORAGE_PROVIDER=pinata (plus a PINATA_JWT secret).
 */
export class PinataProvider implements StorageProvider {
  constructor(private readonly jwt: string) {}

  async uploadJSON(obj: unknown): Promise<string> {
    const res = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ pinataContent: obj }),
    })
    return this.toUri(res)
  }

  async uploadImage(bytes: Uint8Array, mime: string): Promise<string> {
    const form = new FormData()
    form.append('file', new Blob([bytes.buffer as ArrayBuffer], { type: mime }), 'image')
    const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.jwt}` },
      body: form,
    })
    return this.toUri(res)
  }

  private async toUri(res: Response): Promise<string> {
    if (!res.ok) {
      throw new Error(`Pinata upload failed: ${res.status} ${await res.text()}`)
    }
    const body = (await res.json()) as { IpfsHash?: string }
    if (!body.IpfsHash) {
      throw new Error('Pinata upload succeeded but returned no IpfsHash')
    }
    return `https://gateway.pinata.cloud/ipfs/${body.IpfsHash}`
  }
}
