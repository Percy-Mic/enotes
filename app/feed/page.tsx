'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileText, Globe, ImagePlus, Loader2, Send, Smile, Sparkles, StickyNote, UserRound, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Post } from '@/types/social';
import Avatar from '@/components/social/Avatar';
import PostCard from '@/components/social/PostCard';
import StoryViewer, { StoryGroup } from '@/components/social/StoryViewer';
import EmojiPicker from '@/components/pickers/EmojiPicker';
import GifPicker, { type GifItem } from '@/components/pickers/GifPicker';
import { uploadFileWithProgress } from '@/lib/storage/upload';
import { enrichPosts } from '@/lib/social/enrich';
import { useUserSettings } from '@/lib/hooks';

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

interface StoryRow {
  id: string;
  author_id: string;
  media_url: string;
  media_type: 'image' | 'video';
  caption?: string | null;
  created_at: string;
  expires_at: string;
  author?: { id: string; full_text_name?: string; username?: string; avatar_url?: string };
}

export default function FeedPage() {
  const router = useRouter();
  const [me, setMe] = useState<{ id: string; username?: string; full_text_name?: string; avatar_url?: string } | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [visibility, setVisibility] = useState<'public' | 'followers'>('public');
  const [gifItem, setGifItem] = useState<GifItem | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showGif, setShowGif] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkPreview, setLinkPreview] = useState('');

  /* default visibility from user settings */
  const { settings: mySettings } = useUserSettings(me?.id || null);
  useEffect(() => {
    if (mySettings?.default_post_visibility) setVisibility(mySettings.default_post_visibility);
  }, [mySettings?.default_post_visibility]);

  /* Media attachment */
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string>('');
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);

  /* Stories */
  const [storyGroups, setStoryGroups] = useState<StoryGroup[]>([]);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [startGroup, setStartGroup] = useState(0);

  /* Posts I hid from MY feed (post stays live for everyone else) */
  const [hiddenPostIds, setHiddenPostIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('enotes:hidden-posts');
      if (raw) setHiddenPostIds(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* ignore corrupt storage */
    }
  }, []);

  const hidePost = (postId: string) => {
    setHiddenPostIds((prev) => {
      const next = new Set(prev).add(postId);
      try {
        window.localStorage.setItem('enotes:hidden-posts', JSON.stringify(Array.from(next)));
      } catch {
        /* ignore quota errors */
      }
      return next;
    });
  };

  const undoHide = (postId: string) => {
    setHiddenPostIds((prev) => {
      const next = new Set(prev);
      next.delete(postId);
      try {
        window.localStorage.setItem('enotes:hidden-posts', JSON.stringify(Array.from(next)));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  /* My journals for "share a page" composer */
  const [journals, setJournals] = useState<{ id: string; title: string }[]>([]);
  const [journalId, setJournalId] = useState('');
  const [pages, setPages] = useState<{ id: string; page_number: number; title: string | null }[]>([]);
  const [pageId, setPageId] = useState('');

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

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, username, full_text_name, avatar_url')
        .eq('id', user.id)
        .maybeSingle();
      setMe((profile as any) || { id: user.id });

      const { data: journalData, error: journalError } = await supabase
        .from('journals')
        .select('id, title')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: false });

      if (journalError) {
        setError(journalError.message);
      }
      setJournals((journalData || []) as { id: string; title: string }[]);

      /* Deep link: /feed?compose=1 opens the composer (nav create buttons) */
      if (new URLSearchParams(window.location.search).get('compose')) {
        setComposerOpen(true);
      }

      loadPosts();
      loadStories();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const loadPosts = useCallback(async () => {
    setLoading(true);

    const { data, error: postsError } = await supabase
      .from('posts')
      .select(
        `id, author_id, journal_id, page_id, content, media_url, media_type, media_size, visibility, created_at,
         author:profiles!posts_author_id_fkey(id, full_text_name, username, avatar_url)`,
      )
      .order('created_at', { ascending: false })
      .limit(50);

    if (postsError) {
      setError(postsError.message);
      setPosts([]);
      setLoading(false);
      return;
    }

    let list = (data || []) as unknown as Post[];

    /* enrich: journal titles + like/comment counts + liked_by_me */
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const myId = user?.id;

    const journalIds = Array.from(new Set(list.map((p) => p.journal_id).filter(Boolean))) as string[];
    let journalMap = new Map<string, { title: string; background_color: string }>();
    if (journalIds.length) {
      const { data: jd } = await supabase
        .from('journals')
        .select('id, title, background_color')
        .in('id', journalIds);
      journalMap = new Map((jd || []).map((j: any) => [j.id, j]));
    }

    /* journal titles, like/comment counts, reactions, saves, repost state —
       one shared enrichment owner (lib/social/enrich.ts) */
    list = await enrichPosts(list, myId);
    setPosts(list);
    setLoading(false);
  }, []);

  const loadStories = useCallback(async () => {
    const { data } = await supabase
      .from('stories')
      .select(
        `id, author_id, media_url, media_type, caption, created_at, expires_at,
         author:profiles!stories_author_id_fkey(id, full_text_name, username, avatar_url)`,
      )
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(200);

    const rows = (data || []) as unknown as StoryRow[];

    /* Which ones have I already seen? */
    const {
      data: { user },
    } = await supabase.auth.getUser();
    let viewed = new Set<string>();
    if (user && rows.length) {
      const { data: views } = await supabase
        .from('story_views')
        .select('story_id')
        .eq('viewer_id', user.id)
        .in('story_id', rows.map((r) => r.id));
      viewed = new Set((views || []).map((v: any) => v.story_id));
    }

    /* Group by author, my story first */
    const byAuthor = new Map<string, StoryGroup>();
    for (const row of rows) {
      const author = row.author || { id: row.author_id };
      let group = byAuthor.get(row.author_id);
      if (!group) {
        group = { author, stories: [] };
        byAuthor.set(row.author_id, group);
      }
      group.stories.push({ ...row, viewed_by_me: viewed.has(row.id) });
    }

    const groups = Array.from(byAuthor.values());
    groups.sort((a, b) => {
      const aMine = a.author.id === me?.id ? 0 : 1;
      const bMine = b.author.id === me?.id ? 0 : 1;
      if (aMine !== bMine) return aMine - bMine;
      const aAll = a.stories.every((s) => s.viewed_by_me) ? 1 : 0;
      const bAll = b.stories.every((s) => s.viewed_by_me) ? 1 : 0;
      return aAll - bAll;
    });
    setStoryGroups(groups);
  }, [me?.id]);

  /* Composer: journal selection cascades to pages */
  useEffect(() => {
    if (!journalId) {
      setPages([]);
      setPageId('');
      return;
    }
    (async () => {
      const { data } = await supabase
        .from('journal_pages')
        .select('id, page_number, title')
        .eq('journal_id', journalId)
        .order('page_number', { ascending: true });
      setPages((data || []) as { id: string; page_number: number; title: string | null }[]);
      setPageId('');
    })();
  }, [journalId]);

  const pickMedia = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const bareType = f.type.split(';')[0].toLowerCase();
    if (!bareType.startsWith('image/') && !bareType.startsWith('video/')) {
      setError('Attachments must be an image or a video.');
      return;
    }
    if (f.size > MAX_BYTES) {
      setError('Attachment is too large — keep it under 25 MB.');
      return;
    }
    setMediaFile(f);
    setMediaPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(f);
    });
  };

  const clearMedia = () => {
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    setMediaFile(null);
    setMediaPreview('');
  };

  useEffect(() => {
    return () => {
      if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitPost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!me || (!draft.trim() && !pageId && !mediaFile && !gifItem && !linkUrl.trim()) || posting) return;

    setPosting(true);
    setError(null);

    try {
      let mediaUrl: string | null = null;
      let mediaType: string | null = null;
      let postType = 'text';

      if (mediaFile) {
        setUploadPct(3);
        const up = await uploadFileWithProgress(mediaFile, 'post-media', me.id, setUploadPct);
        mediaUrl = up.url;
        const bareType = mediaFile.type.split(';')[0].toLowerCase();
        mediaType = bareType.startsWith('video/') ? 'video' : 'image';
        postType = bareType.startsWith('video/') ? 'video' : 'photo';
      } else if (gifItem) {
        mediaUrl = gifItem.url;
        mediaType = 'gif';
        postType = 'gif';
      }

      if (linkUrl.trim()) postType = 'link';

      /* mentions + hashtags extracted from the text */
      const mentionHandles = Array.from(new Set((draft.match(/@([a-zA-Z0-9_]{3,24})/g) || []).map((h) => h.slice(1))));
      let mentions: { id: string; username: string }[] = [];
      if (mentionHandles.length) {
        const { data: found } = await supabase.from('profiles').select('id, username').in('username', mentionHandles);
        mentions = (found || []) as { id: string; username: string }[];
      }
      const hashtags = Array.from(new Set((draft.match(/#[a-zA-Z0-9_]+/g) || []).map((t) => t.slice(1).toLowerCase())));

      const { error: postError } = await supabase.from('posts').insert({
        author_id: me.id,
        journal_id: journalId || null,
        page_id: pageId || null,
        content: draft.trim(),
        media_url: mediaUrl,
        media_type: mediaType,
        media_size: mediaFile ? mediaFile.size : null,
        post_type: postType,
        link_url: linkUrl.trim() || null,
        mentions,
        hashtags,
        visibility,
      });

      if (postError) throw postError;

      /* notify mentioned users */
      if (mentions.length) {
        await supabase.from('notifications').insert(
          mentions
            .filter((m) => m.id !== me.id)
            .map((m) => ({
              user_id: m.id,
              actor_id: me.id,
              type: 'mention',
              entity_type: 'post',
              message: 'mentioned you in a post',
            }))
        );
      }

      setUploadPct(100);
      setDraft('');
      setJournalId('');
      setPageId('');
      setGifItem(null);
      setLinkUrl('');
      setShowEmoji(false);
      setShowGif(false);
      clearMedia();
      setComposerOpen(false);
      setUploadPct(null);
      loadPosts();
    } catch (err: any) {
      setError(err?.message || 'Could not share the post — please try again.');
      setUploadPct(null);
    } finally {
      setPosting(false);
    }
  };

  const removePost = (postId: string) => {
    setPosts((list) => list.filter((p) => p.id !== postId));
  };

  const openStories = (index: number) => {
    setStartGroup(index);
    setViewerOpen(true);
  };

  const hasStory = me && storyGroups.some((g) => g.author.id === me.id);

  return (
    <main className="min-h-[100dvh] bg-[#FFF7F8] px-3 pb-24 pt-5 text-[#111111] sm:px-6 md:pb-10">
      <div className="mx-auto flex w-full max-w-6xl items-start justify-center gap-8">
        <div className="w-full max-w-2xl min-w-0">
        {/* Header */}
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Feed</h1>
            <p className="text-sm text-[#6B6B6B]">What your fellow journalers are sharing.</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/videos"
              className="rounded-xl border border-[#E8E2E4] bg-white px-3.5 py-2 text-sm font-medium shadow-sm transition hover:bg-gray-50"
            >
              ▶ Videos
            </Link>
            <Link
              href="/search"
              className="rounded-xl border border-[#E8E2E4] bg-white px-3.5 py-2 text-sm font-medium shadow-sm transition hover:bg-gray-50"
            >
              Find people
            </Link>
          </div>
        </header>

        {/* Stories bar */}
        <div className="no-scrollbar mb-5 flex gap-3 overflow-x-auto pb-1">
          {/* Your story */}
          <button
            onClick={() => router.push('/stories/new')}
            className="flex w-16 shrink-0 flex-col items-center gap-1"
          >
            <span className="relative flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-[#E8E2E4] bg-white text-[#9B9B9B] transition hover:border-[#E5798F] hover:text-[#E5798F]">
              {hasStory && me?.avatar_url ? (
                <Avatar src={me.avatar_url} name={me.full_text_name} size={56} />
              ) : (
                <ImagePlus className="h-6 w-6" />
              )}
              <span className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-black text-[#FFB6C1]">
                <ImagePlus className="h-3 w-3" />
              </span>
            </span>
            <span className="w-full truncate text-center text-[10px] font-semibold text-[#6B6B6B]">
              Your story
            </span>
          </button>

          {/* Other stories */}
          {storyGroups.map((group, i) => {
            const allViewed = group.stories.every((s) => s.viewed_by_me);
            const name = group.author.full_text_name || group.author.username || 'Writer';
            return (
              <button
                key={group.author.id}
                onClick={() => openStories(i)}
                className="flex w-16 shrink-0 flex-col items-center gap-1"
              >
                <span
                  className={`rounded-full p-[2.5px] ${
                    allViewed ? 'bg-[#E8E2E4]' : 'bg-gradient-to-tr from-[#E5798F] to-[#FFB6C1]'
                  }`}
                >
                  <span className="rounded-full border-2 border-white">
                    <Avatar src={group.author.avatar_url} name={name} size={56} />
                  </span>
                </span>
                <span className="w-full truncate text-center text-[10px] font-semibold text-[#6B6B6B]">
                  {name}
                </span>
              </button>
            );
          })}
        </div>

        {/* Composer */}
        <div className="mb-5">
          {composerOpen ? (
            <form onSubmit={submitPost} className="space-y-3 rounded-2xl border border-[#E8E2E4] bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <Avatar src={me?.avatar_url} name={me?.full_text_name || me?.username} size={40} />
                <textarea
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Share a thought, note, or memory…"
                  className="min-h-[80px] flex-1 resize-none rounded-lg border border-[#E8E2E4] px-3 py-2.5 text-sm focus:border-[#1E90FF] focus:outline-none"
                />
              </div>

              {/* GIF preview */}
              {gifItem && (
                <div className="relative overflow-hidden rounded-xl">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={gifItem.preview} alt={gifItem.description || 'GIF'} className="max-h-48 w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setGifItem(null)}
                    aria-label="Remove GIF"
                    className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}

              {/* Media preview */}
              {mediaPreview && (
                <div className="relative overflow-hidden rounded-xl bg-black">
                  {mediaFile?.type.split(';')[0].toLowerCase().startsWith('video/') ? (
                    <video src={mediaPreview} controls playsInline className="max-h-64 w-full" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={mediaPreview} alt="Attachment preview" className="max-h-64 w-full object-contain" />
                  )}
                  <button
                    type="button"
                    onClick={clearMedia}
                    aria-label="Remove attachment"
                    className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}

              {/* Row: attach + visibility */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Hidden file input — the visible button triggers this. It must
                    stay MOUNTED for the ref to resolve (this was why “Photo /
                    video” did nothing). accept uses bare MIME prefixes. */}
                <input
                  ref={mediaInputRef}
                  type="file"
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={pickMedia}
                  aria-hidden="true"
                  tabIndex={-1}
                />
                <button
                  type="button"
                  onClick={() => mediaInputRef.current?.click()}
                  className="flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#E8E2E4] px-3 text-sm font-semibold text-[#6B6B6B] transition hover:bg-gray-50"
                >
                  <ImagePlus className="h-4 w-4" /> Photo / video
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => { setShowEmoji((v) => !v); setShowGif(false); }}
                    className="flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#E8E2E4] px-3 text-sm font-semibold text-[#6B6B6B] transition hover:bg-gray-50"
                    aria-label="Add emoji"
                    aria-expanded={showEmoji}
                  >
                    <Smile className="h-4 w-4" />
                  </button>
                  {showEmoji && (
                    <div className="fixed inset-x-2 bottom-2 z-50 flex justify-center sm:absolute sm:inset-x-auto sm:bottom-11 sm:left-0 sm:block">
                      <EmojiPicker onPick={(emoji) => { setDraft((d) => d + emoji); }} />
                    </div>
                  )}
                </div>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => { setShowGif((v) => !v); setShowEmoji(false); }}
                    className="flex min-h-[40px] items-center rounded-xl border border-[#E8E2E4] px-3 text-xs font-bold text-[#6B6B6B] transition hover:bg-gray-50"
                    aria-label="Add GIF"
                    aria-expanded={showGif}
                  >
                    GIF
                  </button>
                  {showGif && (
                    <div className="fixed inset-x-2 bottom-2 z-50 flex justify-center sm:absolute sm:inset-x-auto sm:bottom-11 sm:left-0 sm:block">
                      <GifPicker onPick={(gif) => { setGifItem(gif); setShowGif(false); }} />
                    </div>
                  )}
                </div>
                <div className="flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#E8E2E4] px-3 text-sm">
                  <FileText className="h-4 w-4 text-[#6B6B6B]" />
                  <input
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="Attach a link…"
                    inputMode="url"
                    className="w-32 bg-transparent text-sm focus:outline-none"
                    aria-label="Link URL"
                  />
                </div>
                <div className="flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#E8E2E4] px-3 text-sm">
                  {visibility === 'public' ? (
                    <Globe className="h-4 w-4 text-[#6B6B6B]" />
                  ) : (
                    <UserRound className="h-4 w-4 text-[#6B6B6B]" />
                  )}
                  <select
                    value={visibility}
                    onChange={(e) => setVisibility(e.target.value as 'public' | 'followers')}
                    className="bg-transparent text-sm focus:outline-none"
                    aria-label="Post visibility"
                  >
                    <option value="public">Public</option>
                    <option value="followers">Followers only</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <select
                  value={journalId}
                  onChange={(e) => setJournalId(e.target.value)}
                  className="w-full rounded-lg border border-[#E8E2E4] bg-white px-3 py-2.5 text-sm"
                >
                  <option value="">Attach a journal (optional)</option>
                  {journals.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.title}
                    </option>
                  ))}
                </select>

                <select
                  value={pageId}
                  onChange={(e) => setPageId(e.target.value)}
                  disabled={!journalId}
                  className="w-full rounded-lg border border-[#E8E2E4] bg-white px-3 py-2.5 text-sm disabled:opacity-50"
                >
                  <option value="">Attach a page (optional)</option>
                  {pages.map((p) => (
                    <option key={p.id} value={p.id}>
                      Page {p.page_number}
                      {p.title ? ` · ${p.title}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setComposerOpen(false);
                    clearMedia();
                    setError(null);
                  }}
                  className="min-h-[44px] flex-1 rounded-xl border border-[#E8E2E4] px-4 py-2.5 text-sm font-semibold transition hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={posting || (!draft.trim() && !pageId && !mediaFile && !gifItem && !linkUrl.trim())}
                  className="min-h-[44px] flex-1 rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-[#FFB6C1] shadow transition hover:opacity-90 disabled:opacity-40"
                >
                  {posting ? (
                    <>
                      <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />
                      {uploadPct != null ? `Uploading ${uploadPct}%` : 'Sharing…'}
                    </>
                  ) : (
                    <>
                      <Send className="mr-1.5 inline h-4 w-4" /> Share
                    </>
                  )}
                </button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => setComposerOpen(true)}
              className="flex w-full items-center gap-3 rounded-2xl border border-[#E8E2E4] bg-white p-4 text-left shadow-sm transition hover:shadow"
            >
              <Avatar src={me?.avatar_url} name={me?.full_text_name || me?.username} size={40} />
              <span className="flex-1 text-sm text-[#9B9B9B]">Share a thought, note, photo or video…</span>
              <Sparkles className="h-5 w-5 text-[#E5798F]" />
            </button>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">
            {error} — make sure you ran both social migration SQL files in Supabase.
          </div>
        )}

        {/* Posts */}
        {loading ? (
          <div className="space-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-40 animate-pulse rounded-2xl border border-[#E8E2E4] bg-white/70" />
            ))}
          </div>
        ) : posts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#E8E2E4] bg-white/60 px-6 py-14 text-center">
            <div className="text-4xl">🌱</div>
            <h2 className="mt-3 text-lg font-semibold">The feed is just beginning</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-[#6B6B6B]">
              Share your first thought above, find people to follow, or share a journal page from the book view.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {posts.map((post) =>
              hiddenPostIds.has(post.id) ? null : (
                <PostCard key={post.id} post={post} onDeleted={removePost} onHide={hidePost} />
              ),
            )}
            {posts.some((p) => hiddenPostIds.has(p.id)) && (
              <button
                onClick={() => Array.from(hiddenPostIds).forEach(undoHide)}
                className="w-full rounded-xl border border-dashed border-[#E8E2E4] py-3 text-xs font-semibold text-[#9B9B9B] transition hover:bg-white"
              >
                {hiddenPostIds.size} hidden post{hiddenPostIds.size === 1 ? '' : 's'} — show again
              </button>
            )}
          </div>
        )}
      </div>

      {/* Story viewer — onDeleted drops the story from feed state instantly */}
      {viewerOpen && storyGroups.length > 0 && (
        <StoryViewer
          groups={storyGroups}
          startGroup={startGroup}
          onClose={() => setViewerOpen(false)}
          onDeleted={(storyId) => {
            setStoryGroups((prev) => {
              const next = prev
                .map((g) => ({ ...g, stories: g.stories.filter((s) => s.id !== storyId) }))
                .filter((g) => g.stories.length > 0);
              return next;
            });
          }}
        />
      )}
      </div>
    </main>
  );
}
