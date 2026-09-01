# Mainnet cost basis — measured, not estimated

**Measured 2026-08-31.** SOL/USD **$101.28** (Jupiter), AR/USD **$2.09**, SKR/USD
**$0.0271708** (Jupiter, mint `SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3`).

Everything here is read-only. **No mainnet transaction was sent and no key was
touched.** Reproduce with:

```sh
node scripts/mainnet-storage-quote.mjs   # Irys/Arweave storage prices
node scripts/mainnet-rent-quote.mjs      # Core rent + tx fees from the live rent sysvar
```

Prices move. Re-run both before committing any constant.

---

## Three findings that change the decision

**1. SIMD-0437 has not started on mainnet.** The brief assumed mainnet rent is
mid-rollout and falling week by week. The chain says otherwise: mainnet's rent
sysvar reads `lamports_per_byte = 6960`, the *pre-reduction* baseline. Step 1
would be 6333. **Testnet** is at 6333 — step 1 is live there and has not reached
mainnet. So today's Core rent is at full price, and the entire 10× cut is still
ahead. Verified three ways: the rent sysvar, `getMinimumBalanceForRentExemption`,
and 8/8 real mainnet Core accounts holding exactly `(128 + data) × 6960`.

**2. The storage number depends on a product choice nobody has made yet.** The
Worker's SDK (`@irys/upload`) resolves mainnet to `uploader.irys.xyz`, which
stores to the **Irys L1 datachain — not Arweave**. Four sampled
`gateway.irys.xyz` IDs all return 200 from an Irys CDN and **404 on
arweave.net**, while a control asset publishing an `arweave.net` URI returns 200.
The pricing corroborates it: `uploader.irys.xyz` quotes **$4.26/GiB**, which is
*below Arweave's own $25.55/GiB* oracle price — nobody resells permanent Arweave
bytes at a sixth of cost. The legacy Arweave bundler `node1.irys.xyz` quotes
**$79.06/GiB** (≈3.1× the raw Arweave cost, a normal bundler margin).

That is an **18.6× spread on the single biggest storage line**, and the README's
"permanent Arweave storage" claim currently points at the expensive one while
the code points at the cheap one. This must be settled before fees are locked.

**3. Two errors in the current cost basis partly cancel.** `rolls/config.ts`
records Core asset rent as `3_511_440` lamports. That cannot be a rent-exempt
minimum at any account size — `3,511,440 / 6,960 = 504.517`, not an integer. The
real frame rent is **2,470,800** (42% lower). Its storage figure (`1_261_912`)
came from *devnet* Irys, which is ~11× the real mainnet Irys-L1 price. Rent too
high, storage too low, and the 12-roll total landed within **1.2%** of the true
Arweave-priced cost. The fees are approximately right by luck, not by basis.

Separately, `quick/config.ts` books the Core asset rent as an operator cost. It
is not: the **user's wallet** mints the quick asset in the single signature the
README describes, so the user pays that rent. The operator pays only storage and
the URI-swap fee.

---

## The cost table

Per-unit, at today's prices. "3 MiB" is the ceiling every fee is anchored to;
real frames run smaller.

| Component | Native | USD | Who pays | Notes |
|---|---|---|---|---|
| Storage, 3 MiB ceiling — **Irys L1** | 123,166 lamports | **$0.0125** | operator | what the SDK does today |
| Storage, 3 MiB ceiling — **Arweave** | 2,288,017 lamports | **$0.2317** | operator | `node1.irys.xyz`; the README's claim |
| Storage, ~1.5 MB typical — Irys L1 | 58,730 lamports | $0.0059 | operator | reference |
| Storage, ~1.5 MB typical — Arweave | 1,091,012 lamports | $0.1104 | operator | reference |
| Storage, metadata JSON (4 KiB) | 3,208 / 59,584 | $0.0003 / $0.0060 | operator | Irys L1 / Arweave |
| Storage, cover (200 KiB) | 8,019 / 148,960 | $0.0008 / $0.0151 | operator | once per roll |
| **Roll frame asset rent** (227 B) | 2,470,800 lamports | **$0.2502** | **operator** | Worker mints frames |
| **Roll collection rent** (247 B) | 2,610,000 lamports | **$0.2643** | **operator** | once per roll |
| **Quick-mint asset rent** (325 B max) | 3,152,880 lamports | **$0.3193** | **user** | user's wallet mints it |
| Base tx fee | 5,000 lamports/sig | $0.000506 | per signer | confirmed on live txs |
| Quick-mint URI swap | 5,000 lamports | $0.000506 | operator | one extra signature |

