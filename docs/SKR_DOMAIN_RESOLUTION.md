# .skr wallet-name regression

## Demonstrated cause

The affected label was the camera's top-right connected-wallet label. Diagnosis
used the supplied public wallet (shortened here as `9ybS...2zB1`), expected to
display `trav.skr`, and the locally configured mainnet RPC. No transaction was
signed or sent. No secret-bearing URLs or credentials were logged.

Before changing application code on 2026-09-11:

1. The unchanged resolver, including web3.js's normal 429 retries, resolved
   `trav.skr` in a standalone run after **10,781 ms**. It made 126 RPC requests
   (2 `getProgramAccounts`, 1 `getTokenAccountsByOwner`, 123
   `getMultipleAccounts`); 45 responses were HTTP 429. A standalone lookup
   succeeding did not establish that the camera worked.
2. Rendering the **actual CameraScreen and useMintRoll hook**, with native
   controls mocked but the existing resolver, installed SDK and RPC live,
   reproduced the failure. Both hooks independently requested the same wallet's
   domains. At failure, **221 requests and 130 HTTP 429 responses** had been
   recorded. Both lookups rejected after roughly 10.4 seconds and the camera
   still rendered `9ybS...2zB1`.
3. Installed `@onsol/tldparser@1.2.1` implements
   `getParsedAllUserDomains` by scanning all TLDs and checking the wallet's NFT
   metadata for each namespace. That unnecessary repeated work exhausts the
   configured RPC's request budget, especially with the camera's duplicate
   subscriptions. The old hook swallowed rejection as `null`; its effect only
   depended on the address, so normal rerenders never retried.
4. The SDK's targeted `getParsedAllUserDomainsFromTld(owner, 'skr')` returned
   `trav.skr` using the same RPC. `getProgramAccounts` is supported on this
   endpoint; a blanket provider restriction was **not** observed.
5. `getMainDomain` reported a missing primary-domain account for this wallet.
   The old resolver never called it, so this is **not** the regression's cause.
   Ownership resolution works without setting a primary name.

Additional component tests demonstrated that the mint form's wallet row ignored
a resolved name and always shortened the address, and that the old hook briefly
rendered wallet A's name after changing to wallet B. WalletStatus also shortened
addresses directly (it is currently exported but unused by the app's screens).
The camera menu displayed the raw address without using the name.

## History and alternatives checked

- `274aa58` (2026-05-13) introduced the AllDomains SDK and the broad lookup (the client-side path is now replaced by the Worker route).
- `0cf775b` (2026-08-07) contains the camera's additional useMintRoll subscription.
- `8079a1e` (2026-09-02, mainnet migration) changed
  `getClusterRpc('mainnet')` to `getClusterRpc()`. Both use the same mainnet
  environment variable and fallback; this is not evidence of a cluster mismatch.
- Git history shows no later tldparser, web3.js or wallet-kit dependency update
  causing this failure. The installed parser accepts both string addresses and
  PublicKey; address conversion and the SDK's returned `domain` field were valid.
- The app already has Hermes Buffer/subarray compatibility handling and Metro
  buffer deduplication. These were preserved. A device-specific runtime problem
  cannot be excluded without a device, but the current camera failure was
  independently reproduced against the live RPC.
- Historical environment values are not versioned, so the exact date or external
  condition that first made this request pattern exceed its budget is unknown.

## Fix

The client now resolves on the stable MWA account address after authorization. It logs only a shortened address and whether the optional account label exists; the label is never treated as a `.skr` identity or transaction address. A versioned cache is persisted in the device document directory. Successful results, including confirmed no-domain responses, are reused for up to 24 hours; resolver-version changes invalidate old records. Cache misses share one in-flight request and send exactly one GET to `/identity/skr`; failures, timeouts, 429s, malformed responses and RPC errors are not cached and retain the shortened address for the session.

The Worker validates the address, performs the official filtered `getProgramAccounts` reverse lookup against its Helius mainnet secret, batches reverse-name account reads, and returns `{ domain: string | null }` for success or HTTP 503 for temporary failure. It does not retry and stores no wallet history. Camera, camera menu, mint-form wallet row and WalletStatus consume the same hook state.

Names are display values. Wallet addresses remain transaction identities. Artist
prefill behavior, user-entered artist values, queued metadata, minting, payments,
fees, finalization, sweeps, backend code and dashboard metrics are unchanged. No
wallet profile, persistent activity record or analytics were added.

## Verification

- Baseline regression tests failed on the hardcoded form label and stale-name
  rendering before the fix.
- All 6 focused Worker-cache regression tests passed. Worker typecheck, app TypeScript, source/test ESLint, formatting checks and `git diff --check` passed. App TypeScript, source/test ESLint,
  formatting checks and `git diff --check` passed.
- Focused tests cover one Worker request for concurrent consumers, persistent cache reload, missing names,
  missing primary records, malformed
  responses, invalid addresses, timeouts, RPC failure/recovery, cache expiry and
  bounds, endpoint changes, disconnect/reconnect, late responses, suffix handling,
  and saved artist/metadata preservation.
- **Live read-only integration, 2026-09-12:** actual camera, form and badge
  components plus actual hook/service/SDK, with native controls mocked:
  - `trav.skr`: resolved and displayed in **1,082 ms**, one shared lookup,
    four HTTP 200 requests (1 program-account query, 1 token-account query,
    2 multiple-account queries).
  - Public-key control ending `1112`, with no `.skr` name: genuine not-found,
    correct address fallback in **976 ms**, one lookup and three HTTP 200 requests.
- **Device testing:** the authorized Seeker loaded the cache-cleared branch
  development bundle and showed the connected wallet, but remained on the shortened
  `9ybS...2zB1` label after the lookup window. Metro reported a successful bundle and
  the device produced no resolver error or result log, so this is an inconclusive
  native verification rather than a pass. The device was left unchanged; no wallet
  action or transaction occurred. The live component test above remains the reliable
  RPC verification, while Android/Hermes behavior needs a follow-up with device
  network/runtime logging.

Commands (Node 22.17+ for the test runner's mock timers):

```powershell
npm run test:wallet-domain
npx tsc --noEmit --incremental false
npx eslint src tests
```

The live check is opt-in and accepts only read RPC methods. From a normal checkout
with its configured `.env`, pass a public wallet and expected name (or `-` for
absence):

```powershell
node --env-file=.env tests/wallet-domain.live.cjs <public-wallet> <expected-name-or-dash>
```

During this task, another session switched the primary checkout to
`spike/camera-caps` and stashed this work. The fix was restored selectively into
`.claude/worktrees/skr-domain-resolution` on `fix/skr-domain-resolution`; the
stash and unrelated camera/dashboard/documentation work were preserved.

## References

- [AllDomains Solana mainnet SDK](https://docs.alldomains.id/protocol/developer-guide/ad-sdks/svm-sdks/solana-mainnet-sdk)
- [Solana Mobile server reference](https://github.com/solana-mobile/solana-mobile-skills/blob/main/skills/seeker-domains/references/server.md)
- [Solana Mobile client reference](https://github.com/solana-mobile/solana-mobile-skills/blob/main/skills/seeker-domains/references/client.md)

The references confirm owned-name reverse resolution, the suffix contract,
stable selection, RPC-error versus absence handling, and client display behavior.
They were checked alongside the installed SDK; they are not a substitute for the
live reproduction above.
