import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export const MAX_HISTORY = 120;

export interface HistoryEntry<T> {
  state: T;
  label: string;
  at: number;
}

export interface HistoryApi<T> {
  state: T;
  setState: (next: T | ((prev: T) => T), label: string, coalesceKey?: string) => void;
  replaceState: (next: T, label: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  reset: (next: T, label?: string) => void;
  dirty: boolean;
  markClean: () => void;
}

interface Hist<T> {
  entries: HistoryEntry<T>[];
  cursor: number;
  clean: number;
}

/**
 * Bounded, immutable undo/redo history.
 *
 * IMPORTANT IMPLEMENTATION NOTE: everything updates ONE piece of state
 * (`hist`) through a single atomic updater. An earlier version nested
 * setEntries() calls inside setCursor()'s updater; React batches those
 * unpredictably and the entries array could end up shorter than the cursor,
 * making `state` undefined — which crashed the journal editor
 * ("reading 'pages'") and the video editor ("reading 'project'"). Updater
 * functions must stay pure; this version guarantees entries[cursor] always
 * exists.
 */
export function useHistory<T>(initial: T, limit: number = MAX_HISTORY): HistoryApi<T> {
  const [hist, setHist] = useState<Hist<T>>({
    entries: [{ state: initial, label: 'Initial', at: Date.now() }],
    cursor: 0,
    clean: 0,
  });

  /* Coalescing: consecutive commits with the same key merge into one entry
     while the key stays "hot" (≤800ms between commits) — drags, sliders and
     typing become ONE undo step instead of hundreds. */
  const lastCommit = useRef<{ key: string | undefined; at: number }>({ key: undefined, at: 0 });
  const COALESCE_WINDOW = 800;

  const state = hist.entries[hist.cursor]?.state as T;

  const setState = useCallback(
    (nextOrFn: T | ((prev: T) => T), label: string, coalesceKey?: string) => {
      const now = Date.now();
      const coalesce =
        coalesceKey !== undefined &&
        lastCommit.current.key === coalesceKey &&
        now - lastCommit.current.at < COALESCE_WINDOW;

      lastCommit.current = { key: coalesceKey, at: now };

      setHist((prev) => {
        const current = prev.entries[prev.cursor]?.state as T;
        const next = typeof nextOrFn === 'function' ? (nextOrFn as (p: T) => T)(current) : nextOrFn;
        if (next === current) return prev;

        if (coalesce) {
          /* merge into the current entry — no new history row */
          const entries = prev.entries.slice(0, prev.cursor);
          entries.push({ state: next, label, at: now });
          return { ...prev, entries, cursor: entries.length - 1 };
        }

        /* new entry, dropping any redo tail */
        let entries = [...prev.entries.slice(0, prev.cursor + 1), { state: next, label, at: now }];
        const overflow = entries.length - limit;
        if (overflow > 0) entries = entries.slice(overflow);
        const cursor = entries.length - 1;
        const clean = overflow > 0 ? Math.max(0, prev.clean - overflow) : prev.clean;
        return { entries, cursor, clean };
      });
    },
    [limit]
  );

  /** Replace the current entry WITHOUT creating history (e.g. post-save sync). */
  const replaceState = useCallback((next: T, label: string) => {
    setHist((prev) => {
      if (!prev.entries.length) return prev;
      const entries = prev.entries.slice();
      entries[prev.cursor] = { state: next, label, at: Date.now() };
      return { ...prev, entries };
    });
  }, []);

  const undo = useCallback(() => {
    lastCommit.current = { key: undefined, at: 0 };
    setHist((prev) => (prev.cursor > 0 ? { ...prev, cursor: prev.cursor - 1 } : prev));
  }, []);

  const redo = useCallback(() => {
    lastCommit.current = { key: undefined, at: 0 };
    setHist((prev) =>
      prev.cursor < prev.entries.length - 1 ? { ...prev, cursor: prev.cursor + 1 } : prev
    );
  }, []);

  /* Load fresh data (page switch, fetch from DB): wipe history so a stale
     undo can't jump back into a previous document and then get saved. */
  const reset = useCallback((next: T, label = 'Loaded') => {
    lastCommit.current = { key: undefined, at: 0 };
    setHist({ entries: [{ state: next, label, at: Date.now() }], cursor: 0, clean: 0 });
  }, []);

  const markClean = useCallback(() => {
    setHist((prev) => ({ ...prev, clean: prev.cursor }));
  }, []);

  const canUndo = hist.cursor > 0;
  const canRedo = hist.cursor < hist.entries.length - 1;
  const undoLabel = canUndo ? hist.entries[hist.cursor - 1]?.label ?? null : null;
  const redoLabel = canRedo ? hist.entries[hist.cursor + 1]?.label ?? null : null;
  const dirty = hist.cursor !== hist.clean;

  return useMemo(
    () => ({
      state,
      setState,
      replaceState,
      undo,
      redo,
      canUndo,
      canRedo,
      undoLabel,
      redoLabel,
      reset,
      dirty,
      markClean,
    }),
    [state, setState, replaceState, undo, redo, canUndo, canRedo, undoLabel, redoLabel, reset, dirty, markClean]
  );
}

/**
 * Global Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl/Cmd+Y shortcuts.
 * Skips when typing in inputs unless the region is marked
 * `data-history-scoped="true"` (the editors mark themselves).
 */
export function useHistoryShortcuts(api: {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      const key = e.key.toLowerCase();
      const isUndo = key === 'z' && !e.shiftKey;
      const isRedo = (key === 'z' && e.shiftKey) || key === 'y';
      if (!isUndo && !isRedo) return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const typing =
        tag === 'input' || tag === 'textarea' || target?.isContentEditable;
      const scoped = target?.closest?.('[data-history-scoped="true"]') != null;

      /* Inside inputs we let the browser's native undo work unless the
         editor marks the region as history-scoped. */
      if (typing && !scoped) return;

      e.preventDefault();
      if (isUndo && api.canUndo) api.undo();
      if (isRedo && api.canRedo) api.redo();
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [api]);
}
