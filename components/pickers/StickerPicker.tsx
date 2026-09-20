'use client';

import React, { useMemo, useState } from 'react';

export interface StickerPickerProps {
  onPick: (value: string) => void;
  className?: string;
}

const STICKERS = [
  ['heart', '♥'], ['heartOutline', '♡'], ['star', '★'], ['starSmall', '✦'],
  ['flower', '✿'], ['flower2', '❀'], ['flower3', '❁'], ['butterfly', '🦋'],
  ['rose', '🌹'], ['tulip', '🌷'], ['sunflower', '🌻'], ['leaf', '🍃'],
  ['clover', '☘'], ['coffee', '☕'], ['music', '♫'], ['music2', '♪'],
  ['moon', '☾'], ['sun', '☀'], ['cloud', '☁'], ['envelope', '✉'],
  ['bow', '🎀'], ['camera', '📷'], ['smile', '☺'], ['pencil', '✎'],
  ['peace', '☮'], ['sparkle', '✨'], ['sparkles', '✧'], ['diamond', '◆'],
  ['diamondOutline', '◇'], ['arrow', '➳'], ['feather', '❧'], ['swirl', '⌁'],
  ['check', '✓'], ['cross', '✕'], ['sun2', '☼'],
] as const;

export default function StickerPicker({ onPick, className = '' }: StickerPickerProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return STICKERS;
    return STICKERS.filter(([name, glyph]) => name.toLowerCase().includes(q) || glyph.includes(q));
  }, [query]);

  return (
    <div className={`flex max-h-72 min-h-0 flex-col ${className}`}>
      <div className="shrink-0 border-b bg-[#FFFDF9] p-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search stickers…"
          className="h-9 w-full rounded-lg border border-[#D8C9BA] bg-white px-3 text-xs outline-none focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
          aria-label="Search stickers"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-6">
          {filtered.map(([name, glyph]) => (
            <button
              key={name}
              type="button"
              title={name}
              aria-label={`Add ${name} sticker`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onPick(glyph); }}
              className="flex aspect-square min-h-12 items-center justify-center rounded-xl border border-transparent bg-[#FFF8FB] text-3xl leading-none transition hover:border-pink-200 hover:bg-pink-50 active:scale-95"
            >
              <span aria-hidden="true">{glyph}</span>
            </button>
          ))}
        </div>
        {!filtered.length && <p className="py-8 text-center text-xs text-gray-400">No stickers found.</p>}
      </div>
    </div>
  );
}
