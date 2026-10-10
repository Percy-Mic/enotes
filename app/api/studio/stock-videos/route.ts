import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Provider = 'all' | 'pexels' | 'pixabay';

function clean(value: string | null, max = 80) {
  return (value || '').trim().slice(0, max);
}

function orientationOf(value: string | null): 'all' | 'landscape' | 'portrait' | 'square' {
  return value === 'landscape' || value === 'portrait' || value === 'square' ? value : 'all';
}

function fits(width: number, height: number, orientation: 'all' | 'landscape' | 'portrait' | 'square') {
  if (orientation === 'all' || !width || !height) return true;
  const ratio = width / height;
  if (orientation === 'landscape') return ratio >= 1.15;
  if (orientation === 'portrait') return ratio <= 0.87;
  return ratio > 0.87 && ratio < 1.15;
}

async function pexels(query: string, page: number, orientation: string, key: string) {
  const params = new URLSearchParams({ query, page: String(page), per_page: '20' });
  if (orientation !== 'all') params.set('orientation', orientation);

  const response = await fetch(`https://api.pexels.com/v1/videos/search?${params}`, {
    headers: { Authorization: key, Accept: 'application/json' },
    next: { revalidate: 86400 },
  });
  if (!response.ok) throw new Error(`Pexels responded ${response.status}`);

  const data = await response.json();
  const videos = (Array.isArray(data?.videos) ? data.videos : [])
    .map((video: any) => {
      const files = Array.isArray(video?.video_files) ? video.video_files : [];
      // Canvas rendering/export requires a directly decodable progressive file.
      // Some provider variants expose non-MP4 formats or stream manifests which
      // may play in a standalone player but fail in the canvas compositor.
      const usable = files
        .filter((f: any) => {
          if (typeof f?.link !== 'string') return false;
          try {
            const link = new URL(f.link);
            return link.protocol === 'https:' &&
              (link.hostname === 'videos.pexels.com' || link.hostname.endsWith('.pexels.com')) &&
              (!f.file_type || String(f.file_type).toLowerCase().includes('mp4'));
          } catch {
            return false;
          }
        })
        .sort((a: any, b: any) => {
          const aa = Number(a?.width || 0) * Number(a?.height || 0);
          const ba = Number(b?.width || 0) * Number(b?.height || 0);
          return Math.abs(aa - 1920 * 1080) - Math.abs(ba - 1920 * 1080);
        })[0];
      if (!video?.id || !usable?.link) return null;
      return {
        id: `pexels-${video.id}`,
        url: String(usable.link),
        thumbnail: String(video.image || ''),
        width: Number(usable.width || video.width || 0),
        height: Number(usable.height || video.height || 0),
        duration: Number(video.duration || 0),
        sourceUrl: String(video.url || ''),
        photographer: String(video.user?.name || 'Pexels'),
        provider: 'pexels' as const,
      };
    })
    .filter(Boolean);

  return { videos, nextPage: videos.length >= 20 ? page + 1 : null };
}

async function pixabay(query: string, page: number, orientation: 'all' | 'landscape' | 'portrait' | 'square', key: string) {
  const params = new URLSearchParams({
    key,
    q: query,
    page: String(page),
    per_page: '20',
    safesearch: 'true',
    order: 'popular',
    video_type: 'all',
  });

  const response = await fetch(`https://pixabay.com/api/videos/?${params}`, {
    headers: { Accept: 'application/json' },
    next: { revalidate: 86400 },
  });
  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(message || `Pixabay responded ${response.status}`);
  }

  const data = await response.json();
  const videos = (Array.isArray(data?.hits) ? data.hits : [])
    .map((video: any) => {
      const sizes = video?.videos || {};
      const usable = sizes?.large?.url ? sizes.large : sizes?.medium?.url ? sizes.medium : sizes?.small;
      if (!video?.id || !usable?.url) return null;
      const width = Number(usable.width || 0);
      const height = Number(usable.height || 0);
      if (!fits(width, height, orientation)) return null;
      return {
        id: `pixabay-${video.id}`,
        url: String(usable.url),
        thumbnail: String(usable.thumbnail || ''),
        width,
        height,
        duration: Number(video.duration || 0),
        sourceUrl: String(video.pageURL || ''),
        photographer: String(video.user || 'Pixabay'),
        provider: 'pixabay' as const,
      };
    })
    .filter(Boolean);

  return {
    videos,
    nextPage: Array.isArray(data?.hits) && data.hits.length >= 20 ? page + 1 : null,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = clean(searchParams.get('query')) || 'nature';
  const page = Math.max(1, Number(searchParams.get('page') || '1') || 1);
  const orientation = orientationOf(searchParams.get('orientation'));
  const requested = searchParams.get('provider');
  const provider: Provider = requested === 'pexels' || requested === 'pixabay' ? requested : 'all';

  const pexelsKey = process.env.PEXELS_API_KEY;
  const pixabayKey = process.env.PIXABAY_API_KEY;

  if (!pexelsKey && !pixabayKey) {
    return NextResponse.json({
      provider,
      videos: [],
      nextPage: null,
      error: 'Configure PEXELS_API_KEY and/or PIXABAY_API_KEY in Vercel.',
    });
  }

  const tasks: Promise<any>[] = [];
  if ((provider === 'all' || provider === 'pexels') && pexelsKey) {
    tasks.push(pexels(query, page, orientation, pexelsKey));
  }
  if ((provider === 'all' || provider === 'pixabay') && pixabayKey) {
    tasks.push(pixabay(query, page, orientation, pixabayKey));
  }

  if (!tasks.length) {
    return NextResponse.json({
      provider,
      videos: [],
      nextPage: null,
      error: provider === 'pexels' ? 'PEXELS_API_KEY is missing.' : 'PIXABAY_API_KEY is missing.',
    });
  }

  const settled = await Promise.allSettled(tasks);
  const videos: any[] = [];
  const errors: string[] = [];
  let nextPage = false;

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      videos.push(...result.value.videos);
      nextPage ||= result.value.nextPage != null;
    } else {
      errors.push(result.reason instanceof Error ? result.reason.message : 'Stock provider failed.');
    }
  }

  if (!videos.length && errors.length) {
    return NextResponse.json({ provider, videos: [], nextPage: null, error: errors.join(' ') });
  }

  return NextResponse.json({
    provider,
    videos,
    nextPage: nextPage ? page + 1 : null,
    ...(errors.length ? { warnings: errors } : {}),
  });
}
