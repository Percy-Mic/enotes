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
  Copy,
  FileText,
  Highlighter,
  Italic,
  Link2,
  List,
  ListOrdered,
  Lock,
  Pin,
  Quote,
  Redo2,
  Save,
  Share2,
  Strikethrough,
  Trash2,
  Underline,
  Undo2,
  Unlock,
  Palette,
  Type,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import type { NoteRow } from '@/app/notes/page';

const CATEGORIES = [
  'general',
  'ideas',
  'work',
  'personal',
  'reading',
] as const;

type SaveState = 'saved' | 'saving' | 'error';

type DraftSnapshot = {
  title: string;
  content: string;
  category: string;
  is_pinned: boolean;
  is_favorite: boolean;
  is_archived: boolean;
};

interface EditorNote extends NoteRow {
  title: string;
  content: string;
  category: string;
  is_pinned: boolean;
  is_favorite: boolean;
  is_archived: boolean;
}

function normalizeCategory(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .slice(0, 40);
}

function formatTimestamp(
  iso: string | null | undefined,
): string {
  if (!iso) return 'not saved yet';

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return 'not saved yet';
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function createEmptyNote(): EditorNote {
  return {
    id: 'new',
    title: '',
    content: '',
    category: 'general',
    is_pinned: false,
    is_favorite: false,
    is_archived: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as EditorNote;
}

function snapshotNote(
  note: EditorNote,
): DraftSnapshot {
  return {
    title: note.title ?? '',
    content: note.content ?? '',
    category: note.category ?? 'general',
    is_pinned: Boolean(note.is_pinned),
    is_favorite: Boolean(note.is_favorite),
    is_archived: Boolean(note.is_archived),
  };
}

function countWords(html: string): number {
  if (!html) return 0;

  const temporary = document.createElement('div');
  temporary.innerHTML = html;

  const text =
    temporary.textContent ||
    temporary.innerText ||
    '';

  const cleaned = text.trim();

  if (!cleaned) return 0;

  return cleaned.split(/\s+/).length;
}

function countCharacters(html: string): number {
  if (!html) return 0;

  const temporary = document.createElement('div');
  temporary.innerHTML = html;

  return (
    temporary.textContent ||
    temporary.innerText ||
    ''
  ).length;
}

function ToolbarButton({
  label,
  onMouseDown,
  disabled = false,
  active = false,
  children,
}: {
  label: string;
  onMouseDown: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseDown={(event) => {
        event.preventDefault();

        if (!disabled) {
          onMouseDown();
        }
      }}
      className={[
        'inline-flex h-9 min-w-9 shrink-0 items-center justify-center rounded-lg',
        'border px-2 transition-all duration-150',
        disabled
          ? 'cursor-not-allowed border-transparent text-black/20'
          : active
            ? 'border-[#E5798F]/30 bg-[#E5798F]/10 text-[#C95F76]'
            : 'border-transparent text-black/65 hover:border-black/10 hover:bg-black/5 hover:text-black',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return (
    <div className="mx-1 h-6 w-px shrink-0 bg-black/8" />
  );
}

function NoteEditor() {
  const params = useParams();
  const router = useRouter();

  const supabase = useMemo(
    () => createClient(),
    [],
  );

  const routeId =
    typeof params?.id === 'string'
      ? params.id
      : 'new';

  const initialRouteIdRef =
    useRef(routeId);

  const isNew =
    initialRouteIdRef.current === 'new';

  const initialNote = useMemo(
    () => (isNew ? createEmptyNote() : null),
    [isNew],
  );

  const [note, setNote] =
    useState<EditorNote | null>(
      initialNote,
    );

  const [loading, setLoading] =
    useState(!isNew);

  const [saveState, setSaveState] =
    useState<SaveState>(
      isNew ? 'saved' : 'saving',
    );

  const [notice, setNotice] =
    useState<string | null>(null);

  const [locked, setLocked] =
    useState(false);

  const [newCategory, setNewCategory] =
    useState('');

  const [
    showCategoryMenu,
    setShowCategoryMenu,
  ] = useState(false);

  const [deleting, setDeleting] =
    useState(false);

  const [undoCount, setUndoCount] =
    useState(0);

  const [redoCount, setRedoCount] =
    useState(0);

  const [heading, setHeading] =
    useState('p');

  const [fontSize, setFontSize] =
    useState('3');

  const [editorFocused, setEditorFocused] =
    useState(false);

  const titleRef =
    useRef<HTMLTextAreaElement | null>(
      null,
    );

  const editorRef =
    useRef<HTMLDivElement | null>(
      null,
    );

  const noteRef =
    useRef<EditorNote | null>(
      initialNote,
    );

  const saveTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );

  const dirtyRef =
    useRef(false);

  const saveVersionRef =
    useRef(0);

  const saveInFlightRef =
    useRef<Promise<boolean> | null>(
      null,
    );

  const creatingRef =
    useRef<Promise<string | null> | null>(
      null,
    );

  const realNoteIdRef =
    useRef<string | null>(
      isNew ? null : routeId,
    );

  const undoStackRef =
    useRef<DraftSnapshot[]>([]);

  const redoStackRef =
    useRef<DraftSnapshot[]>([]);

  const lastHistoryTimeRef =
    useRef(0);

  const showNotice = useCallback(
    (message: string) => {
      setNotice(message);

      window.setTimeout(() => {
        setNotice((current) =>
          current === message
            ? null
            : current,
        );
      }, 2800);
    },
    [],
  );

  const pushHistory = useCallback(
    (current: EditorNote) => {
      const now = Date.now();

      if (
        now - lastHistoryTimeRef.current >
        500
      ) {
        undoStackRef.current.push(
          snapshotNote(current),
        );

        if (
          undoStackRef.current.length >
          100
        ) {
          undoStackRef.current.shift();
        }

        setUndoCount(
          undoStackRef.current.length,
        );
      }

      lastHistoryTimeRef.current =
        now;

      redoStackRef.current = [];
      setRedoCount(0);
    },
    [],
  );

  const markDirty = useCallback(() => {
    dirtyRef.current = true;

    saveVersionRef.current += 1;

    setSaveState('saving');

    if (saveTimerRef.current) {
      clearTimeout(
        saveTimerRef.current,
      );
    }

    saveTimerRef.current =
      setTimeout(() => {
        void saveNow();
      }, 800);
  }, []);

  const commitNote = useCallback(
    (
      updater: (
        current: EditorNote,
      ) => EditorNote,
      options: {
        history?: boolean;
        autosave?: boolean;
      } = {},
    ) => {
      const current =
        noteRef.current;

      if (!current) return;

      const next = updater(current);

      if (options.history !== false) {
        pushHistory(current);
      }

      noteRef.current = next;
      setNote(next);

      if (options.autosave !== false) {
        markDirty();
      }
    },
    [markDirty, pushHistory],
  );

  const ensureRow = useCallback(
    async (): Promise<string | null> => {
      if (realNoteIdRef.current) {
        return realNoteIdRef.current;
      }

      if (creatingRef.current) {
        return creatingRef.current;
      }

      const creation =
        (async () => {
          const current =
            noteRef.current;

          if (!current) return null;

          const {
            data: {
              user,
            },
          } =
            await supabase.auth.getUser();

          if (!user) {
            showNotice(
              'Your session has expired. Please sign in again.',
            );

            return null;
          }

          const title =
            current.title.trim();

          const category =
            normalizeCategory(
              current.category,
            ) || 'general';

          const {
            data,
            error,
          } = await supabase
            .from('notes')
            .insert({
              user_id: user.id,
              title,
              content:
                current.content,
              category,
              is_pinned:
                current.is_pinned,
              is_favorite:
                current.is_favorite,
              is_archived:
                current.is_archived,
            })
            .select('*')
            .single();

          if (
            error ||
            !data
          ) {
            console.error(
              'Create note error:',
              error,
            );

            setSaveState('error');

            showNotice(
              error?.message ||
                'Unable to create the note.',
            );

            return null;
          }

          const created =
            data as EditorNote;

          realNoteIdRef.current =
            created.id;

          const latest =
            noteRef.current;

          if (latest) {
            const merged: EditorNote =
              {
                ...latest,
                ...created,
                title:
                  latest.title,
                content:
                  latest.content,
                category:
                  latest.category,
                is_pinned:
                  latest.is_pinned,
                is_favorite:
                  latest.is_favorite,
                is_archived:
                  latest.is_archived,
              };

            noteRef.current =
              merged;

            setNote(merged);
          }

          router.replace(
            `/notes/${created.id}`,
          );

          return created.id;
        })();

      creatingRef.current =
        creation;

      void creation.then(
        () => {
          creatingRef.current =
            null;
        },
        () => {
          creatingRef.current =
            null;
        },
      );

      return creation;
    },
    [
      router,
      showNotice,
      supabase,
    ],
  );

  const saveNow = useCallback(
    async (): Promise<boolean> => {
      if (
        saveInFlightRef.current
      ) {
        return saveInFlightRef.current;
      }

      const savePromise =
        (async () => {
          try {
            while (dirtyRef.current) {
              const current =
                noteRef.current;

              if (!current) {
                dirtyRef.current =
                  false;

                setSaveState(
                  'saved',
                );

                return true;
              }

              const versionAtStart =
                saveVersionRef.current;

              let id =
                realNoteIdRef.current;

              if (!id) {
                id =
                  await ensureRow();

                if (!id) {
                  return false;
                }
              }

              const latest =
                noteRef.current;

              if (!latest) {
                return false;
              }

              setSaveState(
                'saving',
              );

              const title =
                latest.title.trim();

              const category =
                normalizeCategory(
                  latest.category,
                ) || 'general';

              const {
                error,
              } =
                await supabase
                  .from('notes')
                  .update({
                    title,
                    content:
                      latest.content,
                    category,
                    is_pinned:
                      latest.is_pinned,
                    is_favorite:
                      latest.is_favorite,
                    is_archived:
                      latest.is_archived,
                    updated_at:
                      new Date().toISOString(),
                  })
                  .eq(
                    'id',
                    id,
                  );

              if (error) {
                console.error(
                  'Save note error:',
                  error,
                );

                setSaveState(
                  'error',
                );

                showNotice(
                  error.message ||
                    'Unable to save your changes.',
                );

                return false;
              }

              if (
                versionAtStart ===
                saveVersionRef.current
              ) {
                dirtyRef.current =
                  false;

                setSaveState(
                  'saved',
                );

                return true;
              }
            }

            setSaveState(
              'saved',
            );

            return true;
          } catch (error) {
            console.error(
              'Unexpected save error:',
              error,
            );

            setSaveState(
              'error',
            );

            showNotice(
              'Something went wrong while saving.',
            );

            return false;
          }
        })();

      saveInFlightRef.current =
        savePromise;

      try {
        return await savePromise;
      } finally {
        saveInFlightRef.current =
          null;
      }
    },
    [
      ensureRow,
      showNotice,
      supabase,
    ],
  );

  const executeCommand =
    useCallback(
      (
        command: string,
        value?: string,
      ) => {
        if (locked) return;

        const editor =
          editorRef.current;

        if (!editor) return;

        editor.focus();

        try {
          document.execCommand(
            command,
            false,
            value,
          );
        } catch (error) {
          console.error(
            `Editor command failed: ${command}`,
            error,
          );
        }

        const html =
          editor.innerHTML;

        commitNote((current) => ({
          ...current,
          content: html,
        }));
      },
      [commitNote, locked],
    );

  const applyHeading =
    useCallback(
      (value: string) => {
        setHeading(value);

        executeCommand(
          'formatBlock',
          value,
        );
      },
      [executeCommand],
    );

  const applyFontSize =
    useCallback(
      (value: string) => {
        setFontSize(value);

        executeCommand(
          'fontSize',
          value,
        );
      },
      [executeCommand],
    );

  const insertLink =
    useCallback(() => {
      if (locked) return;

      const editor =
        editorRef.current;

      if (!editor) return;

      editor.focus();

      const selection =
        window.getSelection();

      const selectedText =
        selection?.toString() || '';

      const url =
        window.prompt(
          'Enter the URL',
          'https://',
        );

      if (!url) return;

      let safeUrl =
        url.trim();

      if (
        !/^https?:\/\//i.test(
          safeUrl,
        ) &&
        !/^mailto:/i.test(
          safeUrl,
        )
      ) {
        safeUrl =
          `https://${safeUrl}`;
      }

      if (selectedText) {
        document.execCommand(
          'createLink',
          false,
          safeUrl,
        );
      } else {
        const label =
          window.prompt(
            'Link text',
            safeUrl,
          );

        if (!label) return;

        document.execCommand(
          'insertHTML',
          false,
          `<a href="${safeUrl.replace(
            /"/g,
            '&quot;',
          )}" target="_blank" rel="noopener noreferrer">${label}</a>`,
        );
      }

      commitNote((current) => ({
        ...current,
        content:
          editor.innerHTML,
      }));
    },
    [commitNote, locked],
  );

  const insertChecklist =
    useCallback(() => {
      if (locked) return;

      const editor =
        editorRef.current;

      if (!editor) return;

      editor.focus();

      document.execCommand(
        'insertHTML',
        false,
        '<div data-enotes-checklist="true" class="enotes-checklist"><span contenteditable="false" class="enotes-checkbox">☐</span>&nbsp;</div>',
      );

      commitNote((current) => ({
        ...current,
        content:
          editor.innerHTML,
      }));
    }, [commitNote, locked]);

  const insertHorizontalRule =
    useCallback(() => {
      executeCommand(
        'insertHorizontalRule',
      );
    }, [executeCommand]);

  const changeTextColor =
    useCallback(() => {
      if (locked) return;

      const color =
        window.prompt(
          'Enter a color',
          '#E5798F',
        );

      if (!color) return;

      executeCommand(
        'foreColor',
        color.trim(),
      );
    }, [executeCommand, locked]);

  const changeHighlight =
    useCallback(() => {
      if (locked) return;

      const color =
        window.prompt(
          'Enter highlight color',
          '#FFF2A8',
        );

      if (!color) return;

      executeCommand(
        'hiliteColor',
        color.trim(),
      );
    }, [executeCommand, locked]);

  const toggleCode =
    useCallback(() => {
      if (locked) return;

      const editor =
        editorRef.current;

      if (!editor) return;

      editor.focus();

      const selection =
        window.getSelection();

      if (
        selection &&
        selection.rangeCount > 0 &&
        selection.toString()
      ) {
        const selected =
          selection.toString();

        document.execCommand(
          'insertHTML',
          false,
          `<code>${selected
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')}</code>`,
        );
      } else {
        document.execCommand(
          'formatBlock',
          false,
          'pre',
        );
      }

      commitNote((current) => ({
        ...current,
        content:
          editor.innerHTML,
      }));
    }, [commitNote, locked]);

  const undo = useCallback(() => {
    const current =
      noteRef.current;

    if (
      !current ||
      undoStackRef.current
        .length === 0
    ) {
      return;
    }

    const previous =
      undoStackRef.current.pop();

    if (!previous) return;

    redoStackRef.current.push(
      snapshotNote(current),
    );

    const next: EditorNote = {
      ...current,
      ...previous,
    };

    noteRef.current =
      next;

    setNote(next);

    setUndoCount(
      undoStackRef.current.length,
    );

    setRedoCount(
      redoStackRef.current.length,
    );

    lastHistoryTimeRef.current =
      Date.now();

    markDirty();

    requestAnimationFrame(() => {
      if (
        editorRef.current
      ) {
        editorRef.current.innerHTML =
          next.content || '';

        editorRef.current.focus();
      }
    });
  }, [markDirty]);

  const redo = useCallback(() => {
    const current =
      noteRef.current;

    if (
      !current ||
      redoStackRef.current
        .length === 0
    ) {
      return;
    }

    const nextSnapshot =
      redoStackRef.current.pop();

    if (!nextSnapshot) return;

    undoStackRef.current.push(
      snapshotNote(current),
    );

    const next: EditorNote = {
      ...current,
      ...nextSnapshot,
    };

    noteRef.current =
      next;

    setNote(next);

    setUndoCount(
      undoStackRef.current.length,
    );

    setRedoCount(
      redoStackRef.current.length,
    );

    lastHistoryTimeRef.current =
      Date.now();

    markDirty();

    requestAnimationFrame(() => {
      if (
        editorRef.current
      ) {
        editorRef.current.innerHTML =
          next.content || '';

        editorRef.current.focus();
      }
    });
  }, [markDirty]);

  const handleEditorInput =
    useCallback(() => {
      const editor =
        editorRef.current;

      if (!editor) return;

      const html =
        editor.innerHTML;

      const plainText =
        editor.textContent?.trim() ||
        '';

      const normalizedHtml =
        plainText ||
        editor.querySelector(
          'img, hr, table',
        )
          ? html
          : '';

      commitNote((current) => ({
        ...current,
        content:
          normalizedHtml,
      }));
    }, [commitNote]);

  const handleEditorKeyDown =
    useCallback(
      (
        event: React.KeyboardEvent<HTMLDivElement>,
      ) => {
        const modifier =
          event.ctrlKey ||
          event.metaKey;

        const key =
          event.key.toLowerCase();

        if (
          modifier &&
          key === 'b'
        ) {
          event.preventDefault();
          executeCommand('bold');
          return;
        }

        if (
          modifier &&
          key === 'i'
        ) {
          event.preventDefault();
          executeCommand('italic');
          return;
        }

        if (
          modifier &&
          key === 'u'
        ) {
          event.preventDefault();
          executeCommand('underline');
          return;
        }

        if (
          modifier &&
          key === 's'
        ) {
          event.preventDefault();

          if (
            saveTimerRef.current
          ) {
            clearTimeout(
              saveTimerRef.current,
            );

            saveTimerRef.current =
              null;
          }

          void saveNow();
          return;
        }

        if (
          modifier &&
          key === 'z' &&
          !event.shiftKey
        ) {
          event.preventDefault();
          undo();
          return;
        }

        if (
          modifier &&
          (
            key === 'y' ||
            (
              key === 'z' &&
              event.shiftKey
            )
          )
        ) {
          event.preventDefault();
          redo();
          return;
        }

        if (
          event.key === 'Tab'
        ) {
          event.preventDefault();

          executeCommand(
            'insertText',
            '    ',
          );
        }
      },
      [
        executeCommand,
        redo,
        saveNow,
        undo,
      ],
    );

  const toggleFlag =
    useCallback(
      (
        field:
          | 'is_pinned'
          | 'is_favorite'
          | 'is_archived',
      ) => {
        commitNote((current) => ({
          ...current,
          [field]:
            !current[field],
        }));
      },
      [commitNote],
    );

  const selectCategory =
    useCallback(
      (category: string) => {
        const normalized =
          normalizeCategory(
            category,
          ) || 'general';

        commitNote((current) => ({
          ...current,
          category:
            normalized,
        }));

        setShowCategoryMenu(
          false,
        );
      },
      [commitNote],
    );

  const addCategory =
    useCallback(() => {
      const category =
        normalizeCategory(
          newCategory,
        );

      if (!category) {
        showNotice(
          'Enter a category name.',
        );

        return;
      }

      selectCategory(category);

      setNewCategory('');
    }, [
      newCategory,
      selectCategory,
      showNotice,
    ]);

  const toggleLocalLock =
    useCallback(() => {
      const next =
        !locked;

      setLocked(next);

      const id =
        realNoteIdRef.current;

      if (id) {
        try {
          if (next) {
            window.localStorage.setItem(
              `enotes:note-lock:${id}`,
              '1',
            );
          } else {
            window.localStorage.removeItem(
              `enotes:note-lock:${id}`,
            );
          }
        } catch {
          // Ignore local storage errors.
        }
      }

      showNotice(
        next
          ? 'Note locked on this device.'
          : 'Note unlocked.',
      );
    }, [
      locked,
      showNotice,
    ]);

  const copyText =
    useCallback(
      async (
        value: string,
      ) => {
        try {
          if (
            navigator.clipboard &&
            window.isSecureContext
          ) {
            await navigator.clipboard.writeText(
              value,
            );

            return true;
          }

          const textarea =
            document.createElement(
              'textarea',
            );

          textarea.value =
            value;

          textarea.style.position =
            'fixed';

          textarea.style.opacity =
            '0';

          document.body.appendChild(
            textarea,
          );

          textarea.focus();
          textarea.select();

          const copied =
            document.execCommand(
              'copy',
            );

          textarea.remove();

          return copied;
        } catch {
          return false;
        }
      },
      [],
    );

  const onShare =
    useCallback(async () => {
      if (locked) {
        showNotice(
          'Unlock the note before sharing.',
        );

        return;
      }

      if (
        saveTimerRef.current
      ) {
        clearTimeout(
          saveTimerRef.current,
        );

        saveTimerRef.current =
          null;
      }

      const saved =
        await saveNow();

      if (!saved) {
        showNotice(
          'Save failed. Please try again.',
        );

        return;
      }

      const id =
        await ensureRow();

      if (!id) {
        showNotice(
          'Unable to prepare the share link.',
        );

        return;
      }

      const latest =
        noteRef.current;

      const url =
        `${window.location.origin}/notes/${id}`;

      const title =
        latest?.title?.trim() ||
        'My note';

      const text =
        latest?.content
          ? (() => {
              const element =
                document.createElement(
                  'div',
                );

              element.innerHTML =
                latest.content;

              return (
                element.textContent ||
                title
              ).slice(0, 500);
            })()
          : title;

      try {
        if (
          navigator.share
        ) {
          await navigator.share({
            title,
            text,
            url,
          });

          return;
        }
      } catch (error) {
        if (
          error instanceof
            DOMException &&
          error.name ===
            'AbortError'
        ) {
          return;
        }
      }

      const copied =
        await copyText(url);

      if (copied) {
        showNotice(
          'Note link copied.',
        );
      } else {
        showNotice(
          'Unable to copy the share link.',
        );
      }
    }, [
      copyText,
      ensureRow,
      locked,
      saveNow,
      showNotice,
    ]);

  const onDelete =
    useCallback(async () => {
      if (deleting) return;

      const current =
        noteRef.current;

      if (!current) return;

      const confirmed =
        window.confirm(
          'Delete this note permanently? This action cannot be undone.',
        );

      if (!confirmed) return;

      setDeleting(true);

      try {
        if (dirtyRef.current) {
          const saved =
            await saveNow();

          if (!saved) {
            showNotice(
              'The note could not be saved before deletion.',
            );

            return;
          }
        }

        const id =
          realNoteIdRef.current;

        if (!id) {
          router.replace('/notes');
          return;
        }

        const { error } =
          await supabase
            .from('notes')
            .delete()
            .eq(
              'id',
              id,
            );

        if (error) {
          console.error(
            'Delete note error:',
            error,
          );

          showNotice(
            error.message ||
              'Unable to delete the note.',
          );

          return;
        }

        try {
          window.localStorage.removeItem(
            `enotes:note-lock:${id}`,
          );
        } catch {
          // Ignore storage errors.
        }

        router.replace('/notes');
      } finally {
        setDeleting(false);
      }
    }, [
      deleting,
      router,
      saveNow,
      showNotice,
      supabase,
    ]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (isNew) {
        const draft =
          createEmptyNote();

        noteRef.current =
          draft;

        setNote(draft);

        setLoading(false);

        return;
      }

      setLoading(true);

      const {
        data: {
          user,
        },
      } =
        await supabase.auth.getUser();

      if (!user) {
        router.replace('/signin');
        return;
      }

      const {
        data,
        error,
      } =
        await supabase
          .from('notes')
          .select('*')
          .eq(
            'id',
            routeId,
          )
          .eq(
            'user_id',
            user.id,
          )
          .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.error(
          'Load note error:',
          error,
        );

        showNotice(
          'Unable to load this note.',
        );

        setLoading(false);

        return;
      }

      if (!data) {
        router.replace('/notes');
        return;
      }

      const loaded =
        data as EditorNote;

      noteRef.current =
        loaded;

      setNote(loaded);

      realNoteIdRef.current =
        loaded.id;

      dirtyRef.current =
        false;

      setSaveState('saved');

      undoStackRef.current =
        [];

      redoStackRef.current =
        [];

      setUndoCount(0);
      setRedoCount(0);

      try {
        const localLock =
          window.localStorage.getItem(
            `enotes:note-lock:${loaded.id}`,
          ) === '1';

        setLocked(
          localLock,
        );
      } catch {
        // Ignore storage errors.
      }

      setLoading(false);
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [
    isNew,
    routeId,
    router,
    showNotice,
    supabase,
  ]);

  useEffect(() => {
    const editor =
      editorRef.current;

    if (
      !editor ||
      !note
    ) {
      return;
    }

    const currentHtml =
      editor.innerHTML;

    if (
      currentHtml !==
      (note.content || '')
    ) {
      editor.innerHTML =
        note.content || '';
    }
  }, [note?.id]);

  useEffect(() => {
    return () => {
      if (
        saveTimerRef.current
      ) {
        clearTimeout(
          saveTimerRef.current,
        );
      }

      if (
        dirtyRef.current
      ) {
        void saveNow();
      }
    };
  }, [saveNow]);

  useEffect(() => {
    const handleVisibility =
      () => {
        if (
          document.visibilityState ===
          'hidden'
        ) {
          if (
            saveTimerRef.current
          ) {
            clearTimeout(
              saveTimerRef.current,
            );

            saveTimerRef.current =
              null;
          }

          if (
            dirtyRef.current
          ) {
            void saveNow();
          }
        }
      };

    document.addEventListener(
      'visibilitychange',
      handleVisibility,
    );

    return () => {
      document.removeEventListener(
        'visibilitychange',
        handleVisibility,
      );
    };
  }, [saveNow]);

  useEffect(() => {
    const textarea =
      titleRef.current;

    if (!textarea) return;

    textarea.style.height =
      '0px';

    textarea.style.height =
      `${Math.min(
        Math.max(
          textarea.scrollHeight,
          56,
        ),
        180,
      )}px`;
  }, [note?.title]);

  useEffect(() => {
    const handleChecklistClick =
      (event: MouseEvent) => {
        const target =
          event.target as HTMLElement;

        if (
          !target.classList.contains(
            'enotes-checkbox',
          )
        ) {
          return;
        }

        event.preventDefault();

        const current =
          target.textContent ===
          '☑';

        target.textContent =
          current ? '☐' : '☑';

        target.classList.toggle(
          'enotes-checkbox-checked',
          !current,
        );

        handleEditorInput();
      };

    const editor =
      editorRef.current;

    if (!editor) return;

    editor.addEventListener(
      'click',
      handleChecklistClick,
    );

    return () => {
      editor.removeEventListener(
        'click',
        handleChecklistClick,
      );
    };
  }, [
    handleEditorInput,
  ]);

  const categories =
    useMemo(() => {
      const values = [
        ...CATEGORIES,
        note?.category || '',
      ];

      return Array.from(
        new Set(
          values
            .map(
              normalizeCategory,
            )
            .filter(Boolean),
        ),
      );
    }, [note?.category]);

  const wordCount =
    typeof document !== 'undefined' &&
    note
      ? countWords(
          note.content || '',
        )
      : 0;

  const characterCount =
    typeof document !== 'undefined' &&
    note
      ? countCharacters(
          note.content || '',
        )
      : 0;

  if (
    loading ||
    !note
  ) {
    return (
      <main className="min-h-screen bg-[#FFF7F8] px-4 py-8">
        <div className="mx-auto max-w-5xl">
          <div className="h-6 w-28 animate-pulse rounded bg-black/5" />

          <div className="mt-8 rounded-3xl border border-black/5 bg-white/75 p-6 shadow-sm">
            <div className="h-10 w-2/3 animate-pulse rounded bg-black/5" />

            <div className="mt-6 h-80 animate-pulse rounded-2xl bg-black/5" />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#FFF7F8] text-black">
      <div className="mx-auto w-full max-w-7xl px-2 pb-8 pt-2 sm:px-4 sm:pt-4 lg:px-7">
        <header className="sticky top-0 z-40 mb-3 rounded-2xl border border-black/5 bg-[#FFF7F8]/90 px-2 py-2 backdrop-blur-xl sm:px-3">
          <div className="flex min-h-12 items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1">
              <Link
                href="/notes"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-black/65 transition hover:bg-black/5 hover:text-black"
                aria-label="Back to notes"
              >
                <svg
                  width="19"
                  height="19"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </Link>

              <div className="hidden min-w-0 sm:block">
                <div className="flex items-center gap-2">
                  <FileText
                    size={17}
                    className="text-[#E5798F]"
                  />

                  <span className="truncate text-sm font-semibold">
                    {note.title.trim() ||
                      'Untitled note'}
                  </span>
                </div>

                <div className="mt-0.5 text-[11px] text-black/40">
                  {saveState ===
                  'saving'
                    ? 'Saving changes…'
                    : saveState ===
                        'error'
                      ? 'Save failed'
                      : `Saved ${formatTimestamp(note.updated_at)}`}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <div
                className={[
                  'hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium sm:flex',
                  saveState === 'error'
                    ? 'bg-red-50 text-red-600'
                    : saveState === 'saving'
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-emerald-50 text-emerald-700',
                ].join(' ')}
              >
                {saveState ===
                'saved' ? (
                  <Check size={13} />
                ) : (
                  <Save size={13} />
                )}

                {saveState ===
                'saving'
                  ? 'Saving'
                  : saveState ===
                      'error'
                    ? 'Error'
                    : 'Saved'}
              </div>

              <button
                type="button"
                onClick={() =>
                  toggleFlag(
                    'is_pinned',
                  )
                }
                className={[
                  'hidden h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-medium transition sm:flex',
                  note.is_pinned
                    ? 'bg-amber-50 text-amber-700'
                    : 'text-black/60 hover:bg-black/5',
                ].join(' ')}
                title="Pin note"
              >
                <Pin size={16} />

                {note.is_pinned
                  ? 'Pinned'
                  : 'Pin'}
              </button>

              <button
                type="button"
                onClick={
                  toggleLocalLock
                }
                className={[
                  'inline-flex h-10 w-10 items-center justify-center rounded-xl transition',
                  locked
                    ? 'bg-black text-white'
                    : 'text-black/60 hover:bg-black/5 hover:text-black',
                ].join(' ')}
                title={
                  locked
                    ? 'Unlock note'
                    : 'Lock note'
                }
              >
                {locked ? (
                  <Lock size={17} />
                ) : (
                  <Unlock size={17} />
                )}
              </button>

              <button
                type="button"
                onClick={onShare}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-black/60 transition hover:bg-black/5 hover:text-black"
                title="Share note"
              >
                <Share2 size={17} />
              </button>

              <button
                type="button"
                onClick={onDelete}
                disabled={deleting}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-red-500 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                title="Delete note"
              >
                <Trash2 size={17} />
              </button>
            </div>
          </div>
        </header>

        <section className="overflow-hidden rounded-[26px] border border-black/5 bg-white shadow-[0_18px_60px_rgba(0,0,0,0.07)]">
          <div className="flex flex-wrap items-center gap-2 border-b border-black/5 px-3 py-3 sm:px-5">
            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  setShowCategoryMenu(
                    (value) => !value,
                  )
                }
                className="inline-flex items-center gap-2 rounded-full border border-black/8 bg-[#FFF7F8] px-3 py-1.5 text-xs font-medium text-black/65 transition hover:border-[#E5798F]/30"
              >
                <span className="h-2 w-2 rounded-full bg-[#E5798F]" />

                {note.category ||
                  'general'}

                <ChevronDown
                  size={13}
                />
              </button>

              {showCategoryMenu && (
                <div className="absolute left-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-black/8 bg-white p-2 shadow-2xl">
                  <div className="max-h-52 overflow-y-auto">
                    {categories.map(
                      (category) => (
                        <button
                          key={category}
                          type="button"
                          onClick={() =>
                            selectCategory(
                              category,
                            )
                          }
                          className={[
                            'flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition',
                            note.category ===
                            category
                              ? 'bg-[#E5798F]/10 font-medium text-[#C95F76]'
                              : 'hover:bg-black/5',
                          ].join(' ')}
                        >
                          <span>
                            {category}
                          </span>

                          {note.category ===
                            category && (
                            <Check
                              size={14}
                            />
                          )}
                        </button>
                      ),
                    )}
                  </div>

                  <div className="mt-2 border-t border-black/5 pt-2">
                    <div className="flex gap-2">
                      <input
                        value={
                          newCategory
                        }
                        onChange={(
                          event,
                        ) =>
                          setNewCategory(
                            event.target
                              .value,
                          )
                        }
                        onKeyDown={(
                          event,
                        ) => {
                          if (
                            event.key ===
                            'Enter'
                          ) {
                            event.preventDefault();
                            addCategory();
                          }

                          if (
                            event.key ===
                            'Escape'
                          ) {
                            setShowCategoryMenu(
                              false,
                            );
                          }
                        }}
                        placeholder="New category"
                        className="min-w-0 flex-1 rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-[#E5798F]/50 focus:ring-2 focus:ring-[#E5798F]/10"
                      />

                      <button
                        type="button"
                        onClick={
                          addCategory
                        }
                        className="rounded-xl bg-[#E5798F] px-3 text-xs font-semibold text-white hover:bg-[#d96d84]"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() =>
                toggleFlag(
                  'is_archived',
                )
              }
              className={[
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition',
                note.is_archived
                  ? 'bg-slate-100 text-slate-700'
                  : 'bg-black/5 text-black/55 hover:bg-black/8',
              ].join(' ')}
            >
              <Archive size={13} />

              {note.is_archived
                ? 'Archived'
                : 'Archive'}
            </button>

            <button
              type="button"
              onClick={() =>
                toggleFlag(
                  'is_pinned',
                )
              }
              className={[
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition sm:hidden',
                note.is_pinned
                  ? 'bg-amber-50 text-amber-700'
                  : 'bg-black/5 text-black/55 hover:bg-black/8',
              ].join(' ')}
            >
              <Pin size={13} />

              {note.is_pinned
                ? 'Pinned'
                : 'Pin'}
            </button>

            <div className="ml-auto flex items-center gap-2 text-[11px] text-black/35">
              <span>
                {wordCount} words
              </span>

              <span>•</span>

              <span>
                {characterCount}{' '}
                chars
              </span>
            </div>
          </div>

          <div className="sticky top-[68px] z-30 overflow-x-auto border-b border-black/5 bg-white/95 px-2 py-2 backdrop-blur-xl sm:px-4">
            <div className="flex min-w-max items-center gap-0.5">
              <ToolbarButton
                label="Undo (Ctrl/Cmd+Z)"
                disabled={
                  locked ||
                  undoCount === 0
                }
                onMouseDown={
                  undo
                }
              >
                <Undo2 size={17} />
              </ToolbarButton>

              <ToolbarButton
                label="Redo (Ctrl/Cmd+Y)"
                disabled={
                  locked ||
                  redoCount === 0
                }
                onMouseDown={
                  redo
                }
              >
                <Redo2 size={17} />
              </ToolbarButton>

              <ToolbarDivider />

              <ToolbarButton
                label="Bold (Ctrl/Cmd+B)"
                disabled={locked}
                onMouseDown={() =>
                  executeCommand(
                    'bold',
                  )
                }
              >
                <Bold size={17} />
              </ToolbarButton>

              <ToolbarButton
                label="Italic (Ctrl/Cmd+I)"
                disabled={locked}
                onMouseDown={() =>
                  executeCommand(
                    'italic',
                  )
                }
              >
                <Italic size={17} />
              </ToolbarButton>

              <ToolbarButton
                label="Underline (Ctrl/Cmd+U)"
                disabled={locked}
                onMouseDown={() =>
                  executeCommand(
                    'underline',
                  )
                }
              >
                <Underline size={17} />
              </ToolbarButton>

              <ToolbarButton
                label="Strikethrough"
                disabled={locked}
                onMouseDown={() =>
                  executeCommand(
                    'strikeThrough',
                  )
                }
              >
                <Strikethrough
                  size={17}
                />
              </ToolbarButton>

              <ToolbarDivider />

              <div className="flex h-9 items-center rounded-lg border border-black/8 bg-white px-2">
                <Type
                  size={14}
                  className="mr-1.5 text-black/45"
                />

                <select
                  value={heading}
                  disabled={locked}
                  onChange={(event) =>
                    applyHeading(
                      event.target
                        .value,
                    )
                  }
                  className="h-full cursor-pointer bg-transparent text-xs font-medium outline-none"
                  title="Text style"
                >
                  <option value="p">
                    Paragraph
                  </option>

                  <option value="h1">
                    Heading 1
                  </option>

                  <option value="h2">
                    Heading 2
                  </option>

                  <option value="h3">
                    Heading 3
                  </option>

                  <option value="h4">
                    Heading 4
                  </option>
                </select>
              </div>

              <div className="flex h-9 items-center rounded-lg border border-black/8 bg-white px-2">
                <select
                  value={fontSize}
                  disabled={locked}
                  onChange={(event) =>
                    applyFontSize(
                      event.target
                        .value,
                    )
                  }
                  className="h-full cursor-pointer bg-transparent text-xs font-medium outline-none"
                  title="Font size"
                >
                  <option value="2">
                    Small
                  </option>

                  <option value="3">
                    Normal
                  </option>

                  <option value="4">
                    Large
                  </option>

                  <option value="5">
                    Extra Large
                  </option>

                  <option value="6">
                    Huge
                  </option>
                </select>
              </div>

              <ToolbarDivider />

              <ToolbarButton
                label="Bullet list"
                disabled={locked}
                onMouseDown={() =>
                  executeCommand(
                    'insertUnorderedList',
                  )
                }
              >
                <List size={17} />
              </ToolbarButton>

              <ToolbarButton
                label="Numbered list"
                disabled={locked}
                onMouseDown={() =>
                  executeCommand(
                    'insertOrderedList',
                  )
                }
              >
                <ListOrdered
                  size={17}
                />
              </ToolbarButton>

              <ToolbarButton
                label="Checklist"
                disabled={locked}
                onMouseDown={
                  insertChecklist
                }
              >
                <span className="text-sm font-bold">
                  ☑
                </span>
              </ToolbarButton>

              <ToolbarButton
                label="Quote"
                disabled={locked}
                onMouseDown={() =>
                  executeCommand(
                    'formatBlock',
                    'blockquote',
                  )
                }
              >
                <Quote size={17} />
              </ToolbarButton>

              <ToolbarButton
                label="Code"
                disabled={locked}
                onMouseDown={
                  toggleCode
                }
              >
                <Code2 size={17} />
              </ToolbarButton>

              <ToolbarDivider />

              <ToolbarButton
                label="Align left"
                disabled={locked}
                onMouseDown={() =>
                  executeCommand(
                    'justifyLeft',
                  )
                }
              >
                <AlignLeft size={17} />
              </ToolbarButton>

              <ToolbarButton
                label="Align center"
                disabled={locked}
                onMouseDown={() =>
                  executeCommand(
                    'justifyCenter',
                  )
                }
              >
                <AlignCenter
                  size={17}
                />
              </ToolbarButton>

              <ToolbarButton
                label="Align right"
                disabled={locked}
                onMouseDown={() =>
                  executeCommand(
                    'justifyRight',
                  )
                }
              >
                <AlignRight
                  size={17}
                />
              </ToolbarButton>

              <ToolbarDivider />

              <ToolbarButton
                label="Text color"
                disabled={locked}
                onMouseDown={
                  changeTextColor
                }
              >
                <Palette size={17} />
              </ToolbarButton>

              <ToolbarButton
                label="Highlight"
                disabled={locked}
                onMouseDown={
                  changeHighlight
                }
              >
                <Highlighter
                  size={17}
                />
              </ToolbarButton>

              <ToolbarButton
                label="Insert link"
                disabled={locked}
                onMouseDown={
                  insertLink
                }
              >
                <Link2 size={17} />
              </ToolbarButton>

              <ToolbarButton
                label="Horizontal divider"
                disabled={locked}
                onMouseDown={
                  insertHorizontalRule
                }
              >
                <span className="text-base font-bold">
                  —
                </span>
              </ToolbarButton>
            </div>
          </div>

          <div className="px-4 pb-10 pt-6 sm:px-8 sm:pb-14 sm:pt-8 lg:px-14">
            <textarea
              ref={titleRef}
              value={note.title}
              disabled={locked}
              onChange={(event) =>
                commitNote(
                  (current) => ({
                    ...current,
                    title:
                      event.target
                        .value,
                  }),
                )
              }
              placeholder="Untitled note"
              rows={1}
              className="block w-full resize-none overflow-hidden border-0 bg-transparent text-3xl font-bold leading-tight tracking-tight outline-none placeholder:text-black/20 sm:text-4xl"
              aria-label="Note title"
            />

            <div className="my-5 h-px bg-black/5" />

            <div
              className={[
                'relative rounded-2xl transition-all',
                editorFocused
                  ? 'bg-white'
                  : '',
              ].join(' ')}
            >
              {!note.content &&
                !locked && (
                  <div className="pointer-events-none absolute left-0 top-0 z-0 text-[16px] leading-8 text-black/25 sm:text-[17px]">
                    Start writing your
                    thoughts...
                  </div>
                )}

              <div
                ref={editorRef}
                contentEditable={!locked}
                suppressContentEditableWarning
                role="textbox"
                aria-multiline="true"
                aria-label="Note content"
                spellCheck
                onFocus={() =>
                  setEditorFocused(
                    true,
                  )
                }
                onBlur={() =>
                  setEditorFocused(
                    false,
                  )
                }
                onInput={
                  handleEditorInput
                }
                onKeyDown={
                  handleEditorKeyDown
                }
                className={[
                  'relative z-10 min-h-[55vh] w-full border-0 bg-transparent outline-none',
                  'text-[16px] leading-8 text-black/80 sm:min-h-[62vh] sm:text-[17px]',
                  'prose prose-neutral max-w-none',
                  locked
                    ? 'pointer-events-none select-none blur-[5px]'
                    : '',
                ].join(' ')}
              />

              {locked && (
                <div className="absolute inset-0 z-20 flex items-center justify-center">
                  <div className="flex max-w-xs flex-col items-center rounded-2xl border border-black/8 bg-white/95 px-6 py-5 text-center shadow-xl backdrop-blur">
                    <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-black text-white">
                      <Lock size={18} />
                    </div>

                    <h2 className="text-sm font-semibold">
                      Note locked
                    </h2>

                    <p className="mt-1 text-xs leading-5 text-black/45">
                      This is a
                      device-local
                      privacy lock.
                      Your actual
                      server-side
                      protection
                      should be
                      enforced by
                      Supabase RLS.
                    </p>

                    <button
                      type="button"
                      onClick={
                        toggleLocalLock
                      }
                      className="mt-4 rounded-xl bg-[#E5798F] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#d96d84]"
                    >
                      Unlock
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-black/5 bg-[#FFFBFC] px-4 py-3 text-[11px] text-black/35 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex items-center gap-2">
              {saveState ===
              'saving' ? (
                <span>
                  Saving changes…
                </span>
              ) : saveState ===
                'error' ? (
                <span className="text-red-500">
                  Changes need
                  attention
                </span>
              ) : (
                <>
                  <span>
                    All changes
                    saved
                  </span>

                  <Check
                    size={12}
                    className="text-emerald-600"
                  />
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span>
                {wordCount} words
              </span>

              <span>
                {characterCount}{' '}
                characters
              </span>

              <span className="hidden sm:inline">
                Ctrl/Cmd+B
                Bold
              </span>

              <span className="hidden sm:inline">
                Ctrl/Cmd+I
                Italic
              </span>

              <span className="hidden sm:inline">
                Ctrl/Cmd+U
                Underline
              </span>
            </div>
          </div>
        </section>
      </div>

      {notice && (
        <div className="fixed bottom-4 left-1/2 z-[100] -translate-x-1/2 px-4">
          <div className="flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-2xl border border-black/8 bg-black px-4 py-3 text-sm font-medium text-white shadow-2xl">
            <Check
              size={15}
              className="shrink-0"
            />

            <span className="truncate">
              {notice}
            </span>
          </div>
        </div>
      )}

      <style jsx global>{`
        .enotes-checklist {
          display: flex;
          align-items: center;
          min-height: 32px;
        }

        .enotes-checkbox {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          margin-right: 5px;
          border-radius: 6px;
          cursor: pointer;
          user-select: none;
          font-size: 18px;
          line-height: 1;
          transition:
            background 0.15s ease,
            transform 0.15s ease;
        }

        .enotes-checkbox:hover {
          background: rgba(229, 121, 143, 0.12);
        }

        .enotes-checkbox-checked {
          color: #e5798f;
        }

        [contenteditable='true'] a {
          color: #d7647d;
          text-decoration: underline;
          text-underline-offset: 3px;
        }

        [contenteditable='true'] blockquote {
          margin: 18px 0;
          padding: 10px 18px;
          border-left: 4px solid #e5798f;
          background: #fff7f8;
          color: rgba(0, 0, 0, 0.62);
          border-radius: 0 12px 12px 0;
        }

        [contenteditable='true'] pre {
          margin: 18px 0;
          padding: 16px;
          overflow-x: auto;
          border-radius: 14px;
          background: #171717;
          color: #ffffff;
          font-family:
            ui-monospace,
            SFMono-Regular,
            Menlo,
            Monaco,
            Consolas,
            monospace;
          font-size: 14px;
          line-height: 1.7;
        }

        [contenteditable='true'] code {
          padding: 2px 5px;
          border-radius: 5px;
          background: rgba(0, 0, 0, 0.06);
          font-family:
            ui-monospace,
            SFMono-Regular,
            Menlo,
            Monaco,
            Consolas,
            monospace;
          font-size: 0.92em;
        }

        [contenteditable='true'] pre code {
          padding: 0;
          background: transparent;
          color: inherit;
        }

        [contenteditable='true'] ul,
        [contenteditable='true'] ol {
          padding-left: 28px;
          margin: 12px 0;
        }

        [contenteditable='true'] li {
          padding-left: 4px;
          margin: 3px 0;
        }

        [contenteditable='true'] h1,
        [contenteditable='true'] h2,
        [contenteditable='true'] h3,
        [contenteditable='true'] h4 {
          color: #111111;
          line-height: 1.25;
          margin-top: 22px;
          margin-bottom: 10px;
        }

        [contenteditable='true'] h1 {
          font-size: 2rem;
          font-weight: 800;
        }

        [contenteditable='true'] h2 {
          font-size: 1.6rem;
          font-weight: 750;
        }

        [contenteditable='true'] h3 {
          font-size: 1.3rem;
          font-weight: 700;
        }

        [contenteditable='true'] h4 {
          font-size: 1.1rem;
          font-weight: 700;
        }

        [contenteditable='true'] hr {
          border: 0;
          border-top: 1px solid rgba(0, 0, 0, 0.1);
          margin: 26px 0;
        }

        [contenteditable='true']:focus {
          outline: none;
        }

        [contenteditable='true'] img {
          max-width: 100%;
          height: auto;
          border-radius: 14px;
        }

        @media (max-width: 640px) {
          [contenteditable='true'] {
            font-size: 16px;
            line-height: 1.9;
          }

          [contenteditable='true'] h1 {
            font-size: 1.75rem;
          }

          [contenteditable='true'] h2 {
            font-size: 1.45rem;
          }

          [contenteditable='true'] h3 {
            font-size: 1.25rem;
          }
        }
      `}</style>
    </main>
  );
}

export default function NoteEditorPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#FFF7F8]" />
      }
    >
      <NoteEditor />
    </Suspense>
  );
}
