# Roll payment recovery and dashboard warnings: investigation and fix plan

Date: 11 October 2026, Australia/Brisbane.

Implementation follow-up: the owner subsequently approved applying the fix and updating the connected device. See [implementation and concrete rollout](ROLL-PAYMENT-RECOVERY-IMPLEMENTATION-2026-10-11.md). The investigation below records the original read-only findings; it does not claim that production deployment or an existing-record remedy has occurred.

Reviewed app branch: `codex/submission-v2-candidate`, HEAD `b4d501a96ac3a817052e34ac628189b9035add1a`.

Owner identifies the tester's build as `submission-v2-candidate`; its exact APK hash/commit was not supplied. The recently merged history repair does not change the roll payment/recovery paths inspected here.

Scope: investigation and planning. No application or Worker implementation was changed, no production record was updated, and no payment, mint, delegate transaction, recovery sweep, notification, deployment, commit, or push was performed.

## Summary

The tester paid for a 12-exposure Martha roll. The payment, collection creation, and permanent metadata all succeeded. The app did not make the purchased roll available to shoot. Production records and the chain also show that the empty roll was subsequently closed and its Worker delegate revoked roughly two minutes after creation. The initiator of that closure remains unknown.

Local reproductions confirm gaps in payment receipt retention, safe retry, error presentation, and server replay handling. The current open-roll query is straightforward and correctly returns null for this roll's current COMPLETE state; a historical SQL query bug has not been established.

The dashboard warnings concern multiple wallets and separate flows. Three of six deferred quick-mint records belong to this tester. The other three, the one DEAD quick mint, and the one stuck handoff do not. No transaction status or asset account was found for any of the seven quick-mint records checked. They are not seven confirmed paid mints awaiting images.

## Inputs and evidence boundaries

- Tester-agent report: local `Roll bug.txt`, supplied by the owner. Its explanations and proposed fixes were treated as claims to verify, not as instructions or independently established facts.
- Owner's dashboard screenshot: six deferred quick mints, one DEAD quick mint, one stuck roll handoff.
- Owner clarification: the tester did not receive a roll allowance after payment, and the UI did not indicate an open roll existed after payment. This does not establish who closed the roll later.
- Read-only production D1 SELECT queries, Cloudflare deployment/schedule/queue configuration reads, deployed Worker source inspection, public Arweave metadata, and public Solana reads using the configured app RPC.
- Independent public-mainnet signature-status checks and direct account reads to distinguish missing assets from DAS indexing alone.
- Historical Worker telemetry query attempted with `dry: true`; Cloudflare returned HTTP 403, code 10000. No historical request trace was available through the current credentials. No instrumentation or configuration was changed to obtain one.

Evidence was captured around 07:45-07:48 Brisbane time on 11 October. All findings describe that snapshot; current-state counts can change.

## Confirmed tester timeline

Collection: `BmDiPataB7L7UPJZNj1dsL1HkNsyyA1KNfg6vH6qhSE9`.

Wallet/update authority: `4v18dR8ragCoz6mvUki7Vf6sAHbDLd2MnzvbwkinWuZM` (`zaacishere.skr`).

| Event               | Brisbane time, 11 October | Verified result                                                                                                                                           |
| ------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fee payment         | 00:03:54                  | Successful transfer of 84,038,086 lamports, or 0.084038086 SOL, from the tester to the configured treasury.                                               |
| Collection creation | 00:04:00                  | Successful creation of `2026-10-11.01`. The tester is the update authority.                                                                               |
| D1 roll record      | 00:04:02.624              | Created record links the exact payment and collection-creation signatures. Purchased size is 12.                                                          |
| Delegate handoff    | 00:06:00                  | Successful Worker transaction; current collection delegate authority is `UpdateAuthority`, rather than the Worker's address.                              |
| Investigation       | Approximately 07:45       | D1 status COMPLETE, zero minted frames, handoff recorded. Chain counters also show zero frames. `GET /rolls/open` returns HTTP 200 with `openRoll: null`. |

