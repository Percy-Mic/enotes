'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Heart, MessageCircle, Radio, Send, Users, Volume2, VolumeX } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Post } from '@/types/social';
import Avatar from '@/components/social/Avatar';
import SharePostPicker from '@/components/community/SharePostPicker';
import LiveBroadcast from '@/components/social/LiveBroadcast';
import LiveViewer from '@/components/social/LiveViewer';
import { endLiveStream, fetchLiveStreams, fetchMyLiveStream } from '@/lib/social/live';
import type { LiveStream } from '@/types/social';

export default function VideosPage() {
  const router = useRouter();
  const [videos, setVideos] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [meId, setMeId] = useState<string | null>(null);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [sharingPost, setSharingPost] = useState<Post | null>(null);

  /* Live — rail of active broadcasts + host/viewer overlays */
  const [liveStreams, setLiveStreams] = useState<LiveStream[]>([]);
  const [showGoLive, setShowGoLive] = useState(false);
  const [watchingStream, setWatchingStream] = useState<LiveStream | null>(null);
  const [myLiveStream, setMyLiveStream] = useState<LiveStream | null>(null);

  const refreshLiveStreams = useCallback(async () => {
    setLiveStreams(await fetchLiveStreams());
    if (meId) setMyLiveStream(await fetchMyLiveStream(meId));
  }, [meId]);

  /* Live rail: initial load + realtime refresh while the page is open */
  useEffect(() => {
    void refreshLiveStreams();
    const channel = supabase
      .channel('live-streams-rail')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_streams' }, () => {
        void refreshLiveStreams();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [refreshLiveStreams]);

  /* Only the active video plays; others show their first frame */
  const [activeIndex, setActiveIndex] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const intersectionRatiosRef = useRef(new Map<number, number>());

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
      setMeId(user.id);

      const { data } = await supabase
        .from('posts')
        .select(
          `id, author_id, journal_id, page_id, content, media_url, media_type, created_at,
           author:profiles!posts_author_id_fkey(id, full_text_name, username, avatar_url)`,
        )
        .eq('media_type', 'video')
        .not('media_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(30);

      const rows = (data || []) as unknown as Post[];
      setVideos(rows);

      /* Which did I like? */
      if (rows.length) {
        const { data: likes } = await supabase
          .from('post_likes')
          .select('post_id')
          .eq('user_id', user.id)
          .in('post_id', rows.map((r) => r.id));
        setLikedIds(new Set((likes || []).map((l: any) => l.post_id)));
      }

      setLoading(false);
    })();
  }, [router]);

  /* Scroll-driven autoplay:
     - the most visible video becomes active
     - the active video starts automatically
     - videos leaving the viewport are paused and reset
     - adjacent videos are preloaded for fast swipes */
  useEffect(() => {
    const container = containerRef.current;
    if (!container || videos.length === 0) return;

    const ratios = intersectionRatiosRef.current;
    ratios.clear();

    const getMostVisibleIndex = () => {
      const containerRect = container.getBoundingClientRect();
      let bestIndex = activeIndex;
      let bestRatio = 0;

      container.querySelectorAll<HTMLElement>('[data-index]').forEach((section) => {
        const rect = section.getBoundingClientRect();
        const visibleTop = Math.max(rect.top, containerRect.top);
        const visibleBottom = Math.min(rect.bottom, containerRect.bottom);
        const visibleHeight = Math.max(0, visibleBottom - visibleTop);
        const ratio = rect.height > 0 ? visibleHeight / rect.height : 0;
        const index = Number(section.dataset.index);

        if (!Number.isNaN(index)) {
          ratios.set(index, ratio);
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestIndex = index;
          }
        }
      });

      return { bestIndex, bestRatio };
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.index);
          if (!Number.isNaN(index)) {
            ratios.set(index, entry.isIntersecting ? entry.intersectionRatio : 0);
          }
        }

        const { bestIndex, bestRatio } = getMostVisibleIndex();
        if (bestRatio >= 0.5 && bestIndex !== activeIndex) {
          setActiveIndex(bestIndex);
        }
      },
      {
        root: container,
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1],
      },
    );

    container.querySelectorAll<HTMLElement>('[data-index]').forEach((el) => observer.observe(el));

    requestAnimationFrame(() => {
      const { bestIndex } = getMostVisibleIndex();
      if (bestIndex !== activeIndex) setActiveIndex(bestIndex);
    });

    return () => observer.disconnect();
  }, [videos, activeIndex]);

  /* Exactly one video is allowed to play. Autoplay starts muted because
     browsers commonly block audible autoplay; the user can enable sound
     with the speaker button. Videos leaving the active slot are paused and
     reset to the beginning. */
  useEffect(() => {
    const syncPlayback = () => {
      videoRefs.current.forEach((video, i) => {
        if (!video) return;

        const shouldPlay = i === activeIndex && document.visibilityState === 'visible';
        if (shouldPlay) {
          video.muted = !soundEnabled;
          void video.play().catch(() => {
            /* If the browser blocks audible autoplay, fall back to muted
               playback rather than leaving the feed frozen. */
            video.muted = true;
            void video.play().catch(() => undefined);
          });
        } else {
          video.pause();
          if (i !== activeIndex) {
            video.currentTime = 0;
            video.muted = true;
          }
        }
      });
    };

    syncPlayback();

    const onVisibility = () => syncPlayback();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [activeIndex, soundEnabled]);

  const toggleSound = useCallback(() => {
    const video = videoRefs.current[activeIndex];
    if (!video) return;

    const nextMuted = !video.muted;
    video.muted = nextMuted;
    setSoundEnabled(!nextMuted);

    if (!nextMuted) {
      void video.play().catch(() => {
        video.muted = true;
        setSoundEnabled(false);
      });
    }
  }, [activeIndex]);

  const toggleLike = useCallback(
    async (postId: string) => {
      if (!meId) return;
      const isLiked = likedIds.has(postId);

      setLikedIds((prev) => {
        const next = new Set(prev);
        if (isLiked) {
          next.delete(postId);
        } else {
          next.add(postId);
        }
        return next;
      });

      if (isLiked) {
        await supabase.from('post_likes').delete().eq('post_id', postId).eq('user_id', meId);
      } else {
        /* ignoreDuplicates: a double-tap raced the first insert and hit the
           (post_id, user_id) PK → 400. Upsert-with-ignore is idempotent. */
        const { error } = await supabase
          .from('post_likes')
          .upsert(
            { post_id: postId, user_id: meId },
            { onConflict: 'post_id,user_id', ignoreDuplicates: true }
          );
        if (error) {
          setLikedIds((prev) => {
            const next = new Set(prev);
            next.delete(postId);
            return next;
          });
        }
      }
    },
    [meId, likedIds],
  );

  const scrollBy = (direction: 1 | -1) => {
    const container = containerRef.current;
    if (!container) return;
    const target = activeIndex + direction;
    const clamped = Math.max(0, Math.min(videos.length - 1, target));
    const item = container.querySelector(`[data-index="${clamped}"]`);
    item?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <main className="min-h-[100dvh] bg-black text-white">
      {/* Header — wraps instead of clipping: on ≤360px the two buttons drop
          to a second row while the title stays visible (they kept their names
          because they are the page's only affordances). */}
      <header className="fixed inset-x-0 top-0 z-40 flex flex-wrap items-center justify-between gap-2 bg-gradient-to-b from-black/80 to-transparent px-4 py-3">
        <h1 className="text-lg font-bold">Videos</h1>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => {
              /* A lingering "live" row (crashed tab, missed beacon) must not
                 brick the button — clicking ends the stale stream and frees
                 the host to broadcast again. */
              if (myLiveStream) {
                void endLiveStream(myLiveStream.id).then(() => refreshLiveStreams());
              } else {
                setShowGoLive(true);
              }
            }}
            title={myLiveStream ? 'End your current broadcast' : 'Start a live broadcast'}
            className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-4 py-1.5 text-xs font-semibold backdrop-blur transition hover:bg-red-500"
          >
            <Radio className="h-3.5 w-3.5" />
            {myLiveStream ? 'You are live · tap to end' : 'Go live'}
          </button>
          <Link
            href="/studio/video"
            className="rounded-full bg-[#E5798F] px-4 py-1.5 text-xs font-semibold backdrop-blur transition hover:opacity-90"
          >
            + Create video
          </Link>
          <Link
            href="/feed"
            className="rounded-full bg-white/15 px-4 py-1.5 text-xs font-semibold backdrop-blur transition hover:bg-white/25"
          >
            Back to feed
          </Link>
        </div>
      </header>

      {/* Desktop arrows */}
      <button
        onClick={() => scrollBy(-1)}
        aria-label="Previous video"
        className="fixed left-5 top-1/2 z-40 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 backdrop-blur transition hover:bg-white/20 lg:flex"
      >
        <ChevronLeft className="h-6 w-6" />
      </button>
      <button
        onClick={() => scrollBy(1)}
        aria-label="Next video"
        className="fixed right-5 top-1/2 z-40 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 backdrop-blur transition hover:bg-white/20 lg:flex"
      >
        <ChevronRight className="h-6 w-6" />
      </button>

      {/* Live now rail — hidden while a broadcast overlay is open */}
      {!showGoLive && !watchingStream && liveStreams.length > 0 && (
        <div className="fixed inset-x-0 top-14 z-30 overflow-x-auto px-4 no-scrollbar">
          <div className="flex gap-3 pb-2">
            {liveStreams.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  /* Watching your own broadcast from this tab would loop
                     your camera back into the viewer — show it as yours
                     instead of opening a dead-end viewer. */
                  if (meId && s.host_id === meId) {
                    setShowGoLive(true);
                  } else {
                    setWatchingStream(s);
                  }
                }}
                className="flex shrink-0 items-center gap-2 rounded-full bg-white/10 py-1.5 pl-1.5 pr-3 backdrop-blur transition hover:bg-white/20"
              >
                <Avatar src={s.host?.avatar_url} name={s.host?.username || 'Host'} size={28} />
                <span className="max-w-32 truncate text-xs font-semibold">
                  {meId && s.host_id === meId ? 'Your stream' : s.title}
                </span>
                <span className="flex items-center gap-1 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase">
                  <Radio className="h-2.5 w-2.5" /> Live
                </span>
                <span className="text-[11px] text-white/60">{s.viewer_count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex h-[100dvh] items-center justify-center">
          <p className="text-sm text-white/60">Loading videos…</p>
        </div>
      ) : videos.length === 0 ? (
        <div className="flex h-[100dvh] flex-col items-center justify-center px-8 text-center">
          <div className="text-5xl">🎬</div>
          <h2 className="mt-4 text-xl font-bold">No videos yet</h2>
          <p className="mt-2 max-w-xs text-sm text-white/60">
            Be the first — share a video from the feed composer and it will play right here.
          </p>
          <Link
            href="/feed?compose=1"
            className="mt-6 rounded-xl bg-white px-6 py-3 text-sm font-bold text-black"
          >
            Share a video
          </Link>
        </div>
      ) : (
        <div
          ref={containerRef}
          className="h-[100dvh] snap-y snap-mandatory overflow-y-scroll no-scrollbar"
        >
          {videos.map((post, i) => {
            const liked = likedIds.has(post.id);
            const authorName = post.author?.full_text_name || post.author?.username || 'Writer';
            const isActive = i === activeIndex;
            return (
              <section
                key={post.id}
                data-index={i}
                className="relative flex h-[100dvh] snap-start items-center justify-center"
              >
                <video
                  ref={(el) => {
                    videoRefs.current[i] = el;
                  }}
                  src={post.media_url || ''}
                  loop
                  muted={!isActive || !soundEnabled}
                  playsInline
                  autoPlay
                  preload={isActive || Math.abs(i - activeIndex) <= 1 ? 'auto' : 'metadata'}
                  onLoadedData={(e) => {
                    if (i === activeIndex && document.visibilityState === 'visible') {
                      void e.currentTarget.play().catch(() => undefined);
                    }
                  }}
                  onCanPlay={(e) => {
                    if (i === activeIndex && document.visibilityState === 'visible') {
                      void e.currentTarget.play().catch(() => undefined);
                    }
                  }}
                  onClick={(e) => {
                    const v = e.currentTarget;
                    if (v.paused) void v.play().catch(() => undefined);
                    else v.pause();
                  }}
                  className="h-full w-full object-contain sm:w-auto sm:max-w-[min(100dvh*0.5625,100vw)]"
                />

                {/* Gradient overlays */}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/80 to-transparent" />
                <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/60 to-transparent" />

                {/* Right rail */}
                <div className="absolute bottom-24 right-3 flex flex-col items-center gap-5">
                  <button
                    onClick={toggleSound}
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 backdrop-blur transition hover:bg-white/25"
                    aria-label={soundEnabled ? 'Mute video' : 'Unmute video'}
                    title={soundEnabled ? 'Mute video' : 'Unmute video'}
                  >
                    {soundEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
                  </button>
                  <button
                    onClick={() => toggleLike(post.id)}
                    className="flex flex-col items-center gap-1"
                    aria-label={liked ? 'Unlike' : 'Like'}
                  >
                    <span
                      className={`flex h-12 w-12 items-center justify-center rounded-full backdrop-blur transition ${
                        liked ? 'bg-[#E5798F] text-white' : 'bg-white/15 text-white hover:bg-white/25'
                      }`}
                    >
                      <Heart className={`h-6 w-6 ${liked ? 'fill-current' : ''}`} />
                    </span>
                  </button>

                  <Link
                    href={post.author?.username ? `/u/${post.author.username}` : '#'}
                    className="flex flex-col items-center gap-1"
                  >
                    <Avatar src={post.author?.avatar_url} name={authorName} size={44} />
                  </Link>

                  <button
                    onClick={() => {
                      const url = `${window.location.origin}/posts/${post.id}`;
                      if (navigator.share) {
                        navigator.share({ title: 'A video on enotes', text: post.content.slice(0, 100), url }).catch(() => undefined);
                      } else {
                        navigator.clipboard.writeText(url).catch(() => undefined);
                      }
                    }}
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 backdrop-blur transition hover:bg-white/25"
                    aria-label="Share this video"
                  >
                    <Send className="h-5 w-5" />
                  </button>

                  <button
                    onClick={() => setSharingPost(post)}
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 backdrop-blur transition hover:bg-white/25"
                    aria-label="Share to a community"
                  >
                    <Users className="h-5 w-5" />
                  </button>

                  <Link
                    href={`/posts/${post.id}`}
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 backdrop-blur transition hover:bg-white/25"
                    aria-label="Comments"
                  >
                    <MessageCircle className="h-5 w-5" />
                  </Link>
                </div>

                {/* Caption */}
                <div className="absolute bottom-6 left-4 right-20">
                  <Link
                    href={post.author?.username ? `/u/${post.author.username}` : '#'}
                    className="text-sm font-bold"
                  >
                    @{post.author?.username || authorName}
                  </Link>
                  {post.content && (
                    <p className="mt-1 line-clamp-2 text-sm text-white/85">{post.content}</p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {sharingPost && (
        <SharePostPicker
          postId={sharingPost.id}
          postLabel={sharingPost.content ? `"${sharingPost.content.slice(0, 30)}…"` : 'this video'}
          onClose={() => setSharingPost(null)}
        />
      )}

      {showGoLive && meId && (
        <LiveBroadcast
          meId={meId}
          onClose={() => {
            setShowGoLive(false);
            void refreshLiveStreams();
          }}
        />
      )}

      {watchingStream && meId && (
        <LiveViewer
          stream={watchingStream}
          meId={meId}
          onClose={() => {
            setWatchingStream(null);
            void refreshLiveStreams();
          }}
        />
      )}

    </main>
  );
}
