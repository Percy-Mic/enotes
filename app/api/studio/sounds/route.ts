import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_QUERY = 'cinematic';
const CC0_FILTER = 'license:"Creative Commons 0"';

export async function GET(request: Request) {
  const key = process.env.FREESOUND_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'FREESOUND_API_KEY is not configured.' }, { status: 503 });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || DEFAULT_QUERY).trim().slice(0, 100);
  const page = Math.max(1, Math.min(100, Number(url.searchParams.get('page') || 1) || 1));
  const pageSize = Math.max(1, Math.min(50, Number(url.searchParams.get('page_size') || 24) || 24));

  const api = new URL('https://freesound.org/apiv2/search/');
  api.searchParams.set('query', q);
  api.searchParams.set('token', key);
  api.searchParams.set('page', String(page));
  api.searchParams.set('page_size', String(pageSize));
  api.searchParams.set(
    'fields',
    'id,name,username,duration,license,previews,description,tags,url'
  );
  api.searchParams.set('filter', CC0_FILTER);

  try {
    const response = await fetch(api.toString(), {
      next: { revalidate: 86400 },
    });

    if (!response.ok) {
      let detail = '';
      try {
        const body = await response.json();
        detail = typeof body?.detail === 'string' ? body.detail : '';
      } catch {
        /* keep the HTTP status as the useful error */
      }
      return NextResponse.json(
        { error: detail || `Freesound request failed (${response.status}).` },
        { status: response.status === 429 ? 429 : 502 }
      );
    }

    const data = await response.json();
    const results = (Array.isArray(data.results) ? data.results : [])
      .map((item: any) => {
        const preview =
          item.previews?.['preview-hq-mp3'] ||
          item.previews?.['preview-lq-mp3'] ||
          item.previews?.['preview-hq-ogg'] ||
          item.previews?.['preview-lq-ogg'] ||
          null;

        return {
          id: Number(item.id),
          name: String(item.name || 'Untitled sound'),
          username: String(item.username || 'Freesound creator'),
          duration: Number(item.duration) || 0,
          license: String(item.license || 'Creative Commons 0'),
          description: String(item.description || ''),
          tags: Array.isArray(item.tags) ? item.tags.slice(0, 12).map(String) : [],
          url: preview,
          source: String(item.url || `https://freesound.org/s/${item.id}/`),
        };
      })
      .filter((item: any) => item.url);

    return NextResponse.json({
      results,
      count: Number(data.count) || results.length,
      page: Number(data.page) || page,
      pageSize,
      pages: Math.max(1, Math.ceil((Number(data.count) || results.length) / pageSize)),
      next: data.next || null,
      previous: data.previous || null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not reach Freesound.' },
      { status: 502 }
    );
  }
}
