import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/studio/coverr-audio
 *
 * Server-side proxy for Coverr's audio catalog. The API key never reaches
 * the browser. Coverr exposes royalty-free music programmatically; enotes
 * keeps the provider metadata on the timeline so exports know where a track
 * came from.
 *
 * Required Vercel env:
 *   COVERR_API_KEY=...
 *
 * Query:
 *   q       search text
 *   page    1-based UI page (Coverr itself is 0-based)
 *   sort    popular | date
 */
export async function GET(request: Request) {
  const apiKey = String(process.env.COVERR_API_KEY || '').trim();
  if (!apiKey) {
    return NextResponse.json({
      configured: false,
      provider: 'coverr',
      results: [],
      page: 1,
      pages: 1,
      count: 0,
      error: 'COVERR_API_KEY is not configured.',
    });
  }

  const { searchParams } = new URL(request.url);
  const query = String(searchParams.get('q') || '').trim().slice(0, 100);
  const page = Math.max(1, Number(searchParams.get('page') || '1') || 1);
  const sort = searchParams.get('sort') === 'date' ? 'date' : 'popular';

  const params = new URLSearchParams({
    page: String(page - 1),
    page_size: '24',
    sort,
  });
  if (query) params.set('query', query);

  try {
    const response = await fetch('https://api.coverr.co/audios?' + params.toString(), {
      headers: {
        Authorization: 'Bearer ' + apiKey,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    const body = await response.text();
    if (!response.ok) {
      return NextResponse.json(
        { configured: true, provider: 'coverr', results: [], error: 'Coverr returned HTTP ' + response.status + '.', detail: body.slice(0, 500) },
        { status: 502 },
      );
    }

    const data = JSON.parse(body) as {
      page?: number;
      pages?: number;
      total?: number;
      hits?: Array<Record<string, unknown>>;
    };

    const results = (Array.isArray(data.hits) ? data.hits : [])
      .map((item) => {
        const urls = item.urls && typeof item.urls === 'object' ? item.urls as Record<string, unknown> : {};
        const genres = Array.isArray(item.genres) ? item.genres.map(String) : [];
        const moods = Array.isArray(item.moods) ? item.moods.map(String) : [];
        const tags = Array.isArray(item.tags) ? item.tags.map(String) : [];
        const preview = typeof urls.preview === 'string' && urls.preview
          ? urls.preview
          : typeof urls.previewDownload === 'string' && urls.previewDownload
            ? urls.previewDownload
            : '';

        return {
          id: String(item.id || ''),
          title: String(item.title || item.name || 'Untitled'),
          artist: 'Coverr',
          url: preview,
          duration_seconds: Number(item.duration || 0),
          category: genres[0] || 'Music',
          license: 'Coverr royalty-free music',
          source: 'https://coverr.co/',
          tags: [...genres, ...moods, ...tags].slice(0, 12),
          description: String(item.description || ''),
          provider: 'coverr',
          licenseUrl: 'https://coverr.co/license',
          waveform: Array.isArray(item.waveform) ? item.waveform.map(Number).filter(Number.isFinite) : [],
          premium: Boolean(item.isPremium),
        };
      })
      .filter((item) => item.id);

    return NextResponse.json({
      configured: true,
      provider: 'coverr',
      results,
      page,
      pages: Math.max(1, Number(data.pages || 1)),
      count: Number(data.total || results.length),
    });
  } catch (error) {
    return NextResponse.json(
      { configured: true, provider: 'coverr', results: [], error: error instanceof Error ? error.message : 'Coverr request failed.' },
      { status: 502 },
    );
  }
}
