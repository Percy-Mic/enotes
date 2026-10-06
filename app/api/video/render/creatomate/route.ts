import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { VideoProject } from '@/lib/video/project';
import { collectCreatomateSources, projectToCreatomate, type CreatomateResolution } from '@/lib/video/creatomate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API = 'https://api.creatomate.com/v2/renders';

async function getAuth() {
  const db = await createClient();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) throw new Error('You must be signed in.');
  return { db, user: data.user };
}

async function resolveSources(db: Awaited<ReturnType<typeof createClient>>, project: VideoProject) {
  const out: Record<string, string> = {};
  const items = [
    ...project.clips.map((c) => ({ src: c.src, path: c.storage_path })),
    ...project.audio.map((a) => ({ src: a.src, path: a.storage_path })),
    ...project.elements.filter((e) => e.src).map((e) => ({ src: e.src!, path: e.storage_path })),
  ];
  for (const item of items) {
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
    const key = process.env.CREATOMATE_API_KEY;
    if (!key) return NextResponse.json({ configured: false, error: 'CREATOMATE_API_KEY is not configured.' }, { status: 503 });

    const { db, user } = await getAuth();
    const body = await request.json() as {
      action?: 'start' | 'status';
      project?: VideoProject;
      renderId?: string;
      resolutionHeight?: CreatomateResolution;
    };

    if (body.action === 'status') {
      if (!body.renderId) return NextResponse.json({ error: 'renderId is required.' }, { status: 400 });
      const response = await fetch(`${API}/${encodeURIComponent(body.renderId)}`, {
        headers: { Authorization: `Bearer ${key}` },
        cache: 'no-store',
      });
      const json = await response.json();
      return NextResponse.json(json, { status: response.status });
    }

    if (!body.project) return NextResponse.json({ error: 'project is required.' }, { status: 400 });
    const sources = await resolveSources(db, body.project);
    const script = projectToCreatomate(body.project, sources, body.resolutionHeight || 1080);
    const response = await fetch(API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(script),
      cache: 'no-store',
    });
    const json = await response.json();
    if (!response.ok) {
      return NextResponse.json({ error: json?.error_message || json?.message || 'Creatomate rejected the render.', provider: 'creatomate' }, { status: response.status });
    }
    return NextResponse.json({ configured: true, provider: 'creatomate', ...json, user_id: user.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Creatomate render failed.';
    return NextResponse.json({ configured: Boolean(process.env.CREATOMATE_API_KEY), error: message }, { status: /signed|storage|source/i.test(message) ? 424 : 500 });
  }
}
