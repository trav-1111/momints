# Paid roll recovery implementation and rollout — 11 October 2026

## Scope

This implements the fix approved after the [incident investigation](ROLL-PAYMENT-RECOVERY-INVESTIGATION-2026-10-11.md). Client, Worker, migrations and dashboard changes are prepared locally on `codex/submission-v2-candidate`. Production deployment, existing-record remedies and paid hardware transactions remain separate operations. The owner also requested an updated V2 QA APK on the connected Seeker. Final verification and artifact evidence belong in the handover ledger.

Device update completed: client source `73b06658116b53cae160686c4ed8bed7749365cf`, APK SHA-256 `346aaa2cf3c0f3ad64dc6792fb7e3a282c43d7c67736d464173f86ea645a91b8`, installed in place on `SM02G406193022`. Signing identity and device APK hash verified; cold history launch succeeded in 632 ms, retained wallet connection and displayed 92 moments including `L`. Two final Worker-only edge cases were added afterward (atomic open-roll reservation and stale unpaid display dates); client source is unchanged. All 35 recovery regressions pass.

Production rollout was explicitly authorized and completed on **11 October 2026**, verified at **10:09 Brisbane**. Worker source `02fa7445ea00d32840a7994a1b952f83676604c2` is active as version `016c1c21-7eb7-4938-9890-dab6c86047bd`; migrations 0011–0012 are applied. Dashboard production deployment is `b5514261-fa9b-4e14-a883-39e62ad4a34e`, and its served JavaScript hash matches the reviewed file. Public health, an unsigned SOL quote, funding sufficiency, protected dashboard authentication/CORS, queue consumers/delivery and both cron schedules pass live checks. All existing plain-text variables and secret binding names, R2 lifecycle rules, catalogue and 11 immutable asset hashes are preserved. The tester's COMPLETE 0/12 roll and its handoff signature are unchanged. No payment or paid recovery was manually triggered. The installed QA APK is ready for owner-driven roll testing.

## Changed behavior

- The client durably saves the original wallet, film, exposure count, aspect, capability and immutable quote before signing. It saves and verifies the signed receipt before broadcasting. Concurrent taps share one operation; restart/retry uses the same receipt rather than charging again.
- The Worker authenticates receipt replay before current open-roll, date or fee checks. It reserves a verified payment, persists upload and signed-transaction checkpoints, and derives one collection address per receipt. Lost confirmations resume that collection. Wallet reservations and fenced leases prevent concurrent creation side effects. The reservation atomically checks for an already committed OPEN roll, including one created during fee verification. Treasury bookkeeping is idempotent. Stale display dates from an unpaid purchase resumed days later fall back to the verified payment day.
- Server quotes pin SOL/SKR pricing. Verification compares quote validity with the landed transaction's block time, allowing a timely payment to recover after expiry. A pending verified creation blocks another payable quote.
- An empty OPEN roll can resume with its original settings. Existing local photos remain intact. Remote pending or minted frames require the original device vault; the app never fabricates photos or reuses frame one. Session creation includes the collection address in the same persisted state change.
- Recovery is separate from early closure. Closure warns that unused exposures are forfeited and records reason, time and actor category. COMPLETE rolls are never silently reopened.
- Quick receipts survive transient HTTP failures and elapsed time. A replacement payment requires finalized chain evidence that the earlier attempt did not land. Server evidence distinguishes UNKNOWN, CONFIRMED and REJECTED; old unknown attempts get a review flag while bounded reconciliation continues.
- Verified-paid quick images are copied and checked before their D1 pointer changes to `quick-recovery/`. Unverified signatures cannot purchase unlimited retention/uploads. Missing bytes are not retroactively restored.
- Scheduled jobs record independent attempt/success/failure state. The dashboard separates execution, missing Discord configuration and delivered-alert hysteresis, and calls saved signatures attempts rather than confirmed payments.

## Verification and limitations

