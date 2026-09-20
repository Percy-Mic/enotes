'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, MessageCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import type { Post } from '@/types/social';
import Avatar from '@/components/social/Avatar';
import CommentThread from '@/components/social/CommentThread';

export default function PostCommentsPage() {
  const params = useParams();
  const router = useRouter();
  const postId = params?.postId as string;

  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('posts')
        .select(
          `id, author_id, content, created_at,
           author:profiles!posts_author_id_fkey(id, full_text_name, username, avatar_url)`
        )
        .eq('id', postId)
        .maybeSingle();
      setPost((data as unknown as Post) || null);
      setLoading(false);
    })();
  }, [postId]);

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
            <MessageCircle className="h-5 w-5 text-[#E5798F]" /> Comments
          </h1>
        </header>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-[#9B9B9B]">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading…
          </div>
        ) : !post ? (
          <div className="rounded-2xl border border-dashed border-[#E8E2E4] bg-white/60 px-6 py-14 text-center">
            <p className="text-lg font-semibold">Post not found</p>
            <p className="mt-1 text-sm text-[#6B6B6B]">It may have been deleted.</p>
            <Link href="/feed" className="mt-4 inline-block rounded-xl bg-black px-5 py-2.5 text-sm font-semibold text-[#FFB6C1]">
              Back to feed
            </Link>
          </div>
        ) : (
          <>
            {/* compact post context */}
            <section className="mb-4 rounded-2xl border border-[#E8E2E4] bg-white p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <Link href={post.author?.username ? `/u/${post.author.username}` : '#'}>
                  <Avatar src={post.author?.avatar_url} name={post.author?.full_text_name || post.author?.username} size={36} />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link href={`/posts/${postId}`} className="block truncate text-sm font-semibold hover:underline">
                    {post.author?.full_text_name || post.author?.username || 'Writer'}
                  </Link>
                  <Link href={`/posts/${postId}`} className="text-xs text-[#9B9B9B] hover:underline">
                    View full post →
                  </Link>
                </div>
              </div>
              {post.content && (
                <p className="mt-2 line-clamp-4 whitespace-pre-wrap break-words text-sm text-[#3D3D3D]">{post.content}</p>
              )}
            </section>

            <section className="rounded-2xl border border-[#E8E2E4] bg-white p-4 shadow-sm">
              <CommentThread postId={postId} postAuthorId={post?.author_id} />
            </section>
          </>
        )}
      </div>

    </main>
  );
}
