# Cloudflare Workers preview setup

This branch prepares eNotes for a **preview deployment** on Cloudflare Workers. It does not replace the current production host.

## Before deploying

1. In Cloudflare, open **Workers & Pages** and create/import a Worker from `Percy-Mic/enotes`, selecting the `cloudflare-deployment-prep` branch.
2. Use the npm package manager.
3. Configure the variables required by `.env.example` in Cloudflare's build variables and runtime secrets. Use the actual values from their original trusted providers; do not put secrets in Git. Public `NEXT_PUBLIC_*` values may be needed during build as well as runtime.
4. Set the build command to `npm install && npm run build:cloudflare` and the deploy command to `npx wrangler deploy`, if the dashboard exposes separate build and deploy commands. If the platform provides a framework preset that overrides these commands, inspect its output before allowing it to deploy.
5. Keep this deployment on its `workers.dev` preview URL. Do not attach the production domain or change OAuth, billing, or webhook URLs yet.

## Compatibility is not assumed

The app uses Next.js 14, Supabase SSR, `pg`, and `web-push`. A successful build is not proof that each dependency works in Workers. Confirm database connection support and authentication cookie behavior; test every API route, uploads, media, push delivery, and webhook handlers on the preview URL. Do not enable production billing webhooks or send real production notifications from preview without intentionally configuring test credentials.

## Test before production

- [ ] Public pages and static assets render
- [ ] Sign-in/sign-up, session refresh, and protected routes work
- [ ] Supabase reads/writes and authorization rules work
- [ ] `pg`-based routes connect successfully or are adapted to a supported database connection method
- [ ] Uploads, feeds, notes, and media features work
- [ ] Push subscription and delivery work
- [ ] Billing and webhook flows work with test configuration
- [ ] Manifest, icons, service worker, and PWA installation work
- [ ] No secrets appear in source, browser bundles, or logs

Only switch production after all required checks pass and a rollback plan is ready.
