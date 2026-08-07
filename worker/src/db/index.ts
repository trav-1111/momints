// Thin, typed D1 access layer. All SQL for rolls + frames lives here, plus the
// ops alert state the scheduled treasury monitor keeps.
// (Treasury bookkeeping SQL lives with its seam impl in providers/treasury.)

export type RollStatus = 'OPEN' | 'COMPLETE'
export type FrameStatus = 'IMAGE_UPLOADED' | 'METADATA_UPLOADED' | 'MINT_PENDING' | 'MINTED'

/** Ops alert severity, ordered healthy < low < critical (see ops/monitor.ts). */
export type AlertLevel = 'healthy' | 'low' | 'critical'

export interface RollRow {
  collection_address: string
  wallet: string
  name: string
  size: number
  artist: string
  skr_identity: string
  cover_uri: string
  metadata_uri: string
  minted_count: number
  status: RollStatus
  create_signature: string | null
  created_at: string
}

export interface OpsAlertStateRow {
  alert_key: string
  last_level: AlertLevel
  last_value: string | null
  updated_at: string
}

export interface FrameRow {
  collection_address: string
  frame_index: number
  status: FrameStatus
  image_uri: string | null
  metadata_uri: string | null
  asset_address: string | null
  mint_signature: string | null
  updated_at: string
}

export class RollDb {
  constructor(private readonly db: D1Database) {}

  async getOpenRoll(wallet: string): Promise<RollRow | null> {
    return await this.db
      .prepare("SELECT * FROM rolls WHERE wallet = ? AND status = 'OPEN'")
      .bind(wallet)
      .first<RollRow>()
  }

  async getRoll(collectionAddress: string): Promise<RollRow | null> {
    return await this.db
      .prepare('SELECT * FROM rolls WHERE collection_address = ?')
      .bind(collectionAddress)
      .first<RollRow>()
  }

  /**
   * Close a roll without waiting for all `size` frames to mint.
   *
   * `syncMintedCount` only completes a roll at mintedCount >= size, which the
   * shooter cannot always reach — a discarded roll, or a frame that never
   * mints, would otherwise hold the wallet's single OPEN slot forever (see the
   * partial unique index in 0001_init.sql). Nothing is deleted: minted frames
   * and their on-chain assets are untouched.
   */
  async closeRoll(collectionAddress: string): Promise<void> {
    await this.db
      .prepare("UPDATE rolls SET status = 'COMPLETE' WHERE collection_address = ? AND status = 'OPEN'")
      .bind(collectionAddress)
      .run()
  }

  /** Count of this wallet's rolls named for the given day — drives the .NN suffix. */
  async countRollsForDay(wallet: string, dayPrefix: string): Promise<number> {
    const row = await this.db
      .prepare('SELECT COUNT(*) AS n FROM rolls WHERE wallet = ? AND name LIKE ?')
      .bind(wallet, `${dayPrefix}.%`)
      .first<{ n: number }>()
    return row?.n ?? 0
  }

  async insertRoll(roll: {
    collectionAddress: string
    wallet: string
    name: string
    size: number
    artist: string
    skrIdentity: string
    coverUri: string
    metadataUri: string
    createSignature: string
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO rolls
           (collection_address, wallet, name, size, artist, skr_identity, cover_uri, metadata_uri, create_signature)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        roll.collectionAddress,
        roll.wallet,
        roll.name,
        roll.size,
        roll.artist,
        roll.skrIdentity,
        roll.coverUri,
        roll.metadataUri,
        roll.createSignature,
      )
      .run()
  }

  async getFrame(collectionAddress: string, frameIndex: number): Promise<FrameRow | null> {
    return await this.db
      .prepare('SELECT * FROM frames WHERE collection_address = ? AND frame_index = ?')
      .bind(collectionAddress, frameIndex)
      .first<FrameRow>()
  }

  async listFrames(collectionAddress: string): Promise<FrameRow[]> {
    const result = await this.db
      .prepare('SELECT * FROM frames WHERE collection_address = ? ORDER BY frame_index')
      .bind(collectionAddress)
      .all<FrameRow>()
    return result.results
  }

  /** Insert-or-advance a frame checkpoint. Later steps only ever add fields. */
  async upsertFrame(frame: {
    collectionAddress: string
    frameIndex: number
    status: FrameStatus
    imageUri?: string | null
    metadataUri?: string | null
    assetAddress?: string | null
    mintSignature?: string | null
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO frames (collection_address, frame_index, status, image_uri, metadata_uri, asset_address, mint_signature, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT (collection_address, frame_index) DO UPDATE SET
           status = excluded.status,
           image_uri = COALESCE(excluded.image_uri, frames.image_uri),
           metadata_uri = COALESCE(excluded.metadata_uri, frames.metadata_uri),
           asset_address = excluded.asset_address,
           mint_signature = excluded.mint_signature,
           updated_at = excluded.updated_at`,
      )
      .bind(
        frame.collectionAddress,
        frame.frameIndex,
        frame.status,
        frame.imageUri ?? null,
        frame.metadataUri ?? null,
        frame.assetAddress ?? null,
        frame.mintSignature ?? null,
      )
      .run()
  }

  /**
   * Recount MINTED frames, sync rolls.minted_count, and flip the roll to
   * COMPLETE when it reaches the roll size. Recomputing from the frames table
   * (rather than incrementing) keeps the count correct under retries.
   */
  async syncMintedCount(collectionAddress: string): Promise<{ mintedCount: number; status: RollStatus }> {
    await this.db
      .prepare(
        `UPDATE rolls SET
           minted_count = (SELECT COUNT(*) FROM frames
                           WHERE collection_address = ?1 AND status = 'MINTED'),
           status = CASE
             WHEN (SELECT COUNT(*) FROM frames
                   WHERE collection_address = ?1 AND status = 'MINTED') >= size
             THEN 'COMPLETE' ELSE status END
         WHERE collection_address = ?1`,
      )
      .bind(collectionAddress)
      .run()
    const roll = await this.getRoll(collectionAddress)
    return { mintedCount: roll?.minted_count ?? 0, status: roll?.status ?? 'OPEN' }
  }
}

/**
 * Last-posted alert level per ops alert stream — the memory behind the
 * treasury monitor's hysteresis (post only when the level CHANGES; see
 * ops/monitor.ts). Read-and-notify bookkeeping only: nothing here touches
 * funds. Future checks add a ROW (another alert_key), not another table.
 */
export class OpsAlertStore {
  constructor(private readonly db: D1Database) {}

  async get(alertKey: string): Promise<OpsAlertStateRow | null> {
    return await this.db
      .prepare('SELECT * FROM ops_alert_state WHERE alert_key = ?')
      .bind(alertKey)
      .first<OpsAlertStateRow>()
  }

  /**
   * Insert-or-update a stream's level. Called on every run, changed level or
   * not, so a stale `updated_at` is a reliable "the cron stopped running"
   * signal. The one case that must NOT record is a level change whose Discord
   * post failed — see checkFundingBalance.
   */
  async record(alertKey: string, level: AlertLevel, value: string | null): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO ops_alert_state (alert_key, last_level, last_value, updated_at)
         VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT (alert_key) DO UPDATE SET
           last_level = excluded.last_level,
           last_value = excluded.last_value,
           updated_at = excluded.updated_at`,
      )
      .bind(alertKey, level, value)
      .run()
  }
}
