# Cloudflare migration (preview first)

This repository's Cloudflare work is intentionally isolated on `cloudflare-deployment-prep`. Do not merge this branch or change the production deployment until the preview has passed the checklist below.

## What is configured

- Next.js is packaged for Cloudflare Workers using the OpenNext Cloudflare adapter (`open-next.config.ts`).
- `wrangler.jsonc` names a separate Worker, `enotes-cloudflare-preview`, so the migration does not target the current production Worker.
- The deployment workflow is manual-only and refuses to run from any branch except `cloudflare-deployment-prep`.

## One-time Cloudflare/GitHub setup

1. In Cloudflare, create an API token with permission to edit Workers and Pages for the target account. Keep it private.
2. In the GitHub repository, open **Settings → Secrets and variables → Actions** and add repository secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
3. In Cloudflare, configure the preview Worker’s runtime variables/secrets. Copy the names and values from the currently working deployment as appropriate; do not commit values to Git. At minimum, review `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or the existing anon-key fallback), and the server-side credentials used by the app (`SUPABASE_SERVICE_ROLE_KEY`, billing/provider keys, AI provider keys, and VAPID/PUSH settings where those features are enabled). Only add values that the app actually uses.

## Deploy the preview Worker

1. Open **Actions → Cloudflare preview deployment**.
2. Select **Run workflow** on branch `cloudflare-deployment-prep`.
3. Inspect the build/deploy logs and open the Worker URL printed by Wrangler.

This workflow deploys only the Worker named `enotes-cloudflare-preview`; it does not deploy `main`, update the production Worker, or attach a production custom domain.

## Required compatibility checks before any cutover

- Sign in/sign out, middleware redirects, session refresh, and Supabase Auth cookies.
- Journals, pages, editor autosave, sharing, and file/media storage.
- Realtime and any WebRTC/call functionality in the target browser/device.
- API routes that declare `runtime = 'nodejs'`, especially `/api/push/send`, video/AI routes, billing webhooks, and any route that uses Node built-ins.
- Web Push delivery with real test subscriptions and VAPID settings.
- Database cleanup in `lib/notifications/send.ts`: `pg` uses a direct `DATABASE_URL` connection. Do not set `DATABASE_URL` on Workers unless the connection has been deliberately adapted and tested for Cloudflare (for example, through a configured Hyperdrive binding). Cleanup is optional in the current code; push delivery should be tested separately.
- Upload size limits, streaming behavior, scheduled/background work, and third-party API calls.

A successful build alone is not proof that all routes work on Workers. Record any incompatibility and fix/test it on this branch before considering cutover. Keep the existing production deployment and Supabase project unchanged during this stage.

## Rollback

Because this is a separate preview Worker with no production route/domain, rollback is simply to stop using or delete the preview Worker. The existing production deployment remains the serving deployment. Do not repoint DNS or production routes as part of preview testing.
