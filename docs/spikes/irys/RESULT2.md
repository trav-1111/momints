# Result 2 — payload ceiling + bundle headroom

Both parts done with real data from the deployed edge Worker
(`https://momints-irys-spike.traviskeir.workers.dev`) and real `wrangler
deploy --dry-run` bundle measurements. Devnet only throughout.

## Part A — payload ceiling

**All four sizes passed — 1, 3, 5, and 6 MB (over the stated ceiling).** No
payload-size limit was hit anywhere in this range: no request-body rejection,
no memory error, no CPU-time error. Every failure encountered was about
*funding mechanics*, not size, and every one of those was resolved without
touching the Worker's core logic.

| Size | Status | Server ms | uploadMs | Notes |
|---|---|---|---|---|
| 1 MB | **pass** | 2327 | 1397 | Passed on 2nd attempt (1st needed funding, timed out client-side at 120s) |
| 3 MB | **pass** | 2638 | 1764 | Same pattern — 1st attempt timed out at 180s, 2nd passed |
| 5 MB | **pass** | 2556 | 1726 | Same pattern |
| 6 MB | **pass** | 2522 | 1737 | Same pattern — over-ceiling size also fine |

Largest passing size tested: **6 MB (no failure found in the requested
range)**. Failure mode above it: **not reached — the spec's four sizes never
broke on payload size**. If a true payload-size ceiling matters later, it
would need testing well past 6 MB; nothing in this data suggests where that
would be.

### Two real, unrelated things this surfaced (not payload-size problems)

**1. The public devnet RPC blocks Cloudflare Workers.** The first funding
attempt failed outright with:
```
failed to get recent blockhash: Error: 403 Forbidden: {"jsonrpc":"2.0","error":{"code":403,"message":"Your IP or provider is blocked from this endpoint"} ...}
```
`https://api.devnet.solana.com` rejects Workers' egress IPs for anything that
sends a transaction (read-only calls in Spike 1 never hit this). Fixed by
adding a `SOLANA_RPC_URL` Worker Secret override, pointed at Helius's devnet
endpoint (same provider family the Momints app already uses for its own RPC).
**Any real deployment needs a dedicated RPC provider for devnet, not the
public endpoint** — this generalizes beyond Irys funding to any Worker-side
Solana transaction.

**2. Funding an unfunded balance is slow — routinely over 120–180 seconds.**
The raw `@irys/upload-solana` SDK does not auto-fund from on-chain SOL during
`.upload()`; it tracks a separate pre-funded balance on Irys's bundler node
and throws `402 Not enough balance` if it's short. `/spike-large` calls
`.fund()` explicitly when needed, which sends a real devnet transaction and
waits for confirmation. In every one of the four size tests, the *first*
request (funding required) exceeded a 120–180 second client timeout with
zero bytes returned — but the funding transaction had actually succeeded in
the background, confirmed by a retry moments later completing in ~2–3
seconds. This reproduced identically at all four sizes tested (2/2 confirmed
at 1 MB and 3 MB before the pattern was trusted; matched again at 5 MB and
6 MB) — **not a fluke, a real characteristic of first-time funding on this
path**.

### What this means for the app

- Payload size (1–6 MB) is not the constraint — don't design around a 5 MB
  worry.
- **Funding cannot happen synchronously inside a user-facing request** if the
  balance might be short — 120+ seconds is not a viable wait for "create
  roll" or "upload frame." A real design needs the storage-funding wallet
  kept pre-funded ahead of user actions (matches the original architecture's
  `FundingProvider.ensureFunded()` seam — this is exactly the case it exists
  for), not funded reactively per-request.
- Devnet (and presumably mainnet) RPC calls from a Worker need a real
  provider (Helius or similar), never the public `api.devnet.solana.com`.

---

## Part B — bundle headroom

Measured via `wrangler deploy --dry-run --outdir=...` (build-only, no
deploy). Real numbers.

| Bundle | Raw | Gzip |
|---|---|---|
| Irys alone (`@irys/upload` + `@irys/upload-solana`) | 4724.58 KiB | 1018.14 KiB |
| Metaplex Core alone (`@metaplex-foundation/mpl-core`) | 688.39 KiB | 79.26 KiB |
| Solana kit alone (`@solana/kit`) | 408.99 KiB | 88.27 KiB |
| Image lib alone (`@cf-wasm/photon`) | 1563.55 KiB | 617.96 KiB |
| **Combined (all four together)** | **7388.52 KiB** | **1804.79 KiB** |

Cloudflare Workers compressed-bundle limit: **3 MB (3072 KiB) Free, 10 MB
Paid**, as of this writing.

**Fits comfortably in one Worker, even on Free tier** — 1804.79 KiB gzip
combined leaves ~1267 KiB (~41%) of the Free-tier cap free for actual
routing/D1/auth/business logic. No bundle-size case for splitting into
multiple Workers with this dependency set.

**Dominant dependency: the Irys SDK** — 1018.14 KiB gzip, ~56% of the
combined total. Image lib (Photon, WASM) is second at 617.96 KiB gzip (~34%).
Metaplex Core + Solana kit together are ~9% (167.53 KiB gzip).

Sanity check: summing the four standalone gzip figures (1018.14 + 79.26 +
88.27 + 617.96 = 1803.63 KiB) lands within 1.2 KiB of the real combined build
(1804.79 KiB) — negligible cross-dependency dedup, so the standalone numbers
are a reliable guide to where size comes from.

Image library choice: `@cf-wasm/photon` (`sharp` doesn't run in Workers at
all — not evaluated further). Its WASM import (`import ... from
"./lib/photon_rs_bg.wasm"` inside the package itself) built and bundled with
zero extra `wrangler.toml` configuration — no `[[wasm_modules]]` block
needed, wrangler's esbuild pipeline handled it natively.

---

## Recommendation

- [x] **Single Worker** — bundle size is not a blocker (1804.79 KiB gzip
      combined, real headroom under the Free-tier 3 MB cap).
- [ ] Split Workers — not supported by the data.
- [ ] Railway/Node fallback for signing itself — not supported by the data;
      Irys signing/uploading works fine in a Worker up to 6 MB.

**The one real design constraint this spike found isn't bundle size or
payload size — it's funding latency.** Whatever backend gets built needs
`FundingProvider.ensureFunded()` to run ahead of time (a scheduled/manual
top-up, not a per-request reactive fund call), and needs a real RPC provider
secret from day one, not the public devnet endpoint.
