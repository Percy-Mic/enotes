import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type FeedClip = {
  id: string;
  trackId?: string;
  title: string;
  artist: string;
  album: string;
  artwork?: string;
  duration: number;
  url?: string;
};

const FEED_BASE = 'https://api.clips.feed.fm';

function clientIdFor(userId: string) {
  return ('enotes-' + userId.replace(/[^a-zA-Z0-9]/g, '')).slice(0, 23);
}

async function feedToken() {
  const token = String(process.env.FEED_CLIPS_TOKEN || '').trim();
  const secret = String(process.env.FEED_CLIPS_SECRET || '').trim();
  if (!token || !secret) return null;

  const response = await fetch(FEED_BASE + '/v2/authenticate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ token, secret }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body?.error || body?.message || 'Feed Clips authentication failed.'));
  return String(body?.token || body?.accessToken || body?.bearerToken || '');
}

function pickArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.clips)) return value.clips;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function mapClip(raw: any, collectionName?: string): FeedClip | null {
  const id = String(raw?.clipId ?? raw?.id ?? raw?.clip?.id ?? '').trim();
  if (!id) return null;
  const track = raw?.track || {};
  const artist = raw?.artist || {};
  const album = raw?.album || {};
  const title = String(raw?.title ?? raw?.name ?? raw?.trackTitle ?? track?.title ?? 'Untitled').trim();
  const artistName = String(raw?.artistName ?? raw?.artist_name ?? artist?.name ?? track?.artistName ?? 'Artist').trim();
  const albumName = String(raw?.albumName ?? raw?.album_name ?? album?.name ?? track?.albumName ?? '').trim();
  const artwork = String(raw?.artworkUrl ?? raw?.artwork_url ?? raw?.artwork ?? raw?.albumArtUrl ?? album?.artworkUrl ?? '').trim();
  const durationRaw = Number(raw?.durationMs ?? raw?.duration_ms ?? raw?.duration ?? 0);
  const duration = durationRaw > 1000 ? durationRaw / 1000 : durationRaw;

  return {
    id,
    trackId: String(raw?.trackId ?? raw?.track_id ?? track?.id ?? '').trim() || undefined,
    title,
    artist: artistName,
    album: albumName,
    artwork: artwork || undefined,
    duration: Math.max(0, duration),
    url: String(raw?.url ?? raw?.signedUrl ?? raw?.audioUrl ?? raw?.audio_url ?? raw?.clip?.url ?? '').trim() || undefined,
  };
}

