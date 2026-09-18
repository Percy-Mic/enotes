'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Post, Profile } from '@/types/social';
import Avatar from '@/components/social/Avatar';
import FollowButton from '@/components/social/FollowButton';
import JoinCommunityButton from '@/components/community/JoinCommunityButton';

type Tab = 'people' | 'posts' | 'videos' | 'communities';

interface CommunityRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  topic: string;
  emoji: string;
  members_count: number;
}

export default function SearchPage() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('people');

  const [people, setPeople] = useState<Profile[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [communities, setCommunities] = useState<CommunityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        router.replace('/auth/sign-in');
        return;
      }
      setMyId(user.id);
    })();
  }, [router]);

  const loadPreload = useCallback(async () => {
    if (!myId) return;
    /* Suggested journalers: newest active accounts (never me) */
    const { data: suggested } = await supabase
      .from('profiles')
      .select('id, full_text_name, username, avatar_url, bio, followers_count, posts_count, is_private')
      .neq('id', myId)
      .order('created_at', { ascending: false })
      .limit(10);
    setPeople((suggested || []) as Profile[]);

    /* Trending communities */
    const { data: comms } = await supabase
      .from('communities')
      .select('id, slug, name, description, topic, emoji, members_count')
      .order('members_count', { ascending: false })
      .limit(6);
    setCommunities(comms || []);
  }, [myId]);

  useEffect(() => {
    if (!myId) return;
    if (!query.trim()) {
      setSearched(false);
      setPosts([]);
      void loadPreload();
      return;
    }

    const handle = query.trim();
    const timer = setTimeout(async () => {
      setLoading(true);
      const safe = handle.replace(/[%_,()]/g, '');

      /* People — name, @username, or bio keyword */
      const { data: peopleData } = await supabase
        .from('profiles')
        .select('id, full_text_name, username, avatar_url, bio, followers_count, posts_count, is_private')
        .or(`username.ilike.%${safe}%,full_text_name.ilike.%${safe}%,bio.ilike.%${safe}%`)
        .neq('id', myId)
        .limit(20);
      setPeople((peopleData || []) as Profile[]);

      /* Posts and videos matching text or hashtag.
         hashtags is a JSONB array — PostgREST requires the value as a JSON
         array literal (hashtags.cs.["tag"]). The previous hand-built
         `.cs.{tag}` (Postgres text[] syntax) produced an invalid expression
         and a 400 for the whole request. Quotes/backslashes are stripped
         because they would break the or() expression encoding. */
      const tagSafe = safe.replace(/["\\\[\]]/g, '');
      const { data: postData, error: postError } = await supabase
        .from('posts')
        .select(
          `id, author_id, journal_id, page_id, content, media_url, media_type, visibility, created_at,
           author:profiles!posts_author_id_fkey(id, full_text_name, username, avatar_url)`,
        )
        .or(`content.ilike.%${safe}%,hashtags.cs.["${tagSafe}"]`)
        .eq('visibility', 'public')
        .order('created_at', { ascending: false })
        .limit(30);
      if (postError) {
        /* Never leave the tab stuck loading — surface it quietly. */
        console.error('posts search failed:', postError.message);
        setPosts([]);
      } else {
        setPosts((postData || []) as unknown as Post[]);
      }

      /* Communities */
      const { data: commData } = await supabase
        .from('communities')
        .select('id, slug, name, description, topic, emoji, members_count')
        .or(`name.ilike.%${safe}%,description.ilike.%${safe}%,topic.ilike.%${safe}%`)
        .limit(12);
      setCommunities(commData || []);

      setSearched(true);
      setLoading(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [query, myId, loadPreload]);

  const videoPosts = posts.filter((p) => p.media_type === 'video' && p.media_url);

  return (
    <main className="min-h-[100dvh] bg-[#FFF7F8] px-3 pb-24 pt-5 text-[#111111] sm:px-6 md:pb-10">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-5">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Search</h1>
          <p className="text-sm text-[#6B6B6B]">Find writers, posts, videos, and communities.</p>
        </header>

        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-[#9B9B9B]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people, posts, videos, communities…"
            autoCapitalize="none"
            className="w-full rounded-2xl border border-[#E8E2E4] bg-white py-3.5 pl-11 pr-4 text-base shadow-sm focus:border-[#1E90FF] focus:outline-none"
          />
        </div>

        {/* Tabs */}
        <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl bg-white p-1 shadow-sm">
          {(
            [
              ['people', 'People'],
              ['posts', 'Posts'],
              ['videos', 'Videos'],
              ['communities', 'Communities'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`min-h-[40px] flex-1 whitespace-nowrap rounded-lg text-sm font-semibold transition ${
                tab === key ? 'bg-black text-[#FFB6C1]' : 'text-[#6B6B6B] hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-2xl bg-white/70" />
            ))}
          </div>
        ) : tab === 'people' ? (
          people.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#E8E2E4] bg-white/60 px-6 py-12 text-center">
              <p className="text-sm font-semibold">{searched ? 'No writers found' : 'Suggested journalers'}</p>
              <p className="mt-1 text-sm text-[#6B6B6B]">
                {searched ? 'Try another name or username.' : 'Follow someone to fill your feed.'}
              </p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {people.map((person) => (
                <li
                  key={person.id}
                  className="flex items-center gap-3 rounded-2xl border border-[#E8E2E4] bg-white p-3.5 shadow-sm"
                >
                  <Link
                    href={person.username ? `/u/${person.username}` : '#'}
                    className="flex min-w-0 flex-1 items-center gap-3"
                  >
                    <Avatar src={person.avatar_url} name={person.full_text_name || person.username} size={44} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">
                        {person.full_text_name || person.username || 'Journaler'}
                      </span>
                      <span className="block truncate text-xs text-[#6B6B6B]">
                        {person.username ? `@${person.username}` : ''}
                        {person.followers_count ? ` · ${person.followers_count} followers` : ''}
                      </span>
                    </span>
                  </Link>
                  {person.id !== myId && (
                    <FollowButton
                      targetId={person.id}
                      isPrivate={!!person.is_private}
                      initialState="none"
                    />
                  )}
                </li>
              ))}
            </ul>
          )
        ) : tab === 'communities' ? (
          communities.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#E8E2E4] bg-white/60 px-6 py-12 text-center">
              <p className="text-sm font-semibold">{searched ? 'No communities found' : 'No communities yet'}</p>
              <p className="mt-1 text-sm text-[#6B6B6B]">
                {searched ? 'Try another keyword.' : 'Be the first to start one for your interest.'}
              </p>
              <Link
                href="/communities/new"
                className="mt-4 inline-block rounded-xl bg-black px-5 py-2.5 text-sm font-semibold text-[#FFB6C1]"
              >
                Create a community
              </Link>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {communities.map((c) => (
                <li key={c.id} className="rounded-2xl border border-[#E8E2E4] bg-white p-3.5 shadow-sm">
                  <Link href={`/communities/${c.slug}`} className="flex min-w-0 items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#FFF7F8] text-2xl">
                      {c.emoji}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{c.name}</span>
                      <span className="block truncate text-xs text-[#6B6B6B]">
                        {c.members_count} member{c.members_count === 1 ? '' : 's'} · {c.topic}
                      </span>
                    </span>
                  </Link>
                  <div className="mt-2.5">
                    <JoinCommunityButton communityId={c.id} size="sm" />
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : tab === 'videos' ? (
          videoPosts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#E8E2E4] bg-white/60 px-6 py-12 text-center">
              <p className="text-sm font-semibold">No videos found</p>
              <p className="mt-1 text-sm text-[#6B6B6B]">
                {searched ? 'Try another search.' : 'Videos shared to the feed will appear here.'}
              </p>
              <Link
                href="/videos"
                className="mt-4 inline-block rounded-xl bg-black px-5 py-2.5 text-sm font-semibold text-[#FFB6C1]"
              >
                Browse all videos
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {videoPosts.map((post) => (
                <Link
                  key={post.id}
                  href={`/posts/${post.id}`}
                  className="relative overflow-hidden rounded-xl bg-black"
                >
                  <video
                    src={post.media_url || ''}
                    muted
                    playsInline
                    preload="metadata"
                    className="aspect-[9/14] w-full object-cover"
                  />
                  {post.author?.username && (
                    <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white">
                      @{post.author.username}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          )
        ) : posts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#E8E2E4] bg-white/60 px-6 py-12 text-center">
            <p className="text-sm font-semibold">{searched ? 'No posts found' : 'Recent posts'}</p>
            <p className="mt-1 text-sm text-[#6B6B6B]">
              {searched ? 'Try different keywords.' : 'Search to explore what writers are sharing.'}
            </p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {posts.map((post) => (
              <li key={post.id} className="rounded-2xl border border-[#E8E2E4] bg-white p-4 shadow-sm">
                <Link
                  href={post.author?.username ? `/u/${post.author.username}` : '#'}
                  className="flex items-center gap-2.5"
                >
                  <Avatar src={post.author?.avatar_url} name={post.author?.full_text_name || post.author?.username} size={32} />
                  <span className="text-sm font-semibold">
                    {post.author?.full_text_name || post.author?.username || 'Writer'}
                  </span>
                </Link>
                <Link href={`/posts/${post.id}`} className="block">
                  {post.content && <p className="mt-2 line-clamp-3 text-sm text-[#3D3D3D]">{post.content}</p>}
                  {post.media_url && post.media_type === 'image' && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={post.media_url} alt="" className="mt-2 max-h-48 w-full rounded-xl object-cover" />
                  )}
                  {post.media_url && post.media_type === 'video' && (
                    <video src={post.media_url} muted playsInline preload="metadata" className="mt-2 max-h-48 w-full rounded-xl bg-black object-cover" />
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
