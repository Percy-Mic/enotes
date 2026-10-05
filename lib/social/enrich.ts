'use client';

import { supabase } from '@/lib/supabase/client';
import type { Post } from '@/types/social';

/**
 * Post enrichment shared by every post list (feed, community, saved, profile).
 *
 * One owner for turning bare post rows into interactive PostCard payloads:
 * journal titles, like/comment counts, liked-by-me, reactions, saves, and
 * repost state. A post list fetches the base rows + `enrichPostIds` —
 * never duplicate the per-surface queries.
 */

export interface EnrichedPostFields {
  journal_title?: string | null;
  journal_background?: string | null;
  like_count?: number;
  liked_by_me?: boolean;
  comment_count?: number;
  reactions?: Record<string, { count: number; mine: boolean }>;
  saved_by_me?: boolean;
  repost_count?: number;
  reposted_by_me?: boolean;
  reposted_by?: string | null;
}

export async function enrichPosts(
  list: Post[],
  myId: string | null
): Promise<Post[]> {
  if (!list.length) return list;
  const postIds = Array.from(new Set(list.map((p) => p.id)));

  const journalIds = Array.from(new Set(list.map((p) => p.journal_id).filter(Boolean))) as string[];
  let journalMap = new Map<string, { title: string; background_color: string }>();
  if (journalIds.length) {
    const { data: jd } = await supabase
      .from('journals')
      .select('id, title, background_color')
      .in('id', journalIds);
    journalMap = new Map((jd || []).map((j: any) => [j.id, j]));
  }

  const [likes, counts, reactions, saves, reposts] = await Promise.all([
    supabase.from('post_likes').select('post_id, user_id').in('post_id', postIds),
    supabase.from('comments').select('post_id').in('post_id', postIds),
    supabase.from('post_reactions').select('post_id, emoji, user_id').in('post_id', postIds),
    supabase.from('saved_posts').select('post_id, user_id').in('post_id', postIds),
    supabase
      .from('reposts')
      .select('post_id, user_id')
      .in('post_id', postIds),
  ]);

  const likeRows = (likes.data || []) as { post_id: string; user_id: string }[];
  const commentCounts = ((counts.data || []) as { post_id: string }[]).reduce(
    (acc: Record<string, number>, row) => {
      acc[row.post_id] = (acc[row.post_id] || 0) + 1;
      return acc;
    },
    {}
  );
  const reactionRows = (reactions.data || []) as { post_id: string; emoji: string; user_id: string }[];
  const saveRows = (saves.data || []) as { post_id: string; user_id: string }[];
  const repostRows = ((reposts.data || []) as { post_id: string; user_id: string }[]);


  return list.map((p) => {
    const reactions: Record<string, { count: number; mine: boolean }> = {};
    for (const r of reactionRows) {
      if (r.post_id !== p.id) continue;
      const e = reactions[r.emoji] || { count: 0, mine: false };
      e.count += 1;
      if (r.user_id === myId) e.mine = true;
      reactions[r.emoji] = e;
    }

    return {
      ...p,
      journal_title: p.journal_id ? journalMap.get(p.journal_id)?.title : null,
      journal_background: p.journal_id ? journalMap.get(p.journal_id)?.background_color : null,
      like_count: likeRows.filter((l) => l.post_id === p.id).length,
      liked_by_me: myId ? likeRows.some((l) => l.post_id === p.id && l.user_id === myId) : false,
      comment_count: commentCounts[p.id] || 0,
      reactions,
      saved_by_me: myId ? saveRows.some((s) => s.post_id === p.id && s.user_id === myId) : false,
      repost_count: repostRows.filter((r) => r.post_id === p.id).length,
      reposted_by_me: myId ? repostRows.some((r) => r.post_id === p.id && r.user_id === myId) : false,
      reposted_by: null,
    };
  });
}