async function feedRequest(pathname: string, token: string, clientId: string) {
  const url = new URL(FEED_BASE + pathname);
  if (!url.searchParams.has('clientId')) url.searchParams.set('clientId', clientId);
  const response = await fetch(url, {
    headers: { Authorization: 'Bearer ' + token, accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body?.error || body?.message || 'Feed Clips request failed (' + response.status + ').'));
  return body;
}

async function signedClips(ids: string[], token: string, clientId: string) {
  const unique = Array.from(new Set(ids)).filter(Boolean).slice(0, 24);
  if (!unique.length) return [];
  const url = new URL(FEED_BASE + '/v2/clips');
  url.searchParams.set('clipIds', unique.join(','));
  url.searchParams.set('clientId', clientId);
  const response = await fetch(url, {
    headers: { Authorization: 'Bearer ' + token, accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body?.error || body?.message || 'Feed Clips signed URL request failed (' + response.status + ').'));
  return pickArray(body).map((item) => {
    const base = item?.clip || item;
    return mapClip({ ...base, url: item?.url ?? item?.signedUrl ?? base?.url }, undefined);
  }).filter(Boolean) as FeedClip[];
}

export async function GET(request: Request) {
  const db = await createClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 });

  if (!process.env.FEED_CLIPS_TOKEN || !process.env.FEED_CLIPS_SECRET) {
    return NextResponse.json({
      configured: false,
      provider: 'feed',
      results: [],
      error: 'Licensed popular music is not connected yet. Add FEED_CLIPS_TOKEN and FEED_CLIPS_SECRET after Feed Clips onboarding.',
      setupUrl: 'https://www.feed.fm/clips/music-api',
    });
  }

  const params = new URL(request.url).searchParams;
  const query = String(params.get('q') || '').trim().slice(0, 80).toLowerCase();
  const collectionIds = String(params.get('collections') || process.env.FEED_CLIPS_COLLECTION_IDS || '')
    .split(',').map((v) => v.trim()).filter(Boolean).slice(0, 12);
  const clipId = String(params.get('clipId') || '').trim();
  const page = Math.max(1, Number(params.get('page') || 1) || 1);
  const limit = Math.min(24, Math.max(6, Number(params.get('limit') || 24) || 24));

  if (!collectionIds.length) {
    return NextResponse.json({
      configured: true,
      provider: 'feed',
      results: [],
      page,
      pages: 1,
      count: 0,
      error: 'Feed Clips is connected, but no licensed collection IDs are configured. Add FEED_CLIPS_COLLECTION_IDS from Clips Studio.',
    });
  }

  try {
    const token = await feedToken();
    if (!token) throw new Error('Feed Clips did not return a bearer token.');
    const clientId = clientIdFor(auth.user.id);

    if (clipId) {
      const hydrated = await signedClips([clipId], token, clientId);
      const item = hydrated[0];
      return NextResponse.json({
        configured: true,
        provider: 'feed',
        results: item?.url ? [{
          id: item.id,
          providerId: item.id,
          title: item.title,
          artist: item.artist,
          album: item.album,
          image: item.artwork || null,
          url: item.url,
          duration_seconds: Math.min(60, Math.max(0.1, item.duration || 30)),
          category: 'Popular',
          license: 'Feed Clips licensed music',
          licenseUrl: 'https://www.feed.fm/clips/music-api',
          source: 'https://www.feed.fm/clips/music-api',
          provider: 'feed',
          tags: ['popular', 'licensed'],
          commercialUse: true,
          syncLicense: true,
          expires: true,
        }] : [],
      });
    }

    const collectionResults = await Promise.all(collectionIds.map(async (id) => ({
      id,
      body: await feedRequest('/v2/collections/' + encodeURIComponent(id) + '/clips', token, clientId),
    })));

    const candidates: FeedClip[] = [];
    for (const collection of collectionResults) {
      for (const item of pickArray(collection.body)) {
        const mapped = mapClip(item, collection.id);
        if (mapped) candidates.push(mapped);
      }
    }

    const unique = new Map<string, FeedClip>();
    for (const item of candidates) {
      const haystack = [item.title, item.artist, item.album].join(' ').toLowerCase();
      if (query && !haystack.includes(query)) continue;
      if (!unique.has(item.id)) unique.set(item.id, item);
    }

    const all = [...unique.values()];
    const start = (page - 1) * limit;
    const visible = all.slice(start, start + limit);
    const hydrated = await signedClips(visible.map((x) => x.id), token, clientId);
    const byId = new Map(hydrated.map((x) => [x.id, x]));

    return NextResponse.json({
      configured: true,
      provider: 'feed',
      page,
      pages: Math.max(1, Math.ceil(all.length / limit)),
      count: all.length,
      results: visible
        .map((item) => {
          const fresh = byId.get(item.id);
          const url = fresh?.url || item.url || '';
          return {
            id: item.id,
            providerId: item.id,
            title: item.title,
            artist: item.artist,
            album: item.album,
            image: item.artwork || null,
            url,
            duration_seconds: Math.min(60, Math.max(0.1, fresh?.duration || item.duration || 30)),
            category: 'Popular',
            license: 'Feed Clips licensed music',
            licenseUrl: 'https://www.feed.fm/clips/music-api',
            source: 'https://www.feed.fm/clips/music-api',
            provider: 'feed',
            tags: ['popular', 'licensed'],
            commercialUse: true,
            syncLicense: true,
            expires: true,
          };
        })
        .filter((item) => item.url),
    });
  } catch (error) {
    return NextResponse.json({
      configured: true,
      provider: 'feed',
      results: [],
      error: error instanceof Error ? error.message : 'Feed Clips request failed.',
    }, { status: 502 });
  }
}
