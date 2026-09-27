'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Lock, Pin, Plus, Star } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import type { NoteRow } from '@/app/notes/page';

/**
 * NotesAside — the desktop Notes rail shown beside wide-screen content
 * (feed etc.), hidden below `xl`. Mobile keeps the dedicated /notes page;
 * this aside is a convenience surface, not a second database path: every
 * write goes through the same `notes` table (RLS: user_id = auth.uid()).
 */

function htmlToText(html: string): string {
  if (!html) return '';

  if (typeof window === 'undefined') {
    return html
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/p>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#039;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  const container = document.createElement('div');
  container.innerHTML = html;

  return (container.textContent || container.innerText || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function excerpt(content: string, len = 90): string {
  const text = htmlToText(content);
  return text.length > len ? `${text.slice(0, len)}…` : text;
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
      className="fixed bottom-4 left-4 top-[4.5rem] z-30 hidden w-80 overflow-y-auto xl:block"
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
          <div className="space-y-3">
            {notes.map((note) => (
              <Link
                key={note.id}
                href={`/notes/${note.id}`}
                className="group block overflow-hidden rounded-2xl border border-[#E8E2E4] bg-white p-3.5 shadow-sm transition hover:-translate-y-0.5 hover:border-[#F1DDE2] hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      {note.pinned && (
                        <Pin className="h-3.5 w-3.5 shrink-0 fill-[#E5798F] text-[#E5798F]" />
                      )}
                      <h3 className="min-w-0 truncate text-sm font-bold text-slate-900">
                        {note.title || 'Untitled note'}
                      </h3>
                    </div>

                    <span className="mt-2 inline-flex max-w-full items-center rounded-full bg-[#FFF0F3] px-2.5 py-1 text-[10px] font-semibold capitalize text-[#E5798F]">
                      {note.category || 'general'}
                    </span>
                  </div>

                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#FFF0F3] text-[#E5798F]">
                    <Pin className="h-3.5 w-3.5 fill-current" />
                  </div>
                </div>

                <p className="mt-3 line-clamp-3 min-h-[3.75rem] text-sm leading-5 text-[#6B6B6B]">
                  {excerpt(note.content) || 'Empty note'}
                </p>

                <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#F1ECEE] pt-3">
                  <span className="truncate text-[11px] text-[#9B9B9B]">
                    {(() => {
                      const date = new Date(note.updated_at);
                      if (Number.isNaN(date.getTime())) return '';
                      const diff = Date.now() - date.getTime();
                      if (diff < 60_000) return 'Just now';
                      if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
                      if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
                      if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
                      return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
                    })()}
                  </span>

                  {note.favorite && (
                    <Star className="h-3.5 w-3.5 shrink-0 fill-[#E5798F] text-[#E5798F]" />
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
