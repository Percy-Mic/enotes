'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2, Search } from 'lucide-react';

export interface GifItem {
  id: string;
  preview: string;
  url: string;
  width: number;
  height: number;
  description: string;
}

interface GifPickerProps {
  onPick: (gif: GifItem) => void;
  className?: string;
}

/**
 * GIF browser backed by /api/gifs (Tenor or Giphy, chosen by env vars).
 * When no provider is configured the picker explains how to enable it
 * instead of showing a fake grid.
 */
export default function GifPicker({ onPick, className = '' }: GifPickerProps) {
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<GifItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<string>('none');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (q: string, cursor: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q) params.set('query', q);
      if (cursor) params.set('pos', cursor);
      const res = await fetch(`/api/gifs?${params.toString()}`);
      const data = await res.json();
      setProvider(data.provider || 'none');
      if (data.error) setError(data.error);
      setGifs((prev) => (cursor ? [...prev, ...(data.gifs || [])] : data.gifs || []));
      setNextCursor(data.next || null);
    } catch {
      setError('Could not load GIFs — check your connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(query.trim(), null), 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, load]);

  if (provider === 'none') {
    return (
      <div className={`w-72 max-w-[min(18rem,calc(100vw-2rem))] rounded-2xl border border-[#E8E2E4] bg-white p-4 shadow-xl ${className}`}>
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <AlertCircle className="h-4 w-4 text-amber-500" /> GIFs not configured
        </div>
        <p className="text-xs leading-relaxed text-[#6B6B6B]">
          GIF search needs a free API key. Pick one provider and add these to
          <code className="mx-1 rounded bg-gray-100 px-1 py-0.5">.env.local</code>:
        </p>
        <ul className="mt-2 space-y-1 text-[11px] text-[#6B6B6B]">
          <li>
            <b>Tenor</b> — <code>TENOR_API_KEY=…</code> +{' '}
            <code>NEXT_PUBLIC_GIF_PROVIDER=tenor</code>
          </li>
          <li>
            <b>Giphy</b> — <code>GIPHY_API_KEY=…</code> +{' '}
            <code>NEXT_PUBLIC_GIF_PROVIDER=giphy</code>
          </li>
        </ul>
        <p className="mt-2 text-[11px] text-[#9B9B9B]">
          Both are free for normal app usage. Restart the dev server afterwards.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`flex w-72 max-w-[min(18rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-[#E8E2E4] bg-white shadow-xl ${className}`}
      role="dialog"
      aria-label="GIF picker"
    >
      <div className="relative border-b border-[#F0EAEC] p-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9B9B9B]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={query ? '' : 'Search GIFs…'}
          className="w-full rounded-lg border border-[#E8E2E4] py-2 pl-9 pr-3 text-sm focus:border-[#1E90FF] focus:outline-none"
          aria-label="Search GIFs"
        />
      </div>

      <div className="no-scrollbar max-h-64 overflow-y-auto p-2">
        {error && !loading && (
          <p className="flex items-center gap-1.5 p-2 text-xs text-red-500">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
          </p>
        )}
        {loading && gifs.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-[#9B9B9B]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading GIFs…
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {gifs.map((gif) => (
              <button
                key={gif.id}
                onClick={() => onPick(gif)}
                className="overflow-hidden rounded-lg border border-[#F0EAEC] bg-[#F8F4F6] transition hover:ring-2 hover:ring-[#E5798F] active:scale-95"
                aria-label={`Add GIF ${gif.description || gif.id}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={gif.preview}
                  alt={gif.description || 'GIF'}
                  loading="lazy"
                  className="h-28 w-full object-cover"
                />
              </button>
            ))}
          </div>
        )}
        {nextCursor && !loading && (
          <button
            onClick={() => load(query.trim(), nextCursor)}
            className="mt-2 w-full rounded-lg border border-[#E8E2E4] py-2 text-xs font-semibold text-[#6B6B6B] transition hover:bg-gray-50"
          >
            Load more
          </button>
        )}
      </div>
    </div>
  );
}
