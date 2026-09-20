'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BookOpen, LogOut, Plus, Sparkles, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { CreateJournalModal } from '@/components/dashboard/CreateJournalModal';
import ThemeToggle from '@/components/ThemeToggle';

interface Journal {
  id: string;
  title: string;
  description?: string;
  foreword?: string;
  cover_media_url?: string;
  cover_url?: string;
  background_color?: string;
  visibility?: string;
  created_at: string;
}

interface Profile {
  full_text_name?: string;
  username?: string;
}

interface SharedJournal {
  id: string;
  title: string;
  description?: string;
  foreword?: string;
  cover_media_url?: string;
  cover_url?: string;
  background_color?: string;
  can_edit?: boolean;
  owner?: { full_text_name?: string; username?: string } | null;
}

export default function JournalsPage() {
  const router = useRouter();
  const [journals, setJournals] = useState<Journal[]>([]);
  const [sharedWithMe, setSharedWithMe] = useState<SharedJournal[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const loadJournals = useCallback(async () => {
    setLoading(true);
    setError(null);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      router.replace('/auth/sign-in');
      return;
    }

    const { data, error: fetchError } = await supabase
      .from('journals')
      .select(
        'id, title, description, foreword, cover_media_url, cover_url, background_color, visibility, created_at',
      )
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
    } else {
      setJournals((data || []) as Journal[]);
    }

    /* Journals shared with me directly */
    const { data: shareRows } = await supabase
      .from('journal_shares')
      .select(
        'can_edit, journals!journal_shares_journal_id_fkey(id, title, description, foreword, cover_media_url, cover_url, background_color, owner_id, profiles!journals_owner_id_fkey(full_text_name, username))',
      )
      .eq('shared_with', user.id);

    setSharedWithMe(
      ((shareRows || []) as any[]).map((row) => ({
        ...(row.journals || {}),
        can_edit: row.can_edit,
        owner: row.journals?.profiles || null,
      })) as SharedJournal[],
    );

    const { data: profileData } = await supabase
      .from('profiles')
      .select('full_text_name, username')
      .eq('id', user.id)
      .maybeSingle();

    setProfile((profileData as Profile | null) || null);
    setEmail(user.email || '');
    setLoading(false);
  }, [router]);

  useEffect(() => {
    loadJournals();
  }, [loadJournals]);

  const handleSignOut = async () => {
    setSigningOut(true);
    await supabase.auth.signOut();
    router.replace('/auth/sign-in');
    router.refresh();
  };

  const displayName =
    profile?.full_text_name || profile?.username || email.split('@')[0] || 'friend';

  return (
    <main className="min-h-screen bg-[#FFF7F8] px-4 pb-28 pt-6 text-[#111111] sm:px-6 md:pb-16">
      <div className="mx-auto w-full max-w-5xl">
        {/* Header */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">
              Your journals ♡
            </h1>
            <p className="mt-1 text-sm text-[#6B6B6B]">
              Welcome back, <span className="font-medium text-[#111111]">{displayName}</span>.
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <ThemeToggle className="hidden h-10 w-10 items-center justify-center rounded-xl border border-[#E8E2E4] bg-white text-[#6B6B6B] shadow-sm transition hover:bg-gray-50 hover:text-[#111111] md:flex" />
            <Link
              href="/feed"
              className="rounded-xl border border-[#E8E2E4] bg-white px-3.5 py-2 text-sm font-medium shadow-sm transition hover:bg-gray-50"
            >
              Feed
            </Link>
            <button
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-black px-4 py-2 text-sm font-medium text-[#FFB6C1] shadow transition hover:opacity-90"
            >
              <Plus className="h-4 w-4" /> New journal
            </button>
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#E8E2E4] bg-white px-3 py-2 text-sm font-medium text-[#6B6B6B] shadow-sm transition hover:bg-gray-50 hover:text-[#111111] disabled:opacity-50"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">{signingOut ? 'Signing out…' : 'Sign out'}</span>
            </button>
          </div>
        </header>

        {/* Error */}
        {error && (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading ? (
          <div className="mt-16 flex flex-col items-center justify-center gap-3 text-[#6B6B6B]">
            <BookOpen className="h-6 w-6 animate-pulse" />
            <p className="text-sm">Opening your library…</p>
          </div>
        ) : journals.length > 0 ? (
          <>
            {/* Stat strip — quick counts above the grid (md+ only; phones keep the old single-grid layout) */}
            <section className="mt-8 hidden gap-3 grid-cols-2 sm:gap-4 md:grid">
              <div className="rounded-2xl border border-[#E8E2E4] bg-white p-4 shadow-sm">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FFF0F3]">
                  <BookOpen className="h-4 w-4 text-[#E5798F]" />
                </span>
                <p className="mt-3 text-2xl font-bold">{journals.length}</p>
                <p className="mt-0.5 text-xs font-medium uppercase tracking-wider text-[#6B6B6B]">Journals</p>
              </div>
              <div className="rounded-2xl border border-[#E8E2E4] bg-white p-4 shadow-sm">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FFF9EF]">
                  <Users className="h-4 w-4 text-amber-500" />
                </span>
                <p className="mt-3 text-2xl font-bold">{sharedWithMe.length}</p>
                <p className="mt-0.5 text-xs font-medium uppercase tracking-wider text-[#6B6B6B]">Shared with you</p>
              </div>
            </section>

            {/* Journal grid — featured first card spans full width on sm+ */}
            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {journals.map((journal, idx) => (
                <Link
                  key={journal.id}
                  href={`/journals/${journal.id}`}
                  className={`group flex flex-col overflow-hidden rounded-2xl border border-[#E8E2E4] bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                    idx === 0 ? 'sm:col-span-2 lg:col-span-2' : ''
                  }`}
                >
                  <div
                    className={`relative flex items-center justify-center overflow-hidden ${
                      idx === 0 ? 'h-48 sm:h-52' : 'h-36'
                    }`}
                    style={{ backgroundColor: journal.background_color || '#FFF7F8' }}
                  >
                    {journal.cover_media_url || journal.cover_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={journal.cover_media_url || journal.cover_url}
                        alt=""
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <span className={idx === 0 ? 'text-6xl' : 'text-4xl'}>📖</span>
                    )}
                    {journal.visibility === 'public' && (
                      <span className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-[#6B6B6B]">
                        Public
                      </span>
                    )}
                    {idx === 0 && (
                      <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white backdrop-blur-sm">
                        Latest
                      </span>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col p-4">
                    <h3 className={`truncate font-semibold ${idx === 0 ? 'text-base' : ''}`}>{journal.title}</h3>
                    <p className="mt-1 line-clamp-2 flex-1 text-sm text-[#6B6B6B]">
                      {journal.description || journal.foreword || 'No description yet.'}
                    </p>
                    <p className="mt-3 text-xs text-[#9B9B9B]">
                      Created {new Date(journal.created_at).toLocaleDateString()}
                      {idx === 0 && (
                        <span className="ml-3 inline-flex items-center gap-1 font-semibold text-[#E5798F]">
                          Open <span aria-hidden="true">→</span>
                        </span>
                      )}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </>
        ) : (
          /* Empty state */
          <div className="mt-12 flex flex-col items-center rounded-[20px] border border-dashed border-[#E8E2E4] bg-white/60 px-6 py-14 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#FFF0F3]">
              <Sparkles className="h-6 w-6 text-[#E5798F]" />
            </div>
            <h2 className="mt-4 text-lg font-semibold">No journals yet</h2>
            <p className="mt-1 max-w-sm text-sm text-[#6B6B6B]">
              Create your first journal and start filling it with notes, sketches and memories.
            </p>
            <button
              onClick={() => setModalOpen(true)}
              className="mt-6 inline-flex items-center gap-1.5 rounded-xl bg-black px-5 py-2.5 text-sm font-medium text-[#FFB6C1] shadow transition hover:opacity-90"
            >
              <Plus className="h-4 w-4" /> Create your first journal
            </button>
          </div>
        )}

        {/* Shared with me */}
        {!loading && sharedWithMe.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-3 text-lg font-bold">Shared with you</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {sharedWithMe.map((journal) => (
                <Link
                  key={journal.id}
                  href={`/journals/${journal.id}`}
                  className="group flex items-center gap-3 rounded-2xl border border-[#E8E2E4] bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div
                    className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl"
                    style={{ backgroundColor: journal.background_color || '#FFF7F8' }}
                  >
                    {journal.cover_media_url || journal.cover_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={journal.cover_media_url || journal.cover_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-2xl">📖</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{journal.title}</p>
                    <p className="truncate text-xs text-[#6B6B6B]">
                      by {journal.owner?.full_text_name || journal.owner?.username || 'someone'}
                      {journal.can_edit ? ' · can edit' : ''}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>

      <CreateJournalModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => {
          loadJournals();
          router.refresh();
        }}
      />

    </main>
  );
}
