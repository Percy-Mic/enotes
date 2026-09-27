import { NextResponse } from 'next/server';

const PEXELS_API = 'https://api.pexels.com/v1/videos/search';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function clean(value: string | null, max = 80) {
  return (value || '').trim().slice(0, max);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = clean(searchParams.get('query') || 'nature', 80);
  const page = Math.max(1, Number(searchParams.get('page') || '1') || 1);
  const orientation = clean(searchParams.get('orientation'), 12);
  const key = process.env.PEXELS_API_KEY;

  if (!key) {
    return NextResponse.json(
      { provider: 'pexels', videos: [], page, next: null, error: 'PEXELS_API_KEY is missing.' },
      { status: 200 },
    );
  }

  const params = new URLSearchParams({
    query,
    page: String(page),
    per_page: '18',
  });
  if (orientation === 'landscape' || orientation === 'portrait' || orientation === 'square') {
    params.set('orientation', orientation);
  }

  try {
    const response = await fetch(`${PEXELS_API}?${params.toString()}`, {
      cache: 'no-store',
      headers: { Authorization: key, Accept: 'application/json' },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Pexels responded ${response.status}${body ? `: ${body.slice(0, 160)}` : ''}`);
    }

    const data = await response.json();
    const videos = (Array.isArray(data?.videos) ? data.videos : []).map((video: any) => {
      const files = Array.isArray(video?.video_files) ? video.video_files : [];
      const usable = files
        .filter((f: any) => f?.link && (!f?.file_type || String(f.file_type).includes('video')))
        .sort((a: any, b: any) => {
          const aScore = Math.abs((Number(a.width) || 0) - 1280);
          const bScore = Math.abs((Number(b.width) || 0) - 1280);
          return aScore - bScore;
        })[0];

      const preview = video?.video_pictures?.[0]?.picture;
      if (!video?.id || !usable?.link) return null;

      return {
        id: String(video.id),
        url: String(usable.link),
        preview: preview ? String(preview) : null,
        width: Number(usable.width) || Number(video.width) || 1280,
        height: Number(usable.height) || Number(video.height) || 720,
        duration: Number(video.duration) || 5,
        photographer: String(video?.user?.name || ''),
        pexelsUrl: String(video?.url || 'https://www.pexels.com/videos/'),
      };
    }).filter(Boolean);

    const total = Number(data?.total_results) || 0;
    const hasMore = videos.length > 0 && page * 18 < total;

    return NextResponse.json({
      provider: 'pexels',
      videos,
      page,
      next: hasMore ? page + 1 : null,
    });
  } catch (error) {
    console.error('Pexels video API error:', error);
    return NextResponse.json({
      provider: 'pexels',
      videos: [],
      page,
      next: null,
      error: error instanceof Error ? error.message : 'Pexels request failed.',
    });
  }
}
