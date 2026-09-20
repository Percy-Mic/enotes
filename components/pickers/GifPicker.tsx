'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Search, Sparkles } from 'lucide-react';

export interface GifItem {
  id: string;
  url: string;
  preview?: string;
  width: number;
  height: number;
  description?: string;
  source?: 'giphy';
}

interface GifPickerProps {
  onPick: (gif: GifItem) => void;
  className?: string;
}

interface ApiResponse {
  provider?: string;
  gifs?: GifItem[];
  next?: string | null;
  error?: string;
}

export default function GifPicker({ onPick, className = '' }: GifPickerProps) {
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [gifs, setGifs] = useState<GifItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (q: string, offset = 0, append = false) => {
    const id = ++requestId.current;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (q) params.set('query', q);
      if (offset) params.set('offset', String(offset));

      const response = await fetch(`/api/gifs?${params.toString()}`, {
        cache: 'no-store',
      });
      const data = (await response.json()) as ApiResponse;

      if (id !== requestId.current) return;
      if (!response.ok || data.error) throw new Error(data.error || 'Could not load GIFs.');

      const incoming = Array.isArray(data.gifs) ? data.gifs : [];
      setGifs((current) => (append ? [...current, ...incoming] : incoming));
      setNext(data.next || null);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err instanceof Error ? err.message : 'Could not load GIFs.');
      if (!append) setGifs([]);
    } finally {
      if (id === requestId.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    void load(activeQuery);
  }, [activeQuery, load]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setActiveQuery(query.trim().slice(0, 80));
  };

  const clearSearch = () => {
    setQuery('');
    setActiveQuery('');
  };

  return (
    <div className={`flex h-full min-h-0 flex-col bg-white ${className}`}>
      <form onSubmit={submit} className="flex items-center gap-2 border-b border-[#eadfe2] p-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8c777d]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search GIFs…"
            className="h-10 w-full rounded-xl border border-[#eadfe2] bg-[#fffafd] pl-9 pr-3 text-sm text-[#2a211d] outline-none transition focus:border-[#e5798f] focus:ring-2 focus:ring-[#e5798f]/15"
            aria-label="Search GIFs"
          />
        </div>
        <button type="submit" className="h-10 rounded-xl bg-[#2A211D] px-3 text-xs font-bold text-white">
          Search
        </button>
        {activeQuery && (
          <button type="button" onClick={clearSearch} className="h-10 rounded-xl border border-[#eadfe2] px-3 text-xs font-semibold text-[#5d4b51]">
            Trending
          </button>
        )}
      </form>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#927d83]">
          <span>{activeQuery ? `Results for “${activeQuery}”` : 'Trending GIFs'}</span>
          <span className="flex items-center gap-1"><Sparkles className="h-3 w-3" /> GIPHY</span>
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-xs text-[#806e73]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading GIFs…
          </div>
        ) : error ? (
          <div className="m-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            <p className="font-bold">GIFs could not be loaded.</p>
            <p className="mt-1 break-words">{error}</p>
            <button type="button" onClick={() => void load(activeQuery)} className="mt-2 rounded-lg bg-red-600 px-3 py-1.5 font-bold text-white">
              Try again
            </button>
          </div>
        ) : gifs.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-[#806e73]">
            No GIFs found.
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {gifs.map((gif) => (
                  <button
                    key={gif.id}
                    type="button"
                    title={gif.description || 'Add GIF'}
                    onClick={() => onPick(gif)}
                    className="group relative aspect-square overflow-hidden rounded-xl bg-[#f5eef0] ring-offset-2 transition hover:ring-2 hover:ring-[#e5798f] focus:outline-none focus:ring-2 focus:ring-[#e5798f]"
                  >
                    <img
                      src={gif.preview || gif.url}
                      alt={gif.description || 'GIF'}
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                      className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.03]"
                    />
                    <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-full bg-black/65 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-white backdrop-blur-sm">
                      GIF
                    </span>
                  </button>
                ))}
              </div>

              {next && (
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => void load(activeQuery, Number(next), true)}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[#eadfe2] py-2.5 text-xs font-bold text-[#5d4b51] disabled:opacity-50"
                >
                  {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
