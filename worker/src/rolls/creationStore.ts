import { HttpError } from '../lib/http'

export interface PurchaseQuote {
  id: string
  wallet: string
  size: number
  currency: 'SOL' | 'SKR'
  amount: number
  treasury_ata: string | null
  auth_hash: string
  created_at: string
  expires_at: string
}

export interface CreationCheckpoint {
  wallet: string
  size: 12 | 24
  filmStockId: string
  artist: string
  skrIdentity: string
  payment: 'SOL' | 'SKR'
  authHash: string
  dateLabel: string
  name: string
  feeLamports: number
  skrQuoteAtomic?: number
  filmMode?: 'color' | 'bw'
  aspect?: string
  coverUri?: string
  metadataUri?: string
  collectionAddress?: string
  signerAuthority?: string
  signedTransaction?: string
  signature?: string
  lastValidBlockHeight?: number
}

interface CreationRow {
  fee_signature: string
  wallet: string
  data: string
  status: string
}

export class RollCreationStore {
  constructor(private readonly db: D1Database) {}
  async hasPendingWallet(wallet: string): Promise<boolean> {
    return !!(await this.db
      .prepare("SELECT fee_signature FROM roll_creations WHERE wallet = ? AND status = 'PENDING'")
      .bind(wallet)
      .first())
  }
  async quote(id: string): Promise<PurchaseQuote | null> {
    return this.db.prepare('SELECT * FROM roll_purchase_quotes WHERE id = ?').bind(id).first<PurchaseQuote>()
  }
  async putQuote(q: PurchaseQuote): Promise<void> {
    await this.db
      .prepare(
        'INSERT INTO roll_purchase_quotes (id,wallet,size,currency,amount,treasury_ata,auth_hash,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)',
      )
      .bind(q.id, q.wallet, q.size, q.currency, q.amount, q.treasury_ata, q.auth_hash, q.created_at, q.expires_at)
      .run()
  }
  async get(signature: string): Promise<CreationCheckpoint | null> {
    const row = await this.db
      .prepare('SELECT * FROM roll_creations WHERE fee_signature = ?')
      .bind(signature)
      .first<CreationRow>()
    return row ? (JSON.parse(row.data) as CreationCheckpoint) : null
  }
  async reserve(signature: string, data: CreationCheckpoint): Promise<void> {
    try {
      await this.db
        .prepare(
          "INSERT INTO roll_creations (fee_signature,wallet,data) SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM rolls WHERE wallet = ? AND status = 'OPEN') ON CONFLICT(fee_signature) DO NOTHING",
        )
        .bind(signature, data.wallet, JSON.stringify(data), data.wallet)
        .run()
      if (!(await this.get(signature)))
        throw new HttpError(
          409,
          'This wallet already has an open roll. Preserve this receipt for support; do not pay again.',
        )
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes('UNIQUE constraint failed')) throw err
      if (!(await this.get(signature)))
        throw new HttpError(
          409,
          'Another verified roll purchase is pending for this wallet. Recover that receipt before creating another roll.',
        )
    }
  }
  async claim(signature: string, owner: string): Promise<boolean> {
    const result = await this.db
      .prepare(
        "UPDATE roll_creations SET lease_owner = ?, lease_until = ? WHERE fee_signature = ? AND status = 'PENDING' AND (lease_until IS NULL OR lease_until < ?)",
      )
      .bind(owner, new Date(Date.now() + 300_000).toISOString(), signature, new Date().toISOString())
      .run()
    return (result.meta.changes ?? 0) === 1
  }
  async checkpoint(signature: string, owner: string, data: CreationCheckpoint): Promise<void> {
    const result = await this.db
      .prepare(
        "UPDATE roll_creations SET data = ?, lease_until = ? WHERE fee_signature = ? AND lease_owner = ? AND status = 'PENDING'",
      )
      .bind(JSON.stringify(data), new Date(Date.now() + 300_000).toISOString(), signature, owner)
      .run()
    if ((result.meta.changes ?? 0) !== 1)
      throw new HttpError(503, 'Roll creation lease changed. Retry the same receipt.')
  }
  async finish(signature: string): Promise<void> {
    await this.db
      .prepare(
        "UPDATE roll_creations SET status = 'COMMITTED', lease_owner = NULL, lease_until = NULL WHERE fee_signature = ?",
      )
      .bind(signature)
      .run()
  }
  async release(signature: string, owner: string): Promise<void> {
    await this.db
      .prepare(
        'UPDATE roll_creations SET lease_owner = NULL, lease_until = NULL WHERE fee_signature = ? AND lease_owner = ?',
      )
      .bind(signature, owner)
      .run()
  }
}
