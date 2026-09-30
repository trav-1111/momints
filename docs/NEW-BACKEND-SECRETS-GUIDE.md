# Momints: enter the existing production credentials

Prepared: 30 September 2026.

**Completed on 30 September 2026.** The production credentials were entered and independently verified, and the backend was activated. End-to-end paid minting is still awaiting owner-led Quick and 12/24-frame tests. This document is retained as the secret-entry record, not as an instruction to enter them again.

## Exact target

- Worker: `momints-roll-worker-staging`
- Production API: `https://api.momints.xyz`
- Cloudflare account ID: `722d3248891665c30e47acd64086e876`
- Dashboard: `https://dash.cloudflare.com/722d3248891665c30e47acd64086e876/workers/services/view/momints-roll-worker-staging/production/settings`

Do not select the retired Worker named `momints-roll-worker`.

The target is bound to the preserved production D1/R2 resources and is now active with the single intended consumer/schedule set. Do not repeat these steps unless deliberately rotating or recovering credentials under a maintenance window.

## Verified secret status

Cloudflare does not reveal existing secret values. Use your secure saved production copies; do not paste them into chat, source files, screenshots or any `EXPO_PUBLIC_*` value.

| Secret name              | Verified target state                                                               |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `IRYS_FUNDING_KEY`       | Present; derives to the expected existing production signer                         |
| `OPS_AUTH_TOKEN`         | Present; authenticated read-only checks passed and wrong/missing tokens were denied |
| `SOLANA_RPC_URL`         | Present; returned the Solana mainnet genesis hash                                   |
| `SOLANA_RPC_URL_MAINNET` | Present; retained as the separate mainnet read endpoint                             |

Expected public address derived from the production funding key:

`6cpYU6dXcioCqVdBhF93qCruSThroGPrqPVA3h57pV1V`

The retired staging signer `CDWnMvHWENsJumumcZMdnP5CS3T7HiKGxMwJgogKEhBQ` was not returned by the active service.

Leave `DISCORD_WEBHOOK_URL` and `OPERATOR_DISCORD_ID` unset for this handoff. Alerts remain intentionally silent. No new Turbo API key or treasury private key is required.

## Historical Cloudflare entry steps

1. Sign in to the account above and open the exact Worker dashboard link.
2. Open **Settings -> Variables and Secrets**.
3. Confirm the plain variable `MAINTENANCE_MODE` is still `true`. Do not change it.
4. Edit `IRYS_FUNDING_KEY`, select **Secret**, and paste the existing production funding key.
5. Edit `OPS_AUTH_TOKEN`, select **Secret**, and paste the existing production token.
6. Confirm or replace `SOLANA_RPC_URL` as described above.
7. Optionally add `SOLANA_RPC_URL_MAINNET` only if you intend to preserve the separate endpoint used by the old Worker.
8. Select **Deploy**. Secret saves may create a new Worker version/deployment; that is expected.
9. Confirm only the secret names are visible. Do not try to reveal or copy values back out.

The public treasury is already configured as:

`o4w1THGTu1ufcRUEpVn45zttpcPoQBFFSLtMYeu5HpW`

The placeholder URI, production D1, production R2 buckets and production rate-limit namespaces are also already configured. Do not edit them.

## Completed handoff

The owner sent:

> I have entered the existing production credentials on `momints-roll-worker-staging`. Complete Phase 3 of `docs/NEW-BACKEND-CUTOVER-BRIEF.md`: verify the signer, RPC, balances, treasury, protected routes and preserved database while maintenance stays enabled; confirm the old Worker is disabled; then activate the single production consumer/schedule set if every check passes. Do not pay, mint, upload permanently or send Discord notifications. Stop when it is ready for my owner-led Quick and 12/24-frame tests.

Activation and Seeker connectivity to `https://api.momints.xyz` are confirmed. Real payment and mint behavior remains to be proven by the owner-led Quick and prepaid 12/24-frame tests.
