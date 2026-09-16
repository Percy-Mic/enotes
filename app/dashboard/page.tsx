'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BookOpen, LogOut, PenLine, Plus, Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { CreateJournalModal } from '@/components/dashboard/CreateJournalModal';

interface Journal {
  id: string;
  title: string;
  description?: string;
  foreword?: string;
  cover_media_url?: string;
  cover_url?: string;
  background_color?: string;
  created_at: string;
}

interface Profile {
  full_text_name?: string;
  username?: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [journals, setJournals] = useState<Journal[]>([]);
  const [pageCount, setPageCount] = useState<number>(0);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const loadDashboard = useCallback(async () => {
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
        'id, title, description, foreword, cover_media_url, cover_url, background_color, created_at',
      )
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      setJournals([]);
    } else {
      const list = (data || []) as Journal[];
      setJournals(list);

      if (list.length > 0) {
        const { count } = await supabase
          .from('journal_pages')
          .select('id', { count: 'exact', head: true })
          .in(
            'journal_id',
            list.map((j) => j.id),
          );
        setPageCount(count || 0);
      } else {
        setPageCount(0);
      }
    }

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
    loadDashboard();
  }, [loadDashboard]);

  const handleSignOut = async () => {
    setSigningOut(true);
    await supabase.auth.signOut();
    router.replace('/auth/sign-in');
    router.refresh();
  };

  const displayName =
    profile?.full_text_name || profile?.username || email.split('@')[0] || 'friend';

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const stats = [
    { label: 'Journals', value: journals.length },
    { label: 'Pages', value: pageCount },
  ];

  return (
    <main className="min-h-screen bg-[#FFF7F8] px-4 pb-28 pt-6 text-[#111111] sm:px-6 md:pb-16">
      <div className="mx-auto w-full max-w-5xl">
        {/* Header */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">
              {greeting}, {displayName} ♡
            </h1>
            <p className="mt-1 text-sm text-[#6B6B6B]">
              Ready to capture today&apos;s thoughts?
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link
              href="/journals"
              className="rounded-xl border border-[#E8E2E4] bg-white px-3.5 py-2 text-sm font-medium shadow-sm transition hover:bg-gray-50"
            >
              My journals
            </Link>
            <button
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-black px-4 py-2 text-sm font-medium text-[#FFB6C1] shadow transition hover:opacity-90"
            >
              <Plus className="h-4 w-4" /> New journal
            </button>            <button
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

        {loading ? (
          <div className="mt-16 flex flex-col items-center justify-center gap-3 text-[#6B6B6B]">
            <Sparkles className="h-6 w-6 animate-pulse" />
            <p className="text-sm">Preparing your desk…</p>
          </div>
        ) : (
          <>
            {/* Stats */}
            <section className="mt-8 grid grid-cols-2 gap-3 sm:gap-4">
              {stats.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-2xl border border-[#E8E2E4] bg-white p-4 shadow-sm sm:p-5"
                >
                  <p className="text-3xl font-bold sm:text-4xl">{stat.value}</p>
                  <p className="mt-1 text-xs font-medium uppercase tracking-wider text-[#6B6B6B]">
                    {stat.label}
                  </p>
                </div>
              ))}
            </section>

            {/* Quick actions */}
            <section className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                onClick={() => setModalOpen(true)}
                className="flex items-center gap-3 rounded-2xl border border-[#E8E2E4] bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FFF0F3]">
                  <Plus className="h-5 w-5 text-[#E5798F]" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">Start a new journal</span>
                  <span className="block text-xs text-[#6B6B6B]">
                    A fresh book for fresh memories
                  </span>
                </span>
              </button>

              <Link
                href={journals.length > 0 ? `/journals/${journals[0].id}/edit` : '/journals'}
                className="flex items-center gap-3 rounded-2xl border border-[#E8E2E4] bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EEF4FF]">
                  <PenLine className="h-5 w-5 text-[#5B8DEF]" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">Keep writing</span>
                  <span className="block truncate text-xs text-[#6B6B6B]">
                    {journals.length > 0
                      ? `Continue “${journals[0].title}”`
                      : 'Create a journal first'}
                  </span>
                </span>
              </Link>
            </section>

            {/* Recent journals */}
            <section className="mt-10">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-bold">Recent journals</h2>
                {journals.length > 0 && (
                  <Link
                    href="/journals"
                    className="text-sm font-medium text-[#1E90FF] hover:underline"
                  >
                    View all
                  </Link>
                )}
              </div>

              {journals.length === 0 ? (
                <div className="flex flex-col items-center rounded-[20px] border border-dashed border-[#E8E2E4] bg-white/60 px-6 py-12 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#FFF0F3]">
                    <BookOpen className="h-6 w-6 text-[#E5798F]" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold">Nothing here yet</h3>
                  <p className="mt-1 max-w-sm text-sm text-[#6B6B6B]">
                    Your journals will appear here once you create one.
                  </p>
                  <button
                    onClick={() => setModalOpen(true)}
                    className="mt-6 inline-flex items-center gap-1.5 rounded-xl bg-black px-5 py-2.5 text-sm font-medium text-[#FFB6C1] shadow transition hover:opacity-90"
                  >
                    <Plus className="h-4 w-4" /> Create your first journal
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {journals.slice(0, 3).map((journal) => (
                    <Link
                      key={journal.id}
                      href={`/journals/${journal.id}`}
                      className="group flex flex-col overflow-hidden rounded-2xl border border-[#E8E2E4] bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                    >
                      <div
                        className="relative flex h-32 items-center justify-center overflow-hidden"
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
                          <span className="text-4xl">📖</span>
                        )}
                      </div>
                      <div className="p-4">
                        <h3 className="truncate font-semibold">{journal.title}</h3>
                        <p className="mt-1 line-clamp-2 text-sm text-[#6B6B6B]">
                          {journal.description || journal.foreword || 'No description yet.'}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      <CreateJournalModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => {
          loadDashboard();
          router.refresh();
        }}
      />

    </main>
  );
}
