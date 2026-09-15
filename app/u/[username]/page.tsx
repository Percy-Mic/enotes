'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { BookOpen, Ban, Eye, EyeOff, ImagePlus, MessageCircle, Settings2, UserCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { FollowState, Post, Profile, Story } from '@/types/social';
import { PendingRequests } from '@/components/social/FollowButton';
import Avatar from '@/components/social/Avatar';
import FollowButton from '@/components/social/FollowButton';
import PostCard from '@/components/social/PostCard';
import StoryViewer, { StoryGroup } from '@/components/social/StoryViewer';

interface JournalCard {
  id: string;
  title: string;
  description?: string;
  foreword?: string;
  cover_media_url?: string;
  cover_url?: string;
  background_color?: string;
}

export default function ProfilePage() {
  const params = useParams();
  const router = useRouter();
  const username = (params?.username as string) || '';

  const [profile, setProfile] = useState<Profile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [journals, setJournals] = useState<JournalCard[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [activeTab, setActiveTab] = useState<'posts' | 'journals' | 'stories'>('posts');
  const [viewerOpen, setViewerOpen] = useState(false);
  const [isMe, setIsMe] = useState(false);
  const [followState, setFollowState] = useState<FollowState>('none');
  const [counts, setCounts] = useState({ followers: 0, following: 0, posts: 0 });
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [viewAsVisitor, setViewAsVisitor] = useState(false);
  const [blockedByMe, setBlockedByMe] = useState(false);
  const [blockedMe, setBlockedMe] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setNotFound(false);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/auth/sign-in');
        return;
      }

      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('username', username)
        .maybeSingle();

      if (!profileData) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      const me = profileData as Profile;
      setProfile(me);
      setIsMe(me.id === user.id);
      setFollowState('none');
      setCounts({
        followers: me.followers_count || 0,
        following: me.following_count || 0,
        posts: me.posts_count || 0,
      });

      if (me.id !== user.id) {
        /* Block checks (both directions) */
        const [{ data: iBlocked }, { data: theyBlocked }] = await Promise.all([
          supabase.from('user_blocks').select('blocked_id').eq('blocker_id', user.id).eq('blocked_id', me.id).maybeSingle(),
          supabase.from('user_blocks').select('blocker_id').eq('blocker_id', me.id).eq('blocked_id', user.id).maybeSingle(),
        ]);
        setBlockedByMe(!!iBlocked);
        setBlockedMe(!!theyBlocked);

        const [{ data: followRow }, { data: followReq }] = await Promise.all([
          supabase.from('follows').select('follower_id').eq('follower_id', user.id).eq('following_id', me.id).maybeSingle(),
          supabase.from('follow_requests').select('id').eq('requester_id', user.id).eq('target_id', me.id).eq('status', 'pending').maybeSingle(),
        ]);
        setFollowState(followRow ? 'following' : followReq ? 'requested' : 'none');
      }

      /* Their public + followers-only (if following) posts */
      const { data: postData } = await supabase
        .from('posts')
        .select(
          'id, author_id, journal_id, page_id, content, media_url, media_type, visibility, created_at, author:profiles!posts_author_id_fkey(id, full_text_name, username, avatar_url)',
        )
        .eq('author_id', me.id)
        .order('created_at', { ascending: false })
        .limit(30);

      let list = (postData || []) as unknown as Post[];

      if (list.length) {
        const postIds = list.map((p) => p.id);
        const [{ data: likes }, { data: counts }] = await Promise.all([
          supabase.from('post_likes').select('post_id, user_id').in('post_id', postIds),
          supabase.from('comments').select('post_id').in('post_id', postIds),
        ]);
        const likeRows = (likes || []) as { post_id: string; user_id: string }[];
        const commentCounts = (counts || []).reduce((acc: Record<string, number>, row: any) => {
          acc[row.post_id] = (acc[row.post_id] || 0) + 1;
          return acc;
        }, {});
        list = list.map((p) => ({
          ...p,
          like_count: likeRows.filter((l) => l.post_id === p.id).length,
          liked_by_me: likeRows.some((l) => l.post_id === p.id && l.user_id === user.id),
          comment_count: commentCounts[p.id] || 0,
        }));
      }
      setPosts(list);

      /* Journals that are publicly visible (profile owners show their own) */
      if (me.id === user.id) {
        const { data: myJournals } = await supabase
          .from('journals')
          .select('id, title, description, foreword, cover_media_url, cover_url, background_color')
          .eq('owner_id', me.id)
          .order('created_at', { ascending: false });
        setJournals((myJournals || []) as JournalCard[]);
      } else {
        const { data: publicJournals } = await supabase
          .from('journals')
          .select('id, title, description, foreword, cover_media_url, cover_url, background_color')
          .eq('owner_id', me.id)
          .in('visibility', ['public', 'link']);
        setJournals((publicJournals || []) as JournalCard[]);
      }

      /* Active stories (24h) */
      const { data: storyData } = await supabase
        .from('stories')
        .select('id, author_id, media_url, media_type, caption, created_at, expires_at')
        .eq('author_id', me.id)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(50);
      setStories((storyData || []) as unknown as Story[]);

      setLoading(false);
    })();
  }, [username, router]);

  const toggleBlock = async () => {
    if (!profile || blockBusy) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    setBlockBusy(true);
    if (blockedByMe) {
      await supabase
        .from('user_blocks')
        .delete()
        .eq('blocker_id', user.id)
        .eq('blocked_id', profile.id);
      setBlockedByMe(false);
    } else {
      await supabase
        .from('user_blocks')
        .insert({ blocker_id: user.id, blocked_id: profile.id });
      setBlockedByMe(true);
    }
    setBlockBusy(false);
  };

  const startChat = async () => {
    if (!profile) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    /* Find an existing DM with both members */
    const { data: mine } = await supabase
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', user.id);

    const myConvIds = (mine || []).map((row: any) => row.conversation_id);

    if (myConvIds.length) {
      const { data: theirs } = await supabase
        .from('conversation_members')
        .select('conversation_id, conversations!inner(id, is_group)')
        .eq('user_id', profile.id)
        .in('conversation_id', myConvIds);

      const match = (theirs || []).find((row: any) => row.conversations?.is_group === false);
      if (match) {
        router.push(`/messages/${match.conversation_id}`);
        return;
      }
    }

    /* Create a new DM. The conversations_insert_creator RLS policy makes
       this succeed for the signed-in creator; a failure here used to vanish
       silently — surface it so the user can retry. */
    const { data: conv, error } = await supabase
      .from('conversations')
      .insert({ is_group: false, created_by: user.id })
      .select('id')
      .single();

    if (error || !conv) {
      alert(error?.message || 'Could not start the conversation — please try again.');
      return;
    }

    await supabase.from('conversation_members').insert([
      { conversation_id: conv.id, user_id: user.id },
      { conversation_id: conv.id, user_id: profile.id },
    ]);

    router.push(`/messages/${conv.id}`);
  };

  if (loading) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-[#FFF7F8] text-[#6B6B6B]">
        Loading profile…
      </main>
    );
  }

  if (notFound || !profile) {
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 bg-[#FFF7F8] px-6 text-center">
        <p className="text-lg font-semibold">No writer found</p>
        <p className="text-sm text-[#6B6B6B]">The username “{username}” doesn&apos;t exist (yet).</p>
        <Link href="/search" className="rounded-xl bg-black px-5 py-2.5 text-sm font-semibold text-[#FFB6C1]">
          Find people
        </Link>
      </main>
    );
  }

  const displayName = profile.full_text_name || profile.username || 'Writer';

  return (
    <main className="min-h-[100dvh] bg-[#FFF7F8] px-3 pb-24 pt-5 text-[#111111] sm:px-6 md:pb-10">
      <div className="mx-auto w-full max-w-2xl">
        {/* Profile header */}
        <section className="rounded-2xl border border-[#E8E2E4] bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-start sm:text-left">
            <Avatar src={profile.avatar_url} name={displayName} size={48} className="!h-20 !w-20 !text-2xl" />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl font-bold">{displayName}</h1>
              <p className="text-sm text-[#6B6B6B]">{profile.username ? `@${profile.username}` : ''}</p>
              {profile.bio && <p className="mt-2 text-sm leading-relaxed">{profile.bio}</p>}

              {/* Counts come from DB-maintained columns; followers/following
                  navigate to the dedicated list pages. */}
              <div className="mt-3 flex justify-center gap-6 text-sm sm:justify-start">
                <Link href={`/users/${profile.id}/followers`} className="hover:underline">
                  <b>{counts.followers}</b> <span className="text-[#6B6B6B]">followers</span>
                </Link>
                <Link href={`/users/${profile.id}/following`} className="hover:underline">
                  <b>{counts.following}</b> <span className="text-[#6B6B6B]">following</span>
                </Link>
                <span>
                  <b>{counts.posts}</b> <span className="text-[#6B6B6B]">posts</span>
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
            {isMe && (
              <button
                onClick={() => setViewAsVisitor((v) => !v)}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#E8E2E4] bg-white px-4 py-2 text-sm font-semibold transition hover:bg-gray-50"
              >
                {viewAsVisitor ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                {viewAsVisitor ? 'View as me' : 'View as visitor'}
              </button>
            )}
            {isMe ? (
              <>
                <Link
                  href="/settings/profile"
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#E8E2E4] bg-white px-4 py-2 text-sm font-semibold transition hover:bg-gray-50"
                >
                  <Settings2 className="h-4 w-4" /> Edit profile
                </Link>
                <Link
                  href="/journals"
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-black px-4 py-2 text-sm font-semibold text-[#FFB6C1] shadow"
                >
                  <BookOpen className="h-4 w-4" /> My journals
                </Link>
              </>
            ) : (
              <>
                <FollowButton
                  targetId={profile.id}
                  isPrivate={!!profile.is_private}
                  initialState={followState}
                  onChange={(next) => {
                    setFollowState(next);
                    // live count adjustment — the DB triggers keep the truth;
                    // this avoids a refetch round-trip.
                    setCounts((c) => ({
                      ...c,
                      followers: Math.max(0, c.followers + (next === 'following' ? 1 : followState === 'following' ? -1 : 0)),
                    }));
                  }}
                />
                <button
                  onClick={startChat}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#E8E2E4] bg-white px-4 py-2 text-sm font-semibold transition hover:bg-gray-50"
                >
                  <MessageCircle className="h-4 w-4" /> Message
                </button>
                <button
                  onClick={toggleBlock}
                  disabled={blockBusy}
                  className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border px-4 py-2 text-sm font-semibold transition disabled:opacity-50 ${
                    blockedByMe
                      ? 'border-red-300 bg-red-50 text-red-600 hover:bg-red-100'
                      : 'border-[#E8E2E4] bg-white text-[#6B6B6B] hover:bg-gray-50'
                  }`}
                >
                  <Ban className="h-4 w-4" />
                  {blockedByMe ? 'Unblock' : 'Block'}
                </button>
              </>
            )}
          </div>

          {blockedByMe && (
            <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">
              You blocked this writer. Their posts, journals and stories are hidden, and they can't
              see yours either. Unblock to restore visibility.
            </p>
          )}
          {blockedMe && !blockedByMe && (
            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
              This writer has limited what you can see.
            </p>
          )}
        </section>

        {/* Blocked in either direction → hide everything below the header */}
        {(blockedByMe || (blockedMe && !isMe)) || (isMe && viewAsVisitor && false) ? (
          <div className="mt-8 rounded-2xl border border-dashed border-[#E8E2E4] bg-white/60 px-6 py-14 text-center">
            <div className="text-4xl">🚫</div>
            <h2 className="mt-3 text-lg font-semibold">
              {isMe && viewAsVisitor ? 'Visitor view' : 'Nothing to see here'}
            </h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-[#6B6B6B]">
              {blockedByMe
                ? 'You blocked this writer, so their content is hidden.'
                : 'This content is unavailable.'}
            </p>
          </div>
        ) : (
        <>
        {/* Own profile → incoming follow requests (private accounts) */}
        {isMe && (
          <details className="mt-4 rounded-2xl border border-[#E8E2E4] bg-white p-4 shadow-sm">
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
              <UserCheck className="h-4 w-4" /> Follow requests
            </summary>
            <div className="mt-2">
              <PendingRequests myId={profile.id} />
            </div>
          </details>
        )}

        {/* Tabs: Posts / Journals / Stories */}
        <div className="mt-8 flex gap-1 rounded-xl bg-white p-1 shadow-sm">
          {([
            ['posts', `Posts`],
            ['journals', 'Journals'],
            ['stories', 'Stories'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`min-h-[40px] flex-1 rounded-lg text-sm font-semibold transition ${
                activeTab === key ? 'bg-black text-[#FFB6C1]' : 'text-[#6B6B6B] hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Posts tab */}
        {activeTab === 'posts' && (
          <section className="mt-4">
            {posts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#E8E2E4] bg-white/60 px-6 py-10 text-center text-sm text-[#6B6B6B]">
                No posts yet.
              </div>
            ) : (
              <div className="space-y-4">
                {posts.map((post) => (
                  <PostCard key={post.id} post={post} />
                ))}
              </div>
            )}
          </section>
        )}

        {/* Journals tab */}
        {activeTab === 'journals' && (
          <section className="mt-4">
            {journals.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#E8E2E4] bg-white/60 px-6 py-10 text-center text-sm text-[#6B6B6B]">
                {isMe ? 'Create your first journal to see it here.' : 'No public journals yet.'}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {journals.map((journal) => (
                  <Link
                    key={journal.id}
                    href={`/journals/${journal.id}`}
                    className="group flex items-center gap-3 overflow-hidden rounded-2xl border border-[#E8E2E4] bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div
                      className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl"
                      style={{ backgroundColor: journal.background_color || '#FFF7F8' }}
                    >
                      {journal.cover_media_url || journal.cover_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={journal.cover_media_url || journal.cover_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-2xl">📖</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{journal.title}</p>
                      <p className="line-clamp-1 text-xs text-[#6B6B6B]">
                        {journal.description || journal.foreword || 'No description yet.'}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Stories tab */}
        {activeTab === 'stories' && (
          <section className="mt-4">
            {stories.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#E8E2E4] bg-white/60 px-6 py-10 text-center text-sm text-[#6B6B6B]">
                {isMe ? (
                  <>
                    No active stories.{' '}
                    <Link href="/stories/new" className="font-semibold text-[#E5798F] underline">
                      Add one
                    </Link>
                    .
                  </>
                ) : (
                  'No active stories.'
                )}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {stories.map((story) => (
                  <button
                    key={story.id}
                    onClick={() => setViewerOpen(true)}
                    className="relative aspect-[9/16] overflow-hidden rounded-xl bg-black"
                  >
                    {story.media_type === 'video' ? (
                      <video src={story.media_url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={story.media_url} alt={story.caption || 'Story'} className="h-full w-full object-cover" />
                    )}
                    <span className="absolute right-1 top-1 rounded bg-black/50 px-1 text-[9px] font-bold text-white">
                      <ImagePlus className="inline h-2.5 w-2.5" />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
        </>
        )}
      </div>


      {/* Story viewer for this profile's stories */}
      {viewerOpen && stories.length > 0 && profile && (
        <StoryViewer
          groups={[
            {
              author: {
                id: profile.id,
                full_text_name: profile.full_text_name,
                username: profile.username,
                avatar_url: profile.avatar_url,
              },
              stories,
            },
          ]}
          startGroup={0}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </main>
  );
}
