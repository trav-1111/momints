# Decouple Roll Mint Completion from Arweave Gateway Propagation Latency — 11 October 2026

**Status**: Verified on Solana Seeker hardware (`SM02G40619133790`) on mainnet. All 57 local unit tests passing. Branch staged for review and deployment.

---

## 1. Problem Statement & Root Cause Analysis

### Symptoms
When minting prepaid rolls in Momints V2, the application remained frozen on the mint progress screen for 8 to 12 minutes. Users could not exit the screen without stopping the mint session, and the camera remained locked.

### Physical Mechanics
The delay was **not an infrastructure failure or slow backend**, but a self-inflicted client-side verification trap:
1. **Solana & Arweave Finality**:
   - The Cloudflare Worker develops the photo and uploads it via Arweave Turbo bundler (`turbo.ardrive.io`). Turbo accepts the data item and cryptographically signs it in **<500ms**.
   - The Worker creates the Metaplex Core asset account (`createV1`) on Solana mainnet in **<1s**.
2. **Decentralized Gateway Indexing**:
   - Public Arweave gateways (`https://arweave.net`) are independent decentralized caching proxies. Indexing newly bundled Turbo transactions into the public gateway takes **8 to 15 minutes**.
3. **The Client Trap**:
   - In `src/hooks/useMint.ts`, the client executed `verifyPermanentImage(res.imageUri)` (an HTTP GET range request against `https://arweave.net/...`).
   - Because the gateway has not indexed the bundle yet, this request returns HTTP 404.
   - The client caught the 404 and demoted the frame from `success` to status `'confirming'` with note `'Minted · permanent image becoming available (usually 8–12 min)'`.
   - In `src/app/mint/progress.tsx`, an active `setInterval` polled `verifyPermanentImage` every 30 seconds for up to 10 minutes.
   - `handleFinish` blocked roll completion (`completeRoll()`) and local film stock unlock (`unlockLocally()`) until all frames were marked `success`.
   - `handleBack` blocked user navigation with an alert (`'Minting in Progress'`).

---

## 2. Implemented Changes

### A. Immediate On-Chain Success in `src/hooks/useMint.ts`
When `mintWorkerFrame` returns a valid Metaplex Core asset address (`res.assetAddress`) and matching image hashes:
- The permanent Arweave URI is accepted immediately (`imageUri = res.imageUri`).
- Status is recorded as `'success'` and `summary.succeeded` increments immediately.
- The client no longer pauses or demotes completed on-chain mints to `'confirming'`.

### B. Session & Camera Liberation in `src/app/mint/progress.tsx`
- **Immediate Roll Completion**: When all frames have on-chain receipts, `handleFinish` immediately invokes:
  1. `useFilmStockStore.getState().unlockLocally(wallet, roll.film.filmStockId)`
  2. `useRollRegistry.getState().closeRoll(roll.collectionAddress)`
  3. `useSessionStore.getState().completeRoll()`
- **Background Vault Discard**: `verifyAndDiscardCompletedRollVault(roll, wallet)` is dispatched as an asynchronous background operation. If Arweave is still propagating, the local encrypted vault is safely retained until startup reconciliation (`_layout.tsx`) purges it once propagation completes.
- **Unblocked Navigation**: `handleBack` recognizes completed batches (`allComplete`) and transitions directly back to the camera without displaying session-abandonment warnings.

---

## 3. Physical Hardware Verification Evidence

Tested on physical Solana Seeker DVT hardware (`SM02G40619133790`) running package `com.momints.v2qa` (Release APK `momints-hackathon-only-debug-signed-9fb6a67d-arm64.apk`).

- **Start Button Tap**: `20:54:20 AEST` (`10:54:20 UTC`)
- **Total Duration**: **2 minutes 57 seconds** (177s total for all 12 frames)
- **Average Round-Trip Per Frame**: **~14.7s** (device frame upload → worker develop & LUT → Arweave Turbo bundler → Solana mainnet consensus)

### On-Chain Transaction Timeline

