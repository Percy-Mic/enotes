# enotes — Platform Setup Checklist

Everything below is configuration that **cannot** be done from code. Work top
to bottom; each step is required for the feature it mentions.

---

## 1. Database — run the migration (required)

1. Open **Supabase Dashboard → SQL Editor**.
2. Run these migration files **in order** (all additive — no existing data is touched):
   1. `supabase/migrations/20260913000000_platform_upgrade.sql`
   2. `supabase/migrations/20260913000001_followers_creator_economy.sql`
   3. `supabase/migrations/20260913000002_studio_media.sql`
   4. `supabase/migrations/20260913000003_template_use_rpc.sql`
   5. `supabase/migrations/20260913000004_rls_recursion_and_hardening.sql` ← **fixes the “infinite recursion detected in policy for relation "conversation_members"” error and restores missing constraints/indexes/count triggers**
   6. `supabase/migrations/20260913000005_reposts.sql` ← adds the `reposts` table (repost/undo-repost in the feed) with RLS + author notifications
   7. `supabase/migrations/20260913000006_fix_repost_story_policies.sql` ← **self-sufficient fix: run this one if reposts fail with “new row violates row-level security policy” or story deletion does nothing** (allows self-reposts, adds the missing stories DELETE policy; safe to re-run)
   8. `supabase/migrations/20260913000007_communities_search_hardening.sql` ← **communities (groups) + search scale (pg_trgm + full-text) + profile auto-creation trigger + real-actor repost notifications + sound-play counter + 4 original starter templates** (idempotent)
   9. `supabase/migrations/20260913000008_community_rls_fix.sql` ← **REQUIRED for communities — fixes the 500s on /community_members (RLS infinite recursion, same class of bug as the earlier chat fix), makes joins idempotent, and scopes community feeds so followers-only posts never leak** (idempotent)
3. Verify with the sanity checks at the bottom of the files:

```sql
select * from public.user_settings where user_id = auth.uid();  -- 1 row
select * from public.user_presence where user_id = auth.uid();  -- 1 row
select public.journal_role('<a journal id>', auth.uid());       -- owner or null
select key, value from public.platform_config;                  -- marketplace + plans
select * from public.entitlements where user_id = auth.uid();   -- 3 free-plan rows
select public.is_admin();                                       -- true for the first user
```

The migrations are **additive** — no existing data is touched.

---

## 2. Fix confirmation emails not arriving in Gmail (required)

This is the single most common cause: **Supabase's built-in SMTP is
rate-limited (about 2 emails/hour) and heavily filtered by Gmail.** Beyond
those 2/hour the mails are silently dropped — they never reach Gmail at all,
so they also never land in spam. The permanent fix is a proper SMTP provider
(Resend free tier: 3,000 emails/month, 100/day).

### Step-by-step (≈10 minutes, no code changes)

**A. Create a free Resend account**
1. Go to https://resend.com → Sign up (free, no credit card).
2. Verify your email address with Resend.

**B. Add and verify your sending domain**
1. Resend dashboard → **Domains → Add Domain** → enter your domain (e.g. `enotes.app`).
   - Don't have a custom domain? You can use `onboarding@resend.dev` for
     testing, but production needs a verified domain.
2. Resend shows DNS records (SPF/DKIM: an MX, TXT and two CNAME records).
3. Add those records at your domain's DNS provider (wherever you manage DNS).
4. Click **Verify** in Resend — status must become **Verified** before mail
   delivers reliably to Gmail.

**C. Create an SMTP credential**
1. Resend dashboard → **API Keys → Create API Key** → permission *Sending access*.
2. Copy the key (starts with `re_`). Resend's SMTP host is:
   - **Host:** `smtp.resend.com`  **Port:** `465` (SSL)
   - **User:** `resend`  **Password:** the `re_…` key

