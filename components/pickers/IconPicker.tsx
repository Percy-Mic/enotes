'use client';

import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { ICON_LIBRARY } from '@/lib/assets';

interface IconPickerProps {
  onPick: (iconId: string) => void;
  className?: string;
}

export default function IconPicker({ onPick, className = '' }: IconPickerProps) {
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    if (!query.trim()) return ICON_LIBRARY;
    const q = query.trim().toLowerCase();
    return ICON_LIBRARY.filter(
      (icon) =>
        icon.label.toLowerCase().includes(q) ||
        icon.keywords.some((k) => k.includes(q))
    );
  }, [query]);

  return (
    <div
      className={`flex w-72 flex-col overflow-hidden rounded-2xl border border-[#E8E2E4] bg-white shadow-xl ${className}`}
      role="dialog"
      aria-label="Icon picker"
    >
      <div className="relative border-b border-[#F0EAEC] p-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9B9B9B]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search icons…"
          className="w-full rounded-lg border border-[#E8E2E4] py-2 pl-9 pr-3 text-sm focus:border-[#1E90FF] focus:outline-none"
          aria-label="Search icons"
        />
      </div>

      <div className="no-scrollbar grid max-h-56 grid-cols-6 gap-1 overflow-y-auto p-2">
        {visible.map((icon) => (
          <button
            key={icon.id}
            onClick={() => onPick(icon.id)}
            title={icon.label}
            className="flex aspect-square items-center justify-center rounded-lg p-2 text-stone-700 transition hover:scale-105 hover:bg-[#FFF7F8] active:scale-95"
            aria-label={`Add ${icon.label} icon`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-full w-full">
              {icon.paths.map((d, i) => (
                <path key={i} d={d} />
              ))}
            </svg>
          </button>
        ))}
        {visible.length === 0 && (
          <p className="col-span-6 py-8 text-center text-xs text-[#9B9B9B]">No icons match “{query}”.</p>
        )}
      </div>
    </div>
  );
}

/** Renders a stored icon element by id (used by the canvas + book viewer). */
export function IconGlyph({ iconId, className }: { iconId: string; className?: string }) {
  const icon = ICON_LIBRARY.find((i) => i.id === iconId);
  if (!icon) return <span className={className}>✦</span>;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-label={icon.label}
      role="img"
    >
      {icon.paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
