// Thin, typed D1 access layer. All SQL for rolls, frames, and quick mints
// lives here, plus the ops alert state the scheduled treasury monitor keeps.
// (Treasury bookkeeping SQL lives with its seam impl in providers/treasury.)

export type RollStatus = 'OPEN' | 'COMPLETE'
export type FrameStatus = 'IMAGE_UPLOADED' | 'METADATA_UPLOADED' | 'MINT_PENDING' | 'MINTED'
export type QuickMintStatus = 'STAGED' | 'FINALIZING' | 'FINALIZED' | 'DEAD'

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
  /** Set once the Worker's UpdateDelegate is revoked at completion. See rolls/handoff.ts. */
  handoff_signature: string | null
  /** The verified on-chain transfer that paid this roll's fee. See rolls/verify.ts. */
  fee_signature: string | null
  created_at: string
  /** 'SOL' (default) or 'SKR' — which currency actually paid this roll's fee. See skr/quote.ts. */
  fee_currency: 'SOL' | 'SKR'
  /** Atomic $SKR units verified, when fee_currency = 'SKR' — audit trail only (see providers/treasury/manual.ts's doc comment on why $SKR has no treasury_entries row). */
  skr_fee_atomic: number | null
  /** v1 rows predate the authenticated frame-artifact contract. */
  protocol_version: number
  /** SHA-256 of the per-roll bearer capability; the plaintext is device-only. */
  auth_hash: string | null
  film_stock_id?: string | null
  film_mode?: 'color' | 'bw' | null
  aspect?: string | null
  fee_lamports?: number | null
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
  mime: string | null
  byte_length: number | null
  width: number | null
  height: number | null
  image_hash: string | null
  updated_at: string
}

export interface QuickMintRow {
  payment_state?: 'UNKNOWN' | 'CONFIRMED' | 'REJECTED'
  recovery_reason?: string | null
  verify_attempts?: number
  last_verify_at?: string | null
  id: string
  wallet: string
  metadata_json: string
  staging_key: string | null
  mime: string
  asset_address: string | null
  signature: string | null
  image_uri: string | null
  arweave_uri: string | null
  status: QuickMintStatus
  created_at: string
  finalized_at: string | null
  /** Fee quoted from fee_cache at STAGE time — see migrations/0007_fee_cache.sql. Null for rows staged before that migration. */
  fee_lamports_required: number | null
  /** 'SOL' (default) or 'SKR' — set by POST /skr/quote the moment a quote is issued for this row. See skr/quote.ts. */
  fee_currency: 'SOL' | 'SKR'
  /** Set together with fee_currency='SKR' — the exact amount finalize verifies against. Null until a quote is issued. */
  skr_quote_atomic: number | null
  skr_quote_expires_at: string | null
  byte_length: number | null
  width: number | null
  height: number | null
  image_hash: string | null
}

export interface SkrQuoteRow {
  wallet: string
  size: number
  skr_amount_atomic: number
  sol_fee_lamports: number
  treasury_ata: string
  expires_at: string
  created_at: string
}

