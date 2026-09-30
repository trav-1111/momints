# Codex brief — build and verify the isolated Momints staging Worker

Prepared: 30 September 2026.

**Execution successor:** [New backend cutover brief](NEW-BACKEND-CUTOVER-BRIEF.md). The owner has clarified that they are the only tester with no open rolls or unfinished mints; the next task prepares a single-service production cutover and pauses for their manual secret entry. The staging build below is historical context.

## Subsequent owner decision — reuse production credentials

The staging build described below is complete. The owner subsequently requested reuse of the existing production credentials rather than managing new API keys and wallets. This supersedes this brief's earlier requirement for a distinct staging signer and treasury. It does not authorize payments, minting, production cutover or changes to existing production data by itself.

The credential switch has **not** been applied. The deployed staging Worker still uses its dedicated signer, treasury and operator token. The existing RPC credential is already reused by staging's configuration helper.

Before enabling shared payment credentials for end-to-end testing, address the payment replay boundary: `rolls/verify.ts` verifies the payer, recipient and amount, while `rolls/create.ts` checks payment-signature reuse only in its own D1 database. Two public Workers with the same treasury and independent databases could accept the same qualifying SOL payment separately. Unique indexes in each database do not prevent this. Assess Quick and SKR payment paths too; do not assume their environment separation is sufficient.

Two viable rollout designs must be considered before applying the credential change:

1. Keep both services capable of paid operations only after implementing and testing effective cross-environment payment-claim protection. Protection must cover both services, including the currently deployed older Worker; adding a field or memo checked only by staging is insufficient if production still accepts the same transaction.
2. Reuse the production credential set during a controlled cutover to the tested new Worker, preserve the production payment ledger and other production state, and stop new paid operations on the old service. Maintain a deliberate path for already-paid pending work, with a single authoritative consumer/scheduler configuration.

Cloudflare staging data/storage/queues should remain separate during the current testing phase. Shared signer credentials also share its SOL funding, Turbo credit balance and on-chain authority; the environment must no longer be described as financially isolated after that switch. Reusing credentials does not require rotating or replacing the production set.

Coordinate any approved change across the secret configuration helper (which currently rejects the production signer), the Worker treasury value, the staging app treasury value and operator test tooling. Never print secret values. Leave Discord notifications disabled unless separately requested. Record actual deployed identity state and reverify it after any change.

The remainder of this document is the original staging-build brief and its historical constraints; use this addendum for the latest credential preference and unresolved migration prerequisite.

## Objective

Provision, deploy and operationally test the current Momints Worker changes in an isolated staging environment at **`staging-api.momints.xyz`**. Use the same application code as production with explicit staging configuration. Preserve the existing service on `traviskeir.dev` throughout this task.

The intended later production home is **`api.momints.xyz`**, leaving `momints.xyz` for the website. This task prepares and verifies staging; it does not move production. After fixes and rollout checks are complete, the owner will test real prepaid 12- and 24-frame rolls separately.

## Settled decisions

- The owner has accepted **JPEG quality 60 as the emergency floor for now**, following the recorded 58-pair / 116-output Seeker comparison. Do not rerun that comparison or change the shipping ladder as part of this task.
- Retain the **3 MiB hard image ceiling**, **2,900,000-byte encoding target**, existing geometry limits and pricing model. Newly created rolls do not receive the 8 MiB legacy allowance.
- The proposed Seeker peak-memory envelope still needs separate acceptance. Staging work does not grant that acceptance.
- Keep repository-wide formatting cleanup and submission-repository cleanup separate.

## Starting context and scope

- Workspace: `D:/Claude/momints`. Read applicable repository instructions, inspect the current branch and preserve all existing uncommitted work. Do not reset, discard, commit, push or merge it automatically.
- Production configuration is `worker/wrangler.toml`; current Worker name is `momints-roll-worker`. It binds the production D1 database, filmstock and Quick staging buckets, finalize/dead-letter queues, rate limits and scheduled jobs.
- Cloudflare login was successfully checked on 30 September using the installed Wrangler CLI. Recheck the current account and permissions; do not assume access to the `momints.xyz` zone or to every required service.
- Use the locally installed Wrangler through Node (`worker/node_modules/wrangler/bin/wrangler.js`) rather than installing a different version. A global npm launcher was broken during an earlier session; prefer working local tools.
- No staging resources or domain routes were created by preparation of this brief.

The update includes roll bearer authorization and legacy recovery, JPEG validation and stored image receipts, Quick Shot validation, retry/completion handling, two new migrations (`0009_roll_frame_contract.sql`, `0010_quick_image_artifact.sql`) and two added rate-limit bindings. Inspect the actual diff; this list is not a substitute for reading it.

## 1. Inspect and configure isolation

Inventory the account, `momints.xyz` zone, existing Worker names, DNS/custom-domain assignments, databases, buckets and queues. Reuse only resources demonstrably dedicated to this task. Do not overwrite an existing unrelated hostname or repurpose production data.

Use a named staging environment or dedicated staging configuration with explicit resource bindings. Suggested names:

| Resource | Staging name |
| --- | --- |
| Worker | `momints-roll-worker-staging` |
| Hostname | `staging-api.momints.xyz` |
| D1 database | `momints-rolls-staging` |
| Quick image bucket | `momints-quick-staging-test` |
| Filmstock bucket | `momints-filmstocks-staging` |
| Finalize queue | `momints-quick-finalize-staging` |
| Dead-letter queue | `momints-quick-finalize-staging-dlq` |

Confirm availability before creation. The current consumer recognizes dead-letter queues by the `-dlq` suffix; preserve that convention. Assign separate rate-limit namespaces and ensure every required binding is present. Disable automatic scheduled jobs in staging initially and document how manual checks exercise the relevant logic.

