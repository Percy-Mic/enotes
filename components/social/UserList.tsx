'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { UserX } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import FollowButton from '@/components/social/FollowButton';

export interface UserListEntry {
  id: string;
  username: string;
  full_text_name: string;
  avatar_url: string | null;
  is_private: boolean;
}

interface UserListProps {
  /** profiles to show (already fetched) */
  users: UserListEntry[];
  /** follow-state of the CURRENT user keyed by profile id */
  followState: Record<string, 'none' | 'following' | 'requested'>;
  loading: boolean;
  emptyTitle: string;
  emptyBody: string;
  emptyActionHref?: string;
  emptyActionLabel?: string;
}

/**
 * Shared renderer for followers/following lists: avatar, name, @username,
 * live follow button, and client-side name search (small pages — no
 * server round-trip needed). Used by /users/[userId]/followers and
 * /users/[userId]/following.
 */
export default function UserList({
  users,
  followState,
  loading,
  emptyTitle,
  emptyBody,
  emptyActionHref,
  emptyActionLabel,
}: UserListProps) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        (u.username || '').toLowerCase().includes(q) ||
        (u.full_text_name || '').toLowerCase().includes(q)
    );
  }, [users, query]);

  if (loading) {
    return (
      <div className="space-y-3 px-1 py-6">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex animate-pulse items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-[#EFE9EB]" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-1/3 rounded bg-[#EFE9EB]" />
              <div className="h-3 w-1/4 rounded bg-[#EFE9EB]" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[#E8E2E4] bg-white/60 px-6 py-14 text-center">
        <UserX className="mx-auto h-10 w-10 text-[#C9C0C4]" />
        <h2 className="mt-3 text-lg font-semibold">{emptyTitle}</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-[#6B6B6B]">{emptyBody}</p>
        {emptyActionHref && emptyActionLabel && (
          <Link
            href={emptyActionHref}
            className="mt-5 inline-block rounded-xl bg-black px-5 py-2.5 text-sm font-semibold text-[#FFB6C1]"
          >
            {emptyActionLabel}
          </Link>
        )}
      </div>
    );
  }

  return (
    <div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search people…"
        aria-label="Search people in this list"
        className="mb-3 w-full rounded-xl border border-[#E8E2E4] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#E5798F]"
      />

      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-[#6B6B6B]">No matches for “{query}”.</p>
      ) : (
        <ul className="divide-y divide-[#E8E2E4] overflow-hidden rounded-2xl border border-[#E8E2E4] bg-white shadow-sm">
          {filtered.map((u) => {
            const name = u.full_text_name || u.username || 'Writer';
            return (
              <li key={u.id} className="flex items-center gap-3 px-4 py-3">
                <Link href={`/u/${u.username}`} className="flex min-w-0 flex-1 items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={u.avatar_url || '/default-avatar.png'}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded-full bg-[#F3EFF0] object-cover"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{name}</p>
                    <p className="truncate text-xs text-[#6B6B6B]">
                      @{u.username}
                      {u.is_private && ' · 🔒'}
                    </p>
                  </div>
                </Link>
                <FollowButton
                  targetId={u.id}
                  isPrivate={u.is_private}
                  initialState={followState[u.id] || 'none'}
                  size="sm"
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Fetch the profile rows for a follower/following list, plus the current
 * user's relationship to each. Pagination via `page` (50 per page).
 */
export async function fetchUserList(
  listOwner: string,
  kind: 'followers' | 'following',
  page: number
): Promise<{ users: UserListEntry[]; hasMore: boolean }> {
  const PAGE = 50;
  const from = page * PAGE;

  const joinColumn = kind === 'followers' ? 'follower_id' : 'following_id';
  const selectWith = kind === 'followers' ? 'following_id' : 'follower_id';

  const { data: rows, error } = await supabase
    .from('follows')
    .select(`${joinColumn}, profile:profiles!follows_${joinColumn}_fkey(id, username, full_text_name, avatar_url, is_private)`)
    .eq(selectWith, listOwner)
    .order(joinColumn)
    .range(from, from + PAGE - 1);

  if (error || !rows) return { users: [], hasMore: false };

  const users = (rows as unknown as { profile: UserListEntry }[])
    .map((r) => r.profile)
    .filter(Boolean);

  return { users, hasMore: rows.length === PAGE };
}

/** Which of these profiles do I follow / have I requested? */
export async function fetchMyStates(profileIds: string[], myId: string) {
  const state: Record<string, 'none' | 'following' | 'requested'> = {};
  if (profileIds.length === 0) return state;

  const [followsRes, requestsRes] = await Promise.all([
    supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', myId)
      .in('following_id', profileIds),
    supabase
      .from('follow_requests')
      .select('target_id')
      .eq('requester_id', myId)
      .eq('status', 'pending')
      .in('target_id', profileIds),
  ]);

  for (const row of followsRes.data || []) {
    state[(row as { following_id: string }).following_id] = 'following';
  }
  for (const row of requestsRes.data || []) {
    state[(row as { target_id: string }).target_id] = 'requested';
  }
  return state;
}
