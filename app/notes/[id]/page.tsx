```tsx
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
  ArrowLeft,
  Bold as BoldIcon,
  Check,
  CheckSquare,
  Copy,
  Heart,
  Italic as ItalicIcon,
  List,
  ListOrdered,
  Loader2,
  Lock,
  Pin,
  Redo2,
  Share2,
  Trash2,
  Underline as UnderlineIcon,
  Undo2,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import type { NoteRow } from '@/app/notes/page';

const CATEGORIES = [
  'general',
  'ideas',
  'work',
  'personal',
  'reading',
] as const;

const MAX_TITLE_LENGTH = 300;
const MAX_CATEGORY_LENGTH = 40;
const AUTOSAVE_DELAY = 800;
const MAX_HISTORY = 100;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

type Notice = {
  type: 'error' | 'success' | 'info';
  title: string;
  message: string;
};

type FormatKind =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'ol'
  | 'ul'
  | 'check';

interface EditorNote extends NoteRow {}

interface HistorySnapshot {
  title: string;
  content: string;
  category: string;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);

  if (Number.isNaN(d.getTime())) {
    return '';
  }

  const date = d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const time = d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return `${date.toLowerCase()} ${time}`;
}

function normalizeCategory(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 -]/g, '')
    .slice(0, MAX_CATEGORY_LENGTH);
}

function clampCaret(value: string, position: number): number {
  return Math.max(0, Math.min(position, value.length));
}

/**
 * Applies a prefix to every selected/current line.
 *
 * Examples:
 *   hello
 *   world
 *
 * becomes:
 *   - hello
 *   - world
 */
function toggleBlockPrefix(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  prefix: string,
): {
  text: string;
  selectionStart: number;
  selectionEnd: number;
} {
  const startLineStart =
    text.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1;

  let endLineEnd = text.indexOf('\n', selectionEnd);

  if (endLineEnd === -1) {
    endLineEnd = text.length;
  }

  const block = text.slice(startLineStart, endLineEnd);
  const lines = block.split('\n');

  const allPrefixed =
    lines.length > 0 &&
    lines.every((line) => {
      if (!line.trim()) return true;
      return line.startsWith(prefix);
    });

  const nextLines = lines.map((line) => {
    if (!line.trim()) return line;

    if (allPrefixed && line.startsWith(prefix)) {
      return line.slice(prefix.length);
    }

    return prefix + line;
  });

  const nextBlock = nextLines.join('\n');

  const nextText =
    text.slice(0, startLineStart) +
    nextBlock +
    text.slice(endLineEnd);

  const lengthDelta = nextBlock.length - block.length;

  const nextSelectionStart = clampCaret(
    nextText,
    selectionStart + (allPrefixed ? lengthDelta : 0),
  );

  const nextSelectionEnd = clampCaret(
    nextText,
    selectionEnd + lengthDelta,
  );

  return {
    text: nextText,
    selectionStart: nextSelectionStart,
    selectionEnd: nextSelectionEnd,
  };
}

/**
 * Wraps selected text with Markdown-like markers.
 *
 * Empty selection:
 *   **text**
 *
 * Existing wrapped selection:
 *   **hello** -> hello
 */
function wrapSelection(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  marker: string,
): {
  text: string;
  selectionStart: number;
  selectionEnd: number;
} {
  const selected = text.slice(selectionStart, selectionEnd);

  const before = text.slice(0, selectionStart);
  const after = text.slice(selectionEnd);

  if (
    selected &&
    before.endsWith(marker) &&
    after.startsWith(marker)
  ) {
    const nextText =
      before.slice(0, -marker.length) +
      selected +
      after.slice(marker.length);

    const nextStart = selectionStart - marker.length;
    const nextEnd = selectionEnd - marker.length;

    return {
      text: nextText,
      selectionStart: nextStart,
      selectionEnd: nextEnd,
    };
  }

  if (!selected) {
    const placeholder = 'text';
    const inserted = `${marker}${placeholder}${marker}`;

    return {
      text: `${before}${inserted}${after}`,
      selectionStart: selectionStart + marker.length,
      selectionEnd: selectionStart + marker.length + placeholder.length,
    };
  }

  const inserted = `${marker}${selected}${marker}`;

  return {
    text: `${before}${inserted}${after}`,
    selectionStart: selectionStart + marker.length,
    selectionEnd:
      selectionStart + marker.length + selected.length,
  };
}

function createSnapshot(note: EditorNote | null): HistorySnapshot | null {
  if (!note) return null;

  return {
    title: note.title,
    content: note.content,
    category: note.category,
  };
}

function snapshotsEqual(
  a: HistorySnapshot | null,
  b: HistorySnapshot | null,
): boolean {
  if (!a || !b) return false;

  return (
    a.title === b.title &&
    a.content === b.content &&
    a.category === b.category
  );
}

function safeLocalStorageGet(key: string): string | null {
  if (typeof window === 'undefined') return null;

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Local storage can be unavailable in private/restricted browsers.
  }
}

function safeLocalStorageRemove(key: string): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage errors.
  }
}

export default function NoteEditorPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-[100dvh] items-center justify-center bg-[#FFF7F8] text-[#9B9B9B]">
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading note…
          </div>
        </main>
      }
    >
      <NoteEditor />
    </Suspense>
  );
}

function NoteEditor() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const initialRouteIdRef = useRef<string>(
    typeof params?.id === 'string' ? params.id : 'new',
  );

  const isNew = initialRouteIdRef.current === 'new';

  const [note, setNote] = useState<EditorNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [saveState, setSaveState] =
    useState<SaveState>('idle');

  const [locked, setLocked] = useState(false);
  const [unlockPrompt, setUnlockPrompt] = useState(false);

  const [notice, setNotice] = useState<Notice | null>(null);
  const [copied, setCopied] = useState(false);

  const [showNewCategory, setShowNewCategory] =
    useState(false);

  const [newCategory, setNewCategory] = useState('');

  const [deletePrompt, setDeletePrompt] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [historyVersion, setHistoryVersion] = useState(0);

  const titleRef =
    useRef<HTMLTextAreaElement>(null);

  const bodyRef =
    useRef<HTMLTextAreaElement>(null);

  const saveTimer =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const copiedTimer =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const noticeTimer =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const dirtyRef = useRef(false);

  const noteRef =
    useRef<EditorNote | null>(null);

  const creatingRef =
    useRef<Promise<string | null> | null>(null);

  const realNoteIdRef =
    useRef<string | null>(
      initialRouteIdRef.current !== 'new'
        ? initialRouteIdRef.current
        : null,
    );

  const saveVersionRef =
    useRef(0);

  const saveInFlightRef =
    useRef<Promise<void> | null>(null);

  const mountedRef =
    useRef(true);

  const historyInitializedRef =
    useRef(false);

  const undoStackRef =
    useRef<HistorySnapshot[]>([]);

  const redoStackRef =
    useRef<HistorySnapshot[]>([]);

  noteRef.current = note;

  /* -------------------------------------------------------
     Lifecycle
  ------------------------------------------------------- */

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  /* -------------------------------------------------------
     Load note
  ------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (cancelled) return;

      if (!user) {
        const redirect = isNew
          ? '/auth/sign-in?redirect=%2Fnotes%2Fnew'
          : `/auth/sign-in?redirect=%2Fnotes%2F${encodeURIComponent(
              initialRouteIdRef.current,
            )}`;

        router.replace(redirect);
        return;
      }

      if (isNew) {
        const now = new Date().toISOString();

        const draft: EditorNote = {
          id: 'new',
          title: '',
          content: '',
          category: 'general',
          pinned: false,
          favorite: false,
          archived: false,
          created_at: now,
          updated_at: now,
        };

        if (cancelled) return;

        setNote(draft);
        noteRef.current = draft;

        historyInitializedRef.current = true;
        undoStackRef.current = [];
        redoStackRef.current = [];

        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('notes')
        .select('*')
        .eq('id', initialRouteIdRef.current)
        .eq('user_id', user.id)
        .maybeSingle();

      if (cancelled) return;

      if (error || !data) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      const loadedNote = data as EditorNote;

      setNote(loadedNote);
      noteRef.current = loadedNote;

      historyInitializedRef.current = true;
      undoStackRef.current = [];
      redoStackRef.current = [];

      setLoading(false);
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [isNew, router]);

  /* -------------------------------------------------------
     Restore local lock state
  ------------------------------------------------------- */

  useEffect(() => {
    if (!note) return;

    const id =
      realNoteIdRef.current ||
      (note.id !== 'new' ? note.id : null);

    if (!id) return;

    const key = `enotes:note-lock:${id}`;
    const stored = safeLocalStorageGet(key);

    if (stored === '1') {
      setLocked(true);
    }
  }, [note]);

  /* -------------------------------------------------------
     Auto-size title
  ------------------------------------------------------- */

  const resizeTitle = useCallback(() => {
    const el = titleRef.current;
    if (!el) return;

    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    if (!loading && note) {
      requestAnimationFrame(resizeTitle);
    }
  }, [loading, note?.title, resizeTitle]);

  /* -------------------------------------------------------
     Notice helper
  ------------------------------------------------------- */

  const showNotice = useCallback(
    (next: Notice, duration = 5000) => {
      if (noticeTimer.current) {
        clearTimeout(noticeTimer.current);
      }

      setNotice(next);

      if (duration > 0) {
        noticeTimer.current = setTimeout(() => {
          if (mountedRef.current) {
            setNotice(null);
          }
        }, duration);
      }
    },
    [],
  );

  /* -------------------------------------------------------
     Database payload
  ------------------------------------------------------- */

  const toPayload = useCallback(
    (current: EditorNote) => ({
      title: current.title
        .slice(0, MAX_TITLE_LENGTH),

      content: current.content,

      category: current.category
        .slice(0, MAX_CATEGORY_LENGTH),

      pinned: Boolean(current.pinned),
      favorite: Boolean(current.favorite),
      archived: Boolean(current.archived),
    }),
    [],
  );

  /* -------------------------------------------------------
     History
  ------------------------------------------------------- */

  const pushHistory = useCallback(
    (previous: EditorNote | null) => {
      if (!historyInitializedRef.current) return;

      const snapshot = createSnapshot(previous);
      if (!snapshot) return;

      const last =
        undoStackRef.current[
          undoStackRef.current.length - 1
        ] || null;

      if (snapshotsEqual(last, snapshot)) {
        return;
      }

      undoStackRef.current.push(snapshot);

      if (
        undoStackRef.current.length >
        MAX_HISTORY
      ) {
        undoStackRef.current.shift();
      }

      redoStackRef.current = [];
      setHistoryVersion((v) => v + 1);
    },
    [],
  );

  const applySnapshot = useCallback(
    (
      snapshot: HistorySnapshot,
      current: EditorNote,
    ) => {
      const next: EditorNote = {
        ...current,
        title: snapshot.title,
        content: snapshot.content,
        category: snapshot.category,
      };

      noteRef.current = next;
      setNote(next);

      resizeTitle();

      saveVersionRef.current += 1;
      dirtyRef.current = true;
      setSaveState('saving');

      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }

      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        void saveNowRef.current?.();
      }, AUTOSAVE_DELAY);
    },
    [resizeTitle],
  );

  const undo = useCallback(() => {
    const current = noteRef.current;

    if (!current) return;

    const snapshot =
      undoStackRef.current.pop();

    if (!snapshot) return;

    const currentSnapshot =
      createSnapshot(current);

    if (currentSnapshot) {
      redoStackRef.current.push(
        currentSnapshot,
      );
    }

    applySnapshot(snapshot, current);

    setHistoryVersion((v) => v + 1);

    requestAnimationFrame(() => {
      bodyRef.current?.focus();
    });
  }, [applySnapshot]);

  const redo = useCallback(() => {
    const current = noteRef.current;

    if (!current) return;

    const snapshot =
      redoStackRef.current.pop();

    if (!snapshot) return;

    const currentSnapshot =
      createSnapshot(current);

    if (currentSnapshot) {
      undoStackRef.current.push(
        currentSnapshot,
      );
    }

    applySnapshot(snapshot, current);

    setHistoryVersion((v) => v + 1);

    requestAnimationFrame(() => {
      bodyRef.current?.focus();
    });
  }, [applySnapshot]);

  /* -------------------------------------------------------
     Create row
  ------------------------------------------------------- */

  const ensureRow = useCallback(
    async (): Promise<string | null> => {
      if (realNoteIdRef.current) {
        return realNoteIdRef.current;
      }

      if (creatingRef.current) {
        return creatingRef.current;
      }

      const current = noteRef.current;

      if (!current) {
        return null;
      }

      if (current.id !== 'new') {
        realNoteIdRef.current = current.id;
        return current.id;
      }

      const payload = toPayload(current);

      const creation =
        (async (): Promise<string | null> => {
          const {
            data: { user },
          } = await supabase.auth.getUser();

          if (!user) {
            setSaveState('error');

            showNotice({
              type: 'error',
              title: 'Sign-in required',
              message:
                'Your note could not be saved because your session has ended.',
            });

            return null;
          }

          const { data, error } =
            await supabase
              .from('notes')
              .insert({
                ...payload,
                user_id: user.id,
              })
              .select('id, created_at, updated_at')
              .single();

          if (error || !data) {
            setSaveState('error');

            showNotice({
              type: 'error',
              title: 'Could not create note',
              message:
                error?.message ||
                'The note could not be created. Your changes remain on this screen.',
            });

            return null;
          }

          const realId =
            (data as { id: string }).id;

          realNoteIdRef.current = realId;

          const latest = noteRef.current;

          if (latest) {
            const updated: EditorNote = {
              ...latest,
              id: realId,
              ...(data as Partial<EditorNote>),
            };

            noteRef.current = updated;

            if (mountedRef.current) {
              setNote(updated);
            }
          }

          if (mountedRef.current) {
            router.replace(`/notes/${realId}`);
          }

          return realId;
        })();

      creatingRef.current = creation;

      void creation.finally(() => {
        if (
          creatingRef.current === creation
        ) {
          creatingRef.current = null;
        }
      });

      return creation;
    },
    [router, showNotice, toPayload],
  );

  /* -------------------------------------------------------
     Save worker
  ------------------------------------------------------- */

  const saveNow = useCallback(
    async (): Promise<void> => {
      if (saveInFlightRef.current) {
        return saveInFlightRef.current;
      }

      const run = (async () => {
        while (dirtyRef.current) {
          const current = noteRef.current;

          if (!current) {
            return;
          }

          const versionBeingSaved =
            saveVersionRef.current;

          if (mountedRef.current) {
            setSaveState('saving');
          }

          let realId =
            realNoteIdRef.current;

          if (!realId) {
            if (current.id === 'new') {
              realId = await ensureRow();
            } else {
              realId = current.id;
              realNoteIdRef.current =
                current.id;
            }
          }

          if (!realId) {
            return;
          }

          const latest = noteRef.current;

          if (!latest) {
            return;
          }

          const payload =
            toPayload(latest);

          const updatedAt =
            new Date().toISOString();

          const { error } =
            await supabase
              .from('notes')
              .update({
                ...payload,
                updated_at: updatedAt,
              })
              .eq('id', realId);

          if (error) {
            if (mountedRef.current) {
              setSaveState('error');

              showNotice({
                type: 'error',
                title: 'Changes not saved',
                message:
                  error.message ||
                  'Please check your connection and try again.',
              });
            }

            return;
          }

          const afterSave =
            noteRef.current;

          if (
            afterSave &&
            afterSave.id === realId
          ) {
            const refreshed = {
              ...afterSave,
              updated_at: updatedAt,
            };

            noteRef.current =
              refreshed;

            if (mountedRef.current) {
              setNote(refreshed);
            }
          }

          if (
            saveVersionRef.current ===
            versionBeingSaved
          ) {
            dirtyRef.current = false;

            if (mountedRef.current) {
              setSaveState('saved');
            }

            return;
          }

          if (mountedRef.current) {
            setSaveState('saving');
          }
        }
      })()
        .catch((error: unknown) => {
          const message =
            error instanceof Error
              ? error.message
              : 'An unexpected save error occurred.';

          if (mountedRef.current) {
            setSaveState('error');

            showNotice({
              type: 'error',
              title: 'Could not save',
              message,
            });
          }
        })
        .finally(() => {
          saveInFlightRef.current =
            null;
        });

      saveInFlightRef.current = run;

      return run;
    },
    [ensureRow, showNotice, toPayload],
  );

  /*
   * Ref is used by history helpers so they can schedule
   * saves without creating circular callback dependencies.
   */
  const saveNowRef =
    useRef<(() => Promise<void>) | null>(null);

  saveNowRef.current = saveNow;

  /* -------------------------------------------------------
     Autosave
  ------------------------------------------------------- */

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
    }

    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;

      void saveNow();
    }, AUTOSAVE_DELAY);
  }, [saveNow]);

  const markDirty = useCallback(() => {
    saveVersionRef.current += 1;
    dirtyRef.current = true;

    if (mountedRef.current) {
      setSaveState('saving');
    }

    scheduleSave();
  }, [scheduleSave]);

  /* -------------------------------------------------------
     Update note with history
  ------------------------------------------------------- */

  const updateNote = useCallback(
    (
      updater:
        | Partial<EditorNote>
        | ((current: EditorNote) => EditorNote),
      options?: {
        history?: boolean;
      },
    ) => {
      const current =
        noteRef.current;

      if (!current) return;

      const next =
        typeof updater === 'function'
          ? updater(current)
          : {
              ...current,
              ...updater,
            };

      if (
        current.title === next.title &&
        current.content === next.content &&
        current.category === next.category &&
        current.pinned === next.pinned &&
        current.favorite === next.favorite &&
        current.archived === next.archived
      ) {
        return;
      }

      if (options?.history !== false) {
        pushHistory(current);
      }

      noteRef.current = next;
      setNote(next);

      markDirty();
    },
    [markDirty, pushHistory],
  );

  /* -------------------------------------------------------
     Flush saves on lifecycle changes
  ------------------------------------------------------- */

  useEffect(() => {
    const flush = () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }

      if (dirtyRef.current) {
        void saveNow();
      }
    };

    const onVisibilityChange = () => {
      if (
        document.visibilityState ===
        'hidden'
      ) {
        flush();
      }
    };

    window.addEventListener(
      'pagehide',
      flush,
    );

    document.addEventListener(
      'visibilitychange',
      onVisibilityChange,
    );

    return () => {
      window.removeEventListener(
        'pagehide',
        flush,
      );

      document.removeEventListener(
        'visibilitychange',
        onVisibilityChange,
      );

      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    };
  }, [saveNow]);

  /* -------------------------------------------------------
     Keyboard shortcuts
  ------------------------------------------------------- */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier =
        event.ctrlKey || event.metaKey;

      if (!modifier) {
        if (
          event.key === 'Escape' &&
          unlockPrompt
        ) {
          setUnlockPrompt(false);
          return;
        }

        if (
          event.key === 'Escape' &&
          deletePrompt
        ) {
          setDeletePrompt(false);
          return;
        }

        return;
      }

      const key =
        event.key.toLowerCase();

      if (key === 'z') {
        event.preventDefault();

        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }

        return;
      }

      if (key === 'y') {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener(
      'keydown',
      onKeyDown,
    );

    return () => {
      window.removeEventListener(
        'keydown',
        onKeyDown,
      );
    };
  }, [
    deletePrompt,
    redo,
    undo,
    unlockPrompt,
  ]);

  /* -------------------------------------------------------
     Actions
  ------------------------------------------------------- */

  const ensureRealId =
    useCallback(async (): Promise<string | null> => {
      if (realNoteIdRef.current) {
        return realNoteIdRef.current;
      }

      const current =
        noteRef.current;

      if (!current) {
        return null;
      }

      if (current.id !== 'new') {
        realNoteIdRef.current =
          current.id;

        return current.id;
      }

      return ensureRow();
    }, [ensureRow]);

  const toggleFlag = useCallback(
    (
      flag:
        | 'pinned'
        | 'favorite'
        | 'archived',
    ) => {
      updateNote((current) => ({
        ...current,
        [flag]: !current[flag],
      }));
    },
    [updateNote],
  );

  const onDelete =
    useCallback(async () => {
      if (deleting) return;

      setDeleting(true);

      try {
        if (saveTimer.current) {
          clearTimeout(saveTimer.current);
          saveTimer.current = null;
        }

        if (dirtyRef.current) {
          await saveNow();
        }

        const id =
          realNoteIdRef.current ||
          noteRef.current?.id;

        if (!id || id === 'new') {
          dirtyRef.current = false;
          router.push('/notes');
          return;
        }

        const { error } =
          await supabase
            .from('notes')
            .delete()
            .eq('id', id);

        if (error) {
          showNotice({
            type: 'error',
            title: 'Could not delete note',
            message:
              error.message ||
              'Please try again.',
          });

          return;
        }

        safeLocalStorageRemove(
          `enotes:note-lock:${id}`,
        );

        dirtyRef.current = false;

        router.push('/notes');
      } finally {
        if (mountedRef.current) {
          setDeleting(false);
        }
      }
    }, [
      deleting,
      router,
      saveNow,
      showNotice,
    ]);

  const onShare =
    useCallback(async () => {
      const current =
        noteRef.current;

      if (!current) return;

      if (dirtyRef.current) {
        await saveNow();
      }

      const id =
        await ensureRealId();

      if (!id) {
        showNotice({
          type: 'error',
          title: 'Could not share note',
          message:
            'The note needs to be saved first.',
        });

        return;
      }

      const url =
        `${window.location.origin}/notes/${id}`;

      const text =
        current.title.trim() ||
        current.content.trim().slice(0, 100) ||
        'My note';

      try {
        if (
          navigator.share
        ) {
          await navigator.share({
            title: text,
            text,
            url,
          });

          return;
        }

        if (
          navigator.clipboard?.writeText
        ) {
          await navigator.clipboard.writeText(
            url,
          );
        } else {
          const textarea =
            document.createElement(
              'textarea',
            );

          textarea.value = url;
          textarea.style.position =
            'fixed';
          textarea.style.opacity =
            '0';

          document.body.appendChild(
            textarea,
          );

          textarea.focus();
          textarea.select();

          document.execCommand(
            'copy',
          );

          textarea.remove();
        }

        if (copiedTimer.current) {
          clearTimeout(
            copiedTimer.current,
          );
        }

        setCopied(true);

        copiedTimer.current =
          setTimeout(() => {
            if (mountedRef.current) {
              setCopied(false);
            }
          }, 1800);
      } catch {
        // Native share cancellation is intentionally silent.
      }
    }, [
      ensureRealId,
      saveNow,
      showNotice,
    ]);

  /* -------------------------------------------------------
     Lock
  ------------------------------------------------------- */

  const lockNote = useCallback(() => {
    const current =
      noteRef.current;

    if (!current) return;

    const id =
      realNoteIdRef.current ||
      (current.id !== 'new'
        ? current.id
        : null);

    setLocked(true);

    if (id) {
      safeLocalStorageSet(
        `enotes:note-lock:${id}`,
        '1',
      );
    }
  }, []);

  const unlockNote = useCallback(() => {
    const current =
      noteRef.current;

    const id =
      realNoteIdRef.current ||
      (current && current.id !== 'new'
        ? current.id
        : null);

    setLocked(false);
    setUnlockPrompt(false);

    if (id) {
      safeLocalStorageRemove(
        `enotes:note-lock:${id}`,
      );
    }
  }, []);

  /* -------------------------------------------------------
     Formatting
  ------------------------------------------------------- */

  const applyFormat =
    useCallback(
      (kind: FormatKind) => {
        const el =
          bodyRef.current;

        const current =
          noteRef.current;

        if (!el || !current) {
          return;
        }

        const {
          selectionStart,
          selectionEnd,
          value,
        } = el;

        let result:
          | ReturnType<
              typeof wrapSelection
            >
          | ReturnType<
              typeof toggleBlockPrefix
          >;

        if (
          kind === 'bold'
        ) {
          result = wrapSelection(
            value,
            selectionStart,
            selectionEnd,
            '**',
          );
        } else if (
          kind === 'italic'
        ) {
          result = wrapSelection(
            value,
            selectionStart,
            selectionEnd,
            '*',
          );
        } else if (
          kind === 'underline'
        ) {
          result = wrapSelection(
            value,
            selectionStart,
            selectionEnd,
            '__',
          );
        } else if (
          kind === 'ol'
        ) {
          result = toggleBlockPrefix(
            value,
            selectionStart,
            selectionEnd,
            '1. ',
          );
        } else if (
          kind === 'ul'
        ) {
          result = toggleBlockPrefix(
            value,
            selectionStart,
            selectionEnd,
            '- ',
          );
        } else {
          result = toggleBlockPrefix(
            value,
            selectionStart,
            selectionEnd,
            '[ ] ',
          );
        }

        pushHistory(current);

        const next: EditorNote = {
          ...current,
          content: result.text,
        };

        noteRef.current = next;
        setNote(next);

        markDirty();

        requestAnimationFrame(() => {
          el.focus();

          el.setSelectionRange(
            result.selectionStart,
            result.selectionEnd,
          );
        });
      },
      [markDirty, pushHistory],
    );

  /* -------------------------------------------------------
     Category
  ------------------------------------------------------- */

  const categories = useMemo(
    () =>
      Array.from(
        new Set([
          ...CATEGORIES,
          note?.category || '',
        ]),
      ).filter(Boolean),
    [note?.category],
  );

  const commitNewCategory =
    useCallback(() => {
      const category =
        normalizeCategory(
          newCategory,
        );

      if (!category) {
        setShowNewCategory(false);
        setNewCategory('');
        return;
      }

      updateNote({
        category,
      });

      setShowNewCategory(false);
      setNewCategory('');
    }, [
      newCategory,
      updateNote,
    ]);

  /* -------------------------------------------------------
     Loading / errors
  ------------------------------------------------------- */

  if (loading) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-[#FFF7F8]">
        <div className="flex items-center gap-2 text-sm text-[#8B8B8B]">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading note…
        </div>
      </main>
    );
  }

  if (notFound) {
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-[#FFF7F8] px-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm">
          <Trash2 className="h-6 w-6 text-[#9B9B9B]" />
        </div>

        <p className="mt-4 text-base font-bold">
          Note not found
        </p>

        <p className="mt-1 max-w-sm text-sm text-[#6B6B6B]">
          It may have been deleted, moved, or
          you may no longer have permission to
          access it.
        </p>

        <Link
          href="/notes"
          className="mt-5 rounded-xl bg-black px-5 py-2.5 text-sm font-semibold text-[#FFB6C1] transition hover:opacity-90"
        >
          Back to notes
        </Link>
      </main>
    );
  }

  if (!note) {
    return null;
  }

  const savePill = () => {
    if (saveState === 'saving') {
      return 'Saving…';
    }

    if (saveState === 'error') {
      return 'Not saved';
    }

    if (saveState === 'saved') {
      return 'Saved';
    }

    return '';
  };

  const wordCount =
    note.content.trim()
      ? note.content
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .length
      : 0;

  const characterCount =
    note.content.length;

  const canUndo =
    undoStackRef.current.length > 0;

  const canRedo =
    redoStackRef.current.length > 0;

  /*
   * Prevent React from considering these variables unused
   * while still allowing history changes to trigger render.
   */
  void historyVersion;

  return (
    <main className="min-h-[100dvh] bg-[#FFF7F8] text-[#111111]">
      {/* --------------------------------------------------
          HEADER
      -------------------------------------------------- */}

      <header className="sticky top-0 z-30 border-b border-[#E8E2E4]/70 bg-[#FFF7F8]/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-2 py-2 sm:px-4">
          <button
            type="button"
            onClick={() =>
              router.push('/notes')
            }
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition hover:bg-black/5 active:scale-95"
            aria-label="Back to notes"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() =>
                toggleFlag('pinned')
              }
              aria-pressed={note.pinned}
              aria-label={
                note.pinned
                  ? 'Unpin note'
                  : 'Pin note'
              }
              title={
                note.pinned
                  ? 'Unpin'
                  : 'Pin'
              }
              className={`flex h-11 w-11 items-center justify-center rounded-full transition active:scale-95 ${
                note.pinned
                  ? 'bg-[#FFF0F3] text-[#E5798F]'
                  : 'hover:bg-black/5'
              }`}
            >
              <Pin
                className={`h-5 w-5 ${
                  note.pinned
                    ? 'fill-current'
                    : ''
                }`}
              />
            </button>

            <button
              type="button"
              onClick={() =>
                toggleFlag('favorite')
              }
              aria-pressed={note.favorite}
              aria-label={
                note.favorite
                  ? 'Unfavorite note'
                  : 'Favorite note'
              }
              title={
                note.favorite
                  ? 'Unfavorite'
                  : 'Favorite'
              }
              className={`flex h-11 w-11 items-center justify-center rounded-full transition active:scale-95 ${
                note.favorite
                  ? 'bg-[#FFF0F3] text-[#E5798F]'
                  : 'hover:bg-black/5'
              }`}
            >
              <Heart
                className={`h-5 w-5 ${
                  note.favorite
                    ? 'fill-current'
                    : ''
                }`}
              />
            </button>

            <button
              type="button"
              onClick={() => {
                if (locked) {
                  setUnlockPrompt(true);
                } else {
                  lockNote();
                }
              }}
              aria-pressed={locked}
              aria-label={
                locked
                  ? 'Unlock note'
                  : 'Lock note'
              }
              title={
                locked
                  ? 'Unlock'
                  : 'Lock'
              }
              className={`flex h-11 w-11 items-center justify-center rounded-full transition active:scale-95 ${
                locked
                  ? 'bg-[#FFF0F3] text-[#E5798F]'
                  : 'hover:bg-black/5'
              }`}
            >
              <Lock className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={() =>
                void onShare()
              }
              aria-label="Share note"
              title="Share"
              className="flex h-11 w-11 items-center justify-center rounded-full transition hover:bg-black/5 active:scale-95"
            >
              <Share2 className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={() =>
                toggleFlag('archived')
              }
              aria-pressed={note.archived}
              aria-label={
                note.archived
                  ? 'Restore note'
                  : 'Archive note'
              }
              title={
                note.archived
                  ? 'Restore'
                  : 'Archive'
              }
              className={`flex h-11 w-11 items-center justify-center rounded-full transition active:scale-95 ${
                note.archived
                  ? 'bg-[#FFF0F3] text-[#E5798F]'
                  : 'hover:bg-black/5'
              }`}
            >
              {note.archived ? (
                <X className="h-5 w-5" />
              ) : (
                <Check className="h-5 w-5 rotate-90" />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* --------------------------------------------------
          LOCK SCREEN
      -------------------------------------------------- */}

      {locked && (
        <div className="mx-auto max-w-2xl px-4 pt-8">
          <div className="rounded-3xl border border-[#E8E2E4] bg-white p-7 text-center shadow-sm">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#FFF0F3] text-[#E5798F]">
              <Lock className="h-6 w-6" />
            </div>

            <p className="mt-4 text-base font-bold">
              This note is locked
            </p>

            <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-[#6B6B6B]">
              The editor is hidden on this
              device. This is a local privacy
              feature, not encryption.
            </p>

            <button
              type="button"
              onClick={() =>
                setUnlockPrompt(true)
              }
              className="mt-5 rounded-xl bg-black px-5 py-2.5 text-sm font-semibold text-[#FFB6C1] transition hover:opacity-90 active:scale-[0.98]"
            >
              Unlock
            </button>
          </div>
        </div>
      )}

      {/* --------------------------------------------------
          EDITOR
      -------------------------------------------------- */}

      <div
        className={`mx-auto max-w-2xl px-4 pb-36 pt-4 transition-[filter,opacity] duration-200 sm:px-6 ${
          locked
            ? 'pointer-events-none select-none blur-[7px] opacity-60'
            : ''
        }`}
        aria-hidden={locked}
      >
        {/* Title */}

        <textarea
          ref={titleRef}
          value={note.title}
          onChange={(event) => {
            const nextTitle =
              event.target.value
                .replace(/\n/g, '')
                .slice(
                  0,
                  MAX_TITLE_LENGTH,
                );

            updateNote({
              title: nextTitle,
            });

            requestAnimationFrame(
              resizeTitle,
            );
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              bodyRef.current?.focus();
            }
          }}
          rows={1}
          maxLength={MAX_TITLE_LENGTH}
          placeholder="title"
          aria-label="Note title"
          className="w-full resize-none overflow-hidden bg-transparent text-4xl font-extrabold tracking-tight placeholder:text-[#C9C0C4] focus:outline-none sm:text-5xl"
        />

        {/* Metadata */}

        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#6B6B6B] sm:text-sm">
          <span>
            {formatTimestamp(
              note.updated_at,
            )}
          </span>

          {savePill() && (
            <span
              className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                saveState === 'error'
                  ? 'bg-red-50 text-red-600'
                  : saveState === 'saving'
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-[#FFF0F3] text-[#E5798F]'
              }`}
            >
              {saveState === 'saving' && (
                <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
              )}

              {savePill()}
            </span>
          )}
        </div>

        <hr className="mt-3 border-[#E8E2E4]" />

        {/* Categories */}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {categories.map(
            (category) => (
              <button
                key={category}
                type="button"
                onClick={() => {
                  if (
                    note.category !==
                    category
                  ) {
                    updateNote({
                      category,
                    });
                  }
                }}
                aria-pressed={
                  note.category ===
                  category
                }
                className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium capitalize transition active:scale-[0.98] ${
                  note.category ===
                  category
                    ? 'bg-[#FFF0F3] text-[#E5798F] ring-1 ring-[#FFD2DE]'
                    : 'border border-[#E8E2E4] bg-white text-[#6B6B6B] hover:bg-gray-50'
                }`}
              >
                {note.category ===
                  category && (
                  <span className="h-2 w-2 rounded-full bg-[#E5798F]" />
                )}

                {category}
              </button>
            ),
          )}

          {showNewCategory ? (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                value={newCategory}
                onChange={(event) =>
                  setNewCategory(
                    event.target.value
                      .toLowerCase()
                      .replace(
                        /[^a-z0-9 -]/g,
                        '',
                      )
                      .replace(
                        /\s+/g,
                        ' ',
                      )
                      .slice(
                        0,
                        MAX_CATEGORY_LENGTH,
                      ),
                  )
                }
                onKeyDown={(event) => {
                  if (
                    event.key ===
                    'Enter'
                  ) {
                    event.preventDefault();
                    commitNewCategory();
                  }

                  if (
                    event.key ===
                    'Escape'
                  ) {
                    event.preventDefault();
                    setShowNewCategory(
                      false,
                    );
                    setNewCategory('');
                  }
                }}
                placeholder="category…"
                maxLength={
                  MAX_CATEGORY_LENGTH
                }
                aria-label="New category name"
                className="w-32 rounded-full border border-[#E5798F] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFD2DE]"
              />

              <button
                type="button"
                onClick={() => {
                  setShowNewCategory(
                    false,
                  );
                  setNewCategory('');
                }}
                className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-gray-100"
                aria-label="Cancel new category"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() =>
                setShowNewCategory(true)
              }
              className="flex items-center gap-1.5 rounded-full border border-[#E8E2E4] bg-white px-4 py-2 text-sm font-medium text-[#E5798F] transition hover:bg-gray-50 active:scale-[0.98]"
            >
              <span className="text-base leading-none">
                +
              </span>
              new
            </button>
          )}
        </div>

        {/* Formatting toolbar */}

        <div
          className="no-scrollbar mt-5 flex items-center gap-1 overflow-x-auto rounded-2xl border border-[#E8E2E4] bg-white px-2 py-1.5 shadow-sm"
          role="toolbar"
          aria-label="Text formatting"
        >
          <ToolbarButton
            label="Undo"
            disabled={!canUndo}
            onClick={undo}
          >
            <Undo2 className="h-4 w-4" />
          </ToolbarButton>

          <ToolbarButton
            label="Redo"
            disabled={!canRedo}
            onClick={redo}
          >
            <Redo2 className="h-4 w-4" />
          </ToolbarButton>

          <ToolbarDivider />

          <ToolbarButton
            label="Bold"
            onClick={() =>
              applyFormat('bold')
            }
          >
            <BoldIcon className="h-4 w-4" />
          </ToolbarButton>

          <ToolbarButton
            label="Italic"
            onClick={() =>
              applyFormat('italic')
            }
          >
            <ItalicIcon className="h-4 w-4" />
          </ToolbarButton>

          <ToolbarButton
            label="Underline"
            onClick={() =>
              applyFormat(
                'underline',
              )
            }
          >
            <UnderlineIcon className="h-4 w-4" />
          </ToolbarButton>

          <ToolbarDivider />

          <ToolbarButton
            label="Ordered list"
            onClick={() =>
              applyFormat('ol')
            }
          >
            <ListOrdered className="h-4 w-4" />
          </ToolbarButton>

          <ToolbarButton
            label="Bullet list"
            onClick={() =>
              applyFormat('ul')
            }
          >
            <List className="h-4 w-4" />
          </ToolbarButton>

          <ToolbarButton
            label="Checklist"
            onClick={() =>
              applyFormat('check')
            }
          >
            <CheckSquare className="h-4 w-4" />
          </ToolbarButton>

          <ToolbarDivider />

          <ToolbarButton
            label="Delete note"
            danger
            onClick={() =>
              setDeletePrompt(true)
            }
          >
            <Trash2 className="h-4 w-4" />
          </ToolbarButton>
        </div>

        {/* Body */}

        <textarea
          ref={bodyRef}
          value={note.content}
          onChange={(event) => {
            updateNote({
              content:
                event.target.value,
            });
          }}
          onKeyDown={(event) => {
            const modifier =
              event.ctrlKey ||
              event.metaKey;

            if (
              modifier &&
              event.key.toLowerCase() ===
                'b'
            ) {
              event.preventDefault();
              applyFormat('bold');
              return;
            }

            if (
              modifier &&
              event.key.toLowerCase() ===
                'i'
            ) {
              event.preventDefault();
              applyFormat('italic');
              return;
            }

            if (
              modifier &&
              event.key.toLowerCase() ===
                'u'
            ) {
              event.preventDefault();
              applyFormat(
                'underline',
              );
              return;
            }

            /*
             * Automatically continue simple lists
             * when pressing Enter.
             */
            if (
              event.key === 'Enter' &&
              !event.shiftKey
            ) {
              const el =
                bodyRef.current;

              if (!el) return;

              const cursor =
                el.selectionStart;

              const before =
                el.value.slice(
                  0,
                  cursor,
                );

              const lineStart =
                before.lastIndexOf(
                  '\n',
                ) + 1;

              const currentLine =
                before.slice(
                  lineStart,
                );

              const listMatch =
                currentLine.match(
                  /^(\s*)([-*]|\[\s?\]|(\d+)\.)\s(.*)$/,
                );

              if (listMatch) {
                const prefix =
                  listMatch[2];

                const content =
                  listMatch[4] ||
                  '';

                /*
                 * Empty list item:
                 * pressing Enter exits the list.
                 */
                if (!content.trim()) {
                  event.preventDefault();

                  const removeStart =
                    lineStart;

                  const removeEnd =
                    cursor;

                  const nextText =
                    el.value.slice(
                      0,
                      removeStart,
                    ) +
                    el.value.slice(
                      removeEnd,
                    );

                  const current =
                    noteRef.current;

                  if (!current)
                    return;

                  pushHistory(
                    current,
                  );

                  const next: EditorNote =
                    {
                      ...current,
                      content:
                        nextText,
                    };

                  noteRef.current =
                    next;

                  setNote(next);
                  markDirty();

                  requestAnimationFrame(
                    () => {
                      const nextCursor =
                        Math.min(
                          removeStart,
                          nextText.length,
                        );

                      el.focus();

                      el.setSelectionRange(
                        nextCursor,
                        nextCursor,
                      );
                    },
                  );

                  return;
                }

                event.preventDefault();

                let nextPrefix =
                  `${prefix} `;

                if (
                  /^\d+\.$/.test(
                    prefix,
                  )
                ) {
                  const number =
                    Number(
                      prefix.slice(
                        0,
                        -1,
                      ),
                    ) + 1;

                  nextPrefix = `${number}. `;
                }

                const nextContent =
                  `${el.value.slice(
                    0,
                    cursor,
                  )}\n${nextPrefix}${el.value.slice(
                    cursor,
                  )}`;

                const current =
                  noteRef.current;

                if (!current)
                  return;

                pushHistory(
                  current,
                );

                const next: EditorNote =
                  {
                    ...current,
                    content:
                      nextContent,
                  };

                noteRef.current =
                  next;

                setNote(next);
                markDirty();

                const nextCursor =
                  cursor +
                  1 +
                  nextPrefix.length;

                requestAnimationFrame(
                  () => {
                    el.focus();

                    el.setSelectionRange(
                      nextCursor,
                      nextCursor,
                    );
                  },
                );
              }
            }
          }}
          placeholder="what's on your mind?"
          aria-label="Note body"
          spellCheck
          className="mt-5 min-h-[48dvh] w-full resize-none bg-transparent text-[17px] leading-[1.85] placeholder:text-[#C9C0C4] focus:outline-none sm:min-h-[55dvh] sm:text-lg"
        />

        {/* Footer stats */}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#E8E2E4] pt-3 text-[11px] text-[#8B8B8B]">
          <div className="flex items-center gap-3">
            <span>
              {wordCount}{' '}
              {wordCount === 1
                ? 'word'
                : 'words'}
            </span>

            <span>
              {characterCount}{' '}
              {characterCount === 1
                ? 'character'
                : 'characters'}
            </span>
          </div>

          <span>
            {note.title.length}/
            {MAX_TITLE_LENGTH} title
          </span>
        </div>
      </div>

      {/* --------------------------------------------------
          NOTICE
      -------------------------------------------------- */}

      {notice && (
        <StyledAlert
          notice={notice}
          onClose={() =>
            setNotice(null)
          }
        />
      )}

      {/* --------------------------------------------------
          DELETE DIALOG
      -------------------------------------------------- */}

      {deletePrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
          onClick={() => {
            if (!deleting) {
              setDeletePrompt(false);
            }
          }}
        >
          <div
            className="w-full max-w-sm rounded-3xl border border-white/70 bg-white p-6 shadow-2xl"
            onClick={(event) =>
              event.stopPropagation()
            }
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-note-title"
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-500">
              <Trash2 className="h-5 w-5" />
            </div>

            <h2
              id="delete-note-title"
              className="mt-4 text-center text-base font-bold"
            >
              Delete this note?
            </h2>

            <p className="mt-1 text-center text-sm leading-relaxed text-[#6B6B6B]">
              This permanently removes the
              note from your account. This
              action cannot be undone.
            </p>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() =>
                  setDeletePrompt(false)
                }
                className="rounded-2xl border border-[#E8E2E4] bg-white px-4 py-3 text-sm font-semibold transition hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={deleting}
                onClick={() =>
                  void onDelete()
                }
                className="rounded-2xl bg-red-500 px-4 py-3 text-sm font-bold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deleting ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Deleting…
                  </span>
                ) : (
                  'Delete'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --------------------------------------------------
          UNLOCK DIALOG
      -------------------------------------------------- */}

      {unlockPrompt && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
          onClick={() =>
            setUnlockPrompt(false)
          }
        >
          <div
            className="w-full max-w-xs rounded-3xl bg-white p-6 text-center shadow-2xl"
            onClick={(event) =>
              event.stopPropagation()
            }
            role="dialog"
            aria-modal="true"
            aria-labelledby="unlock-note-title"
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FFF0F3] text-[#E5798F]">
              <Lock className="h-5 w-5" />
            </div>

            <p
              id="unlock-note-title"
              className="mt-3 text-sm font-bold"
            >
              Unlock this note?
            </p>

            <p className="mt-1 text-xs leading-relaxed text-[#6B6B6B]">
              Anyone with access to this
              device may be able to read the
              note. The local lock does not
              encrypt the database record.
            </p>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() =>
                  setUnlockPrompt(false)
                }
                className="rounded-xl border border-[#E8E2E4] py-2.5 text-sm font-semibold transition hover:bg-gray-50"
              >
                Keep locked
              </button>

              <button
                type="button"
                onClick={unlockNote}
                className="rounded-xl bg-black py-2.5 text-sm font-semibold text-[#FFB6C1] transition hover:opacity-90"
              >
                Unlock
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --------------------------------------------------
          COPIED TOAST
      -------------------------------------------------- */}

      {copied && (
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-30 -translate-x-1/2">
          <p className="rounded-full bg-black px-4 py-2.5 text-xs font-semibold text-[#FFB6C1] shadow-xl">
            <Copy className="mr-1.5 inline h-3.5 w-3.5" />
            Link copied
          </p>
        </div>
      )}
    </main>
  );
}

/* =========================================================
   Toolbar
========================================================= */

function ToolbarDivider() {
  return (
    <span
      aria-hidden="true"
      className="mx-1 h-5 w-px shrink-0 bg-[#E8E2E4]"
    />
  );
}

function ToolbarButton({
  label,
  onClick,
  danger,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      disabled={disabled}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 ${
        danger
          ? 'text-red-500 hover:bg-red-50'
          : 'text-[#3D3D3D] hover:bg-gray-100'
      }`}
    >
      {children}
    </button>
  );
}

