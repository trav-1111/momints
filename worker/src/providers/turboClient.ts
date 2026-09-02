import bs58 from 'bs58'
import type { ValidatedEnv } from '../env'

const TURBO_UPLOAD = 'https://upload.ardrive.io/v1'
const TURBO_PAYMENT = 'https://payment.ardrive.io/v1'
const TOKEN = 'solana'
const UPLOAD_TIMEOUT_MS = 60_000
const READ_TIMEOUT_MS = 20_000

/**
 * Thrown when Turbo refuses an upload for insufficient credit balance — a 402
 * from the upload endpoint (verified against the live API: 402 "Insufficient
 * balance", text/plain). This is the storage-side equivalent of
 * FundingProvider's insufficient-balance signal: never hang, never spend
 * partway. TurboFunding.ensureFunded() catches most cases ahead of time, but
 * this is the backstop for the balance moving between the pre-check and the
 * upload itself. Handled centrally in index.ts's request catch (503); the
 * quick-mint queue consumer's generic retry/DLQ path handles it too.
 */
export class TurboFundingShortError extends Error {
  readonly isTurboFundingShort = true
  constructor(message: string) {
    super(message)
    this.name = 'TurboFundingShortError'
  }
}

interface TurboUploadResult {
  id: string
  wincSpent: string | null
}

/**
 * Lean Turbo client: signs ANS-104 data items with `@dha-team/arbundles` and
 * talks to Turbo's public HTTP API directly, rather than pulling in the full
 * `@ardrive/turbo-sdk` (measured +765 KiB gzip for ethers/cosmjs/aoconnect/CLI
 * deps this Worker never calls — see ARWEAVE_PATH_OPTIONS.md). Keyed signing
 * and a real upload from inside this exact Workers runtime were proven end to
 * end in worker-turbo-spike/RESULT.md before this was built.
 *
 * Shared by TurboProvider (uploads) and TurboFunding (balance checks) so both
 * always see the same signer/wallet — the same role the old Irys uploader
 * factory played before it (removed with the Turbo swap; see git history).
 *
 * The arbundles import is dynamic so a module-evaluation failure is caught
 * per-request rather than crashing the whole Worker at load; wrangler still
 * bundles it statically at build time — the same defensive reasoning that
 * factory used.
 */
export class TurboClient {
  private ctxPromise: Promise<{
    mod: Awaited<ReturnType<typeof importArbundles>>
    signer: InstanceType<Awaited<ReturnType<typeof importArbundles>>['SolanaSigner']>
    address: string
  }> | null = null

  constructor(private readonly fundingKey: string) {}

  private load() {
    this.ctxPromise ??= (async () => {
      const mod = await importArbundles()
      const signer = new mod.SolanaSigner(this.fundingKey.trim())
      const address = bs58.encode(signer.publicKey)
      return { mod, signer, address }
    })()
    return this.ctxPromise
  }

  /** Public Solana address that signs every data item and holds the Turbo credit balance. */
  async signingAddress(): Promise<string> {
    return (await this.load()).address
  }

