'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';

/* ============================================================
   Centralized entitlement system.

   The app NEVER asks "is the user pro?" — it asks
   `has('video.export.hd')`. Plans map to entitlement keys, so a
   plan change is a data change, not a code change. All checks
   are backed by the `entitlements` table; the client-side hook is
   only for UI affordances — the database remains the enforcer
   (see has_entitlement() used in RLS for premium sounds etc.).
   ============================================================ */

export type EntitlementKey =
  | 'video.export.standard'
  | 'video.export.hd'
  | 'video.export.4k'
  | 'video.advanced_effects'
  | 'video.keyframes'
  | 'video.masking'
  | 'video.blend_modes'
  | 'video.color_grading'
  | 'video.luts'
  | 'video.advanced_audio'
  | 'video.noise_reduction'
  | 'video.eq'
  | 'video.compressor'
  | 'video.audio_ducking'
  | 'video.advanced_captions'
  | 'templates.free'
  | 'templates.premium'
  | `template.use:${string}`
  | 'sounds.free'
  | 'sounds.premium'
  | 'storage.large'
  | 'creator.marketplace'
  | 'creator.analytics'
  | 'journal.advanced'
  | 'ads.remove';

/** Plan → entitlement keys. Stored as config, mirrored here for the UI. */
export const PLAN_ENTITLEMENTS: Record<string, EntitlementKey[]> = {
  free: ['video.export.standard', 'templates.free', 'sounds.free'],
  pro: [
    'video.export.standard',
    'video.export.hd',
    'video.export.4k',
    'video.advanced_effects',
    'video.keyframes',
    'video.masking',
    'video.blend_modes',
    'video.color_grading',
    'video.luts',
    'video.advanced_audio',
    'video.noise_reduction',
    'video.eq',
    'video.compressor',
    'video.audio_ducking',
    'video.advanced_captions',
    'templates.free',
    'templates.premium',
    'sounds.free',
    'sounds.premium',
    'storage.large',
    'journal.advanced',
    'ads.remove',
  ],
  creator: ['creator.marketplace', 'creator.analytics'],
  business: ['storage.large', 'creator.analytics'],
};

export const ENTITLEMENT_LABELS: Partial<Record<EntitlementKey, string>> = {
  'video.export.standard': 'Standard export (up to 1080p)',
  'video.export.hd': 'HD export (1440p)',
  'video.export.4k': '4K export',
  'video.advanced_effects': 'Advanced effects & transitions',
  'video.keyframes': 'Keyframe animation',
  'video.masking': 'Masking & compositing',
  'video.blend_modes': 'Blend modes',
  'video.color_grading': 'Advanced color grading',
  'video.luts': 'LUT support',
  'video.advanced_audio': 'Advanced audio controls',
  'video.noise_reduction': 'Noise reduction',
  'video.eq': 'EQ controls',
  'video.compressor': 'Audio compression',
  'video.audio_ducking': 'Audio ducking',
  'video.advanced_captions': 'Advanced captions & subtitle tools',
  'templates.premium': 'Premium templates',
  'sounds.premium': 'Premium sound library',
  'storage.large': '50 GB media storage',
  'creator.marketplace': 'Publish to the marketplace',
  'creator.analytics': 'Creator analytics',
  'journal.advanced': 'Advanced journal customization',
  'ads.remove': 'Ad-free experience',
};

export function useEntitlements(userId: string | null) {
  const [entitlements, setEntitlements] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setEntitlements(new Set());
      setLoading(false);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from('entitlements')
        .select('key, expires_at')
        .eq('user_id', userId);
      const now = Date.now();
      const active = ((data || []) as { key: string; expires_at: string | null }[])
        .filter((row) => !row.expires_at || new Date(row.expires_at).getTime() > now)
        .map((row) => row.key);
      setEntitlements(new Set(active));
      setLoading(false);
    })();
  }, [userId]);

  /** Does the user hold this entitlement right now? */
  const has = (key: EntitlementKey): boolean => {
    /* Standard export is a free-tier promise — never gate the baseline on the
       entitlements table having been backfilled. Premium tiers unlock MORE,
       never take the baseline away. (Real premium enforcement stays in the DB.) */
    if (key === 'video.export.standard') return true;
    if (entitlements.has(key)) return true;
    // wildcard holds: template.use:* grants never expire per-template;
    // premium bundles imply free
    if (key === 'templates.free' && entitlements.has('templates.premium')) return true;
    if (key === 'sounds.free' && entitlements.has('sounds.premium')) return true;
    return false;
  };

  return { entitlements, has, loading };
}
