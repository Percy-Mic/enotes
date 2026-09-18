'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Archive,
  FileText,
  Loader2,
  Pin,
  Plus,
  Search,
  Star,
  Trash2,
} from 'lucide-react';

import { supabase } from '@/lib/supabase/client';

/**
 * /notes — personal notes list.
 *
 * Database:
 * public.notes
 *
 * Expected columns:
 * - id uuid
 * - user_id uuid
 * - title text
 * - content text
 * - category text
 * - pinned boolean
 * - favorite boolean
 * - archived boolean
 * - created_at timestamptz
 * - updated_at timestamptz
 *
 * IMPORTANT:
 * This page intentionally uses the exact database flag names:
 * pinned / favorite / archived
 *
 * The editor page should use these same names as well.
 */

export interface NoteRow {
  id: string;
  title: string;
  content: string;
  category: string;
  pinned: boolean;
  favorite: boolean;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

const CATEGORIES = [
  'general',
  'personal',
  'ideas',
  'work',
  'school',
  'projects',
  'important',
  'todo',
  'diary',
  'reading',
  'other',
] as const;

type NoteFlag =
  | 'pinned'
  | 'favorite'
  | 'archived';

function normalizeCategory(
  value: string | null | undefined,
): string {
  const category = String(
    value ?? '',
  )
    .trim()
    .toLowerCase();

  return category || 'general';
}

/**
 * Convert the editor's HTML content into readable plain text.
 *
 * The editor can store content such as:
 *
 * <p>Hello <strong>world</strong></p>
 *
 * This prevents the list preview from showing HTML tags.
 */
function htmlToText(
  html: string,
): string {
  if (!html) return '';

  if (
    typeof window ===
    'undefined'
  ) {
    return html
      .replace(
        /<br\s*\/?>/gi,
        ' ',
      )
      .replace(
        /<\/p>/gi,
        ' ',
      )
      .replace(
        /<[^>]*>/g,
        ' ',
      )
      .replace(
        /&nbsp;/gi,
        ' ',
      )
      .replace(
        /&amp;/gi,
        '&',
      )
      .replace(
        /&lt;/gi,
        '<',
      )
      .replace(
        /&gt;/gi,
        '>',
      )
      .replace(
        /&quot;/gi,
        '"',
      )
      .replace(
        /&#039;/gi,
        "'",
      );
  }

  const container =
    document.createElement(
      'div',
    );

  container.innerHTML =
    html;

  return (
    container.textContent ||
    container.innerText ||
    ''
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function excerpt(
  content: string,
  length = 150,
): string {
  const text =
    htmlToText(content);

  if (!text) {
    return '';
  }

  return text.length > length
    ? `${text.slice(
        0,
        length,
      )}…`
    : text;
}

function formatDate(
  iso: string,
): string {
  const date = new Date(iso);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return 'Unknown date';
  }

  return date.toLocaleDateString(
    undefined,
    {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    },
  );
}

function formatRelativeDate(
  iso: string,
): string {
  const date = new Date(iso);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return '';
  }

  const now =
    Date.now();

  const diff =
    now - date.getTime();

  const minute =
    60 * 1000;

  const hour =
    60 * minute;

  const day =
    24 * hour;

  if (diff < minute) {
    return 'Just now';
  }

  if (diff < hour) {
    const minutes =
      Math.floor(
        diff / minute,
      );

    return `${minutes}m ago`;
  }

  if (diff < day) {
    const hours =
      Math.floor(
        diff / hour,
      );

    return `${hours}h ago`;
  }

  if (diff < 7 * day) {
    const days =
      Math.floor(
        diff / day,
      );

    return `${days}d ago`;
  }

  return formatDate(iso);
}

export default function NotesPage() {
  const router =
    useRouter();

  const [
    notes,
    setNotes,
  ] = useState<
    NoteRow[]
  >([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    authed,
    setAuthed,
  ] = useState(false);

  const [
    query,
    setQuery,
  ] = useState('');

  const [
    category,
    setCategory,
  ] = useState('all');

  const [
    showArchived,
    setShowArchived,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState<
    string | null
  >(null);

  const [
    deletingId,
    setDeletingId,
  ] = useState<
    string | null
  >(null);

  const [
    updatingId,
    setUpdatingId,
  ] = useState<
    string | null
  >(null);

  const load =
    useCallback(
      async () => {
        setError(null);

        const {
          data: {
            user,
          },
          error: authError,
        } =
          await supabase.auth.getUser();

        if (authError) {
          setError(
            authError.message,
          );
          setLoading(false);
          return;
        }

        if (!user) {
          router.replace(
            '/auth/sign-in?redirect=%2Fnotes',
          );
          return;
        }

        setAuthed(true);

        const {
          data,
          error: fetchError,
        } =
          await supabase
            .from('notes')
            .select('*')
            .eq(
              'user_id',
              user.id,
            )
            .order(
              'pinned',
              {
                ascending: false,
              },
            )
            .order(
              'updated_at',
              {
                ascending: false,
              },
            )
            .limit(500);

        if (fetchError) {
          console.error(
            'Failed to load notes:',
            fetchError,
          );

          setError(
            fetchError.message,
          );
        } else {
          setNotes(
            (
              data || []
            ) as NoteRow[],
          );
        }

        setLoading(false);
      },
      [router],
    );

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Realtime synchronization.
   *
   * This keeps multiple tabs/windows synchronized.
   */
  useEffect(() => {
    if (!authed) {
      return;
    }

    const channel =
      supabase
        .channel(
          'notes-list-sync',
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'notes',
          },
          () => {
            void load();
          },
        )
        .subscribe();

    return () => {
      void supabase.removeChannel(
        channel,
      );
    };
  }, [
    authed,
    load,
  ]);

  /**
   * Filter visible notes.
   */
  const visible =
    useMemo(() => {
      const search =
        query
          .trim()
          .toLowerCase();

      return notes.filter(
        (note) => {
          /*
           * Normal mode:
           * show only active notes.
           *
           * Archived mode:
           * show only archived notes.
           */
          if (
            showArchived
              ? !note.archived
              : note.archived
          ) {
            return false;
          }

          if (
            category !==
              'all' &&
            normalizeCategory(
              note.category,
            ) !==
              category
          ) {
            return false;
          }

          if (search) {
            const searchable =
              [
                note.title,
                htmlToText(
                  note.content,
                ),
                note.category,
              ]
                .join(' ')
                .toLowerCase();

            if (
              !searchable.includes(
                search,
              )
            ) {
              return false;
            }
          }

          return true;
        },
      );
    }, [
      notes,
      query,
      category,
      showArchived,
    ]);

  const pinned =
    visible.filter(
      (note) =>
        note.pinned,
    );

  const rest =
    visible.filter(
      (note) =>
        !note.pinned,
    );

  /**
   * Optimistic flag update.
   */
  const toggleFlag =
    useCallback(
      async (
        note: NoteRow,
        flag: NoteFlag,
      ) => {
        if (
          updatingId ===
          note.id
        ) {
          return;
        }

        const next =
          !note[flag];

        setError(null);

        setNotes(
          (current) =>
            current.map(
              (item) =>
                item.id ===
                note.id
                  ? {
                      ...item,
                      [flag]:
                        next,
                    }
                  : item,
            ),
        );

        setUpdatingId(
          note.id,
        );

        const {
          data: {
            user,
          },
        } =
          await supabase.auth.getUser();

        if (!user) {
          router.replace(
            '/auth/sign-in?redirect=%2Fnotes',
          );
          return;
        }

        const {
          error:
            updateError,
        } =
          await supabase
            .from('notes')
            .update({
              [flag]:
                next,
            })
            .eq(
              'id',
              note.id,
            )
            .eq(
              'user_id',
              user.id,
            );

        setUpdatingId(
          null,
        );

        if (
          updateError
        ) {
          console.error(
            `Failed to update ${flag}:`,
            updateError,
          );

          setNotes(
            (current) =>
              current.map(
                (item) =>
                  item.id ===
                  note.id
                    ? {
                        ...item,
                        [flag]:
                          !next,
                      }
                    : item,
              ),
          );

          setError(
            `Could not update the note — ${updateError.message}`,
          );
        }
      },
      [
        router,
        updatingId,
      ],
    );

  /**
   * Delete a note permanently.
   */
  const deleteNote =
    useCallback(
      async (
        note: NoteRow,
      ) => {
        if (
          deletingId ===
          note.id
        ) {
          return;
        }

        const confirmed =
          window.confirm(
            `Delete "${note.title || 'Untitled'}" permanently?\n\nThis action cannot be undone.`,
          );

        if (!confirmed) {
          return;
        }

        setError(null);
        setDeletingId(
          note.id,
        );

        /*
         * Remove immediately from the UI.
         */
        const previousNotes =
          notes;

        setNotes(
          (current) =>
            current.filter(
              (item) =>
                item.id !==
                note.id,
            ),
        );

        const {
          data: {
            user,
          },
        } =
          await supabase.auth.getUser();

        if (!user) {
          setNotes(
            previousNotes,
          );

          setDeletingId(
            null,
          );

          router.replace(
            '/auth/sign-in?redirect=%2Fnotes',
          );

          return;
        }

        const {
          error:
            deleteError,
        } =
          await supabase
            .from('notes')
            .delete()
            .eq(
              'id',
              note.id,
            )
            .eq(
              'user_id',
              user.id,
            );

        setDeletingId(
          null,
        );

        if (
          deleteError
        ) {
          console.error(
            'Failed to delete note:',
            deleteError,
          );

          setNotes(
            previousNotes,
          );

          setError(
            `Could not delete the note — ${deleteError.message}`,
          );

          return;
        }
      },
      [
        deletingId,
        notes,
        router,
      ],
    );

  /**
   * Loading screen.
   */
  if (loading) {
    return (
      <main className="min-h-[60dvh] bg-[#FFF7F8]">
        <div className="flex min-h-[60dvh] items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-7 w-7 animate-spin text-[#E5798F]" />

            <p className="text-sm font-medium text-[#9B9B9B]">
              Loading your notes…
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#FFF7F8] text-slate-900">
      <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
        {/* HEADER */}
        <header className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
              Notes
            </h1>

            <p className="mt-1 text-sm text-[#9B9B9B]">
              Capture your thoughts,
              ideas, and important
              things.
            </p>
          </div>

          <Link
            href="/notes/new"
            className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-black px-4 text-sm font-semibold text-[#FFB6C1] shadow-sm transition hover:opacity-90 active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" />

            <span className="hidden sm:inline">
              New note
            </span>

            <span className="sm:hidden">
              New
            </span>
          </Link>
        </header>

        {/* SEARCH */}
        <section className="mt-5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9B9B9B]" />

            <input
              value={query}
              onChange={(
                event,
              ) =>
                setQuery(
                  event.target
                    .value,
                )
              }
              placeholder="Search notes…"
              className="h-11 w-full rounded-xl border border-[#E8E2E4] bg-white pl-10 pr-4 text-sm shadow-sm outline-none transition placeholder:text-[#B8B0B4] focus:border-[#E5798F] focus:ring-2 focus:ring-[#E5798F]/10"
              aria-label="Search notes"
            />
          </div>
        </section>

        {/* FILTERS */}
        <section className="mt-3">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            <button
              type="button"
              onClick={() =>
                setCategory(
                  'all',
                )
              }
              aria-pressed={
                category ===
                'all'
              }
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                category ===
                'all'
                  ? 'bg-[#FFF0F3] text-[#E5798F] ring-1 ring-[#FFD2DE]'
                  : 'border border-[#E8E2E4] bg-white text-[#6B6B6B] hover:bg-gray-50'
              }`}
            >
              All
            </button>

            {CATEGORIES.map(
              (item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() =>
                    setCategory(
                      item,
                    )
                  }
                  aria-pressed={
                    category ===
                    item
                  }
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold capitalize transition ${
                    category ===
                    item
                      ? 'bg-[#FFF0F3] text-[#E5798F] ring-1 ring-[#FFD2DE]'
                      : 'border border-[#E8E2E4] bg-white text-[#6B6B6B] hover:bg-gray-50'
                  }`}
                >
                  {
                    item
                  }
                </button>
              ),
            )}

