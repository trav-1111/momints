export interface BackoffOptions {
  attempts?: number
  baseMs?: number
  maxMs?: number
}

function isRateLimitError(err: unknown): boolean {
  const msg = (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).toLowerCase()
  return msg.includes('429') || msg.includes('rate limit') || msg.includes('rate-limit') || msg.includes('too many requests')
}

/**
 * Exponential backoff for RPC calls. Only rate-limit-shaped errors are
 * retried — anything else propagates immediately so real failures stay loud.
 * A rate-limit that survives all attempts still throws, which mid-mint is
 * RESUMABLE (the frame checkpoint holds; the client retries from it), not a
 * hard failure.
 */
export async function withBackoff<T>(label: string, fn: () => Promise<T>, opts: BackoffOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 5
  const baseMs = opts.baseMs ?? 500
  const maxMs = opts.maxMs ?? 8000

  let lastErr: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (!isRateLimitError(err) || attempt === attempts - 1) {
        throw err
      }
      const delay = Math.min(maxMs, baseMs * 2 ** attempt) + Math.floor(Math.random() * 250)
      console.warn(`[retry] ${label}: rate-limited (attempt ${attempt + 1}/${attempts}), backing off ${delay}ms`)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  throw lastErr
}
