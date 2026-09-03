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

export interface QuickMintRow {
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
    return await this.db
      .prepare('SELECT * FROM rolls WHERE fee_signature = ?')
      .bind(feeSignature)
      .first<RollRow>()
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
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO rolls
           (collection_address, wallet, name, size, artist, skr_identity, cover_uri, metadata_uri, create_signature, fee_signature)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      )
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
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO frames (collection_address, frame_index, status, image_uri, metadata_uri, asset_address, mint_signature, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT (collection_address, frame_index) DO UPDATE SET
           status = excluded.status,
           image_uri = COALESCE(excluded.image_uri, frames.image_uri),
           metadata_uri = COALESCE(excluded.metadata_uri, frames.metadata_uri),
           asset_address = COALESCE(excluded.asset_address, frames.asset_address),
           mint_signature = COALESCE(excluded.mint_signature, frames.mint_signature),
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

  // ─── Quick mints ────────────────────────────────────────────────────────────

  async insertQuickMint(quick: {
    id: string
    wallet: string
    metadataJson: string
    stagingKey: string
    mime: string
    /** Fee quoted from fee_cache at stage time — see quick/stage.ts. */
    feeLamportsRequired: number
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO quick_mints (id, wallet, metadata_json, staging_key, mime, status, fee_lamports_required)
         VALUES (?, ?, ?, ?, ?, 'STAGED', ?)`,
      )
      .bind(quick.id, quick.wallet, quick.metadataJson, quick.stagingKey, quick.mime, quick.feeLamportsRequired)
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
  async claimQuickMintForFinalize(
    id: string,
    assetAddress: string,
    signature: string,
  ): Promise<boolean> {
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
  async markQuickMintDead(id: string, link?: { assetAddress: string; signature: string }): Promise<void> {
    if (link) {
      try {
        await this.db
          .prepare(`UPDATE quick_mints SET status = 'DEAD', asset_address = ?, signature = ? WHERE id = ?`)
          .bind(link.assetAddress, link.signature, id)
          .run()
        return
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (!message.includes('UNIQUE constraint failed')) throw err
        console.warn(`[quick] markQuickMintDead(${id}): could not link ${link.assetAddress} (UNIQUE conflict) — marking dead unlinked`)
      }
    }
    await this.db.prepare("UPDATE quick_mints SET status = 'DEAD' WHERE id = ?").bind(id).run()
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

  /**
   * STAGED rows WITH a recorded signature: a finalize was attempted (most
   * often verify's "not visible to the RPC yet" deferral) but never
   * completed. Distinct from listStalledFinalizingQuickMints, which only
   * covers rows that got PAST verify (status FINALIZING) — this covers rows
   * that never got that far, which used to be invisible to any sweep at all.
   */
  async listDeferredFinalizeQuickMints(beforeIso: string, limit: number): Promise<QuickMintRow[]> {
    const result = await this.db
      .prepare("SELECT * FROM quick_mints WHERE status = 'STAGED' AND signature IS NOT NULL AND created_at < ? LIMIT ?")
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
