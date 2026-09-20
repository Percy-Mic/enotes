'use client';

import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { ICON_LIBRARY } from '@/lib/assets';

interface IconPickerProps {
  onPick: (iconId: string) => void;
  className?: string;
}

export default function IconPicker({
  onPick,
  className = '',
}: IconPickerProps) {
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return ICON_LIBRARY;
    }

    return ICON_LIBRARY.filter((icon) => {
      const label = String(icon.label ?? '').toLowerCase();

      const keywords = Array.isArray(icon.keywords)
        ? icon.keywords.map((keyword) =>
            String(keyword).toLowerCase(),
          )
        : [];

      return (
        label.includes(normalizedQuery) ||
        keywords.some((keyword) =>
          keyword.includes(normalizedQuery),
        )
      );
    });
  }, [query]);

  return (
    <div
      className={`flex w-[min(18rem,calc(100vw-2rem))] max-w-full flex-col overflow-hidden rounded-2xl border border-[#E8E2E4] bg-white shadow-xl ${className}`}
      role="dialog"
      aria-label="Icon picker"
    >
      {/* Search */}
      <div className="relative shrink-0 border-b border-[#F0EAEC] p-2">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9B9B9B]"
          aria-hidden="true"
        />

        <input
          type="search"
          value={query}
          onChange={(event) =>
            setQuery(event.target.value)
          }
          placeholder="Search icons…"
          autoComplete="off"
          className="w-full rounded-xl border border-[#E8E2E4] bg-[#FFFCFD] py-2.5 pl-9 pr-3 text-sm text-[#2B2520] outline-none transition placeholder:text-[#AAA1A5] focus:border-[#1E90FF] focus:ring-2 focus:ring-[#1E90FF]/10"
          aria-label="Search icons"
        />
      </div>

      {/* Icons */}
      <div
        className="no-scrollbar grid max-h-64 grid-cols-6 gap-1.5 overflow-y-auto overscroll-contain p-2"
        role="list"
        aria-label="Available icons"
      >
        {visible.map((icon) => (
          <button
            key={icon.id}
            type="button"
            onClick={() => onPick(icon.id)}
            title={icon.label}
            aria-label={`Add ${icon.label} icon`}
            className="flex aspect-square min-h-10 min-w-10 items-center justify-center rounded-xl p-2 text-stone-700 outline-none transition hover:scale-105 hover:bg-[#FFF7F8] hover:text-[#1E90FF] focus-visible:ring-2 focus-visible:ring-[#1E90FF] active:scale-95"
            role="listitem"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-full w-full"
              aria-hidden="true"
            >
              {icon.paths.map((path, index) => (
                <path
                  key={`${icon.id}-${index}`}
                  d={path}
                />
              ))}
            </svg>
          </button>
        ))}

        {visible.length === 0 && (
          <div className="col-span-6 px-3 py-10 text-center">
            <div className="mb-2 text-2xl opacity-40">
              ✦
            </div>

            <p className="text-xs text-[#9B9B9B]">
              No icons match “{query}”.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Renders a stored icon element by ID.
 *
 * The canvas and book viewer should both use this component
 * so icons are rendered consistently everywhere.
 */
export function IconGlyph({
  iconId,
  className = '',
}: {
  iconId: string;
  className?: string;
}) {
  const normalizedId = String(iconId ?? '').trim();

  const icon = ICON_LIBRARY.find(
    (item) => item.id === normalizedId,
  );

  if (!icon) {
    return (
      <span
        className={className}
        aria-hidden="true"
      >
        ✦
      </span>
    );
  }

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
      {icon.paths.map((path, index) => (
        <path
          key={`${icon.id}-${index}`}
          d={path}
        />
      ))}
    </svg>
  );
}