export interface Env {
  DB: D1Database
  /**
   * Base58 secret key of the DEVNET funding wallet (Worker Secret). Doubles as
   * the Worker's on-chain payer/authority for collection creation and frame
   * mints. Never generated, printed, or logged by this codebase.
   */
  IRYS_FUNDING_KEY?: string
  /**
   * Helius devnet RPC endpoint (Worker Secret). REQUIRED — the public
   * `api.devnet.solana.com` returns 403 to Workers' egress IPs when SENDING
   * transactions (read-only calls succeed, which masks the problem). There is
   * deliberately no public-endpoint fallback anywhere in this Worker.
   */
  SOLANA_RPC_URL?: string
  /** Optional: 'irys' (default, Arweave, permanent) or 'pinata' (TEST-ONLY). */
  STORAGE_PROVIDER?: string
  /** Optional: Pinata JWT — only needed for the TEST-ONLY Pinata fallback. */
  PINATA_JWT?: string
  /**
   * Discord channel webhook for operator alerts (Worker Secret). Optional and
   * deliberately NOT required by validateEnv: without it the Worker still
   * serves rolls and the treasury monitor still runs and logs — it just cannot
   * notify. Never logged; ops/discord.ts redacts it out of anything it prints.
   */
  DISCORD_WEBHOOK_URL?: string
  /**
   * Operator's Discord user ID, used to @-mention on CRITICAL alerts only.
   * Optional: without it critical alerts still post, just without the ping.
   */
  OPERATOR_DISCORD_ID?: string
}

/** Env after validation — the two required secrets are guaranteed present. */
export interface ValidatedEnv extends Env {
  IRYS_FUNDING_KEY: string
  SOLANA_RPC_URL: string
}

const PUBLIC_RPC_HOSTS = ['api.devnet.solana.com', 'api.mainnet-beta.solana.com', 'api.testnet.solana.com']

/**
 * Fail fast, loudly, and operator-facing when required secrets are missing or
 * point at a public RPC. Workers have no boot phase, so "at startup" means
 * the top of every request — before any work is attempted.
 */
export function validateEnv(env: Env): ValidatedEnv {
  if (!env.SOLANA_RPC_URL) {
    throw new ConfigError(
      'SOLANA_RPC_URL secret is not set. Set it to a Helius devnet endpoint with ' +
        '`wrangler secret put SOLANA_RPC_URL`. There is no public-endpoint fallback: ' +
        'api.devnet.solana.com blocks Workers from sending transactions.',
    )
  }
  const lower = env.SOLANA_RPC_URL.toLowerCase()
  if (PUBLIC_RPC_HOSTS.some((h) => lower.includes(h))) {
    throw new ConfigError(
      `SOLANA_RPC_URL points at a public Solana endpoint (${env.SOLANA_RPC_URL}). Public endpoints ` +
        'block Cloudflare Workers from sending transactions (403). Use a dedicated provider (Helius devnet).',
    )
  }
  if (!env.IRYS_FUNDING_KEY) {
    throw new ConfigError('IRYS_FUNDING_KEY secret is not set. Set it with `wrangler secret put IRYS_FUNDING_KEY`.')
  }
  return env as ValidatedEnv
}

/** Operator-facing misconfiguration — surfaced as HTTP 500 with the message intact. */
export class ConfigError extends Error {
  readonly isConfigError = true
}
