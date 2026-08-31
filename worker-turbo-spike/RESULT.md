# RESULT — keyed ANS-104 signing + Turbo upload inside a Cloudflare Worker

**Question:** Can a Cloudflare Worker (V8 isolate + `nodejs_compat`) sign an
ANS-104 data item with the funding key and upload it to genuine Arweave?

---

## Verdict: **PASS**

- Core question — keyed ANS-104 signing in workerd: **YES**
- Real upload landed on genuine Arweave: **YES**
- Cost: **0 winc — the upload was free** (Turbo's small-item tier)
- Date run: **2026-08-31**
- Run against: `https://momints-turbo-spike.traviskeir.workers.dev`

**This clears the last gate.** The Turbo provider swap behind the existing
`StorageProvider` seam is safe to scope.

---

## Stage results

| Stage | Outcome | Notes |
|---|---|---|
| 1 LOAD — signer constructs from the secret | **PASS** | `signatureType: 2`, `ownerLength: 32` (ed25519) |
| 2 SIGN — data item signed + self-verified | **PASS** | **the core question** — 359 B payload → 536 B signed item |
| 3 UPLOAD — POSTed to Turbo | **PASS** | `winc: "0"` — free |
| 4 VERIFY — resolves on arweave.net | **resolved** | 403 at upload time (unmined), 200 ~9 min later |

The free run (stages 1–2, no spend) was executed first and already returned
`coreQuestion.answer: "YES"` — so the runtime question was settled **before**
anything was uploaded, exactly as the spike was designed to allow.

## Evidence

```
signingAddress   HLtxUsaApjJNSvbPVAGPJHCrztdPeRzARc3VZefdsaFw   (Solana pubkey)
dataItemId       WHpqfLYr5R7iwhxKytnQxxBA25hNsQx40bDbnvdq-Zs
owner            l9W4_u5mUO5E3BcM7X3X2h-mBMEZ62KAaXiRm2x4WvI    (ed25519, sig type 2)
signed at        2026-08-31T11:41:11.394Z
winc spent       0
```

Independently verified afterwards against the Arweave gateway and its GraphQL
index — not just from the Worker's own response:

```
https://arweave.net/WHpqfLYr5R7iwhxKytnQxxBA25hNsQx40bDbnvdq-Zs
  -> HTTP 200, content-type: application/json, 359 bytes
  -> body is the exact payload signed in the Worker (createdAt matches the run)

bundledIn   ZCARKH4O-XW2FFxNhEsoM1viJma7IWarPLh8Jy9lMY8
block       1991279 @ 2026-08-31T11:50:29Z   (5 confirmations)
Content-Type tag: application/json
```

**Time from signed-in-Worker to mined on Arweave: ~9 min 18 s.** Turbo returned
`deadlineHeight: 1991472` (its commitment to land it); it landed well inside that.

## Runtime facts

- `compatibility_date`: `2026-07-22` — identical to the production Worker
- `compatibility_flags`: `["nodejs_compat"]`. Present, matching production. The
  spike did **not** isolate whether it was strictly required; signing itself is
  `@noble/ed25519` v1.6.1 (pure JS) plus arbundles' deepHash, neither of which
  obviously needs it. Untested either way — do not claim the swap works without
  `nodejs_compat`; production has it regardless.
- Bundle: **295.95 KiB gzip** (spike only: `@dha-team/arbundles` + `bs58`)
- Verified before the key was set, on the deployed edge Worker:
  `apiShape: { SolanaSigner: "function", createData: "function" }` — so the
  PASS is about the runtime, not about the spike happening to be wired right.
- Key format that worked: **base58-encoded 64-byte Solana secret key**, the same
  format as the production `IRYS_FUNDING_KEY`.

## Consequences

1. **The lean `@dha-team/arbundles` + Turbo HTTP path is confirmed viable
   in-Worker.** No architecture change: signing stays on the Worker.
2. **The funding wallet can sign as well as fund.** One Solana keypair covers
   both, so the single-funding-wallet model survives.
3. **Small uploads can be free.** A 536-byte item cost 0 winc. Real frames
   (~3 MiB) are far above the 107,520-byte free-item ceiling, so this does not
   change the cost model — but metadata JSONs (~4 KiB) may ride the free tier
   until the 10 MiB lifetime allowance is used. Do not budget on it.
4. **Latency is fine for our flow.** Turbo returns the id and a signed receipt
   immediately; Arweave mining (~9 min here) happens after. Nothing user-facing
   waits on mining — the same shape as the current Irys flow.

Open flags from `ARWEAVE_PATH_OPTIONS.md` **not** resolved by this spike:
Turbo credit withdrawability, and the ops-monitor unit relabelling (winc vs
lamports). Both are follow-ups, neither blocks the swap.

## Teardown

Done — `wrangler delete` removed `momints-turbo-spike`, and with it the
`TURBO_SIGNING_KEY` secret that had been set on it. To resurrect: `npm install
&& npx wrangler deploy` from this directory, then re-set the secret.
