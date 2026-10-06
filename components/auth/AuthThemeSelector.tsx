'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Monitor, Moon, Palette, Sparkles, Sun, Waves, Trees } from 'lucide-react';
import { ThemeMode, useTheme } from '@/lib/theme';

const OPTIONS: { value: ThemeMode; label: string; description: string; icon: React.ReactNode }[] = [
  { value: 'system', label: 'System', description: 'Follow your device', icon: <Monitor className="h-4 w-4" /> },
  { value: 'light', label: 'Light', description: 'Soft enotes light', icon: <Sun className="h-4 w-4" /> },
  { value: 'dark', label: 'Dark', description: 'Low-light friendly', icon: <Moon className="h-4 w-4" /> },
  { value: 'ocean', label: 'Ocean', description: 'Cool blue workspace', icon: <Waves className="h-4 w-4" /> },
  { value: 'retro', label: 'Retro', description: 'Warm paper tones', icon: <Sparkles className="h-4 w-4" /> },
  { value: 'forest', label: 'Forest', description: 'Calm green palette', icon: <Trees className="h-4 w-4" /> },
];

export default function AuthThemeSelector() {
  const { mode, setMode } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const current = OPTIONS.find((option) => option.value === mode) ?? OPTIONS[0];

  return (
    <div ref={rootRef} className="relative z-50">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Theme: ${current.label}`}
        className="inline-flex min-h-10 items-center gap-2 rounded-xl border auth-border auth-surface px-3 text-xs font-semibold auth-ink shadow-sm transition hover:border-[var(--auth-accent)] hover:bg-[var(--auth-input-hover)] focus:outline-none focus:ring-4 focus:ring-[var(--auth-accent)]/10"
      >
        <Palette className="h-4 w-4 auth-accent" aria-hidden="true" />
        <span className="hidden sm:inline">{current.label}</span>
        <ChevronDown className={`h-3.5 w-3.5 auth-subtle transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Choose theme"
          className="absolute right-0 top-[calc(100%+0.5rem)] w-[min(18rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-7rem)] overflow-y-auto overflow-x-hidden sm:max-h-[calc(100dvh-2rem)] rounded-2xl border auth-border auth-surface p-1.5 shadow-[0_18px_50px_rgba(17,17,17,.16)]"
        >
          <div className="px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] auth-subtle">Appearance</p>
            <p className="mt-0.5 text-xs auth-muted">Choose how enotes looks on this device.</p>
          </div>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-1 sm:gap-0.5">
            {OPTIONS.map((option) => {
              const selected = mode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => {
                    setMode(option.value);
                    setOpen(false);
                  }}
                  className="flex min-w-0 items-center gap-2 rounded-xl px-2.5 py-2 text-left transition hover:bg-[var(--auth-input-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--auth-accent)]/20 sm:gap-3 sm:px-3 sm:py-2.5"
                >
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border auth-border sm:h-9 sm:w-9 ${selected ? 'bg-[var(--auth-accent)]/10 auth-accent' : 'auth-surface auth-muted'}`}>
                    {option.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold auth-ink sm:text-[13px]">{option.label}</span>
                    <span className="hidden truncate text-[11px] auth-muted sm:block">{option.description}</span>
                  </span>
                  {selected && <Check className="h-3.5 w-3.5 shrink-0 auth-accent sm:h-4 sm:w-4" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
