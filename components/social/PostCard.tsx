'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Bookmark, EyeOff, Flag, Heart, Link2, Loader2, MessageCircle, MoreHorizontal,
  Pencil, Repeat2, Save, Send, Share2, Smile, Trash2, Users, X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import type { Post } from '@/types/social';
import Avatar from '@/components/social/Avatar';
import AutoVideo from '@/components/social/AutoVideo';
import EmojiPicker from '@/components/pickers/EmojiPicker';
import ReportDialog from '@/components/social/ReportDialog';
import SharePostPicker from '@/components/community/SharePostPicker';

const TRUNCATE_LENGTH = 480; /* long posts collapse → read more */
const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '👏'];

function timeAgo(iso: string) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

/** Render text with clickable #hashtags, @mentions and bare links. */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/(#[a-zA-Z0-9_]+|@[a-zA-Z0-9_]{3,24}|https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('#')) {
          return (
            <Link key={i} href={`/search?q=${encodeURIComponent(part.slice(1))}`} className="font-semibold text-[#1E90FF] hover:underline">
              {part}
            </Link>
          );
        }
        if (part.startsWith('@')) {
          return (
            <Link key={i} href={`/u/${part.slice(1)}`} className="font-semibold text-[#1E90FF] hover:underline">
              {part}
            </Link>
          );
        }
        if (part.startsWith('http')) {
          return (
            <a key={i} href={part} target="_blank" rel="noreferrer" className="break-all text-[#1E90FF] underline">
              {part.length > 48 ? `${part.slice(0, 45)}…` : part}
            </a>
          );
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </>
  );
}

interface PostCardProps {
  post: Post;
  onDeleted?: (postId: string) => void;
  onHide?: (postId: string) => void;
  /** compact mode for grids/search results */
  compact?: boolean;
}

type ReactionMap = Record<string, { count: number; mine: boolean }>;

function mapReactions(rows: { emoji: string; user_id: string }[] | null, myId: string | null): ReactionMap {
  const map: ReactionMap = {};
  for (const r of rows || []) {
    const e = map[r.emoji] || { count: 0, mine: false };
    e.count += 1;
    if (r.user_id === myId) e.mine = true;
    map[r.emoji] = e;
  }
  return map;
}

