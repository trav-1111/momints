# Isolated staging Worker test report — 30 September 2026

> Historical staging evidence. The tested service was subsequently rebound to
> `api.momints.xyz` with production resources, verified and activated for
> owner-led paid testing. `staging-api.momints.xyz` is no longer attached. See
> [NEW-BACKEND-CUTOVER-REPORT.md](NEW-BACKEND-CUTOVER-REPORT.md) for current state.

## Outcome

`https://staging-api.momints.xyz` is provisioned and running the current Worker code with dedicated D1, R2, queues, rate limits, identities and custom-domain configuration. Final Worker version is `70c85bf1-d388-4682-bee9-124a20e3b98d`; deployment ID is `f8b5762e-0766-49c7-84b0-336518cda5bf`.

The final deployed suite passed **65/65** checks. Its ignored machine-readable report is `worker/.staging-evidence/2026-09-30T00-35-20.727Z/report.json`.

## Exact repository files changed

Modified:

- `.gitignore`
- `docs/HACKATHON-PRESENTATION-NOTES.md`
- `docs/ROLL-FRAME-PRODUCTION-CHECKLIST.md`
- `worker/README.md`
- `worker/package.json`
- `worker/scripts/deploy-filmstocks.mjs`
- `worker/src/env.ts`
- `worker/src/index.ts`
- `worker/wrangler.toml`

Added:

- `.env.staging.example`
- `docs/STAGING-WORKER-RUNBOOK.md`
- `docs/STAGING-WORKER-TEST-REPORT-2026-09-30.md`
- `scripts/create-worker-staging-secrets.cjs`
- `worker/scripts/configure-staging-secrets.mjs`
- `worker/scripts/lib/deploy-target.mjs`
- `worker/scripts/test-migration-upgrade.mjs`
- `worker/scripts/test-staging-deployment.mjs`
- `worker/tests/fixtures/pre-contract-legacy.sql`
- `worker/tests/staging-tooling.test.mjs`
- `worker/wrangler.staging.toml`

No file was committed, pushed or merged. Pre-existing unrelated untracked drafts were not modified.

## Fixes and tooling added

- `/funding/status` and `/treasury/status` were documented as operator routes but were publicly readable. Both now require `Authorization: Bearer <OPS_AUTH_TOKEN>`, with focused and deployed missing/wrong/valid-token tests.
- `DEPLOYMENT_ENV` is informationally exposed by `/health`, allowing staging to prove its configuration without changing application behavior.
- `worker/wrangler.staging.toml` binds only dedicated staging resources and deliberately contains no schedules.
- The filmstock deployer now has a guarded `--target staging` path. Its existing no-argument production default is preserved.
- Added focused staging configuration tests, a synthetic migration-upgrade harness, secret configuration guard, and a remote synthetic operational harness with cleanup in `finally`.
- Added a separate staging app environment example with the matching treasury address.

## Local and build verification

- Worker TypeScript: passed.
- Roll-frame contract: 10/10 passed.
- Filmstock package: 9/9 passed.
- Staging tooling: 3/3 passed.
- Synthetic schema upgrade: migrations 0001–0008, legacy seed, then 0009–0010 passed; protocol v1 and all new receipt columns retained their intended default/null values.
- Catalogue validation: four stocks and 11 immutable assets passed.
- Staging dry bundle: 4,880.54 KiB upload / 1,260.50 KiB gzip; all intended staging bindings resolved.
- Remote staging migrations: 0001–0010 applied; a final list reported no pending migrations.
- Guarded filmstock deployment: all existing keys were hash-preflighted, all catalogue/recipe/runtime/preview smoke checks passed, and a second run was idempotent.
- The authorized RPC returned Solana mainnet genesis hash `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`; secret configuration now fails closed for any other cluster.

## Deployed endpoint verification

The suite covered:

- HTTPS health, D1 reachability and explicit `deployment: staging`.
- Public fee response and four-stock catalogue, with every URL rooted at the staging origin.
- Recipe, LUT and preview hashes; stable R2 ETags and immutable one-year cache headers; catalogue edge-cache headers.
- Missing and wrong operator tokens rejected for funding, treasury, ops and dashboard routes; valid tokens accepted on read-only routes.
- Dashboard CORS allowed only `https://staging-dashboard.momints.xyz`; arbitrary origins were not reflected; authorized and 401 responses remained readable to the configured origin.
- Safe manual fee recompute and empty Quick sweep with schedules disabled. `/ops/test-alert` was intentionally not invoked.
- Filmstock unlock invalid-address rejection and a valid empty DAS-backed mainnet read.
- Protocol-v2 roll reads with missing, malformed, wrong and matching capabilities, plus an absent-roll check.
- Legacy recovery with wrong-wallet and expired requests rejected, followed by successful wallet-signed recovery and an authorized read.
- Frame requests rejected before side effects for missing authorization, one byte above new and legacy limits, truncated JPEG, non-JPEG bytes, excessive long edge and excessive pixel count.
- Exact 3 MiB protocol-v2 and exact 8 MiB protocol-v1 idempotent frame paths succeeded against pre-seeded minted checkpoints, so no storage or chain work was reached.
- Wrong-capability completion was rejected. Successful completion/handoff recovery remains covered by local seams; the fake deployed collection was deliberately not sent to RPC mutation code.
- Quick malformed and oversized images rejected; a 2,900,000-byte synthetic JPEG produced a matching Worker receipt in D1 and R2.
- Invalid unpaid finalize rejected before queue submission. Quick release removed the exact D1 row and R2 object, verified by hash before release and failed object retrieval after release; repeated release was idempotent.
- The staging Quick limiter returned a controlled 429. It was scoped to the staging caller/IP and no object was stored by the malformed rate-limit requests.

Initial and final staging state both contained zero rolls, frames, Quick mints, frame locks and treasury entries. The synthetic R2 object was removed. Queue producer/consumer configuration was unchanged and no finalize request was accepted, so no test job was created. The staging signer and treasury each had zero mainnet transaction signatures after the run. The signer remained unfunded, no Turbo/Arweave upload path ran, and Discord was unconfigured and uninvoked.

## Isolation evidence

- Production Worker `momints-roll-worker` remained on version `12492e33-86e3-4f47-acf2-9bd3fad17761`, last deployed 24 September; this task did not deploy it.
- Production D1 UUID, R2 names and queues never appeared in the staging config or test commands.
- Production filmstock assets were read only during inventory; all writes targeted `momints-filmstocks-staging`.
- The existing custom domains on `traviskeir.dev` and `vernl.xyz` were preserved.
- Staging has no automatic schedule. It has one producer/consumer on the staging finalize queue and one consumer on the staging `-dlq`.

## Deliberately unverified in this task

- Successful fee-paying roll creation.
- Successful paid Quick finalize, queue delivery/consumer retry and dead-letter behavior.
- Turbo credit spend, Arweave upload/retrieval and permanent-byte verification.
- On-chain frame mint, complete-roll delegate handoff and recovery after a real confirmation delay.
- Owner-led real prepaid 12- and 24-frame rolls.
- Acceptance of the proposed Seeker peak-memory envelope.

These require funds or production-like permanent side effects and remain separate owner-led release gates. No payment bypass or fake success mode was added.
