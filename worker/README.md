# Momints roll backend — Cloudflare Worker + D1 + Irys/Arweave

Single Cloudflare Worker backing the Momints roll feature: prepaid rolls of 12
or 24 exposures, each roll an immutable Metaplex Core collection, each frame a
Core asset minted into it, all media on permanent Arweave storage via Irys.
Devnet only. No VPS, and no keeper acts on funds — the only scheduled job is
the read-only [treasury monitor](#treasury-monitor--discord-alerts), which
watches the Irys balance and pings Discord. Top-ups and conversions stay manual
operator tasks, listed in the [runbook](#operator-runbook) below.

The single-Worker shape, the Irys-in-Workers approach, and the two hard
constraints this design bends around were all validated by real spikes — see
`../worker-irys-spike/RESULT.md` and `RESULT2.md` before re-litigating any of
them. Bundle: Irys + mpl-core + umi + photon ≈ 1.8 MB gzip vs the 3 MB Free
cap (~41% headroom).

## The flow

**Create a roll** (`POST /rolls`)
1. Validate: size 12 or 24 only; artist display name sanitized (trim, 48-char
   cap, control/bidi chars stripped); at most ONE roll with status `OPEN` per
   wallet (enforced by check + partial unique index — quick-shoot single mints
   are a separate path and never count toward the roll).
2. **Funding pre-check** — `FundingProvider.ensureFunded()` verifies the
   pre-funded Irys balance covers ~N frames + 1 cover. Insufficient balance
   fails the request fast (503) with an operator-facing error. **It never
   funds inline** — see [constraint 1](#the-two-hard-constraints).
3. Derive the roll name `yyyy-mm-dd.NN` — NN is the 2-digit same-day index for
   this wallet (first of the day = `.01`), from D1.
4. Generate the branded cover with `@cf-wasm/photon` (date + `12 EXP`/`24 EXP`
   composited onto the base film-canister artwork, output < 200 KB), upload it
   and the collection metadata JSON via `StorageProvider`. The cover is
   **static for the roll's life** — never swapped for frame 01, never mutated.
5. Create the Metaplex Core collection, fully defined and immutable, with two
   separate identity attributes: `skr_identity` (verified handle or wallet —
   provenance, immutable) and `artist` (user-editable vanity name).
6. Persist to D1 (`status=OPEN`, `mintedCount=0`) and record the prepaid fee
   through `TreasurySink.record()` as conversion-pending.

**Mint frames** (`POST /rolls/<collection>/frames`, one frame per request)
Each frame: image upload → metadata JSON upload → Core asset minted into the
roll's collection (name `rollname.001`…, zero-padded width 3, owner = the
roll's wallet, identity attributes inherited). Every step checkpoints to D1
(`frameIndex → status/uris/assetAddress/signature`), so an interrupted roll
**resumes without re-uploading or re-minting**: re-POST the frame and the
Worker skips completed steps; a send that timed out confirming is looked up
on-chain before any re-mint (no duplicates). When `mintedCount` reaches N the
roll flips to `COMPLETE`.

Pre-funded uploads measured ~2.5 s each, so a 24-frame roll is ~1 minute of
upload work end to end. The resume path is load-bearing — test it deliberately
(kill the client mid-roll, re-run, verify no duplicate assets and no double
uploads).

## The two hard constraints

1. **Funding is never synchronous in a user-facing request.** The Irys SDK
   tracks a pre-funded balance on the bundler node; `.fund()` sends a real
   transaction and blocks **120+ seconds** (measured, reproducibly, at every
   payload size). `ensureFunded()` is a pre-emptive check that reports
   sufficiency and warns the operator — nothing in this codebase calls
   `.fund()`. **The operator keeps the Irys balance topped up ahead of demand**
   (runbook below) until an AutomatedFunding keeper exists (stub only).
2. **Public RPC endpoints are blocked from Workers for transactions.**
   `api.devnet.solana.com` 403s Workers' egress IPs on sends (reads succeed,
   masking it). `SOLANA_RPC_URL` (Helius devnet) is a required secret; if it is
   unset — or points at a public endpoint — every request fails fast with a
   clear error. There is no public fallback in code, deliberately.

## Provider seams

Roll/mint/cover logic calls only these interfaces (`src/providers/types.ts`):

| Seam | Now | Later (stub + TODO only) |
|---|---|---|
| `StorageProvider` | **IrysProvider** — Arweave, permanent (the real one). `PinataProvider` exists as a clearly-marked TEST-ONLY fallback; IPFS pinning is not permanent and must not back any permanence claim. | — |
| `TreasurySink` | **ManualSink** — records accrued SOL to D1 as conversion-pending; operator-readable summary at `/treasury/status`. No auto-swap. | `AutomatedSink` — SOL→$SKR Jupiter keeper |
| `FundingProvider` | **ManualFunding** — checks the Irys balance, reports sufficiency, warns when low. Never funds inline. The scheduled [treasury monitor](#treasury-monitor--discord-alerts) reads it on a cron and alerts Discord — notify only, never funds. | `AutomatedFunding` — top-up keeper |

## Endpoints

```
GET  /health                       config + D1 reachability
GET  /funding/status               Irys balance vs one typical frame + roll headroom (operator)
GET  /treasury/status              accrued fees pending manual conversion (operator)
GET  /ops/status                   monitor's current level, roll headroom, last-alerted state
GET  /ops/test-alert?severity=…    post a dummy Discord alert: low | critical | healthy
POST /rolls                        JSON { wallet, size, artist?, skrIdentity?, localDate?, feeSignature? }
GET  /rolls/open?wallet=<address>  the wallet's open roll, if any
GET  /rolls/<collection>           roll + per-frame checkpoint status
POST /rolls/<collection>/frames    multipart: image (file), frameIndex, description?, attributes? (JSON array)
POST /rolls/<collection>/complete  close a roll early, freeing the wallet's OPEN slot
POST /quick/stage                  multipart: image (file), metadata (JSON), wallet
POST /quick/finalize               JSON { stagingKey, signature, assetAddress }
GET  /quick/<asset>                quick-mint finalize status
```

`/complete` exists because a roll only auto-completes at `mintedCount >= size`.
A discarded roll, or a frame that never mints, would otherwise hold the
wallet's single open slot forever. It is idempotent (completing an already
`COMPLETE` roll succeeds, with `alreadyComplete: true`) and destructive of
nothing — minted frames and their on-chain assets are untouched.

## Quick mints: the fee flow

Rolls prepay. Quick shots did not — they were free, which was fine while their
images went to IPFS and cost the operator nothing. Putting them on Arweave
means each one buys permanent bytes, so each one has to pay for itself.

It does that in **one user signature**, and without ever letting the treasury
buy storage it has not been paid for:

```
POST /quick/stage      image -> R2, metadata -> D1 (STAGED). Nothing spent.
                       Returns placeholderUri, feeLamports, treasury, updateAuthority.
[client]               ONE transaction: mint a Core asset against the PLACEHOLDER
                       uri + transfer the fee to the treasury. User signs once.
POST /quick/finalize   Verify that transaction LANDED (fee actually paid, asset
                       actually created, Worker actually holds update authority),
                       record the fee, enqueue (FINALIZING).
[queue]                R2 -> Arweave (image, then metadata), then swap the asset's
                       uri off the placeholder and hand update authority to the
                       owner, in one instruction (FINALIZED).
```

**The invariant: no Arweave spend without a confirmed, fee-paying mint already
on-chain.** The fee is read from the landed transaction as a treasury balance
delta — never from anything the client says. `quick_mints.signature` and
`.asset_address` are UNIQUE, so one payment buys exactly one upload.

Why a placeholder at all: the fee has to ride inside the mint transaction to
stay a single signature, but the real image URI does not exist until after that
transaction is verified. So the asset is minted against a permanent, static
"Developing…" document and swapped seconds later. That document is uploaded
**once**, by `scripts/upload-placeholder.mjs`, and reused by every quick mint.

`/quick/stage` is deliberately unauthenticated. Staging cannot spend Arweave,
so a bogus stage costs only an R2 object — bounded by the 3 MiB image ceiling,
`MAX_STAGES_PER_WALLET_PER_DAY`, and the bucket's 24h lifecycle rule.

Once a fee is collected the posture inverts: the consumer must never drop work.
An empty Irys balance **retries** (with an alert) rather than dead-lettering,
and only exhausting `max_retries` moves a job to the DLQ, where it becomes a
critical Discord ping. The scheduled sweep is the backstop for a queue message
that was never sent at all.

Pricing lives in `src/quick/config.ts`. `QUICK_MINT_FEE_LAMPORTS` is anchored to
the `MAX_QUICK_IMAGE_BYTES` ceiling so a large photo can never lose money —
**keep those two coupled** when tuning either.

## Setup

```sh
npm install
wrangler d1 create momints-rolls        # paste the id into wrangler.toml (TODO marker)
npm run db:migrate:remote               # or db:migrate:local for wrangler dev --local

wrangler secret put IRYS_FUNDING_KEY    # devnet funding wallet, base58 secret key
wrangler secret put SOLANA_RPC_URL      # Helius devnet endpoint

wrangler secret put DISCORD_WEBHOOK_URL # optional: treasury-monitor alert channel
wrangler secret put OPERATOR_DISCORD_ID # optional: your Discord user ID (@-mention on critical)

# Quick-mint infrastructure (Workers PAID plan — Queues is not on Free)
wrangler queues create momints-quick-finalize
wrangler queues create momints-quick-finalize-dlq
wrangler r2 bucket create momints-quick-staging
wrangler r2 bucket lifecycle add momints-quick-staging \
  --name expire-staging --prefix quick-staging/ --expire-days 1

# Upload the placeholder ONCE, then paste the URI into wrangler.toml [vars]
IRYS_FUNDING_KEY=<base58> SOLANA_RPC_URL=<helius> \
  node scripts/upload-placeholder.mjs ../CollectionPlaceholder.png

npm run typecheck
npm run deploy
```

`QUICK_TREASURY_ADDRESS` in `wrangler.toml [vars]` **must match the app's
`EXPO_PUBLIC_ROLL_TREASURY`**. A mismatch rejects every finalize — after the
user has already paid.

Secrets are Worker Secrets only — never in the repo, `wrangler.toml`, or
`.env`. For local dev put them in `.dev.vars` (gitignored). **`wrangler
deploy` does not read `.dev.vars`** — deployed secrets must be set with
`wrangler secret put`. `IRYS_FUNDING_KEY` doubles as the Worker's on-chain
payer/authority for collection creation and frame mints; no code generates,
prints, or logs key material.

Pending TODOs in code: `ROLL_FEE_LAMPORTS_12/24` and `QUICK_MINT_FEE_LAMPORTS`
(placeholder pricing), `QUICK_PLACEHOLDER_URI` / `QUICK_TREASURY_ADDRESS`
(empty until the one-time setup above), the D1 `database_id`, the final base
cover artwork (`assets/base-cover.jpg` is a placeholder), `AutomatedSink`,
`AutomatedFunding`.

## Operator runbook

### Top up the Irys balance ahead of demand

Funding confirmation takes **120+ seconds** — it can never happen during a
user request. Rolls fail fast (503, operator-facing message) when the balance
is short. So: top up **ahead of** demand, not in response to failures.

**When:** the [treasury monitor](#treasury-monitor--discord-alerts) tells you —
it posts to Discord the moment the balance crosses into `low`, days of runway
ahead. Otherwise: check `GET /funding/status` before any demo/session and
whenever a response carries a `fundingWarning` (it warns while balance is below
2× the anticipated work — i.e. before requests start failing). Low-balance
warnings also appear in `wrangler tail` as `[funding] …`.

**How** (from any machine with the funding wallet key — never from the
Worker):

```sh
# balance + price check
irys balance <funding-wallet-address> -t solana --provider-url <helius-devnet-url> -n devnet

# top up (amount in atomic units / lamports). Expect ~2 minutes to confirm.
irys fund 100000000 -n devnet -t solana -w <base58-secret-key> --provider-url <helius-devnet-url>
```

Size the top-up to anticipated work: a 24-frame roll is ~24 × 3 MB + cover;
`GET /funding/status` reports the atomic price of a typical frame — multiply
out and keep comfortable headroom. Verify afterwards with `/funding/status`
(`sufficient: true`, no warning).

### Treasury monitor — Discord alerts

So you find out the Irys balance is running down **on Discord, days ahead**,
instead of finding out when a user's frame upload 503s.

A Cron Trigger (`[triggers] crons` in `wrangler.toml`, currently **every 6
hours**) runs `scheduled()` → `src/ops/monitor.ts`. Each run reads the Irys
balance through the same `FundingProvider` that backs `/funding/status`,
converts it to **rolls of headroom**, and posts to Discord **only when the
severity level changes**.

**It is read-and-notify only.** It never calls `.fund()`, signs, or moves
anything — that would be `AutomatedFunding`, which deliberately does not exist.

#### Levels and thresholds

Headroom is `balance ÷ (price of one typical frame × 24)` — a worst-case
24-frame roll priced off the conservative 3 MiB/frame basis `/funding/status`
already uses, rounded **down**. Thresholds are in `src/ops/monitor.ts`:

| Level | Condition | Post | Ping |
|---|---|---|---|
| `healthy` | ≥ `ALERT_THRESHOLD_LOW_ROLLS` (**20**) rolls | green, on recovery only | no |
| `low` | 5–19 rolls | amber "top up soon" | no |
| `critical` | < `ALERT_THRESHOLD_CRITICAL_ROLLS` (**5**) rolls | red "top up today" | **@operator** |

Both thresholds are deliberately generous (`TODO` markers to tune). A top-up
takes 120+ seconds to confirm and you check in roughly daily, so the first
alert has to arrive while there is still comfortable runway. Tightening them to
"a few rolls left" recreates the failure they exist to prevent.

#### Hysteresis — why the channel stays quiet

An alert posts **only on a level change**, never twice for the same level.
`healthy → low` posts amber; `low → critical` (or `healthy → critical`) posts
red and pings you; any climb back posts a recovery — green when fully healthy,
so you get positive confirmation your top-up landed. Same level twice in a row
posts nothing. The last posted level lives in D1 (`ops_alert_state`, keyed
`funding_balance`).

Two deliberate behaviours worth knowing:

- **No state row = `healthy`.** A first run at a healthy balance stays quiet; a
  first run already below a threshold does fire.
- **A failed Discord post does not advance the stored level**, so the next run
  retries the crossing rather than treating an alert you never saw as
  delivered.

#### Setup and checks

```sh
wrangler secret put DISCORD_WEBHOOK_URL   # channel webhook (Server Settings → Integrations)
wrangler secret put OPERATOR_DISCORD_ID   # your Discord user ID (Developer Mode → Copy User ID)
```

Both are optional: without the webhook the monitor still runs and logs but
cannot notify; without the ID critical alerts still post, just without the
ping. `DISCORD_WEBHOOK_URL` is a **secret** — never in the repo,
`wrangler.toml`, or `.env`; anything logged from `ops/discord.ts` is redacted.

```sh
# does the webhook work? one dummy message per severity, no balance read
curl "$WORKER_URL/ops/test-alert?severity=low"        # amber
curl "$WORKER_URL/ops/test-alert?severity=critical"   # red + @-mention
curl "$WORKER_URL/ops/test-alert?severity=healthy"    # green

# what does the monitor think right now, without waiting for the cron?
curl "$WORKER_URL/ops/status"
```

`/ops/status` reports the current level, roll headroom, balance, the
thresholds, and `wouldPost` — what the next cron run would do. Cron activity
shows up in `wrangler tail` as `[ops] cron …`, and `ops_alert_state.updated_at`
is bumped on every run, so a stale timestamp means the cron itself stopped.

> `/ops/test-alert` is unauthenticated. Anyone who learns the URL can spam the
> channel (never the webhook itself — the secret is not exposed). Fine on
> devnet; **remove or protect it before mainnet.**

### Run the SOL → $SKR conversion by hand

Accrued roll fees are recorded in D1 as `CONVERSION_PENDING` (ManualSink —
nothing auto-swaps).

**When:** on a calendar cadence (e.g. weekly) or when `GET /treasury/status`
shows `pendingLamports` above your threshold.

**How:**
1. `GET /treasury/status` → note `pendingLamports` / `pendingCount`.
2. Swap that SOL → $SKR manually from the treasury wallet (e.g. Jupiter).
   The treasury address itself is still TODO/pending configuration.
3. Mark the rows converted:
   ```sh
   wrangler d1 execute momints-rolls --remote --command \
     "UPDATE treasury_entries SET status='CONVERTED', converted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE status='CONVERSION_PENDING'"
   ```
4. Re-check `/treasury/status` — `pendingLamports` should be 0.

### Resuming an interrupted roll

Nothing to do server-side. The client re-POSTs frames 1..N; already-minted
frames return instantly (`alreadyMinted: true`), partially-processed frames
resume from their checkpoint, and a mint whose confirmation timed out is
resolved against the chain before any re-mint. A 429 rate-limit mid-mint is
likewise resumable — the Worker retries with backoff internally, and if it
still fails the checkpoint holds for the next attempt.

### Re-driving a stuck quick mint (the DLQ alert)

A **critical** "Quick mint stuck on placeholder" alert means a finalize job
exhausted its retries. Read it as recoverable, not lost: the alert only fires
for rows that were verified as paid, so the fee is banked and the asset exists
on-chain — it is just still showing the "Developing…" placeholder.

```sh
# What state did it stop in? (image_uri / arweave_uri are the checkpoints)
wrangler d1 execute momints-rolls --remote --command \
  "SELECT id, status, asset_address, image_uri, arweave_uri, created_at FROM quick_mints WHERE status='DEAD'"
```

Fix the underlying cause first — usually an empty Irys balance (top it up per
the section above) or an RPC outage. Then re-drive:

```sh
# Back to FINALIZING so the consumer will act on it, then re-enqueue.
wrangler d1 execute momints-rolls --remote --command \
  "UPDATE quick_mints SET status='FINALIZING' WHERE id='<quickMintId>'"
```

The scheduled sweep re-enqueues `FINALIZING` rows older than an hour, so that
single UPDATE is enough — no manual queue publish needed. Re-running is always
safe: uploads resume from their checkpoints rather than repeating, and the URI
swap reads the asset before touching it, so a job that actually completed just
marks itself `FINALIZED`.

Rows in `STAGED` are the opposite case — nothing was ever paid or uploaded.
Leave them; the sweep and the bucket lifecycle rule reap them within a day.
