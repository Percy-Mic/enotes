'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AlertCircle, Camera, Check, ImagePlus, Loader2, Plus, Send, Shield, Trash2, Users, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Post } from '@/types/social';
import Avatar from '@/components/social/Avatar';
import PostCard from '@/components/social/PostCard';
import JoinCommunityButton from '@/components/community/JoinCommunityButton';
import ShareToCommunityModal from '@/components/community/ShareToCommunityModal';
import { enrichPosts } from '@/lib/social/enrich';
import { uploadFileWithProgress } from '@/lib/storage/upload';

const COVER_MAX_BYTES = 5 * 1024 * 1024;
const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/**
 * /communities/[slug] — a community feed.
 *
 * Role model (ENFORCED by RLS + storage policies, the UI merely reflects it):
 *   creator   — edit details, change/remove cover, remove any member/moderator
 *   moderator — edit details, change/remove cover, remove normal members
 *   member    — share posts, leave
 *
 * Cover images live in avatars/community-<id>/…; the storage policies for
 * that folder call is_community_admin() so a spoofed client cannot upload.
 */
export default function CommunityPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();

  const [community, setCommunity] = useState<{
    id: string; slug: string; name: string; description: string; topic: string; emoji: string;
    members_count: number; posts_count: number; created_by: string; cover_url: string | null; icon_url?: string | null;
  } | null>(null);
  const [members, setMembers] = useState<{ id: string; username: string; avatar_url: string; full_text_name: string }[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [shareMeta, setShareMeta] = useState<Record<string, { note: string | null; by: string | null }>>({});
  const [isMember, setIsMember] = useState(false);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  /* direct composer: text + optional image/video, posted straight into the community */
  const [draft, setDraft] = useState('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [postProgress, setPostProgress] = useState(0);
  const [postError, setPostError] = useState<string | null>(null);
  const composerInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  /* cover management */
  const [editingCover, setEditingCover] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [coverNotice, setCoverNotice] = useState<string | null>(null);
  const [membersCount, setMembersCount] = useState(0);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editEmoji, setEditEmoji] = useState('✨');
  const coverInputRef = useRef<HTMLInputElement>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);

  const amAdmin = !!community && (community.created_by === myId || myRole === 'moderator');

  const load = useCallback(async () => {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      router.replace('/auth/sign-in');
      return;
    }
    setMyId(user.id);

    const fetch = supabase
      .from('communities')
      .select('id, slug, name, description, topic, emoji, members_count, posts_count, created_by, cover_url, icon_url')
      .eq('slug', slug)
      .maybeSingle();
    /* icon_url ships with migration 2026-09-19 — tolerate a not-yet-migrated
       database by retrying without the column (icon falls back to emoji). */
    let { data: c, error: cError } = await fetch;
    if (cError && cError.message.includes('icon_url')) {
      ({ data: c, error: cError } = await supabase
        .from('communities')
        .select('id, slug, name, description, topic, emoji, members_count, posts_count, created_by, cover_url')
        .eq('slug', slug)
        .maybeSingle());
    }
    if (cError) {
      setLoadError(cError.message);
      setLoading(false);
      return;
    }
    if (!c) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setCommunity(c);
    setEditName(c.name);
    setEditDescription(c.description || '');
    setEditEmoji(c.emoji || '✨');
    /* count triggers (migration 2026-09-15) keep members_count true in the
       DB — reflect any change immediately so Join/Leave shows live truth */
    setMembersCount(c.members_count ?? 0);

    const { data: m, error: mError } = await supabase
      .from('community_members')
      .select('user_id, role')
      .eq('community_id', c.id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (mError) console.warn('Membership check failed:', mError.message);
    setIsMember(!!m);
    setMyRole(c.created_by === user.id ? 'creator' : ((m as any)?.role ?? null));

    /* note/shared_by need migration 2026-09-19_community_share_note — fall
       back to the plain fetch on a not-yet-migrated database. */
    const withNote = await supabase
      .from('community_posts')
      .select(
        `created_at, note, shared_by:profiles!community_posts_posted_by_fkey(id, full_text_name, username),
         post:posts!community_posts_post_id_fkey(
          id, author_id, content, media_url, media_type, visibility, created_at, post_type, journal_id,
          author:profiles!posts_author_id_fkey(id, full_text_name, username, avatar_url),
          likes:post_likes(count), comments:comments(count)
        )`,
      )
      .eq('community_id', c.id)
      .order('created_at', { ascending: false })
      .limit(30);
    let cp: Record<string, unknown>[] | null = (withNote.data || null) as Record<string, unknown>[] | null;
    let cpError: { message: string } | null = withNote.error
      ? { message: withNote.error.message }
      : null;
    if (cpError && (cpError.message.includes('note') || cpError.message.includes('column'))) {
      const fallback = await supabase
        .from('community_posts')
        .select(
          `created_at, post:posts!community_posts_post_id_fkey(
          id, author_id, content, media_url, media_type, visibility, created_at, post_type, journal_id,
          author:profiles!posts_author_id_fkey(id, full_text_name, username, avatar_url),
          likes:post_likes(count), comments:comments(count)
        )`,
        )
        .eq('community_id', c.id)
        .order('created_at', { ascending: false })
        .limit(30);
      cp = (fallback.data || null) as Record<string, unknown>[] | null;
      cpError = fallback.error ? { message: fallback.error.message } : null;
    }
    if (cpError) {
      setLoadError(`Could not load community posts — ${cpError.message}`);
      setPosts([]);
    } else {
      const rows = (cp || []) as { note?: string | null; shared_by?: { full_text_name?: string; username?: string } | null; post?: unknown }[];
      const meta: Record<string, { note: string | null; by: string | null }> = {};
      const list: Post[] = [];
      for (const row of rows) {
        if (!row.post) continue;
        const p = row.post as unknown as Post;
        list.push(p);
        meta[p.id] = { note: row.note || null, by: row.shared_by?.full_text_name || row.shared_by?.username || null };
      }
      /* full interactive payload (reactions, saves, reposts…) via the shared
         enrichment owner — identical behavior to the main feed */
      const enriched = await enrichPosts(list, user.id);
      setPosts(enriched);
      setShareMeta(meta);
    }

    /* a few member avatars for the header */
    const { data: memberRows } = await supabase
      .from('community_members')
      .select('user:profiles!community_members_user_id_fkey(id, username, avatar_url, full_text_name)')
      .eq('community_id', c.id)
      .limit(8);
    setMembers(((memberRows || []).map((m) => m.user).filter(Boolean) ?? []) as never);

    setLoading(false);
  }, [slug, router]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ---------- direct post composer (RLS: members only) ---------- */

  const pickComposerMedia = (file: File | null) => {
    setPostError(null);
    setMediaFile(file);
    setMediaPreview(file ? URL.createObjectURL(file) : null);
  };

  const submitDirectPost = async () => {
    if (!myId || !community) return;
    const text = draft.trim();
    if (!text && !mediaFile) {
      setPostError('Write something or attach a photo/video first.');
      return;
    }
    setPosting(true);
    setPostError(null);
    try {
      let mediaUrl: string | null = null;
      let mediaType: string | null = null;
      let mediaSize: number | null = null;
      if (mediaFile) {
        const up = await uploadFileWithProgress(mediaFile, 'post-media', myId, setPostProgress);
        mediaUrl = up.url;
        mediaType = mediaFile.type.startsWith('video/') ? 'video' : 'image';
        mediaSize = mediaFile.size;
      }

      /* mentions + hashtags, same contract as the feed composer */
      const mentionHandles = Array.from(new Set((text.match(/@([a-zA-Z0-9_]{3,24})/g) || []).map((h) => h.slice(1))));
      let mentions: { id: string; username: string }[] = [];
      if (mentionHandles.length) {
        const { data: found } = await supabase.from('profiles').select('id, username').in('username', mentionHandles);
        mentions = (found || []) as { id: string; username: string }[];
      }
      const hashtags = Array.from(new Set((text.match(/#[a-zA-Z0-9_]+/g) || []).map((t) => t.slice(1).toLowerCase())));

      const { data: inserted, error: postError } = await supabase
        .from('posts')
        .insert({
          author_id: myId,
          content: text,
          media_url: mediaUrl,
          media_type: mediaType,
          media_size: mediaSize,
          post_type: mediaUrl ? 'media' : 'text',
          mentions,
          hashtags,
          visibility: 'public',
        })
        .select('id')
        .single();
      if (postError) throw postError;

      /* join the post into the community (RLS: members only) */
      const { error: linkError } = await supabase.from('community_posts').insert({
        community_id: community.id,
        post_id: (inserted as { id: string }).id,
        posted_by: myId,
      });
      if (linkError) throw linkError;

      /* notify mentioned users, same as feed (skip self) */
      if (mentions.length) {
        await supabase.from('notifications').insert(
          mentions
            .filter((m) => m.id !== myId)
            .map((m) => ({
              user_id: m.id,
              actor_id: myId,
              type: 'mention',
              entity_type: 'post',
              message: 'mentioned you in a post',
            })),
        );
      }

      setDraft('');
      pickComposerMedia(null);
      await load();
    } catch (e) {
      setPostError(e instanceof Error ? e.message : 'Could not post — try again.');
    } finally {
      setPosting(false);
      setPostProgress(0);
    }
  };

  /* realtime: newly shared posts appear live */
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  useEffect(() => {
    if (!community) return;
    const channel = supabase
      .channel(`community-${community.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'community_posts', filter: `community_id=eq.${community.id}` },
        () => void load(),
      )
      .subscribe();
    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [community, load]);

  /* ---------- cover + details management (RLS is the real gate) ---------- */

  const openCoverEditor = () => {
    setCoverError(null);
    setCoverNotice(null);
    setEditingCover(true);
  };

  const pickCover = async (file: File | null, remove: boolean) => {
    if (!community) return;
    setCoverBusy(true);
    setCoverError(null);
    setCoverNotice(null);
    try {
      let coverUrl = community.cover_url;

      if (remove && coverUrl) {
        try {
          const marker = '/object/public/avatars/';
          const idx = coverUrl.indexOf(marker);
          if (idx >= 0) await supabase.storage.from('avatars').remove([decodeURIComponent(coverUrl.slice(idx + marker.length))]);
        } catch { /* non-fatal cleanup */ }
        coverUrl = null;
      }

      if (file) {
        const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
        const path = `community-${community.id}/${crypto.randomUUID()}.${ext}`;
        const { error: upError } = await supabase.storage
          .from('avatars')
          .upload(path, file, { upsert: false, contentType: file.type });
        if (upError) {
          throw new Error(
            upError.message.includes('row-level')
              ? 'Only the creator or moderators can change the cover.'
              : upError.message
          );
        }
        const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
        coverUrl = pub.publicUrl;

        /* replace: clean up the previous managed cover */
        const oldUrl = community.cover_url;
        if (oldUrl) {
          try {
            const marker = '/object/public/avatars/';
            const idx = oldUrl.indexOf(marker);
            if (idx >= 0) {
              const oldPath = decodeURIComponent(oldUrl.slice(idx + marker.length));
              if (oldPath.startsWith(`community-${community.id}/`)) {
                await supabase.storage.from('avatars').remove([oldPath]);
              }
            }
          } catch { /* non-fatal */ }
        }
      }

      /* Uploads/renders must not be lost to a no-op save: media changes
         always patch, even when the text fields are untouched. */
      const patch: Record<string, unknown> = {};
      if (file || remove) patch.cover_url = coverUrl;
      const name = editName.trim();
      if (name && name !== community.name) patch.name = name;
      if (editDescription.trim() !== (community.description || '')) patch.description = editDescription.trim();
      if (editEmoji !== community.emoji) patch.emoji = editEmoji;

      if (Object.keys(patch).length === 0) {
        setCoverNotice('Nothing to change.');
        return;
      }

      const { error: updError } = await supabase.from('communities').update(patch).eq('id', community.id);
      if (updError) {
        throw new Error(
          updError.message.includes('row-level security')
            ? 'Only the creator or moderators can edit this community.'
            : updError.message
        );
      }

      setCommunity({ ...community, ...(patch as object) } as typeof community);
      setEditingCover(false);
      setCoverNotice('Community updated.');
    } catch (e) {
      setCoverError(e instanceof Error ? e.message : 'Could not update the community.');
    } finally {
      setCoverBusy(false);
    }
  };

  const onCoverFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!COVER_TYPES.includes(f.type)) return setCoverError('Covers must be JPEG, PNG, WebP or GIF.');
    if (f.size > COVER_MAX_BYTES) return setCoverError('Cover is too large — 5 MB maximum.');
    void pickCover(f, false);
  };

  /* icon image: uploaded to community-<id>/ like the cover, stored in
     communities.icon_url; removing falls back to the emoji badge. */
  const pickIcon = async (file: File | null, remove: boolean) => {
    if (!community) return;
    setCoverBusy(true);
    setCoverError(null);
    setCoverNotice(null);
    try {
      let iconUrl: string | null = community.icon_url || null;

      if (remove && iconUrl) {
        try {
          const marker = '/object/public/avatars/';
          const idx = iconUrl.indexOf(marker);
          if (idx >= 0) await supabase.storage.from('avatars').remove([decodeURIComponent(iconUrl.slice(idx + marker.length))]);
        } catch { /* non-fatal cleanup */ }
        iconUrl = null;
      }

      if (file) {
        const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
        const path = `community-${community.id}/${crypto.randomUUID()}.${ext}`;
        const { error: upError } = await supabase.storage
          .from('avatars')
          .upload(path, file, { upsert: false, contentType: file.type });
        if (upError) {
          throw new Error(
            upError.message.includes('row-level')
              ? 'Only the creator, moderators or platform admins can change the icon.'
              : upError.message
          );
        }
        const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
        iconUrl = pub.publicUrl;

        const oldUrl = community.icon_url || null;
        if (oldUrl) {
          try {
            const marker = '/object/public/avatars/';
            const idx = oldUrl.indexOf(marker);
            if (idx >= 0) {
              const oldPath = decodeURIComponent(oldUrl.slice(idx + marker.length));
              if (oldPath.startsWith(`community-${community.id}/`)) {
                await supabase.storage.from('avatars').remove([oldPath]);
              }
            }
          } catch { /* non-fatal */ }
        }
      }

      const { error: updError } = await supabase
        .from('communities')
        .update({ icon_url: iconUrl })
        .eq('id', community.id);
      if (updError) {
        throw new Error(
          updError.message.includes('column') || updError.message.includes('icon_url')
            ? 'The icon feature needs migration 2026-09-19_community_icon_image applied.'
            : updError.message.includes('row-level security')
              ? 'Only the creator, moderators or platform admins can change the icon.'
              : updError.message
        );
      }

      setCommunity({ ...community, icon_url: iconUrl } as typeof community);
      setCoverNotice(iconUrl ? 'Icon updated.' : 'Icon removed — the emoji badge is back.');
    } catch (e) {
      setCoverError(e instanceof Error ? e.message : 'Could not update the icon.');
    } finally {
      setCoverBusy(false);
    }
  };

  const onIconFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!COVER_TYPES.includes(f.type)) return setCoverError('Icons must be JPEG, PNG, WebP or GIF.');
    if (f.size > COVER_MAX_BYTES) return setCoverError('Icon is too large — 5 MB maximum.');
    void pickIcon(f, false);
  };

  if (notFound) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-[#FFF7F8] px-4 text-[#111111]">
        <div className="text-center">
          <p className="text-4xl">🫥</p>
          <h1 className="mt-3 text-lg font-bold">Community not found</h1>
          <p className="mt-1 text-sm text-[#6B6B6B]">It may have been removed.</p>
          <Link href="/communities" className="mt-4 inline-block rounded-xl bg-black px-5 py-2.5 text-sm font-semibold text-[#FFB6C1]">
            Browse communities
          </Link>
        </div>
      </main>
    );
  }

  if (loading || !community) {
    return (
      <main className="min-h-[100dvh] bg-[#FFF7F8] px-3 pt-5">
        <div className="mx-auto max-w-2xl space-y-3">
          <div className="h-28 animate-pulse rounded-2xl bg-white/70" />
          <div className="h-20 animate-pulse rounded-2xl bg-white/70" />
        </div>
        {loadError && <p className="mx-auto mt-4 max-w-2xl text-center text-xs text-red-600">{loadError}</p>}
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-[#FFF7F8] px-3 pb-24 pt-5 text-[#111111] sm:px-6 md:pb-10">
      <div className="mx-auto w-full max-w-2xl">
        <Link href="/communities" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#6B6B6B] hover:text-[#111111]">
          <ArrowLeftSafe /> Communities
        </Link>

        <header className="overflow-hidden rounded-2xl border border-[#E8E2E4] bg-white shadow-sm">
          {/* cover */}
          <div className="relative h-28 w-full bg-gradient-to-br from-[#EDE4FF] via-[#FFE4EC] to-[#FFF3D6] sm:h-36">
            {community.cover_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={community.cover_url} alt="" className="h-full w-full object-cover" />
            )}
            {amAdmin && (
              <button
                onClick={openCoverEditor}
                className="absolute right-2 top-2 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-[11px] font-semibold text-white backdrop-blur transition hover:bg-black/75"
                aria-label={community.cover_url ? 'Edit community cover and details' : 'Add a community cover'}
              >
                <Camera className="h-3.5 w-3.5" /> {community.cover_url ? 'Edit' : 'Add cover'}
              </button>
            )}
          </div>

          <div className="p-5">
            <div className="flex items-start gap-4">
              <span className="-mt-10 flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white text-4xl shadow ring-1 ring-[#E8E2E4]">
                {community.icon_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={community.icon_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  community.emoji
                )}
              </span>
              <div className="min-w-0 flex-1">
                <h1 className="flex items-center gap-1.5 text-xl font-bold tracking-tight">
                  {community.name}
                  {amAdmin && <Shield className="h-4 w-4 text-[#1E90FF]" aria-label={community.created_by === myId ? 'You are the creator' : 'You are a moderator'} />}
                </h1>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[#6B6B6B]">
                  <Users className="h-3.5 w-3.5" />
                  {membersCount} member{membersCount === 1 ? '' : 's'} · #{community.topic}
                </p>
                {community.description && (
                  <p className="mt-2 text-sm text-[#3D3D3D]">{community.description}</p>
                )}
                {members.length > 0 && (
                  <div className="mt-3 flex items-center gap-2">
                    <div className="flex -space-x-2">
                      {members.slice(0, 5).map((m) => (
                        <Avatar key={m.id} src={m.avatar_url} name={m.full_text_name || m.username} size={26} />
                      ))}
                    </div>
                    <span className="text-[11px] text-[#6B6B6B]">
                      {members.slice(0, 3).map((m) => m.username).join(', ')}
                      {membersCount > 3 ? ` +${membersCount - 3}` : ''}
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <JoinCommunityButton
                communityId={community.id}
                onChange={(joined) =>
                  setMembersCount((n) => Math.max(0, n + (joined ? 1 : -1)))
                }
              />
              {isMember && (
                <button
                  onClick={() => setShareOpen(true)}
                  className="flex items-center gap-1.5 rounded-xl bg-[#E5798F] px-4 py-2 text-sm font-semibold text-white shadow hover:opacity-90"
                >
                  <Plus className="h-4 w-4" /> Share a post
                </button>
              )}
            </div>
          </div>
        </header>

        <section className="mt-5 space-y-3">
          {/* direct composer — members post straight into this community */}
          {isMember && (
            <div className="rounded-2xl border border-[#E8E2E4] bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <Avatar
                  src={members.find((m) => m.id === myId)?.avatar_url}
                  name={members.find((m) => m.id === myId)?.full_text_name}
                  size={38}
                />
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value.slice(0, 20000))}
                  placeholder={`Post directly to ${community?.name || 'this community'}…`}
                  rows={2}
                  className="min-h-[44px] flex-1 resize-y rounded-xl border border-transparent bg-[#F7F5F6] px-3 py-2.5 text-sm outline-none transition focus:border-[#E5798F] focus:bg-white"
                  aria-label="Write a community post"
                />
              </div>
              {mediaPreview && (
                <div className="relative mt-3 inline-block">
                  {mediaFile?.type.startsWith('video/') ? (
                    <video src={mediaPreview} className="max-h-56 rounded-xl" controls playsInline />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={mediaPreview} alt="Attachment preview" className="max-h-56 rounded-xl" />
                  )}
                  <button
                    onClick={() => pickComposerMedia(null)}
                    className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white shadow"
                    aria-label="Remove attachment"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
              {postError && <p className="mt-2 text-xs font-semibold text-red-600">{postError}</p>}
              <div className="mt-3 flex items-center justify-between gap-2">
                <button
                  onClick={() => composerInputRef.current?.click()}
                  disabled={posting}
                  className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-[#6B6B6B] transition hover:bg-[#F7F5F6] disabled:opacity-50"
                >
                  <ImagePlus className="h-4 w-4" /> Photo/Video
                </button>
                <button
                  onClick={submitDirectPost}
                  disabled={posting || (!draft.trim() && !mediaFile)}
                  className="flex items-center gap-1.5 rounded-xl bg-[#E5798F] px-4 py-2 text-sm font-semibold text-white shadow transition hover:opacity-90 disabled:opacity-50"
                >
                  {posting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {postProgress > 0 && postProgress < 100 ? `Uploading ${postProgress}%` : 'Posting…'}
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" /> Post
                    </>
                  )}
                </button>
              </div>
              <input
                ref={composerInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  pickComposerMedia(f);
                  e.target.value = '';
                }}
              />
            </div>
          )}

          <h2 className="text-sm font-bold uppercase tracking-wide text-[#9B9B9B]">Posts</h2>
          {posts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#E8E2E4] bg-white/60 px-6 py-12 text-center">
              <p className="text-sm font-semibold">Nothing here yet</p>
              <p className="mt-1 text-sm text-[#6B6B6B]">
                {isMember ? 'Use the box above to post the first one.' : 'Join to post and interact.'}
              </p>
            </div>
          ) : (
            posts.map((post) => (
              <div key={post.id}>
                {shareMeta[post.id]?.note && (
                  <div className="mb-2 rounded-xl bg-[#FFF7F8] px-3 py-2">
                    <p className="text-[11px] font-bold text-[#E5798F]">
                      {shareMeta[post.id].by ? `${shareMeta[post.id].by} shared:` : 'Shared:'}
                    </p>
                    <p className="whitespace-pre-wrap text-sm text-[#3D3D3D]">{shareMeta[post.id].note}</p>
                  </div>
                )}
                <PostCard
                  post={post}
                  onDeleted={(id) => setPosts((ps) => ps.filter((p) => p.id !== id))}
                />
              </div>
            ))
          )}
        </section>
      </div>

      {/* cover + details editor — creator/moderators; RLS enforces server-side */}
      {editingCover && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={() => setEditingCover(false)}>
          <div className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Edit community">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-bold">Edit community</h3>
              <button onClick={() => setEditingCover(false)} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-gray-100" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="relative h-24 overflow-hidden rounded-xl bg-gradient-to-br from-[#EDE4FF] via-[#FFE4EC] to-[#FFF3D6]">
              {community.cover_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={community.cover_url} alt="" className="h-full w-full object-cover" />
              )}
              {coverBusy && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <Loader2 className="h-5 w-5 animate-spin text-white" />
                </span>
              )}
            </div>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => coverInputRef.current?.click()}
                disabled={coverBusy}
                className="flex items-center gap-1.5 rounded-lg border border-[#E8E2E4] px-3 py-2 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50"
              >
                <Camera className="h-3.5 w-3.5" /> {community.cover_url ? 'Replace cover' : 'Upload cover'}
              </button>
              {community.cover_url && (
                <button
                  onClick={() => void pickCover(null, true)}
                  disabled={coverBusy}
                  className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove cover
                </button>
              )}
            </div>
            <input ref={coverInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={onCoverFile} className="hidden" aria-hidden="true" />

            {/* icon image — shown instead of the emoji wherever the community appears */}
            <div className="mt-4 flex items-center gap-3">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white text-3xl shadow ring-1 ring-[#E8E2E4]">
                {community.icon_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={community.icon_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  editEmoji || community.emoji
                )}
              </span>
              <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                <button
                  onClick={() => iconInputRef.current?.click()}
                  disabled={coverBusy}
                  className="flex items-center gap-1.5 rounded-lg border border-[#E8E2E4] px-3 py-2 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50"
                >
                  <Camera className="h-3.5 w-3.5" /> {community.icon_url ? 'Replace icon' : 'Upload icon image'}
                </button>
                {community.icon_url && (
                  <button
                    onClick={() => void pickIcon(null, true)}
                    disabled={coverBusy}
                    className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove icon
                  </button>
                )}
              </div>
            </div>
            <input ref={iconInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={onIconFile} className="hidden" aria-hidden="true" />

            <label className="mt-4 block">
              <span className="text-xs font-semibold text-[#6B6B6B]">Name</span>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={60}
                className="mt-1 w-full rounded-lg border border-[#E8E2E4] px-3 py-2.5 text-sm focus:border-[#E5798F] focus:outline-none"
                aria-label="Community name"
              />
            </label>

            <label className="mt-3 block">
              <span className="text-xs font-semibold text-[#6B6B6B]">Description</span>
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={3}
                maxLength={280}
                className="mt-1 w-full resize-none rounded-lg border border-[#E8E2E4] px-3 py-2.5 text-sm focus:border-[#E5798F] focus:outline-none"
                aria-label="Community description"
              />
            </label>

            <button
              onClick={() => void pickCover(null, false)}
              disabled={coverBusy || (editName.trim() === community.name && editDescription.trim() === (community.description || '') && editEmoji === community.emoji)}
              className="mt-4 w-full rounded-xl bg-black py-3 text-sm font-bold text-[#FFB6C1] disabled:opacity-40"
            >
              {coverBusy ? 'Saving…' : 'Save changes'}
            </button>

            {coverError && (
              <p role="alert" className="mt-3 flex items-start gap-1.5 rounded-lg bg-red-50 p-2.5 text-xs text-red-600">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {coverError}
              </p>
            )}
            {coverNotice && <p className="mt-3 rounded-lg bg-emerald-50 p-2.5 text-xs text-emerald-700">{coverNotice}</p>}
          </div>
        </div>
      )}

      {shareOpen && community && (
        <ShareToCommunityModal
          communityId={community.id}
          communityName={community.name}
          myId={myId}
          onClose={() => setShareOpen(false)}
          onShared={() => {
            setShareOpen(false);
            void load();
          }}
        />
      )}
    </main>
  );
}

function ArrowLeftSafe() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
      <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
