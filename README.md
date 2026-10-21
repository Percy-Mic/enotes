# enotes — Project MVP Package

enotes is an artistic, interactive, highly customizable online journal where users can create journals that feel personal and physical.

## Structure Overview
- `app/`: Next.js App router routes for Authentication, Dashboard, Journals, Editor, Sharing, and Settings.
- `components/`: Modular React components including the physical Book viewer, freeform canvas editor, and element registry.
- `lib/`: Utilities for Supabase client, storage, sharing, and editor actions.
- `supabase/migrations/`: Database schema migrations.

## Cloudflare migration

Cloudflare deployment work is isolated on the `cloudflare-deployment-prep` branch and targets a separate preview Worker. The current production deployment is not changed. See [`docs/CLOUDFLARE_MIGRATION.md`](docs/CLOUDFLARE_MIGRATION.md) for setup, preview deployment, compatibility checks, and rollback guidance.