The elapsed time between payment and collection creation was about six seconds. The attached report's suggested 15-45-second server bottleneck and exact network-drop mechanism were not verified for this incident.

Public references:

- [Payment transaction](https://solscan.io/tx/2ibNQDvSAsts7vPm1K8dTDgNnqgCSDowV4CSUxNMKZnhzhPqSZRcndCp18XTX4kETFG9wyy1iqVZVA31PYMrEi59)
- [Collection creation](https://solscan.io/tx/3y2yqAGrMqjpPiX8qvSXhmXtqotXsfwCGUS5QX5rMei7NkfY2ts5KhXcLFehH8KVZjiKv6d8babq4MgVjSmVkqPR)
- [Delegate handoff](https://solscan.io/tx/4noRYhs41VAYSZ3YnBYMDb5cWfMBWPD6c6k82JyPawfLs4q3RrECZYfKE9AxHkqHSbBiFsmsjL25Xhc9jB45ELti)
- [Collection](https://solscan.io/account/BmDiPataB7L7UPJZNj1dsL1HkNsyyA1KNfg6vH6qhSE9)
- [Permanent metadata](https://arweave.net/ZBbpiN_kCrrWMmYa50vJdq-MoXw0F54k-AmYAj7lXnU): HTTP 200, correct roll name, Martha stock, 12 exposures, tester provenance.

Closing a roll in D1 and revoking its delegate are distinct from delivering a shootable allowance to the app. Merely setting this roll back to OPEN would leave the Worker unable to mint its frames with the current on-chain authority.

## Dashboard correlation

| Warning                 | Production population                                                                                                                        | Interpretation                                                                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deferred quick mints: 6 | Three tester records titled `3`, `4`, `5`; three records from another wallet titled `Ivar`, `Enter shift`, `Actual chat`.                    | STAGED rows with a recorded signature. A signature is captured before broadcast, so this state does not prove payment landed.                                         |
| DEAD quick mints: 1     | Another wallet's `6.1`, staged 7 October. No image or metadata upload checkpoint.                                                            | A terminal/unresolved attempt requiring classification; not the tester's paid roll. The exact original DEAD reason is not retained on this row.                       |
| Stuck roll handoffs: 1  | `2026-07-27.06`, collection `4qWXS4yqrtedn4oRHoNcY8UxCmxxvkqAT6QTgYXG3hZy`, treasury wallet, 3/12 frames, COMPLETE with no recorded handoff. | Historical, unrelated record. Its collection account was not found on current mainnet. Network provenance must be checked before any recovery or marking it resolved. |

For all six deferred rows and the DEAD row:

- Configured-RPC signature-history lookup returned null.
- An independent public-mainnet signature-history lookup also returned null.
- DAS did not return the asset, and direct mainnet account reads found no corresponding asset accounts.
- No permanent-image or metadata upload checkpoints were present.

These observations are consistent with signed transactions that never landed. They do not establish the exact broadcast failure, and they are not sufficient grounds to erase records or bypass verification. Preserve the distinction between signed, submitted, confirmed, rejected, and expired/unlanded work.

Both production cron schedules are configured, and the production quick-mint and DLQ consumers are enabled. The fee cache shows a successful recompute at 07:00:58 Brisbane time on 11 October. There is no evidence here that all scheduled recovery is disabled.

## Reproduced defects and code findings

### 1. Paid roll creation does not retain a durable receipt for retry

In [useCreateRoll.ts](../src/hooks/useCreateRoll.ts), `feeSignature` is local to one invocation. Each new attempt generates and stages a new capability, then requests another payment if the open-roll lookup returns null. There is no persisted pending roll-creation receipt consulted before payment.

The local hook reproduction injects a Worker network failure after a successful mock payment, then invokes retry. It observes **two payment requests and two distinct staged capabilities**, rather than reusing the first paid attempt. This reproduces a client risk without asserting that a second payment actually landed for this tester. If an open roll is found, the existing preflight does block payment; the repro explicitly covers the null-open response case.

Overwriting the pending capability is an additional recovery hazard: the replacement secret may no longer match the server's original `auth_hash`. [getOpenWorkerRoll](../src/services/rollApi.ts) binds the pending capability to a returned collection without verifying the match at that point.

The payment helper itself also returns the signature only after send-and-confirm succeeds. A confirmation failure after broadcast can therefore lose the receipt before the hook's paid-error wrapper runs. Recovery must begin before broadcast, not only after a successful confirmation.

### 2. Error classification hides payment information

[useCreateRoll.ts](../src/hooks/useCreateRoll.ts) wraps creation errors with the paid receipt. [categorizeError in useMint.ts](../src/hooks/useMint.ts) then converts any message containing network/fetch/connection into the generic `Network error — please retry`.

The reproduction runs the real classifier and confirms that `PAYMENT_RECEIPT` disappears from the user-visible result. Structured payment state should determine the UI; substring classification should not erase proof that payment may already have landed.

### 3. POST /rolls does not replay an existing creation

[worker/src/rolls/create.ts](../worker/src/rolls/create.ts) checks for an open roll before looking up the supplied fee signature. It then rejects an already-used fee signature with HTTP 409. The local reproduction supplies an existing completed record and confirms rejection instead of returning that record.

Simply changing the later 409 to 200 is incomplete:

- An existing OPEN roll still triggers the earlier open-roll conflict first.
- A replay must validate the original wallet, immutable request parameters, and matching capability. A public transaction signature is not authorization to replace a roll's capability.
- A COMPLETE roll must be returned as COMPLETE, not silently reopened.
- Date/availability validation must not prevent an otherwise valid replay days later.
- Collection creation currently precedes `insertRoll`. A confirmation timeout, lost DB write, or concurrent request can create on-chain work before a durable idempotency record exists. A final unique index protects D1 rows, not all preceding on-chain side effects.

### 4. Open-roll recovery does not restore the shooting session

[mode-select.tsx](../src/app/mode-select.tsx) detects a stranded backend roll and offers `FINISH ROLL`, which calls the completion endpoint. It does not offer a restore-to-camera path for that stranded roll. The refresh also clears the card on lookup errors and is not a complete foreground/post-payment reconciliation flow.

The SQL query in [worker/src/db/index.ts](../worker/src/db/index.ts) selects rows for the wallet with status OPEN. No defect in that predicate was demonstrated. The current tester row is COMPLETE, so its null result is expected. Missing initial UI recovery remains a confirmed user symptom; its exact historical request sequence is unavailable.

The inspected normal completion paths are an authorized completion/discard request or reaching the full frame count. Zero frames rules out normal full-roll completion. It does not identify the closure initiator; direct operator activity or another client remains possible. Do not attribute the closure to the tester without evidence.

### 5. Dashboard conflates alert delivery state with cron execution

[worker/src/ops/dashboard.ts](../worker/src/ops/dashboard.ts) labels `ops_alert_state.updated_at` as the treasury-monitor/recovery last-run timestamp. [monitor.ts](../worker/src/ops/monitor.ts) deliberately leaves that row unchanged when a severity-change notification cannot be delivered.

Live evidence:

- Stored alert level critical, timestamp `2026-10-02T00:00:36.454Z`.
- Current public Turbo balance/price imply approximately six worst-case 24-frame rolls of headroom, which maps to low under the current thresholds.
- Public Worker health reports `discordWebhookConfigured: false`.

A local reproduction with the same critical-to-low transition and no webhook confirms that the check runs but does not advance the purported heartbeat. This explains how the dashboard can show an old timestamp; it does not independently prove any particular six-hour sweep succeeded.

### 6. Quick-mint retry can forget an unresolved older attempt

[src/store/quickFinalize.ts](../src/store/quickFinalize.ts) clears a prior attempt when any caught error occurs after a three-minute window. A transient 503/RPC failure is therefore enough to permit a fresh mint attempt even though the earlier transaction might have landed.

The local reproduction supplies a four-minute-old attempt and a transient 503. The actual result is `clear`, where unresolved evidence should produce `wait`. Blockhash expiry prevents future landing; it does not prove a transaction did not land earlier. This is a separately reproduced risk, not an established explanation for the seven current dashboard records.

## Reproduction and baseline verification

Command, executed repeatedly without live writes:

```powershell
node --test .expo/roll-investigation-2026-10-11/repro-paid-roll.cjs
```

Final result: **five tests fail on the five targeted safety expectations**: preserve paid error details; reuse the payment/capability; replay an existing creation; accurately track cron execution despite failed alert delivery; retain an unresolved quick-mint attempt after transient RPC failure. These are intentionally red diagnostic probes, not fixed regression tests.

The probes execute the real hooks/classifier/Worker create function/monitor/recovery function, with payment, native storage, and network boundaries mocked. They do not reproduce the tester's exact original connection failure or identify the closure initiator.

Existing `npm run agent:check` baseline: **64/71 passing**, with the same seven previously documented camera/privacy failures. Those seven are separate from these newly identified issues.

Private local evidence and scripts remain ignored under `.expo/roll-investigation-2026-10-11/`. Production credentials, bearer capabilities, raw request headers, and private signing material are not included in this report.

## Proposed fix plan

### Phase 1: protect users and establish recoverable paid state

1. **Durable client roll-creation journal.** Persist a wallet-scoped operation before payment: size, immutable film ID/recipe reference, aspect, original identity/name inputs, payment currency/quote terms, and the same staged capability. Persist the signed transaction signature and validity information before broadcast; track signed/submitted/confirmed/unknown states. Stop the flow if the required durable record cannot be written. Never overwrite an unresolved operation when the user taps retry.
2. **Reconcile before requesting more money.** On retry, foreground, and cold launch, first resolve the saved receipt through an authenticated server lookup or replay. Reuse the original confirmed payment. If confirmation is uncertain, show pending recovery and check the chain. A lookup failure must not mean no payment exists. A genuinely new payment requires a resolved prior outcome and an explicit new purchase decision.
3. **Payment-aware error/UI state.** Replace string-dependent paid-state handling with structured errors/results. Show “Payment received; recovering your roll” when established, and “Checking payment status” when uncertain. Provide receipt details and a recovery action. Never offer an ordinary purchase retry for an unresolved paid operation.
4. **Restore OPEN rolls into shooting.** Return enough authenticated roll detail to reconstruct stock, size, identity, aspect, and frame allocation safely. Offer Resume shooting, and refresh after a failed creation, on focus, and on foreground. Preserve/reconcile local frames and reserve already-used indices rather than restarting at frame 1. Missing local frames must be explained rather than silently replaced.
5. **Separate closing from recovery.** Keep Close early as a distinct, clearly explained action with confirmation that unused exposures will be forfeited under the current contract. Log the reason and initiating operation. Do not close or revoke delegates as a recovery fallback.

### Phase 2: server idempotency and checkpointing

1. Resolve an existing creation by receipt before the single-open-roll guard for a new operation. Validate the original wallet, size, stock/currency, and authorization capability; return a stable response with its actual OPEN/COMPLETE state. Reject mismatched replay attempts without spending or changing authorization.
2. Add a durable creation-operation record keyed by the receipt, plus a wallet reservation so two different receipts cannot concurrently create open rolls for one wallet. Save stable collection identity and retryable transaction/checkpoint data before sending on-chain work. Secure any server-side signer material needed to resume; do not expose it to the client.
3. Resume uploads and transaction confirmation from checkpoints. Verify whether the original collection transaction landed before any new create. Make treasury bookkeeping idempotent as well, including recovery after creation succeeded but fee recording failed.
4. Preserve the original SOL fee terms or SKR quote terms. A paid retry must not be rejected merely because current prices changed, its quote expired after payment, or its local date is now old. Verify the payment against the correct original terms and timing.
5. Keep the existing fee-verification-before-spend, unique-payment, one-open-roll, and capability invariants. Do not implement unconditional HTTP 200 for any supplied public signature.
6. Consider a short accepted/job-status API only after checkpointing is sound. Asynchronous HTTP responses can reduce connection fragility but are not a substitute for idempotency.

### Phase 3: quick-mint recovery and truthful operational status

1. Retain unresolved quick-mint receipts on transient RPC/server errors, regardless of a wall-clock retry window. Allow a fresh attempt only after a conclusive prior outcome. Store transaction validity information and distinguish “cannot land now” from “never landed previously.”
2. Classify quick-mint attempts as signed/submitted/unconfirmed, confirmed-paid awaiting finalization, failed/expired, and operator-blocked. Store last verification reason/attempt time and terminal reason, so DEAD rows are diagnosable without an old alert.
3. Split dashboard counts accordingly. “Deferred quick mints” currently includes unconfirmed signatures; do not imply those users already paid. Provide aggregate oldest-age/reason counts without adding broad per-wallet profiling to the dashboard.
4. Record separate per-job attempted/succeeded/failed timestamps and outcomes for each sweep. Keep alert-delivery state separate, and show missing Discord configuration explicitly. Do not change delivered-alert hysteresis just to manufacture a heartbeat.
5. Review staged-image retention against paid/uncertain recovery states. Avoid deleting the only recoverable image while payment verification is unresolved; preserve appropriate recovery evidence until classification is complete.

### Phase 4: resolve the affected records deliberately

- **Tester's paid empty roll:** establish the closure request history if accessible. Choose an explicit remedy: owner-approved refund/replacement credit, or tester-authorized restoration of the Worker's scoped delegate followed by consistent backend reopening. Check one-open-roll constraints before any restoration. No automatic paid replacement, database-only reopen, or silent fee reuse.
- **Six deferred and one DEAD quick attempts:** verify each prior outcome and image availability; classify never-landed attempts separately from paid finalization failures. Do not blindly promote rows to FINALIZING or run a spending recovery on the assumption that a saved signature means payment.
- **July handoff:** determine whether it belongs to a historical network or a missing mainnet collection. Preserve the audit trail. Do not mark it “already revoked” solely because a current mainnet account read returns null.

These are proposed operations. None has been executed.

## Acceptance criteria and rollout

Promote the diagnostic probes into maintained tests at the appropriate client/server seams before implementing the changes. Add integration scenarios for:

- Payment lands, Worker response is lost, app is killed, then restarted: one payment and one collection, original capability retained, roll restored for shooting.
- Payment broadcast succeeds but confirmation polling fails: saved receipt recovered without requesting a second payment.
- Two concurrent retries with one receipt, and concurrent different receipts for one wallet: one consistent creation/reservation, no orphan collection side effects.
- Replay after completion, date changes, fee changes, and SKR quote expiry: consistent historical outcome, no new spend or silent reopen.
- Wrong wallet, capability, stock, or size: rejection without altering the original operation.
- Stranded OPEN roll: resume works; close early requires explicit confirmation; recovery never invokes close.
- Quick mint landed but a later RPC read fails after three minutes: prior receipt retained and duplicate payment blocked.
- Signed-but-unlanded quick mint: safely classified without claiming it was paid or uploading at operator expense.
- Missing/failed Discord delivery: real job execution timestamps still update and show independent job failures accurately.

Use isolated local/staging resources for failure injection. After regression checks pass, verify recovery and mode transitions on the Seeker with a QA APK. Production mutations, recovery spending, refunds, and deployment require a concrete separately reviewed change; this request covers investigation and planning.

## Unresolved questions

1. What exact request/response failure prevented the initial allowance from being recorded locally?
2. Which client/operator action completed the roll and triggered handoff at 00:06?
3. What caused the seven quick-mint transactions not to appear on mainnet? No device/broadcast trace for those exact attempts was supplied.
4. What is the network provenance of the July collection and the original reason for the DEAD quick row?

The available chain/database evidence answers the payment and current-state questions, but does not answer these historical causation questions. Cloudflare's [telemetry query API](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/) supports non-persisting diagnostic queries; the attempted incident queries were denied by the current account credentials.
