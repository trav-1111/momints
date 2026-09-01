# Result — Irys signing in Cloudflare Workers

Recorded from a deployed edge run (real Cloudflare account, `wrangler deploy`,
real `IRYS_FUNDING_KEY` secret, real devnet upload) — not just local
`wrangler dev`. Wrangler 4.113.0, `compatibility_flags = ["nodejs_compat"]`,
`compatibility_date = "2026-07-22"`.

## Outcome

- [x] **PASS** — all three stages passed on a real deployed Worker.
- [ ] PARTIAL
- [ ] FAIL

## Stage results

| Stage | Result | Notes |
|---|---|---|
| 1 — import/instantiate | **pass** | `@irys/upload` + `@irys/upload-solana` imported and `Uploader(Solana).withWallet(key).withRpc(SOLANA_DEVNET_RPC).devnet()` constructed on the deployed edge Worker, not just local Miniflare. |
| 2 — sign/signer-adjacent | **pass** | `.ready()` + `.address` (key derivation) and `.getPrice(100)` (network round-trip) both succeeded against the real funded key. |
| 3 — fund + upload | **pass** | Real payload uploaded to Irys devnet from the deployed Worker and paid for by the funding wallet — the actual proof this whole spike exists to get. |

## Bundle size — flag as a watch item

The Irys SDK alone (`@irys/upload` + `@irys/upload-solana` and their
transitive tree — `@irys/bundles`, `axios`, `inquirer`, `@solana/web3.js` v1,
etc.) compiles to:

- **5017 KiB raw**
- **1050 KiB gzipped**

That's ~35% of the Workers **Free** tier's 3 MB compressed-bundle cap, and
~10% of the **Paid** tier's 10 MB cap, spent on this one dependency before any
real business logic is added. Not a blocker today, but worth tracking as more
gets built on top — a future D1/routing/provider layer eating into what's left
of that budget is the realistic failure mode here, not a runtime
incompatibility.

## Caveat — what Stage 2 does and doesn't prove

Stage 2 is **address derivation + a price round-trip, not a signature**. The
SDK doesn't expose a standalone "sign this message" primitive on the
uploader, so Stage 2 only proves the key parses and the client can talk to
Irys's network — it does not by itself prove signing works. **Stage 3 is the
real proof**: a successful upload requires the SDK to actually sign the data
item before it's accepted, so Stage 3 passing is what closes out the original
question, not Stage 2.

## Untested

Payloads at the app's actual **5 MB photo ceiling** were not exercised — this
spike only ever uploaded a few hundred bytes of text
(`momints-spike-<timestamp>`). Byte-size behavior (chunking, timeouts, CPU
time under Workers' request limits, Irys pricing/funding at that size) is
still an open question before treating this as production-ready for real
frame uploads, not just the signing-works-at-all question this spike was
scoped to answer.

## `nodejs_compat` sensitivity

Not isolated — every run in this session had it on from the start (per the
plan, specifically to avoid false negatives from testing without it). Whether
it's strictly required or just incidental wasn't tested by toggling it off.

## Recommendation

- [x] **Keep storage-upload signing on Cloudflare Workers.** All three stages
      passed on a real deployed edge Worker — the $0/mo path is viable for
      Irys signing specifically.
- [ ] Move storage-upload signing to a small Node service.

One-line reasoning: the dependency tree that looked riskiest on paper
(`@irys/bundles`, `@solana/web3.js` v1, native-binding-adjacent packages)
imported, signed, and uploaded successfully on a real deployed Worker with
`nodejs_compat` — the two remaining open questions are bundle-size headroom
as the rest of the backend gets built, and behavior at real photo-sized
payloads, neither of which points at signing itself being the problem.

## Next step

Before wiring this into the real backend: run a Stage-3-equivalent upload at
representative frame sizes (up to the 5 MB ceiling) to confirm timing/limits
hold, and keep an eye on total bundle size as D1/routing/provider code is
added on top of this SDK's ~1 MB gzipped footprint.
