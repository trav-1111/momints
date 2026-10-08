# Momints new-backend cutover report

Prepared: 30 September 2026.

## Handoff status

**Activated with the production identity. Update on 1 October 2026: Quick, 12-frame and 24-frame owner tests completed. Direct verification of the latest 12- and 24-frame rolls passed all 36 Arweave byte hashes, finalized Core ownership/collection checks, developed markers and Worker-delegate handoffs. The Seeker cleanup audit found no retained user photographs or completed-roll vault files.**

The completed 24-frame roll had 24 unique history frames and 24 minted assets but displayed 25/24 in the local registry. The correction recorded in the [production checklist](ROLL-FRAME-PRODUCTION-CHECKLIST.md#completed-24-frame-seeker-cleanup-and-registry-correction--2026-10-01) repaired it to 24/24 on Seeker and remained correct after another cold restart with all history entries intact.

The tested Worker service is live at `https://api.momints.xyz`, bound to the preserved production database and storage, with `MAINTENANCE_MODE=false`. Exactly one production Queue producer, one finalize consumer, one dead-letter consumer and the two intended Cron schedules are active. Both production queues reported zero backlog when delivery was resumed.

The cutover work itself performed no payment, mint, permanent upload, Discord notification, destructive cleanup, commit, push or merge. The owner subsequently performed the successful Quick, 12-frame and 24-frame tests noted above. The later read-only audit added permanent-byte and on-chain ownership/handoff evidence without initiating another payment, mint or upload.

## Exact Cloudflare target

- Account: owner's Cloudflare account (account ID below; personal login omitted).
- Account ID: `722d3248891665c30e47acd64086e876`
- Dashboard: `https://dash.cloudflare.com/722d3248891665c30e47acd64086e876/workers/services/view/momints-roll-worker-staging/production/settings`
- Target Worker: `momints-roll-worker-staging`
- Production URL: `https://api.momints.xyz`
- Custom-domain ID: `cf776af19f2e553c11c8e6ddead5965c3b5c8b2f`
- Zone: `momints.xyz` (`0a4e1935d60dd95e21e9d40b9d6b5dea`)
- Safe maintenance config: `worker/wrangler.toml`
- Authoritative active config: `worker/wrangler.production-active.toml`
- Worker version: `6b168483-5cfb-4540-bcbd-b86d7f010f75`
- Deployment ID: `53d17f08-060d-4b3e-ae7d-f24a67a7e0f9`

Both the workstation resolver and Cloudflare's `1.1.1.1` returned `104.21.38.216` and `172.67.139.81`. HTTPS health passed using the hostname and reported production, maintenance disabled, required secrets present and D1 reachable.

## Preserved production resources

| Resource          | Preserved value                                                   | Handoff state                                       |
| ----------------- | ----------------------------------------------------------------- | --------------------------------------------------- |
| D1                | `momints-rolls` / `c4897487-5eef-4569-87a4-14306d4eac72`          | Migrations 0001-0010 applied                        |
| Quick R2          | `momints-quick-staging`                                           | 0 objects; `quick-staging/` one-day expiry retained |
| Filmstock R2      | `momints-filmstocks`                                              | 11 objects; 4 packages hash-verified; no expiry     |
| Finalize queue    | `momints-quick-finalize` / `de3666de7bb54a459dee4dfc1ed2927f`     | Active, 0 backlog, 1 producer, 1 consumer           |
| Dead-letter queue | `momints-quick-finalize-dlq` / `c64c36f46301441890f2683614354e2b` | Active, 0 backlog, 1 consumer                       |
| Rate limits       | namespaces `1001`, `1002`, `1003`                                 | Bound to promoted Worker                            |
| Treasury          | `o4w1THGTu1ufcRUEpVn45zttpcPoQBFFSLtMYeu5HpW`                     | Public config verified                              |
| Placeholder       | `https://arweave.net/JbRjC4JbM7jbNRyiEZO7gj43gbOWBqt-O5RD4oZmCcw` | Public config verified                              |
| Storage provider  | Turbo default                                                     | No Pinata setting or binding                        |

Disposable staging D1/R2/queues were not deleted or copied into production. The former staging queues are also paused, empty and detached. The `staging-api.momints.xyz` custom domain was removed; only `api.momints.xyz` is attached to the promoted service.

## Database preservation and workload audit

Before maintenance, production contained:

- 19 rolls: 18 `COMPLETE`, one dormant pre-contract `OPEN` roll.
- 167 frames, all `MINTED`.
- 37 Quick mints, all `FINALIZED`.
- 0 frame locks, deferred Quick finalizes, `FINALIZING`/`DEAD` Quick rows, stalled handoffs or queued messages.
- 5 recorded roll payment signatures, 37 Quick payment signatures and 54 treasury entries.

The unexpected open row is roll `2026-07-27.06`, a 12-frame protocol-v1 roll with 3 minted frames. It has no frame lock or handoff and predates recorded roll fee signatures. It was not deleted, closed or altered. It remains recoverable through the tested wallet-signed legacy path and may block a new roll for that same wallet until the owner deliberately finishes or closes it.

After stopping writers, a final full D1 export was saved privately at:

`worker/.production-evidence/2026-09-30-cutover/production-paused-pre-migrations.sql`

- Bytes: `173996`
- SHA-256: `D77AD6FD5445DF186F9105BB77B8AE1E4F2AFB0535563CDA23EC8EFA8B8BCC13`
- Restore verification: succeeded in an isolated local D1 instance with 19 rolls, 167 frames, 37 Quick rows and 54 treasury entries.

Migrations `0009_roll_frame_contract.sql` and `0010_quick_image_artifact.sql` were then applied. Counts and payment records remained unchanged; all 19 existing rolls remain protocol v1 with null authorization hashes, and all historical image-receipt fields remain null as intended.

## Old-service retirement

The old service is `momints-roll-worker`.

- Its actual public API was `https://momints-roll-worker.traviskeir.workers.dev`; it had no custom domain or zone route. `traviskeir.dev` belongs to the unrelated `dev-blog` Worker and was untouched.
- Current maintenance version: `0f13f7d5-729d-4559-889e-57134f6ae1f7`.
- Current deployment ID: `9089be3e-522e-460e-b3c1-8676565e8d06`.
- Previous production version retained for rollback: `12492e33-86e3-4f47-acf2-9bd3fad17761` (deployment `a4cf8ac9-2faf-4ed6-94a2-31f3a6e0e8fb`).
- workers.dev and preview URLs are disabled.
- Cron schedules, Queue producers and Queue consumers are all absent.
- Its secrets remain recoverable in Cloudflare; no key was deleted or rotated.
- `worker/wrangler.rollback.toml` is the checked-in inactive maintenance configuration.

## Maintenance verification

The guard runs before request-body parsing, D1 mutation, provider construction, Queue sends or signer use. It also retries rather than acknowledges a Queue message if an invocation somehow reaches the code while paused, and scheduled invocations return before constructing providers.

Local focused tests passed with secrets-present mocked providers. The deployed production-safe suite passed 18/18 checks:

- Health, fees and production-origin catalogue remained readable.
- `/funding/status`, `/treasury/status` and operator/dashboard routes remained bearer protected.
- Roll creation, frame submission, legacy authorization, completion, Quick stage/finalize/release, SKR quote, alert and Quick redrive routes all returned maintenance `503` with `Retry-After: 300`.
- No synthetic rows or objects were created.
- Four filmstocks, 11 immutable assets, recipes, previews and runtime LUT hashes passed a verify-only smoke check against the production origin.

The private machine-readable HTTP report is `worker/.production-evidence/2026-09-30-cutover/maintenance-http-report.json`.

## Phase 3 identity and readiness verification

The owner replaced the staging secrets, then the deployment was verified while maintenance and Queue delivery remained paused:

- The configured funding key derives to the expected production signer `6cpYU6dXcioCqVdBhF93qCruSThroGPrqPVA3h57pV1V`, not the former staging signer.
- The configured RPC returned Solana mainnet genesis hash `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`.
- The configured treasury is `o4w1THGTu1ufcRUEpVn45zttpcPoQBFFSLtMYeu5HpW`; its SKR token account is `2Zzk9w5GoVse3tN2DmBWyZdtP8L7x7i2KEA7bbULQxFw` with 30.380247 SKR at verification.
- The signer held 0.071924295 SOL, the treasury held 0.105658777 SOL and Turbo reported 4.102653771956 credits. The Worker conservatively reports capacity for four 24-frame rolls. The signer SOL balance is adequate for an individual owner test but is tight for sequential paid 12- and 24-frame tests; top it up manually before both if desired.
- Missing and incorrect bearer tokens returned 401 across the seven protected funding, treasury, dashboard and operator routes. The valid production token returned the expected read-only state.
- Fee recomputation succeeded without an alert: Quick 3,684,374 lamports, 12-frame roll 80,483,692 lamports and 24-frame roll 160,967,383 lamports. The last-good pricing guard remained true.
- `IRYS_FUNDING_KEY`, `OPS_AUTH_TOKEN`, `SOLANA_RPC_URL` and `SOLANA_RPC_URL_MAINNET` are the only deployed secret names. Discord secrets remain absent.
- The preserved database remained at 19 rolls, 167 frames, 37 Quick mints and 54 treasury entries before and after activation. No pending Quick work or stuck handoff appeared.

Private machine-readable evidence is ignored under `worker/.production-evidence/2026-09-30-cutover/phase3-readiness.json` and `phase3-active.json`; neither file contains secret values or credential-bearing RPC URLs.

## App and operator tooling

- `.env.production.example` sets `EXPO_PUBLIC_ROLL_API=https://api.momints.xyz` and the existing treasury.
- The current ignored `.env` now points at `https://api.momints.xyz`; the public treasury was unchanged.
- `dashboard/app.js` now targets `https://api.momints.xyz`; browser dashboard use still requires deploying the page and setting its exact `DASHBOARD_ORIGIN`.
- A debug app build was installed in place on Seeker `SM02G406193022` without uninstalling the app or clearing its data. The device resolved and reached `api.momints.xyz`.
- After a normal background/foreground refresh, the device's public catalogue cache contained Bali 400, Martha, Momints B&W and Momints Color with every recipe URL rooted at `api.momints.xyz`. The first read was correctly identified as a pre-cutover cached catalogue rather than a backend-origin defect.
- Metro remains a development-time requirement for this debug build; a distributable owner-test build is still separate.

## Active execution topology

- `momints-roll-worker-staging` has exactly the `0 */3 * * *` and `0 */6 * * *` schedules.
- `momints-quick-finalize` has one producer and one consumer; `momints-quick-finalize-dlq` has one consumer. Both are active and empty.
- The disposable staging queues remain paused, empty and detached.
- The retired Worker has no workers.dev or preview endpoint, custom domain, zone route, Queue attachment or schedule. Its old URL returns 404.
- `api.momints.xyz` is the only custom domain attached to the promoted service. The former staging hostname does not resolve.

The owner subsequently completed real Quick and prepaid 12/24-frame tests. On 1 October, the latest 12- and 24-frame rolls passed direct verification of all 36 permanent Arweave byte hashes, finalized Core ownership/collection membership, developed markers and collection handoff; the Seeker audit also confirmed encrypted-vault and plaintext cleanup. Private per-frame evidence is referenced from the production checklist and remains ignored locally.

## Rollback

1. Re-enable maintenance on the promoted service and pause both production queues before any other action.
2. Do not restore a database snapshot over later paid records. Continue using the same production D1 and buckets.
3. If no post-cutover protocol-v2 writes exist, the additive schema remains compatible with the retained old version. If newer writes exist, keep maintenance and fix forward unless compatibility is proved.
4. To restore the old code, roll `momints-roll-worker` back to version `12492e33-86e3-4f47-acf2-9bd3fad17761`, then deliberately restore only its workers.dev route, the two schedules, one finalize consumer and one DLQ consumer.
5. Remove the promoted service's production consumers/schedules before restoring any old-service consumer or schedule. Never operate two authoritative writers.
6. Verify queue backlog and database preservation before resuming delivery.