Maintained tests cover journal durability, concurrency, lost confirmation, authenticated replay, original settings, remote frame reservations, closure audits, real SQLite migrations/queries, real Umi signer and transaction serialization, finalized absence evidence, retention-copy ordering and independent job health. Network, payment and native boundaries are mocked; these tests do not spend funds.

The existing six camera-readiness assertions and one privacy status-copy assertion remain baseline failures. See [the earlier camera context](CAMERA-READINESS-FINDINGS-2026-10-10.md). A build/install is not proof of a successful paid hardware mint.

- A killed signing request without a durably saved signature stays blocked pending wallet/operator resolution. A corrupt or inaccessible journal fails closed.
- Older APKs cannot reconstruct a lost journal/capability automatically. Legacy OPEN rolls can still use existing wallet authorization; nonempty rolls require the original local vault.
- Only verified-paid images receive the retention prefix. Unverified attempts need timely review before staging expiry.
- Creation addresses depend on the existing Worker identity. Do not rotate its funding/signing key with pending creation checkpoints; restore the original key if recovery detects a mismatch.

## Concrete production rollout

1. Freeze and record the source commit and existing active Worker version/D1 recovery bookmark. Build the same `com.momints.v2qa` package with its existing trusted certificate.
2. R2 preflight verified that `expire-staging` deletes only `quick-staging/` after 86400 seconds; `quick-recovery/` is excluded. No lifecycle change is required. Preserve unrelated rules.
3. Pause queue delivery and deploy the existing maintenance configuration with `--keep-vars`. **Absent triggers/consumers in the config do not remove existing ones:** explicitly clear cron schedules and detach the two existing consumers, then verify the maintenance runtime. Allow existing requests to drain; avoid mixing the old non-journal Worker with new creation requests. Preserve the queues and their messages.
4. Apply additive D1 migrations **0011_roll_purchase_recovery.sql** and **0012_quick_recovery_evidence.sql** to `momints-rolls`. Historical recovery fields remain null/UNKNOWN. Migration 0011 keys the first existing treasury entry per receipt while preserving duplicate historical audit entries.
5. Deploy the frozen Worker to the existing `momints-roll-worker-staging` / `api.momints.xyz` in maintenance; check schema, guards and immutable catalogue assets. Preserve live plain-text settings using `--keep-vars`, particularly `DASHBOARD_ORIGIN=https://dash.momints.xyz`, which is absent from the checked-in configs. No secret/treasury identity changes are needed. The local filmstock validator has a separate baseline Amber runtime LUT immutable-lock mismatch. Read-only verification confirmed the unchanged bundled catalogue matches production and all 11 deployed immutable assets match their lock. A reviewed code-only deployment can preserve those assets without uploading local LUTs or changing the lock.
6. Activate the existing production configuration and its queues/schedules. Verify public readiness, fees/catalogue and the quote route without payment. Check authenticated dashboard response without Discord test alerts. Publish dashboard static changes through its reviewed workflow.
7. Update QA on Seeker `SM02G406193022` in place, preserving data, then verify cold launch and retained local state. Owner-driven payment/interruption testing remains necessary.

Activation is complete and `/rolls/quote` returns a valid pinned quote. The pre-deployment D1 Time Travel bookmark and private rollout receipts remain under ignored `.expo/roll-investigation-2026-10-11/`. Independent job heartbeat rows are initially empty and will populate on the next scheduled runs; live schema verification is not a claim that a post-deployment cron has already executed.

After creation checkpoints exist, prefer maintenance/reconciliation and a forward fix to rolling back to the old non-journal Worker. Do not delete the additive schema or evidence as a rollback shortcut.

## Existing incident remedies are separate

The tester's closed 0/12 roll no longer has the Worker delegate. It needs an explicitly authorized refund/credit, or wallet-approved delegate restoration plus consistent reopening. A database-only reopen cannot restore allowance. Deployment does not authorize refunds, transfers, replacement mints, existing receipt promotion or delegate regrants.

The six deferred attempts, one DEAD row and July handoff retain their audit trails. Original response/UI failure, closure initiator, missing-mainnet transaction causes and historical network provenance remain unproven.
