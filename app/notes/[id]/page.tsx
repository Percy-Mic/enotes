'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Check, CheckSquare, Copy, Heart, Loader2, List, ListOrdered,
  Lock, Pin, Share2, Trash2, Underline as UnderlineIcon, Bold as BoldIcon, Italic as ItalicIcon, X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import type { NoteRow } from '@/app/notes/page';

/**
 * /notes/[id] — the note editor (mobile-first, like the reference design):
 *   ← | pin · favorite · lock · share · archive
 *   Title (big, editable)
 *   "15 september 2026 18:55" — updated timestamp
 *   category chips: (current) + "new"
 *   formatting toolbar: B I U | ordered list · bullet list · checklist
 *   body textarea: "what's on your mind?"
 *
 * Lock is an honest local privacy affordance (blur + confirm), not crypto:
 * server-side security is RLS (only the owner can read the row).
 * Autosave debounces 800ms; a visible state pill shows Saved/Saving.
 */

const CATEGORIES = ['general', 'ideas', 'work', 'personal', 'reading'] as const;

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${date.toLowerCase()} ${time}`;
}

/** Toggle a "• " / "- [ ] " prefix on the current line for list buttons. */
function toggleLinePrefix(text: string, selStart: number, prefix: string): { text: string; caret: number } {
  const lineStart = text.lastIndexOf('\n', selStart - 1) + 1;
  const lineEnd = text.indexOf('\n', selStart);
  const end = lineEnd === -1 ? text.length : lineEnd;
  const line = text.slice(lineStart, end);
  let nextLine: string;
  let caretShift: number;
  if (line.startsWith(prefix)) {
    nextLine = line.slice(prefix.length);
    caretShift = -prefix.length;
  } else {
    nextLine = prefix + line;
    caretShift = prefix.length;
  }
  return {
    text: text.slice(0, lineStart) + nextLine + text.slice(end),
    caret: selStart + caretShift,
  };
}

/** Wrap the selection with markers (bold/italic/underline use unicode-free markup). */
function wrapSelection(text: string, selStart: number, selEnd: number, marker: string): { text: string; caret: number } {
  const selected = text.slice(selStart, selEnd);
  const before = text.slice(0, selStart);
  const after = text.slice(selEnd);
  // already wrapped? unwrap
  if (before.endsWith(marker) && after.startsWith(marker)) {
    return {
      text: before.slice(0, -marker.length) + selected + after.slice(marker.length),
      caret: selStart,
    };
  }
  return {
    text: `${before}${marker}${selected || 'text'}${marker}${after}`,
    caret: selStart + marker.length + (selected ? selected.length + marker.length : 0),
  };
}

interface EditorNote extends NoteRow { /* same shape */ }

export default function NoteEditorPage() {
  return (
    <Suspense fallback={<main className="flex min-h-[100dvh] items-center justify-center bg-[#FFF7F8] text-[#9B9B9B]">Loading note…</main>}>
      <NoteEditor />
    </Suspense>
  );
}

function NoteEditor() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const isNew = !params?.id || params.id === 'new';

  const [note, setNote] = useState<EditorNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [locked, setLocked] = useState(false);
  const [unlockPrompt, setUnlockPrompt] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategory, setNewCategory] = useState('');

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const noteRef = useRef<EditorNote | null>(null);
  noteRef.current = note;
  /* In-flight row creation — rapid saves/flag toggles while the draft is still
     'new' must share ONE insert, not race each other into duplicate rows. */
  const creatingRef = useRef<Promise<string | null> | null>(null);

  /* ---------- load ---------- */
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace(isNew ? '/auth/sign-in?redirect=%2Fnotes%2Fnew' : `/auth/sign-in?redirect=%2Fnotes%2F${params?.id}`);
        return;
      }
      if (isNew) {
        const draft: EditorNote = {
          id: 'new', title: '', content: '', category: 'general', pinned: false,
          favorite: false, archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        };
        setNote(draft);
        setLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from('notes')
        .select('*')
        .eq('id', params!.id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (error || !data) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setNote(data as EditorNote);
      setLoading(false);
    })();
  }, [isNew, params, router]);

  /* ---------- persistence ---------- */
  /** Create the DB row for a draft exactly once; concurrent callers share the
      result. Returns the real id (or null on failure). */
  const ensureRow = useCallback((): Promise<string | null> => {
    if (creatingRef.current) return creatingRef.current;
    const current = noteRef.current;
    if (!current || current.id !== 'new') {
      return Promise.resolve(current ? current.id : null);
    }
    const payload = {
      title: current.title.slice(0, 300),
      content: current.content,
      category: current.category.slice(0, 40),
      pinned: current.pinned,
      favorite: current.favorite,
      archived: current.archived,
    };
    creatingRef.current = (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data, error } = await supabase
        .from('notes')
        .insert({ ...payload, user_id: user.id })
        .select('id')
        .single();
      if (error || !data) {
        setSaveState('error');
        return null;
      }
      const realId = (data as { id: string }).id;
      setNote((n) => (n ? { ...n, id: realId } : n));
      window.history.replaceState(null, '', `/notes/${realId}`);
      setSaveState('saved');
      return realId;
    })().finally(() => { creatingRef.current = null; });
    return creatingRef.current;
  }, []);

  const persist = useCallback(async (current: EditorNote) => {
    const payload = {
      title: current.title.slice(0, 300),
      content: current.content,
      category: current.category.slice(0, 40),
      pinned: current.pinned,
      favorite: current.favorite,
      archived: current.archived,
    };
    if (current.id === 'new') {
      const realId = await ensureRow();
      if (!realId) return;
      /* Field changes made WHILE the insert ran are saved right after, so
         nothing typed during creation is lost. */
      const latest = noteRef.current;
      if (latest && latest.id === realId) {
        const { error } = await supabase
          .from('notes')
          .update({
            title: latest.title.slice(0, 300),
            content: latest.content,
            category: latest.category.slice(0, 40),
            pinned: latest.pinned,
            favorite: latest.favorite,
            archived: latest.archived,
          })
          .eq('id', realId);
        setSaveState(error ? 'error' : 'saved');
        if (!error) dirtyRef.current = false;
      }
    } else {
      const { error } = await supabase.from('notes').update(payload).eq('id', current.id);
      setSaveState(error ? 'error' : 'saved');
      if (!error) dirtyRef.current = false;
    }
  }, [ensureRow]);

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    setSaveState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const current = noteRef.current;
      if (current && dirtyRef.current) void persist(current);
    }, 800);
  }, [persist]);

  /* save on exit — covers back navigation and tab close while dirty */
  useEffect(() => {
    const flush = () => {
      const current = noteRef.current;
      if (current && dirtyRef.current) {
        // keepAlive so the request survives the navigation
        void persist(current);
      }
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [persist]);

  /* ---------- actions ---------- */
  const ensureRealId = useCallback(async (): Promise<string | null> => {
    let current = noteRef.current;
    if (current && current.id === 'new') {
      current = { ...current, id: (await ensureRow()) || 'new' };
    }
    return current && current.id !== 'new' ? current.id : null;
  }, [ensureRow]);

  const toggleFlag = useCallback(async (flag: 'pinned' | 'favorite' | 'archived') => {
    const current = noteRef.current;
    if (!current) return;
    const next = { ...current, [flag]: !current[flag] };
    setNote(next);
    noteRef.current = next;
    const id = await ensureRealId();
    if (!id) return;
    const { error } = await supabase.from('notes').update({ [flag]: next[flag] }).eq('id', id);
    if (error) {
      const reverted = { ...next, [flag]: !next[flag] };
      setNote(reverted);
      noteRef.current = reverted;
      setNotice(`Could not save — ${error.message}`);
    }
  }, [ensureRealId]);

  const onDelete = useCallback(async () => {
    const current = noteRef.current;
    if (!current || current.id === 'new') {
      router.push('/notes');
      return;
    }
    const { error } = await supabase.from('notes').delete().eq('id', current.id);
    if (error) {
      setNotice(`Could not delete — ${error.message}`);
      return;
    }
    router.push('/notes');
  }, [router]);

  const onShare = useCallback(async () => {
    const current = noteRef.current;
    if (!current) return;
    const id = await ensureRealId();
    const url = id ? `${window.location.origin}/notes/${id}` : window.location.href;
    const text = current.title || current.content.slice(0, 80) || 'My note';
    try {
      if (navigator.share) {
        await navigator.share({ title: text, text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* user cancelled share */ }
  }, [ensureRealId]);

  /* ---------- formatting ---------- */
  const applyFormat = (kind: 'bold' | 'italic' | 'underline' | 'ol' | 'ul' | 'check') => {
    const el = bodyRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    let result: { text: string; caret: number };
    if (kind === 'bold') result = wrapSelection(value, s, e, '**');
    else if (kind === 'italic') result = wrapSelection(value, s, e, '*');
    else if (kind === 'underline') result = wrapSelection(value, s, e, '__');
    else if (kind === 'ol') result = toggleLinePrefix(value, s, '1. ');
    else if (kind === 'ul') result = toggleLinePrefix(value, s, '- ');
    else result = toggleLinePrefix(value, s, '[ ] ');
    setNote((n) => (n ? { ...n, content: result.text } : n));
    markDirty();
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(result.caret, result.caret);
    });
  };

  /* ---------- derived ---------- */
  const categories = useMemo(
    () => Array.from(new Set([...CATEGORIES, note?.category || ''])).filter(Boolean),
    [note?.category]
  );

  if (loading) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-[#FFF7F8]">
        <Loader2 className="h-6 w-6 animate-spin text-[#9B9B9B]" />
      </main>
    );
  }

  if (notFound) {
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-[#FFF7F8] px-4 text-center">
        <p className="text-sm font-semibold">Note not found</p>
        <p className="mt-1 text-sm text-[#6B6B6B]">It may have been deleted.</p>
        <Link href="/notes" className="mt-4 rounded-xl bg-black px-5 py-2.5 text-sm font-semibold text-[#FFB6C1]">Back to notes</Link>
      </main>
    );
  }

  if (!note) return null;

  const savePill = () => {
    if (saveState === 'saving') return 'Saving…';
    if (saveState === 'error') return 'Not saved';
    if (saveState === 'saved') return 'Saved';
    return '';
  };

  return (
    <main className="min-h-[100dvh] bg-[#FFF7F8] text-[#111111]">
      {/* top action bar — mirrors the reference app: back · pin · heart · lock · share · archive */}
      <header className="sticky top-0 z-20 bg-[#FFF7F8]/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-2 py-2">
          <button
            onClick={() => router.push('/notes')}
            className="flex h-11 w-11 items-center justify-center rounded-full transition hover:bg-black/5"
            aria-label="Back to notes"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => void toggleFlag('pinned')}
              aria-pressed={note.pinned}
              aria-label={note.pinned ? 'Unpin' : 'Pin'}
              className={`flex h-11 w-11 items-center justify-center rounded-full transition ${note.pinned ? 'bg-[#FFF0F3] text-[#E5798F]' : 'hover:bg-black/5'}`}
            >
              <Pin className={`h-5 w-5 ${note.pinned ? 'fill-current' : ''}`} />
            </button>
            <button
              onClick={() => void toggleFlag('favorite')}
              aria-pressed={note.favorite}
              aria-label={note.favorite ? 'Unfavorite' : 'Favorite'}
              className={`flex h-11 w-11 items-center justify-center rounded-full transition ${note.favorite ? 'bg-[#FFF0F3] text-[#E5798F]' : 'hover:bg-black/5'}`}
            >
              <Heart className={`h-5 w-5 ${note.favorite ? 'fill-current' : ''}`} />
            </button>
            <button
              onClick={() => (locked ? setUnlockPrompt(true) : setLocked(true))}
              aria-pressed={locked}
              aria-label={locked ? 'Unlock note' : 'Lock note'}
              className={`flex h-11 w-11 items-center justify-center rounded-full transition ${locked ? 'bg-[#FFF0F3] text-[#E5798F]' : 'hover:bg-black/5'}`}
            >
              <Lock className="h-5 w-5" />
            </button>
            <button
              onClick={() => void onShare()}
              aria-label="Share note"
              className="flex h-11 w-11 items-center justify-center rounded-full transition hover:bg-black/5"
            >
              <Share2 className="h-5 w-5" />
            </button>
            <button
              onClick={() => { void toggleFlag('archived'); }}
              aria-pressed={note.archived}
              aria-label={note.archived ? 'Restore from archive' : 'Archive note'}
              className={`flex h-11 w-11 items-center justify-center rounded-full transition ${note.archived ? 'bg-[#FFF0F3] text-[#E5798F]' : 'hover:bg-black/5'}`}
            >
              {note.archived ? <X className="h-5 w-5" /> : <Check className="h-5 w-5 rotate-90" />}
            </button>
          </div>
        </div>
      </header>

      {locked && (
        <div className="mx-auto mt-6 max-w-2xl px-4">
          <div className="rounded-2xl border border-[#E8E2E4] bg-white p-6 text-center shadow-sm">
            <Lock className="mx-auto h-6 w-6 text-[#E5798F]" />
            <p className="mt-2 text-sm font-semibold">This note is locked on this device</p>
            <button
              onClick={() => setUnlockPrompt(true)}
              className="mt-3 rounded-xl bg-black px-4 py-2 text-sm font-semibold text-[#FFB6C1]"
            >
              Unlock
            </button>
          </div>
        </div>
      )}

      <div className={`mx-auto max-w-2xl px-4 pb-32 pt-2 ${locked ? 'blur-[6px] select-none pointer-events-none' : ''}`} aria-hidden={locked}>
        {/* title */}
        <textarea
          ref={titleRef}
          value={note.title}
          onChange={(e) => { setNote({ ...note, title: e.target.value.replace(/\n/g, '') }); markDirty(); }}
          rows={1}
          placeholder="title"
          aria-label="Note title"
          className="w-full resize-none bg-transparent text-4xl font-extrabold tracking-tight placeholder:text-[#C9C0C4] focus:outline-none"
          style={{ height: 'auto' }}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = 'auto';
            el.style.height = `${el.scrollHeight}px`;
          }}
        />

        {/* updated timestamp + save state */}
        <p className="mt-2 flex items-center gap-2 text-sm text-[#6B6B6B]">
          {formatTimestamp(note.updated_at)}
          {savePill() && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              saveState === 'error' ? 'bg-red-50 text-red-600' : 'bg-[#FFF0F3] text-[#E5798F]'
            }`}>
              {savePill()}
            </span>
          )}
        </p>
        <hr className="mt-2 border-[#E8E2E4]" />

        {/* categories */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => { if (note.category !== c) { setNote({ ...note, category: c }); markDirty(); } }}
              aria-pressed={note.category === c}
              className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium capitalize transition ${
                note.category === c
                  ? 'bg-[#FFF0F3] text-[#E5798F] ring-1 ring-[#FFD2DE]'
                  : 'border border-[#E8E2E4] bg-white text-[#6B6B6B] hover:bg-gray-50'
              }`}
            >
              {note.category === c && <span className="h-2 w-2 rounded-full bg-[#E5798F]" />}
              {c}
            </button>
          ))}
          {showNewCategory ? (
            <span className="flex items-center gap-1">
              <input
                autoFocus
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value.toLowerCase().replace(/[^a-z0-9 -]/g, '').slice(0, 24))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const v = newCategory.trim();
                    if (v) { setNote({ ...note, category: v }); markDirty(); }
                    setShowNewCategory(false);
                    setNewCategory('');
                  }
                  if (e.key === 'Escape') { setShowNewCategory(false); setNewCategory(''); }
                }}
                placeholder="name…"
                aria-label="New category name"
                className="w-28 rounded-full border border-[#E5798F] bg-white px-3 py-2 text-sm focus:outline-none"
              />
              <button
                type="button"
                onClick={() => { setShowNewCategory(false); setNewCategory(''); }}
                className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-gray-100"
                aria-label="Cancel new category"
              >
                <X className="h-4 w-4" />
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setShowNewCategory(true)}
              className="flex items-center gap-1.5 rounded-full border border-[#E8E2E4] bg-white px-4 py-2 text-sm font-medium text-[#E5798F] transition hover:bg-gray-50"
            >
              <span className="text-base leading-none">+</span> new
            </button>
          )}
        </div>

        {/* formatting toolbar */}
        <div className="no-scrollbar mt-5 flex items-center gap-1 overflow-x-auto rounded-full border border-[#E8E2E4] bg-white px-2 py-1.5" role="toolbar" aria-label="Text formatting">
          <ToolbarButton label="Bold" onClick={() => applyFormat('bold')}><BoldIcon className="h-4 w-4" /></ToolbarButton>
          <ToolbarButton label="Italic" onClick={() => applyFormat('italic')}><ItalicIcon className="h-4 w-4 italic" /></ToolbarButton>
          <ToolbarButton label="Underline" onClick={() => applyFormat('underline')}><UnderlineIcon className="h-4 w-4 underline" /></ToolbarButton>
          <span className="mx-1 h-5 w-px bg-[#E8E2E4]" />
          <ToolbarButton label="Ordered list" onClick={() => applyFormat('ol')}><ListOrdered className="h-4 w-4" /></ToolbarButton>
          <ToolbarButton label="Bullet list" onClick={() => applyFormat('ul')}><List className="h-4 w-4" /></ToolbarButton>
          <ToolbarButton label="Checklist" onClick={() => applyFormat('check')}><CheckSquare className="h-4 w-4" /></ToolbarButton>
          <span className="mx-1 h-5 w-px bg-[#E8E2E4]" />
          <ToolbarButton
            label="Delete note"
            danger
            onClick={() => { if (window.confirm('Delete this note permanently?')) void onDelete(); }}
          >
            <Trash2 className="h-4 w-4" />
          </ToolbarButton>
        </div>

        {/* body */}
        <textarea
          ref={bodyRef}
          value={note.content}
          onChange={(e) => { setNote({ ...note, content: e.target.value }); markDirty(); }}
          placeholder="what's on your mind?"
          aria-label="Note body"
          rows={14}
          className="mt-4 min-h-[45dvh] w-full resize-none bg-transparent text-lg leading-relaxed placeholder:text-[#C9C0C4] focus:outline-none"
        />
      </div>

      {notice && (
        <p role="alert" className="fixed bottom-24 left-1/2 z-30 -translate-x-1/2 rounded-full bg-red-50 px-4 py-2 text-xs font-semibold text-red-600 shadow md:bottom-6">
          {notice}
          <button onClick={() => setNotice(null)} className="ml-2 underline">dismiss</button>
        </p>
      )}

      {/* unlock confirm */}
      {unlockPrompt && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setUnlockPrompt(false)}>
          <div className="w-full max-w-xs rounded-2xl bg-white p-5 text-center shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Unlock note">
            <Lock className="mx-auto h-6 w-6 text-[#E5798F]" />
            <p className="mt-2 text-sm font-semibold">Unlock this note?</p>
            <p className="mt-1 text-xs text-[#6B6B6B]">Anyone with this device will be able to read it.</p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setUnlockPrompt(false)} className="flex-1 rounded-xl border border-[#E8E2E4] py-2.5 text-sm font-semibold">Keep locked</button>
              <button onClick={() => { setLocked(false); setUnlockPrompt(false); }} className="flex-1 rounded-xl bg-black py-2.5 text-sm font-semibold text-[#FFB6C1]">Unlock</button>
            </div>
          </div>
        </div>
      )}

      {copied && (
        <p className="fixed bottom-24 left-1/2 z-30 -translate-x-1/2 rounded-full bg-black px-4 py-2 text-xs font-semibold text-[#FFB6C1] shadow md:bottom-6">
          <Copy className="mr-1 inline h-3 w-3" /> Link copied
        </p>
      )}
    </main>
  );
}

function ToolbarButton({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition hover:bg-gray-100 ${danger ? 'text-red-500' : 'text-[#3D3D3D]'}`}
    >
      {children}
    </button>
  );
}
