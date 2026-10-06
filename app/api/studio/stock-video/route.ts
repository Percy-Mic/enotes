import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ALLOWED_HOSTS = new Set([
  'videos.pexels.com',
  'cdn.pixabay.com',
  'player.vimeo.com',
]);

function allowed(url: URL) {
  return url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname);
}

export async function GET(request: Request) {
  const source = new URL(request.url).searchParams.get('url');
  if (!source) return NextResponse.json({ error: 'Missing video URL.' }, { status: 400 });

  let target: URL;
  try { target = new URL(source); } catch {
    return NextResponse.json({ error: 'Invalid video URL.' }, { status: 400 });
  }
  if (!allowed(target)) return NextResponse.json({ error: 'Video source is not allowed.' }, { status: 403 });

  try {
    const requestRange = request.headers.get('range');
    const upstreamHeaders = new Headers({ Accept: 'video/*,*/*;q=0.8' });
    if (requestRange) upstreamHeaders.set('Range', requestRange);
    const upstream = await fetch(target.toString(), {
      cache: 'no-store',
      headers: upstreamHeaders,
    });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: `Stock video responded ${upstream.status}.` }, { status: 502 });
    }

    const headers = new Headers();
    const contentType = upstream.headers.get('content-type') || 'video/mp4';
    headers.set('Content-Type', contentType);
    headers.set('Cache-Control', 'private, no-store, max-age=0');
    const length = upstream.headers.get('content-length');
    if (length) headers.set('Content-Length', length);
    // Response header naming is intentionally distinct from the incoming Range request.
    const acceptRanges = upstream.headers.get('accept-ranges');
    if (acceptRanges) headers.set('Accept-Ranges', acceptRanges);
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) headers.set('Content-Range', contentRange);

    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unable to load stock video.',
    }, { status: 502 });
  }
}
