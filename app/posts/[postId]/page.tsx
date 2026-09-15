'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Ban, Flag, MessageCircle, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import type { Post } from '@/types/social';
import Avatar from '@/components/social/Avatar';
import PostCard from '@/components/social/PostCard';
import CommentThread from '@/components/social/CommentThread';

export default function PostPage() {
  const params = useParams();
  const router = useRouter();
  const postId = params?.postId as string;

  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setMyId(user?.id || null);

      const { data, error } = await supabase
        .from('posts')
        .select(
          `id, author_id, journal_id, page_id, content, media_url, media_type, media_size, post_type, link_url,
           visibility, created_at, edited_at,
           author:profiles!posts_author_id_fkey(id, full_text_name, username, avatar_url)`
        )
        .eq('id', postId)
        .maybeSingle();

      if (error || !data) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      let postRow = data as unknown as Post;

      /* counts + liked + journal info.
         post_likes has NO id column (its key is post_id + user_id) — counting
         on a nonexistent column makes PostgREST return 400 for the whole page. */
      const [{ count: likeCount }, { count: commentCount }, journal] = await Promise.all([
        supabase.from('post_likes').select('post_id', { count: 'exact', head: true }).eq('post_id', postId),
        supabase.from('comments').select('id', { count: 'exact', head: true }).eq('post_id', postId),
        postRow.journal_id
          ? supabase.from('journals').select('id, title, background_color').eq('id', postRow.journal_id).maybeSingle()
          : Promise.resolve({ data: null } as any),
      ]);

      postRow = {
        ...postRow,
        like_count: likeCount || 0,
        comment_count: commentCount || 0,
        liked_by_me: user ? false : false,
        journal_title: (journal?.data as any)?.title || null,
        journal_background: (journal?.data as any)?.background_color || null,
      };

      if (user) {
        const { data: likeRow } = await supabase
          .from('post_likes')
          .select('user_id')
          .eq('post_id', postId)
          .eq('user_id', user.id)
          .maybeSingle();
        postRow.liked_by_me = !!likeRow;

        if (postRow.author_id !== user.id) {
          const { data: blockRow } = await supabase
            .from('user_blocks')
            .select('blocker_id')
            .eq('blocker_id', postRow.author_id)
            .eq('blocked_id', user.id)
            .maybeSingle();
          setBlocked(!!blockRow);
        }
      }

      setPost(postRow);
      setLoading(false);
    })();
  }, [postId]);

  /* realtime reaction + comment count updates */
  useEffect(() => {
    if (!postId) return;
    const channel = supabase
      .channel(`post-live-${postId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter: `post_id=eq.${postId}` }, () => {
        setPost((p) => (p ? { ...p, comment_count: (p.comment_count || 0) + 1 } : p));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'post_reactions', filter: `post_id=eq.${postId}` }, () => {
        /* PostCard manages its own reaction state; here we just keep counts fresh via key bump */
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [postId]);

  if (loading) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-[#FFF7F8] text-[#6B6B6B]">
        Loading post…
      </main>
    );
  }

  if (notFound || !post) {
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 bg-[#FFF7F8] px-6 text-center">
        <p className="text-lg font-semibold">Post not found</p>
        <p className="text-sm text-[#6B6B6B]">It may have been deleted, or the link is wrong.</p>
        <Link href="/feed" className="rounded-xl bg-black px-5 py-2.5 text-sm font-semibold text-[#FFB6C1]">
          Back to feed
        </Link>
      </main>
    );
  }

  if (blocked) {
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 bg-[#FFF7F8] px-6 text-center">
        <Ban className="h-10 w-10 text-[#9B9B9B]" />
        <p className="text-lg font-semibold">This content is unavailable</p>
        <p className="max-w-sm text-sm text-[#6B6B6B]">The author has limited who can see their content.</p>
        <Link href="/feed" className="rounded-xl bg-black px-5 py-2.5 text-sm font-semibold text-[#FFB6C1]">
          Back to feed
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-[#FFF7F8] px-3 pb-24 pt-5 text-[#111111] sm:px-6 md:pb-10">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-4 flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#E8E2E4] bg-white shadow-sm"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="flex items-center gap-2 text-lg font-bold">
            <MessageCircle className="h-5 w-5 text-[#E5798F]" /> Post
          </h1>
          <div className="ml-auto flex gap-2">
            <Link
              href={`/posts/${postId}/comments`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#E8E2E4] bg-white px-3 py-2 text-xs font-semibold shadow-sm transition hover:bg-gray-50"
            >
              <Users className="h-3.5 w-3.5" /> Comments view
            </Link>
          </div>
        </header>

        <PostCard post={post} onDeleted={() => router.replace('/feed')} />

        {/* Inline comments */}
        <section className="mt-4 rounded-2xl border border-[#E8E2E4] bg-white p-4 shadow-sm">
          <CommentThread postId={postId} onCountChange={() => undefined} />
        </section>
      </div>

    </main>
  );
}