/** A finalize lost the race to claim a signature another row already holds. */
export class DuplicateSignatureError extends Error {}

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

  /** One-time wallet-signed recovery for a protocol-v1 roll. */
  async claimLegacyRollCapability(collectionAddress: string, wallet: string, authHash: string): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE rolls SET auth_hash = ?
         WHERE collection_address = ? AND wallet = ? AND protocol_version = 1 AND auth_hash IS NULL`,
      )
      .bind(authHash, collectionAddress, wallet)
      .run()
    return (result.meta.changes ?? 0) > 0
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
  async closeRoll(collectionAddress: string, reason = 'legacy-client-close'): Promise<void> {
    await this.db
      .prepare(
        "UPDATE rolls SET status = 'COMPLETE', close_reason = ?, closed_by = 'capability-holder', closed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE collection_address = ? AND status = 'OPEN'",
      )
      .bind(reason, collectionAddress)
      .run()
  }

  /**
   * Record that the Worker's UpdateDelegate has been revoked on this roll's
   * collection — the shooter now holds sole control. Idempotent target: called
   * both from the synchronous completion path and from the sweep's retry, so a
   * second call just overwrites the same signature.
   */
  async markRollHandoff(collectionAddress: string, signature: string): Promise<void> {
    await this.db
      .prepare('UPDATE rolls SET handoff_signature = ? WHERE collection_address = ?')
      .bind(signature, collectionAddress)
      .run()
  }

  /**
   * COMPLETE rolls whose delegate has not been confirmed revoked — the
   * population the sweep re-drives. No age threshold: unlike the quick-mint
   * queue, there is no separate in-flight retry to race against, and revoking
   * is idempotent and cost-free, so retrying immediately every cron cycle is
   * safe. In steady state this should be empty or near-empty — the synchronous
   * completion path handles almost all of them inline.
   */
  async listStalledRollHandoffs(limit: number): Promise<RollRow[]> {
    const result = await this.db
      .prepare("SELECT * FROM rolls WHERE status = 'COMPLETE' AND handoff_signature IS NULL LIMIT ?")
      .bind(limit)
      .all<RollRow>()
    return result.results
  }

  /** Count of this wallet's rolls named for the given day — drives the .NN suffix. */
  async countRollsForDay(wallet: string, dayPrefix: string): Promise<number> {
    const row = await this.db
      .prepare('SELECT COUNT(*) AS n FROM rolls WHERE wallet = ? AND name LIKE ?')
      .bind(wallet, `${dayPrefix}.%`)
      .first<{ n: number }>()
    return row?.n ?? 0
  }

  /**
   * A friendly pre-check before the INSERT's UNIQUE constraint (idx_rolls_fee_signature)
   * rejects a replayed signature under a race — same pattern as getOpenRoll.
   */
  async getRollByFeeSignature(feeSignature: string): Promise<RollRow | null> {
    return await this.db.prepare('SELECT * FROM rolls WHERE fee_signature = ?').bind(feeSignature).first<RollRow>()
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
    feeSignature: string
    /** Defaults 'SOL' — pass 'SKR' only from the $SKR branch of rolls/create.ts. */
    feeCurrency?: 'SOL' | 'SKR'
    skrFeeAtomic?: number
    protocolVersion: number
    authHash: string
    filmStockId?: string
    filmMode?: 'color' | 'bw'
    aspect?: string
    feeLamports?: number
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO rolls
           (collection_address, wallet, name, size, artist, skr_identity, cover_uri, metadata_uri, create_signature, fee_signature, fee_currency, skr_fee_atomic, protocol_version, auth_hash, film_stock_id, film_mode, aspect, fee_lamports)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        roll.feeSignature,
        roll.feeCurrency ?? 'SOL',
        roll.skrFeeAtomic ?? null,
        roll.protocolVersion,
        roll.authHash,
        roll.filmStockId ?? null,
        roll.filmMode ?? null,
        roll.aspect ?? null,
        roll.feeLamports ?? null,
      )
      .run()
  }

  // ─── $SKR quotes ────────────────────────────────────────────────────────────

  /**
   * A roll doesn't exist yet at quote time, so its quote lives here instead of
   * on a row — one slot per wallet (upsert), consumed by deleteRollSkrQuote
   * once rolls/create.ts has verified against it. See migrations/0008.
   */
  async upsertRollSkrQuote(
    wallet: string,
    quote: { size: number; atomic: number; solFeeLamports: number; treasuryAta: string; expiresAt: string },
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO skr_quotes (wallet, size, skr_amount_atomic, sol_fee_lamports, treasury_ata, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (wallet) DO UPDATE SET
           size = excluded.size,
           skr_amount_atomic = excluded.skr_amount_atomic,
           sol_fee_lamports = excluded.sol_fee_lamports,
           treasury_ata = excluded.treasury_ata,
           expires_at = excluded.expires_at,
           created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      )
      .bind(wallet, quote.size, quote.atomic, quote.solFeeLamports, quote.treasuryAta, quote.expiresAt)
      .run()
  }

  async getRollSkrQuote(wallet: string): Promise<SkrQuoteRow | null> {
    return await this.db.prepare('SELECT * FROM skr_quotes WHERE wallet = ?').bind(wallet).first<SkrQuoteRow>()
  }

  /** Consumed on successful verification — a quote can never be replayed against a second roll. */
  async deleteRollSkrQuote(wallet: string): Promise<void> {
    await this.db.prepare('DELETE FROM skr_quotes WHERE wallet = ?').bind(wallet).run()
  }

  /**
   * Sets fee_currency='SKR' the moment a quote is issued for a staged row —
   * issuing a quote IS the row committing to pay in $SKR. Guarded to STAGED so
   * a quote can never be attached to a row already past the point where its
   * currency could matter.
   */
  async recordQuickSkrQuote(id: string, quote: { atomic: number; expiresAt: string }): Promise<void> {
    await this.db
      .prepare(
        `UPDATE quick_mints SET fee_currency = 'SKR', skr_quote_atomic = ?, skr_quote_expires_at = ?
         WHERE id = ? AND status = 'STAGED'`,
      )
      .bind(quote.atomic, quote.expiresAt, id)
      .run()
  }

  async getFrame(collectionAddress: string, frameIndex: number): Promise<FrameRow | null> {
    return await this.db
      .prepare('SELECT * FROM frames WHERE collection_address = ? AND frame_index = ?')
      .bind(collectionAddress, frameIndex)
      .first<FrameRow>()
  }

  /**
   * Claim the mint lock for one frame, atomically. Returns false when another
   * request already holds a live lock (younger than `staleSeconds`) — the
   * caller must refuse rather than race it. A lock older than that is treated
   * as abandoned (the holder crashed or hit the Workers CPU limit) and can be
   * reclaimed, so a genuinely dead request can never wedge a frame forever.
   */
  async claimFrameLock(collectionAddress: string, frameIndex: number, staleSeconds: number): Promise<boolean> {
    const result = await this.db
      .prepare(
        `INSERT INTO frame_locks (collection_address, frame_index, locked_at)
         VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT (collection_address, frame_index) DO UPDATE SET
           locked_at = excluded.locked_at
         WHERE frame_locks.locked_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)`,
      )
      .bind(collectionAddress, frameIndex, `-${staleSeconds} seconds`)
      .run()
    return (result.meta.changes ?? 0) > 0
  }

  /** Release a frame's mint lock. Safe to call even if never claimed. */
  async releaseFrameLock(collectionAddress: string, frameIndex: number): Promise<void> {
    await this.db
      .prepare('DELETE FROM frame_locks WHERE collection_address = ? AND frame_index = ?')
      .bind(collectionAddress, frameIndex)
      .run()
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
    mime?: string | null
    byteLength?: number | null
    width?: number | null
    height?: number | null
    imageHash?: string | null
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO frames
           (collection_address, frame_index, status, image_uri, metadata_uri, asset_address, mint_signature,
            mime, byte_length, width, height, image_hash, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT (collection_address, frame_index) DO UPDATE SET
           status = excluded.status,
           image_uri = COALESCE(excluded.image_uri, frames.image_uri),
           metadata_uri = COALESCE(excluded.metadata_uri, frames.metadata_uri),
           asset_address = COALESCE(excluded.asset_address, frames.asset_address),
           mint_signature = COALESCE(excluded.mint_signature, frames.mint_signature),
           mime = COALESCE(excluded.mime, frames.mime),
           byte_length = COALESCE(excluded.byte_length, frames.byte_length),
           width = COALESCE(excluded.width, frames.width),
           height = COALESCE(excluded.height, frames.height),
           image_hash = COALESCE(excluded.image_hash, frames.image_hash),
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
        frame.mime ?? null,
        frame.byteLength ?? null,
        frame.width ?? null,
        frame.height ?? null,
        frame.imageHash ?? null,
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
             THEN 'COMPLETE' ELSE status END,
           close_reason = CASE WHEN (SELECT COUNT(*) FROM frames WHERE collection_address = ?1 AND status = 'MINTED') >= size THEN COALESCE(close_reason,'full-roll-minted') ELSE close_reason END,
           closed_by = CASE WHEN (SELECT COUNT(*) FROM frames WHERE collection_address = ?1 AND status = 'MINTED') >= size THEN COALESCE(closed_by,'worker') ELSE closed_by END,
           closed_at = CASE WHEN (SELECT COUNT(*) FROM frames WHERE collection_address = ?1 AND status = 'MINTED') >= size THEN COALESCE(closed_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ELSE closed_at END
         WHERE collection_address = ?1`,
      )
      .bind(collectionAddress)
      .run()
    const roll = await this.getRoll(collectionAddress)
    return { mintedCount: roll?.minted_count ?? 0, status: roll?.status ?? 'OPEN' }
  }

  // ─── Quick mints ────────────────────────────────────────────────────────────

  async insertQuickMint(quick: {
    id: string
    wallet: string
    metadataJson: string
    stagingKey: string
    mime: string
    /** Fee quoted from fee_cache at stage time — see quick/stage.ts. */
    feeLamportsRequired: number
    byteLength: number
    width: number
    height: number
    imageHash: string
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO quick_mints
           (id, wallet, metadata_json, staging_key, mime, status, fee_lamports_required,
            byte_length, width, height, image_hash)
         VALUES (?, ?, ?, ?, ?, 'STAGED', ?, ?, ?, ?, ?)`,
      )
      .bind(
        quick.id,
        quick.wallet,
        quick.metadataJson,
        quick.stagingKey,
        quick.mime,
        quick.feeLamportsRequired,
        quick.byteLength,
        quick.width,
        quick.height,
        quick.imageHash,
      )
      .run()
  }

  async getQuickMint(id: string): Promise<QuickMintRow | null> {
    return await this.db.prepare('SELECT * FROM quick_mints WHERE id = ?').bind(id).first<QuickMintRow>()
  }

  async getQuickMintByAsset(assetAddress: string): Promise<QuickMintRow | null> {
    return await this.db
      .prepare('SELECT * FROM quick_mints WHERE asset_address = ?')
      .bind(assetAddress)
      .first<QuickMintRow>()
  }

  /** Stages started by this wallet since `sinceIso` — drives the daily cap. */
  async countQuickStagesSince(wallet: string, sinceIso: string): Promise<number> {
    const row = await this.db
      .prepare('SELECT COUNT(*) AS n FROM quick_mints WHERE wallet = ? AND created_at >= ?')
      .bind(wallet, sinceIso)
      .first<{ n: number }>()
    return row?.n ?? 0
  }

  /**
   * Claim a STAGED row for finalization. This is the single gate between "no
   * money has moved" and "Arweave may now be spent", so it is a conditional
   * update rather than a plain write:
   *
   * - `WHERE status = 'STAGED'` means two concurrent finalizes cannot both
   *   enqueue; the loser gets false and re-reads the row.
   * - the UNIQUE constraints on signature/asset_address mean a landed fee
   *   transfer cannot be replayed against a second staged image — that attempt
   *   surfaces as DuplicateSignatureError.
   */
  async claimQuickMintForFinalize(id: string, assetAddress: string, signature: string): Promise<boolean> {
    try {
      const result = await this.db
        .prepare(
          `UPDATE quick_mints SET status = 'FINALIZING', asset_address = ?, signature = ?
           WHERE id = ? AND status = 'STAGED'`,
        )
        .bind(assetAddress, signature, id)
        .run()
      return (result.meta.changes ?? 0) > 0
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('UNIQUE constraint failed')) {
        throw new DuplicateSignatureError(message)
      }
      throw err
    }
  }

  /**
   * Record a permanent-storage URI. Only ever adds: these are the checkpoints
   * that stop a retry from paying for the same bytes twice, so a later call
   * must not be able to blank an earlier one.
   */
  async saveQuickMintUpload(id: string, uris: { imageUri?: string; arweaveUri?: string }): Promise<void> {
    await this.db
      .prepare(
        `UPDATE quick_mints SET
           image_uri = COALESCE(?, image_uri),
           arweave_uri = COALESCE(?, arweave_uri)
         WHERE id = ?`,
      )
      .bind(uris.imageUri ?? null, uris.arweaveUri ?? null, id)
      .run()
  }

  /** Real URI live on-chain. Clears staging_key — the R2 object is gone. */
  async markQuickMintFinalized(id: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE quick_mints SET
           status = 'FINALIZED',
           staging_key = NULL,
           finalized_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`,
      )
      .bind(id)
      .run()
  }

  /**
   * Dead-lettered: a mint the Worker will not finish, for one of two reasons —
   * a paid mint stuck on the placeholder (consumer exhausted its retries), or
   * a finalize whose verify step definitively REJECTED a transaction that had
   * nonetheless already landed on-chain (see quick/finalize.ts). Never
   * deleted: a rejection this late already read a real transaction off the
   * chain, so treating it as "nothing happened" and discarding the row would
   * destroy the only evidence an operator has to investigate or recover it.
   *
   * `link`, when given, records the asset/signature the row didn't get to
   * record via the normal claim path (a 402 rejection happens BEFORE
   * claimQuickMintForFinalize runs) — without it the row is orphaned from
   * `GET /quick/<asset>` even though it now exists. Swallows a UNIQUE
   * constraint violation (another row already claims that signature/asset)
   * rather than losing the DEAD marking over it — the row still needs to be
   * marked dead and alerted on either way.
   */
  async markQuickMintDead(id: string, _link?: { assetAddress: string; signature: string }): Promise<void> {
    await this.db
      .prepare("UPDATE quick_mints SET status = 'DEAD', asset_address = NULL, signature = NULL WHERE id = ?")
      .bind(id)
      .run()
  }

  /**
   * Drop a stage that will never be finalized — the orphan sweep only.
   * Restricted to STAGED **and signature IS NULL** so it can never delete a
   * row that represents a finalize attempt: a NULL signature is the only safe
   * proof nothing was ever submitted for this row. (A row with a recorded
   * signature but still STAGED is a DEFERRED finalize, not an orphan — see
   * recordFinalizeAttempt / listDeferredFinalizes — and must never be
   * silently deleted; that gap was a real incident.)
   */
  async deleteStagedQuickMint(id: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM quick_mints WHERE id = ? AND status = 'STAGED' AND signature IS NULL")
      .bind(id)
      .run()
  }

  /** Abandoned stages, for the sweep. Nothing here was ever paid for — signature IS NULL is what proves that. */
  async listStaleStagedQuickMints(beforeIso: string, limit: number): Promise<QuickMintRow[]> {
    const result = await this.db
      .prepare("SELECT * FROM quick_mints WHERE status = 'STAGED' AND signature IS NULL AND created_at < ? LIMIT ?")
      .bind(beforeIso, limit)
      .all<QuickMintRow>()
    return result.results
  }

  /**
   * Record which signature/asset a finalize attempt is FOR, independent of
   * whether verify ends up succeeding this call. Called unconditionally near
   * the top of finalizeQuickMint, before verify runs — so even a DEFERRED
   * finalize (verify says "not visible to the RPC yet", a normal and frequent
   * event, not a failure) leaves the row discoverable server-side. Before
   * this existed, a deferral's signature lived only in the calling client's
   * memory/persisted queue; if that client never successfully called back —
   * app closed, backgrounded and never reopened, uninstalled — nothing
   * server-side ever learned what transaction the row was even waiting on,
   * and a paid, minted asset was permanently stranded on the placeholder with
   * no alert. That was a real incident, not a hypothetical.
   *
   * Idempotent: a row only ever has ONE real attempt in its lifetime (a retry
   * that might reuse a stale signature goes through checkPriorAttempt
   * app-side first, which starts a fresh row rather than resubmitting a
   * different signature against this one) — so the `asset_address IS NULL`
   * guard makes every call after the first a harmless no-op, and
   * claimQuickMintForFinalize later just re-writes the same values while
   * flipping status. Swallows a UNIQUE conflict as DuplicateSignatureError,
   * same as the claim path — that specific signature already belongs to a
   * different row.
   */
  async recordFinalizeAttempt(id: string, assetAddress: string, signature: string): Promise<void> {
    try {
      await this.db
        .prepare(`UPDATE quick_mints SET asset_address = ?, signature = ? WHERE id = ? AND asset_address IS NULL`)
        .bind(assetAddress, signature, id)
        .run()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('UNIQUE constraint failed')) {
        throw new DuplicateSignatureError(message)
      }
      throw err
    }
  }

  async recordQuickVerification(
    id: string,
    state: 'UNKNOWN' | 'CONFIRMED' | 'REJECTED',
    reason: string | null,
  ): Promise<void> {
    await this.db
      .prepare(
        "UPDATE quick_mints SET payment_state=?, recovery_reason=CASE WHEN ?='UNKNOWN' AND recovery_reason='REVIEW_REQUIRED' THEN recovery_reason ELSE ? END, verify_attempts=verify_attempts+1, last_verify_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
      )
      .bind(state, state, reason, id)
      .run()
  }

  async preserveQuickStaging(id: string, oldKey: string, newKey: string): Promise<void> {
    await this.db
      .prepare('UPDATE quick_mints SET staging_key=? WHERE id=? AND staging_key=?')
      .bind(newKey, id, oldKey)
      .run()
  }

  async getQuickRecoveryCounts(): Promise<{ unknown: number; confirmed: number; rejected: number; review: number }> {
    return (
      (await this.db
        .prepare(
          `SELECT
      COALESCE(SUM(CASE WHEN signature IS NOT NULL AND payment_state='UNKNOWN' THEN 1 ELSE 0 END),0) AS unknown,
      COALESCE(SUM(CASE WHEN status!='FINALIZED' AND payment_state='CONFIRMED' THEN 1 ELSE 0 END),0) AS confirmed,
      COALESCE(SUM(CASE WHEN payment_state='REJECTED' THEN 1 ELSE 0 END),0) AS rejected,
      COALESCE(SUM(CASE WHEN recovery_reason='REVIEW_REQUIRED' OR status='DEAD' THEN 1 ELSE 0 END),0) AS review
      FROM quick_mints`,
        )
        .first<{ unknown: number; confirmed: number; rejected: number; review: number }>()) ?? {
        unknown: 0,
        confirmed: 0,
        rejected: 0,
        review: 0,
      }
    )
  }

  /**
   * STAGED rows WITH a recorded signature: a finalize was attempted (most
   * often verify's "not visible to the RPC yet" deferral) but never
   * completed. Distinct from listStalledFinalizingQuickMints, which only
   * covers rows that got PAST verify (status FINALIZING) — this covers rows
   * that never got that far, which used to be invisible to any sweep at all.
   */
  async listDeferredFinalizeQuickMints(beforeIso: string, limit: number): Promise<QuickMintRow[]> {
    const result = await this.db
      .prepare(
        "SELECT * FROM quick_mints WHERE status = 'STAGED' AND signature IS NOT NULL AND created_at < ? ORDER BY COALESCE(last_verify_at,created_at), id LIMIT ?",
      )
      .bind(beforeIso, limit)
      .all<QuickMintRow>()
    return result.results
  }

  /**
   * Paid mints that claimed the queue but never reached FINALIZED — the queue
   * message was lost, or never enqueued at all because the send itself failed.
   * The fee is already collected for every row here, so the sweep re-drives
   * them rather than letting them sit on the placeholder.
   */
  async listStalledFinalizingQuickMints(beforeIso: string, limit: number): Promise<QuickMintRow[]> {
    const result = await this.db
      .prepare("SELECT * FROM quick_mints WHERE status = 'FINALIZING' AND created_at < ? LIMIT ?")
      .bind(beforeIso, limit)
      .all<QuickMintRow>()
    return result.results
  }

  // ─── Dashboard aggregates (ops/dashboard.ts) ───────────────────────────────
  //
  // Every method here returns a COUNT/SUM or a small GROUP BY result — never a
  // `wallet` column. That is the structural half of "aggregate only, no
  // per-wallet profiling": there is no query in this file a dashboard handler
  // could call to answer "what has wallet X done."

  /** GROUP BY status/currency — health's DEAD/deferred counts and metrics' quick-mint totals both derive from this one read. `sinceIso` null = all-time. */
  async getQuickMintCounts(
    sinceIso: string | null,
  ): Promise<{ status: QuickMintStatus; feeCurrency: 'SOL' | 'SKR'; count: number }[]> {
    const result = await this.db
      .prepare(
        `SELECT status, fee_currency, COUNT(*) as n FROM quick_mints
         WHERE (?1 IS NULL OR created_at >= ?1)
         GROUP BY status, fee_currency`,
      )
      .bind(sinceIso)
      .all<{ status: QuickMintStatus; fee_currency: 'SOL' | 'SKR'; n: number }>()
    return result.results.map((r) => ({ status: r.status, feeCurrency: r.fee_currency, count: r.n }))
  }

  /** STAGED-with-a-recorded-signature — the round-4 deferred-finalize recovery population. No window: this is a current-state health count, not a historical one. */
  async getDeferredQuickMintCount(): Promise<number> {
    const row = await this.db
      .prepare("SELECT COUNT(*) as n FROM quick_mints WHERE status = 'STAGED' AND signature IS NOT NULL")
      .first<{ n: number }>()
    return row?.n ?? 0
  }

  /** GROUP BY status/currency, with total frames minted per group — feeds both health-adjacent and metrics reads. `sinceIso` null = all-time. */
  async getRollCounts(
    sinceIso: string | null,
  ): Promise<{ status: RollStatus; feeCurrency: 'SOL' | 'SKR'; count: number; framesMinted: number }[]> {
    const result = await this.db
      .prepare(
        `SELECT status, fee_currency, COUNT(*) as n, COALESCE(SUM(minted_count), 0) as frames FROM rolls
         WHERE (?1 IS NULL OR created_at >= ?1)
         GROUP BY status, fee_currency`,
      )
      .bind(sinceIso)
      .all<{ status: RollStatus; fee_currency: 'SOL' | 'SKR'; n: number; frames: number }>()
    return result.results.map((r) => ({
      status: r.status,
      feeCurrency: r.fee_currency,
      count: r.n,
      framesMinted: r.frames,
    }))
  }

  /** COMPLETE rolls whose delegate revoke never landed — the same population "Re-driving a stuck roll handoff" (README) covers. Current-state, no window. */
  async getStuckRollHandoffCount(): Promise<number> {
    const row = await this.db
      .prepare("SELECT COUNT(*) as n FROM rolls WHERE status = 'COMPLETE' AND handoff_signature IS NULL")
      .first<{ n: number }>()
    return row?.n ?? 0
  }

  /**
   * SOL fees actually collected, by kind — treasury_entries is already the
   * correct source (both quick_mint_fee and roll_fee land here via
   * TreasurySink.record()). $SKR fees are deliberately absent from this
   * table (see providers/treasury/manual.ts's doc comment: no conversion
   * needed, so nothing is recorded) — see getSkrFeeTotals for those.
   */
  async getTreasuryFeeTotals(
    sinceIso: string | null,
  ): Promise<{ kind: string; totalLamports: number; count: number }[]> {
    const result = await this.db
      .prepare(
        `SELECT json_extract(context, '$.kind') as kind, COALESCE(SUM(amount_lamports), 0) as total, COUNT(*) as n
         FROM treasury_entries
         WHERE (?1 IS NULL OR created_at >= ?1)
         GROUP BY kind`,
      )
      .bind(sinceIso)
      .all<{ kind: string; total: number; n: number }>()
    return result.results.map((r) => ({ kind: r.kind, totalLamports: r.total, count: r.n }))
  }

  /** $SKR fees actually collected — quick_mints/rolls are the source (never treasury_entries; see getTreasuryFeeTotals). `sinceIso` null = all-time. */
  async getSkrFeeTotals(
    sinceIso: string | null,
  ): Promise<{ quickTotalAtomic: number; quickCount: number; rollTotalAtomic: number; rollCount: number }> {
    const row = await this.db
      .prepare(
        `SELECT
           (SELECT COALESCE(SUM(skr_quote_atomic), 0) FROM quick_mints WHERE status = 'FINALIZED' AND fee_currency = 'SKR' AND (?1 IS NULL OR created_at >= ?1)) as quick_total,
           (SELECT COUNT(*) FROM quick_mints WHERE status = 'FINALIZED' AND fee_currency = 'SKR' AND (?1 IS NULL OR created_at >= ?1)) as quick_count,
           (SELECT COALESCE(SUM(skr_fee_atomic), 0) FROM rolls WHERE fee_currency = 'SKR' AND (?1 IS NULL OR created_at >= ?1)) as roll_total,
           (SELECT COUNT(*) FROM rolls WHERE fee_currency = 'SKR' AND (?1 IS NULL OR created_at >= ?1)) as roll_count`,
      )
      .bind(sinceIso)
      .first<{ quick_total: number; quick_count: number; roll_total: number; roll_count: number }>()
    return {
      quickTotalAtomic: row?.quick_total ?? 0,
      quickCount: row?.quick_count ?? 0,
      rollTotalAtomic: row?.roll_total ?? 0,
      rollCount: row?.roll_count ?? 0,
    }
  }

  /** A single COUNT(DISTINCT wallet) across finalized quick mints + rolls — the per-row wallets themselves never leave SQL. `sinceIso` null = all-time. */
  async getUniqueWalletCount(sinceIso: string | null): Promise<number> {
    const row = await this.db
      .prepare(
        `SELECT COUNT(DISTINCT wallet) as n FROM (
           SELECT wallet FROM quick_mints WHERE status = 'FINALIZED' AND (?1 IS NULL OR created_at >= ?1)
           UNION
           SELECT wallet FROM rolls WHERE (?1 IS NULL OR created_at >= ?1)
         )`,
      )
      .bind(sinceIso)
      .first<{ n: number }>()
    return row?.n ?? 0
  }

  /** Daily FINALIZED-quick-mint counts since `sinceIso` — one half of the mints-over-time chart; see getRollFramesPerDay for the other. */
  async getQuickMintsPerDay(sinceIso: string): Promise<{ day: string; count: number }[]> {
    const result = await this.db
      .prepare(
        `SELECT date(finalized_at) as day, COUNT(*) as n FROM quick_mints
         WHERE status = 'FINALIZED' AND finalized_at >= ? GROUP BY day ORDER BY day`,
      )
      .bind(sinceIso)
      .all<{ day: string; n: number }>()
    return result.results.map((r) => ({ day: r.day, count: r.n }))
  }

  /** Daily MINTED-frame counts since `sinceIso` — the roll half of the mints-over-time chart. */
  async getRollFramesPerDay(sinceIso: string): Promise<{ day: string; count: number }[]> {
    const result = await this.db
      .prepare(
        `SELECT date(updated_at) as day, COUNT(*) as n FROM frames
         WHERE status = 'MINTED' AND updated_at >= ? GROUP BY day ORDER BY day`,
      )
      .bind(sinceIso)
      .all<{ day: string; n: number }>()
    return result.results.map((r) => ({ day: r.day, count: r.n }))
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
