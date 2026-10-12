# Turbo / Arweave Workers spike — historical architecture evidence

Retained for hackathon provenance. This experiment answered the signing/upload feasibility question; current production uses `worker/`. The commands, hostnames, costs and results below describe the original experiment, not current reviewer setup. Do not deploy it or invoke its upload routes as part of setup. If deliberately reproducing the experiment separately, use independently named resources and your own dedicated identity/credits; never reuse Momints production credentials.

One question:

> Can a Cloudflare Worker (V8 isolate + `nodejs_compat`) sign an ANS-104 data
> item with the funding key and upload it to Turbo, landing on genuine Arweave?

`ARWEAVE_PATH_OPTIONS.md` recommended Turbo via lean `@dha-team/arbundles` and
proved everything except this at that point in development. The completed result is retained in `RESULT.md`; no deletion is needed.

**Deployed:** https://momints-turbo-spike.traviskeir.workers.dev

Runtime mirrors the production Worker exactly — `compatibility_date =
"2026-07-22"`, `compatibility_flags = ["nodejs_compat"]`. If it differs, the
spike proves nothing about production.

## Already proven (no key needed)

Deployed and hit on the real Cloudflare edge, `@dha-team/arbundles` imports and
its API shape resolves inside workerd:

```json
"apiShape": { "SolanaSigner": "function", "createData": "function" }
```

So the module graph loads in production workerd and **this spike is correctly
wired**. If you now see a LOAD or SIGN failure, that is real evidence about the
runtime, not a bug in the spike. That distinction is the whole point.

## Step 1 — set the signing key (operator)

```sh
cd worker-turbo-spike
npx wrangler secret put TURBO_SIGNING_KEY
```

### Key format — get this exactly right

`SolanaSigner` does `bs58.decode(key)`, then takes bytes `0..32` as the private
seed and `32..64` as the public key. So it wants:

> **a base58-encoded 64-byte Solana secret key** — the standard
> `solana-keygen` / Phantom "export private key" string.

This is the same encoding format as `IRYS_FUNDING_KEY`, **not** a reason to reuse a production key. Any independent reproduction must supply its own dedicated key.

It is **not** a JSON byte array (`[12,45,...]`), **not** hex, and **not** a
32-byte seed on its own. A format mismatch surfaces as a signing error that
looks exactly like a runtime failure — which is precisely the trap this section
exists to avoid. The base58 string should be ~87–88 characters.

## Step 2 — the free run (answers the question, spends nothing)

```sh
curl -X POST https://momints-turbo-spike.traviskeir.workers.dev/spike-sign-upload
```

Stages 1–2 only: LOAD (construct the signer) and SIGN (build, sign, and
self-verify an ANS-104 data item). **No network write, no spend.** This alone
answers the core question. Do this before anything that costs money.

Look at `coreQuestion.answer`:

| `verdict`                     | Means                                                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `NOT_RUN`                     | Key not set. Nothing proven either way — go back to step 1.                                                                        |
| `PARTIAL` + `"answer": "YES"` | **Signing works in workerd.** The gate is cleared.                                                                                 |
| `FAIL` + `"answer": "NO"`     | Signing does not work. Read `stages[].errorName` / `stack` — it names the missing primitive. **Stop; do not work around it here.** |

## Step 3 — check the credit balance (read-only)

```sh
curl https://momints-turbo-spike.traviskeir.workers.dev/balance
```

Returns the signing wallet's public address and its Turbo credit balance.

**The spike upload is likely free.** Turbo's small-item free tier covers data
items up to `107,520` bytes, against a `10 MiB` lifetime allowance per wallet
and per IP. This spike uploads roughly **500 bytes**, so a wallet that has not
used its allowance should not be charged at all.

If it is not free (the upload returns 402 / insufficient balance), top up a
minimal amount — a dollar is far more than enough — at
<https://turbo.ardrive.io>, crediting the address that `/balance` reports.
**Do not fund more than the minimum for a throwaway spike**, and note that
whether Turbo credits can be withdrawn back to SOL is still unconfirmed
(flagged in `ARWEAVE_PATH_OPTIONS.md`).

## Step 4 — the paid run (spends; operator triggers)

Only after step 2 says `YES`:

```sh
curl -X POST "https://momints-turbo-spike.traviskeir.workers.dev/spike-sign-upload?confirm=upload"
```

The `confirm=upload` flag is required — without it the route never uploads, so
no stray request can spend. Stages 3–4 run: POST the signed item to
`https://upload.ardrive.io/v1/tx/solana`, then report
`https://arweave.net/<id>`.

Stage 4 **never fails the spike**. Arweave mining takes minutes, so a
not-yet-resolvable URL is expected; re-check it by hand a little later:

```sh
curl -I https://arweave.net/<id>       # expect 200 and content-type: application/json
```

`verdict: "PASS"` with an id means keyed signing _and_ a genuine Arweave upload
both work from inside a Cloudflare Worker.

## Step 5 — record and tear down

Fill in `RESULT.md`, then delete the Worker and this directory:

```sh
npx wrangler delete           # or: npm run teardown
```

## Reading a failure

Each stage is independently try/caught so the failure is localized — LOAD, SIGN
and UPLOAD are three different fixes:

- **LOAD** — the signer would not construct. Almost always the key format (see
  above). If the error names a missing Node API, that is a real runtime finding.
- **SIGN** — the core question failed. `errorName` and `stack` name the missing
  primitive. Signing is `@noble/ed25519` v1 (pure JS) plus arbundles' deepHash,
  so a failure here would be surprising and is worth reporting verbatim.
- **UPLOAD** — signing worked; only the network write failed. Usually credits or
  connectivity, **not** a runtime problem. The core question is still answered
  YES, which is why that case reports `PARTIAL`, not `FAIL`.

## What this spike is not

No provider implementation, no `StorageProvider` swap, no image upload, no fee
work. It exists to produce one PASS/FAIL and then be deleted.
