'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Flag, Heart, Loader2, MessageCircle, Pencil, Send, Smile, Trash2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import type { Comment } from '@/types/social';
import Avatar from '@/components/social/Avatar';
import EmojiPicker from '@/components/pickers/EmojiPicker';
import GifPicker from '@/components/pickers/GifPicker';
import ReportDialog from '@/components/social/ReportDialog';

const PAGE_SIZE = 10;
const REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '👏', '🔥'];

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return new Date(iso).toLocaleDateString();
}

interface CommentThreadProps {
  postId: string;
  /** Post author id — used to route comment notifications. */
  postAuthorId?: string;
  parentComment?: Comment | null;
  /** Depth 0 = top-level comments. Only top-level ones are paginated. */
  depth?: number;
  onCountChange?: (delta: number) => void;
  onClose?: () => void;
}

/** Fire-and-forget in-app notification (and Web Push via the DB trigger). */
function notify(userId: string, actorId: string, type: string, message: string, entityId?: string) {
  if (userId === actorId) return;
  void supabase.from('notifications').insert({
    user_id: userId,
    actor_id: actorId,
    type,
    entity_type: 'post',
    entity_id: entityId,
    message,
  });
}

/**
 * Paginated, nested, reactive comment list. Used by the post page (depth 0)
 * and recursively for replies.
 */
