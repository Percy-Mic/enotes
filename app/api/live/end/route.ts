/* ============================================================
   POST /api/live/end — beacon fallback for the host.

   The normal path marks the stream ended in LiveBroadcast.finish().
   This route covers the tab dying mid-broadcast (close, crash,
   navigation): navigator.sendBeacon fires here and the stream is
   closed server-side so viewers don't hang on a ghost stream.

   sendBeacon can't attach an Authorization header, so the session
   cookie is the credential (same class as /calls/[callId]/end).
   ============================================================ */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: { streamId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const streamId = typeof body.streamId === 'string' ? body.streamId : '';
  if (!streamId) {
    return NextResponse.json({ error: 'streamId is required' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  /* The .eq('host_id', …) makes this a no-op for anyone else's stream —
     RLS would block it anyway, but be explicit about intent. */
  const { error } = await supabase
    .from('live_streams')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('id', streamId)
    .eq('host_id', user.id)
    .eq('status', 'live');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