            <button
              type="button"
              onClick={() =>
                setShowArchived(
                  (value) =>
                    !value,
                )
              }
              aria-pressed={
                showArchived
              }
              className={`ml-auto flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                showArchived
                  ? 'bg-[#FFF0F3] text-[#E5798F] ring-1 ring-[#FFD2DE]'
                  : 'border border-[#E8E2E4] bg-white text-[#6B6B6B] hover:bg-gray-50'
              }`}
            >
              <Archive className="h-3.5 w-3.5" />

              Archived
            </button>
          </div>
        </section>

        {/* ERROR */}
        {error && (
          <div
            role="alert"
            className="mt-4 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-xs text-red-700"
          >
            <span>
              {error}
            </span>

            <button
              type="button"
              onClick={() =>
                setError(
                  null,
                )
              }
              className="shrink-0 font-bold text-red-500 hover:text-red-700"
            >
              ×
            </button>
          </div>
        )}

        {/* RESULT COUNT */}
        {visible.length >
          0 && (
          <div className="mt-5 flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#9B9B9B]">
              {showArchived
                ? 'Archived notes'
                : category !==
                    'all'
                  ? `${category} notes`
                  : 'Your notes'}
            </p>

            <p className="text-xs text-[#9B9B9B]">
              {visible.length}{' '}
              {visible.length ===
              1
                ? 'note'
                : 'notes'}
            </p>
          </div>
        )}

