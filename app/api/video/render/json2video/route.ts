import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { VideoProject } from '@/lib/video/project';
import { projectToJson2Video } from '@/lib/video/json2video';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API = 'https://api.json2video.com/v2/movies';

async function getAuth() {
  const db = await createClient();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) throw new Error('You must be signed in.');
  return { db, user: data.user };
}

async function resolveSources(db: Awaited<ReturnType<typeof createClient>>, project: VideoProject) {
  const all = [
    ...project.clips.map((c) => ({ src: c.src, path: c.storage_path })),
    ...project.audio.map((a) => ({ src: a.src, path: a.storage_path })),
    ...project.elements.filter((e) => e.src).map((e) => ({ src: e.src!, path: e.storage_path })),
  ];
  const out: Record<string, string> = {};
  for (const item of all) {
    if (item.src.startsWith('http://') || item.src.startsWith('https://')) out[item.src] = item.src;
    if (item.path) {
      const { data } = await db.storage.from('studio-media').createSignedUrl(item.path, 60 * 60);
      if (data?.signedUrl) out[item.src] = data.signedUrl;
    }
  }
  return out;
}

export async function POST(request: Request) {
  try {
    const key = process.env.JSON2VIDEO_API_KEY;
    if (!key) return NextResponse.json({ configured: false, error: 'JSON2VIDEO_API_KEY is not configured.' }, { status: 503 });
    const { db, user } = await getAuth();
    const body = await request.json() as { action?: string; project?: VideoProject; renderProject?: string; resolutionHeight?: 720|1080|1440|2160; bitrate?: number };
    if (body.action === 'status') {
      if (!body.renderProject) return NextResponse.json({ error: 'renderProject is required.' }, { status: 400 });
      const response = await fetch(`${API}?project=${encodeURIComponent(body.renderProject)}`, { headers: { 'x-api-key': key }, cache: 'no-store' });
      const json = await response.json();
      return NextResponse.json(json, { status: response.status });
    }
    if (!body.project) return NextResponse.json({ error: 'project is required.' }, { status: 400 });
    const sources = await resolveSources(db, body.project);
    const movie = projectToJson2Video(body.project, sources, body.resolutionHeight || 1080, body.bitrate || 6000000);
    movie['client-data'] = { user_id: user.id, editor: 'enotes-video-rebuild-1' };
    const response = await fetch(API, {
      method: 'POST',
      headers: { 'x-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify(movie),
      cache: 'no-store',
    });
    const json = await response.json();
    if (!response.ok) return NextResponse.json({ error: json?.message || json?.error || 'JSON2Video rejected the render.', provider: 'json2video' }, { status: response.status });
    return NextResponse.json({ configured: true, provider: 'json2video', ...json });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cloud render failed.';
    return NextResponse.json({ configured: Boolean(process.env.JSON2VIDEO_API_KEY), error: message }, { status: /signed|storage|source/i.test(message) ? 424 : 500 });
  }
}
