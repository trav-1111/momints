# Momints roll backend — Cloudflare Worker + D1 + Irys/Arweave

Single Cloudflare Worker backing the Momints roll feature: prepaid rolls of 12
or 24 exposures, each roll an immutable Metaplex Core collection, each frame a
Core asset minted into it, all media on permanent Arweave storage via Irys.
Devnet only. No VPS, no always-on keepers — manual operator tasks are listed
in the [runbook](#operator-runbook) below.

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
| `FundingProvider` | **ManualFunding** — checks the Irys balance, reports sufficiency, warns when low. Never funds inline. | `AutomatedFunding` — top-up keeper |

## Endpoints

```
GET  /health                       config + D1 reachability
GET  /funding/status               Irys balance vs one typical frame (operator)
GET  /treasury/status              accrued fees pending manual conversion (operator)
POST /rolls                        JSON { wallet, size, artist?, skrIdentity?, localDate?, feeSignature? }
GET  /rolls/open?wallet=<address>  the wallet's open roll, if any
GET  /rolls/<collection>           roll + per-frame checkpoint status
POST /rolls/<collection>/frames    multipart: image (file), frameIndex, description?, attributes? (JSON array)
```

## Setup

```sh
npm install
wrangler d1 create momints-rolls        # paste the id into wrangler.toml (TODO marker)
npm run db:migrate:remote               # or db:migrate:local for wrangler dev --local

wrangler secret put IRYS_FUNDING_KEY    # devnet funding wallet, base58 secret key
wrangler secret put SOLANA_RPC_URL      # Helius devnet endpoint

npm run typecheck
npm run deploy
```

Secrets are Worker Secrets only — never in the repo, `wrangler.toml`, or
`.env`. For local dev put them in `.dev.vars` (gitignored). **`wrangler
deploy` does not read `.dev.vars`** — deployed secrets must be set with
`wrangler secret put`. `IRYS_FUNDING_KEY` doubles as the Worker's on-chain
payer/authority for collection creation and frame mints; no code generates,
prints, or logs key material.

Pending TODOs in code: `ROLL_FEE_LAMPORTS_12/24` (placeholder pricing), the
D1 `database_id`, the final base cover artwork (`assets/base-cover.jpg` is a
placeholder), `AutomatedSink`, `AutomatedFunding`.

## Operator runbook

### Top up the Irys balance ahead of demand

Funding confirmation takes **120+ seconds** — it can never happen during a
user request. Rolls fail fast (503, operator-facing message) when the balance
is short. So: top up **ahead of** demand, not in response to failures.

**When:** check `GET /funding/status` before any demo/session and whenever a
response carries a `fundingWarning` (it warns while balance is below 2× the
anticipated work — i.e. before requests start failing). Low-balance warnings
also appear in `wrangler tail` as `[funding] …`.

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
