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

type SaveState =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'error';

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
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const formattedDate =
    date.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

  const formattedTime =
    date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

  return `${formattedDate.toLowerCase()} ${formattedTime}`;
}

function normalizeCategory(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 -]/g, '')
    .slice(0, MAX_CATEGORY_LENGTH);
}

function clampPosition(
  value: string,
  position: number,
): number {
  return Math.max(
    0,
    Math.min(position, value.length),
  );
}

function wrapSelection(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  marker: string,
) {
  const selected = text.slice(
    selectionStart,
    selectionEnd,
  );

  const before = text.slice(
    0,
    selectionStart,
  );

  const after = text.slice(
    selectionEnd,
  );

  if (
    selected &&
    before.endsWith(marker) &&
    after.startsWith(marker)
  ) {
    const nextText =
      before.slice(0, -marker.length) +
      selected +
      after.slice(marker.length);

    return {
      text: nextText,
      selectionStart:
        selectionStart - marker.length,
      selectionEnd:
        selectionEnd - marker.length,
    };
  }

  if (!selected) {
    const placeholder = 'text';

    const inserted =
      marker +
      placeholder +
      marker;

    return {
      text:
        before +
        inserted +
        after,
      selectionStart:
        selectionStart +
        marker.length,
      selectionEnd:
        selectionStart +
        marker.length +
        placeholder.length,
    };
  }

  const inserted =
    marker +
    selected +
    marker;

  return {
    text:
      before +
      inserted +
      after,
    selectionStart:
      selectionStart +
      marker.length,
    selectionEnd:
      selectionStart +
      marker.length +
      selected.length,
  };
}

function toggleBlockPrefix(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  prefix: string,
) {
  const start =
    text.lastIndexOf(
      '\n',
      Math.max(
        0,
        selectionStart - 1,
      ),
    ) + 1;

  let end = text.indexOf(
    '\n',
    selectionEnd,
  );

  if (end === -1) {
    end = text.length;
  }

  const block = text.slice(
    start,
    end,
  );

  const lines = block.split('\n');

  const allPrefixed = lines.every(
    (line) =>
      !line.trim() ||
      line.startsWith(prefix),
  );

  const nextLines = lines.map(
    (line) => {
      if (!line.trim()) {
        return line;
      }

      if (
        allPrefixed &&
        line.startsWith(prefix)
      ) {
        return line.slice(
          prefix.length,
        );
      }

      return prefix + line;
    },
  );

  const nextBlock =
    nextLines.join('\n');

  const nextText =
    text.slice(0, start) +
    nextBlock +
    text.slice(end);

  const difference =
    nextBlock.length -
    block.length;

  let nextStart =
    selectionStart;

  let nextEnd =
    selectionEnd;

  if (allPrefixed) {
    nextStart += difference;
  }

  nextEnd += difference;

  return {
    text: nextText,
    selectionStart: clampPosition(
      nextText,
      nextStart,
    ),
    selectionEnd: clampPosition(
      nextText,
      nextEnd,
    ),
  };
}

function createSnapshot(
  note: EditorNote | null,
): HistorySnapshot | null {
  if (!note) {
    return null;
  }

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
  if (!a || !b) {
    return false;
  }

  return (
    a.title === b.title &&
    a.content === b.content &&
    a.category === b.category
  );
}

function getLockStorageKey(
  id: string,
): string {
  return `enotes:note-lock:${id}`;
}

function readLocalStorage(
  key: string,
): string | null {
  if (
    typeof window === 'undefined'
  ) {
    return null;
  }

  try {
    return window.localStorage.getItem(
      key,
    );
  } catch {
    return null;
  }
}

function writeLocalStorage(
  key: string,
  value: string,
): void {
  if (
    typeof window === 'undefined'
  ) {
    return;
  }

  try {
    window.localStorage.setItem(
      key,
      value,
    );
  } catch {
    // Ignore storage errors.
  }
}

function removeLocalStorage(
  key: string,
): void {
  if (
    typeof window === 'undefined'
  ) {
    return;
  }

  try {
    window.localStorage.removeItem(
      key,
    );
  } catch {
    // Ignore storage errors.
  }
}