export default function CommentThread({ postId, postAuthorId, parentComment, depth = 0, onCountChange, onClose }: CommentThreadProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState('');
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showGif, setShowGif] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [repliesOpen, setRepliesOpen] = useState<Set<string>>(new Set());
  const [reportTarget, setReportTarget] = useState<string | null>(null);
  const [reactionFor, setReactionFor] = useState<string | null>(null);
  const [mentionResults, setMentionResults] = useState<{ id: string; username: string; full_text_name: string }[]>([]);
  const mentionField = useRef<'draft' | 'reply'>('draft');
  const mentionQuerySeq = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const pickerHostRef = useRef<HTMLDivElement>(null);
  const pickerIdRef = useRef(`comment-picker-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setMyId(user?.id || null));
  }, []);

  /* Close transient UI when focus moves away, Escape is pressed, or the page scrolls. */
  useEffect(() => {
    if (!reactionFor && !showEmoji && !showGif) return;

    const closeTransient = () => {
      setReactionFor(null);
      setShowEmoji(false);
      setShowGif(false);
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (pickerHostRef.current && target && pickerHostRef.current.contains(target)) return;
      closeTransient();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeTransient();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', closeTransient, true);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', closeTransient, true);
    };
  }, [reactionFor, showEmoji, showGif]);

  /* Only one GIF/emoji drawer should remain open across recursively-rendered threads. */
  useEffect(() => {
    const onPickerOpen = (event: Event) => {
      const custom = event as CustomEvent<string>;
      if (custom.detail === pickerIdRef.current) return;
      setShowEmoji(false);
      setShowGif(false);
    };
    window.addEventListener('enotes:comment-picker-open', onPickerOpen);
    return () => window.removeEventListener('enotes:comment-picker-open', onPickerOpen);
  }, []);

  const openPicker = (picker: 'emoji' | 'gif') => {
    window.dispatchEvent(new CustomEvent('enotes:comment-picker-open', { detail: pickerIdRef.current }));
    setReactionFor(null);
    if (picker === 'emoji') {
      setShowEmoji((v) => !v);
      setShowGif(false);
    } else {
      setShowGif((v) => !v);
      setShowEmoji(false);
    }
  };

  /* @-autocomplete: suggest profiles while the text ends with a partial @handle */
  const trackMentions = (text: string, field: 'draft' | 'reply') => {
    mentionField.current = field;
    const match = text.match(/@([a-zA-Z0-9_]{1,24})$/);
    if (!match || !myId) {
      setMentionResults([]);
      return;
    }
    const seq = ++mentionQuerySeq.current;
    supabase
      .from('profiles')
      .select('id, username, full_text_name')
      .ilike('username', `${match[1]}%`)
      .neq('id', myId)
      .limit(5)
      .then(({ data }) => {
        if (seq === mentionQuerySeq.current) setMentionResults((data || []) as { id: string; username: string; full_text_name: string }[]);
      });
  };

  const completeMention = (username: string) => {
    const finish = (d: string) => d.replace(/@([a-zA-Z0-9_]*)$/, `@${username} `);
    if (mentionField.current === 'reply') setReplyDraft(finish);
    else setDraft(finish);
    setMentionResults([]);
  };

  const loadPage = useCallback(
    async (page: number) => {
      const from = page * PAGE_SIZE;
      let query = supabase
        .from('comments')
        .select(
          `id, post_id, author_id, content, parent_comment_id, gif_url, edited_at, deleted_at, created_at,
           author:profiles!comments_author_id_fkey(id, full_text_name, username, avatar_url)`
        )
        .eq('post_id', postId)
        .order('created_at', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (depth === 0) {
        query = query.is('parent_comment_id', null);
      } else if (parentComment) {
        query = query.eq('parent_comment_id', parentComment.id);
      }

      const { data, error } = await query;
      if (error) {
        setLoading(false);
        setLoadingMore(false);
        return;
      }
      const rows = (data || []) as unknown as Comment[];
      setComments((prev) => (page === 0 ? rows : [...prev, ...rows]));
      setHasMore(rows.length === PAGE_SIZE);
      setLoading(false);
      setLoadingMore(false);
    },
    [postId, parentComment?.id, depth]
  );

  useEffect(() => {
    setLoading(true);
    loadPage(0);
  }, [loadPage]);

  /* Realtime: new comments on this post appear without reload */
  useEffect(() => {
    const channel = supabase
      .channel(`comments-live-${postId}-${depth}-${parentComment?.id || 'root'}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'comments', filter: `post_id=eq.${postId}` },
        () => loadPage(0)
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [postId, depth, parentComment?.id, loadPage]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!myId || (!draft.trim() && !gifUrl) || sending) return;
    setSending(true);

    /* mentions: @username → resolve ids client-side via a lightweight query */
    const mentions: { id: string; username: string }[] = [];
    const handles = Array.from(new Set((draft.match(/@([a-zA-Z0-9_]{3,24})/g) || []).map((h) => h.slice(1))));
    if (handles.length) {
      const { data: found } = await supabase.from('profiles').select('id, username').in('username', handles);
      for (const f of found || []) mentions.push(f as { id: string; username: string });
    }

    const { data, error } = await supabase
      .from('comments')
      .insert({
        post_id: postId,
        author_id: myId,
        content: draft.trim(),
        parent_comment_id: depth > 0 && parentComment ? parentComment.id : null,
        gif_url: gifUrl,
        mentions,
      })
      .select(
        `id, post_id, author_id, content, parent_comment_id, gif_url, created_at,
         author:profiles!comments_author_id_fkey(id, full_text_name, username, avatar_url)`
      )
      .maybeSingle();

    setSending(false);
    if (error || !data) return;

    setComments((list) => [...list, data as unknown as Comment]);
    setDraft('');
    setGifUrl(null);
    setShowEmoji(false);
    setShowGif(false);
    setMentionResults([]);
    onCountChange?.(1);

    /* notifications: mentioned users + the post author */
    const inserted = data as unknown as Comment;
    const mentionedIds = mentions.filter((m) => m.id !== myId).map((m) => m.id);
    for (const uid of mentionedIds) notify(uid, myId, 'mention', 'mentioned you in a comment', postId);
    if (postAuthorId && !mentionedIds.includes(postAuthorId)) {
      notify(postAuthorId, myId, 'comment', 'commented on your post', postId);
    }
  };

  const saveEdit = async (comment: Comment) => {
    if (!editDraft.trim()) return;
    setEditingId(null);
    setComments((list) => list.map((c) => (c.id === comment.id ? { ...c, content: editDraft.trim(), edited_at: new Date().toISOString() } : c)));
    await supabase.from('comments').update({ content: editDraft.trim(), edited_at: new Date().toISOString() }).eq('id', comment.id);
  };

  const removeComment = async (comment: Comment) => {
    setComments((list) => list.filter((c) => c.id !== comment.id));
    onCountChange?.(-1);
    await supabase.from('comments').delete().eq('id', comment.id);
  };

  const toggleReaction = async (comment: Comment, emoji: string) => {
    if (!myId) return;
    const current = comment.reactions || {};
    const mine = current[emoji]?.mine;

    /* optimistic */
    setComments((list) =>
      list.map((c) => {
        if (c.id !== comment.id) return c;
        const reactions = { ...(c.reactions || {}) };
        const entry = { count: reactions[emoji]?.count || 0, mine: !mine };
        if (mine) {
          entry.count = Math.max(0, entry.count - 1);
          if (entry.count === 0) delete reactions[emoji];
          else reactions[emoji] = entry;
        } else {
          entry.count += 1;
          reactions[emoji] = entry;
        }
        return { ...c, reactions };
      })
    );

    if (mine) {
      await supabase.from('comment_reactions').delete().eq('comment_id', comment.id).eq('user_id', myId).eq('emoji', emoji);
    } else {
      await supabase.from('comment_reactions').insert({ comment_id: comment.id, user_id: myId, emoji });
    }
  };

  const loadReactions = useCallback(async (ids: string[]) => {
    if (!ids.length || !myId) return;
    const { data } = await supabase.from('comment_reactions').select('comment_id, emoji, user_id').in('comment_id', ids);
    const map: Record<string, Comment['reactions']> = {};
    for (const row of (data || []) as { comment_id: string; emoji: string; user_id: string }[]) {
      const reactions = map[row.comment_id] || {};
      const entry = reactions[row.emoji] || { count: 0, mine: false };
      entry.count += 1;
      if (row.user_id === myId) entry.mine = true;
      reactions[row.emoji] = entry;
      map[row.comment_id] = reactions;
    }
    setComments((list) => list.map((c) => (map[c.id] ? { ...c, reactions: map[c.id] } : c)));
  }, [myId]);

  useEffect(() => {
    if (comments.length) loadReactions(comments.map((c) => c.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments.length, loadReactions]);

  const openReplies = (comment: Comment) => {
    setRepliesOpen((prev) => {
      const next = new Set(prev);
      if (next.has(comment.id)) next.delete(comment.id);
      else next.add(comment.id);
      return next;
    });
  };

  const renderComment = (comment: Comment) => {
    const isMine = comment.author_id === myId;
    const reactions = comment.reactions || {};
    const isEditing = editingId === comment.id;

    return (
      <li key={comment.id} className="min-w-0">
        <div className="flex items-start gap-2.5">
          <Link href={comment.author?.username ? `/u/${comment.author.username}` : '#'}>
            <Avatar src={comment.author?.avatar_url} name={comment.author?.full_text_name || comment.author?.username} size={depth > 0 ? 28 : 32} />
          </Link>

          <div className="min-w-0 flex-1">
            <div className="rounded-2xl bg-[#F8F4F6] px-3 py-2">
              <p className="text-xs font-semibold">
                <Link href={comment.author?.username ? `/u/${comment.author.username}` : '#'} className="hover:underline">
                  {comment.author?.full_text_name || comment.author?.username || 'Writer'}
                </Link>
                <span className="ml-2 font-normal text-[#9B9B9B]">
                  {timeAgo(comment.created_at)}
                  {comment.edited_at && !comment.deleted_at ? ' · edited' : ''}
                </span>
              </p>

              {isEditing ? (
                <div className="mt-1">
                  <textarea
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    rows={2}
                    autoFocus
                    className="w-full resize-none rounded-lg border border-[#E8E2E4] p-2 text-sm focus:border-[#1E90FF] focus:outline-none"
                  />
                  <div className="mt-1 flex gap-1.5">
                    <button onClick={() => saveEdit(comment)} className="rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-[#FFB6C1]">Save</button>
                    <button onClick={() => setEditingId(null)} className="rounded-lg border px-3 py-1.5 text-xs font-semibold">Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  {comment.content && (
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">
                      {comment.content.split(/(@[a-zA-Z0-9_]{3,24})/g).map((part, i) =>
                        part.startsWith('@') ? (
                          <Link key={i} href={`/u/${part.slice(1)}`} className="font-semibold text-[#1E90FF] hover:underline">
                            {part}
                          </Link>
                        ) : (
                          <React.Fragment key={i}>{part}</React.Fragment>
                        )
                      )}
                    </p>
                  )}
                  {comment.gif_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={comment.gif_url} alt="GIF" loading="lazy" className="mt-1.5 max-h-48 rounded-xl" />
                  )}
                </>
              )}
            </div>

            {/* Reaction bar */}
            <div className="mt-1 flex flex-wrap items-center gap-2 pl-1">
              {Object.entries(reactions).map(([emoji, info]) => (
                <button
                  key={emoji}
                  onClick={() => toggleReaction(comment, emoji)}
                  className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] transition ${
                    info.mine ? 'border-[#E5798F] bg-[#FFF0F3]' : 'border-[#E8E2E4] bg-white'
                  }`}
                >
                  <span>{emoji}</span> {info.count}
                </button>
              ))}

              {/* react trigger — the picker needs a home on untouched comments */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setReactionFor(reactionFor === comment.id ? null : comment.id);
                }}
                aria-label="React to comment"
                aria-expanded={reactionFor === comment.id}
                className="text-[11px] text-[#9B9B9B] transition hover:scale-125"
              >
                <Smile className="h-3.5 w-3.5" />
              </button>
              {reactionFor === comment.id && (
                <span className="z-30 flex gap-0.5 rounded-full border border-[#E8E2E4] bg-white px-1.5 py-1 shadow-lg">
                  {REACTION_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleReaction(comment, emoji);
                        setReactionFor(null);
                      }}
                      className="rounded-full p-0.5 text-base transition hover:scale-125"
                      aria-label={`React ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </span>
              )}
              <button
                onClick={() => {
                  setReplyTo(replyTo === comment.id ? null : comment.id);
                  setReplyDraft('');
                }}
                className="text-[11px] font-semibold text-[#6B6B6B] hover:underline"
              >
                Reply
              </button>

              {myId && (
                <details className="relative">
                  <summary className="cursor-pointer list-none text-[11px] text-[#9B9B9B] hover:underline">···</summary>
                  <div className="absolute left-0 z-20 mt-1 w-36 overflow-hidden rounded-xl border border-[#E8E2E4] bg-white shadow-lg">
                    {isMine ? (
                      <>
                        <button onClick={() => { setEditingId(comment.id); setEditDraft(comment.content); }} className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-gray-50">
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </button>
                        <button onClick={() => removeComment(comment)} className="flex w-full items-center gap-2 px-3 py-2 text-xs text-red-500 hover:bg-red-50">
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </button>
                      </>
                    ) : (
                      <button onClick={() => setReportTarget(comment.id)} className="flex w-full items-center gap-2 px-3 py-2 text-xs text-red-500 hover:bg-red-50">
                        <Flag className="h-3.5 w-3.5" /> Report
                      </button>
                    )}
                  </div>
                </details>
              )}
            </div>

            {/* Reply box */}
            {replyTo === comment.id && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!replyDraft.trim() || !myId) return;
                  (async () => {
                    const { data, error } = await supabase
                      .from('comments')
                      .insert({ post_id: postId, author_id: myId, content: replyDraft.trim(), parent_comment_id: comment.id })
                      .select(
                        `id, post_id, author_id, content, parent_comment_id, gif_url, created_at,
                         author:profiles!comments_author_id_fkey(id, full_text_name, username, avatar_url)`
                      )
                      .maybeSingle();
                    if (data && !error) {
                      onCountChange?.(1);

                      setRepliesOpen((prev) => {
                        const next = new Set(prev);
                        next.add(comment.id);
                        return next;
                      });
                      if (myId) {
                        /* notify the parent author + post author (once each) */
                        if (comment.author_id !== myId) notify(comment.author_id, myId, 'comment_reply', 'replied to your comment', postId);
                        if (postAuthorId && postAuthorId !== myId && postAuthorId !== comment.author_id) {
                          notify(postAuthorId, myId, 'comment', 'commented on your post', postId);
                        }
                      }
                    }
                    setReplyDraft('');
                    setReplyTo(null);
                  })();
                }}
                className="mt-1.5 flex items-center gap-2"
              >
                <input
                  value={replyDraft}
                  onChange={(e) => {
                    setReplyDraft(e.target.value);
                    trackMentions(e.target.value, 'reply');
                  }}
                  placeholder={`Reply to ${comment.author?.username || 'this'}…`}
                  autoFocus
                  className="min-w-0 flex-1 rounded-full border border-[#E8E2E4] px-3 py-2 text-sm focus:border-[#1E90FF] focus:outline-none"
                />
                <button type="submit" className="flex h-9 w-9 items-center justify-center rounded-full bg-black text-[#FFB6C1]" aria-label="Send reply">
                  <Send className="h-4 w-4" />
                </button>
              </form>
            )}

            {/* Recursive replies: every reply can have its own replies. */}
            <>
              <button
                onClick={() => openReplies(comment)}
                className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-[#6B6B6B] hover:underline"
              >
                <ChevronDown className={`h-3.5 w-3.5 transition ${repliesOpen.has(comment.id) ? 'rotate-180' : ''}`} />
                {repliesOpen.has(comment.id) ? 'Hide replies' : 'View replies'}
              </button>
              {repliesOpen.has(comment.id) && (
                <div className="mt-2 border-l-2 border-[#F0EAEC] pl-3">
                  <CommentThread
                    postId={postId}
                    postAuthorId={postAuthorId}
                    parentComment={comment}
                    depth={depth + 1}
                    onCountChange={onCountChange}
                  />
                </div>
              )}
            </>
          </div>
        </div>
      </li>
    );
  };

  return (
    <div ref={listRef}>
      {depth === 0 && onClose && (
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-bold">
            <MessageCircle className="h-4 w-4" /> Comments
          </h3>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-gray-100" aria-label="Close comments">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-6 text-xs text-[#9B9B9B]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading comments…
        </div>
      ) : comments.length === 0 ? (
        <p className="py-4 text-center text-xs text-[#9B9B9B]">
          {depth === 0 ? 'No comments yet. Say something kind ♡' : 'No replies yet.'}
        </p>
      ) : (
        <ul className={depth > 0 ? 'space-y-3' : 'space-y-4'}>{comments.map(renderComment)}</ul>
      )}

      {hasMore && !loading && (
        <button
          onClick={() => {
            setLoadingMore(true);
            loadPage(Math.ceil(comments.length / PAGE_SIZE));
          }}
          disabled={loadingMore}
          className="mx-auto mt-3 flex items-center gap-1.5 rounded-xl border border-[#E8E2E4] bg-white px-4 py-2 text-xs font-semibold shadow-sm disabled:opacity-50"
        >
          {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />}
          Load more comments
        </button>
      )}

      {/* @-mention autocomplete — above the composer, tap to complete */}
      {mentionResults.length > 0 && (
        <div className="relative z-30 mx-1 mb-1 overflow-hidden rounded-xl border border-[#E8E2E4] bg-white shadow-lg">
          {mentionResults.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => completeMention(p.username)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[#FDF0F3]"
            >
              <span className="font-semibold">@{p.username}</span>
              <span className="truncate text-xs text-[#6B6B6B]">{p.full_text_name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Composer (inline for this thread) */}
      <form onSubmit={submit} className="mt-3">
        {gifUrl && (
          <div className="relative mb-2 inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={gifUrl} alt="GIF attachment" className="max-h-32 rounded-xl" />
            <button type="button" onClick={() => setGifUrl(null)} className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black text-white" aria-label="Remove GIF">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="flex items-center gap-2">
          <div ref={pickerHostRef} className="contents">
            <button
              type="button"
              onClick={() => openPicker('emoji')}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#E8E2E4] text-[#6B6B6B] transition hover:bg-gray-50"
              aria-label="Add emoji"
              aria-expanded={showEmoji}
            >
              <Smile className="h-4.5 w-4.5" />
            </button>
            <button
              type="button"
              onClick={() => openPicker('gif')}
              className="flex h-10 shrink-0 items-center justify-center rounded-full border border-[#E8E2E4] px-3 text-xs font-bold text-[#6B6B6B] transition hover:bg-gray-50"
              aria-label="Add GIF"
              aria-expanded={showGif}
            >
              GIF
            </button>

            {showEmoji && (
              <div className="fixed inset-x-2 bottom-20 z-[100] mx-auto flex h-[min(70dvh,520px)] w-[calc(100vw-1rem)] max-w-[360px] flex-col overflow-hidden rounded-2xl border border-[#E8E2E4] bg-white shadow-2xl sm:absolute sm:bottom-12 sm:left-0 sm:right-auto sm:inset-x-auto sm:mx-0">
                <div className="flex h-11 shrink-0 items-center justify-between border-b border-[#F0EAEC] px-3">
                  <span className="text-xs font-bold text-[#6B6B6B]">Emoji</span>
                  <button type="button" onClick={() => setShowEmoji(false)} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-gray-100" aria-label="Close emoji picker">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <EmojiPicker onPick={(e) => { setDraft((d) => d + e); setShowEmoji(false); }} />
                </div>
              </div>
            )}

            {showGif && (
              <div className="fixed inset-x-2 bottom-20 z-[100] mx-auto flex h-[min(70dvh,520px)] w-[calc(100vw-1rem)] max-w-[360px] flex-col overflow-hidden rounded-2xl border border-[#E8E2E4] bg-white shadow-2xl sm:absolute sm:bottom-12 sm:left-0 sm:right-auto sm:inset-x-auto sm:mx-0">
                <div className="flex h-11 shrink-0 items-center justify-between border-b border-[#F0EAEC] px-3">
                  <span className="text-xs font-bold text-[#6B6B6B]">GIFs</span>
                  <button type="button" onClick={() => setShowGif(false)} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-gray-100" aria-label="Close GIF picker">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <GifPicker onPick={(g) => { setGifUrl(g.url); setShowGif(false); }} />
                </div>
              </div>
            )}
          </div>
          <input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              trackMentions(e.target.value, 'draft');
            }}
            onKeyDown={(e) => {
              /* Enter submits (Shift is irrelevant on a single-line input);
               IME composition is respected so transliteration won't fire. */
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={depth > 0 ? 'Write a reply…' : 'Add a comment…'}
            className="min-w-0 flex-1 rounded-full border border-[#E8E2E4] px-4 py-2.5 text-sm focus:border-[#1E90FF] focus:outline-none"
            aria-label={depth > 0 ? 'Reply' : 'Add a comment'}
          />
          <button
            type="submit"
            disabled={sending || (!draft.trim() && !gifUrl)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black text-[#FFB6C1] transition disabled:opacity-40"
            aria-label="Post comment"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </form>

      <ReportDialog open={reportTarget !== null} onClose={() => setReportTarget(null)} targetType="comment" targetId={reportTarget || ''} />
    </div>
  );
}
