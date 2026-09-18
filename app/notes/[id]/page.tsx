'use client';

import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Archive,
  Bold,
  Check,
  ChevronDown,
  Code2,
  Highlighter,
  Italic,
  Link2,
  List,
  ListOrdered,
  Lock,
  Palette,
  Pin,
  Redo2,
  Save,
  Share2,
  Strikethrough,
  Trash2,
  Underline,
  Undo2,
  Unlock,
} from 'lucide-react';

import { supabase } from '@/lib/supabase/client';

type NoteRecord = {
  id: string;
  user_id?: string;
  title: string | null;
  content: string | null;
  category: string | null;
  pinned: boolean | null;
  favorite: boolean | null;
  archived: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const DEFAULT_CATEGORY = 'general';
const DEFAULT_CONTENT = '<p>Start writing your thoughts here...</p>';

const CATEGORY_OPTIONS = [
  'general',
  'personal',
  'work',
  'school',
  'ideas',
  'important',
  'todo',
  'journal',
];

function normalizeCategory(category: string | null | undefined) {
  const value = category?.trim().toLowerCase();
  return value || DEFAULT_CATEGORY;
}

function formatDate(value?: string | null) {
  if (!value) return 'Not available';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Not available';
  }

  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function countWords(value: string) {
  const text = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return text ? text.split(' ').length : 0;
}

function countCharacters(value: string) {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;
}

function createDraft(): NoteRecord {
  return {
    id: 'new',
    title: '',
    content: DEFAULT_CONTENT,
    category: DEFAULT_CATEGORY,
    pinned: false,
    favorite: false,
    archived: false,
    created_at: null,
    updated_at: null,
  };
}

function NoteEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const routeId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const isNew = routeId === 'new';

  const titleRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const savingRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const createdRef = useRef(false);
  const realIdRef = useRef<string | null>(null);

  const historyRef = useRef<string[]>([]);
  const futureRef = useRef<string[]>([]);
  const lastHistoryValueRef = useRef('');

  const [note, setNote] = useState<NoteRecord | null>(isNew ? createDraft() : null);
  const noteRef = useRef<NoteRecord | null>(note);

  const [loading, setLoading] = useState(!isNew);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [notice, setNotice] = useState('');
  const [locked, setLocked] = useState(false);
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);
  const [showColorMenu, setShowColorMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editorFocused, setEditorFocused] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);

  const activeId = realIdRef.current || routeId;

  useEffect(() => {
    noteRef.current = note;
  }, [note]);

  const pushHistory = useCallback((html: string) => {
    if (!html || html === lastHistoryValueRef.current) {
      return;
    }

    historyRef.current = [...historyRef.current.slice(-49), html];
    futureRef.current = [];
    lastHistoryValueRef.current = html;
    setHistoryVersion((value) => value + 1);
  }, []);

  const updateNote = useCallback(
    (changes: Partial<NoteRecord>, markAsDirty = true) => {
      setNote((current) => {
        if (!current) return current;

        const updated = {
          ...current,
          ...changes,
        };

        noteRef.current = updated;
        return updated;
      });

      if (markAsDirty) {
        setSaveState('idle');
      }
    },
    [],
  );

  const getEditorHtml = useCallback(() => {
    return editorRef.current?.innerHTML || DEFAULT_CONTENT;
  }, []);

  const getTitle = useCallback(() => {
    return titleRef.current?.value.trim() || '';
  }, []);

  const saveNow = useCallback(async () => {
    const current = noteRef.current;

    if (!current || !mountedRef.current) {
      return;
    }

    if (savingRef.current) {
      pendingSaveRef.current = true;
      return;
    }

    savingRef.current = true;
    pendingSaveRef.current = false;
    setSaveState('saving');

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user) {
        throw new Error('You must be signed in to save notes.');
      }

      const title = getTitle();
      const content = getEditorHtml();
      const category = normalizeCategory(current.category);

      const payload = {
        title,
        content,
        category,
        pinned: Boolean(current.pinned),
        favorite: Boolean(current.favorite),
        archived: Boolean(current.archived),
        updated_at: new Date().toISOString(),
      };

      let savedId = realIdRef.current || current.id;

      if (!savedId || savedId === 'new') {
        const { data, error } = await supabase
          .from('notes')
          .insert({
            user_id: user.id,
            ...payload,
          })
          .select('*')
          .single();

        if (error) {
          throw error;
        }

        savedId = data.id;
        realIdRef.current = data.id;
        createdRef.current = true;

        if (mountedRef.current) {
          setNote(data as NoteRecord);
          noteRef.current = data as NoteRecord;
          router.replace(`/notes/${data.id}`);
        }
      } else {
        const { data, error } = await supabase
          .from('notes')
          .update(payload)
          .eq('id', savedId)
          .eq('user_id', user.id)
          .select('*')
          .single();

        if (error) {
          throw error;
        }

        if (mountedRef.current && data) {
          setNote(data as NoteRecord);
          noteRef.current = data as NoteRecord;
        }
      }

      if (mountedRef.current) {
        setSaveState('saved');
        setNotice('');
      }
    } catch (error) {
      console.error('Unable to save note:', error);

      if (mountedRef.current) {
        setSaveState('error');
        setNotice(
          error instanceof Error
            ? error.message
            : 'Unable to save this note.',
        );
      }
    } finally {
      savingRef.current = false;

      if (pendingSaveRef.current && mountedRef.current) {
        pendingSaveRef.current = false;

        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current);
        }

        saveTimerRef.current = setTimeout(() => {
          void saveNow();
        }, 300);
      }
    }
  }, [getEditorHtml, getTitle, router]);

  const scheduleSave = useCallback(() => {
    setSaveState('idle');

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {
      void saveNow();
    }, 900);
  }, [saveNow]);

  const handleTitleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      updateNote({ title: event.target.value });
      scheduleSave();
    },
    [scheduleSave, updateNote],
  );

  const handleEditorInput = useCallback(() => {
    const html = getEditorHtml();

    pushHistory(html);
    updateNote({ content: html });
    scheduleSave();
  }, [getEditorHtml, pushHistory, scheduleSave, updateNote]);

  const executeCommand = useCallback(
    (command: string, value?: string) => {
      if (locked) return;

      editorRef.current?.focus();

      try {
        document.execCommand(command, false, value);
      } catch (error) {
        console.error(`Command failed: ${command}`, error);
      }

      const html = getEditorHtml();
      pushHistory(html);
      updateNote({ content: html });
      scheduleSave();
    },
    [getEditorHtml, locked, pushHistory, scheduleSave, updateNote],
  );

  const insertLink = useCallback(() => {
    if (locked) return;

    const url = window.prompt('Enter the URL:');

    if (!url?.trim()) return;

    executeCommand('createLink', url.trim());
  }, [executeCommand, locked]);

  const changeTextColor = useCallback(
    (color: string) => {
      executeCommand('foreColor', color);
      setShowColorMenu(false);
    },
    [executeCommand],
  );

  const undo = useCallback(() => {
    if (locked || historyRef.current.length < 2) return;

    const history = [...historyRef.current];
    const current = history.pop();

    if (!current) return;

    futureRef.current = [current, ...futureRef.current];
    const previous = history[history.length - 1];

    historyRef.current = history;
    lastHistoryValueRef.current = previous;

    if (editorRef.current) {
      editorRef.current.innerHTML = previous;
    }

    updateNote({ content: previous });
    scheduleSave();
    setHistoryVersion((value) => value + 1);
  }, [locked, scheduleSave, updateNote]);

  const redo = useCallback(() => {
    if (locked || futureRef.current.length === 0) return;

    const [next, ...remaining] = futureRef.current;

    futureRef.current = remaining;
    historyRef.current = [...historyRef.current, next];
    lastHistoryValueRef.current = next;

    if (editorRef.current) {
      editorRef.current.innerHTML = next;
    }

    updateNote({ content: next });
    scheduleSave();
    setHistoryVersion((value) => value + 1);
  }, [locked, scheduleSave, updateNote]);

  const toggleFlag = useCallback(
    (field: 'pinned' | 'favorite' | 'archived') => {
      if (!noteRef.current || locked) return;

      const currentValue = Boolean(noteRef.current[field]);

      updateNote({
        [field]: !currentValue,
      });

      scheduleSave();
    },
    [locked, scheduleSave, updateNote],
  );

  const changeCategory = useCallback(
    (category: string) => {
      if (locked) return;

      updateNote({
        category: normalizeCategory(category),
      });

      setShowCategoryMenu(false);
      scheduleSave();
    },
    [locked, scheduleSave, updateNote],
  );

  const copyNote = useCallback(async () => {
    const current = noteRef.current;

    if (!current) return;

    const text = `${current.title || 'Untitled note'}\n\n${
      editorRef.current?.innerText || ''
    }`;

    try {
      await navigator.clipboard.writeText(text);
      setNotice('Note copied to your clipboard.');
    } catch {
      setNotice('Unable to copy this note.');
    }
  }, []);

  const shareNote = useCallback(async () => {
    const currentId = realIdRef.current || routeId;

    if (!currentId || currentId === 'new') {
      setNotice('Save the note before sharing it.');
      return;
    }

    const url = `${window.location.origin}/notes/${currentId}`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: noteRef.current?.title || 'My note',
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        setNotice('Note link copied to your clipboard.');
      }
    } catch {
      // Sharing may be cancelled by the user.
    }
  }, [routeId]);

  const deleteNote = useCallback(async () => {
    const currentId = realIdRef.current || routeId;

    if (!currentId || currentId === 'new') {
      router.push('/notes');
      return;
    }

    const confirmed = window.confirm(
      'Delete this note permanently? This action cannot be undone.',
    );

    if (!confirmed) return;

    setDeleting(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new Error('You must be signed in.');
      }

      const { error } = await supabase
        .from('notes')
        .delete()
        .eq('id', currentId)
        .eq('user_id', user.id);

      if (error) {
        throw error;
      }

      router.push('/notes');
    } catch (error) {
      console.error('Unable to delete note:', error);
      setNotice(
        error instanceof Error
          ? error.message
          : 'Unable to delete this note.',
      );
      setDeleting(false);
    }
  }, [routeId, router]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isNew) {
      const draft = createDraft();

      setNote(draft);
      noteRef.current = draft;
      setLoading(false);

      return;
    }

    let cancelled = false;

    async function loadNote() {
      setLoading(true);
      setNotice('');

      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError) {
          throw userError;
        }

        if (!user) {
          router.push('/signin');
          return;
        }

        const { data, error } = await supabase
          .from('notes')
          .select('*')
          .eq('id', routeId)
          .eq('user_id', user.id)
          .single();

        if (error) {
          throw error;
        }

        if (cancelled) return;

        const loadedNote = data as NoteRecord;

        realIdRef.current = loadedNote.id;
        setNote(loadedNote);
        noteRef.current = loadedNote;
      } catch (error) {
        console.error('Unable to load note:', error);

        if (!cancelled) {
          setNotice(
            error instanceof Error
              ? error.message
              : 'Unable to load this note.',
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadNote();

    return () => {
      cancelled = true;
    };
  }, [isNew, routeId, router]);

  useEffect(() => {
    if (!note || !editorRef.current) return;

    const content = note.content || DEFAULT_CONTENT;

    if (editorRef.current.innerHTML !== content) {
      editorRef.current.innerHTML = content;
    }

    if (titleRef.current && titleRef.current.value !== (note.title || '')) {
      titleRef.current.value = note.title || '';
    }

    if (!lastHistoryValueRef.current) {
      lastHistoryValueRef.current = content;
      historyRef.current = [content];
    }
  }, [note]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (saveState === 'idle' && noteRef.current) {
        void saveNow();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [saveNow, saveState]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!editorFocused || locked) return;

      const modifier = event.ctrlKey || event.metaKey;

      if (!modifier) return;

      const key = event.key.toLowerCase();

      if (key === 'b') {
        event.preventDefault();
        executeCommand('bold');
      }

      if (key === 'i') {
        event.preventDefault();
        executeCommand('italic');
      }

      if (key === 'u') {
        event.preventDefault();
        executeCommand('underline');
      }

      if (key === 's') {
        event.preventDefault();
        void saveNow();
      }

      if (key === 'z') {
        event.preventDefault();

        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
      }

      if (key === 'y') {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    editorFocused,
    executeCommand,
    locked,
    redo,
    saveNow,
    undo,
  ]);

  if (loading) {
    return (
      <main className="min-h-screen bg-[#fff7f8] px-4 py-10 text-[#321f2b]">
        <div className="mx-auto flex min-h-[60vh] max-w-5xl items-center justify-center">
          <div className="rounded-3xl border border-[#f1dce3] bg-white px-8 py-10 text-center shadow-sm">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-[#f4d6df] border-t-[#e5798f]" />
            <p className="text-sm text-[#846875]">Loading your note...</p>
          </div>
        </div>
      </main>
    );
  }

  if (!note) {
    return (
      <main className="min-h-screen bg-[#fff7f8] px-4 py-10 text-[#321f2b]">
        <div className="mx-auto max-w-3xl rounded-3xl border border-red-200 bg-white p-8 text-center shadow-sm">
          <p className="mb-5 text-red-600">
            {notice || 'This note could not be found.'}
          </p>

          <Link
            href="/notes"
            className="inline-flex rounded-full bg-[#e5798f] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#d8667e]"
          >
            Back to notes
          </Link>
        </div>
      </main>
    );
  }

  const plainText = editorRef.current?.innerText || '';
  const wordCount = countWords(note.content || '');
  const characterCount = countCharacters(note.content || '');

  return (
    <main className="min-h-screen bg-[#fff7f8] text-[#321f2b]">
      <div className="mx-auto w-full max-w-[1500px] px-3 py-4 sm:px-5 lg:px-8">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-[#f0dce3] bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/notes"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#f0dce3] text-[#805f6d] transition hover:bg-[#fff0f4]"
              aria-label="Back to notes"
            >
              <ChevronDown className="rotate-90" size={18} />
            </Link>

            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b08394]">
                enotes
              </p>

              <p className="truncate text-sm font-semibold text-[#513342]">
                {note.title?.trim() || 'Untitled note'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="hidden text-xs text-[#a07d8b] sm:inline">
              {saveState === 'saving' && 'Saving...'}
              {saveState === 'saved' && 'Saved'}
              {saveState === 'error' && 'Save failed'}
              {saveState === 'idle' && 'Unsaved changes'}
            </span>

            <button
              type="button"
              onClick={() => void saveNow()}
              className="inline-flex items-center gap-2 rounded-full bg-[#e5798f] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#d8667e] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={saveState === 'saving'}
            >
              <Save size={16} />
              Save
            </button>

            <button
              type="button"
              onClick={() => setLocked((value) => !value)}
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold transition ${
                locked
                  ? 'border-[#e5798f] bg-[#fff0f4] text-[#c45470]'
                  : 'border-[#f0dce3] bg-white text-[#805f6d] hover:bg-[#fff0f4]'
              }`}
            >
              {locked ? <Lock size={16} /> : <Unlock size={16} />}
              {locked ? 'Locked' : 'Lock'}
            </button>
          </div>
        </header>

        {notice && (
          <div className="mb-4 flex items-start justify-between gap-4 rounded-2xl border border-[#f0dce3] bg-white px-4 py-3 text-sm text-[#805f6d] shadow-sm">
            <p>{notice}</p>

            <button
              type="button"
              onClick={() => setNotice('')}
              className="font-semibold text-[#c45470]"
            >
              Dismiss
            </button>
          </div>
        )}

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="min-w-0 overflow-hidden rounded-[2rem] border border-[#f0dce3] bg-white shadow-[0_20px_60px_rgba(181,105,130,0.08)]">
            <div className="border-b border-[#f4e5e9] px-5 py-5 sm:px-8">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleFlag('pinned')}
                    disabled={locked}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      note.pinned
                        ? 'border-[#e5798f] bg-[#fff0f4] text-[#c45470]'
                        : 'border-[#f0dce3] text-[#92717f] hover:bg-[#fff7f8]'
                    }`}
                  >
                    <Pin size={14} />
                    {note.pinned ? 'Pinned' : 'Pin'}
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleFlag('favorite')}
                    disabled={locked}
                    className={`rounded-full border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      note.favorite
                        ? 'border-[#e5798f] bg-[#fff0f4] text-[#c45470]'
                        : 'border-[#f0dce3] text-[#92717f] hover:bg-[#fff7f8]'
                    }`}
                  >
                    {note.favorite ? '★ Favorite' : '☆ Favorite'}
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleFlag('archived')}
                    disabled={locked}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      note.archived
                        ? 'border-[#e5798f] bg-[#fff0f4] text-[#c45470]'
                        : 'border-[#f0dce3] text-[#92717f] hover:bg-[#fff7f8]'
                    }`}
                  >
                    <Archive size={14} />
                    {note.archived ? 'Archived' : 'Archive'}
                  </button>
                </div>

                <span className="rounded-full bg-[#fff7f8] px-3 py-2 text-xs font-medium text-[#a07d8b]">
                  {normalizeCategory(note.category)}
                </span>
              </div>

              <input
                ref={titleRef}
                defaultValue={note.title || ''}
                onChange={handleTitleChange}
                disabled={locked}
                placeholder="Untitled note"
                className="w-full border-0 bg-transparent text-3xl font-bold tracking-tight text-[#321f2b] outline-none placeholder:text-[#d7b9c5] disabled:cursor-not-allowed sm:text-4xl"
              />

              <p className="mt-2 text-xs text-[#b18b9a]">
                Last updated: {formatDate(note.updated_at || note.created_at)}
              </p>
            </div>

            <div className="border-b border-[#f4e5e9] bg-[#fffdfd] px-3 py-3 sm:px-5">
              <div className="flex flex-wrap items-center gap-1.5">
                <ToolbarButton
                  label="Undo"
                  disabled={locked || historyRef.current.length < 2}
                  onClick={undo}
                >
                  <Undo2 size={16} />
                </ToolbarButton>

                <ToolbarButton
                  label="Redo"
                  disabled={locked || futureRef.current.length === 0}
                  onClick={redo}
                >
                  <Redo2 size={16} />
                </ToolbarButton>

                <span className="mx-1 hidden h-6 w-px bg-[#f0dce3] sm:block" />

                <ToolbarButton
                  label="Bold"
                  disabled={locked}
                  onClick={() => executeCommand('bold')}
                >
                  <Bold size={16} />
                </ToolbarButton>

                <ToolbarButton
                  label="Italic"
                  disabled={locked}
                  onClick={() => executeCommand('italic')}
                >
                  <Italic size={16} />
                </ToolbarButton>

                <ToolbarButton
                  label="Underline"
                  disabled={locked}
                  onClick={() => executeCommand('underline')}
                >
                  <Underline size={16} />
                </ToolbarButton>

                <ToolbarButton
                  label="Strikethrough"
                  disabled={locked}
                  onClick={() => executeCommand('strikeThrough')}
                >
                  <Strikethrough size={16} />
                </ToolbarButton>

                <span className="mx-1 hidden h-6 w-px bg-[#f0dce3] sm:block" />

                <ToolbarButton
                  label="Heading"
                  disabled={locked}
                  onClick={() => executeCommand('formatBlock', 'h2')}
                >
                  <span className="text-xs font-black">H</span>
                </ToolbarButton>

                <ToolbarButton
                  label="Bulleted list"
                  disabled={locked}
                  onClick={() => executeCommand('insertUnorderedList')}
                >
                  <List size={16} />
                </ToolbarButton>

                <ToolbarButton
                  label="Numbered list"
                  disabled={locked}
                  onClick={() => executeCommand('insertOrderedList')}
                >
                  <ListOrdered size={16} />
                </ToolbarButton>

                <ToolbarButton
                  label="Code"
                  disabled={locked}
                  onClick={() => executeCommand('formatBlock', 'pre')}
                >
                  <Code2 size={16} />
                </ToolbarButton>

                <ToolbarButton
                  label="Quote"
                  disabled={locked}
                  onClick={() => executeCommand('formatBlock', 'blockquote')}
                >
                  <span className="text-base font-bold">“</span>
                </ToolbarButton>

                <ToolbarButton
                  label="Add link"
                  disabled={locked}
                  onClick={insertLink}
                >
                  <Link2 size={16} />
                </ToolbarButton>

                <span className="mx-1 hidden h-6 w-px bg-[#f0dce3] sm:block" />

                <ToolbarButton
                  label="Align left"
                  disabled={locked}
                  onClick={() => executeCommand('justifyLeft')}
                >
                  <AlignLeft size={16} />
                </ToolbarButton>

                <ToolbarButton
                  label="Align center"
                  disabled={locked}
                  onClick={() => executeCommand('justifyCenter')}
                >
                  <AlignCenter size={16} />
                </ToolbarButton>

                <ToolbarButton
                  label="Align right"
                  disabled={locked}
                  onClick={() => executeCommand('justifyRight')}
                >
                  <AlignRight size={16} />
                </ToolbarButton>

                <div className="relative">
                  <ToolbarButton
                    label="Text color"
                    disabled={locked}
                    onClick={() => {
                      setShowColorMenu((value) => !value);
                      setShowCategoryMenu(false);
                    }}
                  >
                    <Palette size={16} />
                  </ToolbarButton>

                  {showColorMenu && (
                    <div className="absolute left-0 top-11 z-30 grid w-40 grid-cols-5 gap-2 rounded-2xl border border-[#f0dce3] bg-white p-3 shadow-xl">
                      {[
                        '#321f2b',
                        '#e5798f',
                        '#805f6d',
                        '#64748b',
                        '#2563eb',
                        '#15803d',
                        '#b45309',
                        '#9333ea',
                        '#dc2626',
                        '#000000',
                      ].map((color) => (
                        <button
                          key={color}
                          type="button"
                          aria-label={`Use ${color}`}
                          onClick={() => changeTextColor(color)}
                          className="h-6 w-6 rounded-full border border-black/10"
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  )}
                </div>

                <ToolbarButton
                  label="Highlight"
                  disabled={locked}
                  onClick={() => {
                    const color = window.prompt(
                      'Enter a highlight color:',
                      '#fff1a8',
                    );

                    if (color) {
                      executeCommand('hiliteColor', color);
                    }
                  }}
                >
                  <Highlighter size={16} />
                </ToolbarButton>
              </div>
            </div>

            <div className="bg-[#fffdfd] px-5 py-6 sm:px-10 sm:py-9">
              <div
                ref={editorRef}
                contentEditable={!locked}
                suppressContentEditableWarning
                onInput={handleEditorInput}
                onFocus={() => setEditorFocused(true)}
                onBlur={() => setEditorFocused(false)}
                onKeyDown={(event) => {
                  if (event.key === 'Tab') {
                    event.preventDefault();
                    executeCommand('insertText', '    ');
                  }
                }}
                className={`note-editor min-h-[420px] w-full max-w-none outline-none sm:min-h-[600px] ${
                  locked ? 'cursor-not-allowed opacity-70' : ''
                }`}
                data-placeholder="Start writing your thoughts..."
              />

              <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-[#f4e5e9] pt-4 text-xs text-[#b18b9a]">
                <span>
                  {wordCount} words · {characterCount} characters
                </span>

                <span>{locked ? 'Read-only mode' : 'Your changes autosave'}</span>
              </div>
            </div>
          </div>

          <aside className="h-fit space-y-4">
            <div className="rounded-3xl border border-[#f0dce3] bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-bold text-[#513342]">Note tools</h2>
                <span className="rounded-full bg-[#fff0f4] px-2 py-1 text-xs text-[#c45470]">
                  Tools
                </span>
              </div>

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={copyNote}
                  className="flex w-full items-center gap-3 rounded-2xl border border-[#f0dce3] px-4 py-3 text-left text-sm font-semibold text-[#805f6d] transition hover:bg-[#fff7f8]"
                >
                  <Check size={17} />
                  Copy note
                </button>

                <button
                  type="button"
                  onClick={() => void shareNote()}
                  className="flex w-full items-center gap-3 rounded-2xl border border-[#f0dce3] px-4 py-3 text-left text-sm font-semibold text-[#805f6d] transition hover:bg-[#fff7f8]"
                >
                  <Share2 size={17} />
                  Share note
                </button>

                <button
                  type="button"
                  onClick={() => setLocked((value) => !value)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-[#f0dce3] px-4 py-3 text-left text-sm font-semibold text-[#805f6d] transition hover:bg-[#fff7f8]"
                >
                  {locked ? <Unlock size={17} /> : <Lock size={17} />}
                  {locked ? 'Unlock editing' : 'Lock editing'}
                </button>
              </div>
            </div>

            <div className="rounded-3xl border border-[#f0dce3] bg-white p-5 shadow-sm">
              <h2 className="mb-3 font-bold text-[#513342]">Category</h2>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    if (!locked) {
                      setShowCategoryMenu((value) => !value);
                      setShowColorMenu(false);
                    }
                  }}
                  disabled={locked}
                  className="flex w-full items-center justify-between rounded-2xl border border-[#f0dce3] px-4 py-3 text-sm font-semibold capitalize text-[#805f6d] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {normalizeCategory(note.category)}
                  <ChevronDown size={16} />
                </button>

                {showCategoryMenu && (
                  <div className="absolute left-0 right-0 top-14 z-20 rounded-2xl border border-[#f0dce3] bg-white p-2 shadow-xl">
                    {CATEGORY_OPTIONS.map((category) => (
                      <button
                        key={category}
                        type="button"
                        onClick={() => changeCategory(category)}
                        className="block w-full rounded-xl px-3 py-2 text-left text-sm capitalize text-[#805f6d] hover:bg-[#fff0f4]"
                      >
                        {category}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-[#f0dce3] bg-white p-5 shadow-sm">
              <h2 className="mb-3 font-bold text-[#513342]">Information</h2>

              <dl className="space-y-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-[#b18b9a]">Words</dt>
                  <dd className="font-semibold text-[#805f6d]">{wordCount}</dd>
                </div>

                <div className="flex items-start justify-between gap-3">
                  <dt className="text-[#b18b9a]">Characters</dt>
                  <dd className="font-semibold text-[#805f6d]">
                    {characterCount}
                  </dd>
                </div>

                <div className="flex items-start justify-between gap-3">
                  <dt className="text-[#b18b9a]">Status</dt>
                  <dd className="font-semibold text-[#805f6d]">
                    {locked ? 'Locked' : 'Editable'}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="rounded-3xl border border-red-100 bg-white p-5 shadow-sm">
              <h2 className="mb-2 font-bold text-red-700">Danger zone</h2>
              <p className="mb-4 text-xs leading-5 text-[#b18b9a]">
                Deleting this note permanently removes it from your account.
              </p>

              <button
                type="button"
                onClick={() => void deleteNote()}
                disabled={deleting}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 size={16} />
                {deleting ? 'Deleting...' : 'Delete note'}
              </button>
            </div>
          </aside>
        </section>
      </div>

      <style jsx global>{`
        .note-editor {
          color: #321f2b;
          font-size: 1.05rem;
          line-height: 1.9;
          overflow-wrap: anywhere;
        }

        .note-editor:empty::before {
          content: attr(data-placeholder);
          color: #d7b9c5;
          pointer-events: none;
        }

        .note-editor p {
          margin: 0 0 1rem;
        }

        .note-editor h1,
        .note-editor h2,
        .note-editor h3 {
          margin: 1.25rem 0 0.75rem;
          font-weight: 800;
          line-height: 1.3;
        }

        .note-editor h1 {
          font-size: 2rem;
        }

        .note-editor h2 {
          font-size: 1.6rem;
        }

        .note-editor h3 {
          font-size: 1.3rem;
        }

        .note-editor ul,
        .note-editor ol {
          margin: 1rem 0;
          padding-left: 1.75rem;
        }

        .note-editor ul {
          list-style: disc;
        }

        .note-editor ol {
          list-style: decimal;
        }

        .note-editor blockquote {
          margin: 1.25rem 0;
          border-left: 4px solid #e5798f;
          padding-left: 1rem;
          color: #805f6d;
          font-style: italic;
        }

        .note-editor pre {
          margin: 1.25rem 0;
          overflow-x: auto;
          border-radius: 1rem;
          background: #321f2b;
          padding: 1rem;
          color: #fff7f8;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
            monospace;
          font-size: 0.9rem;
          line-height: 1.6;
        }

        .note-editor a {
          color: #c45470;
          text-decoration: underline;
        }

        .note-editor strong {
          font-weight: 800;
        }

        .note-editor em {
          font-style: italic;
        }

        .note-editor u {
          text-decoration: underline;
          text-underline-offset: 3px;
        }
      `}</style>
    </main>
  );
}

function ToolbarButton({
  label,
  children,
  onClick,
  disabled = false,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-xl border border-transparent px-2 text-[#805f6d] transition hover:border-[#f0dce3] hover:bg-white disabled:cursor-not-allowed disabled:opacity-35"
    >
      {children}
    </button>
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-[#fff7f8] text-[#805f6d]">
          Loading editor...
        </main>
      }
    >
      <NoteEditorPage />
    </Suspense>
  );
}
