'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

/**
 * SharePostPicker — share an EXISTING post into one of MY communities.
 * Used from the PostCard ⋯ menu and the video editor's export actions.
 * The insert is RLS-enforced (only members can share, migration 00008);
 * the modal shows the honest error if the database refuses.
 */
export default function SharePostPicker({
  postId,
  postLabel,
  onClose,
  onShared,
}: {
  postId: string;
  postLabel: string;
  onClose: () => void;
  onShared?: (communitySlug: string) => void;
}) {
  const router = useRouter();
  const [communities, setCommunities] = useState<
    { id: string; slug: string; name: string; emoji: string; members_count: number; icon_url?: string | null }[]
  >([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    (async () => {
      /* only communities I've joined — RLS shows me exactly those rows */
      const { data } = await supabase
        .from('community_members')
        .select(
          'community:communities!community_members_community_id_fkey(id, slug, name, emoji, members_count)'
        )
        .limit(30);
      const rows = ((data || [])
        .map((r) => r.community)
        .filter(Boolean) ?? []) as unknown as { id: string; slug: string; name: string; emoji: string; members_count: number }[];
      setCommunities(rows);
      setLoading(false);
    })();
  }, []);

  const share = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const community = communities.find((c) => c.id === selected);
    const trimmed = note.trim().slice(0, 280);
    /* note needs migration 2026-09-19_community_share_note — retry without
       it so sharing still works on a not-yet-migrated database. */
    let err: { message: string } | null = null;
    if (trimmed) {
      ({ error: err } = await supabase.from('community_posts').insert({
        community_id: selected,
        post_id: postId,
        posted_by: user?.id,
        note: trimmed,
      }));
      if (err && (err.message.includes('note') || err.message.includes('column'))) {
        ({ error: err } = await supabase.from('community_posts').insert({
          community_id: selected,
          post_id: postId,
          posted_by: user?.id,
        }));
      }
    } else {
      ({ error: err } = await supabase.from('community_posts').insert({
        community_id: selected,
        post_id: postId,
        posted_by: user?.id,
      }));
    }

    if (err) {
      setBusy(false);
      setError(
        err.message.includes('row-level security') || err.message.includes('duplicate')
          ? 'Join the community first (or it was already shared there).'
          : err.message
      );
      return;
    }

    setBusy(false);
    setNote('');
    if (community) {
      setDone(community.name);
      onShared?.(community.slug);
      // let the success state flash, then close
      window.setTimeout(() => {
        onClose();
        router.push(`/communities/${community.slug}`);
      }, 700);
    } else {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Share ${postLabel} to a community`}
    >
      <div className="w-full max-w-md rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <header className="flex items-center justify-between border-b border-[#F0EAEC] px-5 py-4">
          <h2 className="text-sm font-bold">
            {done ? 'Shared ✓' : `Share to a community`}
          </h2>
          <button onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-[#FFF7F8]">
            <X className="h-5 w-5" />
          </button>
        </header>

        {done ? (
          <p className="px-5 py-10 text-center text-sm font-semibold text-[#E5798F]">
            Shared to {done} — taking you there…
          </p>
        ) : (
          <>
            <div className="max-h-[46dvh] overflow-y-auto p-4">
              {loading ? (
                <p className="py-8 text-center text-sm text-[#6B6B6B]">Loading your communities…</p>
              ) : communities.length === 0 ? (
                <div className="py-6 text-center">
                  <p className="text-sm font-semibold">You haven't joined any communities yet</p>
                  <p className="mt-1 text-xs text-[#6B6B6B]">
                    Join one from Groups, then share posts into it.
                  </p>
                  <button
                    onClick={() => {
                      onClose();
                      router.push('/communities');
                    }}
                    className="mt-4 rounded-xl bg-black px-5 py-2.5 text-sm font-semibold text-[#FFB6C1]"
                  >
                    Browse Groups
                  </button>
                </div>
              ) : (
                <ul className="space-y-2">
                  {communities.map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => setSelected(c.id)}
                        aria-pressed={selected === c.id}
                        className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${
                          selected === c.id ? 'border-[#E5798F] bg-[#FFF7F8]' : 'border-[#E8E2E4] hover:bg-[#FFF7F8]/60'
                        }`}
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#FFF7F8] text-xl">
                          {c.icon_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={c.icon_url} alt="" className="h-full w-full object-cover" />
                          ) : (
                            c.emoji
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{c.name}</span>
                          <span className="block text-[11px] text-[#6B6B6B]">{c.members_count} members</span>
                        </span>
                        {selected === c.id && <Check className="h-5 w-5 shrink-0 text-[#E5798F]" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* say something: optional note shown above the shared post */}
            {selected && !done && (
              <div className="px-5 pb-2">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={280}
                  rows={2}
                  placeholder="Say something about this share… (optional)"
                  aria-label="Share note"
                  className="w-full resize-none rounded-xl border border-[#E8E2E4] px-3 py-2.5 text-sm focus:border-[#E5798F] focus:outline-none"
                />
                <p className="mt-1 text-right text-[10px] text-[#9B9B9B]">{note.length}/280</p>
              </div>
            )}

            {error && <p className="px-5 pb-2 text-xs font-semibold text-red-600">{error}</p>}

            <footer className="border-t border-[#F0EAEC] p-4">
              <button
                onClick={share}
                disabled={!selected || busy}
                className="w-full rounded-xl bg-black py-3 text-sm font-bold text-[#FFB6C1] disabled:opacity-40"
              >
                {busy ? 'Sharing…' : 'Share'}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
