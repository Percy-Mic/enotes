'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Archive, Loader2, Pin, Plus, Search, Star } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

/**
 * /notes — personal notes (list view).
 *
 * DB: public.notes (RLS: user_id = auth.uid() — created in migration
 * 2026-09-15_counts_notes_voice_theme.sql). Everything here is the user's
 * own data; there is deliberately no sharing route.
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

const CATEGORIES = ['general', 'ideas', 'work', 'personal', 'reading'] as const;

/** Plain-text excerpt for the card (notes content is plain text). */
function excerpt(content: string, len = 140): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  return flat.length > len ? `${flat.slice(0, len)}…` : flat;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function NotesPage() {
  const router = useRouter();
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.replace('/auth/sign-in?redirect=%2Fnotes');
      return;
    }
    setAuthed(true);
    const { data, error: err } = await supabase
      .from('notes')
      .select('*')
      .eq('user_id', user.id)
      .order('pinned', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(500);
    if (err) setError(err.message);
    else setNotes((data || []) as NoteRow[]);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  /* realtime keeps multiple open tabs in sync */
  useEffect(() => {
    if (!authed) return;
    const channel = supabase
      .channel('notes-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notes' }, () => void load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [authed, load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes.filter((n) => {
      if (showArchived ? !n.archived : n.archived) return false;
      if (category !== 'all' && n.category !== category) return false;
      if (q && !(`${n.title} ${n.content}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [notes, query, category, showArchived]);

  const pinned = visible.filter((n) => n.pinned);
  const rest = visible.filter((n) => !n.pinned);

  const toggleFlag = async (note: NoteRow, flag: 'pinned' | 'favorite' | 'archived') => {
    const next = !note[flag];
    setNotes((list) => list.map((n) => (n.id === note.id ? { ...n, [flag]: next } : n)));
    const { error: err } = await supabase.from('notes').update({ [flag]: next }).eq('id', note.id);
    if (err) {
      setNotes((list) => list.map((n) => (n.id === note.id ? { ...n, [flag]: !next } : n)));
      setError(`Could not update the note — ${err.message}`);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-[60dvh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[#9B9B9B]" />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">Notes</h1>
        <Link
          href="/notes/new"
          className="flex items-center gap-1.5 rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-[#FFB6C1] shadow transition hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> New note
        </Link>
      </div>

      {/* search + filters */}
      <div className="mt-4 space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9B9B9B]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes…"
            className="w-full rounded-xl border border-[#E8E2E4] bg-white py-2.5 pl-9 pr-3 text-sm focus:border-[#E5798F] focus:outline-none"
            aria-label="Search notes"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {['all', ...CATEGORIES].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              aria-pressed={category === c}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold capitalize transition ${
                category === c
                  ? 'bg-[#FFF0F3] text-[#E5798F] ring-1 ring-[#FFD2DE]'
                  : 'border border-[#E8E2E4] bg-white text-[#6B6B6B] hover:bg-gray-50'
              }`}
            >
              {c}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            aria-pressed={showArchived}
            className={`ml-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              showArchived
                ? 'bg-[#FFF0F3] text-[#E5798F] ring-1 ring-[#FFD2DE]'
                : 'border border-[#E8E2E4] bg-white text-[#6B6B6B] hover:bg-gray-50'
            }`}
          >
            <Archive className="h-3.5 w-3.5" /> Archived
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 p-2.5 text-xs text-red-600">{error}</p>
      )}

      {visible.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-[#E8E2E4] bg-white/60 px-6 py-14 text-center">
          <p className="text-sm font-semibold">{query || category !== 'all' ? 'No notes match.' : 'No notes yet'}</p>
          <p className="mt-1 text-sm text-[#6B6B6B]">
            {query || category !== 'all' ? 'Try a different search or filter.' : 'Capture your first thought.'}
          </p>
          {!query && category === 'all' && (
            <Link href="/notes/new" className="mt-4 inline-block rounded-xl bg-black px-5 py-2.5 text-sm font-semibold text-[#FFB6C1]">
              Create a note
            </Link>
          )}
        </div>
      ) : (
        <>
          {pinned.length > 0 && (
            <>
              <h2 className="mt-6 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-[#9B9B9B]">
                <Pin className="h-3.5 w-3.5" /> Pinned
              </h2>
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {pinned.map((n) => (
                  <NoteCard key={n.id} note={n} onToggle={toggleFlag} />
                ))}
              </div>
            </>
          )}
          {rest.length > 0 && (
            <>
              {pinned.length > 0 && (
                <h2 className="mt-6 text-xs font-bold uppercase tracking-wide text-[#9B9B9B]">All notes</h2>
              )}
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {rest.map((n) => (
                  <NoteCard key={n.id} note={n} onToggle={toggleFlag} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}

function NoteCard({ note, onToggle }: { note: NoteRow; onToggle: (n: NoteRow, f: 'pinned' | 'favorite' | 'archived') => void }) {
  return (
    <div className="group relative rounded-2xl border border-[#E8E2E4] bg-white p-4 shadow-sm transition hover:shadow-md">
      <Link href={`/notes/${note.id}`} className="block">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 flex-1 truncate text-sm font-bold">{note.title || 'Untitled'}</h3>
          <span className="shrink-0 rounded-full bg-[#FFF0F3] px-2 py-0.5 text-[10px] font-semibold capitalize text-[#E5798F]">
            {note.category}
          </span>
        </div>
        <p className="mt-1.5 line-clamp-3 min-h-[3.75rem] text-sm leading-5 text-[#6B6B6B]">
          {excerpt(note.content) || 'Empty note'}
        </p>
        <p className="mt-2 text-[11px] text-[#9B9B9B]">{formatDate(note.updated_at)}</p>
      </Link>
      {/* quick flags — 40px touch targets, stop propagation so the card link wins only on direct taps */}
      <div className="absolute right-2 top-2 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 [@media(pointer:coarse)]:opacity-70">
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); onToggle(note, 'pinned'); }}
          aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
          aria-pressed={note.pinned}
          className={`flex h-10 w-10 items-center justify-center rounded-full ${note.pinned ? 'text-[#E5798F]' : 'text-[#C9C0C4] hover:text-[#6B6B6B]'}`}
        >
          <Pin className={`h-4 w-4 ${note.pinned ? 'fill-current' : ''}`} />
        </button>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); onToggle(note, 'favorite'); }}
          aria-label={note.favorite ? 'Remove from favorites' : 'Add to favorites'}
          aria-pressed={note.favorite}
          className={`flex h-10 w-10 items-center justify-center rounded-full ${note.favorite ? 'text-[#E5798F]' : 'text-[#C9C0C4] hover:text-[#6B6B6B]'}`}
        >
          <Star className={`h-4 w-4 ${note.favorite ? 'fill-current' : ''}`} />
        </button>
      </div>
      {note.favorite && (
        <Star className="absolute bottom-3 right-3 h-3.5 w-3.5 fill-[#E5798F] text-[#E5798F] group-hover:opacity-0" />
      )}
    </div>
  );
}
