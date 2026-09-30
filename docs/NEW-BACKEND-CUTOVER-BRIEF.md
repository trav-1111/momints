# Codex brief — prepare the new Momints production backend

Prepared: 30 September 2026. Status: execution brief only; no cutover performed by writing this document.

## Outcome and owner decisions

Promote the tested Worker setup to the production API at `https://api.momints.xyz`, preserving existing production records, storage, signing authority and treasury. The owner is the only tester and reports no open rolls or unfinished mints. A maintenance window is acceptable; verify the reported empty workload before switching.

Reuse the existing production credentials. The owner will enter the secret values personally after preparation is complete. Do not generate replacement wallets or rotate keys. Complete all independent setup and verification first, then hand back the exact target Worker and [owner secrets instructions](NEW-BACKEND-SECRETS-GUIDE.md). Activation follows credential entry and verification.

This brief supersedes the original staging brief's requirements to keep production running and maintain distinct staging financial identities. It authorizes the preparation, reversible retirement and configuration work described here when the owner gives this brief to the executing Codex chat. It does not authorize payments, mints, permanent uploads, Discord notifications, destructive data cleanup, commits, pushes or merges.

## Starting point

- Workspace: `D:/Claude/momints`. Read applicable repository instructions and preserve all unrelated/uncommitted work.
- Tested Worker: `momints-roll-worker-staging`, currently at `staging-api.momints.xyz`; reported version `70c85bf1-d388-4682-bee9-124a20e3b98d`, deployment `f8b5762e-0766-49c7-84b0-336518cda5bf`, 65/65 no-funds deployed checks passed.
- Old production Worker: `momints-roll-worker`, existing hostname on `traviskeir.dev`; reported version `12492e33-86e3-4f47-acf2-9bd3fad17761`. Discover the actual routes rather than guessing the hostname.
- Read `STAGING-WORKER-RUNBOOK.md`, `STAGING-WORKER-TEST-REPORT-2026-09-30.md`, `ROLL-FRAME-PRODUCTION-CHECKLIST.md`, both Wrangler configurations and deployment scripts. Reconfirm live state; these identifiers are historical evidence, not a substitute for inspection.
- Keep image policy, pricing and quality ladder unchanged: 3 MiB hard image limit, 2,900,000-byte target, existing geometry limits, quality 60 accepted only as the emergency floor. Memory-envelope acceptance, paid roll verification and repository-wide Prettier cleanup remain separate.

## Intended resource layout

Prefer promoting the existing `momints-roll-worker-staging` service in place; its internal name can remain despite serving production. Avoid creating a third service just to remove the name suffix. Set `DEPLOYMENT_ENV=production`; the label is descriptive and is not a maintenance control.

Use an explicit authoritative production configuration for this promoted service. Keep an inactive, reproducible old-service configuration for rollback. Update default deployment commands and target guards so routine deployment cannot revive the retired Worker or rebind the promoted Worker to disposable staging resources.

| Item                           | Intended production value                                                     |
| ------------------------------ | ----------------------------------------------------------------------------- |
| Public API                     | `https://api.momints.xyz`                                                     |
| D1                             | Existing `momints-rolls`, ID `c4897487-5eef-4569-87a4-14306d4eac72`           |
| Quick image bucket             | Existing `momints-quick-staging` (the name describes temporary image storage) |
| Filmstock bucket               | Existing `momints-filmstocks`                                                 |
| Finalize queue                 | Existing `momints-quick-finalize`                                             |
| Dead-letter queue              | Existing `momints-quick-finalize-dlq`                                         |
| Treasury                       | Existing `o4w1THGTu1ufcRUEpVn45zttpcPoQBFFSLtMYeu5HpW`                        |
| Signing wallet / Turbo account | Existing production identity, owner-supplied secret                           |
| Placeholder metadata           | Existing configured permanent URI; no new upload                              |

Reconfirm each resource before binding. Preserve production rate-limit bindings where practical. Retain disposable staging resources, detached from the promoted service, for now; do not delete them or import synthetic staging records into production.

Preserving D1 matters even with no unfinished work: used payment signatures are recorded there. An empty replacement database could accept an old payment again. Sharing credentials with two independently writable payment databases is not the intended design.

## Phase 1 — inspect, prepare and validate locally

1. Inspect Cloudflare account, domains, Workers, version/route/secret-name metadata, resource bindings, schedules, queue consumers and any automatic deployment jobs. Never print secret values or full credential-bearing RPC URLs.
2. Inventory open rolls, pending/retry Quick jobs, unfinished handoffs, both queue backlogs including DLQ/in-flight work, and relevant local Seeker recovery state if the device is available. If unexpected paid work exists, preserve it and resolve its handling before cutover; do not purge it to satisfy the empty-state assumption.
3. Prepare a private, ignored production D1 export plus current bindings, deployment IDs and rollback steps. Verify the export is usable without displaying private row contents. Keep existing R2 objects and lifecycle policies intact.
4. Prepare a maintenance mode or equivalent control that blocks all mint/payment-processing mutations and spending operations on the new service even after valid secrets are entered. Keep read-only health available. Queue and scheduled handlers must not spend during preparation. Do not acknowledge/drop paid messages to simulate a pause; detach/pause delivery appropriately. Test the control with mocked providers, including secrets-present cases.
5. Prepare additive migration and deployment steps using repository-local Wrangler. Verify which migrations are actually pending; expect production to need 0009 and 0010, but do not assume. Retain v1 recovery semantics and existing receipts/payment records.
6. Update deployment, catalogue and secret tooling to reflect promotion. The existing staging secret helper rejects the production signer and can restore the old staging identity; prevent it from targeting the promoted service. Similarly, prevent the synthetic staging test suite from seeding/cleaning the production database after rebinding. Keep an explicit safe target if those tools remain useful.
7. Prepare the app configuration with `EXPO_PUBLIC_ROLL_API=https://api.momints.xyz` and the matching existing treasury. Keep private Worker secrets out of all `EXPO_PUBLIC_*` values. Identify any build, cached catalogue URL, dashboard or local operator-tool changes needed; preserve local photos/vault data.
8. Run relevant Worker typecheck, contract, catalogue/package, tooling and migration-upgrade checks, plus production-target dry-run bundle validation. Add focused tests for maintenance and target guards. Check changed deliverable formatting only; do not mix in a repository-wide formatting rewrite.

