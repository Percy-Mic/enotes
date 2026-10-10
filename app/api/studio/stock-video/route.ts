import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Stock CDNs must be proxied through the app: some providers do not send
 * permissive CORS headers, which prevents the canvas compositor from drawing
 * their video frames. Keep the allowlist strict and preserve byte-range
 * semantics because Chromium's media decoder uses Range requests when seeking.
 */
const ALLOWED_HOSTS = new Set([
  'videos.pexels.com',
  'cdn.pixabay.com',
]);

function allowed(url: URL) {
  return url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname);
}

export async function GET(request: Request) {
  const source = new URL(request.url).searchParams.get('url');
  if (!source) return NextResponse.json({ error: 'Missing video URL.' }, { status: 400 });

  let target: URL;
  try {
    target = new URL(source);
  } catch {
    return NextResponse.json({ error: 'Invalid video URL.' }, { status: 400 });
  }
  if (!allowed(target)) {
    return NextResponse.json({ error: 'Video source is not allowed.' }, { status: 403 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const upstreamHeaders = new Headers({
      Accept: 'video/mp4,video/*;q=0.9,application/octet-stream;q=0.8,*/*;q=0.5',
      'User-Agent': 'enotes-video-editor/1.0',
    });
    const range = request.headers.get('range');
    if (range) upstreamHeaders.set('Range', range);

    const upstream = await fetch(target.toString(), {
      cache: 'no-store',
      redirect: 'follow',
      headers: upstreamHeaders,
      signal: controller.signal,
    });

    // Do not forward a CDN redirect to an unapproved host or accidentally
    // return a provider HTML page as if it were playable video.
    let finalUrl: URL;
    try {
      finalUrl = new URL(upstream.url || target.toString());
    } catch {
      return NextResponse.json({ error: 'The stock video provider returned an invalid URL.' }, { status: 502 });
    }
    if (!allowed(finalUrl)) {
      await upstream.body?.cancel().catch(() => {});
      return NextResponse.json({ error: 'The stock video redirected to an unsupported host.' }, { status: 502 });
    }
    if (!upstream.ok || !upstream.body) {
      const status = upstream.status;
      await upstream.body?.cancel().catch(() => {});
      return NextResponse.json(
        { error: `Stock video provider responded with HTTP ${status}.` },
        { status: 502 },
      );
    }

    const upstreamType = (upstream.headers.get('content-type') || '').toLowerCase();
    if (upstreamType.includes('text/html') || upstreamType.includes('application/json')) {
      await upstream.body.cancel().catch(() => {});
      return NextResponse.json({ error: 'The stock provider returned a web page instead of a video file.' }, { status: 502 });
    }

    const headers = new Headers();
    headers.set('Content-Type', upstreamType.startsWith('video/') || upstreamType === 'application/octet-stream'
      ? upstream.headers.get('content-type')!
      : 'video/mp4');
    // No wildcard CORS is required for same-origin playback, but explicitly
    // allow the editor's canvas to consume this same-origin media response.
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
    headers.set('Cache-Control', 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400');

    for (const name of ['content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (!headers.has('Accept-Ranges')) headers.set('Accept-Ranges', 'bytes');

    return new Response(upstream.body, {
      status: upstream.status === 206 ? 206 : 200,
      headers,
    });
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'The stock video provider took too long to respond. Try another clip or search again.'
      : error instanceof Error ? error.message : 'Unable to load stock video.';
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}

export async function HEAD(request: Request) {
  // Keep HEAD behavior consistent with GET so media clients can probe the URL.
  const response = await GET(new Request(request.url, { method: 'GET', headers: request.headers }));
  const headers = new Headers(response.headers);
  response.body?.cancel().catch(() => {});
  return new Response(null, { status: response.status, headers });
}
