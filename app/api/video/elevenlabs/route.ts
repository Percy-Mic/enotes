import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API = 'https://api.elevenlabs.io';

async function saveAudio(db: any, userId: string, response: Response) {
  const bytes = await response.arrayBuffer();
  const path = userId + '/elevenlabs/' + Date.now() + '-' + crypto.randomUUID() + '.mp3';
  const uploaded = await db.storage.from('studio-media').upload(path, bytes, {
    contentType: response.headers.get('content-type') || 'audio/mpeg',
    upsert: false,
  });
  if (uploaded.error) throw new Error(uploaded.error.message);
  const signed = await db.storage.from('studio-media').createSignedUrl(path, 3600);
  if (signed.error || !signed.data?.signedUrl) throw new Error('Could not create audio URL.');
  return { url: signed.data.signedUrl, storage_path: path };
}

export async function GET(request: Request) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return NextResponse.json({ error: 'ELEVENLABS_API_KEY is not configured.' }, { status: 503 });
  const action = new URL(request.url).searchParams.get('action') || 'voices';
  const path = action === 'models' ? '/v1/models' : '/v2/voices?page_size=100';
  const response = await fetch(API + path, { headers: { 'xi-api-key': key }, cache: 'no-store' });
  const json = await response.json();
  return NextResponse.json(json, { status: response.status });
}

export async function POST(request: Request) {
  try {
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) return NextResponse.json({ error: 'ELEVENLABS_API_KEY is not configured.' }, { status: 503 });
    const db = await createClient();
    const auth = await db.auth.getUser();
    if (!auth.data.user) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 });

    const body = await request.json();
    const action = String(body.action || '');
    const text = String(body.text || '').trim();
    if (!text) return NextResponse.json({ error: 'Text is required.' }, { status: 400 });

    let endpoint = '';
    let payload: Record<string, unknown> = { text };

    if (action === 'text-to-speech') {
      const voiceId = String(body.voice_id || process.env.ELEVENLABS_VOICE_ID || '').trim();
      if (!voiceId) return NextResponse.json({ error: 'voice_id is required.' }, { status: 400 });
      endpoint = '/v1/text-to-speech/' + encodeURIComponent(voiceId) + '?output_format=mp3_44100_128';
      payload = {
        text,
        model_id: String(body.model_id || 'eleven_multilingual_v2'),
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true },
      };
    } else if (action === 'sound-effect') {
      endpoint = '/v1/sound-generation';
      payload = { text, duration_seconds: body.duration_seconds == null ? null : Number(body.duration_seconds), prompt_influence: 0.3 };
    } else if (action === 'music') {
      endpoint = '/v1/music';
      payload = {
        prompt: text,
        music_length_ms: Math.max(3000, Math.min(300000, Number(body.music_length_ms || 30000))),
        force_instrumental: Boolean(body.force_instrumental ?? true),
      };
    } else {
      return NextResponse.json({ error: 'Unsupported action.' }, { status: 400 });
    }

    const response = await fetch(API + endpoint, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    if (!response.ok) {
      const raw = await response.text();
      return NextResponse.json({ error: raw || 'ElevenLabs request failed.' }, { status: response.status });
    }

    const saved = await saveAudio(db, auth.data.user.id, response);
    return NextResponse.json({ configured: true, provider: 'elevenlabs', action, ...saved });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'ElevenLabs request failed.' }, { status: 502 });
  }
}
