export type JobName = 'fee-recompute' | 'treasury-monitor' | 'quick-sweep' | 'deferred-finalize' | 'roll-handoff'
export interface JobHeartbeat {
  job: JobName
  last_attempt_at: string
  last_success_at: string | null
  last_attempt_ok: number | null
  failure_code: string | null
}
export class JobHeartbeatStore {
  constructor(private readonly db: D1Database) {}
  async start(job: JobName, attempt: string) {
    await this.db
      .prepare(
        'INSERT INTO job_heartbeats (job,last_attempt_at,last_attempt_ok,failure_code) VALUES (?,?,NULL,NULL) ON CONFLICT(job) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,last_attempt_ok=NULL,failure_code=NULL',
      )
      .bind(job, attempt)
      .run()
  }
  async finish(job: JobName, attempt: string, ok: boolean) {
    await this.db
      .prepare(
        'UPDATE job_heartbeats SET last_attempt_ok=?, last_success_at=CASE WHEN ?=1 THEN ? ELSE last_success_at END, failure_code=? WHERE job=? AND last_attempt_at=?',
      )
      .bind(ok ? 1 : 0, ok ? 1 : 0, attempt, ok ? null : 'job-failed', job, attempt)
      .run()
  }
  async list(): Promise<JobHeartbeat[]> {
    return (await this.db.prepare('SELECT * FROM job_heartbeats ORDER BY job').all<JobHeartbeat>()).results
  }
}

/** Alert hysteresis and notification delivery are independent of job execution.
 * Heartbeat write failures must not suppress recovery work in another system. */
export async function withJobHeartbeat<T>(
  store: JobHeartbeatStore,
  job: JobName,
  run: () => Promise<T>,
  succeeded: (value: T) => boolean = () => true,
): Promise<T> {
  const attempt = new Date().toISOString()
  const safe = async (write: () => Promise<void>) => {
    try {
      await write()
    } catch {
      console.error(`[ops] heartbeat write failed: ${job}`)
    }
  }
  await safe(() => store.start(job, attempt))
  let ok = false
  try {
    const value = await run()
    ok = succeeded(value)
    return value
  } finally {
    await safe(() => store.finish(job, attempt, ok))
  }
}