| Frame | Solana Slot | Time (AEST) | Time (UTC) | Delta from Start | Solana Transaction Signature |
| :---: | :---: | :---: | :---: | :---: | :--- |
| **1** | `455625408` | `20:54:24` | `10:54:24` | **+4s** | `4nDrSVJAQ2ZnEdzV5BBtssdZHNm7sWxyEYwKPSxTG4GsSgZ9eR1tJr4MVxYzhoAk3HpSZgbA6jDcHc9kHqWcaQwS` |
| **2** | `455625540` | `20:54:53` | `10:54:53` | **+33s** | `63xHCiuA7q4264F7kjHjsQozJYTLHz8QjN68CWEJNQX76GtQsVx8Pv9A4y2PWNx64xspWvM3AYFe9eaYkRnh8J7Q` |
| **3** | `455625628` | `20:55:12` | `10:55:12` | **+52s** | `5KPTSJvHrfDYozmoD3Yruo3CEMvv24nADdSATE1vfhyfxEjwWLy1f3Mb56kqtrACzX23d1PBd6DWwETRSz4wxLk2` |
| **4** | `455625680` | `20:55:24` | `10:55:24` | **+64s** | `3nQrf5j7e4X9eshD7zecjdFSYSnBKSwoAJhsyd9sr9ZQCYycnnL1TYUdrHVa2FLME6Qw46o1EKvUSqWJBemtc8Cc` |
| **5** | `455625728` | `20:55:34` | `10:55:34` | **+74s** | `uowMsMyuswMgfczPJsqdSWEgj6VNs67jiHJSdfB7xEHdHw2cWL7nsQ4CZHatrcZTUkFuwztWP5QCC7WazTKpx4m` |
| **6** | `455625792` | `20:55:48` | `10:55:48` | **+88s** | `9nBCxSbchzrRDeVtMyTjrqVe1cEpXayiYjqKtBV5hqVxJ388UJ8VbEa7y4RWgzsMnRxLA7qZE4KGdNwFDBd6maN` |
| **7** | `455625856` | `20:56:02` | `10:56:02` | **+102s** | `3uX6R2AifLBL2qJPfyrGau2iafdMvYfZYQUnThopuNYjhC8uYNq5es2S2xBsS4v61p15Vo4gFoEm2zTvqcd7gBDi` |
| **8** | `455625885` | `20:56:09` | `10:56:09` | **+109s** | `3MSReiQx9Vj72zGaANLpMjhZX2t335w62pSC9ADpA88892R1HCdqvuPqZUQSnnwiWhjWkwytfjXSHmdNbdH9P6sQ` |
| **9** | `455625985` | `20:56:31` | `10:56:31` | **+131s** | `5T3cP4SFwy3VSGKpp5P4mxMC32bvHs51DGrtzcSaHjwLwvPdABYtxvw12L9RrdUyG6tWENhY9vt85znWSGaeeoey` |
| **10** | `455626016` | `20:56:37` | `10:56:37` | **+137s** | `3iRfuettyMhUnRp45vQiKrh8DrhBxvqFMQVW2oqJXF1uCLQFwFwS4AkyYEAPSGCNJ2ymdPNQBv9wqTGMpwuXGrVS` |
| **11** | `455626133` | `20:57:04` | `10:57:04` | **+164s** | `3aeWJJkLfnCoRVEhJohXbxPXocggwDBnvFP3b1k72Co2XjXm5jrw7aFmYx96uzewEFmW4ebbTw7TXgwDWfr2v85s` |
| **12** | `455626196` | `20:57:17` | `10:57:17` | **+177s** | `LS9stZzF3ruaBo8NKPQdRBXvxXxEVSCkFtwXjjs5cLS7pabR52LVChmiUWDW24DH3Ytaxi6vB8o6Db1KBCDqDjy` |

- **UI Transition**: Immediately upon slot confirmation of Frame 12, the screen unlocked with `"Return to Camera"` and routed cleanly into **Past Mints**.
- **Film Stock**: Successfully unlocked and ready for new roll purchase.

---

## 4. Verification & Test Suite Results

- **57/57 unit tests passing** across:
  - `tests/privacy.test.cjs`
  - `tests/roll-vault.test.cjs`
  - `tests/roll-reconciliation.test.cjs`
  - `tests/contact-sheet.test.cjs`
  - `tests/on-chain-portfolio.test.cjs`
  - `tests/burst-roll-numbering.test.cjs`
  - `tests/submission-build.test.cjs`
- **TypeScript Typecheck**: Zero diagnostics (`npx tsc --noEmit` exited `0`).
