# Momints — Irys-in-Workers spikes (THROWAWAY)

Disposable proof-of-concept code, not production, not wired into the Momints
app or any real backend.

- **Spike 1** (`POST /spike`): does the Irys SDK import, sign, and upload from
  inside the Cloudflare Workers runtime at all? **Answer: yes** — see
  `RESULT.md`.
- **Spike 2** (this update): the two questions Spike 1 left open —
  1. **Part A** — can a Worker handle a payload at Momints' 5 MB photo
     ceiling (`POST /spike-large`)?
  2. **Part B** — does the full realistic dependency set (Irys + Metaplex
     Core + Solana kit + an image-compositing library) fit in one Worker
     under Cloudflare's compressed-bundle limit (`bundle-check/`)?

See `RESULT2.md` for the recorded outcome.

## Part A — payload ceiling (`POST /spike-large`)

### Why one size per request, not a loop over all four

`/spike-large` tests exactly **one** payload per HTTP call — either a real
uploaded binary body, or a self-generated buffer via `?sizeMB=N`. A single
request that looped over 1/3/5/6 MB internally would lose every earlier
*passing* result if a larger size crashed the isolate outright (Workers can
be killed mid-request on a hard memory/CPU limit, with no chance for a
try/catch to run or a response to be sent). Testing sizes independently means
a crash at 5 MB doesn't erase the 1 MB/3 MB passes that already returned
cleanly moments before.

### Running it — **must be against the deployed edge, not just `wrangler dev --local`**

Spike 1 already showed local and deployed behavior can differ (the
missing-secret case only surfaced cleanly once actually deployed). Workers'
real memory/CPU/body-size limits are edge properties that Miniflare's local
simulation does not enforce the same way — a local "pass" at 6 MB does not
mean the real edge would also pass. Always run Part A against the deployed
URL.

```
npm install
wrangler secret put IRYS_FUNDING_KEY    # devnet-funded Solana secret key, base58 — you provide this
wrangler secret put SOLANA_RPC_URL      # see "RPC provider" note below — required for real uploads
npm run deploy
```

### RPC provider — the public devnet endpoint blocks Workers

The default `https://api.devnet.solana.com` **rejects requests from Cloudflare
Workers' egress IPs** with `403 "Your IP or provider is blocked from this
endpoint"`. This only bites when the SDK actually needs to send a transaction
(funding the Irys balance) — read-only calls in Spike 1 didn't hit it. Set
`SOLANA_RPC_URL` to a dedicated provider's devnet endpoint (e.g. Helius —
same provider/key family the Momints app itself already uses for
`EXPO_PUBLIC_SOLANA_RPC`, just pointed at `devnet.helius-rpc.com` instead of
mainnet) before running Part A for real, or every fund attempt fails outright
rather than just being slow.

### Funding latency — expect the *first* request at a new size to time out

Irys tracks a separate, pre-funded balance per wallet on its own bundler
node — it does **not** auto-fund from the wallet's on-chain SOL during
`.upload()`. `/spike-large` checks the price vs. that balance and calls
`.fund()` itself when short, which builds, signs, sends, and waits on a real
devnet transaction. In testing, that fund-and-confirm round trip **routinely
exceeded 120–180 seconds** — well past what a normal HTTP client (or a real
app's UX) would wait for. The transaction still lands and confirms in the
background even after the client gives up; a second request for the same (or
smaller) size, once already funded, completes in ~2–3 seconds. **Always
expect to send each new size twice**: once to trigger funding (it will likely
time out client-side — that's not a failure, just don't wait for it), then
again to get the real pass/fail result.

Then, for each size, either let the Worker self-generate the payload:
```
curl -X POST "https://<your-worker>.workers.dev/spike-large?sizeMB=1"
curl -X POST "https://<your-worker>.workers.dev/spike-large?sizeMB=3"
curl -X POST "https://<your-worker>.workers.dev/spike-large?sizeMB=5"
curl -X POST "https://<your-worker>.workers.dev/spike-large?sizeMB=6"
```
or send a real binary body (more representative — exercises the actual
request-body-ingestion layer, which self-generation on the Worker side
bypasses entirely):
```
head -c $((1*1024*1024)) /dev/urandom > /tmp/1mb.bin
curl -X POST --data-binary @/tmp/1mb.bin "https://<your-worker>.workers.dev/spike-large"
# repeat for 3, 5, 6 MB
```

Each call returns:
```
{
  "sizeMB": 5, "actualBytes": 5242880, "source": "uploaded-body" | "synthetic",
  "status": "pass" | "fail", "ms": 1234, "uploadMs": 987,
  "uri": "https://gateway.irys.xyz/..." | null,
  "error": { "message": "...", "stack": "..." } | null,
  "failureMode": "request-body-limit" | "memory-limit" | "cpu-limit" | "irys-or-network" | "unknown" | null
}
```
`failureMode` is a best-effort classification from the error text/HTTP
status — read the raw `error` alongside it, don't trust the label blindly.
If a call never returns a JSON body at all (connection reset, timeout, 5xx
with no body), that itself is a signal: the Worker was likely killed outright
by a hard limit before it could report anything — record that as its own
result rather than treating it as "no data."

## Part B — bundle headroom (`bundle-check/`)

Five build-only entry points, never deployed, never invoked — they exist
purely to be bundled so their real compressed size can be measured:

- `bundle-check/irys.ts` — Irys SDK alone
- `bundle-check/mpl-core.ts` — `@metaplex-foundation/mpl-core` alone
- `bundle-check/solana-kit.ts` — `@solana/kit` alone
- `bundle-check/image-photon.ts` — `@cf-wasm/photon` alone (see below for why
  this is the chosen image library)
- `bundle-check/combined.ts` — all four together, the realistic "everything
  Momints' backend needs alongside Irys" bundle

Each has its own tiny `wrangler.*.toml` (own `name`/`main`, otherwise
identical). Measure with `--dry-run`, which builds the real bundle without
deploying or needing to touch the account beyond being logged in:

```
cd bundle-check
npx wrangler deploy --dry-run --outdir=dist-irys          -c wrangler.irys.toml
npx wrangler deploy --dry-run --outdir=dist-mpl-core       -c wrangler.mpl-core.toml
npx wrangler deploy --dry-run --outdir=dist-solana-kit     -c wrangler.solana-kit.toml
npx wrangler deploy --dry-run --outdir=dist-image-photon   -c wrangler.image-photon.toml
npx wrangler deploy --dry-run --outdir=dist-combined       -c wrangler.combined.toml
```
Each prints `Total Upload: <raw> KiB / gzip: <gzip> KiB` — that's the number
that matters, compared against Cloudflare's Workers compressed-size limit
(3 MB Free / 10 MB Paid, as of this writing).

### Image library choice: `@cf-wasm/photon`

`sharp` is native-bindings-only and cannot run in Workers at all — not
evaluated further. `@cf-wasm/photon` wraps the Rust `photon-rs` library as a
purpose-built `workerd` WASM build (its own `/workerd` export, no
`nodejs_compat` needed) and has exactly the two primitives a roll cover needs:
`watermark()` to paste an overlay onto a base image, and `draw_text()` for the
date/exposure caption — both in one library, no extra dependency for text
rendering.

## Secrets

Same as Spike 1: `IRYS_FUNDING_KEY` is a Worker Secret, provided by the
operator via `wrangler secret put IRYS_FUNDING_KEY`, never generated,
hardcoded, printed, or logged by this code. `.dev.vars` and `.env` are
gitignored.
