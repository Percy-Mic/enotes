import { NextResponse } from 'next/server';

const GIPHY_API = 'https://api.giphy.com/v1';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function cleanText(value: string | null): string {
  return (value || '').trim().slice(0, 80);
}

function number(value: unknown, fallback = 200): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = cleanText(searchParams.get('query'));
  const rawOffset = Number(searchParams.get('offset') || '0');
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? Math.floor(rawOffset) : 0;
  const key = process.env.GIPHY_API_KEY;

  if (!key) {
    return NextResponse.json(
      { provider: 'giphy', gifs: [], next: null, error: 'GIPHY_API_KEY is missing.' },
      { status: 200 },
    );
  }

  const params = new URLSearchParams({
    api_key: key,
    limit: '24',
    rating: 'pg',
    offset: String(offset),
  });

  const endpoint = query
    ? `${GIPHY_API}/gifs/search`
    : `${GIPHY_API}/gifs/trending`;

  if (query) params.set('q', query);

  try {
    const response = await fetch(`${endpoint}?${params.toString()}`, {
      next: { revalidate: 60 },
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`GIPHY responded ${response.status}${body ? `: ${body.slice(0, 160)}` : ''}`);
    }

    const data = await response.json();

    const gifs = (Array.isArray(data?.data) ? data.data : [])
      .map((gif: any) => {
        const images = gif?.images || {};
        const original = images.original;
        const preview =
          images.fixed_width_small ||
          images.fixed_width ||
          images.preview_gif ||
          images.downsized_small;
        const url = original?.url || images.downsized_medium?.url || images.downsized?.url;

        if (!gif?.id || !url) return null;

        return {
          id: String(gif.id),
          url: String(url),
          preview: String(preview?.url || url),
          width: number(original?.width || preview?.width),
          height: number(original?.height || preview?.height),
          description: String(gif?.title || gif?.alt_text || ''),
          source: 'giphy',
        };
      })
      .filter(Boolean);

    const hasMore = gifs.length === 24;

    return NextResponse.json({
      provider: 'giphy',
      gifs,
      next: hasMore ? String(offset + gifs.length) : null,
    });
  } catch (error) {
    console.error('GIPHY API error:', error);
    return NextResponse.json(
      {
        provider: 'giphy',
        gifs: [],
        next: null,
        error: error instanceof Error ? error.message : 'GIPHY request failed.',
      },
      { status: 200 },
    );
  }
}