## Phase 2 — perform the reversible preparation cutover

Proceed once the empty-workload check and local checks pass. Do not ask again merely because old instructions prohibited touching production; this brief replaces that restriction for the described migration.

1. Put the old Worker into a reversible maintenance-only state. Disable old cron triggers and detach its queue consumers. Cover custom routes, workers.dev, preview/version endpoints and other execution paths that could still invoke the old funded code. Check for in-flight activity and propagation before allowing any new paid processing. Preserve old code/configuration and credential recovery options; deleting its key alone is not the shutdown mechanism.
2. With writers stopped, take/confirm a consistent final database backup and recheck zero pending work. Apply only the required additive migrations to the existing production D1 database. Preserve all historical payment and asset records.
3. Deploy the tested code to the promoted service with production bindings and maintenance enabled. Remove its attachment to disposable staging queues. Keep all consumers and schedules disabled at this handoff; describe their intended activation configuration explicitly.
4. Assign the custom domain `api.momints.xyz`, checking for conflicting records first and leaving the apex website alone. Remove the staging hostname from the promoted production service, or explicitly restrict it to maintenance; do not leave a misleading public staging endpoint that spends production funds. Record what happens to the old API hostname.
5. Confirm the configured treasury, public origin, storage provider (Turbo), placeholder, database and buckets. Do not use test Pinata storage. Verify immutable catalogue assets without overwriting different bytes at an existing key.
6. The owner will replace the promoted Worker's existing staging signing secret and operator token. Do not ask for values in chat, copy them automatically, or generate new ones. Existing staging secrets may still be present at handoff; identify this accurately. Maintenance must remain effective regardless of which keys are present.
7. Verify DNS/HTTPS, read-only health, maintenance behavior, actual resource bindings, absence of old/new background execution and preserved payment records. Run only production-safe checks; do not run the destructive/synthetic staging suite against rebound resources. Clearly distinguish checks awaiting the real signer from checks already passed.

## Required handoff before owner enters secrets

Produce `docs/NEW-BACKEND-CUTOVER-REPORT.md` and update the runbook, production checklist and owner guide with actual results:

- Exact Cloudflare account, target Worker name, dashboard link, production URL, configuration path, deployed version and deployment ID.
- Old-service retirement evidence, remaining routes, consumers and schedules; new-service maintenance evidence with all activation steps identified.
- Preserved D1/storage IDs, applied migrations, backup location, record-preservation checks and rollback instructions. Backups and private evidence stay ignored.
- Exact secret names to add/replace and which are already correct, without revealing values. Record the expected public production signer address from trusted existing configuration/state so it can be compared after entry.
- Updated app configuration/build instructions and device DNS result if checked. Do not claim an old installed APK now points at the new API.
- A clear statement: **Prepared, paused, awaiting owner secrets; end-to-end minting not yet verified.**

Finish all setup that does not depend on owner-entered values. Stop only at that real dependency. Never label maintenance health as proof of funded mint readiness.

## Phase 3 — after the owner confirms secrets are entered

1. Re-read deployed metadata because saving secrets can create a deployment. Check names and authenticated read-only behavior without exposing values. Derive/compare the public signer against the original production identity; confirm mainnet RPC, existing treasury, SOL balance and Turbo credit balance. Reuse existing funding; do not top up automatically. Verify `/funding/status`, `/treasury/status` and operator routes reject unauthenticated callers.
2. Recompute/verify fees through the existing pricing mechanism while paid mutations remain blocked. Verify catalogue integrity/origin, capability and legacy recovery behavior through safe checks and local tests. Do not replay a valid historical payment against a live mint endpoint as a test.
3. Confirm the old service still cannot process paid work. Enable one consumer per production queue and one intended set of schedules on the new Worker, then remove maintenance when readiness checks pass. Preserve Discord notification silence until the owner separately asks to enable alerts.
4. Rebuild/configure the app for the new API and verify connectivity on Seeker. Report ready for owner-led real Quick and prepaid 12/24-frame tests; do not initiate those paid tests automatically. Permanent Arweave hashes, completion/handoff recovery and encrypted-vault deletion still require that evidence.
5. Record final deployment state and remaining gates. Do not claim completion of paid verification based on synthetic checks.

## Rollback

Pause the new service and its background execution before restoring the old service. Keep the same production database/payment history, including any new writes. Do not restore an old snapshot over later paid records. Verify old-code compatibility with additive migrations; if rollback would break newly created protocol records, keep maintenance and fix forward instead. Restore only one authoritative set of consumers/schedules. Do not erase resources or rotate credentials as a rollback shortcut.