  /**
   * Sign and upload one ANS-104 data item. `data` is the raw bytes (image) or
   * a JSON string (metadata) — matches TurboProvider's uploadJSON/uploadImage
   * split, just tagged with Content-Type either way.
   */
  async upload(data: Uint8Array | string, contentType: string): Promise<TurboUploadResult> {
    const { mod, signer } = await this.load()
    const item = mod.createData(data, signer, { tags: [{ name: 'Content-Type', value: contentType }] })
    await item.sign(signer)

    const res = await fetch(`${TURBO_UPLOAD}/tx/${TOKEN}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: item.getRaw(),
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    })
    if (res.status === 402) {
      throw new TurboFundingShortError(
        `Turbo refused the upload — insufficient credit balance (402): ${(await safeText(res)).slice(0, 300)}`,
      )
    }
    if (!res.ok) {
      throw new Error(`Turbo upload failed: ${res.status} ${(await safeText(res)).slice(0, 400)}`)
    }
    const body = (await res.json()) as { id?: string; winc?: string }
    if (!body.id) {
      throw new Error('Turbo upload succeeded but returned no id')
    }
    return { id: body.id, wincSpent: body.winc ?? null }
  }

  /** Turbo's quoted winc price for uploading this many bytes (no auth needed). */
  async priceForBytes(bytes: number): Promise<bigint> {
    const res = await fetch(`${TURBO_PAYMENT}/price/bytes/${bytes}`, { signal: AbortSignal.timeout(READ_TIMEOUT_MS) })
    if (!res.ok) {
      throw new Error(`Turbo price lookup failed: ${res.status} ${(await safeText(res)).slice(0, 300)}`)
    }
    const body = (await res.json()) as { winc?: string }
    if (!body.winc) {
      throw new Error('Turbo price response had no winc field')
    }
    return BigInt(body.winc)
  }

  /**
   * Live SOL -> winc exchange rate, net of Turbo's own fee: winc a real
   * top-up of `lamports` SOL would actually credit. Verified against the live
   * API (2026-09-02): `/v1/price/solana/<lamports>` returns `{winc, fees,
   * actualPaymentAmount}`, where `winc` is already net of the "Turbo
   * Infrastructure Fee" multiply-adjustment — the same number a real top-up
   * receives, not the raw pre-fee conversion. Used by fees/compute.ts to
   * convert a storage quote (winc) into lamports without needing any external
   * AR/USD or SOL/USD price feed: this IS the operator's real cost basis for
   * acquiring that winc.
   */
  async quoteWincForLamports(lamports: bigint): Promise<bigint> {
    const res = await fetch(`${TURBO_PAYMENT}/price/solana/${lamports}`, {
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    })
    if (!res.ok) {
      throw new Error(`Turbo SOL exchange-rate lookup failed: ${res.status} ${(await safeText(res)).slice(0, 300)}`)
    }
    const body = (await res.json()) as { winc?: string }
    if (!body.winc) {
      throw new Error('Turbo SOL exchange-rate response had no winc field')
    }
    return BigInt(body.winc)
  }

  /**
   * Current spendable Turbo credit balance (winc) for the signing wallet.
   *
   * A wallet that has never funded Turbo credits returns 404 "User Not Found"
   * — verified against the live API — which IS zero balance, not an error.
   */
  async getBalance(): Promise<bigint> {
    const address = await this.signingAddress()
    const res = await fetch(`${TURBO_PAYMENT}/account/balance/${TOKEN}?address=${address}`, {
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    })
    if (res.status === 404) return 0n
    if (!res.ok) {
      throw new Error(`Turbo balance lookup failed: ${res.status} ${(await safeText(res)).slice(0, 300)}`)
    }
    const body = (await res.json()) as { effectiveBalance?: string; winc?: string }
    // effectiveBalance includes shared/approved credits; we never use
    // approvals, so it equals `winc` in practice — falling back to `winc`
    // keeps this correct even if that ever changes.
    const value = body.effectiveBalance ?? body.winc
    if (value === undefined) {
      throw new Error('Turbo balance response had neither effectiveBalance nor winc')
    }
    return BigInt(value)
  }
}

/**
 * Explicit `/web` subpath rather than the bare specifier: it's the lean build
 * (no `file/` subpath, so no transitive `axios` dependency, no ethers/cosmjs)
 * and this way the choice doesn't depend on wrangler's default condition
 * resolution picking "browser" for a bare import — verified against the
 * package's own export map (package.json `exports["."].browser` points at
 * the same file this resolves to).
 */
function importArbundles() {
  return import('@dha-team/arbundles/web')
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

export function buildTurboClient(env: ValidatedEnv): TurboClient {
  return new TurboClient(env.IRYS_FUNDING_KEY)
}
