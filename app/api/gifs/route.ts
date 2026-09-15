const TENOR_API = 'https://tenor.googleapis.com/v2';
const GIPHY_API = 'https://api.giphy.com/v1';

export const dynamic = 'force-dynamic';

/**
 * GET /api/gifs?query=cats            → search (or trending when no query)
 *
 * Provider is selected by env vars — nothing is hardcoded:
 *   NEXT_PUBLIC_GIF_PROVIDER = 'tenor' | 'giphy' | 'none'  (client visibility)
 *   TENOR_API_KEY            = Google Cloud key with Tenor API enabled (free)
 *   GIPHY_API_KEY            = Giphy SDK key (free)
 *
 * Both providers have generous free tiers; with no keys the endpoint returns
 * an empty result and the UI hides the GIF pickers.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get('query') || '').trim().slice(0, 80);
  const pos = searchParams.get('pos') || '';
  const provider = (process.env.NEXT_PUBLIC_GIF_PROVIDER || '').toLowerCase();

  if (provider !== 'tenor' && provider !== 'giphy') {
    return Response.json({ provider: 'none', gifs: [], next: null });
  }

  try {
    if (provider === 'tenor') {
      const key = process.env.TENOR_API_KEY;
      if (!key) return Response.json({ provider: 'tenor', gifs: [], next: null, error: 'TENOR_API_KEY missing' });

      const params = new URLSearchParams({
        key,
        client_key: 'enotes',
        limit: '24',
        media_filter: 'gif',
        contentfilter: 'off',
      });
      if (query) params.set('q', query);
      else params.set('random', 'false'); // trending endpoint
      if (pos) params.set('pos', pos);

      const endpoint = query ? `${TENOR_API}/search` : `${TENOR_API}/featured`;
      const res = await fetch(`${endpoint}?${params.toString()}`, { next: { revalidate: 60 } });
      if (!res.ok) throw new Error(`Tenor responded ${res.status}`);
      const data = await res.json();

      const gifs = (data.results || []).map((r: any) => ({
        id: r.id,
        preview: r.media_formats?.tinygif?.url || r.media_formats?.gif?.url,
        url: r.media_formats?.gif?.url || r.media_formats?.mediumgif?.url,
        width: r.media_formats?.gif?.dims?.[0] || 200,
        height: r.media_formats?.gif?.dims?.[1] || 200,
        description: r.content_description || '',
      }));
      return Response.json({ provider, gifs, next: data.next || null });
    }

    // giphy
    const key = process.env.GIPHY_API_KEY;
    if (!key) return Response.json({ provider: 'giphy', gifs: [], next: null, error: 'GIPHY_API_KEY missing' });

    const params = new URLSearchParams({
      api_key: key,
      limit: '24',
      rating: 'pg',
      bundle: 'messaging_non_clips',
    });
    if (pos) params.set('offset', String(parseInt(pos, 10) || 0));
    const offset = Number(pos) || 0;

    const endpoint = query
      ? `${GIPHY_API}/gifs/search?${params.toString()}&q=${encodeURIComponent(query)}&offset=${offset}`
      : `${GIPHY_API}/gifs/trending?${params.toString()}&offset=${offset}`;

    const res = await fetch(endpoint, { next: { revalidate: 60 } });
    if (!res.ok) throw new Error(`Giphy responded ${res.status}`);
    const data = await res.json();

    const gifs = (data.data || []).map((g: any) => ({
      id: g.id,
      preview: g.images?.fixed_width_small?.url || g.images?.fixed_width?.url,
      url: g.images?.original?.url || g.images?.downsized_medium?.url,
      width: Number(g.images?.original?.width) || 200,
      height: Number(g.images?.original?.height) || 200,
      description: g.title || '',
    }));
    return Response.json({
      provider: 'giphy',
      gifs,
      next: gifs.length === 24 ? String(offset + 24) : null,
    });
  } catch (err: any) {
    return Response.json(
      { provider, gifs: [], next: null, error: err?.message || 'GIF provider request failed' },
      { status: 200 }
    );
  }
}
