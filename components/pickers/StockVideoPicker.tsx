'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Download, Loader2, Search, Video } from 'lucide-react';

export interface StockVideoItem {
  id: string;
  url: string;
  preview: string | null;
  width: number;
  height: number;
  duration: number;
  photographer: string;
  pexelsUrl: string;
}

interface Props {
  onPick: (video: StockVideoItem) => void;
  className?: string;
}

export default function StockVideoPicker({ onPick, className = '' }: Props) {
  const [query, setQuery] = useState('nature');
  const [activeQuery, setActiveQuery] = useState('nature');
  const [orientation, setOrientation] = useState('');
  const [videos, setVideos] = useState<StockVideoItem[]>([]);
  const [page, setPage] = useState(1);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (q: string, p: number, append = false) => {
    append ? setLoadingMore(true) : setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ query: q || 'nature', page: String(p) });
      if (orientation) params.set('orientation', orientation);
      const res = await fetch(`/api/stock/videos?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Could not load stock videos.');
      setVideos((old) => append ? [...old, ...(data.videos || [])] : (data.videos || []));
      setPage(p);
      setNext(data.next ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load stock videos.');
      if (!append) setVideos([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [orientation]);

  useEffect(() => { void load(activeQuery, 1); }, [activeQuery, orientation, load]);

  return (
    <div className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] ${className}`}>
      <form
        onSubmit={(e) => { e.preventDefault(); setActiveQuery(query.trim().slice(0, 80)); }}
        className="flex items-center gap-2 border-b border-white/10 p-2"
      >
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search stock video…"
            className="h-9 w-full rounded-lg border border-white/10 bg-black/20 pl-9 pr-3 text-xs text-white outline-none focus:border-[#E5798F]"
          />
        </div>
        <button className="rounded-lg bg-[#E5798F] px-3 py-2 text-xs font-bold text-white">Search</button>
      </form>

      <div className="flex items-center gap-1.5 overflow-x-auto border-b border-white/10 p-2">
        {[
          ['', 'All'],
          ['portrait', 'Portrait'],
          ['landscape', 'Landscape'],
          ['square', 'Square'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setOrientation(id)}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${orientation === id ? 'bg-white text-black' : 'bg-white/10 text-white/65'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex min-h-40 items-center justify-center gap-2 text-xs text-white/45">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading stock footage…
        </div>
      ) : error ? (
        <div className="m-3 rounded-lg border border-red-300/20 bg-red-400/10 p-3 text-xs text-red-100">
          <p className="font-semibold">Stock footage unavailable</p>
          <p className="mt-1 break-words text-red-100/70">{error}</p>
        </div>
      ) : videos.length === 0 ? (
        <div className="flex min-h-40 items-center justify-center text-xs text-white/45">No footage found.</div>
      ) : (
        <div className="max-h-72 overflow-y-auto overscroll-contain p-2" style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {videos.map((video) => (
              <button
                key={video.id}
                type="button"
                onClick={() => onPick(video)}
                className="group relative aspect-video overflow-hidden rounded-lg bg-black ring-offset-2 transition hover:ring-2 hover:ring-[#E5798F] focus:outline-none focus:ring-2 focus:ring-[#E5798F]"
                title={video.photographer ? `Use video by ${video.photographer}` : 'Use stock video'}
              >
                {video.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={video.preview} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <Video className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 text-white/40" />
                )}
                <span className="absolute inset-x-1.5 bottom-1.5 flex items-center justify-between rounded-md bg-black/65 px-1.5 py-1 text-[8px] font-bold text-white backdrop-blur">
                  <span>{Math.round(video.duration)}s</span>
                  <Download className="h-3 w-3" />
                </span>
              </button>
            ))}
          </div>
          {next && (
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => void load(activeQuery, page + 1, true)}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 py-2.5 text-xs font-semibold text-white/70 disabled:opacity-50"
            >
              {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
          <p className="mt-2 text-center text-[9px] text-white/35">
            Stock footage by Pexels · tap a clip to add it to your timeline.
          </p>
        </div>
      )}
    </div>
  );
}
