import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const JAMENDO_API = 'https://api.jamendo.com/v3.0/tracks/';

function clean(value: string | null, max = 120) {
  return String(value || '').trim().slice(0, max);
}

type SearchMode = 'all' | 'title' | 'artist' | 'album' | 'genre';

export async function GET(request: Request) {
  try {
    const clientId = String(process.env.JAMENDO_CLIENT_ID || '').trim();
    if (!clientId) {
      return NextResponse.json(
        { error: 'Jamendo is not configured. Add JAMENDO_CLIENT_ID to your Vercel environment variables.', provider: 'jamendo' },
        { status: 503 }
      );
    }

    const { searchParams } = new URL(request.url);
    const query = clean(searchParams.get('q'));
    const category = clean(searchParams.get('category'), 80).toLowerCase();
    const mode = (clean(searchParams.get('mode'), 20).toLowerCase() || 'all') as SearchMode;
    const searchMode: SearchMode = ['all', 'title', 'artist', 'album', 'genre'].includes(mode) ? mode : 'all';
    const page = Math.max(1, Number(searchParams.get('page') || 1) || 1);
    const limit = Math.min(30, Math.max(6, Number(searchParams.get('limit') || 24) || 24));

    const api = new URL(JAMENDO_API);
    api.searchParams.set('client_id', clientId);
    api.searchParams.set('format', 'json');
    api.searchParams.set('limit', String(limit));
    api.searchParams.set('offset', String((page - 1) * limit));
    api.searchParams.set('type', 'single albumtrack');
    api.searchParams.set('audioformat', 'mp32');
    api.searchParams.set('imagesize', '200');
    api.searchParams.set('include', 'licenses musicinfo');
    api.searchParams.set('audiodlformat', 'mp32');
    api.searchParams.set('order', 'relevance');

    if (query) {
      if (searchMode === 'title') {
        api.searchParams.set('namesearch', query);
      } else if (searchMode === 'artist') {
        api.searchParams.set('artist_name', query);
      } else if (searchMode === 'album') {
        api.searchParams.set('album_name', query);
      } else if (searchMode === 'genre') {
        api.searchParams.set('fuzzytags', query);
      } else {
        // Jamendo's free-text search covers track, album, artist and tags.
        api.searchParams.set('search', query);
      }
    } else if (category && category !== 'all') {
      api.searchParams.set('fuzzytags', category);
    } else {
      api.searchParams.set('featured', '1');
    }

    const upstream = await fetch(api.toString(), {
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });

    const body = await upstream.text();
    if (!upstream.ok) {
      return NextResponse.json(
        { error: 'Jamendo API returned HTTP ' + upstream.status + '.', provider: 'jamendo' },
        { status: 502 }
      );
    }

    let json: any;
    try {
      json = JSON.parse(body);
    } catch {
      return NextResponse.json(
        { error: 'Jamendo returned an invalid response.', provider: 'jamendo' },
        { status: 502 }
      );
    }

    if (json?.headers?.status === 'failed' || Number(json?.headers?.code || 0) !== 0) {
      return NextResponse.json(
        { error: json?.headers?.error_message || 'Jamendo search failed.', provider: 'jamendo' },
        { status: 502 }
      );
    }

    const results = Array.isArray(json?.results)
      ? json.results.map((track: any) => ({
          id: String(track.id),
          title: String(track.name || 'Untitled'),
          artist: String(track.artist_name || 'Jamendo artist'),
          url: String(track.audio || ''),
          duration_seconds: Number(track.duration || 0),
          category: category || (searchMode === 'genre' ? query : 'Jamendo'),
          license: String(track.license_ccurl || track.license_name || 'Creative Commons'),
          licenseUrl: track.license_ccurl || null,
          source: track.shareurl || ('https://www.jamendo.com/track/' + track.id),
          image: track.image || track.album_image || null,
          album: track.album_name || '',
          tags: Array.isArray(track.musicinfo?.tags?.genres) ? track.musicinfo.tags.genres : [],
          audiodownload_allowed: Boolean(track.audiodownload_allowed),
          audiodownload: track.audiodownload_allowed ? String(track.audiodownload || '') : '',
          provider: 'jamendo' as const,
        })).filter((track: any) => track.url && track.duration_seconds > 0)
      : [];

    return NextResponse.json(
      {
        provider: 'jamendo',
        page,
        limit,
        mode: searchMode,
        query,
        category,
        count: Number(json?.headers?.results_count || results.length),
        results,
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not reach Jamendo.';
    return NextResponse.json({ error: message, provider: 'jamendo' }, { status: 502 });
  }
}
