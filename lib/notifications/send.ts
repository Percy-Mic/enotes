/* ============================================================
   Server-side Web Push delivery (Node runtime — Vercel functions).

   Called by /api/push/send. The DB trigger (notify_push, see
   supabase/migrations/2026-09-16_push_delivery.sql) runs SECURITY
   DEFINER, attaches the recipient's own push_subscriptions rows to
   the payload, and posts here via pg_net. This module never needs a
   service-role key: it can only send to subscriptions the trigger
   itself selected. Dead-subscription cleanup (push service answers
   404/410) runs over DATABASE_URL when present and is skipped
   otherwise — sending still works without it.

   Env (server-only):
   VAPID_PRIVATE_KEY — base64url private key
   VAPID_SUBJECT     — mailto: contact
   PUSH_SEND_SECRET  — shared secret the DB trigger must present (checked in the route)
   DATABASE_URL      — optional; enables dead-subscription cleanup
   ============================================================ */

import webpush from 'web-push';
import { Pool } from 'pg';

let configured = false;

function ensureVapidConfigured(): string | null {
  if (configured) return null;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:enotes@example.com';
  if (!publicKey || !privateKey) {
    return 'Push is not configured on this deployment (missing VAPID keys).';
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return null;
}

let pool: Pool | null = null;

function db(): Pool | null {
  const cs = process.env.DATABASE_URL;
  if (!cs) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: cs,
      max: 2,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
    });
  }
  return pool;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface SendResult {
  delivered: number;
  removed: number;
  error?: string;
}

export function sanitizeTargets(raw: unknown): PushTarget[] {
  if (!Array.isArray(raw)) return [];
  const out: PushTarget[] = [];
  for (const item of raw.slice(0, 50)) {
    if (!item || typeof item !== 'object') continue;
    const t = item as Record<string, unknown>;
    const endpoint = typeof t.endpoint === 'string' ? t.endpoint : '';
    const p256dh = typeof t.p256dh === 'string' ? t.p256dh : '';
    const auth = typeof t.auth === 'string' ? t.auth : '';
    if (
      endpoint.startsWith('https://') && endpoint.length <= 1024 &&
      p256dh.length > 0 && p256dh.length <= 512 &&
      auth.length > 0 && auth.length <= 256
    ) {
      out.push({ endpoint, p256dh, auth });
    }
  }
  return out;
}

/** True when the user turned every in-app notification preference off — push stays silent.
    notify_sms is about SMS delivery, not push, and defaults false — it must not silence pushes. */
export async function allNotificationsOff(userId: string): Promise<boolean> {
  const pool = db();
  if (!pool) return false; /* cannot check — send (same behavior as no DATABASE_URL) */
  try {
    const { rows } = await pool.query<{ s: string[] | null }>(
      `select array(select key from jsonb_each_text(to_jsonb(us)) where key like 'notify\_%' and key <> 'notify_sms' and value = 'false') as s
         from user_settings us where us.user_id = $1`,
      [userId]
    );
    const flags = rows[0]?.s;
    return Array.isArray(flags) && flags.length > 0;
  } catch {
    return false;
  }
}

/**
 * Deliver a notification to the given subscriptions.
 * Dead subscriptions (404/410 from the push service) are deleted when
 * DATABASE_URL is available; otherwise they are left for the next run.
 */
export async function sendToSubscriptions(
  payload: { title: string; body: string; url?: string; tag?: string },
  subs: PushTarget[]
): Promise<SendResult> {
  const configError = ensureVapidConfigured();
  if (configError) return { delivered: 0, removed: 0, error: configError };

  if (subs.length === 0) return { delivered: 0, removed: 0 };

  const notification = JSON.stringify({
    title: payload.title || 'enotes',
    body: payload.body || '',
    url: payload.url || '/notifications',
    tag: payload.tag,
  });

  let delivered = 0;
  const dead: PushTarget[] = [];

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          notification,
          { TTL: 86400 }
        );
        delivered++;
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          dead.push(sub);
        }
        /* other failures are transient — keep the subscription */
      }
    })
  );

  let removed = 0;
  if (dead.length > 0) {
    const pool = db();
    if (pool) {
      try {
        const endpoints = dead.map((s) => s.endpoint);
        const res = await pool.query(
          'delete from push_subscriptions where endpoint = any($1)',
          [endpoints]
        );
        removed = res.rowCount ?? 0;
      } catch {
        /* cleanup is best-effort; the push service 404/410s again next time */
      }
    }
  }

  return { delivered, removed };
}