**D. Configure Supabase**
1. Supabase Dashboard → **Project Settings → Authentication → SMTP Settings**.
2. Toggle **Enable Custom SMTP** ON and fill in:
   - Sender email: `noreply@yourdomain.com` (must be on the verified domain)
   - Sender name: `enotes`
   - Host: `smtp.resend.com`, Port: `465`, Username: `resend`,
     Password: `re_…` (minimum 8 chars requirement: append randomness if short)
3. **Save**.

**E. Check Auth URL configuration (this is the other half of the bug)**
1. **Authentication → URL Configuration → Site URL**: set to your real app URL.
   - Local dev: `http://localhost:3000`
   - Production: `https://yourdomain.com`
   - If Site URL is wrong, the confirmation email's link points at a dead
     address even when the email *does* arrive.
2. **Redirect URLs** — add both of these:
   - `http://localhost:3000/**`  (dev)
   - `https://yourdomain.com/**` (production)
   Without a matching redirect URL Supabase blocks the callback and the user
   sees "invalid link".

**F. Check the "Confirm email" toggle**
1. **Authentication → Providers → Email**: **Confirm email** should be **ON**
   (the app's signup flow detects both modes, but ON is the secure default).
2. Optional hardening: set **OTP expiry** to 24h and **Maximum frequency** to
   at least 30 seconds so users can resend without hitting rate limits.

**G. Verify the email template link**
1. **Authentication → Emails → Templates → Confirm signup**.
2. The template must contain `{{ .ConfirmationURL }}` (it does by default).
   If it was customized with a hardcoded link, restore the variable.

**H. Test**
1. Sign up with a real Gmail address in the app.
2. The email should arrive within ~30 seconds (check All Mail, spam, and the
   Promotions tab — Gmail sorts domain-verified senders out of spam quickly).
3. Click the link → you should land on `/auth/callback?code=…` → redirected
   to the dashboard, signed in.
4. If the link says "expired or already used": that's the one-time-link being
   pre-scanned by Gmail/antivirus. The sign-in page now shows a **Resend
   confirmation email** button in exactly that situation — use it, or disable
   link pre-scanning in your security software.

### What was wrong, summarized
| Layer | Status | Fix |
|---|---|---|
| Application code | ✅ was fine, now better | `emailRedirectTo` now passed explicitly on signup and resend |
| Supabase built-in SMTP | ❌ rate-limited to ~2/hour, silently dropped after | Custom SMTP via Resend (free tier) |
| Site URL / Redirect URLs | ⚠️ verify in dashboard | Set Site URL + add `/**` redirect entries |
| Gmail delivery | consequence of the above | Fixed by domain-verified SPF/DKIM via Resend |

The app now also handles expired links gracefully: the callback route detects
`error=access_denied` / expired codes and routes the user to sign-in with a
"resend" affordance instead of a dead end.

---

## 3. Storage buckets (created by the migration, verify)

The migration creates `journal-media` and `chat-media` (private) and the
policies. Confirm in **Storage** that all five buckets exist:

| Bucket | Public | Used for |
|---|---|---|
| `avatars` | yes | profile pictures |
| `post-media` | yes | post photos/videos |
| `story-media` | yes | 24h stories |
| `journal-media` | no | journal images/video/audio (signed URLs) |
| `chat-media` | no | chat attachments (signed URLs) |
| `studio-media` | yes | video editor sources, audio, finished exports |

All uploads use `{userId}/{uuid}.ext` paths enforced by owner-folder RLS —
users can only write into, and read from (private buckets), their own folder.

---

## 4. Realtime (verify)

The migration adds these tables to the `supabase_realtime` publication:
`messages, notifications, posts, comments, post_reactions, calls, user_presence`.

Verify in **Database → Replication → supabase_realtime** that they show as
enabled. If the publication didn't exist, create it first:

```sql
-- only if missing:
create publication supabase_realtime;
```

Also confirm **Realtime is enabled** for the project (it is by default on
free tier; the free tier allows 200 concurrent connections and 2M messages/month
— plenty for development and early production).

---

## 5. Environment variables

Add to `.env.local` (Next.js reads this automatically; restart `npm run dev`
after changing):

```bash
# --- required (already present) ---
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# --- GIF provider (pick ONE; both have free tiers) ---
# Tenor (Google) — https://developers.google.com/tenor
NEXT_PUBLIC_GIF_PROVIDER=tenor
TENOR_API_KEY=your-tenor-google-cloud-key

# or Giphy — https://developers.giphy.com
# NEXT_PUBLIC_GIF_PROVIDER=giphy
# GIPHY_API_KEY=your-giphy-key

# --- optional: TURN relay for WebRTC calls behind strict NATs ---
# Free tier: metered.ca "Open Relay" (50 GB/month free) https://metered.ca
# NEXT_PUBLIC_TURN_URL=metered:81.3.xxx.xxx:3478
# NEXT_PUBLIC_TURN_USERNAME=...
# NEXT_PUBLIC_TURN_CREDENTIAL=...

# --- optional: free sound-library import (admin-only route) ---
# Free API key: https://freesound.org/apiv2/apply
# FREESOUND_API_KEY=...

# --- optional: billing (leave unset = billing UI shows honest "not configured") ---
# PAYMENT_PROVIDER=stripe            # stripe | paddle | lemonsqueezy
# STRIPE_SECRET_KEY=sk_test_...
# STRIPE_WEBHOOK_SECRET=whsec_...
# NEXT_PUBLIC_SITE_URL=http://localhost:3000
# Prices go in Supabase → platform_config → key 'billing':
# { "pro": { "price_id": "price_...", "amount_cents": 600 } }
```

Notes:
- `TENOR_API_KEY` / `GIPHY_API_KEY` are **server-only** (no `NEXT_PUBLIC_`
  prefix) — the app proxies GIF search through `/api/gifs` so keys never
  reach the browser.
- Without a GIF provider configured, GIF pickers show setup instructions
  instead of a fake grid.
- Without a TURN server, calls work on most networks (STUN is free via
  Google) but some corporate/carrier NATs will fail — that's what
  `reconnecting`/`failed` call states handle.

---

## 6. Web Push notifications — required for installed-app alerts

The notification UI is already implemented. When enotes is running as an installed PWA,
the user gets the **Stay connected** prompt and can explicitly enable browser/OS
notifications. Push subscriptions are stored per device in `push_subscriptions`.

The screenshot showing:

> Push is not configured yet (missing VAPID public key).

means the application code is working, but the deployment is missing its Web Push
environment variables.

### A. Generate one VAPID key pair

Run once on your computer:

```bash
npx web-push generate-vapid-keys
```

Keep the **private key secret**. The public key is safe to expose to the browser.

### B. Add these variables to Vercel

In **Vercel → Project → Settings → Environment Variables**, add:

```bash
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<generated public key>
VAPID_PRIVATE_KEY=<generated private key>
VAPID_SUBJECT=mailto:enotes@example.com
PUSH_SEND_SECRET=<long random secret>
NEXT_PUBLIC_SITE_URL=https://enotes-amber.vercel.app
```

Use the same values for Production (and Preview if you want push there). Redeploy
after saving them because `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is bundled into the client.

### C. Configure Supabase's push delivery endpoint

After the Vercel deployment exists, run this in **Supabase → SQL Editor**:

```sql
insert into public.platform_config (key, value)
values
  ('push_endpoint', '"https://enotes-amber.vercel.app/api/push/send"'),
  ('push_send_secret', '"<the exact PUSH_SEND_SECRET from Vercel>"')
on conflict (key) do update
set value = excluded.value;
```

The secret must exactly match the Vercel environment variable.

### D. Run the push migration

Run:

`supabase/migrations/2026-09-16_push_delivery.sql`

The existing call migrations also contain the push triggers for 1:1 and group-call
invitations:

- `supabase/migrations/2026-09-25_priority_call_push.sql`
- `supabase/migrations/2026-09-25_persistent_group_calls.sql`

### E. Test on the installed app

1. Open/install enotes on the phone.
2. Sign in.
3. The **Stay connected** dialog appears.
4. Tap **Enable notifications**.
5. Android/browser asks for notification permission.
6. Allow it.
7. The push subscription is saved to `push_subscriptions`.
8. From another account, send a chat message or start a call.
9. The phone should receive the notification even when enotes is in the background/closed.

For calls, the push is only an alert. It does **not** automatically turn on the
camera or microphone. The existing invite-only **Join / Decline** behavior remains.

## 7. Video calls — what's implemented and the honest limits

**Implemented (free, no paid service):** 1:1 audio + video calls with
WebRTC peer-to-peer media, Supabase Realtime broadcast channels as the
signaling transport, full call states (calling → ringing → connecting →
connected → reconnecting → ended/declined/missed/failed), mute/camera flip/
device switch, missed-call notifications, and beacon-based cleanup when a
tab closes unexpectedly.

**Not implemented on purpose:** group/multi-party calls. Real group calls
need an SFU (media server) — options:
- **LiveKit Cloud** — free tier: 50 participants/duration caps, then paid
- **Daily.co** — free 10,000 minutes/month
- **100ms** — free tier with monthly limits
- **Self-hosted LiveKit** — free software, you pay for a VM (~$5–10/month)

The UI deliberately does not fake group calls. When you're ready, the
`calls` table and `CallProvider` are structured so an SFU token can be added
without reworking the client.

---

## 7. Feature → enforcement map (what's database-enforced)

| Feature | Enforcement |
|---|---|
| Journal privacy | `can_view_journal()` + RLS on `journals`, `journal_pages` |
| Journal sharing roles | `journal_role()` — owner/editor/commenter/viewer; revoked shares lose access instantly |
| Private messages | `is_conversation_member()` RLS on messages + attachments bucket |
| Active status privacy | `user_presence` readable only when `user_settings.show_active_status = true` |
| Read receipts | `user_settings.read_receipts_enabled` checked server-side before `read_at` is written |
| Blocks | `users_blocked()` helper + RLS; block hides content both directions |
| Settings | RLS: each user can only ever touch their own `user_settings` row |
| Reports | insert-only for reporters; readable only by the reporter |
| Notifications | RLS: only your own rows; realtime respects the same policy |
| Storage | owner-folder policies on every bucket |

Nothing above relies on client-side checks — the client can only ask
Supabase for what the policies allow.

---

## 8. Post-migration smoke test (10 min)

1. `npm run dev` → sign up a new user → confirm email → land on dashboard.
2. **Feed:** create a post with text + emoji + GIF + photo; verify it renders.
3. **Post page:** click a post card → `/posts/[id]` → comment, react, reply.
4. **Chat:** open `/messages` → start a chat → send text/emoji/GIF/sticker/file
   → verify realtime delivery in a second browser + typing indicator + ✓✓.
5. **Calls:** from a DM, press the video button in two browsers → accept →
   verify media flows both ways → end → verify "ended" and missed-call notes.
6. **Notifications:** with two users, like/comment/follow → verify realtime
   badge + click-through routes.
7. **Journal editor:** open a journal → add text/sticker/emoji/GIF/icon →
   drag, resize, rotate → undo/redo (buttons + Ctrl+Z / Ctrl+Shift+Z) →
   switch pages and undo → verify autosave ("Saved" in header) → reload →
   content persists.
8. **Settings:** `/settings` → toggle active status off → verify the presence
   dot disappears for the other user within ~a minute.
9. **Blocking:** block the second user → their posts vanish from your feed
   and your profile is hidden from them (enforced by RLS, not just UI).
10. **Mobile:** repeat 2/4/7 on a phone (or devtools mobile emulation).