Rent figures are computed from the live rent sysvar and **cross-check exactly
against the cluster's own `getMinimumBalanceForRentExemption`** for all four
account shapes. The size model also reproduces the repo's independently measured
collection rent (2,610,000) to the lamport.

Rent is **still falling** — see the rollout table below. Storage prices float
with AR/SOL and are not on a schedule.

### Rent as SIMD-0437 activates

| Account | today 6960 | 6333 | 5080 | 2575 | 1322 | 696 (final) |
|---|---|---|---|---|---|---|
| Roll frame asset | $0.2502 | $0.2277 | $0.1827 | $0.0926 | $0.0475 | **$0.0250** |
| Roll collection | $0.2643 | $0.2405 | $0.1929 | $0.0978 | $0.0502 | **$0.0264** |
| Quick asset (max name) | $0.3193 | $0.2906 | $0.2331 | $0.1181 | $0.0607 | **$0.0319** |

---

## Real cost per unit sold

Rent dominates. Storage — the line the whole fee model was built around — is
**4.5% of a roll's cost** under Irys L1 pricing.

| Path | Operator cost (Irys L1) | Operator cost (Arweave) | Current fee | Margin (L1) | Margin (Arweave) |
|---|---|---|---|---|---|
| Roll 12 | $3.4286 | $6.1481 | $8.6088 (85,000,000) | +$5.18 (**2.51×**) | +$2.46 (**1.40×**) |
| Roll 24 | $6.5911 | $12.0103 | $16.7112 (165,000,000) | +$10.12 (**2.54×**) | +$4.70 (**1.39×**) |
| Quick mint | $0.0133 | $0.2383 | $0.6583 (6,500,000) | +$0.645 (**49.5×**) | +$0.420 (**2.8×**) |

The roll fees hit almost exactly the 1.4× margin they were designed for — **if
storage is Arweave**. On Irys L1 they carry 2.5×. The quick fee is the outlier:
49.5× on Irys L1, because its basis charged the operator for rent the user
actually pays.

---

## Candidate fee constants — $0.20 SOL / $0.15 SKR

**TODO(operator): confirm and commit. These are candidates; the live constants
are deliberately untouched.**

At $101.28/SOL, **$0.20 = 1,974,724 lamports** (0.001974724 SOL).
At $0.0271708/SKR, **$0.15 = 5.5206 SKR**. Confirm the SKR mint and its decimals
before encoding a raw amount — the mint above is the highest-liquidity match
($1.13M liquidity, $189M mcap) but was not found anywhere in the repo.

```
QUICK_MINT_FEE_LAMPORTS = 1_974_724   // $0.20 — viable, see below
ROLL_FEE_LAMPORTS_12    = 1_974_724   // $0.20 — LOSES $3.23 PER ROLL
ROLL_FEE_LAMPORTS_24    = 1_974_724   // $0.20 — LOSES $6.39 PER ROLL
```

**$0.20 works for a quick mint and does not work for a roll.** A quick mint
costs the operator $0.0133, so $0.20 is a 15× margin. A 12-roll costs $3.43 —
mostly rent the operator pays on the user's behalf — so a $0.20 roll fee loses
$3.23 every time. Rolls are 12–24 mints plus a collection; they cannot price
like one mint.

If "$0.20" was meant as **$0.20 per frame**, the roll numbers work out to:

| | $0.20/frame | Cost (L1) | Margin |
|---|---|---|---|
| Roll 12 | $2.40 → 23,696,688 lamports | $3.4286 | **−$1.03 (still a loss)** |
| Roll 24 | $4.80 → 47,393,376 lamports | $6.5911 | **−$1.79 (still a loss)** |

Even per-frame, $0.20 does not clear cost while rent is at 6960. It does after
the rollout: at 696 a 12-roll costs **$0.4880**, so $2.40 becomes a **4.9×**
margin (+$1.91/roll).

**Break-even fees today (Irys L1, zero margin):** roll 12 $3.43, roll 24 $6.59,
quick $0.0133.

---

## The 70/30 mix

Per 100 quick mints, 70 paying SOL and 30 paying SKR, operator costs all in SOL:

| Fee | SOL in | SKR in | SOL out | **Net SOL** | Net total |
|---|---|---|---|---|---|
| Current $0.658 | $46.08 | $4.50 (165.6 SKR) | $1.33 | **+$44.75** | +$49.25 |
| Candidate $0.20 | $14.00 | $4.50 (165.6 SKR) | $1.33 | **+$12.67** | +$17.17 |

