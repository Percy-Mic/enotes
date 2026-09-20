'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, Check, ImagePlus, Loader2, Users, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Profile } from '@/types/social';
import Avatar from '@/components/social/Avatar';
import { uploadFile } from '@/lib/storage/upload';

const GROUP_MAX_MEMBERS = 200;
const ICON_MAX_BYTES = 5 * 1024 * 1024; // 5 MB icon cap
const ICON_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/**
 * /messages/new — create a GROUP chat.
 *
 * Everything atomic: conversation + creator(admin) + members + invite
 * notifications are written by ONE database call (create_group_conversation
 * RPC). The old two-step client flow could violate RLS mid-way and leave a
 * group without members; that can no longer happen.
 *
 * The optional group icon uploads AFTER the RPC succeeds, into a folder the
 * storage RLS rules tie to this conversation (avatars/group-<id>/…) — only
 * the creator/group admins can write there, enforced in the database.
 */
export default function NewGroupPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [people, setPeople] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* group icon (local preview only — uploaded post-creation) */
  const [icon, setIcon] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState('');
  const [iconError, setIconError] = useState<string | null>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);

  /* local preview object URL — always revoked on replace/unmount */
  const iconUrlRef = useRef<string | null>(null);
  useEffect(() => {
    return () => {
      if (iconUrlRef.current) URL.revokeObjectURL(iconUrlRef.current);
    };
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        router.replace('/auth/sign-in');
        return;
      }

      /* People you follow (plus fallback to newest users) */
      const { data: followRows, error: followError } = await supabase
        .from('follows')
        .select('following_id, profiles!follows_following_id_fkey(id, full_text_name, username, avatar_url)')
        .eq('follower_id', user.id);

      let list = (followRows || []).map((row: any) => row.profiles).filter(Boolean) as Profile[];
      if (followError) {
        /* follows table may still lack policies in fresh projects — degrade, don't break */
        console.warn('Could not load follows for the picker:', followError.message);
        list = [];
      }

      if (list.length < 5) {
        const { data: extra } = await supabase
          .from('profiles')
          .select('id, full_text_name, username, avatar_url')
          .neq('id', user.id)
          .order('created_at', { ascending: false })
          .limit(10);

        const seen = new Set(list.map((p) => p.id));
        for (const p of (extra || []) as Profile[]) {
          if (!seen.has(p.id)) {
            list.push(p);
            seen.add(p.id);
          }
        }
      }

      if (active) {
        setPeople(list);
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [router]);

  const filtered = people.filter((p) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      (p.username || '').toLowerCase().includes(q) ||
      (p.full_text_name || '').toLowerCase().includes(q)
    );
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= GROUP_MAX_MEMBERS) {
          setError(`Groups are limited to ${GROUP_MAX_MEMBERS} members.`);
          return prev;
        }
        next.add(id);
      }
      return next;
    });
  };

  const pickIcon = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    setIconError(null);
    if (!f) return;
    if (!ICON_TYPES.includes(f.type)) {
      setIconError('Icons must be JPEG, PNG, WebP or GIF.');
      return;
    }
    if (f.size > ICON_MAX_BYTES) {
      setIconError('Icon is too large — 5 MB maximum.');
      return;
    }
    if (iconUrlRef.current) URL.revokeObjectURL(iconUrlRef.current);
    const url = URL.createObjectURL(f);
    iconUrlRef.current = url;
    setIcon(f);
    setIconPreview(url);
  };

  const clearIcon = () => {
    if (iconUrlRef.current) URL.revokeObjectURL(iconUrlRef.current);
    iconUrlRef.current = null;
    setIcon(null);
    setIconPreview('');
    if (iconInputRef.current) iconInputRef.current.value = '';
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (selected.size < 1) {
      setError('Pick at least one member for a group chat.');
      return;
    }

    setCreating(true);

    /* ONE atomic call: conversation + creator(admin) + members + invites.
       The database owns the whole transaction — the client cannot end up
       with a group that has no members, and no RLS mid-flight violation is
       possible because membership inserts run inside the definer RPC. */
    const { data: convId, error: rpcError } = await supabase.rpc(
      'create_group_conversation',
      {
        p_title: title.trim() || 'Community',
        p_member_ids: Array.from(selected),
      }
    );

    if (rpcError || !convId) {
      setError(
        rpcError?.message?.includes('row-level security')
          ? 'Group creation was blocked by the database — run migration 2026-09-15_community_groups_templates_fixes.sql.'
          : rpcError?.message || 'Could not create the group.'
      );
      setCreating(false);
      return;
    }

    const conversationId = convId as string;

    /* Optional icon — safe to fail without breaking the group. The path
       (avatars/group-<id>/<uuid>.<ext>) is what storage RLS authorizes. */
    if (icon) {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          const ext = (icon.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
          const path = `group-${conversationId}/${crypto.randomUUID()}.${ext}`;
          const { error: upError } = await supabase.storage
            .from('avatars')
            .upload(path, icon, { upsert: false, contentType: icon.type });
          if (upError) throw upError;

          const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
          const { error: updError } = await supabase
            .from('conversations')
            .update({ avatar_url: pub.publicUrl })
            .eq('id', conversationId);
          if (updError) throw updError;
        }
      } catch (iconErr) {
        /* non-fatal: group exists, icon failed. The component is about to
           unmount, so setError alone would vanish — carry the notice through
           the URL and let the chat page render it as a banner. */
        const reason = iconErr instanceof Error ? iconErr.message : 'unknown error';
        router.push(
          `/messages/${conversationId}?iconNotice=${encodeURIComponent(
            `Group created, but the icon could not be uploaded (${reason}). You can add one from the chat settings.`
          )}`
        );
        return;
      }
    }

    router.push(`/messages/${conversationId}`);
  };

  return (
    <main className="min-h-[100dvh] bg-[#FFF7F8] px-3 pb-24 pt-5 text-[#111111] sm:px-6">
      <div className="mx-auto w-full max-w-xl">
        <header className="mb-5 flex items-center gap-3">
          <Link
            href="/messages"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#E8E2E4] bg-white shadow-sm"
            aria-label="Back to chats"
          >
            <ArrowLeftIcon />
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">New group chat</h1>
        </header>

        <form onSubmit={create} className="space-y-5">
          <div className="rounded-2xl border border-[#E8E2E4] bg-white p-4 shadow-sm sm:p-5">
            <div className="flex items-start gap-4">
              {/* icon picker with live preview */}
              <div className="shrink-0">
                {iconPreview ? (
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={iconPreview}
                      alt="Group icon preview"
                      className="h-16 w-16 rounded-2xl object-cover ring-1 ring-[#E8E2E4]"
                    />
                    <button
                      type="button"
                      onClick={clearIcon}
                      aria-label="Remove icon"
                      className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black text-white shadow"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => iconInputRef.current?.click()}
                    aria-label="Choose a group icon"
                    className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-dashed border-[#D8C9BA] bg-[#FFF7F8] text-[#9B9B9B] transition hover:border-[#E5798F] hover:text-[#E5798F]"
                  >
                    <ImagePlus className="h-6 w-6" />
                  </button>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <label htmlFor="groupTitle" className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#6B6B6B]">
                  <Users className="h-3.5 w-3.5" /> Group name
                </label>
                <input
                  id="groupTitle"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={60}
                  placeholder="e.g. Morning Pages Club"
                  className="w-full rounded-lg border border-[#E8E2E4] px-4 py-2.5 text-base focus:border-[#1E90FF] focus:outline-none"
                />
                {iconError && (
                  <p className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-red-600" role="alert">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {iconError}
                  </p>
                )}
              </div>
            </div>
            <input ref={iconInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={pickIcon} className="hidden" aria-hidden="true" />
          </div>

          <div className="rounded-2xl border border-[#E8E2E4] bg-white p-4 shadow-sm sm:p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#6B6B6B]">
              Members ({selected.size} selected)
            </p>

            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter people…"
              className="mb-3 w-full rounded-lg border border-[#E8E2E4] px-4 py-2.5 text-sm focus:border-[#1E90FF] focus:outline-none"
              aria-label="Filter people"
            />

            {loading ? (
              <p className="py-4 text-center text-sm text-[#9B9B9B]">Loading people…</p>
            ) : filtered.length === 0 ? (
              <p className="py-4 text-center text-sm text-[#9B9B9B]">
                No one here yet — <Link href="/search" className="font-semibold text-[#1E90FF]">find people</Link> to follow first.
              </p>
            ) : (
              <ul className="max-h-72 space-y-1 overflow-y-auto">
                {filtered.map((person) => {
                  const isPicked = selected.has(person.id);
                  return (
                    <li key={person.id}>
                      <button
                        type="button"
                        onClick={() => toggle(person.id)}
                        className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition ${
                          isPicked ? 'border-[#E5798F] bg-[#FFF7F8]' : 'border-transparent hover:bg-gray-50'
                        }`}
                      >
                        <Avatar src={person.avatar_url} name={person.full_text_name || person.username} size={40} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">
                            {person.full_text_name || person.username || 'Writer'}
                          </span>
                          <span className="block truncate text-xs text-[#6B6B6B]">
                            {person.username ? `@${person.username}` : ''}
                          </span>
                        </span>
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${
                            isPicked ? 'border-[#E5798F] bg-[#E5798F] text-white' : 'border-[#D8C9BA]'
                          }`}
                        >
                          {isPicked && <Check className="h-3.5 w-3.5" />}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </p>
          )}

          <button
            type="submit"
            disabled={creating}
            className="min-h-[48px] w-full rounded-xl bg-black py-3 text-sm font-semibold text-[#FFB6C1] shadow transition hover:opacity-90 disabled:opacity-50"
          >
            {creating ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Creating…
              </span>
            ) : (
              `Create group${selected.size ? ` with ${selected.size} people` : ''}`
            )}
          </button>
        </form>
      </div>
    </main>
  );
}

function ArrowLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true">
      <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
