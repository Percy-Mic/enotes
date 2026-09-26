'use client';

import { supabase } from '@/lib/supabase/client';

export type QuietDuration = 30 | 60 | 120 | 0;
export const QUIET_DB_NAME = 'enotes-notifications';
export const QUIET_STORE_NAME = 'settings';
export const QUIET_KEY = 'quiet-mode';
export type QuietState = { userId: string | null; until: number | null };

function openQuietDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(QUIET_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(QUIET_STORE_NAME)) db.createObjectStore(QUIET_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open notification settings.'));
  });
}

export async function getQuietState(): Promise<QuietState> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return { userId: null, until: null };
  try {
    const db = await openQuietDb();
    const value = await new Promise<QuietState | null>((resolve, reject) => {
      const tx = db.transaction(QUIET_STORE_NAME, 'readonly');
      const request = tx.objectStore(QUIET_STORE_NAME).get(QUIET_KEY);
      request.onsuccess = () => resolve((request.result as QuietState | undefined) || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    // A stored null value means "quiet indefinitely".
    // Only a past timestamp means the timed quiet period has expired.
    if (!value) return { userId: null, until: null };
    if (value.until !== null && value.until <= Date.now()) {
      await clearQuietMode();
      return { userId: null, until: null };
    }
    return value;
  } catch { return { userId: null, until: null }; }
}

export async function setQuietMode(userId: string, duration: QuietDuration): Promise<QuietState> {
  const state = { userId, until: duration === 0 ? null : Date.now() + duration * 60_000 };
  const db = await openQuietDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(QUIET_STORE_NAME, 'readwrite');
    tx.objectStore(QUIET_STORE_NAME).put(state, QUIET_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Unable to save quiet mode.'));
  });
  db.close();
  return state;
}

export async function clearQuietMode() {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return;
  const db = await openQuietDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(QUIET_STORE_NAME, 'readwrite');
    tx.objectStore(QUIET_STORE_NAME).delete(QUIET_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Unable to clear quiet mode.'));
  });
  db.close();
}

export async function getCurrentUserId() {
  const { data } = await supabase.auth.getUser();
  return data.user?.id || null;
}

export function formatQuietRemaining(until: number | null) {
  if (until === null) return 'Until you turn it on';
  const minutes = Math.ceil(Math.max(0, until - Date.now()) / 60_000);
  if (minutes < 60) return minutes + ' min';
  return Math.ceil(minutes / 60) + ' hr';
}