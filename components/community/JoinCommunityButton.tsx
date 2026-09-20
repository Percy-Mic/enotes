'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';

/**
 * Join / Leave toggle for open communities.
 *
 * - Membership check is resilient: if the read errors (e.g. migration not
 *   yet run), we assume "not joined" instead of breaking the page.
 * - Join uses an UPSERT so a double-tap can never produce a 409 duplicate.
 * - The members counter updates via the DB trigger (migration 00007).
 */
export default function JoinCommunityButton({
  communityId,
  size = 'md',
  onChange,
}: {
  communityId: string;
  size?: 'sm' | 'md';
  /** fired after a CONFIRMED join/leave so parents can refresh live counts */
  onChange?: (joined: boolean) => void;
}) {
  const [joined, setJoined] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (active) setLoading(false);
        return;
      }
      const { data, error: err } = await supabase
        .from('community_members')
        .select('user_id')
        .eq('community_id', communityId)
        .eq('user_id', user.id)
        .maybeSingle();
      /* RLS hiccups must not break the button — default to not-joined */
      if (err) console.warn('Membership check failed:', err.message);
      if (active) {
        setJoined(!!data && !err);
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [communityId]);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const prev = joined;
    setJoined(!prev);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setJoined(prev);
      setError('Sign in to join.');
      setBusy(false);
      return;
    }

    if (prev) {
      const { error: err } = await supabase
        .from('community_members')
        .delete()
        .eq('community_id', communityId)
        .eq('user_id', user.id);
      if (err) {
        setJoined(prev);
        setError('Could not leave — try again.');
      } else {
        onChange?.(false);
      }
    } else {
      /* upsert = idempotent join; a racing double-tap lands on the same row */
      const { error: err } = await supabase
        .from('community_members')
        .upsert(
          { community_id: communityId, user_id: user.id },
          { onConflict: 'community_id,user_id', ignoreDuplicates: true }
        );
      if (err) {
        setJoined(prev);
        setError(err.message.includes('row-level security')
          ? 'This community is not accepting joins yet (run migration 2026-09-15).'
          : 'Could not join — try again.');
      } else {
        onChange?.(true);
      }
    }
    setBusy(false);
  };

  const pad = size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm';

  return (
    <span className="inline-flex flex-col items-start">
      <button
        onClick={toggle}
        disabled={loading || busy}
        aria-pressed={joined}
        className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-xl font-semibold transition disabled:opacity-50 ${
          joined
            ? 'border border-[#E8E2E4] bg-white text-[#6B6B6B] hover:bg-gray-50'
            : 'bg-black text-[#FFB6C1] shadow hover:opacity-90'
        } ${pad}`}
      >
        {loading ? '…' : busy ? '…' : joined ? 'Joined' : 'Join'}
      </button>
      {error && <span className="mt-1 text-[10px] font-semibold text-red-600">{error}</span>}
    </span>
  );
}