export default function NoteEditorPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-[100dvh] items-center justify-center bg-[#FFF7F8]">
          <div className="flex items-center gap-2 text-sm text-[#8B8B8B]">
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
  const params =
    useParams<{ id: string }>();

  const router = useRouter();

  const routeIdRef =
    useRef<string>(
      typeof params?.id === 'string'
        ? params.id
        : 'new',
    );

  const routeId =
    routeIdRef.current;

  const isNew =
    routeId === 'new';

  const [note, setNote] =
    useState<EditorNote | null>(
      null,
    );

  const [loading, setLoading] =
    useState(true);

  const [notFound, setNotFound] =
    useState(false);

  const [saveState, setSaveState] =
    useState<SaveState>('idle');

  const [locked, setLocked] =
    useState(false);

  const [
    unlockPrompt,
    setUnlockPrompt,
  ] = useState(false);

  const [deletePrompt, setDeletePrompt] =
    useState(false);

  const [deleting, setDeleting] =
    useState(false);

  const [copied, setCopied] =
    useState(false);

  const [notice, setNotice] =
    useState<Notice | null>(null);

  const [
    showNewCategory,
    setShowNewCategory,
  ] = useState(false);

  const [newCategory, setNewCategory] =
    useState('');

  const [
    historyVersion,
    setHistoryVersion,
  ] = useState(0);

  const titleRef =
    useRef<HTMLTextAreaElement>(null);

  const bodyRef =
    useRef<HTMLTextAreaElement>(null);

  const noteRef =
    useRef<EditorNote | null>(null);

  const saveTimer =
    useRef<ReturnType<
      typeof setTimeout
    > | null>(null);

  const noticeTimer =
    useRef<ReturnType<
      typeof setTimeout
    > | null>(null);

  const copiedTimer =
    useRef<ReturnType<
      typeof setTimeout
    > | null>(null);

  const dirtyRef =
    useRef(false);

  const mountedRef =
    useRef(true);

  const creatingRef =
    useRef<Promise<
      string | null
    > | null>(null);

  const realNoteIdRef =
    useRef<string | null>(
      isNew ? null : routeId,
    );

  const saveVersionRef =
    useRef(0);

  const saveInFlightRef =
    useRef<Promise<void> | null>(
      null,
    );

  const undoStackRef =
    useRef<HistorySnapshot[]>([]);

  const redoStackRef =
    useRef<HistorySnapshot[]>([]);

  noteRef.current = note;

  /* --------------------------------------------------
     Mounted state
  -------------------------------------------------- */

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  /* --------------------------------------------------
     Load
  -------------------------------------------------- */

  useEffect(() => {
    let cancelled = false;

    async function loadNote() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (cancelled) {
        return;
      }

      if (!user) {
        const redirect = isNew
          ? '/auth/sign-in?redirect=%2Fnotes%2Fnew'
          : `/auth/sign-in?redirect=%2Fnotes%2F${encodeURIComponent(
              routeId,
            )}`;

        router.replace(
          redirect,
        );

        return;
      }

      if (isNew) {
        const now =
          new Date().toISOString();

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

        if (cancelled) {
          return;
        }

        noteRef.current =
          draft;

        setNote(draft);
        setLoading(false);

        return;
      }

      const {
        data,
        error,
      } = await supabase
        .from('notes')
        .select('*')
        .eq('id', routeId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (cancelled) {
        return;
      }

      if (error || !data) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      const loaded =
        data as EditorNote;

      noteRef.current =
        loaded;

      setNote(loaded);
      setLoading(false);

      const lockKey =
        getLockStorageKey(
          loaded.id,
        );

      if (
        readLocalStorage(
          lockKey,
        ) === '1'
      ) {
        setLocked(true);
      }
    }

    void loadNote();

    return () => {
      cancelled = true;
    };
  }, [
    isNew,
    routeId,
    router,
  ]);

  /* --------------------------------------------------
     Resize title
  -------------------------------------------------- */

  const resizeTitle =
    useCallback(() => {
      const element =
        titleRef.current;

      if (!element) {
        return;
      }

      element.style.height =
        'auto';

      element.style.height =
        `${element.scrollHeight}px`;
    }, []);

  useEffect(() => {
    if (!loading && note) {
      requestAnimationFrame(
        resizeTitle,
      );
    }
  }, [
    loading,
    note?.title,
    resizeTitle,
  ]);

  /* --------------------------------------------------
     Notice
  -------------------------------------------------- */

  const showNotice =
    useCallback(
      (next: Notice) => {
        if (noticeTimer.current) {
          clearTimeout(
            noticeTimer.current,
          );
        }

        setNotice(next);

        noticeTimer.current =
          setTimeout(() => {
            if (
              mountedRef.current
            ) {
              setNotice(null);
            }
          }, 5000);
      },
      [],
    );

  /* --------------------------------------------------
     Payload
  -------------------------------------------------- */

  const toPayload =
    useCallback(
      (current: EditorNote) => ({
        title: current.title.slice(
          0,
          MAX_TITLE_LENGTH,
        ),
        content:
          current.content,
        category:
          current.category.slice(
            0,
            MAX_CATEGORY_LENGTH,
          ),
        pinned:
          Boolean(current.pinned),
        favorite:
          Boolean(current.favorite),
        archived:
          Boolean(current.archived),
      }),
      [],
    );

  /* --------------------------------------------------
     Save row creation
  -------------------------------------------------- */

  const ensureRow =
    useCallback(
      async (): Promise<
        string | null
      > => {
        if (
          realNoteIdRef.current
        ) {
          return realNoteIdRef.current;
        }

        if (creatingRef.current) {
          return creatingRef.current;
        }

        const current =
          noteRef.current;

        if (!current) {
          return null;
        }

        if (
          current.id !== 'new'
        ) {
          realNoteIdRef.current =
            current.id;

          return current.id;
        }

        const payload =
          toPayload(current);

        const creation =
          (async () => {
            const {
              data: {
                user,
              },
            } =
              await supabase.auth.getUser();

            if (!user) {
              setSaveState(
                'error',
              );

              showNotice({
                type: 'error',
                title:
                  'Sign-in required',
                message:
                  'Your session has ended. Sign in again to save this note.',
              });

              return null;
            }

            const {
              data,
              error,
            } =
              await supabase
                .from('notes')
                .insert({
                  ...payload,
                  user_id:
                    user.id,
                })
                .select(
                  'id, created_at, updated_at',
                )
                .single();

            if (
              error ||
              !data
            ) {
              setSaveState(
                'error',
              );

              showNotice({
                type: 'error',
                title:
                  'Could not create note',
                message:
                  error?.message ||
                  'The note could not be created.',
              });

              return null;
            }

            const realId =
              (
                data as {
                  id: string;
                }
              ).id;

            /*
             * Set this BEFORE changing React state.
             * This prevents duplicate inserts.
             */
            realNoteIdRef.current =
              realId;

            const latest =
              noteRef.current;

            if (latest) {
              const updated: EditorNote =
                {
                  ...latest,
                  id: realId,
                  created_at:
                    (
                      data as {
                        created_at?: string;
                      }
                    ).created_at ||
                    latest.created_at,
                  updated_at:
                    (
                      data as {
                        updated_at?: string;
                      }
                    ).updated_at ||
                    latest.updated_at,
                };

              noteRef.current =
                updated;

              if (
                mountedRef.current
              ) {
                setNote(
                  updated,
                );
              }
            }

            if (
              mountedRef.current
            ) {
              router.replace(
                `/notes/${realId}`,
              );
            }

            return realId;
          })();

        creatingRef.current =
          creation;

        void creation.finally(
          () => {
            if (
              creatingRef.current ===
              creation
            ) {
              creatingRef.current =
                null;
            }
          },
        );

        return creation;
      },
      [
        router,
        showNotice,
        toPayload,
      ],
    );

  /* --------------------------------------------------
     Save
  -------------------------------------------------- */

  const saveNow =
    useCallback(
      async (): Promise<void> => {
        if (
          saveInFlightRef.current
        ) {
          return saveInFlightRef.current;
        }

        const worker =
          (async () => {
            while (
              dirtyRef.current
            ) {
              const current =
                noteRef.current;

              if (!current) {
                return;
              }

              const version =
                saveVersionRef.current;

              if (
                mountedRef.current
              ) {
                setSaveState(
                  'saving',
                );
              }

              let id =
                realNoteIdRef.current;

              if (!id) {
                if (
                  current.id ===
                  'new'
                ) {
                  id =
                    await ensureRow();
                } else {
                  id =
                    current.id;

                  realNoteIdRef.current =
                    id;
                }
              }

              if (!id) {
                return;
              }

              const latest =
                noteRef.current;

              if (!latest) {
                return;
              }

              const updatedAt =
                new Date().toISOString();

              const {
                error,
              } =
                await supabase
                  .from('notes')
                  .update({
                    ...toPayload(
                      latest,
                    ),
                    updated_at:
                      updatedAt,
                  })
                  .eq(
                    'id',
                    id,
                  );

              if (error) {
                if (
                  mountedRef.current
                ) {
                  setSaveState(
                    'error',
                  );

                  showNotice({
                    type: 'error',
                    title:
                      'Changes not saved',
                    message:
                      error.message ||
                      'Please try again.',
                  });
                }

                return;
              }

              const afterSave =
                noteRef.current;

              if (
                afterSave &&
                afterSave.id ===
                  id
              ) {
                const refreshed =
                  {
                    ...afterSave,
                    updated_at:
                      updatedAt,
                  };

                noteRef.current =
                  refreshed;

                if (
                  mountedRef.current
                ) {
                  setNote(
                    refreshed,
                  );
                }
              }

              /*
               * If the user typed while the request was
               * running, dirtyRef stays true and the loop
               * immediately saves the newest version.
               */
              if (
                saveVersionRef.current ===
                version
              ) {
                dirtyRef.current =
                  false;

                if (
                  mountedRef.current
                ) {
                  setSaveState(
                    'saved',
                  );
                }

                return;
              }
            }
          })()
            .catch(
              (
                error: unknown,
              ) => {
                if (
                  mountedRef.current
                ) {
                  setSaveState(
                    'error',
                  );

                  showNotice({
                    type: 'error',
                    title:
                      'Could not save',
                    message:
                      error instanceof
                      Error
                        ? error.message
                        : 'An unexpected error occurred.',
                  });
                }
              },
            )
            .finally(() => {
              saveInFlightRef.current =
                null;
            });

        saveInFlightRef.current =
          worker;

        return worker;
      },
      [
        ensureRow,
        showNotice,
        toPayload,
      ],
    );

  /* --------------------------------------------------
     Schedule save
  -------------------------------------------------- */

  const scheduleSave =
    useCallback(() => {
      if (saveTimer.current) {
        clearTimeout(
          saveTimer.current,
        );
      }

      saveTimer.current =
        setTimeout(() => {
          saveTimer.current =
            null;

          void saveNow();
        }, AUTOSAVE_DELAY);
    }, [saveNow]);

  /* --------------------------------------------------
     Dirty
  -------------------------------------------------- */

  const markDirty =
    useCallback(() => {
      saveVersionRef.current +=
        1;

      dirtyRef.current =
        true;

      setSaveState(
        'saving',
      );

      scheduleSave();
    }, [scheduleSave]);

  /* --------------------------------------------------
     History
  -------------------------------------------------- */

  const pushHistory =
    useCallback(
      (previous: EditorNote) => {
        const snapshot =
          createSnapshot(
            previous,
          );

        if (!snapshot) {
          return;
        }

        const last =
          undoStackRef.current[
            undoStackRef.current
              .length - 1
          ] || null;

        if (
          snapshotsEqual(
            last,
            snapshot,
          )
        ) {
          return;
        }

        undoStackRef.current.push(
          snapshot,
        );

        if (
          undoStackRef.current
            .length > MAX_HISTORY
        ) {
          undoStackRef.current.shift();
        }

        redoStackRef.current =
          [];

        setHistoryVersion(
          (value) =>
            value + 1,
        );
      },
      [],
    );

  /* --------------------------------------------------
     Update note
  -------------------------------------------------- */

  const updateNote =
    useCallback(
      (
        changes:
          | Partial<EditorNote>
          | ((
              current: EditorNote,
            ) => EditorNote),
      ) => {
        const current =
          noteRef.current;

        if (!current) {
          return;
        }

        const next =
          typeof changes ===
          'function'
            ? changes(current)
            : {
                ...current,
                ...changes,
              };

        if (
          current.title ===
            next.title &&
          current.content ===
            next.content &&
          current.category ===
            next.category &&
          current.pinned ===
            next.pinned &&
          current.favorite ===
            next.favorite &&
          current.archived ===
            next.archived
        ) {
          return;
        }

        pushHistory(current);

        noteRef.current =
          next;

        setNote(next);

        markDirty();
      },
      [
        markDirty,
        pushHistory,
      ],
    );

  /* --------------------------------------------------
     Undo / Redo
  -------------------------------------------------- */

  const restoreSnapshot =
    useCallback(
      (snapshot: HistorySnapshot) => {
        const current =
          noteRef.current;

        if (!current) {
          return;
        }

        const next: EditorNote =
          {
            ...current,
            title:
              snapshot.title,
            content:
              snapshot.content,
            category:
              snapshot.category,
          };

        noteRef.current =
          next;

        setNote(next);

        saveVersionRef.current +=
          1;

        dirtyRef.current =
          true;

        setSaveState(
          'saving',
        );

        if (saveTimer.current) {
          clearTimeout(
            saveTimer.current,
          );
        }

        saveTimer.current =
          setTimeout(() => {
            saveTimer.current =
              null;

            void saveNow();
          }, AUTOSAVE_DELAY);

        requestAnimationFrame(() => {
          resizeTitle();

          bodyRef.current?.focus();
        });
      },
      [
        resizeTitle,
        saveNow,
      ],
    );

  const undo =
    useCallback(() => {
      const current =
        noteRef.current;

      if (!current) {
        return;
      }

      const previous =
        undoStackRef.current.pop();

      if (!previous) {
        return;
      }

      const currentSnapshot =
        createSnapshot(
          current,
        );

      if (currentSnapshot) {
        redoStackRef.current.push(
          currentSnapshot,
        );
      }

      restoreSnapshot(
        previous,
      );

      setHistoryVersion(
        (value) =>
          value + 1,
      );
    }, [restoreSnapshot]);

  const redo =
    useCallback(() => {
      const current =
        noteRef.current;

      if (!current) {
        return;
      }

      const next =
        redoStackRef.current.pop();

      if (!next) {
        return;
      }

      const currentSnapshot =
        createSnapshot(
          current,
        );

      if (currentSnapshot) {
        undoStackRef.current.push(
          currentSnapshot,
        );
      }

      restoreSnapshot(next);

      setHistoryVersion(
        (value) =>
          value + 1,
      );
    }, [restoreSnapshot]);

  /* --------------------------------------------------
     Flush saves
  -------------------------------------------------- */

  useEffect(() => {
    function flush() {
      if (saveTimer.current) {
        clearTimeout(
          saveTimer.current,
        );

        saveTimer.current =
          null;
      }

      if (dirtyRef.current) {
        void saveNow();
      }
    }

    function handleVisibility() {
      if (
        document.visibilityState ===
        'hidden'
      ) {
        flush();
      }
    }

    window.addEventListener(
      'pagehide',
      flush,
    );

    document.addEventListener(
      'visibilitychange',
      handleVisibility,
    );

    return () => {
      window.removeEventListener(
        'pagehide',
        flush,
      );

      document.removeEventListener(
        'visibilitychange',
        handleVisibility,
      );
    };
  }, [saveNow]);

  /* --------------------------------------------------
     Keyboard shortcuts
  -------------------------------------------------- */

  useEffect(() => {
    function handleKeyDown(
      event: KeyboardEvent,
    ) {
      const modifier =
        event.ctrlKey ||
        event.metaKey;

      if (
        event.key === 'Escape'
      ) {
        if (deletePrompt) {
          setDeletePrompt(
            false,
          );
          return;
        }

        if (unlockPrompt) {
          setUnlockPrompt(
            false,
          );
          return;
        }
      }

      if (!modifier) {
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
    }

    window.addEventListener(
      'keydown',
      handleKeyDown,
    );

    return () => {
      window.removeEventListener(
        'keydown',
        handleKeyDown,
      );
    };
  }, [
    deletePrompt,
    redo,
    undo,
    unlockPrompt,
  ]);

  /* --------------------------------------------------
     Flag actions
  -------------------------------------------------- */

  const toggleFlag =
    useCallback(
      (
        flag:
          | 'pinned'
          | 'favorite'
          | 'archived',
      ) => {
        updateNote(
          (current) => ({
            ...current,
            [flag]:
              !current[flag],
          }),
        );
      },
      [updateNote],
    );

  /* --------------------------------------------------
     Ensure real ID
  -------------------------------------------------- */

  const ensureRealId =
    useCallback(async () => {
      if (
        realNoteIdRef.current
      ) {
        return realNoteIdRef.current;
      }

      const current =
        noteRef.current;

      if (!current) {
        return null;
      }

      if (
        current.id !== 'new'
      ) {
        realNoteIdRef.current =
          current.id;

        return current.id;
      }

      return ensureRow();
    }, [ensureRow]);

  /* --------------------------------------------------
     Delete
  -------------------------------------------------- */

  const onDelete =
    useCallback(async () => {
      if (deleting) {
        return;
      }

      setDeleting(true);

      try {
        if (saveTimer.current) {
          clearTimeout(
            saveTimer.current,
          );

          saveTimer.current =
            null;
        }

        if (dirtyRef.current) {
          await saveNow();
        }

        const id =
          realNoteIdRef.current ||
          noteRef.current?.id;

        if (!id || id === 'new') {
          dirtyRef.current =
            false;

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
            title:
              'Could not delete note',
            message:
              error.message ||
              'Please try again.',
          });

          return;
        }

        removeLocalStorage(
          getLockStorageKey(
            id,
          ),
        );

        dirtyRef.current =
          false;

        router.push('/notes');
      } finally {
        if (
          mountedRef.current
        ) {
          setDeleting(false);
        }
      }
    }, [
      deleting,
      router,
      saveNow,
      showNotice,
    ]);

  /* --------------------------------------------------
     Share
  -------------------------------------------------- */

  const onShare =
    useCallback(async () => {
      const current =
        noteRef.current;

      if (!current) {
        return;
      }

      if (dirtyRef.current) {
        await saveNow();
      }

      const id =
        await ensureRealId();

      if (!id) {
        showNotice({
          type: 'error',
          title:
            'Could not share note',
          message:
            'The note needs to be saved first.',
        });

        return;
      }

      const url =
        `${window.location.origin}/notes/${id}`;

      const shareTitle =
        current.title.trim() ||
        'My note';

      try {
        if (
          typeof navigator.share ===
          'function'
        ) {
          await navigator.share({
            title:
              shareTitle,
            text:
              current.content
                .trim()
                .slice(0, 120),
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
          const input =
            document.createElement(
              'textarea',
            );

          input.value = url;
          input.style.position =
            'fixed';
          input.style.left =
            '-9999px';

          document.body.appendChild(
            input,
          );

          input.focus();
          input.select();

          document.execCommand(
            'copy',
          );

          input.remove();
        }

        setCopied(true);

        if (
          copiedTimer.current
        ) {
          clearTimeout(
            copiedTimer.current,
          );
        }

        copiedTimer.current =
          setTimeout(() => {
            if (
              mountedRef.current
            ) {
              setCopied(false);
            }
          }, 1800);
      } catch {
        /*
         * Native share cancellation is intentionally
         * silent.
         */
      }
    }, [
      ensureRealId,
      saveNow,
      showNotice,
    ]);

  /* --------------------------------------------------
     Lock
  -------------------------------------------------- */

  const lockNote =
    useCallback(() => {
      const current =
        noteRef.current;

      if (!current) {
        return;
      }

      const id =
        realNoteIdRef.current ||
        (current.id !== 'new'
          ? current.id
          : null);

      setLocked(true);

      if (id) {
        writeLocalStorage(
          getLockStorageKey(
            id,
          ),
          '1',
        );
      }
    }, []);

  const unlockNote =
    useCallback(() => {
      const current =
        noteRef.current;

      const id =
        realNoteIdRef.current ||
        (current &&
        current.id !== 'new'
          ? current.id
          : null);

      setLocked(false);
      setUnlockPrompt(false);

      if (id) {
        removeLocalStorage(
          getLockStorageKey(
            id,
          ),
        );
      }
    }, []);

  /* --------------------------------------------------
     Formatting
  -------------------------------------------------- */

  const applyFormat =
    useCallback(
      (kind: FormatKind) => {
        const textarea =
          bodyRef.current;

        const current =
          noteRef.current;

        if (
          !textarea ||
          !current
        ) {
          return;
        }

        const {
          selectionStart,
          selectionEnd,
          value,
        } = textarea;

        let result;

        if (
          kind === 'bold'
        ) {
          result =
            wrapSelection(
              value,
              selectionStart,
              selectionEnd,
              '**',
            );
        } else if (
          kind === 'italic'
        ) {
          result =
            wrapSelection(
              value,
              selectionStart,
              selectionEnd,
              '*',
            );
        } else if (
          kind === 'underline'
        ) {
          result =
            wrapSelection(
              value,
              selectionStart,
              selectionEnd,
              '__',
            );
        } else if (
          kind === 'ol'
        ) {
          result =
            toggleBlockPrefix(
              value,
              selectionStart,
              selectionEnd,
              '1. ',
            );
        } else if (
          kind === 'ul'
        ) {
          result =
            toggleBlockPrefix(
              value,
              selectionStart,
              selectionEnd,
              '- ',
            );
        } else {
          result =
            toggleBlockPrefix(
              value,
              selectionStart,
              selectionEnd,
              '[ ] ',
            );
        }

        pushHistory(current);

        const next: EditorNote =
          {
            ...current,
            content:
              result.text,
          };

        noteRef.current =
          next;

        setNote(next);

        markDirty();

        requestAnimationFrame(
          () => {
            textarea.focus();

            textarea.setSelectionRange(
              result.selectionStart,
              result.selectionEnd,
            );
          },
        );
      },
      [
        markDirty,
        pushHistory,
      ],
    );

  /* --------------------------------------------------
     Categories
  -------------------------------------------------- */

  const categories =
    useMemo(
      () =>
        Array.from(
          new Set([
            ...CATEGORIES,
            note?.category || '',
          ]),
        ).filter(Boolean),
      [note?.category],
    );

  const commitCategory =
    useCallback(() => {
      const value =
        normalizeCategory(
          newCategory,
        );

      if (!value) {
        setShowNewCategory(
          false,
        );

        setNewCategory('');

        return;
      }

      updateNote({
        category: value,
      });

      setShowNewCategory(
        false,
      );

      setNewCategory('');
    }, [
      newCategory,
      updateNote,
    ]);

  /* --------------------------------------------------
     Derived values
  -------------------------------------------------- */

  const wordCount =
    note?.content.trim()
      ? note.content
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .length
      : 0;

  const characterCount =
    note?.content.length || 0;

  const canUndo =
    undoStackRef.current.length >
    0;

  const canRedo =
    redoStackRef.current.length >
    0;

  /*
   * Force toolbar rerender when history changes.
   */
  void historyVersion;

  /* --------------------------------------------------
     Loading
  -------------------------------------------------- */

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

  /* --------------------------------------------------
     Not found
  -------------------------------------------------- */

  if (notFound) {
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-[#FFF7F8] px-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm">
          <Trash2 className="h-6 w-6 text-[#9B9B9B]" />
        </div>

        <p className="mt-4 text-base font-bold">
          Note not found
        </p>

        <p className="mt-1 max-w-sm text-sm leading-relaxed text-[#6B6B6B]">
          It may have been deleted,
          moved, or you may no longer
          have permission to access it.
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

  const saveLabel =
    saveState === 'saving'
      ? 'Saving…'
      : saveState === 'saved'
        ? 'Saved'
        : saveState === 'error'
          ? 'Not saved'
          : '';

  /* --------------------------------------------------
     UI
  -------------------------------------------------- */

  return (
    <main className="min-h-[100dvh] bg-[#FFF7F8] text-[#111111]">
      <header className="sticky top-0 z-30 border-b border-[#E8E2E4]/70 bg-[#FFF7F8]/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-2 py-2 sm:px-4">
          <button
            type="button"
            onClick={() =>
              router.push('/notes')
            }
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition hover:bg-black/5 active:scale-95"
            aria-label="Back to notes"
            title="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() =>
                toggleFlag(
                  'pinned',
                )
              }
              aria-pressed={
                note.pinned
              }
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
                toggleFlag(
                  'favorite',
                )
              }
              aria-pressed={
                note.favorite
              }
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
                  setUnlockPrompt(
                    true,
                  );
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
                toggleFlag(
                  'archived',
                )
              }
              aria-pressed={
                note.archived
              }
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
              The editor is hidden on
              this device. This local
              lock does not encrypt the
              database record.
            </p>

            <button
              type="button"
              onClick={() =>
                setUnlockPrompt(
                  true,
                )
              }
              className="mt-5 rounded-xl bg-black px-5 py-2.5 text-sm font-semibold text-[#FFB6C1] transition hover:opacity-90 active:scale-[0.98]"
            >
              Unlock
            </button>
          </div>
        </div>
      )}

      <div
        className={`mx-auto max-w-2xl px-4 pb-36 pt-4 sm:px-6 ${
          locked
            ? 'pointer-events-none select-none blur-[7px] opacity-60'
            : ''
        }`}
        aria-hidden={
          locked
        }
      >
        <textarea
          ref={titleRef}
          value={note.title}
          maxLength={
            MAX_TITLE_LENGTH
          }
          rows={1}
          placeholder="title"
          aria-label="Note title"
          onChange={(event) => {
            const value =
              event.target.value
                .replace(
                  /\n/g,
                  '',
                )
                .slice(
                  0,
                  MAX_TITLE_LENGTH,
                );

            updateNote({
              title: value,
            });

            requestAnimationFrame(
              resizeTitle,
            );
          }}
          onKeyDown={(event) => {
            if (
              event.key ===
              'Enter'
            ) {
              event.preventDefault();
              bodyRef.current?.focus();
            }
          }}
          className="w-full resize-none overflow-hidden bg-transparent text-4xl font-extrabold tracking-tight placeholder:text-[#C9C0C4] focus:outline-none sm:text-5xl"
        />

        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#6B6B6B] sm:text-sm">
          <span>
            {formatTimestamp(
              note.updated_at,
            )}
          </span>

          {saveLabel && (
            <span
              className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                saveState ===
                'error'
                  ? 'bg-red-50 text-red-600'
                  : saveState ===
                      'saving'
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-[#FFF0F3] text-[#E5798F]'
              }`}
            >
              {saveState ===
                'saving' && (
                <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
              )}

              {saveLabel}
            </span>
          )}
        </div>

        <hr className="mt-3 border-[#E8E2E4]" />

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {categories.map(
            (category) => (
              <button
                key={category}
                type="button"
                onClick={() =>
                  updateNote({
                    category,
                  })
                }
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
                maxLength={
                  MAX_CATEGORY_LENGTH
                }
                placeholder="category…"
                aria-label="New category"
                onChange={(event) =>
                  setNewCategory(
                    event.target.value
                      .toLowerCase()
                      .replace(
                        /[^a-z0-9 -]/g,
                        '',
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
                    commitCategory();
                  }

                  if (
                    event.key ===
                    'Escape'
                  ) {
                    event.preventDefault();
                    setShowNewCategory(
                      false,
                    );
                    setNewCategory(
                      '',
                    );
                  }
                }}
                className="w-32 rounded-full border border-[#E5798F] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFD2DE]"
              />

              <button
                type="button"
                onClick={() => {
                  setShowNewCategory(
                    false,
                  );
                  setNewCategory(
                    '',
                  );
                }}
                className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-gray-100"
                aria-label="Cancel category"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() =>
                setShowNewCategory(
                  true,
                )
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
              applyFormat(
                'bold',
              )
            }
          >
            <BoldIcon className="h-4 w-4" />
          </ToolbarButton>

          <ToolbarButton
            label="Italic"
            onClick={() =>
              applyFormat(
                'italic',
              )
            }
          >
            <ItalicIcon className="h-4 w-4 italic" />
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
            label="Numbered list"
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
              applyFormat(
                'check',
              )
            }
          >
            <CheckSquare className="h-4 w-4" />
          </ToolbarButton>

          <ToolbarDivider />

          <ToolbarButton
            label="Delete note"
            danger
            onClick={() =>
              setDeletePrompt(
                true,
              )
            }
          >
            <Trash2 className="h-4 w-4" />
          </ToolbarButton>
        </div>

        <textarea
          ref={bodyRef}
          value={note.content}
          placeholder="what's on your mind?"
          aria-label="Note body"
          spellCheck
          className="mt-5 min-h-[48dvh] w-full resize-none bg-transparent text-[17px] leading-[1.85] placeholder:text-[#C9C0C4] focus:outline-none sm:min-h-[55dvh] sm:text-lg"
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
              applyFormat(
                'bold',
              );
              return;
            }

            if (
              modifier &&
              event.key.toLowerCase() ===
                'i'
            ) {
              event.preventDefault();
              applyFormat(
                'italic',
              );
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
            }
          }}
        />

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
            {MAX_TITLE_LENGTH}
          </span>
        </div>
      </div>

      {notice && (
        <StyledAlert
          notice={notice}
          onClose={() =>
            setNotice(null)
          }
        />
      )}

      {deletePrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={() => {
            if (!deleting) {
              setDeletePrompt(
                false,
              );
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
            aria-labelledby="delete-title"
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-500">
              <Trash2 className="h-5 w-5" />
            </div>

            <h2
              id="delete-title"
              className="mt-4 text-center text-base font-bold"
            >
              Delete this note?
            </h2>

            <p className="mt-1 text-center text-sm leading-relaxed text-[#6B6B6B]">
              This permanently removes
              the note from your account.
              This action cannot be undone.
            </p>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() =>
                  setDeletePrompt(
                    false,
                  )
                }
                className="rounded-2xl border border-[#E8E2E4] px-4 py-3 text-sm font-semibold transition hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={deleting}
                onClick={() =>
                  void onDelete()
                }
                className="rounded-2xl bg-red-500 px-4 py-3 text-sm font-bold text-white transition hover:bg-red-600 disabled:opacity-60"
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

      {unlockPrompt && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={() =>
            setUnlockPrompt(
              false,
            )
          }
        >
          <div
            className="w-full max-w-xs rounded-3xl bg-white p-6 text-center shadow-2xl"
            onClick={(event) =>
              event.stopPropagation()
            }
            role="dialog"
            aria-modal="true"
            aria-labelledby="unlock-title"
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FFF0F3] text-[#E5798F]">
              <Lock className="h-5 w-5" />
            </div>

            <p
              id="unlock-title"
              className="mt-3 text-sm font-bold"
            >
              Unlock this note?
            </p>

            <p className="mt-1 text-xs leading-relaxed text-[#6B6B6B]">
              This local lock does not
              encrypt the database record.
            </p>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() =>
                  setUnlockPrompt(
                    false,
                  )
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

      {copied && (
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-30 -translate-x-1/2">
          <div className="rounded-full bg-black px-4 py-2.5 text-xs font-semibold text-[#FFB6C1] shadow-xl">
            <Copy className="mr-1.5 inline h-3.5 w-3.5" />
            Link copied
          </div>
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
  danger = false,
  disabled = false,
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
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
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
