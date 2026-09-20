'use client';

import React, {
  useEffect,
  useState,
} from 'react';

import Link from 'next/link';

import {
  ArrowLeft,
  BookOpen,
  Check,
  Eye,
  Globe,
  Home,
  Lock,
  Palette,
  Save,
  Trash2,
} from 'lucide-react';

import {
  useParams,
  useRouter,
} from 'next/navigation';

import { supabase } from '@/lib/supabase/client';
import { useAlert } from '@/components/ui/Alert';

export default function JournalSettingsPage() {
  const alert = useAlert();
  const params =
    useParams();

  const router =
    useRouter();

  const journalId =
    params?.journalId as string;

  const [
    title,
    setTitle,
  ] = useState('');

  const [
    description,
    setDescription,
  ] = useState('');

  const [
    backgroundColor,
    setBackgroundColor,
  ] = useState(
    '#FFF7F8',
  );

  const [
    visibility,
    setVisibility,
  ] = useState(
    'private',
  );

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    saved,
    setSaved,
  ] = useState(false);

  const [
    deleting,
    setDeleting,
  ] = useState(false);

  /*
   * LOAD
   */

  useEffect(() => {
    if (!journalId) {
      return;
    }

    async function loadJournal() {
      setLoading(true);

      const {
        data,
        error,
      } = await supabase
        .from('journals')
        .select('*')
        .eq(
          'id',
          journalId,
        )
        .single();

      if (error) {
        console.error(
          error,
        );
      }

      if (data) {
        setTitle(
          data.title ||
            '',
        );

        setDescription(
          data.description ||
            data.foreword ||
            '',
        );

        setBackgroundColor(
          data.background_color ||
            '#FFF7F8',
        );

        setVisibility(
          data.visibility ||
            'private',
        );
      }

      setLoading(false);
    }

    loadJournal();
  }, [journalId]);

  /*
   * SAVE
   */

  async function handleUpdate(
    event: React.FormEvent,
  ) {
    event.preventDefault();

    setSaving(true);
    setSaved(false);

    const {
      error,
    } = await supabase
      .from('journals')
      .update({
        title:
          title.trim(),

        description:
          description.trim(),

        background_color:
          backgroundColor,

        visibility,
      })
      .eq(
        'id',
        journalId,
      );

    setSaving(false);

    if (error) {
      void alert({ title: 'Could not save', message: error.message, tone: 'error' });

      return;
    }

    setSaved(true);

    window.setTimeout(
      () => {
        setSaved(false);
      },
      2500,
    );
  }

  /*
   * DELETE
   */

  async function handleDeleteJournal() {
    let confirmed = false;
    await alert({
      title: 'Delete this journal?',
      message: 'The journal and all of its pages will be permanently deleted. This cannot be undone.',
      tone: 'error',
      confirmLabel: 'Delete forever',
      cancelLabel: 'Keep journal',
      onConfirm: () => { confirmed = true; },
    });

    if (!confirmed) {
      return;
    }

    setDeleting(true);

    const {
      error,
    } = await supabase
      .from('journals')
      .delete()
      .eq(
        'id',
        journalId,
      );

    if (error) {
      setDeleting(false);

      void alert({ title: 'Could not delete journal', message: error.message, tone: 'error' });

      return;
    }

    router.push(
      '/journals',
    );
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#B88C5A] text-[#3C2819]">
        <div className="flex items-center gap-3 font-serif">
          <BookOpen className="h-5 w-5" />
          Opening settings…
        </div>
      </main>
    );
  }

  return (
    <main
      className="min-h-screen overflow-x-hidden bg-[#B88C5A] px-3 pb-10 pt-20 text-[#2B211B] sm:px-5"
      style={{
        backgroundImage:
          `
          repeating-linear-gradient(
            0deg,
            rgba(255,255,255,.035) 0,
            rgba(255,255,255,.035) 1px,
            transparent 1px,
            transparent 6px
          ),
          repeating-linear-gradient(
            90deg,
            rgba(70,40,15,.025) 0,
            rgba(70,40,15,.025) 2px,
            transparent 2px,
            transparent 13px
          )
        `,
      }}
    >
      {/* FIXED HEADER */}

      <header className="fixed inset-x-0 top-0 z-50 h-16 border-b-2 border-[#604328] bg-[#EAD7BC] shadow-[0_4px_0_rgba(58,36,20,.25)]">
        <div className="mx-auto flex h-full max-w-5xl items-center justify-between gap-3 px-3 sm:px-5">
          <div className="flex items-center gap-2">
          <Link
            href={`/journals/${journalId}`}
            className="flex items-center gap-2 border-2 border-[#76563A] bg-[#F6E9D5] px-3 py-2 font-serif text-xs font-bold shadow-[2px_2px_0_#8D6D4D]"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">
              Back to Journal
            </span>
          </Link>
          <Link
            href="/feed"
            aria-label="Back to feed"
            className="flex h-9 w-9 items-center justify-center border-2 border-[#76563A] bg-[#F6E9D5] shadow-[2px_2px_0_#8D6D4D]"
          >
            <Home className="h-4 w-4" />
          </Link>
          </div>

          <div className="flex min-w-0 items-center gap-2">
            <BookOpen className="h-5 w-5 shrink-0" />

            <h1 className="truncate font-serif text-lg font-bold sm:text-xl">
              Journal Settings
            </h1>
          </div>

          <div className="w-[100px]" />
        </div>
      </header>

      <div className="mx-auto w-full max-w-5xl">
        {/* INTRO */}

        <section className="mb-6 border-2 border-[#68472D] bg-[#EAD7BC] p-5 shadow-[6px_6px_0_#4C311F] sm:p-7">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center border-2 border-[#76563A] bg-[#F5E5CE] text-xl shadow-[3px_3px_0_#806247]">
              📖
            </div>

            <div>
              <p className="mb-1 text-[10px] uppercase tracking-[.2em] text-[#765D48]">
                Book design
              </p>

              <h2 className="font-serif text-xl font-bold sm:text-2xl">
                {title ||
                  'Untitled Journal'}
              </h2>

              <p className="mt-1 text-xs leading-5 text-[#654B37]">
                Change the identity,
                appearance and privacy
                of your journal.
              </p>
            </div>
          </div>
        </section>

        {/* FORM */}

        <form
          onSubmit={
            handleUpdate
          }
          className="space-y-6"
        >
          {/* BASIC INFORMATION */}

          <section className="border-2 border-[#68472D] bg-[#F4E8D8] p-4 shadow-[6px_6px_0_#4C311F] sm:p-6">
            <div className="mb-5 flex items-center gap-3 border-b-2 border-[#B99C7B] pb-4">
              <BookOpen className="h-5 w-5" />

              <div>
                <h2 className="font-serif text-lg font-bold">
                  Book information
                </h2>

                <p className="text-xs text-[#765D48]">
                  The title and description
                  shown throughout the journal.
                </p>
              </div>
            </div>

            <div className="space-y-5">
              <div>
                <label className="mb-2 block font-serif text-xs font-bold">
                  Journal title
                </label>

                <input
                  type="text"
                  value={title}
                  onChange={(
                    event,
                  ) =>
                    setTitle(
                      event.target
                        .value,
                    )
                  }
                  required
                  className="w-full border-2 border-[#9A8066] bg-[#FFF9EF] px-3 py-3 font-serif text-sm outline-none transition focus:border-[#5D3D26] focus:ring-2 focus:ring-[#B99C7B]/40"
                  placeholder="My Journal"
                />
              </div>

              <div>
                <label className="mb-2 block font-serif text-xs font-bold">
                  Description / foreword
                </label>

                <textarea
                  value={
                    description
                  }
                  onChange={(
                    event,
                  ) =>
                    setDescription(
                      event.target
                        .value,
                    )
                  }
                  rows={5}
                  className="w-full resize-y border-2 border-[#9A8066] bg-[#FFF9EF] px-3 py-3 font-serif text-sm leading-6 outline-none transition focus:border-[#5D3D26] focus:ring-2 focus:ring-[#B99C7B]/40"
                  placeholder="A little introduction to this journal..."
                />
              </div>
            </div>
          </section>

          {/* APPEARANCE */}

          <section className="border-2 border-[#68472D] bg-[#F4E8D8] p-4 shadow-[6px_6px_0_#4C311F] sm:p-6">
            <div className="mb-5 flex items-center gap-3 border-b-2 border-[#B99C7B] pb-4">
              <Palette className="h-5 w-5" />

              <div>
                <h2 className="font-serif text-lg font-bold">
                  Book appearance
                </h2>

                <p className="text-xs text-[#765D48]">
                  Choose the base atmosphere
                  of your journal.
                </p>
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-[auto_1fr]">
              <div>
                <label className="mb-2 block font-serif text-xs font-bold">
                  Background
                </label>

                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={
                      backgroundColor
                    }
                    onChange={(
                      event,
                    ) =>
                      setBackgroundColor(
                        event.target
                          .value,
                      )
                    }
                    className="h-14 w-14 cursor-pointer border-2 border-[#76563A] bg-[#FFF9EF] p-1"
                  />

                  <div>
                    <div className="font-mono text-xs font-bold">
                      {backgroundColor.toUpperCase()}
                    </div>

                    <div className="mt-1 text-[10px] text-[#765D48]">
                      Base journal
                      color
                    </div>
                  </div>
                </div>
              </div>

              {/* LIVE SAMPLE */}

              <div>
                <label className="mb-2 block font-serif text-xs font-bold">
                  Preview
                </label>

                <div
                  className="relative h-28 overflow-hidden border-2 border-[#76563A] shadow-[3px_3px_0_#806247]"
                  style={{
                    backgroundColor:
                      backgroundColor,
                  }}
                >
                  <div className="absolute inset-3 border border-[#806247]/30" />

                  <div className="absolute left-6 top-6 font-serif text-lg font-bold">
                    {title ||
                      'My Journal'}
                  </div>

                  <div className="absolute bottom-5 left-6 right-6 truncate font-serif text-[10px] text-[#765D48]">
                    {description ||
                      'Your journal preview'}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* VISIBILITY */}

          <section className="border-2 border-[#68472D] bg-[#F4E8D8] p-4 shadow-[6px_6px_0_#4C311F] sm:p-6">
            <div className="mb-5 flex items-center gap-3 border-b-2 border-[#B99C7B] pb-4">
              {visibility ===
              'public' ? (
                <Globe className="h-5 w-5" />
              ) : (
                <Lock className="h-5 w-5" />
              )}

              <div>
                <h2 className="font-serif text-lg font-bold">
                  Privacy
                </h2>

                <p className="text-xs text-[#765D48]">
                  Control who can access
                  this journal.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() =>
                  setVisibility(
                    'private',
                  )
                }
                className={`border-2 p-4 text-left transition ${
                  visibility ===
                  'private'
                    ? 'border-[#3C2819] bg-[#EAD7BC] shadow-[3px_3px_0_#5D3D26]'
                    : 'border-[#B99C7B] bg-[#FFF9EF]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Lock className="h-5 w-5" />

                  <div>
                    <div className="font-serif text-sm font-bold">
                      Private
                    </div>

                    <div className="mt-1 text-[10px] leading-4 text-[#765D48]">
                      Only people you allow
                      can view it.
                    </div>
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() =>
                  setVisibility(
                    'public',
                  )
                }
                className={`border-2 p-4 text-left transition ${
                  visibility ===
                  'public'
                    ? 'border-[#3C2819] bg-[#EAD7BC] shadow-[3px_3px_0_#5D3D26]'
                    : 'border-[#B99C7B] bg-[#FFF9EF]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Eye className="h-5 w-5" />

                  <div>
                    <div className="font-serif text-sm font-bold">
                      Public
                    </div>

                    <div className="mt-1 text-[10px] leading-4 text-[#765D48]">
                      Anyone with access to
                      the journal can view it.
                    </div>
                  </div>
                </div>
              </button>
            </div>
          </section>

          {/* SAVE */}

          <section className="border-2 border-[#68472D] bg-[#EAD7BC] p-4 shadow-[6px_6px_0_#4C311F] sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-serif text-sm font-bold">
                  Save journal changes
                </div>

                <div className="text-[10px] text-[#765D48]">
                  Changes will apply to the
                  journal immediately.
                </div>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="flex items-center justify-center gap-2 border-2 border-[#2E1B11] bg-[#3A2518] px-5 py-3 font-serif text-xs font-bold text-[#F5DCC0] shadow-[3px_3px_0_#1E110A] transition hover:bg-[#4A2E1C] active:translate-x-[2px] active:translate-y-[2px] disabled:opacity-50"
              >
                {saved ? (
                  <>
                    <Check className="h-4 w-4" />
                    Saved
                  </>
                ) : saving ? (
                  <>
                    <Save className="h-4 w-4 animate-pulse" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    Save Changes
                  </>
                )}
              </button>
            </div>
          </section>
        </form>

        {/* DANGER ZONE */}

        <section className="mt-8 border-2 border-red-900/30 bg-[#F5DADA] p-4 shadow-[6px_6px_0_rgba(76,30,30,.45)] sm:p-6">
          <div className="mb-5 flex items-center gap-3 border-b-2 border-red-900/20 pb-4">
            <Trash2 className="h-5 w-5 text-red-800" />

            <div>
              <h2 className="font-serif text-lg font-bold text-red-900">
                Danger zone
              </h2>

              <p className="text-xs text-red-800/70">
                Destructive actions cannot be
                undone.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-serif text-sm font-bold text-red-900">
                Delete this journal
              </div>

              <p className="mt-1 max-w-xl text-xs leading-5 text-red-800/70">
                This permanently deletes
                the journal and its pages.
              </p>
            </div>

            <button
              type="button"
              onClick={
                handleDeleteJournal
              }
              disabled={deleting}
              className="flex items-center justify-center gap-2 border-2 border-red-900 bg-red-800 px-4 py-2.5 text-xs font-bold text-white shadow-[3px_3px_0_#4B1717] transition hover:bg-red-900 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />

              {deleting
                ? 'Deleting…'
                : 'Delete Journal'}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}