Use a separate staging signing identity, staging treasury address and operator token. Never copy the production funding key or production Discord webhook into staging. Store secret values only in appropriate secret storage or explicitly ignored local files, never in tool output, tracked configuration or reports. A dedicated test identity must not be funded in this task. Read-only mainnet RPC access is acceptable with authorized provider credentials; do not introduce a fake production credential or bypass environment validation to make a check pass.

Keep staging on the app's existing mainnet assumptions; do not turn this deployment task into a devnet rewrite. Separate Cloudflare resources do not isolate the blockchain or Turbo account: the separate signer and the prohibition on paid operations are necessary too. Do not send Discord messages or other external notifications during tests.

## 2. Provision and deploy

- Create the staging database, storage buckets and queues. Configure the Quick staging bucket's expiration policy and separate credentials/bindings.
- Apply the full migration chain to the new database. Also test the upgrade from the pre-change schema through migrations 0009 and 0010 with synthetic legacy rows. Verify default/null fields and recovery compatibility, without copying private production records.
- Validate filmstock packages locally, then populate only the staging filmstock bucket with the existing immutable assets. Confirm hashes and never replace different bytes at an immutable key.
- **Deployment-script trap:** `worker/scripts/deploy-filmstocks.mjs` currently hardcodes the production filmstock bucket and invokes an unqualified `wrangler deploy`. Do not run it unchanged for staging. Provide an explicitly staging-aware, guarded deployment path or narrowly extend it to accept validated environment/configuration selection while preserving the production default behaviour.
- Run Worker typecheck, relevant contract/package tests, catalogue validation and a build check before deployment. Add focused tests for substantive staging tooling or functional fixes introduced here.
- Deploy to the staging Worker and attach the custom domain after checking the zone and hostname. Verify HTTPS and inspect the resolved deployed bindings, queue consumers and schedules against the intended staging resource IDs.
- Keep the app's normal `.env` and production endpoint unchanged. Provide a clearly separate staging app configuration for later testing, including the matching treasury address.

If domain access or required credentials are unavailable, complete the local configuration, scripts and checks that remain possible, report the exact missing item, and request only that input. Never silently deploy to a different account or claim a `workers.dev` URL satisfies the custom-domain requirement.

## 3. Exercise deployed endpoints without spending funds

Use synthetic fixtures in staging only. Record expected/actual responses and compare database, bucket and queue state before and after negative tests. Test valid read paths as well as rejection paths; an endpoint that always fails is not evidence of correct authorization.

- Health, database reachability, public fee responses, filmstock catalogue, recipes, LUT hashes and preview assets. Confirm catalogue URLs use the staging origin.
- Operator routes: missing/wrong tokens rejected, valid tokens accepted on appropriate read-only routes, and dashboard origin/CORS behaviour verified. Audit all operational routes, including `/funding/status` and `/treasury/status`; do not assume their comments mean they are authenticated. Document intentional public information or fix unintended exposure with focused tests.
- Roll reads, frame submissions, legacy authorization and completion: missing, malformed, wrong-roll and wrong-wallet authorization rejected as applicable; expired wallet-signed recovery requests rejected. Seed only the required isolated records and verify permitted read/recovery paths without invoking real handoff or mint operations.
- New-roll and legacy image limits, exact byte boundaries, malformed/truncated/MIME-spoofed JPEGs and excessive dimensions. Invalid images must be rejected before any permanent upload or mint. Use synthetic data, not the private canonical corpus.
- Quick staging validation and receipts, release/cleanup and rejected finalize requests without payment. Valid staging uploads may use the staging R2 bucket; do not finalize a paid mint or upload to Arweave.
- Rate limits produce controlled responses and do not spend storage credits or send transactions. Avoid tests that lock unrelated clients out.
- Exercise safe manual operational checks against the empty/synthetic staging state. Leave production-like successful paid finalization, Arweave verification and on-chain completion for the later paid-roll tests. Do not weaken payment checks or install shipping bypasses to simulate success.

Test retry/completion side effects through local test seams where exercising the deployed success path would spend funds. State clearly which behaviours were tested locally, deployed without payment, or remain unverified. Keep notifications disabled even when a route can trigger them.

## 4. Cleanup, evidence and handoff

Remove only this run's identified synthetic database rows, R2 objects and queue fixtures; preserve configured staging resources for continued use. Confirm no test jobs remain, no production resources were mutated, and no mainnet transaction or permanent-storage upload was initiated.

Deliver:

- A working HTTPS staging URL, actual Worker version/deployment ID, and a non-secret inventory of dedicated resources and binding IDs.
- Reproducible configuration, migration/deployment commands and operational test tooling, with explicit environment safeguards.
- A concise endpoint test report, including failures/fixes, side-effect checks and remaining paid-test limitations.
- A staging runbook and an update to `docs/ROLL-FRAME-PRODUCTION-CHECKLIST.md`. Record quality approval consistently in `docs/HACKATHON-PRESENTATION-NOTES.md` if any older text still describes it as pending.
- A later production-cutover plan: preserve existing production data and signing authority, coordinate app/auth compatibility, migrate or rebind resources deliberately, avoid duplicate scheduled jobs/queue consumption, and account for old endpoint clients and pending mints. Do not promote disposable staging records or its test signer into production.

**Stop after staging is built and verified. Do not switch production DNS, migrate production data, fund staging, run paid rolls, or retire the existing Worker in this task.** Report any user action needed to proceed, with concrete evidence rather than a generic approval checklist.

## References

- [Production checklist](ROLL-FRAME-PRODUCTION-CHECKLIST.md)
- [Worker runbook](../worker/README.md)
- [Cloudflare environments](https://developers.cloudflare.com/workers/wrangler/environments/)
- [Cloudflare custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
