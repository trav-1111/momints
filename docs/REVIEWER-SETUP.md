# Independent reviewer setup

Prepared: 1 October 2026. These instructions do not authorize changes to Momints production. For app-only review, prefer the existing API option in the [root README](../README.md). No owner secrets are required.

## Frozen, non-spending source checks

Use Node 22.17.1 and npm 10.9.2, with `npm ci` at the root and `npm ci --legacy-peer-deps` in `worker/`. The explicit Worker flag is needed for the existing TypeScript 7 versus Solana Kit optional TypeScript 5 peer conflict; it does not alter the lockfile. Upstream peer compatibility remains a dependency follow-up, and plain Worker `npm ci` is not claimed to pass. On Windows, use `npm.cmd` if PowerShell blocks `npm.ps1`; if a global launcher is broken, run `node <your-node-install>/node_modules/npm/bin/npm-cli.js <command>`. Do not repair setup by regenerating the lockfiles. Run the README checks before building the native client. `test:migration-upgrade` creates/deletes only its own local D1 test state; `bundle-size` is a dry-run bundle. Neither requires Cloudflare login.

No Android prebuild, APK build, production RPC probe or deployed synthetic test is part of these local checks. An actual device build additionally needs the Android prerequisites listed in README. Do not uninstall or clear a device containing user data to troubleshoot setup.

## Independently provisioned backend

Cloudflare Workers with D1, R2, Queues and rate-limit bindings are required. A separate Cloudflare account is simplest; otherwise choose unique names and namespace IDs and confirm they are not shared with any existing service. The normal source expects Solana mainnet, a dedicated RPC provider, and Turbo/Arweave. Provisioning costs may apply. Funded transactions/permanent uploads are separate, explicit operator actions, not free setup checks.

The template [`worker/wrangler.review.example.toml`](../worker/wrangler.review.example.toml) has **no Momints resource IDs, domains or financial identity**. Copy it to ignored `worker/wrangler.review.local.toml`, replace every `REPLACE_...` value with your independently created resource, and inspect the whole file. Never substitute the production config or run `npm run deploy`: its guards deliberately target Momints production.

From `worker/`, invoke the locked CLI explicitly:

```sh
npm ci --legacy-peer-deps
node node_modules/wrangler/bin/wrangler.js login
node node_modules/wrangler/bin/wrangler.js d1 create YOUR_UNIQUE_DB_NAME
node node_modules/wrangler/bin/wrangler.js r2 bucket create YOUR_UNIQUE_QUICK_BUCKET
node node_modules/wrangler/bin/wrangler.js r2 bucket create YOUR_UNIQUE_FILM_BUCKET
node node_modules/wrangler/bin/wrangler.js queues create YOUR_UNIQUE_FINALIZE_QUEUE
node node_modules/wrangler/bin/wrangler.js queues create YOUR_UNIQUE_FINALIZE_DLQ
```

Creation commands must be executed in your own verified account. Enter returned IDs/names into the local configuration, including account ID, separate rate-limit namespaces, treasury and both queue consumers. The DLQ name must end in `-dlq`. Configure the Quick bucket's `quick-staging/` prefix with a one-day expiration; do not expire permanent film packages. See [R2 lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/) and [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/).

Apply all migrations only after verifying that the local configuration's database ID/name is yours:

```sh
node node_modules/wrangler/bin/wrangler.js --config wrangler.review.local.toml d1 migrations apply YOUR_UNIQUE_DB_NAME --remote
```

This mutates your new database. There is no import of Momints production records. For local-only development use `--local` instead. Copy `.dev.vars.example` to ignored `.dev.vars` for local use, supplying your own dedicated mainnet RPC, base58 64-byte signer and operator token. For deployed use, enter them into Worker secret storage:

```sh
node node_modules/wrangler/bin/wrangler.js --config wrangler.review.local.toml secret put SOLANA_RPC_URL
node node_modules/wrangler/bin/wrangler.js --config wrangler.review.local.toml secret put IRYS_FUNDING_KEY
node node_modules/wrangler/bin/wrangler.js --config wrangler.review.local.toml secret put OPS_AUTH_TOKEN
```

Never enter secret values as CLI arguments, chat messages or tracked files. Leave Discord secrets absent. The `IRYS_FUNDING_KEY` name is historical; the same signer funds Solana operations and signs Turbo uploads. It must be your identity, not the owner's. `QUICK_TREASURY_ADDRESS` is public and must match your app's `EXPO_PUBLIC_ROLL_TREASURY`. The sample placeholder is an existing public permanent metadata URI; no placeholder upload is needed for code review.

## Film assets and deployment

Run `npm run validate:filmstocks`. Preserve the existing asset bytes under `filmstock-assets/`; the immutable lock is `filmstock-assets/immutable-lock.json`. Upload only the objects listed in that lock **to your new film bucket**, preserving their paths relative to `filmstock-assets/`. First confirm any existing object at a key is absent or has identical bytes; never overwrite different bytes at a locked key. An individual upload looks like:

```sh
node node_modules/wrangler/bin/wrangler.js --config wrangler.review.local.toml r2 object put YOUR_UNIQUE_FILM_BUCKET/filmstocks/bali-400-v1/recipe.json --file filmstock-assets/filmstocks/bali-400-v1/recipe.json --content-type application/json --remote
```

Upload all locked runtime LUTs, previews and recipes with the corresponding JSON/JPEG/binary content types. Do not upload `filmstock-sources/`, `filmstock-drafts/`, private corpus or QA evidence. The source archive is for reproducible validation, not serving. Recipe/catalogue URLs are constructed from the request origin; check them on your service. Normal film entitlement/rotation rules still apply; do not add bypasses for review.

With resources and secrets configured, verify your selected target using a dry-run, then explicitly deploy your own service:

```sh
node node_modules/wrangler/bin/wrangler.js --config wrangler.review.local.toml deploy --dry-run --outdir .wrangler-dry-run
node node_modules/wrangler/bin/wrangler.js --config wrangler.review.local.toml deploy
```

Both lines must use the independently reviewed **local** configuration. This cleanup task did not execute them remotely. Maintenance is enabled in the template; health/catalogue reads can be checked while paid mutations remain blocked. Missing real credentials are configuration errors, not a reason to bypass validation. Consumer entries in the template are commented out: uncomment only after checking your queue names, funding/readiness and maintenance behavior. Add the two production-like schedules (`0 */6 * * *` and `0 */3 * * *`) only deliberately, with one consumer per queue and no Discord secrets. No schedule is required for catalogue availability rotation. Do not send paid queue jobs while maintenance is on; handlers retry rather than acknowledge them.

To run a paid-capable independent service later, its operator must deliberately enable intended consumers/schedules and set `MAINTENANCE_MODE="false"`, verifying funding, treasury and dedicated RPC first. Do not share credentials/payment databases with Momints production. Use `.env.staging.example` for your independently hosted app endpoint and matching treasury, then rebuild the development client if public environment values changed. `staging-api.momints.xyz` is retired and is not a reviewer endpoint.

## Scope and verification limits

Frozen installs and local checks are recorded in [submission cleanup report](SUBMISSION-REPOSITORY-CLEANUP-REPORT.md). Cloudflare resource creation, secrets entry, remote migrations, independent deployment and paid end-to-end behavior are not validated by those checks. Private-corpus/device visual evidence is intentionally not packaged. The owner retains rights under [the repository notice](../LICENSE.md); authorized hackathon evaluation is permitted. Standalone APK signing/building and repository access verification remain separate tasks.
