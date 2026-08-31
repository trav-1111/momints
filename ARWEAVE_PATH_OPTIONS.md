# Path to genuine Arweave storage — options and recommendation

**Investigated 2026-08-31.** SOL/USD **$103.76** (Jupiter), AR/USD **$2.09**.
Read-only throughout: **no upload was made, nothing was spent, no key was
touched.** All Workers-runtime claims below come from a real spike, not docs.

---

## Recommendation

**Use Turbo (ArDrive / AR.IO) — and integrate it the lean way: sign ANS-104 data
items with `@dha-team/arbundles` and POST them to Turbo's public upload endpoint,
rather than pulling in the full `@ardrive/turbo-sdk`.**

Why:

- It is the only candidate that is **actively maintained** (published today,
  1.42.0, 237 releases) **and demonstrably writes genuine Arweave** (proof below).
- It is **2.05× cheaper** than the deprecated Irys Arweave bundler: **$0.1158**
  vs $0.2374 for our 3 MiB ceiling.
- It funds from **SOL**, so the existing single pre-funded funding wallet and the
  operator top-up runbook survive largely intact.
- The lean integration **shrinks the Worker bundle by 665 KiB gzip** instead of
  growing it by 765 KiB — headroom goes from 41% to ~63%, rather than down to 16%.

**It needs one runtime spike before committing** (scoped at the end): everything
except *keyed signing + a real upload inside workerd* is already proven.

---

## A. Genuine Arweave permanence — verified, not taken on trust

Turbo's own `/v1/info` names the Arweave wallet it settles bundles from:
`JNC6vBhjHY1EPwV3pEeNmrsgFMxH5d38_LHsZ7jful8`. Querying **arweave.net's own
GraphQL** for that wallet returns real, mined Arweave transactions:

```
tx 2fysDvB2doTOwqA-Ujk8zWcyEv8TICNw5W9rbUex3mA
   block 1991251  2026-08-31T10:50:37Z  size 181,963 B
   Bundle-Format=binary  Bundle-Version=2.0.0  App=AR.IO Bundler
arweave.net/tx/<id>/status -> {"block_height":1991251, "number_of_confirmations":3}
```

And — the part that actually matters for our metadata URIs — **individual data
items inside those bundles resolve on arweave.net with correct content types**:

```
https://arweave.net/Ny9bbBL6MxeLR0bxvgHr9VA3qDN75gjgaKR4uohvaD8 -> 200 application/json
https://arweave.net/QNQVlCiMgKiIaPuk36JDRr4OXkbiXP_yUjc32Iy8azs -> 200 audio/mpeg
https://arweave.net/rb0XYQVyxWkfDVUxP0f02QZYkJFuGT13gZrs5JbWre0 -> 200 text/plain
```

**Permanence model, plainly:** you pay once; Turbo bundles your signed data item
into an ANS-104 bundle and posts it as a normal Arweave transaction, paying the
network's one-time perpetual-storage endowment. Once mined, the data is on
Arweave with the same guarantee as any direct Arweave upload, and is retrievable
from any Arweave gateway — not only Turbo's.

Contrast with **what we do today**: `gateway.irys.xyz` IDs return 200 from an
Irys CDN and **404 on arweave.net**. Our current uploads are not on Arweave, so
the EULA claim is not currently true.

## B. Cloudflare Workers compatibility — spiked, mostly proven

A real spike was run against `compatibility_date = "2026-07-22"` and
`nodejs_compat`, identical to the production Worker.

| Check | Result |
|---|---|
| `wrangler deploy --dry-run` bundles the SDK | **PASS** — no unresolved imports, no unsupported `node:` builtins |
| Module imports + evaluates inside workerd | **PASS** — `/import` returned 40 exports incl. `TurboFactory` |
| Live Turbo API call from inside the isolate | **PASS** — `/price` returned real winc quotes and fiat rates |
| Signing classes load under workerd | **PASS** — `ArweaveSigner`, `HexSolanaSigner`, `SolanaSigner`, `Rsa4096`, `CryptoDriver` all import from `@dha-team/arbundles` |
| **Keyed signing + a real upload in workerd** | **NOT PROVEN** — requires a key and a paid upload; both out of bounds here |

