import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/* ============================================================
   POST /api/studio/import-sounds — admin-only sound library import.

   Uses Freesound (freesound.org) CC0 search results and mirrors the
   audio into our own Storage bucket, so playback never depends on
   their CDN. Every row carries FULL license metadata (requirements
   66/67): license type, rights holder, commercial flag, attribution.

   INERT UNTIL CONFIGURED: needs FREESOUND_API_KEY (free —
   https://freesound.org/apiv2/apply). No paid service involved.

   Env:
     FREESOUND_API_KEY=…
   Body:
     { "query": "ambient loop", "category": "ambient", "limit": 8 }
   ============================================================ */

const CATEGORY_QUERIES: Record<string, string> = {
  trending: 'popular loop',
  cinematic: 'cinematic drone',
  chill: 'chill lofi loop',
  emotional: 'emotional piano',
  happy: 'happy ukulele',
  romantic: 'romantic guitar',
  electronic: 'electronic synth loop',
  ambient: 'ambient pad',
  acoustic: 'acoustic folk',
  lofi: 'lofi beat',
  dramatic: 'dramatic tension',
  corporate: 'corporate upbeat',
  gaming: '8bit game loop',
  nature: 'nature birds forest',
  sfx: 'whoosh click pop',
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  /* server-side admin check — client role flags are never trusted */
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  }

  if (!process.env.FREESOUND_API_KEY) {
    return NextResponse.json(
      { error: 'FREESOUND_API_KEY is not set (free key: freesound.org/apiv2/apply).', configured: false },
      { status: 501 }
    );
  }

  let body: { query?: string; category?: string; limit?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const category = body.category && CATEGORY_QUERIES[body.category] ? body.category : 'ambient';
  const query = (body.query || CATEGORY_QUERIES[category]).slice(0, 80);
  const limit = Math.min(Math.max(body.limit ?? 6, 1), 12);

  /* 1) search CC0-only sounds */
  const searchUrl = new URL('https://freesound.org/apiv2/search/text/');
  searchUrl.searchParams.set('query', `${query} license:"Creative Commons 0"`);
  searchUrl.searchParams.set('filter', 'duration:[2 TO 120]');
  searchUrl.searchParams.set('page_size', String(limit * 2));
  searchUrl.searchParams.set('fields', 'id,name,previews,duration,license,username');
  searchUrl.searchParams.set('token', process.env.FREESOUND_API_KEY);

  const searchRes = await fetch(searchUrl);
  if (!searchRes.ok) {
    return NextResponse.json({ error: `Freesound search failed (${searchRes.status})` }, { status: 502 });
  }
  const searchJson = (await searchRes.json()) as {
    results: {
      id: number; name: string; duration: number; license: string; username: string;
      previews: { 'preview-hq-mp3': string };
    }[];
  };

  /* skip sounds already imported (by freesound id in rights metadata) */
  const { data: existing } = await supabase.from('sounds').select('url');
  const known = new Set((existing || []).map((s) => s.url));

  let imported = 0;
  const errors: string[] = [];

  for (const sound of searchJson.results) {
    if (imported >= limit) break;
    const previewUrl = sound.previews?.['preview-hq-mp3'];
    if (!previewUrl) continue;

    try {
      /* 2) mirror the audio into our bucket */
      const audioRes = await fetch(previewUrl);
      if (!audioRes.ok) continue;
      const buf = await audioRes.arrayBuffer();
      if (buf.byteLength < 1024) continue; // corrupt/empty

      const path = `${category}/freesound-${sound.id}.mp3`;
      const { error: upErr } = await supabase.storage
        .from('sounds')
        .upload(path, buf, { contentType: 'audio/mpeg', upsert: true });
      if (upErr && !upErr.message.includes('exists')) throw upErr;

      const { data: pub } = supabase.storage.from('sounds').getPublicUrl(path);
      const publicUrl = pub.publicUrl;
      if (known.has(publicUrl)) continue;

      /* 3) insert with complete license metadata */
      const isCc0 = sound.license?.includes('zero') || sound.license?.includes('cc0');
      const { error: insErr } = await supabase.from('sounds').insert({
        title: sound.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 80),
        artist: sound.username,
        category,
        url: publicUrl,
        duration_seconds: Math.round(sound.duration || 0),
        license_type: isCc0 ? 'cc0' : 'cc-by',
        rights_holder: `Freesound · ${sound.username}`,
        commercial_use: isCc0,
        attribution_required: !isCc0,
        restrictions: isCc0 ? null : 'CC-BY: credit the author when sharing content using this sound commercially.',
      });
      if (insErr) throw insErr;
      imported += 1;
    } catch (e) {
      errors.push(`${sound.name}: ${e instanceof Error ? e.message : 'failed'}`);
    }
  }

  return NextResponse.json({
    imported,
    searched: searchJson.results.length,
    errors,
    note: imported === 0 ? 'No new CC0 sounds matched — try another query.' : undefined,
  });
}
