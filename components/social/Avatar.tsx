'use client';

import React from 'react';

interface AvatarProps {
  src?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
}

const SIZES: Record<number, string> = {
  32: 'h-8 w-8 text-xs',
  40: 'h-10 w-10 text-sm',
  48: 'h-12 w-12 text-base',
};

export default function Avatar({ src, name, size = 40, className = '' }: AvatarProps) {
  const initials =
    (name || '?')
      .split(/\s+/)
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?';

  const sizeClass = SIZES[size] || 'h-10 w-10 text-sm';

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name || 'avatar'}
        className={`${sizeClass} shrink-0 rounded-full border border-[#E8E2E4] object-cover ${className}`}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} flex shrink-0 select-none items-center justify-center rounded-full bg-gradient-to-br from-[#FFD9E1] to-[#F5B8C4] font-bold text-[#8B3A56] ${className}`}
      aria-hidden
    >
      {initials}
    </div>
  );
}
