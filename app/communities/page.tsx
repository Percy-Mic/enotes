'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Compass, Plus, Search as SearchIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import JoinCommunityButton from '@/components/community/JoinCommunityButton';

/**
 * /communities — browse and discover interest groups.
 * Members/post counts come from DB triggers (migration 00007), never hardcoded.
 */
export default function CommunitiesPage() {
  const router = useRouter();
  const [items, setItems] = useState<
    { id: string; slug: string; name: string; description: string; topic: string; emoji: string; members_count: number; posts_count: number }[]
  >([]);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [myId, setMyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.replace('/auth/sign-in');
      return;
    }
    setMyId(user.id);

    const query = supabase
      .from('communities')
      .select('id, slug, name, description, topic, emoji, members_count, posts_count')
      .order('members_count', { ascending: false })
      .limit(60);
    if (filter.trim()) {
      const safe = filter.trim().replace(/[%_,]/g, '');
      query.or(`name.ilike.%${safe}%,topic.ilike.%${safe}%,description.ilike.%${safe}%`);
    }
    const { data } = await query;
    setItems(data || []);

    const { data: memberships } = await supabase
      .from('community_members')
      .select('community_id')
      .eq('user_id', user.id);
    setMine(new Set((memberships || []).map((m) => m.community_id)));
    setLoading(false);
  }, [filter, router]);

  useEffect(() => {
    const t = setTimeout(() => void load(), filter ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, filter]);

  const TOPICS = ['general', 'writing', 'art', 'photography', 'music', 'travel', 'gaming', 'food', 'fitness', 'books', 'film', 'tech'];

  return (
    <main className="min-h-[100dvh] bg-[#FFF7F8] px-3 pb-24 pt-5 text-[#111111] sm:px-6 md:pb-10">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
              <Compass className="h-6 w-6 text-[#E5798F]" /> Communities
            </h1>
            <p className="text-sm text-[#6B6B6B]">Find your people — groups built around shared interests.</p>
          </div>
          <Link
            href="/communities/new"
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-[#FFB6C1] shadow"
          >
            <Plus className="h-4 w-4" /> New
          </Link>
        </header>

        <div className="relative mb-4">
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-[#9B9B9B]" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search communities or topics…"
            className="w-full rounded-2xl border border-[#E8E2E4] bg-white py-3 pl-11 pr-4 text-base shadow-sm focus:border-[#E5798F] focus:outline-none"
          />
        </div>

        {!filter && (
          <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            {TOPICS.map((t) => (
              <button
                key={t}
                onClick={() => setFilter(t)}
                className="whitespace-nowrap rounded-full border border-[#E8E2E4] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#6B6B6B] hover:border-[#E5798F] hover:text-[#E5798F]"
              >
                #{t}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-36 animate-pulse rounded-2xl bg-white/70" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#E8E2E4] bg-white/60 px-6 py-14 text-center">
            <p className="text-3xl">🌱</p>
            <p className="mt-2 text-sm font-semibold">{filter ? 'Nothing matches that yet' : 'No communities yet'}</p>
            <p className="mt-1 text-sm text-[#6B6B6B]">
              {filter ? 'Try another topic.' : 'Start the first one for your interest.'}
            </p>
            <Link
              href="/communities/new"
              className="mt-4 inline-block rounded-xl bg-black px-5 py-2.5 text-sm font-semibold text-[#FFB6C1]"
            >
              Create a community
            </Link>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {items.map((c) => (
              <li
                key={c.id}
                className="flex flex-col rounded-2xl border border-[#E8E2E4] bg-white p-4 shadow-sm transition hover:shadow-md"
              >
                <Link href={`/communities/${c.slug}`} className="flex min-w-0 items-start gap-3">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#FFF7F8] text-2xl">
                    {c.emoji}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">{c.name}</span>
                    <span className="block text-xs text-[#6B6B6B]">
                      {c.members_count} member{c.members_count === 1 ? '' : 's'} · {c.posts_count} post{c.posts_count === 1 ? '' : 's'}
                    </span>
                    <span className="mt-1 line-clamp-2 block text-xs text-[#3D3D3D]">{c.description}</span>
                  </span>
                </Link>
                <div className="mt-3 flex items-center justify-between">
                  <span className="rounded-full bg-[#FFF7F8] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#E5798F]">
                    #{c.topic}
                  </span>
                  <JoinCommunityButton communityId={c.id} size="sm" />
                </div>
              </li>
            ))}
          </ul>
        )}

        {mine.size > 0 && !filter && (
          <p className="mt-6 text-center text-xs text-[#9B9B9B]">
            You're in {mine.size} communit{mine.size === 1 ? 'y' : 'ies'} — they're pinned in Search too.
          </p>
        )}
        {myId === null && <span className="hidden">loading</span>}
      </div>
    </main>
  );
}