The dependency tree contains native modules (`keccak`, `secp256k1`,
`bigint-buffer`, `bufferutil`, `utf-8-validate`), but the `@ardrive/turbo-sdk/web`
export path does not pull them into the bundle — the dry-run resolved cleanly
without them. That was the single biggest compatibility worry and it is answered.

**Residual risk is narrow but real.** Signer *construction and use* is the one
path a no-key investigation cannot exercise. Solana signing is pure-JS
(`tweetnacl` ed25519) and Arweave signing is RSA-PSS via WebCrypto, both of which
workerd supports — but that is reasoning, not evidence, so it is flagged rather
than claimed.

### Bundle size — measured, and it decides the integration style

The Worker is on the Free tier's **3072 KiB gzip** cap; today it is 1812 KiB.

| Configuration | gzip | vs today | Headroom left |
|---|---|---|---|
| Proxy of today (Irys + mpl-core + umi + photon) | 1794 KiB | — | (real Worker: 1812) |
| **Full `@ardrive/turbo-sdk`** swapped in for Irys | **2559 KiB** | **+765** | ~16% |
| **Lean `@dha-team/arbundles`** swapped in for Irys | **1129 KiB** | **−665** | ~63% |

The proxy lands within 18 KiB of the real Worker's 1812 KiB, so these deltas are
trustworthy. The full SDK drags in `ethers`, `@cosmjs/*`, `@permaweb/aoconnect`
and CLI deps (`commander`, `prompts`, `cli-progress`) that we would never call.
The lean path keeps only the ANS-104 signing/serialisation we actually need.

The full SDK still *fits* — but it would burn most of the headroom that the
single-Worker architecture depends on, with more features still to ship.

## C. Real cost

Turbo prices bytes at essentially Arweave's raw network rate (3 MiB =
35,865,137,845 winc vs Arweave's own oracle 35,853,399,418 winston — 0.03%
apart) and takes its margin on top-up instead: paying 1 AR credits 0.65 AR, a
**1.538× funding multiplier**. The figures below are all-in, after that fee.

| Payload | winc | lamports | USD |
|---|---|---|---|
| Metadata JSON (4 KiB) | 56,256,317 | 1,750 | $0.0002 |
| Cover (200 KiB) | 2,343,916,284 | 72,930 | $0.0076 |
| Typical frame (~1.5 MB) | 17,106,836,752 | 532,273 | **$0.0552** |
| **Frame ceiling (3 MiB)** | 35,865,137,845 | **1,115,930** | **$0.1158** |
| 1 GiB | 12,238,710,272,444 | 380,802,794 | $39.51 |

**At the 3 MiB ceiling, against the numbers already measured:**

| Path | lamports | USD | |
|---|---|---|---|
| **Turbo (genuine Arweave)** | 1,115,930 | **$0.1158** | recommended |
| Irys Arweave bundler (deprecated) | 2,288,017 | $0.2374 | 2.05× dearer |
| Irys L1 (today) | 123,166 | $0.0128 | 9.06× cheaper, **but not Arweave** |

Turbo's free tier is a **10 MiB lifetime** allowance (`maxItemBytes` 107,520,
`lifetimeBytes` 10,485,760) — negligible; do not model it as ongoing.

### What this does to the fee model (for the fee task, not decided here)

Storage per unit sold, via Turbo: **roll-12 $1.3994, roll-24 $2.7910, quick mint
$0.1160**. Folding that into the measured rent from `MAINNET_COSTS.md`:

| | Operator cost | Current fee | Margin |
|---|---|---|---|
| Roll 12 | $4.7534 | $8.8196 (85,000,000) | **1.86×** |
| Roll 24 | $9.2276 | $17.1204 (165,000,000) | **1.86×** |
| Quick mint | $0.1165 | $0.6744 (6,500,000) | **5.79×** |

