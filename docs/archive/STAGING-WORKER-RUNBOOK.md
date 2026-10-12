# Momints Worker promotion and operations runbook

Updated: 30 September 2026.

## Current state

The formerly isolated service `momints-roll-worker-staging` has been promoted in place to `https://api.momints.xyz`. Its internal name intentionally remains unchanged.

**Current status: active with the verified production identity; ready for owner-led paid testing.** End-to-end paid minting is not yet verified. See [the cutover report](NEW-BACKEND-CUTOVER-REPORT.md) for exact live IDs and evidence.

- Default config: `worker/wrangler.toml`.
- `DEPLOYMENT_ENV=production`.
- `MAINTENANCE_MODE=false` in `worker/wrangler.production-active.toml`; `worker/wrangler.toml` remains the safe maintenance deployment.
- Production D1/R2 and rate-limit namespaces are bound.
- One finalize producer, one finalize consumer, one dead-letter consumer and exactly the two intended schedules are attached.
- Both production queues are active and were empty at activation.
- workers.dev and preview URLs are disabled for both old and promoted Workers.
- `staging-api.momints.xyz` is removed.
- Disposable staging D1/R2/queues remain retained, empty/paused and detached.

The old Worker `momints-roll-worker` is inactive. Its prior production version and secrets remain available for rollback, but it has no public route, consumer or schedule.

## Local checks

Use repository-local tooling from `worker/`:

```powershell
npm.cmd run typecheck
npm.cmd run test:roll-contract
npm.cmd run test:filmstocks
npm.cmd run test:maintenance
npm.cmd run test:production-tooling
npm.cmd run test:staging
npm.cmd run test:migration-upgrade
npm.cmd run validate:filmstocks
node node_modules/wrangler/bin/wrangler.js --config wrangler.toml deploy --dry-run --outdir .wrangler-dry-run/production-maintenance
node node_modules/wrangler/bin/wrangler.js --config wrangler.production-active.toml deploy --dry-run --outdir .wrangler-dry-run/production-active
node node_modules/wrangler/bin/wrangler.js --config wrangler.rollback.toml deploy --dry-run --outdir .wrangler-dry-run/rollback
```

The Wrangler log warning about inability to write under `C:\Users\travi\.wrangler\logs` is a sandbox logging limitation when the command otherwise exits zero; it does not invalidate the bundle output.

## Safe paused checks

These do not create rows, store images, queue jobs, mint, upload to Arweave or send notifications:

```powershell
npm.cmd run test:production:maintenance
$env:FILMSTOCK_SMOKE_BASE_URL='https://api.momints.xyz'
node scripts/deploy-filmstocks.mjs --verify-only
```

Do not run `test-staging-deployment.mjs` against the promoted Worker. It is deliberately guarded after promotion because it seeds and cleans its bound database. `configure-staging-secrets.mjs` is also disabled so it cannot restore the disposable staging signer to production.

## Production identity

The owner replaced `IRYS_FUNDING_KEY` and `OPS_AUTH_TOKEN`. Phase 3 verified the signer, mainnet RPC, balances, treasury and protected routes before activation. [NEW-BACKEND-SECRETS-GUIDE.md](NEW-BACKEND-SECRETS-GUIDE.md) is retained as a historical credential-entry procedure; it must not be used to rotate secrets casually.

Expected production signer address:

`6cpYU6dXcioCqVdBhF93qCruSThroGPrqPVA3h57pV1V`

Retired staging signer, confirmed absent from the active configuration:

`CDWnMvHWENsJumumcZMdnP5CS3T7HiKGxMwJgogKEhBQ`

## Phase 3 verification commands

The following guarded commands reproduce the non-spending checks. They read ignored local secrets without printing them:

```powershell
npm.cmd run verify:production:identity
npm.cmd run verify:production:runtime
npm.cmd run verify:production:readiness
```

The completed checks established:

1. List secret names and the newest deployment/version. Never print values.
2. Authenticate to `/ops/dashboard/wallets` with the production token and verify the signer address exactly.
3. Verify `SOLANA_RPC_URL` returns mainnet genesis hash `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` without logging the URL.
4. Verify the configured treasury is `o4w1THGTu1ufcRUEpVn45zttpcPoQBFFSLtMYeu5HpW`.
5. Record signer SOL and Turbo credit sufficiency; do not top up.
6. Confirm unauthenticated `/funding/status`, `/treasury/status` and all `/ops/*` data routes return 401.
7. Confirm authenticated funding/treasury/dashboard reads succeed.
8. `/ops/recompute-fees` was run once with the production token while maintenance remained true; the cached fees and pricing guard passed without sending an alert.
9. Re-run the production maintenance and filmstock verify-only checks.
10. Before activation, confirm old Worker routes are disabled, both production queues are paused with zero backlog, and neither Worker has schedules/consumers.

## Activation state

Activation completed after every Phase 3 readiness check passed:

```powershell
Set-Location D:\Claude\momints\worker
npm.cmd run deploy:production:activate -- --confirm-owner-secrets-and-production-activation
```

The activation helper targets only `momints-roll-worker-staging`, `api.momints.xyz`, production resource IDs, production queues and the two intended schedules. It refuses disposable staging resources.

The active deployment is Worker version `6b168483-5cfb-4540-bcbd-b86d7f010f75`, deployment `53d17f08-060d-4b3e-ae7d-f24a67a7e0f9`. Post-deploy verification confirmed:

1. Verify version/bindings and `MAINTENANCE_MODE=false`.
2. Verify exactly one consumer on `momints-quick-finalize` and one on `momints-quick-finalize-dlq`.
3. Verify exactly `0 */3 * * *` and `0 */6 * * *` schedules.
4. Delivery was resumed only after those checks:

```powershell
node node_modules/wrangler/bin/wrangler.js queues resume-delivery momints-quick-finalize
node node_modules/wrangler/bin/wrangler.js queues resume-delivery momints-quick-finalize-dlq
```

5. Verify queue metrics again.
6. Build/restart the app with `EXPO_PUBLIC_ROLL_API=https://api.momints.xyz` and the existing treasury.
7. Seeker DNS and the refreshed in-app catalogue both resolve through `api.momints.xyz`; paid Quick and 12/24-frame testing is now handed to the owner.

Keep Discord secrets unset until the owner separately asks to restore alerts.

## Filmstock deployment

Production filmstock deployment now accepts only the exact production origin and bucket:

```powershell
$env:FILMSTOCK_SMOKE_BASE_URL='https://api.momints.xyz'
node scripts/deploy-filmstocks.mjs
```

For a non-mutating integrity check, add `--verify-only`. The former `--target staging` path is rejected because that service now holds production bindings. Provision a new isolated sandbox before restoring a staging deploy path.

## App and dashboard

- Use `.env.production.example` as the production app template.
- Do not put signing keys, RPC keys or operator tokens in `EXPO_PUBLIC_*`.
- The ignored current `.env` points at `api.momints.xyz` with the existing public treasury.
- `dashboard/app.js` targets the new API. The dashboard still needs a deployed Pages origin and matching `DASHBOARD_ORIGIN` before browser requests work.
- A debug build was installed in place on the connected Seeker and its catalogue refreshed from the new API. Metro is still required for that debug build.

## Rollback

Rollback is a service-routing operation, not a database restore:

1. Pause both production queues.
2. Redeploy `worker/wrangler.toml` if necessary to restore maintenance on the promoted service, then remove its consumers and schedules.
3. Confirm queue backlog and D1 state. Preserve all writes made after cutover.
4. Verify compatibility before using old code. Migrations 0009/0010 are additive, but protocol-v2 records created after activation require explicit compatibility review.
5. Roll the old service to retained version `12492e33-86e3-4f47-acf2-9bd3fad17761` only if compatible.
6. Restore its workers.dev route, the two schedules and exactly one consumer per production queue.
7. Verify the promoted service has no execution attachment before resuming delivery.

Never restore the pre-cutover SQL export over newer paid records. Never run two consumer/schedule sets against the same production resources.

## Historical staging evidence

The isolated no-funds deployment previously passed 65/65 checks at `staging-api.momints.xyz`. Its evidence remains in [STAGING-WORKER-TEST-REPORT-2026-09-30.md](STAGING-WORKER-TEST-REPORT-2026-09-30.md). That hostname no longer exists, and the historical report must not be used as evidence that current production secrets or paid paths are ready.
