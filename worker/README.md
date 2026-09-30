# Momints roll backend — Cloudflare Worker + D1 + Turbo/Arweave

Filmstock catalogue, immutable recipe delivery, and stateless developed-roll unlock reconstruction are documented in [`../docs/FILMSTOCKS.md`](../docs/FILMSTOCKS.md). The filmstock subsystem adds no D1 user or entitlement records.

Filmstock operators should start from `filmstock-package-template/`. `npm run publish:filmstock` validates and compiles a 33-point sRGB `.cube`; `npm run schedule:filmstock` changes a returning stock's availability; and `npm run deploy` performs immutable R2 preflight, a maintenance-mode Worker deployment, and production asset smoke tests. See the linked contract before using the lower-level `deploy:worker` command.

Production deployment and rollback are documented in [`../docs/STAGING-WORKER-RUNBOOK.md`](../docs/STAGING-WORKER-RUNBOOK.md). The default configuration targets the promoted service at `api.momints.xyz` with production resources and **maintenance enabled**. Activation requires its separately guarded command. Historical staging tools cannot target the promoted service.

Single Cloudflare Worker backing the Momints roll feature: prepaid rolls of 12
or 24 exposures, each roll an immutable Metaplex Core collection, each frame a
Core asset minted into it, all media on permanent Arweave storage via Turbo.
Runs on Solana **mainnet** — every mint, fee, and upload is real. No VPS, and
no keeper acts on funds — the only scheduled jobs are the read-only [treasury
monitor](#treasury-monitor--discord-alerts), which watches the Turbo credit
balance and pings Discord, and the [cost-plus fee
recompute](#cost-plus-fee-pricing). Top-ups and conversions stay manual
operator tasks, listed in the [runbook](#operator-runbook) below.

The single-Worker shape and the hard constraint this design bends around were
validated by real spikes — see `../docs/spikes/irys/RESULT2.md` (the funding
constraint) and `../worker-turbo-spike/RESULT.md` (keyed ANS-104 signing + a
real Turbo upload, proven inside this exact Workers runtime) before
re-litigating either. Storage moved from Irys (`gateway.irys.xyz` — NOT
genuine Arweave, 404s on `arweave.net`) to Turbo (`arweave.net/<id>`, verified
resolvable) — see `../ARWEAVE_PATH_OPTIONS.md` for why and the cost math.
Bundle: Turbo (lean `@dha-team/arbundles`) + mpl-core + umi + photon ≈ 1.15 MB
gzip (measured via `npm run bundle-size`) vs the 3 MB Free-tier cap (~62%
headroom) — smaller than the old Irys-based bundle, not bigger.

> **Every upload spends real Turbo credits.** There is no free/throwaway
> storage tier to test against — Arweave/Turbo has no testnet at all — beyond
> Turbo's small-item free allowance (10 MiB lifetime, 105 KiB/item). Budget
> test traffic accordingly.

## The flow

**Create a roll** (`POST /rolls`)
1. Validate: size 12 or 24 only; artist display name sanitized (trim, 48-char
   cap, control/bidi chars stripped); at most ONE roll with status `OPEN` per
   wallet (enforced by check + partial unique index — quick-shoot single mints
   are a separate path and never count toward the roll).
2. **Fee verification** — the client pays the roll fee in its own
   wallet-signed transfer to `QUICK_TREASURY_ADDRESS` *before* calling this
   endpoint (`payRollFee` in the app) and sends back the landed `feeSignature`.
   `feeSignature` is REQUIRED; the Worker fetches that transaction and checks
   it paid at least the current cost-plus fee for `size` — read once from
   `fee_cache` (see [Cost-plus fee pricing](#cost-plus-fee-pricing)) and reused
   for both this check and the treasury record — from `wallet` to the treasury
   before doing anything else (`rolls/verify.ts`) — nothing the client claims
   is trusted. A signature can only pay for one roll: `rolls.fee_signature` is
   UNIQUE (`migrations/0005_roll_fee_signature.sql`), checked with a friendly
   409 pre-check and enforced under races by the index itself. This is the
   ONLY gate before any spend — everything below this point costs the
   Worker's own Arweave balance or SOL.
3. **Funding pre-check** — `FundingProvider.ensureFunded()` verifies the
   pre-funded Turbo credit balance covers ~N frames + 1 cover. Insufficient
   balance fails the request fast (503) with an operator-facing error. **It
   never funds inline** — see [constraint 1](#the-two-hard-constraints).
4. Derive the roll name `yyyy-mm-dd.NN` — NN is the 2-digit same-day index for
   this wallet (first of the day = `.01`), from D1.
5. Generate the branded cover with `@cf-wasm/photon` (date + `12 EXP`/`24 EXP`
   composited onto the base film-canister artwork, output < 200 KB), upload it
   and the collection metadata JSON via `StorageProvider`. The cover is
   **static for the roll's life** — never swapped for frame 01, never mutated.
6. Create the Metaplex Core collection — metadata fully defined up front and
   never mutated in normal operation, update authority the **shooter's**
   wallet from the instant it exists, the Worker holding only a scoped
   delegate to mint frames (see [roll collection
   ownership](#roll-collection-ownership) below) — plus two separate identity
   attributes: `skr_identity` (verified handle or wallet — provenance,
   immutable) and `artist` (user-editable vanity name).
7. Persist to D1 (`status=OPEN`, `mintedCount=0`, `fee_signature`) and record
   the prepaid fee through `TreasurySink.record()` as conversion-pending.

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

1. **Funding is never synchronous in a user-facing request.** Turbo credits
   (winc) are bought by sending SOL to Turbo's payment address and are visible
   on the balance endpoint once that transfer confirms — there is no `.fund()`
   call in this codebase to begin with, but the constraint that shaped the
   design is unchanged: nothing here may block a user-facing request on a
   top-up (the old Irys `.fund()` call this replaced blocked **120+ seconds**
   measured, reproducibly, at every payload size — `docs/spikes/irys/RESULT2.md`).
   `ensureFunded()` is a pre-emptive check that reports sufficiency and warns
   the operator. **The operator keeps the Turbo credit balance topped up ahead
   of demand** (runbook below) until an AutomatedFunding keeper exists (stub
   only).
2. **Public RPC endpoints are blocked from Workers for transactions.** Public
   Solana RPC hosts 403 Workers' egress IPs on sends (reads succeed, masking
   it). `SOLANA_RPC_URL` (a dedicated mainnet provider, e.g. Helius mainnet)
   is a required secret; if it is unset — or points at a public endpoint —
   every request fails fast with a clear error. There is no public fallback in
   code, deliberately. (Turbo's own HTTP API needs no RPC at all — signing and
   uploading are pure HTTP + the funding key.)

## Provider seams

Roll/mint/cover logic calls only these interfaces (`src/providers/types.ts`):

| Seam | Now | Later (stub + TODO only) |
|---|---|---|
| `StorageProvider` | **TurboProvider** — Turbo → genuine Arweave, permanent (the real one; lean `@dha-team/arbundles`, no `@ardrive/turbo-sdk` — see `../ARWEAVE_PATH_OPTIONS.md`). `PinataProvider` exists as a clearly-marked TEST-ONLY fallback; IPFS pinning is not permanent and must not back any permanence claim. | — |
| `TreasurySink` | **ManualSink** — records accrued SOL to D1 as conversion-pending; operator-readable summary at `/treasury/status`. No auto-swap. | `AutomatedSink` — SOL→$SKR Jupiter keeper |
| `FundingProvider` | **TurboFunding** — checks the Turbo credit (winc) balance, reports sufficiency, warns when low. Never funds inline. The scheduled [treasury monitor](#treasury-monitor--discord-alerts) reads it on a cron and alerts Discord — notify only, never funds. | `AutomatedFunding` — top-up keeper |

## Endpoints

```
GET  /health                       config + D1 reachability
GET  /funding/status               Turbo credit balance + roll headroom (needs OPS_AUTH_TOKEN)
GET  /treasury/status              accrued fees pending conversion (needs OPS_AUTH_TOKEN)
GET  /fees                         current cost-plus mint fees (quick, roll 12/24) — app fetches this at confirm time
GET  /ops/status                   monitor's current level, roll headroom, last-alerted state (needs OPS_AUTH_TOKEN)
GET  /ops/test-alert?severity=…    post a dummy Discord alert: low | critical | healthy (needs OPS_AUTH_TOKEN)
GET  /ops/recompute-fees           manually run the cost-plus fee recompute (needs OPS_AUTH_TOKEN)
GET  /ops/sweep-quick-mints        manually re-drive deferred quick-mint finalizes (needs OPS_AUTH_TOKEN)
POST /rolls                        JSON { wallet, size, feeSignature, artist?, skrIdentity?, localDate?, payment? }
GET  /rolls/open?wallet=<address>  the wallet's open roll, if any
GET  /rolls/<collection>           roll + per-frame checkpoint status
POST /rolls/<collection>/frames    multipart: image (file), frameIndex, description?, attributes? (JSON array)
POST /rolls/<collection>/complete  close a roll early, freeing the wallet's OPEN slot
POST /quick/stage                  multipart: image (file), metadata (JSON), wallet
POST /quick/finalize               JSON { stagingKey, signature, assetAddress }
DEL  /quick/stage/<stagingKey>     give back an unminted stage (user declined the prompt)
GET  /quick/<asset>                quick-mint finalize status
POST /skr/quote                    JSON { context:'quick', stagingKey } or { context:'roll', wallet, size } — see "Pay with $SKR"
GET  /ops/dashboard/wallets        signer + treasury balances (needs OPS_AUTH_TOKEN) — see "Operator dashboard"
GET  /ops/dashboard/health         cron/health snapshot (needs OPS_AUTH_TOKEN) — see "Operator dashboard"
GET  /ops/dashboard/metrics        aggregate usage metrics ONLY (needs OPS_AUTH_TOKEN) — see "Operator dashboard"
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

Staging happens *before* the wallet prompt, so declining leaves an orphan that
would otherwise hold one of those daily slots until the sweep. The app calls
`DELETE /quick/stage/<stagingKey>` to give it back immediately. That endpoint
**refuses anything past STAGED** (409): once a row is claimed the fee is
collected and the asset is minted, so deleting it would destroy the only record
of work the operator still owes. The app additionally only calls it for mints
that never reached a signature, so the guard is enforced on both sides.

Once a fee is collected the posture inverts: the consumer must never drop work.
An empty Turbo credit balance **retries** (with an alert) rather than
dead-lettering, and only exhausting `max_retries` moves a job to the DLQ,
where it becomes a critical Discord ping. The scheduled sweep is the backstop
for a queue message that was never sent at all.

Pricing is cost-plus now (`src/fees/compute.ts` — see [Cost-plus fee
pricing](#cost-plus-fee-pricing)): the fee quoted at stage time is a live
Turbo storage quote for `MAX_QUICK_IMAGE_BYTES` (the same byte ceiling that
bounds what can be staged) times a margin — **keep those two coupled** if the
ceiling ever changes. The quote is PERSISTED on the `quick_mints` row at stage
time and finalize verifies against that exact number, never a live re-read —
fees recompute every 3h, and a payment must never be rejected for a price that
moved after it was quoted.

## Roll collection ownership

Every roll collection belongs to the **shooter**, not the Worker, from the
moment it is created (`rolls/create.ts`) — `updateAuthority` is set to the
wallet in the same instruction that creates the collection. The Worker is
granted only a scoped `UpdateDelegate` plugin in that same transaction, which
is what lets it sign frame mints on the shooter's behalf afterward
(`rolls/frames.ts` passes `authority: umi.identity` explicitly — `create()`
has no fallback to it once the Worker is no longer the bare owner, so omitting
this would silently break frame minting).

That delegate is **revoked** the instant a roll reaches `COMPLETE` — whichever
path gets it there first, the last frame mint or an early `/complete`
(`rolls/handoff.ts`). After the revoke, the shooter holds sole control; the
Worker cannot touch that collection's metadata or membership again.

**Why not just have the Worker own it forever, the simpler design:** the
Worker's funding key is one keypair shared across every roll ever created. As
permanent owner, a leaked key would compromise every roll collection that
ever existed, unrecoverably. As a revocable delegate, a leak costs a
`revokeCollectionPluginAuthority` call, not the collections themselves.

**Never fails the request that triggers it.** A revoke failure — a bad RPC, a
timeout — is logged and left for the [sweep](#re-driving-a-stuck-roll-handoff)
below; it must never turn a frame mint or a completion request that already
succeeded into a failure response. `rolls.handoff_signature` is the
checkpoint: `NULL` on a `COMPLETE` roll means the revoke hasn't landed yet, and
— because revoking is one-way — the code always fetches the collection's
current delegate state before acting rather than blindly retrying
(`rolls/handoff.ts`, the same fetch-before-write discipline as the quick-mint
URI swap above).

Rolls created before this shipped are the one exception: the Worker is their
bare, permanent update authority, with no delegate to revoke. They are staying
that way by decision, not oversight — no migration is planned for them.

## Setup

The production resources already exist. Do not recreate them or paste new IDs
into configuration. The authoritative paused configuration is `wrangler.toml`;
`wrangler.production-active.toml` is the reviewed activation configuration,
and `wrangler.rollback.toml` preserves the retired service as a maintenance-only
rollback target. Follow `../docs/STAGING-WORKER-RUNBOOK.md` for the current
resource inventory, migration procedure, secret entry and rollback sequence.

```sh
npm install
npm run typecheck
npm run test:maintenance
npm run test:production-tooling
npm run validate:filmstocks

# Safe default: deploy/update the promoted Worker while maintenance remains on.
npm run deploy:worker

# Only after the owner has entered and verified the existing production secrets:
npm run deploy:production:activate -- --confirm-owner-secrets-and-production-activation
```

`QUICK_TREASURY_ADDRESS` in `wrangler.toml [vars]` **must match the app's
`EXPO_PUBLIC_ROLL_TREASURY`**. A mismatch rejects every finalize — after the
user has already paid.

Secrets are Worker Secrets only — never in the repo, `wrangler.toml`, or
`.env`. For local dev put them in `.dev.vars` (gitignored). **`wrangler
deploy` does not read `.dev.vars`** — deployed secrets must be set with
`wrangler secret put`. `IRYS_FUNDING_KEY` triple-duties as the Worker's
on-chain payer/authority for collection creation and frame mints, and as the
`SolanaSigner` key that signs every Turbo/Arweave upload; no code generates,
prints, or logs key material.

Pending TODOs in code: mint fees are cost-plus (see [Cost-plus fee
pricing](#cost-plus-fee-pricing)). `SOLANA_RPC_URL_MAINNET` should point at a
dedicated mainnet RPC (Helius or similar) before trusting the recompute in
production — the public fallback is known to block at least some cloud egress
IPs. The production treasury and D1 IDs are configured. Still pending are the
final base cover artwork (`assets/base-cover.jpg` is a placeholder),
`AutomatedSink`, `AutomatedFunding`, and the
[Turbo credit withdrawability](#open-question-turbo-credit-withdrawability)
question below.

## Operator runbook

### Top up the Turbo credit balance ahead of demand

A SOL top-up needs on-chain confirmation before Turbo credits it — it can
never happen during a user request. Rolls fail fast (503, operator-facing
message) when the balance is short. So: top up **ahead of** demand, not in
response to failures.

**When:** the [treasury monitor](#treasury-monitor--discord-alerts) tells you —
it posts to Discord the moment the balance crosses into `low`, days of runway
ahead. Otherwise: check authenticated `GET /funding/status` before any demo/session and
whenever a response carries a `fundingWarning` (it warns while balance is below
2× the anticipated work — i.e. before requests start failing). Low-balance
warnings also appear in `wrangler tail` as `[funding] …`.

**How:** Turbo credits (winc) are bought by sending SOL, on-chain, to Turbo's
Solana payment address — there is no CLI top-up command like Irys had.

```sh
# 1. Confirm Turbo's current Solana payment address (it can change — don't hardcode it):
curl -s https://upload.ardrive.io/v1/info | grep -o '"solana":"[^"]*"'

# 2. Send SOL to that address, FROM ANY WALLET (the funding wallet does not need
#    to be the sender — Turbo credits whichever address the transfer names as
#    payer, so send from the funding wallet itself unless you have a reason not to).

# 3. Verify the credit landed against the SIGNING wallet's address (the funding
#    wallet's own public key — the same address the Worker signs uploads with):
curl -s "https://payment.ardrive.io/v1/account/balance/solana?address=<funding-wallet-address>"
# 404 "User Not Found" = zero balance (not funded yet, or still confirming).
```

Size the top-up to anticipated work: a 24-frame roll is ~24 × 3 MiB + cover;
Authenticated `GET /funding/status` reports the winc price of a typical frame (via
`GET https://payment.ardrive.io/v1/price/bytes/<n>`) — multiply out and keep
comfortable headroom. Verify afterwards with `/funding/status` (`sufficient:
true`, no warning). Unlike Irys's ~2-minute `.fund()`, Turbo crediting time
after the SOL transfer confirms was not characterized during this build —
treat it the same way: top up well ahead of demand, don't expect it instantly.

#### Open question: Turbo credit withdrawability

**Unconfirmed — flagged, not resolved.** Irys balances were withdrawable back
to SOL; whether Turbo credits are is not confirmed as of this writing (see
`ARWEAVE_PATH_OPTIONS.md` "Honest flags"). If they are one-way, that's a
treasury consideration — don't pre-fund far beyond near-term anticipated
usage. **Confirm with ArDrive/Turbo support before any large top-up.**

### Cost-plus fee pricing

Mint fees are no longer flat constants — they are computed from LIVE costs and
recomputed every 3h, so they track real cost as it moves without a manual
re-derivation and redeploy. This exists specifically because **SIMD-0437**
(a Solana rent reduction) is rolling out on mainnet in five gated steps, each
on an unpredictable date, cutting the rent-exempt-minimum rate
(`lamports_per_byte`) 90% over the full rollout: `6960 → 6333 → 5080 → 2575 →
1322 → 696`. A flat fee would need five manual redeploys to track that; cost-
plus reads live rent and adjusts automatically at each step.

**The model** (`src/fees/compute.ts`):

```
quick_fee = storage_cost × 1.7                                   (QUICK_MARGIN)
roll_fee  = frames × (rent_per_frame + storage_cost) × 1.7        (ROLL_MARGIN)
```

Two different cost structures because rent is paid by different parties: a
quick mint is minted by the USER's own wallet, so the operator's cost is
storage only; a roll frame is minted (and rent-paid) by the WORKER, so its
cost is rent + storage. Both margins live in `src/fees/config.ts`, separate
constants even though both start at 1.7× so they can diverge later.

**Live inputs, read once per recompute (never per-mint):**
- **Rent** — a read-only mainnet rent-sysvar read (`src/fees/rent.ts`, the
  same approach as `scripts/mainnet-rent-quote.mjs`), sized against a real
  Core-asset byte model (`src/fees/coreSize.ts`, ported from that same
  script). Uses `SOLANA_RPC_URL_MAINNET` if set, else the Worker's own
  `SOLANA_RPC_URL` (both mainnet) — see "Setup" above.
- **Storage** — Turbo's live quote for one `ESTIMATED_FRAME_BYTES` (3 MiB)
  ceiling image, converted from winc to lamports using Turbo's own live
  SOL→credit exchange rate (`GET /v1/price/solana/<lamports>`, net of Turbo's
  infrastructure fee) — no external AR/USD or SOL/USD feed needed for this
  conversion; it IS the operator's real cost to acquire that winc.

Computed fees are cached in D1 (`fee_cache`, one row) by a **separate 3-hourly
Cron Trigger** from the treasury monitor's 6-hourly one (`wrangler.toml
[triggers]`, dispatched by cron string in `scheduled()`) — fee logic and
funding-alert logic stay independent on purpose. The mint flow (`rolls/create.ts`,
`rolls/verify.ts`, `quick/stage.ts`, `quick/verify.ts`) reads that cached row —
a plain D1 SELECT — and never computes live, so a mint is never blocked on an
RPC/Turbo/Jupiter read.

**Quick mints snapshot their fee.** `quick/stage.ts` quotes the current fee and
persists it on the `quick_mints` row; finalize verifies payment against that
persisted number, never a live re-read — the fee can move between staging an
image and the wallet landing the payment. **Rolls read the live cache at
verify time** instead (no stage step to snapshot at) — the app fetches
`GET /fees` and pays immediately before calling `POST /rolls`, so the race
this leaves is the same few-second window the app's "read at confirmation"
display rule already minimizes.

**Guards** (all in `src/fees/compute.ts`):

| Guard | What | On failure |
|---|---|---|
| 1. Absolute bounds | Each fee clamped to a USD-intent floor/ceiling (`src/fees/config.ts`: quick $0.05–$1.50, roll 12 $0.50–$25, roll 24 $1–$40), converted to lamports via that cycle's SOL/USD | Clamped to the bound + Discord alert |
| 2. Input validation | Rent must equal a KNOWN SIMD-0437 value (the baseline or one of the five steps) — a value outside that set is a bad read, not a real step. Storage quote must be in a sane range for the byte size | Whole recompute rejected, last-good kept + Discord alert |
| 3. Last-good on failure | Any read failure (RPC, Turbo, Jupiter) or a Guard-2 rejection | fee_cache's SERVED columns are never touched — only `last_attempt_*` — so a mint always has a valid cached fee |
| 4. Large valid move | A fee that passes Guards 1–2 but differs from the last served value by >50% | APPLIED (it's valid) + Discord alert — informational, e.g. "roll fee dropped 47% — SIMD-0437 step likely activated" |

The floor/ceiling bounds are deliberately WIDE: roll fees will fall
substantially as rent drops (a 24-roll fee could go from ~$15 today toward ~$6
once rent fully reduces) — a floor above that post-reduction price would keep
prices artificially high, exactly the failure this feature exists to avoid.

**$SKR discount:** users can pay the fee in $SKR instead of SOL, at a 15%
discount — see "Pay with $SKR" below for the full flow.

**Verify it yourself:**

```sh
curl "$WORKER_URL/fees"                                                    # what's currently served
curl -H "Authorization: Bearer $OPS_AUTH_TOKEN" "$WORKER_URL/ops/recompute-fees"  # run it now, see the result
```

`/ops/recompute-fees` returns `{ ok, note, fees?, alertNotes }` — `note`
explains exactly what happened (inputs read, any clamp, any large move), even
on failure. The rent read now falls back to `SOLANA_RPC_URL` (a dedicated
mainnet provider, per the mainnet cutover) before ever touching the public
`api.mainnet-beta.solana.com` endpoint — live-tested 2026-09-02, that public
endpoint alone 403s ("Your IP or provider is blocked") from at least one cloud
egress IP, so it stays a last resort, not something to rely on directly. Guard
3 means a blocked read can never break minting regardless — fees just stay
frozen at the last successful compute.

### Pay with $SKR

Both quick mints and rolls can pay their FEE in $SKR instead of SOL, at a 15%
discount (`SKR_DISCOUNT`, `src/fees/config.ts`). Rent is unaffected — it is
always paid in SOL, by whoever already pays it today (the user for a quick
mint, the Worker for a roll frame).

| Path | Rent | Fee |
|---|---|---|
| Quick + SOL | user SOL | user SOL |
| Quick + $SKR | user SOL | user $SKR (one signature) |
| Roll + SOL | Worker SOL | user SOL |
| Roll + $SKR | Worker SOL | user $SKR (fee transaction only) |

**The Worker issues and stores the quote — never the client.** The same
"never trust the client" invariant the SOL fee check already enforces applies
to the exchange rate too, since $SKR's USD value moves independently of
SOL's:

1. The app calls `POST /skr/quote` — `{context:'quick', stagingKey}` (the fee
   already pinned at stage time) or `{context:'roll', wallet, size}` (the live
   `fee_cache` roll fee, same source the SOL path already reads at payment
   time). The Worker computes `sol_fee × 0.85`, gets the SOL→$SKR equivalent
   from Jupiter (`lite-api.jup.ag/swap/v1/quote`, no key needed), and
   **persists** the result — on the `quick_mints` row's `skr_quote_atomic`/
   `skr_quote_expires_at` columns for a quick mint, or in the one-row-per-
   wallet `skr_quotes` table for a roll (no roll exists yet at quote time to
   attach it to). Returns `{ skrAmount, expiresAt, treasurySkrAta }` — a
   120s-valid quote (`QUOTE_VALIDITY_MS`) and the treasury's $SKR Associated
   Token Account, derived by the Worker so the app never has to compute (or
   trust its own computation of) the destination address.
2. The app builds ONE transaction transferring exactly `skrAmount` of $SKR
   (`TransferChecked`, validating mint+decimals on-chain) from the user's own
   $SKR ATA to `treasurySkrAta` — bundled with the mint instruction for a
   quick mint, standalone for a roll (same shape as the existing SOL fee
   transfer).
3. `POST /quick/finalize` / `POST /rolls` verify the landed transaction
   against the STORED quote, never a re-quote: the $SKR token balance delta
   on `treasurySkrAta` must be of the exact configured mint
   (`SKR_MINT_ADDRESS`, `src/skr/config.ts`) and at least
   `storedQuote × (1 − SKR_VERIFY_TOLERANCE)` (2%, absorbs ordinary
   issue→land drift) — a missing or expired stored quote is a hard reject.
   Everything else (asset creation, owner, update authority for a quick mint;
   the single-open-roll check for a roll) is exactly the SOL-path logic,
   completely untouched.

**Quote failure degrades to SOL, never a hang.** If Jupiter is unreachable,
times out, or returns a garbled/absurd amount, `POST /skr/quote` returns
`{ unavailable: true, reason }` — a clean 200, not a 5xx. The app shows
"$SKR payment isn't available right now — pay with SOL instead" and falls
back to the ordinary SOL path, which always works.

**$SKR fees are held directly, not converted.** Unlike SOL fees (accrued in
`treasury_entries`, later swapped by hand — see "Run the SOL → $SKR
conversion by hand" below), a $SKR payment needs no conversion: the treasury
already holds the target currency the instant it lands, so nothing is written
to `treasury_entries` for it. Check the treasury's $SKR ATA balance on
Solscan directly, or query the audit trail instead:

```sh
wrangler d1 execute momints-rolls --remote --command \
  "SELECT id, wallet, skr_quote_atomic FROM quick_mints WHERE fee_currency='SKR'"
wrangler d1 execute momints-rolls --remote --command \
  "SELECT collection_address, wallet, skr_fee_atomic FROM rolls WHERE fee_currency='SKR'"
```

### Operator dashboard

A read-only, operator-only view of wallet balances, system health, and
aggregate usage — replacing scattered `wrangler d1 execute` queries and
Discord alerts with one page. Two independently deployed pieces:

- **This Worker** exposes three new `GET /ops/dashboard/*` endpoints (below),
  gated by the same `OPS_AUTH_TOKEN` bearer as `/ops/status` etc. This is the
  REAL security boundary — even if the dashboard's URL leaks, these
  endpoints return nothing without the token.
- **`dashboard/`** (repo root, sibling to `worker/`) is a static site meant
  for Cloudflare Pages, put behind **Cloudflare Access** so only the
  operator can even load the page. See `dashboard/README.md` for deploying
  it — that's an operator action (Zero Trust configuration), not something
  this Worker does.

CORS on the three routes below is scoped to `DASHBOARD_ORIGIN`
(`wrangler.toml [vars]`, optional) — set it once the Pages site has a URL,
then redeploy. It's a browser-side courtesy header on top of the token gate,
never a substitute for it: unset, the routes still work fine for
curl/server callers, they just don't get a CORS header a browser would need.

**Aggregate only, structurally.** `GET /ops/dashboard/metrics` returns
counts, splits, and totals — never a `wallet` field, anywhere. There is no
endpoint that takes a wallet and answers "what has this wallet done," and
none of the three response shapes has a place to put one. This isn't a UI
choice to preserve later; it's what the underlying D1 queries select (see
`src/ops/dashboard.ts` and its new `RollDb` aggregate methods in
`src/db/index.ts`) — the per-row wallet values never leave SQL.

```sh
curl -H "Authorization: Bearer $OPS_AUTH_TOKEN" "$WORKER_URL/ops/dashboard/wallets"
curl -H "Authorization: Bearer $OPS_AUTH_TOKEN" "$WORKER_URL/ops/dashboard/health"
curl -H "Authorization: Bearer $OPS_AUTH_TOKEN" "$WORKER_URL/ops/dashboard/metrics?window=7d"
```

- `wallets` — signer SOL balance + Turbo credit balance (raw and "~N rolls
  of headroom", the same figure `/funding/status` already computes via
  `readFundingSnapshot`); treasury SOL balance + $SKR balance (derives the
  treasury's SKR ATA the same way `skr/quote.ts` does, then reads its
  on-chain balance).
- `health` — the fee-recompute cron's last attempt (`fee_cache`'s own
  bookkeeping) and the treasury-monitor/sweep cron's last run
  (`ops_alert_state.updated_at`, written on every run whether or not it
  alerted); counts of deferred (STAGED-with-signature) and DEAD quick
  mints, and stuck roll handoffs; the currently-served fees and rent.
- `metrics` — `?window=all|7d|30d` (default `all`): total mints and the
  quick/roll split, rolls created and average frames per roll, fees
  collected in SOL and in $SKR (kept separate — never summed across
  currencies), the SOL/$SKR payment-method split, a unique-wallet COUNT,
  and a 30-day mints-per-day series for the chart.

### Treasury monitor — Discord alerts

So you find out the Turbo credit balance is running down **on Discord, days
ahead**, instead of finding out when a user's frame upload 503s.

A Cron Trigger (`[triggers] crons` in `wrangler.toml` — the **6-hourly** one;
the **3-hourly** entry alongside it is the [cost-plus fee
recompute](#cost-plus-fee-pricing), a separate job) runs `scheduled()` →
`src/ops/monitor.ts`. Each run reads the Turbo credit balance through the same
`FundingProvider` that backs `/funding/status`, converts it to **rolls of
headroom**, and posts to Discord **only when the severity level changes**.

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
wrangler secret put OPS_AUTH_TOKEN        # any random string, e.g. `openssl rand -hex 32`
```

`DISCORD_WEBHOOK_URL` and `OPERATOR_DISCORD_ID` are optional: without the
webhook the monitor still runs and logs but cannot notify; without the ID
critical alerts still post, just without the ping. `OPS_AUTH_TOKEN` is not
optional for these two routes — both 401 without it, even before checking
whether a token was sent, so forgetting to set it fails closed rather than
reopening the hole. All three are **secrets** — never in the repo,
`wrangler.toml`, or `.env`; anything logged from `ops/discord.ts` is redacted.

```sh
# does the webhook work? one dummy message per severity, no balance read
curl -H "Authorization: Bearer $OPS_AUTH_TOKEN" "$WORKER_URL/ops/test-alert?severity=low"        # amber
curl -H "Authorization: Bearer $OPS_AUTH_TOKEN" "$WORKER_URL/ops/test-alert?severity=critical"   # red + @-mention
curl -H "Authorization: Bearer $OPS_AUTH_TOKEN" "$WORKER_URL/ops/test-alert?severity=healthy"    # green

# what does the monitor think right now, without waiting for the cron?
curl -H "Authorization: Bearer $OPS_AUTH_TOKEN" "$WORKER_URL/ops/status"
```

`/ops/status` reports the current level, roll headroom, balance, the
thresholds, and `wouldPost` — what the next cron run would do. Cron activity
shows up in `wrangler tail` as `[ops] cron …`, and `ops_alert_state.updated_at`
is bumped on every run, so a stale timestamp means the cron itself stopped.

> Both routes require `Authorization: Bearer <OPS_AUTH_TOKEN>` — they read
> funding-wallet internals and `/ops/test-alert` can trigger a real Discord
> post, so they can't be left open once the Worker's base URL is public (it
> ships in the app's `EXPO_PUBLIC_ROLL_API`). The scheduled cron itself calls
> `runTreasuryMonitor()` directly, not this route, so the token requirement
> never affects the automated 6-hourly check.

### Run the SOL → $SKR conversion by hand

Accrued roll fees are recorded in D1 as `CONVERSION_PENDING` (ManualSink —
nothing auto-swaps).

**When:** on a calendar cadence (e.g. weekly) or when authenticated `GET /treasury/status`
shows `pendingLamports` above your threshold.

**How:**
1. Authenticated `GET /treasury/status` → note `pendingLamports` / `pendingCount`.
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

`DEAD` rows come from two different alerts — check which one fired, because
the correct next step differs:

**"Quick mint stuck on placeholder"** — a finalize *job* (already claimed,
already past verify) exhausted its consumer retries. Read it as recoverable,
not lost: the fee is banked and the asset exists on-chain, just still showing
the "Developing…" placeholder.

```sh
# What state did it stop in? (image_uri / arweave_uri are the checkpoints)
wrangler d1 execute momints-rolls --remote --command \
  "SELECT id, status, asset_address, image_uri, arweave_uri, created_at FROM quick_mints WHERE status='DEAD'"
```

Fix the underlying cause first — usually an empty Turbo credit balance (top it
up per the section above) or an RPC outage. Then re-drive:

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

**"Quick mint finalize REJECTED — needs operator review"** — a different
situation: `verify.ts` read a transaction that had already landed on-chain and
definitively rejected it (wrong fee, wrong owner, wrong update authority,
placeholder URI mismatch — the alert's "Rejection reason" field says exactly
which). `image_uri`/`arweave_uri` are both `NULL` on these — nothing was ever
uploaded. **Do not blindly re-drive this one** the way you would the case
above: the rejection reason is a fact about the landed transaction, not a
transient fault, so resuming without understanding *why* it was rejected can
mean spending Arweave to finalize a mint that was never actually paid for
correctly. Read the reason, confirm on Solscan what actually happened, and
only then decide: fix and finalize manually — `scripts/recover-quick-mint.mjs`
does this (uploads the real image + metadata, then `update()`s the asset,
provided `asset.updateAuthority` still resolves to the Worker's key; defaults
to dry-run, needs `--confirm` to actually act) — or leave it dead. The staged
image in R2 is preserved but subject to the bucket's 24h lifecycle rule — pull
it out promptly if you'll
need it.

Rows in `STAGED` are the opposite case — nothing was ever paid or uploaded, by
design. The app calls finalize right after a quick mint's transaction sends
(`useMint.ts`), driven by the signature captured AT SIGNING TIME rather than by
its own confirmation polling — a confirm timeout there does not mean the
transaction failed to land, only that the app gave up watching for it, so
finalize is called regardless and the Worker's own chain read is what actually
decides (real incident, 2026-09-02: this gate used to be `result.success`,
which skipped the call entirely on a timeout even for a mint that had already
landed). `store/quickFinalize.ts` is the crash-safety backstop underneath
that: it persists the same signature before the transaction is even sent, and
retries any entry that never got cleared on every app foreground. The sweep
and the bucket lifecycle rule reap genuinely-abandoned `STAGED` rows within a
day — but only rows that never got as far as attempting a finalize, which the
orphan sweep proves with `signature IS NULL` before it ever deletes anything.

**Deferred finalizes are now recovered server-side, not just client-side**
(real incident, 2026-09-03: a finalize that DEFERRED — verify said "not
visible to the RPC yet," a normal, frequent event, never a failure — used to
leave `asset_address`/`signature` `NULL` forever if the calling client never
came back, e.g. the app was closed or killed mid-flow. The mint had landed and
was paid for; nothing server-side knew what transaction to even look for). As
of this fix, `finalizeQuickMint` calls `recordFinalizeAttempt` and persists
the signature/asset *before* verify runs, so a deferred row is discoverable
immediately via `GET /quick/<asset>` even while still `STAGED`. A separate
scheduled sweep, `redriveDeferredFinalizes`, re-attempts every such row every
6h independent of the client — 2 minutes after the attempt (so it never races
a request still in flight) up to 24h, after which it gives up, marks the row
`DEAD`, and alerts ("Quick mint finalize stuck deferred for 24h+") rather than
retrying forever. Trigger it on demand:

```sh
curl -H "Authorization: Bearer $OPS_AUTH_TOKEN" "$WORKER_URL/ops/sweep-quick-mints"
# { attempted, completed, stillDeferred, gaveUp }
```

If a user reports a mint that never shows up anywhere, check
`GET /quick/<asset>` first — a `STAGED` row with a non-null `signature` is
this scenario, and it will now resolve on its own within a day; a `404` with
a real on-chain asset means the client never even reached this Worker (there
is genuinely nothing server-side to recover from, since `recordFinalizeAttempt`
never ran).

### Re-driving a stuck roll handoff

A `COMPLETE` roll with `handoff_signature` still `NULL` means the Worker's
delegate revoke hasn't landed on that collection yet:

```sh
wrangler d1 execute momints-rolls --remote --command \
  "SELECT collection_address, name, status, handoff_signature FROM rolls WHERE status='COMPLETE' AND handoff_signature IS NULL"
```

Nothing to do by hand — the same scheduled sweep that re-drives quick mints
retries every row it finds here, every 6h. Safe to leave alone in the
meantime: the roll is fully usable either way, the Worker has just not
relinquished a delegate it no longer needs. Re-running the revoke is always
safe too — it fetches the collection first and only sends a transaction if the
delegate is still actually present (see [roll collection
ownership](#roll-collection-ownership)).
