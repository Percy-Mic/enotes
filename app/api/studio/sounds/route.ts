import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const key = process.env.FREESOUND_API_KEY;
  if (!key) return NextResponse.json({ error: 'FREESOUND_API_KEY is not configured.' }, { status: 503 });
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || 'cinematic').trim().slice(0, 100);
  const page = Math.max(1, Number(url.searchParams.get('page') || 1));
  const api = new URL('https://freesound.org/apiv2/search/text/');
  api.searchParams.set('query', q);
  api.searchParams.set('token', key);
  api.searchParams.set('page', String(page));
  api.searchParams.set('page_size', '20');
  api.searchParams.set('fields', 'id,name,username,duration,license,previews,description');
  api.searchParams.set('filter', 'license:"Creative Commons 0"');
  const response = await fetch(api.toString(), { next: { revalidate: 86400 } });
  if (!response.ok) return NextResponse.json({ error: `Freesound request failed (${response.status}).` }, { status: 502 });
  const data = await response.json();
  const results = (data.results || []).map((item: any) => ({
    id: item.id, name: item.name, username: item.username, duration: item.duration, license: item.license,
    description: item.description,
    url: item.previews?.['preview-hq-mp3'] || item.previews?.['preview-lq-mp3'] || null,
    source: `https://freesound.org/s/${item.id}/`,
  })).filter((item: any) => item.url);
  return NextResponse.json({ results, page: data.page, pages: data.num_pages });
}