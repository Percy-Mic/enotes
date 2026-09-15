'use client';

import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { STICKER_CATEGORY_LABELS, STICKER_LIBRARY, type StickerCategory } from '@/lib/assets';

interface StickerPickerProps {
  onPick: (value: string) => void;
  className?: string;
}

export default function StickerPicker({ onPick, className = '' }: StickerPickerProps) {
  const [category, setCategory] = useState<StickerCategory>('hearts');
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      const all = Object.entries(STICKER_LIBRARY).flatMap(([, stickers]) => stickers);
      return all.filter((s) => s.label.toLowerCase().includes(q)).slice(0, 48);
    }
    return STICKER_LIBRARY[category];
  }, [query, category]);

  return (
    <div
      className={`flex w-72 flex-col overflow-hidden rounded-2xl border border-[#E8E2E4] bg-white shadow-xl ${className}`}
      role="dialog"
      aria-label="Sticker picker"
    >
      <div className="relative border-b border-[#F0EAEC] p-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9B9B9B]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search stickers…"
          className="w-full rounded-lg border border-[#E8E2E4] py-2 pl-9 pr-3 text-sm focus:border-[#1E90FF] focus:outline-none"
          aria-label="Search stickers"
        />
      </div>

      {!query && (
        <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-[#F0EAEC] px-2 py-1.5">
          {(Object.keys(STICKER_LIBRARY) as StickerCategory[]).map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold ${
                category === cat ? 'bg-black/5' : 'text-[#6B6B6B] hover:bg-gray-50'
              }`}
            >
              {STICKER_CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>
      )}

      <div className="no-scrollbar grid max-h-56 grid-cols-6 gap-1 overflow-y-auto p-2">
        {visible.map((s, i) => (
          <button
            key={`${s.value}-${i}`}
            onClick={() => onPick(s.value)}
            title={s.label}
            className={`flex aspect-square items-center justify-center rounded-lg text-2xl transition hover:scale-105 hover:bg-[#FFF7F8] active:scale-95 ${s.className || ''}`}
            aria-label={`Add ${s.label} sticker`}
          >
            {s.value}
          </button>
        ))}
        {visible.length === 0 && (
          <p className="col-span-6 py-8 text-center text-xs text-[#9B9B9B]">No stickers match “{query}”.</p>
        )}
      </div>
    </div>
  );
}