/* =========================================================
   Alert
========================================================= */

function StyledAlert({
  notice,
  onClose,
}: {
  notice: Notice;
  onClose: () => void;
}) {
  const styles = {
    error: {
      icon: '!',
      iconClass:
        'bg-red-50 text-red-500',
      titleClass:
        'text-red-700',
      barClass:
        'bg-red-500',
    },

    success: {
      icon: '✓',
      iconClass:
        'bg-emerald-50 text-emerald-600',
      titleClass:
        'text-emerald-700',
      barClass:
        'bg-emerald-500',
    },

    info: {
      icon: 'i',
      iconClass:
        'bg-blue-50 text-blue-600',
      titleClass:
        'text-blue-700',
      barClass:
        'bg-blue-500',
    },
  }[notice.type];

  return (
    <div
      className="fixed inset-x-4 bottom-5 z-[60] mx-auto max-w-md"
      role="alert"
      aria-live="assertive"
    >
      <div className="relative overflow-hidden rounded-2xl border border-white/80 bg-white/95 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.16)] backdrop-blur-xl">
        <div
          className={`absolute inset-y-0 left-0 w-1 ${styles.barClass}`}
        />

        <div className="flex items-start gap-3 pl-1">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-extrabold ${styles.iconClass}`}
          >
            {styles.icon}
          </div>

          <div className="min-w-0 flex-1">
            <p
              className={`text-sm font-bold ${styles.titleClass}`}
            >
              {notice.title}
            </p>

            <p className="mt-1 text-xs leading-relaxed text-[#666666]">
              {notice.message}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#8B8B8B] transition hover:bg-black/5 hover:text-black"
            aria-label="Dismiss alert"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
```
