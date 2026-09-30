'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Smile } from 'lucide-react';
import { EMOJI_GROUPS, EMOJI_KEYWORDS, type EmojiCategory } from '@/lib/assets';

const RECENTS_KEY = 'enotes:recent-emojis';
const MAX_RECENTS = 24;

function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function rememberEmoji(emoji: string) {
  try {
    const recents = loadRecents().filter((e) => e !== emoji);
    recents.unshift(emoji);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents.slice(0, MAX_RECENTS)));
  } catch {
    /* storage unavailable — recents are best-effort */
  }
}

interface EmojiPickerProps {
  onPick: (emoji: string) => void;
  onClose?: () => void;
  className?: string;
}

export default function EmojiPicker({ onPick, className = '' }: EmojiPickerProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<EmojiCategory>('smileys');
  const [recents, setRecents] = useState<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRecents(loadRecents());
  }, []);

  useEffect(() => {
    /* Autofocus pops the virtual keyboard on touch devices, covering the
       just-opened sheet — only auto-focus for mouse/keyboard users. */
    if (window.matchMedia('(pointer: fine)').matches) {
      searchRef.current?.focus();
    }
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;

    /*
     * Real keyword search first ('laugh' → 😂), then word prefixes and
     * substrings, then category labels and the glyph itself so every emoji
     * stays reachable even without a keyword entry.
     */
    const ranked: string[] = [];
    const push = (emojis: string[] | undefined) => {
      if (!emojis) return;
      for (const e of emojis) if (!ranked.includes(e)) ranked.push(e);
    };

    push(EMOJI_KEYWORDS[q]);
    for (const [word, emojis] of Object.entries(EMOJI_KEYWORDS)) {
      if (word !== q && word.startsWith(q)) push(emojis);
    }
    if (q.length >= 3) {
      for (const [word, emojis] of Object.entries(EMOJI_KEYWORDS)) {
        if (word !== q && !word.startsWith(q) && word.includes(q)) push(emojis);
      }
    }
    const matches = EMOJI_GROUPS
      .filter((group) => group.label.toLowerCase().includes(q))
      .flatMap((group) => group.emojis);
    push(matches);

    const glyphMatches = EMOJI_GROUPS
      .flatMap((group) => group.emojis)
      .filter((emoji) => emoji.toLowerCase().includes(q));
    push(glyphMatches);

    return ranked.slice(0, 120);
  }, [query]);

  const pick = (emoji: string) => {
    rememberEmoji(emoji);
    setRecents(loadRecents());
    onPick(emoji);
  };

  return (
    <div
      className={`flex h-full min-h-0 w-full max-w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-[#E8E2E4] bg-white shadow-xl sm:w-80 ${className}`}
      role="dialog"
      aria-label="Emoji picker"
    >
      <div className="relative border-b border-[#F0EAEC] p-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9B9B9B]" />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search emojis…"
          className="w-full rounded-lg border border-[#E8E2E4] py-2 pl-9 pr-3 text-sm focus:border-[#1E90FF] focus:outline-none"
          aria-label="Search emojis"
        />
      </div>

      <div
        className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto border-b border-[#F0EAEC] px-2 py-1.5"
        style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-x' }}
      >
        <button
          onClick={() => setQuery('')}
          className={`shrink-0 rounded-lg px-2 py-1 text-xs font-semibold ${!query ? 'bg-black/5' : ''}`}
        >
          <Smile className="inline h-4 w-4" />
        </button>
        {EMOJI_GROUPS.map((g) => (
          <button
            key={g.category}
            onClick={() => {
              setQuery('');
              setCategory(g.category);
            }}
            className={`shrink-0 rounded-lg px-2 py-1 text-xs font-semibold ${
              !query && category === g.category ? 'bg-black/5' : ''
            }`}
            title={g.label}
          >
            {g.emojis[0]}
          </button>
        ))}
      </div>

      <div
        className="min-h-0 flex-1 grid grid-cols-8 gap-0.5 overflow-y-auto overscroll-contain p-2"
        style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y', scrollbarWidth: 'thin' }}
      >
        {recents.length > 0 && !query && category === 'smileys' && (
          <>
            <div className="col-span-8 px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-[#9B9B9B]">
              Recent
            </div>
            {recents.map((e) => (
              <button
                key={`recent-${e}`}
                onClick={() => pick(e)}
                className="flex aspect-square items-center justify-center rounded-lg text-xl transition hover:bg-[#FFF7F8] active:scale-90"
                aria-label={`Insert ${e}`}
              >
                {e}
              </button>
            ))}
          </>
        )}
        {filtered === null
          ? (EMOJI_GROUPS.find((g) => g.category === category)?.emojis || []).map((e) => (
              <button
                key={e}
                onClick={() => pick(e)}
                className="flex aspect-square min-h-9 items-center justify-center rounded-lg text-[21px] leading-none transition hover:bg-[#FFF7F8] active:scale-90 sm:text-[22px]"
                aria-label={`Insert ${e}`}
              >
                {e}
              </button>
            ))
          : filtered.map((e) => (
          <button
            key={e}
            onClick={() => pick(e)}
            className="flex aspect-square min-h-9 items-center justify-center rounded-lg text-[21px] leading-none transition hover:bg-[#FFF7F8] active:scale-90 sm:text-[22px]"
            aria-label={`Insert ${e}`}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