        {/* EMPTY STATE */}
        {visible.length ===
        0 ? (
          <div className="mt-8 rounded-3xl border border-dashed border-[#E8E2E4] bg-white/70 px-6 py-16 text-center shadow-sm">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#FFF0F3]">
              {showArchived ? (
                <Archive className="h-6 w-6 text-[#E5798F]" />
              ) : query ||
                category !==
                  'all' ? (
                <Search className="h-6 w-6 text-[#E5798F]" />
              ) : (
                <FileText className="h-6 w-6 text-[#E5798F]" />
              )}
            </div>

            <p className="mt-4 text-base font-bold">
              {showArchived
                ? 'No archived notes'
                : query ||
                    category !==
                      'all'
                  ? 'No notes match'
                  : 'No notes yet'}
            </p>

            <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-[#6B6B6B]">
              {showArchived
                ? 'Notes you archive will appear here.'
                : query ||
                    category !==
                      'all'
                  ? 'Try another search term or category.'
                  : 'Start writing your first note and keep your thoughts organized.'}
            </p>

            {!showArchived &&
              !query &&
              category ===
                'all' && (
                <Link
                  href="/notes/new"
                  className="mt-5 inline-flex items-center gap-2 rounded-xl bg-black px-5 py-2.5 text-sm font-semibold text-[#FFB6C1] transition hover:opacity-90"
                >
                  <Plus className="h-4 w-4" />
                  Create a note
                </Link>
              )}
          </div>
        ) : (
          <>
            {/* PINNED */}
            {pinned.length >
              0 && (
              <section>
                <h2 className="mt-6 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-[#9B9B9B]">
                  <Pin className="h-3.5 w-3.5" />
                  Pinned
                </h2>

                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {pinned.map(
                    (
                      note,
                    ) => (
                      <NoteCard
                        key={
                          note.id
                        }
                        note={
                          note
                        }
                        onToggle={
                          toggleFlag
                        }
                        onDelete={
                          deleteNote
                        }
                        deleting={
                          deletingId ===
                          note.id
                        }
                        updating={
                          updatingId ===
                          note.id
                        }
                      />
                    ),
                  )}
                </div>
              </section>
            )}

            {/* REST */}
            {rest.length >
              0 && (
              <section>
                {pinned.length >
                  0 && (
                  <h2 className="mt-7 text-xs font-bold uppercase tracking-wide text-[#9B9B9B]">
                    All notes
                  </h2>
                )}

                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {rest.map(
                    (
                      note,
                    ) => (
                      <NoteCard
                        key={
                          note.id
                        }
                        note={
                          note
                        }
                        onToggle={
                          toggleFlag
                        }
                        onDelete={
                          deleteNote
                        }
                        deleting={
                          deletingId ===
                          note.id
                        }
                        updating={
                          updatingId ===
                          note.id
                        }
                      />
                    ),
                  )}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      <style jsx global>{`
        .scrollbar-none {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }

        .scrollbar-none::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </main>
  );
}

function NoteCard({
  note,
  onToggle,
  onDelete,
  deleting,
  updating,
}: {
  note: NoteRow;
  onToggle: (
    note: NoteRow,
    flag: NoteFlag,
  ) => void;
  onDelete: (
    note: NoteRow,
  ) => void;
  deleting: boolean;
  updating: boolean;
}) {
  const category =
    normalizeCategory(
      note.category,
    );

  return (
    <article
      className={`group relative overflow-hidden rounded-2xl border border-[#E8E2E4] bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
        deleting
          ? 'pointer-events-none opacity-60'
          : ''
      }`}
    >
      {/* TOP ACTIONS */}
      <div className="absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded-full bg-white/90 p-0.5 shadow-sm backdrop-blur">
        {/* PIN */}
        <button
          type="button"
          onClick={(
            event,
          ) => {
            event.preventDefault();
            event.stopPropagation();

            onToggle(
              note,
              'pinned',
            );
          }}
          disabled={
            updating ||
            deleting
          }
          aria-label={
            note.pinned
              ? 'Unpin note'
              : 'Pin note'
          }
          aria-pressed={
            note.pinned
          }
          className={`flex h-9 w-9 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-40 ${
            note.pinned
              ? 'bg-[#FFF0F3] text-[#E5798F]'
              : 'text-[#C9C0C4] hover:bg-gray-50 hover:text-[#6B6B6B]'
          }`}
        >
          <Pin
            className={`h-4 w-4 ${
              note.pinned
                ? 'fill-current'
                : ''
            }`}
          />
        </button>

        {/* FAVORITE */}
        <button
          type="button"
          onClick={(
            event,
          ) => {
            event.preventDefault();
            event.stopPropagation();

            onToggle(
              note,
              'favorite',
            );
          }}
          disabled={
            updating ||
            deleting
          }
          aria-label={
            note.favorite
              ? 'Remove from favorites'
              : 'Add to favorites'
          }
          aria-pressed={
            note.favorite
          }
          className={`flex h-9 w-9 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-40 ${
            note.favorite
              ? 'bg-[#FFF0F3] text-[#E5798F]'
              : 'text-[#C9C0C4] hover:bg-gray-50 hover:text-[#6B6B6B]'
          }`}
        >
          <Star
            className={`h-4 w-4 ${
              note.favorite
                ? 'fill-current'
                : ''
            }`}
          />
        </button>

        {/* DELETE */}
        <button
          type="button"
          onClick={(
            event,
          ) => {
            event.preventDefault();
            event.stopPropagation();

            onDelete(note);
          }}
          disabled={
            deleting
          }
          aria-label="Delete note"
          className="flex h-9 w-9 items-center justify-center rounded-full text-[#C9C0C4] transition hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {deleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* CARD LINK */}
      <Link
        href={`/notes/${note.id}`}
        className="block outline-none"
      >
        <div className="pr-28">
          <div className="flex min-w-0 items-center gap-2">
            {note.pinned && (
              <Pin className="h-3.5 w-3.5 shrink-0 fill-[#E5798F] text-[#E5798F]" />
            )}

            <h3 className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900">
              {note.title ||
                'Untitled'}
            </h3>
          </div>

          <span className="mt-2 inline-flex max-w-full items-center rounded-full bg-[#FFF0F3] px-2.5 py-1 text-[10px] font-semibold capitalize text-[#E5798F]">
            {category}
          </span>
        </div>

        {/* CONTENT PREVIEW */}
        <p className="mt-3 line-clamp-3 min-h-[3.75rem] text-sm leading-5 text-[#6B6B6B]">
          {excerpt(
            note.content,
          ) ||
            'Empty note'}
        </p>

        {/* FOOTER */}
        <div className="mt-4 flex items-center justify-between gap-2 border-t border-[#F1ECEE] pt-3">
          <p
            className="truncate text-[11px] text-[#9B9B9B]"
            title={formatDate(
              note.updated_at,
            )}
          >
            {formatRelativeDate(
              note.updated_at,
            )}
          </p>

          <div className="flex shrink-0 items-center gap-2">
            {note.favorite && (
              <Star className="h-3.5 w-3.5 fill-[#E5798F] text-[#E5798F]" />
            )}

            {note.archived && (
              <Archive className="h-3.5 w-3.5 text-[#9B9B9B]" />
            )}
          </div>
        </div>
      </Link>
    </article>
  );
}