Net SOL stays comfortably positive either way — quick-mint operator cost is tiny
once rent is correctly assigned to the user. The SKR leg never contributes SOL,
so the SOL position is set entirely by the 70% and by storage. Under **Arweave**
pricing SOL out rises to $23.83/100, and $0.20 × 70 = $14.00 in would go **net
SOL negative (−$9.83)** — another reason the storage decision comes first.

---

## User's all-in cost per quick mint

| | Rent | Fee | Tx | **All-in** |
|---|---|---|---|---|
| Today, current fee | $0.3193 | $0.6583 | $0.0005 | **$0.9782** |
| Today, $0.20 fee | $0.3193 | $0.2000 | $0.0005 | **$0.5198** |
| Full reduction, current fee | $0.0319 | $0.6583 | $0.0005 | **$0.6908** |
| Full reduction, $0.20 fee | $0.0319 | $0.2000 | $0.0005 | **$0.2324** |

At the current fee, rent is 32.6% of the user's cost today and 4.6% after the
rollout; at a $0.20 fee it is **61.4% today and 13.7% after**, i.e. the cheaper
the fee, the more the user's cost is just rent. Waiting for SIMD-0437 does
nothing for operator margin on quick mints — the user pays that rent — but takes
the user's all-in from **$0.98 to $0.69** at current fees, or **$0.52 to $0.23**
at $0.20.

For **rolls** the rollout matters to the operator directly, because the operator
pays the rent: a 12-roll's cost falls from $3.4286 to **$0.4880** at full
reduction (**7.0×**), and a 24-roll from $6.5911 to **$0.9480** (7.0×). Rent is
**95.3%** of a roll's cost today, storage 4.5%, tx fees 0.2%.

---

## Versus the $0.08/image estimate

| Basis | 3 MiB | vs estimate |
|---|---|---|
| Original estimate | $0.0800 | — |
| Irys L1 (SDK today) | $0.0125 | **0.16×** |
| Arweave (`node1`) | $0.2317 | **2.90×** |
| Devnet Irys (current fee basis) | $0.1369 | 1.71× |

Both real numbers differ materially, in opposite directions. The estimate was
never close to either. But storage barely matters now: at Irys-L1 prices it is
4.5% of a roll's cost, and **rent — which was mis-measured — is 95%.** The fee
model was tuned against the small line and got the big one wrong.

---

## What to decide

1. **Arweave or Irys L1?** This sets storage cost (18.6×), the README's
   permanence claim, and whether $0.20 keeps the SOL position positive. Nothing
   else should be locked first. If the answer is Arweave, the code needs the
   legacy Arweave bundler — the current SDK path does not reach Arweave.
2. **Wait for SIMD-0437?** Nothing forces it. Rent falls 10× over 5 steps, none
   of which have reached mainnet. It cuts *roll* cost 7.0× (operator-paid) and
   *quick-mint* user rent 10× (user-paid, no margin effect). Fees are denominated
   in lamports and track SOL/USD, not rent — so locking now and revisiting after
   the rollout is safe, just conservative. Re-run both scripts each step.
3. **Roll fees cannot be $0.20.** Break-even is $3.43 / $6.59 today. Either keep
   the current 85M/165M (2.5× on L1, 1.4× on Arweave — both defensible) or set
   the target margin explicitly.
4. **Fix the two basis errors** in `rolls/config.ts` (frame rent 3,511,440 →
   2,470,800) and `quick/config.ts` (drop asset rent — the user pays it), so the
   next pricing pass starts from real numbers.

## Verification notes

- Rent: mainnet rent sysvar `lamports_per_byte_year=6960, exemption_threshold=1.0`;
  all four Core shapes cross-checked against `getMinimumBalanceForRentExemption`;
  8/8 sampled live Core accounts hold exactly `(128 + data) × 6960`.
- Account sizes: header model reproduced 5/5 real mainnet Core assets byte-exact;
  plugin sizes from mpl-core's own serializer (VerifiedCreators 38 B, Royalties
  41 B, UpdateDelegate 5 B); the derived collection rent matches the repo's
  independent real-collection measurement exactly.
- Storage location: 4/4 `gateway.irys.xyz` IDs 200 on an Irys CDN and 404 on
  `arweave.net`; `arweave.net` control 200.
- Tx fees: base 5,000 lamports/signature confirmed against live Core transactions
  (observed totals decompose as `signatures × 5000` + priority).
- **Not done, by design:** no mainnet transaction, no signing, no key access. A
  real mainnet mint (Task 2b) was never needed — 2(a) cross-checks against the
  cluster's own rent answer, which is the same number a mint would have paid.
