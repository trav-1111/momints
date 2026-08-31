# RESULT — keyed ANS-104 signing + Turbo upload inside a Cloudflare Worker

> **TEMPLATE — not yet run.** The paid step is the operator's action. Fill this
> in after running the spike (README steps 2 and 4), then tear the Worker down.

**Question:** Can a Cloudflare Worker (V8 isolate + `nodejs_compat`) sign an
ANS-104 data item with the funding key and upload it to genuine Arweave?

**Why it matters:** this is the last unproven step behind the Turbo /
lean-arbundles recommendation in `ARWEAVE_PATH_OPTIONS.md`. PASS clears the
provider swap to be scoped; FAIL sends the recommendation back for rework.

---

## Verdict

**RESULT: `PASS` / `PARTIAL` / `FAIL`** ← delete the two that don't apply

- Core question — keyed ANS-104 signing in workerd: **YES / NO**
- Real upload landed on Arweave: **YES / NO / not attempted**
- Date run:
- Run against: `https://momints-turbo-spike.traviskeir.workers.dev`

---

## Stage results

| Stage | Outcome | Notes |
|---|---|---|
| 1 LOAD — signer constructs from the secret | PASS / FAIL | |
| 2 SIGN — data item signed + self-verified | PASS / FAIL | **the core question** |
| 3 UPLOAD — POSTed to Turbo (spends) | PASS / FAIL / skipped | |
| 4 VERIFY — resolves on arweave.net | resolved / pending / n/a | never blocks |

## Evidence

```
paste the JSON response from the run here
```

**Arweave data item id:**
**URL:** `https://arweave.net/<id>`
**Resolves with content-type `application/json`:** yes / no / not yet (re-check later)
**Credits spent (winc):**  ← `0` if the small-item free tier covered it

## Runtime facts

- `compatibility_date`: `2026-07-22`
- `compatibility_flags`: `["nodejs_compat"]` — **was nodejs_compat required?**
  (i.e. did anything fail without it, or was it incidental?)
- Signing primitive: `@noble/ed25519` v1.6.1 (pure JS) + arbundles deepHash
- Bundle: 295.95 KiB gzip (spike only, `@dha-team/arbundles` + `bs58`)
- Pre-verified before the key was set, on the deployed edge Worker:
  `apiShape: { SolanaSigner: "function", createData: "function" }`

## If it FAILED

- Failing stage:
- `errorName`:
- Missing primitive / dependency named in the stack:
- Is it polyfillable, or fundamental to the Workers runtime?
- **Do not work around it in this spike.** Record the fact and reopen the
  recommendation in `ARWEAVE_PATH_OPTIONS.md`. If signing cannot happen in the
  Worker, signing has to move off the Worker — an architecture change, not a
  code change.

## Consequences

- **If PASS** — the last gate is cleared. The Turbo provider swap behind the
  existing `StorageProvider` seam is safe to scope: a `TurboProvider` +
  `TurboFunding` behind the seam, plus the five beyond-the-seam items listed in
  `ARWEAVE_PATH_OPTIONS.md` (ops-monitor units, placeholder URI re-upload,
  README claim, app `resolveUrl` — no change, existing devnet data not migrated).
- **If PARTIAL (signing YES, upload failed)** — the runtime question is settled
  YES; the upload leg is a credits/connectivity problem to fix separately. The
  provider swap is still viable.
- **If FAIL** — the lean-arbundles path does not work in-Worker. Revisit:
  full Turbo SDK (unlikely to help — same signing primitives), or move signing
  off the Worker entirely.

## Teardown

```sh
cd worker-turbo-spike && npx wrangler delete
```

Then delete this directory. Keep only this file's verdict, copied into
`ARWEAVE_PATH_OPTIONS.md` as the resolution of its open flag.