The existing roll fees still clear cost on genuine Arweave, at almost exactly the
1.4–1.9× band they were designed for. Moving to real Arweave does **not** force a
roll-fee increase.

## D. Funding model fit

Turbo runs on prepaid **credits (winc)**, topped up by transferring a supported
token to Turbo's payment address for that token. Solana is supported
(`/v1/price/solana/...` quotes fine; payment address
`HepiT2k93CFQaSB7i3ZNXhybZKn5MeWiv3UkLsaJKk4i`), so:

- the existing **single SOL funding wallet keeps working** — top-ups stay SOL;
- credits are held against the **signer's address**, so signing data items with
  the same Solana keypair keeps funding and identity in one place;
- top-up is a transfer + confirmation, not a 120-second blocking `.fund()` — the
  hard constraint that shaped the current design is unchanged or eased.

Changes this forces:

- **Units.** Balance is winc, not lamports. `ops/monitor.ts` computes "rolls of
  headroom" as a *ratio* so its logic survives, but its `formatSol()` output and
  the "~X SOL" strings in Discord alerts would be wrong and must be re-labelled.
- **Runbook.** The README top-up section (currently `irys fund …`) is replaced by
  a Turbo top-up. Thresholds (20/5 rolls) keep their meaning.
- **Open question — flagged, not answered:** whether Turbo credits are
  withdrawable back to SOL. Irys balances were. If credits are one-way, that is a
  treasury consideration (don't over-fund), and it should be confirmed with
  ArDrive before a large top-up.

## E. Integration size

The `StorageProvider` seam was built for exactly this, and it holds.

**Behind the seam (the bulk — a clean swap):**
- New `TurboProvider implements StorageProvider` next to `IrysProvider`; same
  `uploadJSON` / `uploadImage` → URI contract. Returns
  `https://arweave.net/<dataItemId>`.
- New `TurboFunding implements FundingProvider` (`ensureFunded`, `balanceStatus`)
  reading Turbo's price + balance endpoints.
- `providers/irysUploader.ts` retires; `RequestContext.irysSeams()` builds Turbo
  instead.

**Beyond the seam (small but real — do not miss these):**
1. **`ops/monitor.ts` / Discord alerts** — SOL-denominated formatting and the
   `[funding]` warning text become misleading in winc.
2. **Quick-mint placeholder URI** — `scripts/upload-placeholder.mjs` re-uploads
   the "Developing…" doc to Arweave, and the URI **gets shorter**:
   `https://arweave.net/<43-char id>` = **63 chars** vs
   `https://gateway.irys.xyz/<43>` = **68**. The Core asset is sized at mint
   against the placeholder, so each asset is **5 bytes smaller — 34,800 lamports
   less rent** (a small, free win for the user). Because placeholder and final
   URI are then the same length, the URI swap still needs no reallocation.
   Verify that equality holds: if the final URI were *longer* than the
   placeholder, the update would force a realloc the Worker pays for.
3. **Worker README** — the "permanent Arweave storage" claim becomes true;
   the runbook and the seam table need updating.
4. **App `resolveUrl`** — no change needed. `src/services/storage.ts` only
   rewrites `ipfs://`; absolute `https://` URIs pass through, and
   `https://arweave.net/<id>` is absolute.
5. **Existing devnet data does not migrate.** Everything already minted points at
   `gateway.irys.xyz`. Fine for a mainnet cutover from zero; a problem only if
   devnet assets must keep resolving.

---

## Candidate comparison

| | A. Genuine Arweave | B. Workers | C. 3 MiB cost | D. Funding | E. Integration |
|---|---|---|---|---|---|
| **Turbo, lean (arbundles + HTTP)** | **Yes — verified on arweave.net** | Bundles + evals; **−665 KiB**; keyed sign unproven | **$0.1158** | SOL top-up → credits | New provider behind seam + 5 small items |
| **Turbo, full SDK** | Same | Same, but **+765 KiB** (16% headroom) | $0.1158 | Same | Slightly less code to write |
| Native `arweave-js` | Yes — direct Arweave | Pure JS, likely OK | ~$0.0749 raw network price | **Needs AR, not SOL** | Large — no bundler; each upload is its own tx needing mining |
| Irys Arweave bundler (`node1`) | Yes | Already proven | $0.2374 | SOL (as today) | Smallest — but see below |
| Irys L1 (**today**) | **No — 404s on arweave.net** | Proven | $0.0128 | SOL | None |
| Akord / Arseeding | Arweave-backed | Unverified | Not quoted | Own account/token models | Larger; smaller ecosystems |

**Ruled out, one line each:**
- **Irys L1 (current code)** — does not write Arweave; fails the non-negotiable requirement.
- **Irys Arweave bundler** — `@irys/sdk` is *explicitly deprecated on npm* ("Arweave support is deprecated"), `@irys/upload` has not published since 2025-02-13, and Irys steers users to the datachain; also 2.05× dearer than Turbo. Maintenance-only is not a foundation for a legal permanence claim.
- **Native `arweave-js`** — viable but wrong shape for the hot path: no bundling, so every frame is its own Arweave transaction awaiting mining (minutes), against the current ~2.5 s upload budget; and it needs an AR-funded wallet, breaking the single-SOL-wallet model.
- **Akord / Arseeding** — real Arweave-backed services, but neither offers a SOL-funded, Workers-friendly bundler path as directly as Turbo; not worth the integration risk unless Turbo is rejected.

---

## The spike to run before committing

**One route, one afternoon.** In a throwaway Worker on the real runtime: top up a
few dollars of Turbo credits from the funding wallet, then sign a small data item
with `HexSolanaSigner` using that key and POST it to
`https://upload.ardrive.io/v1/tx/solana`. Success = the returned id resolves at
`https://arweave.net/<id>` with the right content type. That closes the only gap
left — keyed signing and a real upload inside workerd — and is the same shape as
the original Irys spike.

Run it before writing the provider, because a failure there is architectural: it
would push signing off the Worker and change the design, not just the code.

## Honest flags

- **Keyed signing in workerd is unproven.** Everything around it passed, and the
  primitives are workerd-supported, but this is the one claim not backed by
  evidence. Do not skip the spike.
- **Turbo credit withdrawability is unconfirmed.** Confirm before a large top-up.
- **Bundle headroom is a live constraint.** The full SDK fits today at ~16%
  headroom; that is thin for a Worker still gaining features. The lean path is
  recommended partly for this reason.
- **Prices float.** Turbo bytes track AR; the SOL top-up rate tracks SOL/AR. The
  $0.1158 figure moves with both — re-quote before locking fees.
- **Turbo is a service, not a protocol.** If it disappeared, data already on
  Arweave stays on Arweave (that is the point), but the upload path would need
  replacing again. Direct `arweave-js` remains the always-available fallback.

## Reproducing this

```sh
# Turbo's live price for our 3 MiB ceiling, in Turbo credits:
curl "https://payment.ardrive.io/v1/price/bytes/3145728"
# credits per SOL (0.01 SOL), and the USD rate for 1 GiB:
curl "https://payment.ardrive.io/v1/price/solana/10000000"
curl "https://payment.ardrive.io/v1/rates"

# Turbo settles to real Arweave — query arweave.net's own GraphQL for
# owner JNC6vBhjHY1EPwV3pEeNmrsgFMxH5d38_LHsZ7jful8, take any tx id, then fetch
# a data item bundled in it from https://arweave.net/<dataItemId>
```

`scripts/mainnet-storage-quote.mjs` (on the `worktree-mainnet-cost-investigation`
branch) also quotes the Irys and Arweave-oracle side of this comparison.

The Workers spike was a scratch project (`@ardrive/turbo-sdk` + wrangler,
`compatibility_date = "2026-07-22"`, `nodejs_compat`) with three read-only
routes — import / price / signer — plus `wrangler deploy --dry-run` size runs for
the Irys, full-SDK and lean-arbundles configurations. Recreate it in ~10 minutes
from this description; it was deliberately not committed, since this task is
investigation only.
