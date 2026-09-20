/* ============================================================
   POST /api/push/send — server-only Web Push dispatcher.

   Called by the notify_push DB trigger (via pg_net) whenever a row
   lands in `notifications`. The trigger (SECURITY DEFINER) selects
   the recipient's push_subscriptions rows itself and attaches them
   as `targets`; this route never needs a service-role key. It reads
   the app-generated notification message text (trigger-supplied,
   already committed to the notifications table) and forwards it.

   Body: { userId, title?, body?, url?, tag?, targets: [{ endpoint, p256dh, auth }] }

   Runtime: Node (web-push needs Node crypto). Free-tier friendly:
   no third-party provider — the browser's own push service carries
   the notification. Dead subscriptions are cleaned up via
   DATABASE_URL when present.
   ============================================================ */

import { NextResponse } from 'next/server';
import { sendToSubscriptions, sanitizeTargets, allNotificationsOff, type PushTarget } from '@/lib/notifications/send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SendBody {
  userId?: string;
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  targets?: unknown;
}

export async function POST(req: Request) {
  const secret = process.env.PUSH_SEND_SECRET;
  const provided = req.headers.get('x-push-send-secret');

  if (!secret) {
    return NextResponse.json({ error: 'Push delivery is not configured (missing PUSH_SEND_SECRET).' }, { status: 500 });
  }
  if (provided !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: SendBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.userId || typeof body.userId !== 'string' || body.userId.length > 128) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  const targets: PushTarget[] = sanitizeTargets(body.targets);

  /* Respect the recipient's notification preferences: when every notify_*
     setting is off, push stays silent (parity with the Edge Function). */
  if (targets.length > 0 && (await allNotificationsOff(body.userId))) {
    return NextResponse.json({ delivered: 0, removed: 0, skipped: 'all notification preferences off' });
  }

  const result = await sendToSubscriptions(
    {
      title: typeof body.title === 'string' ? body.title.slice(0, 200) : 'enotes',
      body: typeof body.body === 'string' ? body.body.slice(0, 2000) : '',
      url: typeof body.url === 'string' && body.url.startsWith('/') ? body.url : '/notifications',
      tag: typeof body.tag === 'string' ? body.tag.slice(0, 128) : undefined,
    },
    targets
  );

  /* 200 with delivered:0 when a user has no subscriptions (the common
     case — push is opt-in); 502 only when sending itself failed. */
  const status = result.error ? 502 : 200;
  return NextResponse.json(result, { status });
}
