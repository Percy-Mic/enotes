import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API = 'https://api.elevenlabs.io';

export async function GET(request: Request) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return NextResponse.json({ error: 'ELEVENLABS_API_KEY is not configured.' }, { status: 503 });
  const action = new URL(request.url).searchParams.get('action') || 'voices';
  if (action !== 'voices' && action !== 'models') return NextResponse.json({ error: 'Unsupported action.' }, { status: 400 });
  const path = action === 'voices' ? '/v2/voices?page_size=100' : '/v1/models';
  const response = await fetch(API + path, { headers: { 'xi-api-key': key }, cache: 'no-store' });
  const json = await response.json();
  return NextResponse.json(json, { status: response.status });
}

export async function POST(request: Request) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return NextResponse.json({ error: 'ELEVENLABS_API_KEY is not configured.' }, { status: 503 });
  const body = await request.json();
  const action = String(body.action || '');
  if (action !== 'text-to-speech' && action !== 'sound-effect' && action !== 'music') {
    return NextResponse.json({ error: 'Unsupported action.' }, { status: 400 });
  }
  return NextResponse.json({ configured: true, provider: 'elevenlabs', action });
}
