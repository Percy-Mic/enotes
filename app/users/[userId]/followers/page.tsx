'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import UserList, { fetchMyStates, fetchUserList, type UserListEntry } from '@/components/social/UserList';

/**
 * /users/[userId]/followers — everyone who follows this profile.
 * Counts live in profiles.followers_count (DB-maintained); the list itself
 * comes straight from `follows`, paginated.
 */
export default function FollowersPage() {
  const params = useParams();
  const userId = (params?.userId as string) || '';

  const [owner, setOwner] = useState<{ id: string; username: string; full_text_name: string } | null>(null);
  const [users, setUsers] = useState<UserListEntry[]>([]);
  const [states, setStates] = useState<Record<string, 'none' | 'following' | 'requested'>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setMyId(user?.id ?? null);

      if (!userId) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, username, full_text_name')
        .eq('id', userId)
        .maybeSingle();
      setOwner(profile as never);
      if (!profile) {
        setLoading(false);
        return;
      }

      const { users: first, hasMore: more } = await fetchUserList(userId, 'followers', 0);
      setUsers(first);
      setHasMore(more);
      setPage(0);
      if (user && first.length) {
        setStates(await fetchMyStates(first.map((u) => u.id), user.id));
      }
      setLoading(false);
    })();
  }, [userId]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || !owner) return;
    setLoadingMore(true);
    const next = page + 1;
    const { users: more, hasMore: moreAfter } = await fetchUserList(owner.id, 'followers', next);
    setUsers((prev) => [...prev, ...more]);
    setHasMore(moreAfter);
    setPage(next);
    if (myId && more.length) {
      const moreStates = await fetchMyStates(more.map((u) => u.id), myId);
      setStates((prev) => ({ ...prev, ...moreStates }));
    }
    setLoadingMore(false);
  };

  const name = owner?.full_text_name || owner?.username || 'this writer';

  return (
    <main className="min-h-[100dvh] bg-[#FFF7F8] px-3 pb-24 pt-5 text-[#111111] sm:px-6 md:pb-10">
      <div className="mx-auto w-full max-w-xl">
        <header className="mb-4 flex items-center gap-3">
          <Link
            href={owner?.username ? `/u/${owner.username}` : '/search'}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#E8E2E4] bg-white text-lg"
            aria-label="Back to profile"
          >
            ←
          </Link>
          <div>
            <h1 className="text-lg font-bold">Followers</h1>
            <p className="text-xs text-[#6B6B6B]">People who follow {name}</p>
          </div>
        </header>

        {!userId || (!loading && !owner) ? (
          <div className="rounded-2xl border border-dashed border-[#E8E2E4] bg-white/60 px-6 py-14 text-center">
            <h2 className="text-lg font-semibold">Writer not found</h2>
            <p className="mt-1 text-sm text-[#6B6B6B]">This profile doesn&apos;t exist anymore.</p>
            <Link href="/search" className="mt-5 inline-block rounded-xl bg-black px-5 py-2.5 text-sm font-semibold text-[#FFB6C1]">
              Find people
            </Link>
          </div>
        ) : (
          <>
            <UserList
              users={users}
              followState={states}
              loading={loading}
              emptyTitle="No followers yet"
              emptyBody={`${name} doesn't have any followers yet. Be the first!`}
              emptyActionHref="/search"
              emptyActionLabel="Find people"
            />
            {hasMore && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="mx-auto mt-4 block min-h-[40px] rounded-xl border border-[#E8E2E4] bg-white px-6 text-sm font-semibold text-[#6B6B6B] disabled:opacity-50"
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            )}
          </>
        )}
      </div>
    </main>
  );
}
