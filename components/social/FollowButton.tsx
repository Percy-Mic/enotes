'use client';

import React, { useEffect, useState } from 'react';
import { Check, Clock, UserCheck, UserPlus, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

type FollowState = 'none' | 'following' | 'requested';

interface FollowButtonProps {
  targetId: string;
  /** whether the target profile is private (follow → request instead) */
  isPrivate?: boolean;
  initialState?: FollowState;
  onChange?: (state: FollowState) => void;
  size?: 'sm' | 'md';
}

/**
 * Follow / Following / Requested button.
 *
 * - Public profiles: insert/delete `follows` (DB blocks self + duplicates).
 * - Private profiles: insert `follow_requests`; the target accepts/declines
 *   (accepting creates the follow row server-side via respond_follow_request).
 * - Optimistic UI with rollback on error; never trusts the client for auth —
 *   every query is scoped to auth.uid().
 */
export default function FollowButton({
  targetId,
  isPrivate = false,
  initialState = 'none',
  onChange,
  size = 'md',
}: FollowButtonProps) {
  const [state, setState] = useState<FollowState>(initialState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setState(initialState);
  }, [initialState, targetId]);

  const toggle = async () => {
    if (loading) return;
    setError(null);
    setLoading(true);

    const prev = state;
    // optimistic
    const next: FollowState =
      state === 'none' ? (isPrivate ? 'requested' : 'following') : 'none';
    setState(next);
    onChange?.(next);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      if (prev === 'none') {
        if (isPrivate) {
          const { error: err } = await supabase
            .from('follow_requests')
            .insert({ requester_id: user.id, target_id: targetId });
          if (err) {
            if (err.code === '23505') {
              // already requested — treat as requested
              setState('requested');
              onChange?.('requested');
            } else throw err;
          }
        } else {
          const { error: err } = await supabase
            .from('follows')
            .insert({ follower_id: user.id, following_id: targetId });
          if (err) {
            if (err.code === '23505') {
              setState('following'); // duplicate — already following
              onChange?.('following');
            } else throw err;
          }
        }
      } else if (prev === 'following') {
        const { error: err } = await supabase
          .from('follows')
          .delete()
          .eq('follower_id', user.id)
          .eq('following_id', targetId);
        if (err) throw err;
      } else if (prev === 'requested') {
        // cancel the pending request
        const { error: err } = await supabase
          .from('follow_requests')
          .delete()
          .eq('requester_id', user.id)
          .eq('target_id', targetId)
          .eq('status', 'pending');
        if (err) throw err;
      }
    } catch (e) {
      setState(prev); // rollback
      onChange?.(prev);
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const pad = size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm';

  const content = () => {
    switch (state) {
      case 'following':
        return (
          <>
            <UserCheck className="h-4 w-4" /> Following
          </>
        );
      case 'requested':
        return (
          <>
            <Clock className="h-4 w-4" /> Requested
          </>
        );
      default:
        return (
          <>
            <UserPlus className="h-4 w-4" /> {isPrivate ? 'Request' : 'Follow'}
          </>
        );
    }
  };

  return (
    <span className="relative inline-flex flex-col items-start">
      <button
        onClick={toggle}
        disabled={loading}
        aria-live="polite"
        className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-xl font-semibold transition disabled:opacity-50 ${
          state === 'none'
            ? 'bg-black text-[#FFB6C1] shadow hover:opacity-90'
            : 'border border-[#E8E2E4] bg-white text-[#6B6B6B] hover:bg-gray-50'
        } ${pad}`}
      >
        {content()}
      </button>
      {error && <span className="mt-1 text-[11px] font-semibold text-red-600">{error}</span>}
    </span>
  );
}

/**
 * PendingRequests — shown on your own profile or settings: accept/decline
 * incoming follow requests. Uses the respond_follow_request() RPC so the
 * follow row is created server-side by the target's decision.
 */
export function PendingRequests({ myId }: { myId: string }) {
  const [requests, setRequests] = useState<
    { id: string; requester: { id: string; username: string; full_text_name: string; avatar_url: string; is_private: boolean } }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [handled, setHandled] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('follow_requests')
        .select(
          'id, requester:profiles!follow_requests_requester_id_fkey(id, username, full_text_name, avatar_url, is_private)'
        )
        .eq('target_id', myId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(50);
      setRequests((data || []) as never);
      setLoading(false);
    })();
  }, [myId]);

  const respond = async (requestId: string, accept: boolean) => {
    setHandled((prev) => new Set(prev).add(requestId));
    setRequests((prev) => prev.filter((r) => r.id !== requestId));
    const { error } = await supabase.rpc('respond_follow_request', {
      p_request_id: requestId,
      p_accept: accept,
    });
    if (error) {
      // rollback quietly: refetch would be ideal; keep simple flag
      setHandled((prev) => {
        const next = new Set(prev);
        next.delete(requestId);
        return next;
      });
    }
  };

  if (loading) return <p className="px-4 py-6 text-center text-sm text-[#6B6B6B]">Loading requests…</p>;
  if (requests.length === 0)
    return <p className="px-4 py-6 text-center text-sm text-[#6B6B6B]">No pending requests.</p>;

  return (
    <ul className="divide-y divide-[#E8E2E4]">
      {requests.map((r) => {
        const name = r.requester.full_text_name || r.requester.username || 'Writer';
        return (
          <li key={r.id} className="flex items-center gap-3 px-4 py-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={r.requester.avatar_url || '/default-avatar.png'}
              alt=""
              className="h-10 w-10 rounded-full bg-[#F3EFF0] object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{name}</p>
              <p className="truncate text-xs text-[#6B6B6B]">@{r.requester.username}</p>
            </div>
            {handled.has(r.id) ? (
              <span className="text-xs text-[#6B6B6B]">
                <Check className="inline h-3 w-3" /> done
              </span>
            ) : (
              <span className="flex gap-2">
                <button
                  onClick={() => respond(r.id, true)}
                  className="min-h-[36px] rounded-lg bg-black px-3 py-1.5 text-xs font-bold text-[#FFB6C1]"
                >
                  Accept
                </button>
                <button
                  onClick={() => respond(r.id, false)}
                  className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-[#E8E2E4] px-3 py-1.5 text-xs font-semibold text-[#6B6B6B]"
                >
                  <X className="h-3 w-3" /> Decline
                </button>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
