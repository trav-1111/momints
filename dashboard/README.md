# Momints operator dashboard

Operator-only setup, not required for app reviewers. Do not deploy to the named Momints Pages project or modify its Worker configuration. Independent operators must choose their own project/domain, Worker configuration and token; see [reviewer setup](../docs/REVIEWER-SETUP.md). The commands below describe the owner's deployment and require separate authorization. The default Worker config is maintenance-only; do not use a raw redeploy to update the active service.

A static, read-only, operator-only view of wallet balances, system health,
and aggregate usage. No build step, no npm dependencies — `index.html` +
`app.js` deploy as-is to Cloudflare Pages. See `worker/README.md` "Operator
dashboard" for what the three endpoints this page calls actually return.

**Read-only.** Nothing on this page can move funds or mutate state — it only
calls `GET /ops/dashboard/*`. **Aggregate only.** It never requests or
displays anything about an individual wallet — see the Worker's own doc
comments in `worker/src/ops/dashboard.ts` for why that's structural, not a
UI choice.

## Deploy

1. Open `app.js` and set `WORKER_URL` at the top to your deployed Worker's
   URL (the same value as the app's `EXPO_PUBLIC_ROLL_API`).
2. Deploy:
   ```sh
   wrangler pages deploy dashboard/ --project-name=momints-dashboard
   ```
   This gives you a `*.pages.dev` URL. Optionally attach a custom domain
   (e.g. `dash.momints.xyz`) to the Pages project in the Cloudflare
   dashboard.
3. **Configure Cloudflare Access** on that Pages project/domain — Zero
   Trust → Access → Applications → add one gating it to your own
   email/Google login (free tier). This is what actually stops anyone but
   you from loading the page at all. Do this before treating the deploy as
   done — without it the page is publicly reachable (the `OPS_AUTH_TOKEN`
   gate still protects the _data_, but the page itself would be open).
4. Back in `worker/wrangler.toml`, set `DASHBOARD_ORIGIN` to the final
   origin (the `pages.dev` URL or your custom domain, scheme + host, no
   trailing slash) and redeploy the Worker (`wrangler deploy` from
   `worker/`). This is what lets the page's own fetch calls past CORS —
   until it's set, the browser will block the dashboard's requests to the
   Worker even though curl/token auth would succeed.
5. Open the page, get through Cloudflare Access, then paste your existing
   `OPS_AUTH_TOKEN` (the same one already used for `/ops/status` etc.) into
   the prompt. It's stored in this browser's `localStorage` only — sent as
   `Authorization: Bearer <token>` on every data call, never anywhere else.

## Updating

Same command, same project name — `wrangler pages deploy dashboard/
--project-name=momints-dashboard` redeploys to the same URL.

## Local development

Serve the folder with any static file server and point it at a local
`wrangler dev` Worker:

```sh
npx serve dashboard   # or: python3 -m http.server 8080 --directory dashboard
```

Set `WORKER_URL` to `http://127.0.0.1:8793` (or whatever port `wrangler dev`
uses) for local testing. Note the Worker's `DASHBOARD_ORIGIN` CORS check
needs to match whatever origin the static server serves from
(`http://localhost:<port>`) for the browser calls to succeed locally — set
it temporarily in `worker/.dev.vars`-adjacent local config, or just verify
the endpoints directly with curl (see `worker/README.md`) if you don't need
to exercise the browser/CORS path itself.
