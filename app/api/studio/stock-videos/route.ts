import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function clean(value: string | null, max = 80) {
  return (value || '').trim().slice(0, max);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = clean(searchParams.get('query'));
  const page = Math.max(1, Number(searchParams.get('page') || '1') || 1);
  const orientation = clean(searchParams.get('orientation'), 12);
  const apiKey = process.env.PEXELS_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { provider: 'pexels', videos: [], nextPage: null, error: 'PEXELS_API_KEY is missing.' },
      { status: 200 },
    );
  }

  const params = new URLSearchParams({
    query: query || 'nature',
    page: String(page),
    per_page: '20',
  });

  if (orientation === 'landscape' || orientation === 'portrait' || orientation === 'square') {
    params.set('orientation', orientation);
  }

  try {
    const response = await fetch(`https://api.pexels.com/v1/videos/search?${params.toString()}`, {
      headers: { Authorization: apiKey, Accept: 'application/json' },
      next: { revalidate: 300 },
    });

    if (!response.ok) {
      throw new Error(`Pexels responded ${response.status}`);
    }

    const data = await response.json();
    const videos = (Array.isArray(data?.videos) ? data.videos : [])
      .map((video: any) => {
        const files = Array.isArray(video?.video_files) ? video.video_files : [];
        const usable = files
          .filter((f: any) => typeof f?.link === 'string')
          .sort((a: any, b: any) => {
            const aArea = Number(a?.width || 0) * Number(a?.height || 0);
            const bArea = Number(b?.width || 0) * Number(b?.height || 0);
            return Math.abs(aArea - 1920 * 1080) - Math.abs(bArea - 1920 * 1080);
          })[0];

        if (!video?.id || !usable?.link) return null;

        return {
          id: String(video.id),
          url: String(usable.link),
          thumbnail: String(video.image || ''),
          width: Number(usable.width || video.width || 0),
          height: Number(usable.height || video.height || 0),
          duration: Number(video.duration || 0),
          sourceUrl: String(video.url || ''),
          photographer: String(video.user?.name || 'Pexels'),
          provider: 'pexels',
        };
      })
      .filter(Boolean);

    return NextResponse.json({
      provider: 'pexels',
      videos,
      nextPage: videos.length >= 20 ? page + 1 : null,
    });
  } catch (error) {
    return NextResponse.json({
      provider: 'pexels',
      videos: [],
      nextPage: null,
      error: error instanceof Error ? error.message : 'Pexels request failed.',
    });
  }
}
