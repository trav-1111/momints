import type { Env } from '../env'

/**
 * Severity drives the embed colour, so the operator reads the state of the
 * system from the channel at a glance without opening the message.
 */
export type AlertSeverity = 'healthy' | 'low' | 'critical'

const SEVERITY_COLORS: Record<AlertSeverity, number> = {
  healthy: 0x4fd08a, // green  — recovered
  low: 0xe0b54f, // amber  — top up soon
  critical: 0xf0685e, // red    — top up today
}

/** Discord's documented embed limits. Exceeding any of them 400s the POST. */
const MAX_TITLE = 256
const MAX_DESCRIPTION = 4096
const MAX_FIELD_NAME = 256
const MAX_FIELD_VALUE = 1024
const MAX_FIELDS = 25

const POST_TIMEOUT_MS = 10_000
const MAX_LOGGED_BODY = 300

export interface DiscordAlert {
  severity: AlertSeverity
  title: string
  description?: string
  fields: Array<{ name: string; value: string }>
  /**
   * Ping OPERATOR_DISCORD_ID. CRITICAL only — a monitor that pings for
   * everything gets muted, and then it protects nothing.
   */
  mention?: boolean
}

export interface DiscordPostResult {
  ok: boolean
  /** Operator-facing reason when ok is false. Never contains the webhook URL. */
  error?: string
}

/**
 * Post one alert embed to the ops Discord channel. The single notification
 * primitive: every check in ops/monitor.ts goes through here, so adding a
 * check means writing a check function, not another delivery path.
 *
 * NEVER THROWS. A monitoring channel that can take down the thing it monitors
 * is worse than no channel — callers get { ok: false } and decide what to do
 * (the funding check deliberately leaves its D1 state unadvanced so the next
 * cron run retries the crossing).
 *
 * DISCORD_WEBHOOK_URL is a secret: anything logged from here runs through
 * redact() first, because fetch errors can echo the request URL.
 */
export async function postDiscordAlert(env: Env, alert: DiscordAlert): Promise<DiscordPostResult> {
  const webhookUrl = env.DISCORD_WEBHOOK_URL
  if (!webhookUrl) {
    const error =
      'DISCORD_WEBHOOK_URL is not set — alert not delivered. Set it with `wrangler secret put DISCORD_WEBHOOK_URL` (README runbook).'
    console.warn(`[ops] ${error}`)
    return { ok: false, error }
  }

  const body: Record<string, unknown> = {
    // parse: [] means nothing inside the embed text can ping anyone; the only
    // ping possible is the explicit user id added below.
    allowed_mentions: { parse: [] as string[] },
    embeds: [
      {
        title: alert.title.slice(0, MAX_TITLE),
        ...(alert.description ? { description: alert.description.slice(0, MAX_DESCRIPTION) } : {}),
        color: SEVERITY_COLORS[alert.severity],
        fields: alert.fields.slice(0, MAX_FIELDS).map((field) => ({
          name: field.name.slice(0, MAX_FIELD_NAME) || '—',
          value: field.value.slice(0, MAX_FIELD_VALUE) || '—',
          inline: true,
        })),
        timestamp: new Date().toISOString(),
        footer: { text: 'momints-roll-worker · treasury monitor (read-only)' },
      },
    ],
  }

  if (alert.mention) {
    const operatorId = env.OPERATOR_DISCORD_ID
    if (operatorId) {
      body.content = `<@${operatorId}>`
      body.allowed_mentions = { parse: [] as string[], users: [operatorId] }
    } else {
      // Post anyway: a critical alert nobody pinged still beats no alert.
      console.warn('[ops] OPERATOR_DISCORD_ID is not set — posting the critical alert without an @-mention.')
    }
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    })

    if (!response.ok) {
      const detail = redact(await safeBodyText(response), webhookUrl)
      const error = `Discord webhook returned ${response.status}${detail ? `: ${detail}` : ''}`
      console.error(`[ops] ${error}`)
      return { ok: false, error }
    }
    return { ok: true }
  } catch (err) {
    const error = `Discord webhook POST failed: ${redact(err instanceof Error ? err.message : String(err), webhookUrl)}`
    console.error(`[ops] ${error}`)
    return { ok: false, error }
  }
}

/** Response body for diagnostics; never let reading it become the failure. */
async function safeBodyText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, MAX_LOGGED_BODY)
  } catch {
    return ''
  }
}

/**
 * Strip the webhook URL — and its trailing token on its own — out of anything
 * headed for a log. Leaking it only allows channel spam, but it is still a
 * secret and is treated like one.
 */
function redact(text: string, webhookUrl: string): string {
  let out = text.split(webhookUrl).join('<discord-webhook-url>')
  const token = webhookUrl.slice(webhookUrl.lastIndexOf('/') + 1)
  if (token.length >= 8) {
    out = out.split(token).join('<discord-webhook-token>')
  }
  return out
}
