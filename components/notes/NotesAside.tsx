'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Lock, Pin, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import type { NoteRow } from '@/app/notes/page';

/**
 * NotesAside — the desktop Notes rail shown beside wide-screen content
 * (feed etc.), hidden below `xl`. Mobile keeps the dedicated /notes page;
 * this aside is a convenience surface, not a second database path: every
 * write goes through the same `notes` table (RLS: user_id = auth.uid()).
 */

function excerpt(content: string, len = 90): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  return flat.length > len ? `${flat.slice(0, len)}…` : flat;
}

export default function NotesAside() {
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [quick, setQuick] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    setAuthed(true);
    const { data } = await supabase
      .from('notes')
      .select('*')
      .eq('user_id', user.id)
      .eq('archived', false)
      .order('pinned', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(6);
    setNotes((data || []) as NoteRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* realtime: stay in sync with edits made in /notes or another tab */
  useEffect(() => {
    if (!authed) return;
    const channel = supabase
      .channel('notes-aside')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notes' }, () => void load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [authed, load]);

  const createQuickNote = async () => {
    const text = quick.trim();
    if (!text || saving) return;
    setSaving(true);
    const [firstLine, ...restLines] = text.split('\n');
    const { data, error } = await supabase
      .from('notes')
      .insert({
        title: firstLine.slice(0, 120),
        content: restLines.join('\n').trim() || firstLine,
        category: 'general',
        user_id: (await supabase.auth.getUser()).data.user?.id,
      })
      .select('id')
      .maybeSingle();
    setSaving(false);
    if (!error && data) {
      setQuick('');
      void load();
    }
  };

  if (!authed) return null;

  return (
    <aside
      className="fixed bottom-4 right-4 top-[4.5rem] z-30 hidden w-80 overflow-y-auto xl:block"
      aria-label="Quick notes"
    >
      <div className="rounded-2xl border border-[#EDE4E6] bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight text-[#111111]">
            <Lock className="h-3.5 w-3.5 text-[#E5798F]" />
            Your notes
          </h2>
          <Link
            href="/notes"
            className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-[#E5798F] transition hover:bg-[#FDF0F3]"
          >
            <Plus className="h-3.5 w-3.5" />
            All notes
          </Link>
        </div>

        {/* quick capture */}
        <div className="mb-4 rounded-xl border border-[#EDE4E6] bg-[#FFFDF8] p-2">
          <textarea
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void createQuickNote();
            }}
            placeholder="Jot something down…"
            rows={2}
            className="w-full resize-none bg-transparent px-1 py-1 text-sm text-[#111111] outline-none placeholder:text-[#B8AEB2]"
          />
          {quick.trim() && (
            <div className="flex justify-end">
              <button
                onClick={() => void createQuickNote()}
                disabled={saving}
                className="flex items-center gap-1 rounded-full bg-[#E5798F] px-3 py-1 text-xs font-semibold text-white transition hover:bg-[#D96A81] disabled:opacity-60"
              >
                {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                Save note
              </button>
            </div>
          )}
        </div>

        {/* recent notes */}
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-[#B8AEB2]" />
          </div>
        ) : notes.length === 0 ? (
          <p className="py-3 text-center text-xs text-[#6B6B6B]">
            No notes yet — write your first one above.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {notes.map((note) => (
              <li key={note.id}>
                <Link
                  href={`/notes/${note.id}`}
                  className="block rounded-xl px-3 py-2.5 transition hover:bg-[#FDF0F3]"
                >
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-[#111111]">
                    {note.pinned && <Pin className="h-3 w-3 shrink-0 text-[#E5798F]" />}
                    <span className="truncate">{note.title || 'Untitled note'}</span>
                  </span>
                  {(note.content && note.content.trim() !== (note.title || '').trim()) && (
                    <span className="mt-0.5 block truncate text-xs text-[#6B6B6B]">
                      {excerpt(note.content)}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