export default function PostCard({ post, onDeleted, onHide, compact = false }: PostCardProps) {
  const [liked, setLiked] = useState(!!post.liked_by_me);
  const [likeCount, setLikeCount] = useState(post.like_count || 0);
  const [commentCount, setCommentCount] = useState(post.comment_count || 0);
  const [reactions, setReactions] = useState<ReactionMap>(post.reactions || {});
  const [saved, setSaved] = useState(!!post.saved_by_me);
  const [reposted, setReposted] = useState(!!post.reposted_by_me);
  const [repostCount, setRepostCount] = useState(post.repost_count || 0);
  const [repostBusy, setRepostBusy] = useState(false);
  const [repostNote, setRepostNote] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(post.content);
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [sharingToCommunity, setSharingToCommunity] = useState(false);
  const likeBusyRef = useRef(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setMyId(user?.id || null);
      if (!user) return;
      /* my reaction rows for this post (only for cards not preloaded with them) */
      if (!post.reactions) {
        supabase
          .from('post_reactions')
          .select('emoji, user_id')
          .eq('post_id', post.id)
          .then(({ data: rows }) => setReactions(mapReactions(rows, user.id)));
      }
      /* bookmark state */
      supabase
        .from('saved_posts')
        .select('post_id')
        .eq('post_id', post.id)
        .eq('user_id', user.id)
        .maybeSingle()
        .then(({ data: row }) => setSaved(!!row));
    });
  }, [post.id, post.reactions]);

  const toggleLike = async () => {
    if (!myId) return;
    /* Serialize double-taps: two toggles before the first insert resolves
       used to POST a duplicate row → 400 from the (post_id, user_id) PK,
       flipping the heart back off. One request at a time + DB-truth sync. */
    if (likeBusyRef.current) return;
    likeBusyRef.current = true;
    const next = !liked;
    setLiked(next);
    setLikeCount((c) => Math.max(0, c + (next ? 1 : -1)));
    try {
      if (next) {
        const { error } = await supabase
          .from('post_likes')
          .upsert(
            { post_id: post.id, user_id: myId },
            { onConflict: 'post_id,user_id', ignoreDuplicates: true }
          );
        if (error) {
          setLiked(false);
          setLikeCount((c) => Math.max(0, c - 1));
        }
      } else {
        const { error } = await supabase
          .from('post_likes')
          .delete()
          .eq('post_id', post.id)
          .eq('user_id', myId);
        if (error) {
          /* unlike failed → restore DB-truth (still liked) */
          setLiked(true);
          setLikeCount((c) => c + 1);
        }
      }
    } finally {
      likeBusyRef.current = false;
    }
  };

  const refreshReactions = async () => {
    const { data: rows } = await supabase.from('post_reactions').select('emoji, user_id').eq('post_id', post.id);
    setReactions(mapReactions(rows, myId));
  };

  const toggleReaction = async (emoji: string) => {
    if (!myId) return;
    const mine = reactions[emoji]?.mine;
    /* a user holds at most one reaction on a post — switching replaces */
    const previous = Object.keys(reactions).find((e) => reactions[e]?.mine);

    setReactions((prev) => {
      const next: ReactionMap = {};
      for (const [e, v] of Object.entries(prev)) {
        if (v.mine && e !== emoji) continue; /* old reaction of mine goes away */
        next[e] = { ...v };
      }
      if (mine) {
        const count = Math.max(0, (next[emoji]?.count || 0) - 1);
        if (count > 0) next[emoji] = { count, mine: false };
        else delete next[emoji];
      } else {
        next[emoji] = { count: (next[emoji]?.count || 0) + 1, mine: true };
      }
      return next;
    });

    if (mine) {
      const { error } = await supabase
        .from('post_reactions')
        .delete()
        .eq('post_id', post.id)
        .eq('user_id', myId)
        .eq('emoji', emoji);
      if (error) await refreshReactions(); /* revert to DB truth */
    } else {
      /* replacing an older reaction of mine → drop it first, then upsert
         (upsert also makes a rapid double-tap on one emoji idempotent) */
      if (previous && previous !== emoji) {
        await supabase
          .from('post_reactions')
          .delete()
          .eq('post_id', post.id)
          .eq('user_id', myId)
          .neq('emoji', emoji);
      }
      const { error } = await supabase
        .from('post_reactions')
        .upsert({ post_id: post.id, user_id: myId, emoji }, { onConflict: 'post_id,user_id,emoji' });
      if (error) await refreshReactions();
    }
  };

  const toggleSave = async () => {
    if (!myId) return;
    const next = !saved;
    setSaved(next);
    if (next) {
      await supabase.from('saved_posts').insert({ post_id: post.id, user_id: myId });
    } else {
      await supabase.from('saved_posts').delete().eq('post_id', post.id).eq('user_id', myId);
    }
  };

  /** Repost to my feed / undo it. Optimistic; reverts with an explanation if
      the database rejects it (own post, blocked pair, private post…). */
  const toggleRepost = async () => {
    if (!myId || repostBusy) return;
    setRepostBusy(true);
    const next = !reposted;
    setReposted(next);
    setRepostCount((c) => Math.max(0, c + (next ? 1 : -1)));
    const { error } = next
      ? await supabase.from('reposts').insert({ post_id: post.id, user_id: myId })
      : await supabase.from('reposts').delete().eq('post_id', post.id).eq('user_id', myId);
    setRepostBusy(false);
    if (error) {
      setReposted(!next);
      setRepostCount((c) => Math.max(0, c + (next ? -1 : 1)));
      setRepostNote(
        /duplicate|reposts_pkey/i.test(error.message)
          ? 'Already in your feed'
          : error.message || 'Could not repost'
      );
      setTimeout(() => setRepostNote(null), 2600);
    }
  };

  const sharePost = async () => {
    const url = `${window.location.origin}/posts/${post.id}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'A post on enotes', text: post.content.slice(0, 120), url });
        return;
      } catch {
        /* user dismissed — fall through to clipboard */
      }
    }
    await navigator.clipboard.writeText(url);
    setShareStatus('Link copied ✓');
    setTimeout(() => setShareStatus(null), 1800);
  };

  const saveEdit = async () => {
    if (!editDraft.trim() || editDraft === post.content) {
      setEditing(false);
      return;
    }
    setSavingEdit(true);
    const { error } = await supabase
      .from('posts')
      .update({ content: editDraft.trim(), edited_at: new Date().toISOString() })
      .eq('id', post.id);
    setSavingEdit(false);
    if (!error) {
      setEditing(false);
      setEditDraft(editDraft.trim());
      window.location.reload(); /* cheap, correct refresh of a single card's text */
    }
  };

  const removePost = async () => {
    if (!confirmingDelete) {
      /* Menu stays open so "Tap again to confirm" is actually visible. */
      setConfirmingDelete(true);
      setTimeout(() => setConfirmingDelete(false), 3500);
      return;
    }
    setConfirmingDelete(false);
    const { error } = await supabase.from('posts').delete().eq('id', post.id);
    if (error) {
      setDeleteError(error.message);
      return; /* menu stays open; the error renders inside it */
    }
    setMenuOpen(false);
    onDeleted?.(post.id);
  };

  const isOwner = !!myId && myId === post.author_id;
  const authorName = post.author?.full_text_name || post.author?.username || 'Writer';
  const isLong = (post.content || '').length > TRUNCATE_LENGTH;
  const bodyText = isLong && !expanded ? post.content.slice(0, TRUNCATE_LENGTH) : post.content;

  const onCommentCount = useCallback(
    (delta: number) => setCommentCount((c) => Math.max(0, c + delta)),
    []
  );

  return (
    <article className="flex flex-col rounded-2xl border border-[#E8E2E4] bg-white shadow-sm">
      {/* Repost banner — “X reposted” sits above the author row, X-style.
          Guarded with typeof: a malformed value must never produce a
          non-string href (that crashes the whole route). */}
      {typeof post.reposted_by === 'string' && post.reposted_by && (
        <p className="flex items-center gap-1.5 px-4 pt-2.5 text-xs font-medium text-[#9B9B9B]">
          <Repeat2 className="h-3.5 w-3.5" />
          <Link
            href={`/u/${post.reposted_by}`}
            className="truncate font-semibold hover:underline"
          >
            {post.reposted_by}
          </Link>{' '}
          reposted
        </p>
      )}
      {/* Header */}
      <div className="flex items-center gap-3 p-4 pb-3">
        <Link href={post.author?.username ? `/u/${post.author.username}` : '/search'}>
          <Avatar src={post.author?.avatar_url} name={authorName} size={40} />
        </Link>
        <div className="min-w-0 flex-1">
          <Link
            href={post.author?.username ? `/u/${post.author.username}` : '/search'}
            className="block truncate text-sm font-semibold hover:underline"
          >
            {authorName}
          </Link>
          <p className="truncate text-xs text-[#9B9B9B]">
            <Link href={`/posts/${post.id}`} className="hover:underline">
              {post.author?.username ? `@${post.author.username} · ` : ''}
              {timeAgo(post.created_at)}
              {post.edited_at ? ' · edited' : ''}
            </Link>
            {post.visibility === 'followers' && ' · followers only'}
          </p>
        </div>

        {/* actions menu */}
        <div className="relative shrink-0">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[#9B9B9B] transition hover:bg-gray-100"
            aria-label="Post options"
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X className="h-4.5 w-4.5" /> : <MoreHorizontal className="h-4.5 w-4.5" />}
          </button>
          {menuOpen && (
            <div
              className="absolute right-0 top-10 z-30 w-44 overflow-hidden rounded-xl border border-[#E8E2E4] bg-white py-1 shadow-lg"
              role="menu"
            >
              <Link
                href={`/posts/${post.id}`}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-semibold hover:bg-gray-50"
                role="menuitem"
              >
                <MessageCircle className="h-4 w-4" /> Open post page
              </Link>
              <button onClick={() => { setMenuOpen(false); sharePost(); }} className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-semibold hover:bg-gray-50" role="menuitem">
                <Share2 className="h-4 w-4" /> Share
              </button>
              <button onClick={() => { setMenuOpen(false); setSharingToCommunity(true); }} className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-semibold hover:bg-gray-50" role="menuitem">
                <Users className="h-4 w-4" /> Share to community
              </button>
              <button onClick={() => { setMenuOpen(false); toggleSave(); }} className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-semibold hover:bg-gray-50" role="menuitem">
                <Bookmark className={`h-4 w-4 ${saved ? 'fill-current' : ''}`} /> {saved ? 'Remove bookmark' : 'Save'}
              </button>
              {isOwner ? (
                <>
                  <button onClick={() => { setMenuOpen(false); setEditing(true); }} className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-semibold hover:bg-gray-50" role="menuitem">
                    <Pencil className="h-4 w-4" /> Edit post
                  </button>
                  <button onClick={() => removePost()} className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-semibold text-red-500 hover:bg-red-50" role="menuitem">
                    <Trash2 className="h-4 w-4" /> {confirmingDelete ? 'Tap again to confirm' : 'Delete post'}
                  </button>
                  {deleteError && (
                    <p className="px-3 py-2 text-xs font-semibold text-red-600">{deleteError}</p>
                  )}
                </>
              ) : (
                <>
                  {onHide && (
                    <button onClick={() => { setMenuOpen(false); onHide(post.id); }} className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-semibold hover:bg-gray-50" role="menuitem">
                      <EyeOff className="h-4 w-4" /> Hide from my feed
                    </button>
                  )}
                  <button onClick={() => { setMenuOpen(false); setReporting(true); }} className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-semibold text-red-500 hover:bg-red-50" role="menuitem">
                    <Flag className="h-4 w-4" /> Report
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      {editing ? (
        <div className="px-4 pb-3">
          <textarea
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            rows={4}
            autoFocus
            className="w-full resize-none rounded-xl border border-[#E8E2E4] p-3 text-sm focus:border-[#1E90FF] focus:outline-none"
          />
          <div className="mt-2 flex gap-2">
            <button onClick={saveEdit} disabled={savingEdit} className="flex min-h-[38px] items-center gap-1.5 rounded-xl bg-black px-4 py-2 text-xs font-bold text-[#FFB6C1] disabled:opacity-50">
              {savingEdit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
            </button>
            <button onClick={() => { setEditing(false); setEditDraft(post.content); }} className="min-h-[38px] rounded-xl border px-4 py-2 text-xs font-semibold">Cancel</button>
          </div>
        </div>
      ) : (
        post.content && (
          <p className="whitespace-pre-wrap break-words px-4 pb-3 text-sm leading-relaxed text-[#111111]">
            <RichText text={bodyText} />
            {isLong && !expanded && '… '}
            {isLong && (
              <button onClick={() => setExpanded((v) => !v)} className="font-semibold text-[#1E90FF] hover:underline">
                {expanded ? 'Show less' : 'Read more'}
              </button>
            )}
          </p>
        )
      )}

      {/* Journal page preview */}
      {post.journal_id && post.page_id && !compact && (
        <Link
          href={`/journals/${post.journal_id}?page=${post.page_id}`}
          className="mx-4 mb-3 flex items-center gap-2 rounded-xl border border-[#E8E2E4] bg-[#FFF7F8] p-3 transition hover:bg-[#FFF0F3]"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white shadow-sm">
            <Link2 className="h-4 w-4 text-[#E5798F]" />
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-[#111111]">From journal page</span>
            <span className="block truncate text-xs text-[#6B6B6B]">{post.journal_title || 'Open the original page'}</span>
          </span>
        </Link>
      )}

      {/* Media */}
      {post.media_url && post.media_type === 'video' && (
        <AutoVideo
          src={post.media_url}
          className="max-h-[480px] w-full border-y border-[#E8E2E4] bg-black object-contain"
        />
      )}
      {post.media_url && (post.media_type === 'image' || post.media_type === 'gif') && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.media_url}
          alt=""
          loading="lazy"
          className="max-h-[420px] w-full border-y border-[#E8E2E4] object-cover"
        />
      )}
      {post.link_url && (
        <a href={post.link_url} target="_blank" rel="noreferrer" className="mx-4 mb-3 flex items-center gap-2 rounded-xl border border-[#E8E2E4] p-3 text-sm text-[#1E90FF] hover:bg-gray-50">
          <Link2 className="h-4 w-4 shrink-0" /> <span className="truncate">{post.link_url}</span>
        </a>
      )}

      {/* Reactions row */}
      {Object.keys(reactions).length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-2">
          {Object.entries(reactions).map(([emoji, info]) => (
            <button
              key={emoji}
              onClick={() => toggleReaction(emoji)}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition ${
                info.mine ? 'border-[#E5798F] bg-[#FFF0F3]' : 'border-[#E8E2E4] bg-white hover:bg-gray-50'
              }`}
              aria-label={`${emoji} ${info.count} reactions`}
            >
              <span>{emoji}</span> {info.count}
            </button>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="relative mt-auto flex items-center gap-0.5 border-t border-[#F0EAEC] px-2 py-1.5">
        <button
          onClick={toggleLike}
          className={`flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold transition ${
            liked ? 'text-[#E5798F]' : 'text-[#6B6B6B] hover:bg-gray-50'
          }`}
          aria-pressed={liked}
        >
          <Heart className={`h-5 w-5 ${liked ? 'fill-current' : ''}`} />
          {likeCount}
        </button>

        <Link
          href={`/posts/${post.id}`}
          className="flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold text-[#6B6B6B] transition hover:bg-gray-50"
        >
          <MessageCircle className="h-5 w-5" />
          {commentCount}
        </Link>

        <div className="relative">
          <button
            onClick={() => setShowEmoji((v) => !v)}
            className="flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-[#6B6B6B] transition hover:bg-gray-50"
            aria-label="Add reaction"
            aria-expanded={showEmoji}
          >
            <Smile className="h-5 w-5" />
          </button>
          {showEmoji && (
            <div className="fixed inset-x-2 bottom-2 z-50 flex justify-center sm:absolute sm:inset-x-auto sm:bottom-11 sm:left-0 sm:block">
              <div className="flex gap-1 rounded-2xl border border-[#E8E2E4] bg-white p-2 shadow-xl">
                {QUICK_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => {
                      toggleReaction(emoji);
                      setShowEmoji(false);
                    }}
                    className="rounded-lg p-1 text-xl transition hover:scale-125 hover:bg-[#FFF7F8]"
                    aria-label={`React ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={toggleRepost}
          disabled={!myId || repostBusy}
          title={reposted ? 'Undo repost' : 'Repost to your feed'}
          className={`flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold transition ${
            reposted ? 'text-[#17BF63]' : 'text-[#6B6B6B] hover:bg-gray-50'
          } disabled:opacity-40`}
          aria-pressed={reposted}
        >
          <Repeat2 className={`h-5 w-5 ${reposted ? 'fill-current' : ''}`} />
          {repostCount > 0 ? repostCount : ''}
        </button>

        <button
          onClick={sharePost}
          className="flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold text-[#6B6B6B] transition hover:bg-gray-50"
        >
          <Send className="h-4.5 w-4.5" />
          {shareStatus || 'Share'}
        </button>
      </div>

      {/* transient repost error/status */}
      {repostNote && (
        <p className="px-4 pb-2 text-xs font-medium text-red-500" role="status">{repostNote}</p>
      )}

      <ReportDialog open={reporting} onClose={() => setReporting(false)} targetType="post" targetId={post.id} />

      {sharingToCommunity && (
        <SharePostPicker
          postId={post.id}
          postLabel={post.content ? `"${post.content.slice(0, 30)}…"` : 'this post'}
          onClose={() => setSharingToCommunity(false)}
        />
      )}
    </article>
  );
}
