'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';

/**
 * App theme: light · dark · ocean · retro · forest (+ system).
 *
 * - Concrete themes set data-theme on <html> directly.
 * - `system` tracks prefers-color-scheme live (light ⇄ dark), announced
 *   through data-theme too so every consumer reads one attribute.
 * - Persisted in localStorage under `enotes:theme` and mirrored to the
 *   signed-in user's settings row (user_settings.theme) when it differs —
 *   the DB column already exists (text, default 'system').
 * - retro is a per-device choice (localStorage only), because it is a
 *   cosmetic mood, not an account preference.
 *
 * FOUC: an inline script in app/layout.tsx reads the same localStorage key
 * before paint; this provider only takes over afterwards.
 */

export type ConcreteTheme = 'light' | 'dark' | 'ocean' | 'retro' | 'forest';
export type ThemeMode = ConcreteTheme | 'system';

export const THEME_STORAGE_KEY = 'enotes:theme';

const CONCRETE: readonly ConcreteTheme[] = ['light', 'dark', 'ocean', 'retro', 'forest'];

const DB_THEMES: Record<ThemeMode, string> = {
  light: 'light',
  dark: 'dark',
  ocean: 'ocean',
  retro: 'retro',
  forest: 'forest',
  system: 'system',
};

function readStored(): ThemeMode {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (raw && (CONCRETE as readonly string[]).includes(raw)) return raw as ThemeMode;
    if (raw === 'system') return 'system';
  } catch { /* storage unavailable */ }
  return 'system';
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined'
    && !!window.matchMedia
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** The concrete theme a mode resolves to right now. */
export function resolveTheme(mode: ThemeMode): ConcreteTheme {
  if (mode === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return mode;
}

function applyToDocument(mode: ThemeMode) {
  const theme = resolveTheme(mode);
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme === 'dark' || theme === 'ocean' ? 'dark' : 'light';
}

interface ThemeContextValue {
  mode: ThemeMode;
  /** concrete resolved theme ('light' | 'dark' | 'ocean' | 'retro' | 'forest') */
  resolved: ConcreteTheme;
  setMode: (mode: ThemeMode) => void;
  /** cycles light → dark → ocean → retro → forest → system (one-tap toggles) */
  cycle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const CYCLE: ThemeMode[] = ['light', 'dark', 'ocean', 'retro', 'forest', 'system'];

/** Themes mirrored to user_settings (cosmetic moods like retro stay local). */
const DB_SYNCED: readonly ThemeMode[] = ['light', 'dark', 'ocean', 'forest', 'system'];

function mirrorToAccount(next: ThemeMode) {
  if (!DB_SYNCED.includes(next)) return;
  void (async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from('user_settings')
      .upsert(
        { user_id: user.id, theme: DB_THEMES[next] },
        { onConflict: 'user_id', ignoreDuplicates: false }
      );
  })();
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('system');

  /* adopt the pre-paint choice on mount */
  useEffect(() => {
    const stored = readStored();
    setModeState(stored);
    applyToDocument(stored);
  }, []);

  /* live-follow the OS while in system mode */
  useEffect(() => {
    if (mode !== 'system' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyToDocument('system');
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    applyToDocument(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch { /* private mode */ }
    mirrorToAccount(next);
  }, []);

  const cycle = useCallback(() => {
    setModeState((current) => {
      const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];
      applyToDocument(next);
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch { /* private mode */ }
      mirrorToAccount(next);
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolved: resolveTheme(mode), setMode, cycle }),
    [mode, setMode, cycle]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
