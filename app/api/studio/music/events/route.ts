import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE = 'https://api.clips.feed.fm';

function clientIdFor(userId: string) {
  return ('enotes-' + userId.replace(/[^a-zA-Z0-9]/g, '')).slice(0, 23);
}

async function authenticate() {
  const token = String(process.env.FEED_CLIPS_TOKEN || '').trim();
  const secret = String(process.env.FEED_CLIPS_SECRET || '').trim();
  if (!token || !secret) return null;
  const response = await fetch(BASE + '/v2/authenticate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ token, secret }),
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body?.error || body?.message || 'Feed authentication failed.'));
  return String(body?.token || body?.accessToken || body?.bearerToken || '');
}

export async function POST(request: Request) {
  const db = await createClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const clipId = String(body?.clipId || '').trim();
  const event = String(body?.event || '').trim();
  const platform = String(body?.platform || '').trim();
  if (!clipId || !['play', 'preview', 'add', 'share', 'download'].includes(event)) {
    return NextResponse.json({ error: 'clipId and a supported event are required.' }, { status: 400 });
  }

  if (!process.env.FEED_CLIPS_TOKEN || !process.env.FEED_CLIPS_SECRET) {
    return NextResponse.json({ configured: false });
  }

  try {
    const bearer = await authenticate();
    if (!bearer) throw new Error('Feed Clips authentication failed.');
    const clientId = clientIdFor(auth.user.id);
    const timestamp = new Date().toISOString();
    let path = '';
    let payload: Record<string, unknown> = { clientId, timestamp };

    if (event === 'play') {
      path = '/v2/clips/' + encodeURIComponent(clipId) + '/play';
      payload = { ...payload, method: 'Sync', offline: false };
    } else if (event === 'preview') {
      path = '/v2/clips/' + encodeURIComponent(clipId) + '/preview';
    } else if (event === 'add') {
      path = '/v2/clips/' + encodeURIComponent(clipId) + '/add';
      payload = { ...payload, method: 'Sync' };
    } else if (event === 'share') {
      path = '/v2/clips/' + encodeURIComponent(clipId) + '/share';
      payload = { ...payload, platform: platform || 'web', shareUri: String(body?.shareUri || '') };
    } else {
      path = '/v2/clips/' + encodeURIComponent(clipId) + '/download';
    }

    const response = await fetch(BASE + path, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + bearer,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    const responseBody = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json({ configured: true, ok: false, error: responseBody?.error || responseBody?.message || 'Feed event failed.' }, { status: 502 });
    }
    return NextResponse.json({ configured: true, ok: true });
  } catch (error) {
    return NextResponse.json({ configured: true, ok: false, error: error instanceof Error ? error.message : 'Feed event failed.' }, { status: 502 });
  }
}
