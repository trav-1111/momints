/** Enqueued by POST /quick/finalize once the fee-paying mint is verified. */
export interface QuickFinalizeMessage {
  quickMintId: string
}

export interface Env {
  DB: D1Database
  /** Staged quick-mint images, pending a verified fee. 24h lifecycle rule. */
  QUICK_STAGING: R2Bucket
  /**
   * Finalize jobs. A message here means the fee is ALREADY collected and the
   * asset is ALREADY minted on the placeholder — so the consumer must keep
   * retrying rather than drop work. Failures dead-letter to an operator alert.
   */
  QUICK_FINALIZE: Queue<QuickFinalizeMessage>
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
  /**
   * Arweave URI of the static "developing" metadata every quick mint is minted
   * against before its real image exists. Uploaded once by
   * scripts/upload-placeholder.mjs; a plain var, not a secret.
   */
  QUICK_PLACEHOLDER_URI?: string
  /**
   * Base58 address that quick-mint fees are paid to. The Worker needs it to
   * verify payment out of the landed transaction. Public, not a secret, but it
   * MUST match the app's EXPO_PUBLIC_ROLL_TREASURY — a mismatch rejects every
   * finalize after the user has already paid.
   */
  QUICK_TREASURY_ADDRESS?: string
  /**
   * Bearer token (Worker Secret) gating GET /ops/status and GET /ops/test-alert.
   * These read funding-wallet internals and can trigger a Discord post — fine
   * for an operator to hit directly, not fine for anyone who learns the
   * Worker's base URL (which becomes public the moment the app ships it in an
   * APK). Set with `wrangler secret put OPS_AUTH_TOKEN`; both routes 401
   * without it, even if the secret itself is unset — see requireOpsAuth().
   */
  OPS_AUTH_TOKEN?: string
}

/** Env after validation — the two required secrets are guaranteed present. */
export interface ValidatedEnv extends Env {
  IRYS_FUNDING_KEY: string
  SOLANA_RPC_URL: string
}

/** Env after the additional quick-mint checks. */
export interface QuickEnv extends ValidatedEnv {
  QUICK_PLACEHOLDER_URI: string
  QUICK_TREASURY_ADDRESS: string
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

/**
 * Extra checks the quick-mint routes need, kept out of validateEnv so a
 * half-configured quick flow can never take the roll endpoints down with it.
 *
 * Both values are baked into transactions the user signs, so a missing one has
 * to fail BEFORE anything is staged — not after a fee has moved.
 */
export function validateQuickEnv(env: ValidatedEnv): QuickEnv {
  if (!env.QUICK_PLACEHOLDER_URI) {
    throw new ConfigError(
      'QUICK_PLACEHOLDER_URI is not set. Upload the placeholder once with ' +
        '`node scripts/upload-placeholder.mjs` and put the returned URI in wrangler.toml [vars] (README runbook).',
    )
  }
  if (!env.QUICK_TREASURY_ADDRESS) {
    throw new ConfigError(
      'QUICK_TREASURY_ADDRESS is not set. Put the treasury address in wrangler.toml [vars]. ' +
        "It MUST match the app's EXPO_PUBLIC_ROLL_TREASURY, or every finalize will reject a fee the user already paid.",
    )
  }
  return env as QuickEnv
}

/** Operator-facing misconfiguration — surfaced as HTTP 500 with the message intact. */
export class ConfigError extends Error {
  readonly isConfigError = true
}
