'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Send, Trash2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useAlert } from '@/components/ui/Alert';
import { Story } from '@/types/social';
import Avatar from './Avatar';
import { findOrCreateDm } from '@/lib/social/dm';

export interface StoryGroup {
  author: { id: string; full_text_name?: string; username?: string; avatar_url?: string };
  stories: Story[];
}

const IMAGE_DURATION_MS = 5000;
/** Swipe thresholds (px) — tuned for thumbs, forgiving on small screens */
const SWIPE_X_MIN = 48;
const SWIPE_Y_MIN = 70;
/** Story reaction picker — same generous set as chat */
const STORY_REACTIONS = ['❤️', '😂', '😮', '😢', '👏', '🔥', '🎉', '👍', '😍', '🥳', '🙏', '💯'];

export default function StoryViewer({
  groups,
  startGroup,
  onClose,
  onDeleted,
}: {
  groups: StoryGroup[];
  startGroup: number;
  onClose: () => void;
  /** Called after a story is deleted so the owner (feed) can drop it from state. */
  onDeleted?: (storyId: string) => void;
}) {
  const alert = useAlert();
  const [groupIndex, setGroupIndex] = useState(startGroup);
  const [storyIndex, setStoryIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [reply, setReply] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [mediaFailed, setMediaFailed] = useState(false);
  const [reactions, setReactions] = useState<{ emoji: string; count: number; mine: boolean }[]>([]);
  const [showReactionBar, setShowReactionBar] = useState(false);
  const [reactBusy, setReactBusy] = useState(false);
  const pausedRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  /* touch tracking for swipe navigation */
  const touchStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const swipeIntent = useRef<'none' | 'x' | 'y'>('none');

  const group = groups[groupIndex];
  /* Clamp while a deletion is propagating from the parent state */
  const story = group?.stories[Math.min(storyIndex, (group?.stories.length ?? 1) - 1)];
  const isMine = !!story && !!myId && story.author_id === myId;

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setMyId(user?.id || null));
  }, []);

  /* Keep indices valid when groups shrink (e.g. after deleting the last story) */
  useEffect(() => {
    if (group && storyIndex > group.stories.length - 1) {
      setStoryIndex(Math.max(0, group.stories.length - 1));
    }
  }, [group, storyIndex]);

  useEffect(() => {
    setMediaFailed(false);
    setConfirmingDelete(false);
    setShowReactionBar(false);
  }, [story?.id]);

  const next = useCallback(() => {
    setProgress(0);
    const g = groups[groupIndex];
    if (g && storyIndex + 1 < g.stories.length) {
      setStoryIndex(storyIndex + 1);
    } else if (groupIndex + 1 < groups.length) {
      setGroupIndex(groupIndex + 1);
      setStoryIndex(0);
    } else {
      onClose();
    }
  }, [groups, groupIndex, storyIndex, onClose]);

  const prev = useCallback(() => {
    setProgress(0);
    if (storyIndex > 0) {
      setStoryIndex(storyIndex - 1);
    } else if (groupIndex > 0) {
      const g = groupIndex - 1;
      setGroupIndex(g);
      setStoryIndex(Math.max(0, groups[g].stories.length - 1));
    }
  }, [groups, groupIndex, storyIndex]);

  /* Mark as viewed */
  useEffect(() => {
    if (!story) return;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user && user.id !== story.author_id) {
        await supabase.from('story_views').upsert(
          { story_id: story.id, viewer_id: user.id },
          { onConflict: 'story_id,viewer_id' },
        );
      }
    })();
  }, [story]);

  /* Load this story's reactions */
  useEffect(() => {
    if (!story) return;
    let active = true;
    setReactions([]);
    (async () => {
      const { data } = await supabase
        .from('story_reactions')
        .select('emoji, user_id')
        .eq('story_id', story.id);
      if (!active) return;
      const byEmoji = new Map<string, { count: number; mine: boolean }>();
      for (const row of data || []) {
        const cur = byEmoji.get(row.emoji) || { count: 0, mine: false };
        cur.count += 1;
        if (row.user_id === myId) cur.mine = true;
        byEmoji.set(row.emoji, cur);
      }
      setReactions(Array.from(byEmoji.entries()).map(([emoji, v]) => ({ emoji, ...v })));
    })();
    return () => {
      active = false;
    };
  }, [story, myId]);

  /* Toggle a reaction: mine already → remove, else add. Optimistic. */
  const toggleReaction = async (emoji: string) => {
    if (!story || !myId || reactBusy) return;
    setReactBusy(true);
    const existing = reactions.find((r) => r.emoji === emoji);
    if (existing?.mine) {
      setReactions((list) =>
        list
          .map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1, mine: false } : r))
          .filter((r) => r.count > 0),
      );
      await supabase
        .from('story_reactions')
        .delete()
        .eq('story_id', story.id)
        .eq('user_id', myId)
        .eq('emoji', emoji);
    } else {
      setReactions((list) => {
        const has = list.find((r) => r.emoji === emoji);
        if (has) return list.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, mine: true } : r));
        return [...list, { emoji, count: 1, mine: true }];
      });
      await supabase.from('story_reactions').upsert(
        { story_id: story.id, user_id: myId, emoji },
        { onConflict: 'story_id,user_id,emoji' },
      );
      if (story.author_id !== myId) {
        await supabase.from('notifications').insert({
          user_id: story.author_id,
          actor_id: myId,
          type: 'story_reaction',
          entity_type: 'story',
          entity_id: story.id,
          message: `reacted ${emoji} to your story`,
        });
      }
    }
    setReactBusy(false);
  };

  /* Progress timer for images; videos advance on natural end */
  useEffect(() => {
    if (!story || story.media_type === 'video') return;
    pausedRef.current = false;
    let elapsed = 0;
    let last = performance.now();
    let raf: number;

    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      if (!pausedRef.current) {
        elapsed += dt;
        const raw = elapsed / IMAGE_DURATION_MS;
        if (raw >= 1) {
          next();
          return;
        }
        setProgress(raw);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [story, next]);

  /* Escape key */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, next, prev]);

  /* Lock body scroll while open */
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  /* ---------- touch: swipe between stories / swipe down to close ---------- */
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY, t: performance.now() };
    swipeIntent.current = 'none';
    /* holding pauses, Instagram-style */
    pausedRef.current = true;
    if (videoRef.current && !videoRef.current.paused) videoRef.current.pause();
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    if (swipeIntent.current === 'none') {
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) swipeIntent.current = 'x';
      else if (dy > 12 && dy > Math.abs(dx)) swipeIntent.current = 'y';
    }
    /* NOTE: no preventDefault here — React registers touchmove as passive.
       Background scroll is already locked via body overflow:hidden. */
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    /* resume playback/timer unless the finger left via a nav button */
    pausedRef.current = false;
    if (videoRef.current && videoRef.current.paused && !videoRef.current.ended) {
      videoRef.current.play().catch(() => { /* autoplay policies — ignore */ });
    }
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const quick = performance.now() - start.t < 800;

    if (swipeIntent.current === 'x' && Math.abs(dx) > SWIPE_X_MIN) {
      if (dx < 0) next();
      else prev();
    } else if (swipeIntent.current === 'y' && dy > SWIPE_Y_MIN && quick) {
      onClose();
    }
  };

  /* Autoplay fallback: browsers block unmuted autoplay — retry muted once */
  const primeVideo = (el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (!el) return;
    el.play().catch(() => {
      el.muted = true;
      el.play().catch(() => { /* still blocked — user can tap play */ });
    });
  };

  /* ---------- delete my story ---------- */
  const deleteStory = async () => {
    if (!story || !isMine) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      window.setTimeout(() => setConfirmingDelete(false), 3000);
      return;
    }
    setConfirmingDelete(false);
    const deleting = story;
    const { error } = await supabase.from('stories').delete().eq('id', deleting.id);
    if (error) {
      /* surface the real reason (RLS/network) instead of a fake success */
      void alert({ title: 'Could not delete story', message: error.message, tone: 'error' });
      return;
    }
    onDeleted?.(deleting.id);
    /* navigate against the CURRENT local view of the group */
    const g = groups[groupIndex];
    if (g && g.stories.length > 1) {
      if (storyIndex >= g.stories.length - 1) prev();
      else setProgress(0); /* next story slides into the same index */
    } else {
      next(); /* group is empty → next group or close */
    }
  };

  /* ---------- reply → direct message ---------- */
  const sendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = reply.trim();
    if (!text || !story || sendingReply || !myId) return;
    setSendingReply(true);

    /* Story replies become real DMs: the message lands in the 1:1 chat with
       the story attached as reply context, and the author is notified. */
    const convId = await findOrCreateDm(myId, story.author_id);
    if (!convId) {
      setSendingReply(false);
      void alert({ title: 'Could not open chat', message: 'Please try again in a moment.', tone: 'error' });
      return;
    }

    const { data: msg, error: sendError } = await supabase
      .from('messages')
      .insert({
        conversation_id: convId,
        sender_id: myId,
        content: `↗ Story: ${text}`,
        message_type: 'text',
      })
      .select('id')
      .maybeSingle();

    if (sendError || !msg) {
      setSendingReply(false);
      void alert({ title: 'Could not send reply', message: sendError?.message || 'Please try again.', tone: 'error' });
      return;
    }

    await supabase.from('notifications').insert({
      user_id: story.author_id,
      actor_id: myId,
      type: 'story_reply',
      entity_type: 'story',
      entity_id: story.id,
      message: `replied to your story: “${text.slice(0, 80)}”`,
    });

    setReply('');
    setSendingReply(false);
    onClose();
    window.location.href = `/messages/${convId}`;
  };

  if (!group || !story) return null;

  const authorName = group.author.full_text_name || group.author.username || 'Writer';
  const reactionChips = reactions.length > 0;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/95"
      role="dialog"
      aria-modal="true"
      aria-label="Story viewer"
    >
      {/* Story card — full screen on phones, phone-shaped on desktop.
          Touch handlers live here (NOT on buttons) so taps and swipes coexist. */}
      <div
        className="relative h-full w-full touch-pan-y overflow-hidden bg-black sm:h-[85dvh] sm:w-auto sm:max-w-[430px] sm:rounded-2xl"
        style={{ aspectRatio: '9 / 16' }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Progress bars — top, BELOW the close button in z-order */}
        <div className="pointer-events-none absolute inset-x-2 top-2 z-10 flex gap-1">
          {group.stories.map((_, i) => (
            <div key={i} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/30">
              <div
                className="h-full bg-white transition-[width] duration-100"
                style={{
                  width: i < storyIndex ? '100%' : i === storyIndex ? `${progress * 100}%` : '0%',
                }}
              />
            </div>
          ))}
        </div>

        {/* CLOSE BUTTON — highest layer so it always works */}
        <button
          onClick={onClose}
          aria-label="Close stories"
          className="absolute right-3 top-3 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition hover:bg-black/80 active:scale-95"
        >
          <X className="h-6 w-6" />
        </button>

        {/* DELETE — only on my own stories, left of the close button */}
        {isMine && (
          <button
            onClick={deleteStory}
            aria-label={confirmingDelete ? 'Tap again to delete this story' : 'Delete this story'}
            title={confirmingDelete ? 'Tap again to delete' : 'Delete story'}
            className={`absolute right-16 top-3 z-40 flex h-11 w-11 items-center justify-center rounded-full backdrop-blur transition active:scale-95 ${
              confirmingDelete
                ? 'bg-red-600 text-white'
                : 'bg-black/60 text-white hover:bg-red-600/80'
            }`}
          >
            <Trash2 className="h-5 w-5" />
          </button>
        )}
        {confirmingDelete && (
          <p className="pointer-events-none absolute right-16 top-16 z-40 whitespace-nowrap rounded-lg bg-red-600 px-2.5 py-1 text-[11px] font-bold text-white">
            Tap again to delete
          </p>
        )}

        {/* Author header — under the close button, above media */}
        <div className="pointer-events-none absolute inset-x-0 top-4 z-20 flex items-center gap-2.5 px-3 pr-28 pt-2">
          <Avatar src={group.author.avatar_url} name={authorName} size={34} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{authorName}</p>
            <p className="text-[10px] text-white/60">
              {new Date(story.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        </div>

        {/* Media */}
        {story.media_type === 'video' ? (
          <video
            key={story.id}
            ref={primeVideo}
            src={story.media_url}
            autoPlay
            playsInline
            onEnded={next}
            onError={() => setMediaFailed(true)}
            className="h-full w-full object-contain"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={story.id}
            src={story.media_url}
            alt=""
            onError={() => setMediaFailed(true)}
            className="h-full w-full object-contain"
          />
        )}

        {/* Broken/expired media — never a silent black screen */}
        {mediaFailed && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/70 px-8 text-center">
            <p className="text-sm text-white/80">
              This media is no longer available.
              <span className="mt-1 block text-xs text-white/50">Swipe or tap the arrows to continue.</span>
            </p>
          </div>
        )}

        {/* Tap zones — left third = previous (mobile); the right two-thirds
            advances on tap for one-handed browsing. Disabled while a swipe is
            in progress so a swipe never double-fires as a tap. Narrowed on the
            right so the quick-heart never fights the next-story tap. */}
        <button
          aria-label="Previous story"
          className="absolute bottom-20 left-0 top-20 z-10 w-1/3"
          onClick={prev}
        />
        <button
          aria-label="Next story"
          className="absolute bottom-20 right-0 top-20 z-10 w-2/3"
          onClick={next}
        />

        {/* Caption */}
        {story.caption && (
          <p className="pointer-events-none absolute inset-x-0 bottom-16 z-10 px-4 text-center text-sm text-white drop-shadow">
            {story.caption}
          </p>
        )}

        {/* Reaction chips — what the story already received */}
        {reactionChips && (
          <div className="pointer-events-none absolute bottom-24 left-3 z-20 flex max-w-[70%] flex-wrap gap-1">
            {reactions.map((r) => (
              <span
                key={r.emoji}
                className={`rounded-full px-2 py-0.5 text-xs backdrop-blur ${r.mine ? 'bg-[#E5798F]/90 text-white' : 'bg-black/50 text-white'}`}
              >
                {r.emoji} {r.count}
              </span>
            ))}
          </div>
        )}

        {/* Quick react heart + reaction bar toggle — above the reply bar */}
        <div className="absolute bottom-[4.25rem] left-3 z-30 flex flex-col gap-1.5">
          <button
            onClick={() => {
              if (showReactionBar) setShowReactionBar(false);
              else toggleReaction('❤️');
            }}
            aria-label="React with heart"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-xl backdrop-blur transition hover:scale-110 active:scale-95"
          >
            ❤️
          </button>
          <button
            onClick={() => setShowReactionBar((v) => !v)}
            aria-label="More reactions"
            aria-expanded={showReactionBar}
            className="flex h-9 w-11 items-center justify-center rounded-full bg-black/50 text-sm text-white backdrop-blur transition hover:bg-black/70 active:scale-95"
          >
            {showReactionBar ? '×' : '☺+'}
          </button>
        </div>

        {/* Expanded reaction bar */}
        {showReactionBar && (
          <div className="absolute inset-x-3 bottom-[7.5rem] z-30 flex flex-wrap justify-center gap-1 rounded-2xl bg-black/70 p-2 backdrop-blur">
            {STORY_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => {
                  toggleReaction(emoji);
                  setShowReactionBar(false);
                }}
                className="flex h-10 w-10 items-center justify-center rounded-full text-xl transition hover:scale-125"
                aria-label={`React ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        {/* Desktop side arrows */}
        <button
          onClick={prev}
          aria-label="Previous story"
          className="absolute left-4 top-1/2 z-40 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20 md:flex"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <button
          onClick={next}
          aria-label="Next story"
          className="absolute right-4 top-1/2 z-40 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20 md:flex"
        >
          <ChevronRight className="h-6 w-6" />
        </button>

        {/* Reply bar — now opens a real DM with the story author */}
        <form
          onSubmit={sendReply}
          className="absolute inset-x-0 bottom-0 z-30 flex items-center gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          <input
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder={`Reply to ${authorName}…`}
            maxLength={200}
            className="min-w-0 flex-1 rounded-full border border-white/25 bg-white/10 px-4 py-2.5 text-sm text-white placeholder-white/50 backdrop-blur focus:border-white/50 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!reply.trim() || sendingReply}
            aria-label="Send reply as message"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-black transition disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
