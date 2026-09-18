'use client';

import React, {
  Suspense,
  useCallback,
  useEffect,
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

type SaveState =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'error';

const DEFAULT_CATEGORY = 'general';

const DEFAULT_CONTENT =
  '<p>Start writing your thoughts here...</p>';

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

const TEXT_COLORS = [
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
];

function normalizeCategory(
  category: string | null | undefined,
) {
  const value = category?.trim();

  return value || DEFAULT_CATEGORY;
}

function formatCategory(
  category: string | null | undefined,
) {
  const value = normalizeCategory(category);

  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) =>
      letter.toUpperCase(),
    );
}

function formatDate(
  value?: string | null,
) {
  if (!value) {
    return 'Not available';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Not available';
  }

  return date.toLocaleString(
    undefined,
    {
      dateStyle: 'medium',
      timeStyle: 'short',
    },
  );
}

function htmlToPlainText(
  html: string,
) {
  if (
    typeof window ===
    'undefined'
  ) {
    return html
      .replace(
        /<[^>]*>/g,
        ' ',
      )
      .replace(
        /&nbsp;/g,
        ' ',
      )
      .replace(
        /\s+/g,
        ' ',
      )
      .trim();
  }

  const element =
    document.createElement(
      'div',
    );

  element.innerHTML = html;

  return (
    element.innerText ||
    element.textContent ||
    ''
  )
    .replace(
      /\u00a0/g,
      ' ',
    )
    .replace(
      /\s+/g,
      ' ',
    )
    .trim();
}

function countWords(
  text: string,
) {
  const cleaned =
    text.trim();

  if (!cleaned) {
    return 0;
  }

  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function countCharacters(
  text: string,
) {
  return text.length;
}

function createDraft(): NoteRecord {
  return {
    id: 'new',
    title: '',
    content:
      DEFAULT_CONTENT,
    category:
      DEFAULT_CATEGORY,
    pinned: false,
    favorite: false,
    archived: false,
    created_at: null,
    updated_at: null,
  };
}

function NoteEditor() {
  const params =
    useParams<{
      id: string;
    }>();

  const router =
    useRouter();

  const routeId =
    Array.isArray(
      params?.id,
    )
      ? params.id[0]
      : params?.id;

  const isNew =
    routeId === 'new';

  const titleRef =
    useRef<HTMLInputElement | null>(
      null,
    );

  const editorRef =
    useRef<HTMLDivElement | null>(
      null,
    );

  const noteRef =
    useRef<NoteRecord | null>(
      isNew
        ? createDraft()
        : null,
    );

  const saveTimerRef =
    useRef<ReturnType<
      typeof setTimeout
    > | null>(null);

  const mountedRef =
    useRef(true);

  const savingRef =
    useRef(false);

  const pendingSaveRef =
    useRef(false);

  const realIdRef =
    useRef<string | null>(
      null,
    );

  const historyRef =
    useRef<string[]>([]);

  const futureRef =
    useRef<string[]>([]);

  const lastHistoryValueRef =
    useRef('');

  const [note, setNote] =
    useState<NoteRecord | null>(
      isNew
        ? createDraft()
        : null,
    );

  const [loading, setLoading] =
    useState(!isNew);

  const [saveState, setSaveState] =
    useState<SaveState>(
      isNew
        ? 'idle'
        : 'idle',
    );

  const [notice, setNotice] =
    useState('');

  const [locked, setLocked] =
    useState(false);

  const [categoryOpen, setCategoryOpen] =
    useState(false);

  const [customCategory, setCustomCategory] =
    useState('');

  const [colorOpen, setColorOpen] =
    useState(false);

  const [editorFocused, setEditorFocused] =
    useState(false);

  const [deleting, setDeleting] =
    useState(false);

  const [historyVersion, setHistoryVersion] =
    useState(0);

  const updateNote = useCallback(
    (
      changes: Partial<NoteRecord>,
    ) => {
      setNote(
        (current) => {
          if (!current) {
            return current;
          }

          const updated = {
            ...current,
            ...changes,
          };

          noteRef.current =
            updated;

          return updated;
        },
      );
    },
    [],
  );

  const getEditorHtml =
    useCallback(() => {
      return (
        editorRef.current
          ?.innerHTML ||
        DEFAULT_CONTENT
      );
    }, []);

  const getTitle =
    useCallback(() => {
      return (
        titleRef.current
          ?.value.trim() ||
        ''
      );
    }, []);

  const pushHistory =
    useCallback(
      (
        html: string,
      ) => {
        if (
          !html ||
          html ===
            lastHistoryValueRef.current
        ) {
          return;
        }

        historyRef.current =
          [
            ...historyRef.current.slice(
              -49,
            ),
            html,
          ];

        futureRef.current =
          [];

        lastHistoryValueRef.current =
          html;

        setHistoryVersion(
          (value) =>
            value + 1,
        );
      },
      [],
    );

  const scheduleSave =
    useCallback(() => {
      setSaveState('idle');

      if (
        saveTimerRef.current
      ) {
        clearTimeout(
          saveTimerRef.current,
        );
      }

      saveTimerRef.current =
        setTimeout(() => {
          void saveNow();
        }, 900);
    }, []);

  const saveNow =
    useCallback(
      async () => {
        const current =
          noteRef.current;

        if (
          !current ||
          !mountedRef.current
        ) {
          return;
        }

        if (
          savingRef.current
        ) {
          pendingSaveRef.current =
            true;

          return;
        }

        savingRef.current =
          true;

        pendingSaveRef.current =
          false;

        setSaveState(
          'saving',
        );

        try {
          const {
            data: {
              user,
            },
            error:
              userError,
          } =
            await supabase.auth.getUser();

          if (userError) {
            throw userError;
          }

          if (!user) {
            throw new Error(
              'You must be signed in to save notes.',
            );
          }

          const title =
            getTitle();

          const content =
            getEditorHtml();

          const category =
            normalizeCategory(
              noteRef.current
                ?.category,
            );

          const payload = {
            title,
            content,
            category,
            pinned: Boolean(
              noteRef.current
                ?.pinned,
            ),
            favorite: Boolean(
              noteRef.current
                ?.favorite,
            ),
            archived: Boolean(
              noteRef.current
                ?.archived,
            ),
            updated_at:
              new Date().toISOString(),
          };

          let currentId =
            realIdRef.current ||
            current.id;

          if (
            !currentId ||
            currentId === 'new'
          ) {
            const {
              data,
              error,
            } =
              await supabase
                .from('notes')
                .insert({
                  user_id:
                    user.id,
                  ...payload,
                })
                .select('*')
                .single();

            if (error) {
              throw error;
            }

            currentId =
              data.id;

            realIdRef.current =
              data.id;

            const saved =
              data as NoteRecord;

            noteRef.current =
              saved;

            if (
              mountedRef.current
            ) {
              setNote(
                saved,
              );
            }

            router.replace(
              `/notes/${data.id}`,
            );
          } else {
            const {
              data,
              error,
            } =
              await supabase
                .from('notes')
                .update(
                  payload,
                )
                .eq(
                  'id',
                  currentId,
                )
                .eq(
                  'user_id',
                  user.id,
                )
                .select('*')
                .single();

            if (error) {
              throw error;
            }

            if (
              data &&
              mountedRef.current
            ) {
              const saved =
                data as NoteRecord;

              noteRef.current =
                saved;

              setNote(
                saved,
              );
            }
          }

          if (
            mountedRef.current
          ) {
            setSaveState(
              'saved',
            );

            setNotice('');
          }
        } catch (error) {
          console.error(
            'Failed to save note:',
            error,
          );

          if (
            mountedRef.current
          ) {
            setSaveState(
              'error',
            );

            setNotice(
              error instanceof Error
                ? error.message
                : 'Unable to save this note.',
            );
          }
        } finally {
          savingRef.current =
            false;

          if (
            pendingSaveRef.current &&
            mountedRef.current
          ) {
            pendingSaveRef.current =
              false;

            if (
              saveTimerRef.current
            ) {
              clearTimeout(
                saveTimerRef.current,
              );
            }

            saveTimerRef.current =
              setTimeout(() => {
                void saveNow();
              }, 300);
          }
        }
      },
      [
        getEditorHtml,
        getTitle,
        router,
      ],
    );

  const executeCommand =
    useCallback(
      (
        command: string,
        value?: string,
      ) => {
        if (locked) {
          return;
        }

        editorRef.current?.focus();

        try {
          document.execCommand(
            command,
            false,
            value,
          );
        } catch (error) {
          console.error(
            `Command failed: ${command}`,
            error,
          );
        }

        const html =
          getEditorHtml();

        pushHistory(html);

        updateNote({
          content: html,
        });

        scheduleSave();
      },
      [
        getEditorHtml,
        locked,
        pushHistory,
        scheduleSave,
        updateNote,
      ],
    );

  const undo =
    useCallback(() => {
      if (
        locked ||
        historyRef.current.length <
          2
      ) {
        return;
      }

      const history =
        [
          ...historyRef.current,
        ];

      const current =
        history.pop();

      if (!current) {
        return;
      }

      const previous =
        history[
          history.length - 1
        ];

      if (!previous) {
        return;
      }

      futureRef.current =
        [
          current,
          ...futureRef.current,
        ];

      historyRef.current =
        history;

      lastHistoryValueRef.current =
        previous;

      if (
        editorRef.current
      ) {
        editorRef.current.innerHTML =
          previous;
      }

      updateNote({
        content:
          previous,
      });

      scheduleSave();

      setHistoryVersion(
        (value) =>
          value + 1,
      );
    }, [
      locked,
      scheduleSave,
      updateNote,
    ]);

  const redo =
    useCallback(() => {
      if (
        locked ||
        futureRef.current.length ===
          0
      ) {
        return;
      }

      const next =
        futureRef.current.shift();

      if (!next) {
        return;
      }

      historyRef.current =
        [
          ...historyRef.current,
          next,
        ];

      lastHistoryValueRef.current =
        next;

      if (
        editorRef.current
      ) {
        editorRef.current.innerHTML =
          next;
      }

      updateNote({
        content: next,
      });

      scheduleSave();

      setHistoryVersion(
        (value) =>
          value + 1,
      );
    }, [
      locked,
      scheduleSave,
      updateNote,
    ]);

  const handleEditorInput =
    useCallback(() => {
      const html =
        getEditorHtml();

      pushHistory(html);

      updateNote({
        content: html,
      });

      scheduleSave();
    }, [
      getEditorHtml,
      pushHistory,
      scheduleSave,
      updateNote,
    ]);

  const handleTitleChange =
    useCallback(
      (
        event: React.ChangeEvent<HTMLInputElement>,
      ) => {
        updateNote({
          title:
            event.target.value,
        });

        scheduleSave();
      },
      [
        scheduleSave,
        updateNote,
      ],
    );

  const toggleFlag =
    useCallback(
      (
        field:
          | 'pinned'
          | 'favorite'
          | 'archived',
      ) => {
        if (
          locked ||
          !noteRef.current
        ) {
          return;
        }

        const current =
          Boolean(
            noteRef.current[
              field
            ],
          );

        updateNote({
          [field]: !current,
        });

        scheduleSave();
      },
      [
        locked,
        scheduleSave,
        updateNote,
      ],
    );

  const selectCategory =
    useCallback(
      (
        category: string,
      ) => {
        if (locked) {
          return;
        }

        const normalized =
          normalizeCategory(
            category,
          );

        updateNote({
          category:
            normalized,
        });

        setCategoryOpen(
          false,
        );

        setCustomCategory(
          '',
        );

        scheduleSave();
      },
      [
        locked,
        scheduleSave,
        updateNote,
      ],
    );

  const addCustomCategory =
    useCallback(() => {
      const value =
        customCategory.trim();

      if (!value) {
        return;
      }

      selectCategory(
        value,
      );
    }, [
      customCategory,
      selectCategory,
    ]);

  const insertLink =
    useCallback(() => {
      if (locked) {
        return;
      }

      const url =
        window.prompt(
          'Enter the URL:',
          'https://',
        );

      if (!url?.trim()) {
        return;
      }

      executeCommand(
        'createLink',
        url.trim(),
      );
    }, [
      executeCommand,
      locked,
    ]);

  const changeTextColor =
    useCallback(
      (
        color: string,
      ) => {
        executeCommand(
          'foreColor',
          color,
        );

        setColorOpen(false);
      },
      [executeCommand],
    );

  const insertChecklist =
    useCallback(() => {
      if (locked) {
        return;
      }

      const selection =
        window
          .getSelection()
          ?.toString()
          .trim();

      const text =
        selection ||
        'Checklist item';

      const escaped =
        text
          .replace(
            /&/g,
            '&amp;',
          )
          .replace(
            /</g,
            '&lt;',
          )
          .replace(
            />/g,
            '&gt;',
          );

      executeCommand(
        'insertHTML',
        `
          <div class="enotes-checklist">
            <label>
              <input type="checkbox" />
              <span>${escaped}</span>
            </label>
          </div>
        `,
      );
    }, [
      executeCommand,
      locked,
    ]);

  const toggleLock =
    useCallback(() => {
      setLocked(
        (current) => {
          const next =
            !current;

          setNotice(
            next
              ? 'Editing is locked on this device.'
              : 'Editing is unlocked.',
          );

          return next;
        },
      );
    }, []);

  const copyNote =
    useCallback(
      async () => {
        const current =
          noteRef.current;

        if (!current) {
          return;
        }

        const title =
          titleRef.current
            ?.value ||
          current.title ||
          'Untitled note';

        const content =
          editorRef.current
            ?.innerHTML ||
          current.content ||
          '';

        const text =
          `${title}\n\n${htmlToPlainText(
            content,
          )}`.trim();

        try {
          await navigator.clipboard.writeText(
            text,
          );

          setNotice(
            'Note copied to your clipboard.',
          );
        } catch {
          setNotice(
            'Unable to copy this note.',
          );
        }
      },
      [],
    );

  const shareNote =
    useCallback(
      async () => {
        let id =
          realIdRef.current ||
          routeId;

        if (
          !id ||
          id === 'new'
        ) {
          await saveNow();

          id =
            realIdRef.current;
        }

        if (
          !id ||
          id === 'new'
        ) {
          setNotice(
            'Save the note before sharing it.',
          );

          return;
        }

        const url =
          `${window.location.origin}/notes/${id}`;

        try {
          if (
            navigator.share
          ) {
            await navigator.share(
              {
                title:
                  noteRef.current
                    ?.title ||
                  'My note',
                text:
                  'Shared from enotes',
                url,
              },
            );
          } else {
            await navigator.clipboard.writeText(
              url,
            );

            setNotice(
              'Note link copied to your clipboard.',
            );
          }
        } catch (error) {
          if (
            error instanceof DOMException &&
            error.name ===
              'AbortError'
          ) {
            return;
          }

          setNotice(
            'Unable to share this note.',
          );
        }
      },
      [
        routeId,
        saveNow,
      ],
    );

  const deleteNote =
    useCallback(
      async () => {
        const currentId =
          realIdRef.current ||
          routeId;

        if (
          !currentId ||
          currentId === 'new'
        ) {
          router.push(
            '/notes',
          );

          return;
        }

        const confirmed =
          window.confirm(
            'Delete this note permanently?\n\nThis action cannot be undone.',
          );

        if (!confirmed) {
          return;
        }

        setDeleting(true);

        try {
          const {
            data: {
              user,
            },
            error:
              userError,
          } =
            await supabase.auth.getUser();

          if (userError) {
            throw userError;
          }

          if (!user) {
            throw new Error(
              'You must be signed in.',
            );
          }

          const {
            error,
          } =
            await supabase
              .from('notes')
              .delete()
              .eq(
                'id',
                currentId,
              )
              .eq(
                'user_id',
                user.id,
              );

          if (error) {
            throw error;
          }

          router.push(
            '/notes',
          );

          router.refresh();
        } catch (error) {
          console.error(
            'Failed to delete note:',
            error,
          );

          setNotice(
            error instanceof Error
              ? error.message
              : 'Unable to delete this note.',
          );

          setDeleting(false);
        }
      },
      [
        routeId,
        router,
      ],
    );

  useEffect(() => {
    mountedRef.current =
      true;

    return () => {
      mountedRef.current =
        false;

      if (
        saveTimerRef.current
      ) {
        clearTimeout(
          saveTimerRef.current,
        );
      }
    };
  }, []);

  useEffect(() => {
    if (isNew) {
      const draft =
        createDraft();

      noteRef.current =
        draft;

      setNote(draft);
      setLoading(false);

      return;
    }

    if (!routeId) {
      return;
    }

    let cancelled =
      false;

    async function loadNote() {
      setLoading(true);
      setNotice('');

      try {
        const {
          data: {
            user,
          },
          error:
            userError,
        } =
          await supabase.auth.getUser();

        if (userError) {
          throw userError;
        }

        if (!user) {
          router.replace(
            '/signin',
          );

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
            .single();

        if (error) {
          throw error;
        }

        if (
          cancelled
        ) {
          return;
        }

        const loaded =
          data as NoteRecord;

        realIdRef.current =
          loaded.id;

        noteRef.current =
          loaded;

        setNote(
          loaded,
        );
      } catch (error) {
        console.error(
          'Failed to load note:',
          error,
        );

        if (
          !cancelled
        ) {
          setNotice(
            error instanceof Error
              ? error.message
              : 'Unable to load this note.',
          );
        }
      } finally {
        if (
          !cancelled
        ) {
          setLoading(false);
        }
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

  useEffect(() => {
    if (
      !note ||
      !editorRef.current
    ) {
      return;
    }

    const content =
      note.content ||
      DEFAULT_CONTENT;

    if (
      editorRef.current
        .innerHTML !==
      content
    ) {
      editorRef.current.innerHTML =
        content;
    }

    if (
      titleRef.current
    ) {
      const title =
        note.title ||
        '';

      if (
        titleRef.current
          .value !==
        title
      ) {
        titleRef.current.value =
          title;
      }
    }

    if (
      !lastHistoryValueRef.current
    ) {
      lastHistoryValueRef.current =
        content;

      historyRef.current =
        [content];
    }
  }, [note]);

  useEffect(() => {
    const handleVisibility =
      () => {
        if (
          document.visibilityState ===
            'hidden' &&
          noteRef.current
        ) {
          if (
            saveTimerRef.current
          ) {
            clearTimeout(
              saveTimerRef.current,
            );
          }

          void saveNow();
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
    const handleBeforeUnload =
      (
        event: BeforeUnloadEvent,
      ) => {
        if (
          noteRef.current &&
          saveState !==
            'saved'
        ) {
          event.preventDefault();
          event.returnValue =
            '';
        }
      };

    window.addEventListener(
      'beforeunload',
      handleBeforeUnload,
    );

    return () => {
      window.removeEventListener(
        'beforeunload',
        handleBeforeUnload,
      );
    };
  }, [saveState]);

  useEffect(() => {
    const handleKeyDown =
      (
        event: KeyboardEvent,
      ) => {
        if (
          locked ||
          !editorFocused
        ) {
          return;
        }

        const modifier =
          event.ctrlKey ||
          event.metaKey;

        if (!modifier) {
          return;
        }

        const key =
          event.key.toLowerCase();

        if (key === 'b') {
          event.preventDefault();
          executeCommand(
            'bold',
          );
          return;
        }

        if (key === 'i') {
          event.preventDefault();
          executeCommand(
            'italic',
          );
          return;
        }

        if (key === 'u') {
          event.preventDefault();
          executeCommand(
            'underline',
          );
          return;
        }

        if (key === 's') {
          event.preventDefault();
          void saveNow();
          return;
        }

        if (key === 'z') {
          event.preventDefault();

          if (
            event.shiftKey
          ) {
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
      handleKeyDown,
    );

    return () => {
      window.removeEventListener(
        'keydown',
        handleKeyDown,
      );
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
      <main className="flex min-h-screen items-center justify-center bg-[#fff7f8]">
        <div className="rounded-3xl border border-[#f0dce3] bg-white px-8 py-10 text-center shadow-sm">
          <div className="mx-auto mb-4 h-9 w-9 animate-spin rounded-full border-4 border-[#f4d6df] border-t-[#e5798f]" />

          <p className="text-sm font-medium text-[#805f6d]">
            Loading your note...
          </p>
        </div>
      </main>
    );
  }

  if (!note) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#fff7f8] px-4">
        <div className="w-full max-w-md rounded-3xl border border-[#f0dce3] bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#fff0f4] text-[#e5798f]">
            <Trash2 size={24} />
          </div>

          <h1 className="text-xl font-bold text-[#321f2b]">
            Note unavailable
          </h1>

          <p className="mt-2 text-sm leading-6 text-[#92717f]">
            {notice ||
              'This note could not be loaded.'}
          </p>

          <Link
            href="/notes"
            className="mt-6 inline-flex rounded-full bg-[#e5798f] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#d8667e]"
          >
            Back to notes
          </Link>
        </div>
      </main>
    );
  }

  const plainText =
    htmlToPlainText(
      note.content ||
        '',
    );

  const wordCount =
    countWords(
      plainText,
    );

  const characterCount =
    countCharacters(
      plainText,
    );

  const canUndo =
    historyRef.current.length >
    1;

  const canRedo =
    futureRef.current.length >
    0;

  return (
    <main className="min-h-screen bg-[#fff7f8] text-[#321f2b]">
      <div className="mx-auto w-full max-w-[1500px] px-3 py-4 pb-24 sm:px-5 lg:px-8">
        {/* TOP HEADER */}
        <header className="mb-4 rounded-3xl border border-[#f0dce3] bg-white/95 shadow-sm backdrop-blur-xl">
          <div className="flex min-h-[68px] items-center gap-2 px-3 sm:px-5">
            <Link
              href="/notes"
              aria-label="Back to notes"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#f0dce3] text-[#805f6d] transition hover:bg-[#fff0f4]"
            >
              <ChevronDown
                size={18}
                className="rotate-90"
              />
            </Link>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="hidden text-xs font-bold uppercase tracking-[0.18em] text-[#b08394] sm:inline">
                  enotes
                </span>

                <span className="hidden text-[#d9bdc8] sm:inline">
                  /
                </span>

                <span className="truncate text-sm font-semibold text-[#513342]">
                  {note.title?.trim() ||
                    'Untitled note'}
                </span>
              </div>

              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[#b18b9a]">
                <span>
                  {formatCategory(
                    note.category,
                  )}
                </span>

                <span>•</span>

                <span>
                  {saveState ===
                    'saving' &&
                    'Saving...'}
                  {saveState ===
                    'saved' &&
                    'Saved'}
                  {saveState ===
                    'error' &&
                    'Save failed'}
                  {saveState ===
                    'idle' &&
                    'Autosave enabled'}
                </span>
              </div>
            </div>

            {/* DESKTOP ACTIONS */}
            <div className="hidden items-center gap-1.5 sm:flex">
              <button
                type="button"
                onClick={() =>
                  toggleFlag(
                    'pinned',
                  )
                }
                disabled={
                  locked
                }
                title={
                  note.pinned
                    ? 'Unpin note'
                    : 'Pin note'
                }
                className={`flex h-10 w-10 items-center justify-center rounded-xl transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  note.pinned
                    ? 'bg-[#fff0f4] text-[#e5798f]'
                    : 'text-[#805f6d] hover:bg-[#fff7f8]'
                }`}
              >
                <Pin
                  size={17}
                />
              </button>

              <button
                type="button"
                onClick={() =>
                  toggleFlag(
                    'favorite',
                  )
                }
                disabled={
                  locked
                }
                title={
                  note.favorite
                    ? 'Remove favorite'
                    : 'Favorite note'
                }
                className={`flex h-10 w-10 items-center justify-center rounded-xl text-lg transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  note.favorite
                    ? 'bg-[#fff0f4] text-[#e5798f]'
                    : 'text-[#805f6d] hover:bg-[#fff7f8]'
                }`}
              >
                {note.favorite
                  ? '★'
                  : '☆'}
              </button>

              <button
                type="button"
                onClick={() =>
                  void shareNote()
                }
                title="Share note"
                className="flex h-10 w-10 items-center justify-center rounded-xl text-[#805f6d] transition hover:bg-[#fff7f8]"
              >
                <Share2
                  size={17}
                />
              </button>

              {/* DELETE IS NOW ALWAYS IN THE HEADER */}
              <button
                type="button"
                onClick={() =>
                  void deleteNote()
                }
                disabled={
                  deleting
                }
                title="Delete note"
                className="flex h-10 w-10 items-center justify-center rounded-xl text-red-500 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2
                  size={17}
                />
              </button>

              <button
                type="button"
                onClick={() =>
                  setLocked(
                    (value) =>
                      !value,
                  )
                }
                title={
                  locked
                    ? 'Unlock editing'
                    : 'Lock editing'
                }
                className={`flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold transition ${
                  locked
                    ? 'bg-[#321f2b] text-white'
                    : 'text-[#805f6d] hover:bg-[#fff7f8]'
                }`}
              >
                {locked ? (
                  <Lock
                    size={16}
                  />
                ) : (
                  <Unlock
                    size={16}
                  />
                )}

                <span className="hidden lg:inline">
                  {locked
                    ? 'Locked'
                    : 'Lock'}
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  void saveNow()
                }
                disabled={
                  saveState ===
                  'saving'
                }
                className="flex h-10 items-center gap-2 rounded-xl bg-[#e5798f] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#d8667e] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save
                  size={16}
                />

                Save
              </button>
            </div>

            {/* MOBILE SAVE */}
            <button
              type="button"
              onClick={() =>
                void saveNow()
              }
              disabled={
                saveState ===
                'saving'
              }
              className="flex h-10 items-center gap-2 rounded-xl bg-[#e5798f] px-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#d8667e] disabled:opacity-50 sm:hidden"
            >
              <Save
                size={16}
              />
            </button>
          </div>

          {/* MOBILE ACTION ROW */}
          <div className="flex items-center gap-1.5 overflow-x-auto border-t border-[#f4e5e9] px-3 py-2.5 sm:hidden">
            <button
              type="button"
              onClick={() =>
                toggleFlag(
                  'pinned',
                )
              }
              disabled={
                locked
              }
              className={`flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs font-bold ${
                note.pinned
                  ? 'bg-[#fff0f4] text-[#c45470]'
                  : 'bg-[#f8f1f4] text-[#805f6d]'
              }`}
            >
              <Pin
                size={14}
              />
              Pin
            </button>

            <button
              type="button"
              onClick={() =>
                toggleFlag(
                  'favorite',
                )
              }
              disabled={
                locked
              }
              className={`flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs font-bold ${
                note.favorite
                  ? 'bg-[#fff0f4] text-[#c45470]'
                  : 'bg-[#f8f1f4] text-[#805f6d]'
              }`}
            >
              <span>
                {note.favorite
                  ? '★'
                  : '☆'}
              </span>
              Favorite
            </button>

            <button
              type="button"
              onClick={() =>
                setLocked(
                  (value) =>
                    !value,
                )
              }
              className={`flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs font-bold ${
                locked
                  ? 'bg-[#321f2b] text-white'
                  : 'bg-[#f8f1f4] text-[#805f6d]'
              }`}
            >
              {locked ? (
                <Lock
                  size={14}
                />
              ) : (
                <Unlock
                  size={14}
                />
              )}

              {locked
                ? 'Unlock'
                : 'Lock'}
            </button>

            <button
              type="button"
              onClick={() =>
                void shareNote()
              }
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-[#f8f1f4] px-3 text-xs font-bold text-[#805f6d]"
            >
              <Share2
                size={14}
              />
              Share
            </button>

            {/* MOBILE DELETE */}
            <button
              type="button"
              onClick={() =>
                void deleteNote()
              }
              disabled={
                deleting
              }
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-red-50 px-3 text-xs font-bold text-red-600 disabled:opacity-50"
            >
              <Trash2
                size={14}
              />
              {deleting
                ? 'Deleting...'
                : 'Delete'}
            </button>
          </div>
        </header>

        {notice && (
          <div className="mb-4 flex items-start justify-between gap-4 rounded-2xl border border-[#f0dce3] bg-white px-4 py-3 text-sm text-[#805f6d] shadow-sm">
            <p className="min-w-0 leading-6">
              {notice}
            </p>

            <button
              type="button"
              onClick={() =>
                setNotice('')
              }
              className="shrink-0 font-bold text-[#c45470]"
            >
              Dismiss
            </button>
          </div>
        )}

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          {/* EDITOR */}
          <div className="min-w-0 overflow-hidden rounded-[2rem] border border-[#f0dce3] bg-white shadow-[0_20px_60px_rgba(181,105,130,0.08)]">
            {/* TITLE + CATEGORY */}
            <div className="border-b border-[#f4e5e9] px-5 py-6 sm:px-8">
              <input
                ref={titleRef}
                type="text"
                defaultValue={
                  note.title ||
                  ''
                }
                onChange={
                  handleTitleChange
                }
                disabled={
                  locked
                }
                placeholder="Untitled note"
                className="w-full border-0 bg-transparent text-3xl font-black tracking-tight text-[#321f2b] outline-none placeholder:text-[#d7b9c5] disabled:cursor-not-allowed sm:text-4xl"
              />

              {/* CATEGORY SELECTOR - ALWAYS VISIBLE */}
              <div className="relative mt-5">
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-[0.14em] text-[#b08394]">
                    Category
                  </label>

                  <span className="text-[11px] text-[#c19daa]">
                    Organize your note
                  </span>
                </div>

                <button
                  type="button"
                  disabled={
                    locked
                  }
                  onClick={() => {
                    setCategoryOpen(
                      (value) =>
                        !value,
                    );

                    setColorOpen(
                      false,
                    );
                  }}
                  className="flex w-full items-center justify-between rounded-2xl border border-[#ead6de] bg-[#fffafb] px-4 py-3 text-left transition hover:border-[#e5798f] hover:bg-[#fff7f8] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#fff0f4] text-[#e5798f]">
                      <span className="text-sm font-black">
                        #
                      </span>
                    </div>

                    <div className="min-w-0">
                      <p className="text-xs text-[#b18b9a]">
                        Current category
                      </p>

                      <p className="truncate text-sm font-bold capitalize text-[#513342]">
                        {formatCategory(
                          note.category,
                        )}
                      </p>
                    </div>
                  </div>

                  <ChevronDown
                    size={17}
                    className={`shrink-0 text-[#a98291] transition ${
                      categoryOpen
                        ? 'rotate-180'
                        : ''
                    }`}
                  />
                </button>

                {categoryOpen && (
                  <div className="absolute left-0 right-0 top-full z-40 mt-2 rounded-2xl border border-[#ead6de] bg-white p-2 shadow-2xl">
                    <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                      {CATEGORY_OPTIONS.map(
                        (
                          category,
                        ) => {
                          const active =
                            normalizeCategory(
                              note.category,
                            ) ===
                            category;

                          return (
                            <button
                              key={
                                category
                              }
                              type="button"
                              onClick={() =>
                                selectCategory(
                                  category,
                                )
                              }
                              className={`rounded-xl px-3 py-2.5 text-left text-sm font-semibold capitalize transition ${
                                active
                                  ? 'bg-[#fff0f4] text-[#c45470]'
                                  : 'text-[#805f6d] hover:bg-[#fff7f8]'
                              }`}
                            >
                              <span className="flex items-center gap-2">
                                {active && (
                                  <Check
                                    size={
                                      14
                                    }
                                  />
                                )}

                                {formatCategory(
                                  category,
                                )}
                              </span>
                            </button>
                          );
                        },
                      )}
                    </div>

                    <div className="my-2 border-t border-[#f4e5e9]" />

                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={
                          customCategory
                        }
                        onChange={(
                          event,
                        ) =>
                          setCustomCategory(
                            event
                              .target
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

                            addCustomCategory();
                          }
                        }}
                        placeholder="Create custom category..."
                        className="min-w-0 flex-1 rounded-xl border border-[#ead6de] bg-[#fffafb] px-3 py-2.5 text-sm outline-none transition focus:border-[#e5798f]"
                      />

                      <button
                        type="button"
                        onClick={
                          addCustomCategory
                        }
                        disabled={
                          !customCategory.trim()
                        }
                        className="rounded-xl bg-[#e5798f] px-4 text-sm font-bold text-white transition hover:bg-[#d8667e] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[#b18b9a]">
                <span>
                  Created{' '}
                  {formatDate(
                    note.created_at,
                  )}
                </span>

                <span>•</span>

                <span>
                  Updated{' '}
                  {formatDate(
                    note.updated_at,
                  )}
                </span>
              </div>
            </div>

            {/* TOOLBAR */}
            <div className="border-b border-[#f4e5e9] bg-[#fffdfd] px-3 py-3 sm:px-5">
              <div className="flex flex-wrap items-center gap-1.5">
                <ToolbarButton
                  label="Undo"
                  disabled={
                    locked ||
                    !canUndo
                  }
                  onClick={
                    undo
                  }
                >
                  <Undo2
                    size={16}
                  />
                </ToolbarButton>

                <ToolbarButton
                  label="Redo"
                  disabled={
                    locked ||
                    !canRedo
                  }
                  onClick={
                    redo
                  }
                >
                  <Redo2
                    size={16}
                  />
                </ToolbarButton>

                <ToolbarDivider />

                <ToolbarButton
                  label="Bold"
                  disabled={
                    locked
                  }
                  onClick={() =>
                    executeCommand(
                      'bold',
                    )
                  }
                >
                  <Bold
                    size={16}
                  />
                </ToolbarButton>

                <ToolbarButton
                  label="Italic"
                  disabled={
                    locked
                  }
                  onClick={() =>
                    executeCommand(
                      'italic',
                    )
                  }
                >
                  <Italic
                    size={16}
                  />
                </ToolbarButton>

                <ToolbarButton
                  label="Underline"
                  disabled={
                    locked
                  }
                  onClick={() =>
                    executeCommand(
                      'underline',
                    )
                  }
                >
                  <Underline
                    size={16}
                  />
                </ToolbarButton>

                <ToolbarButton
                  label="Strikethrough"
                  disabled={
                    locked
                  }
                  onClick={() =>
                    executeCommand(
                      'strikeThrough',
                    )
                  }
                >
                  <Strikethrough
                    size={16}
                  />
                </ToolbarButton>

                <ToolbarDivider />

                <ToolbarButton
                  label="Heading"
                  disabled={
                    locked
                  }
                  onClick={() =>
                    executeCommand(
                      'formatBlock',
                      'h2',
                    )
                  }
                >
                  <span className="text-xs font-black">
                    H
                  </span>
                </ToolbarButton>

                <ToolbarButton
                  label="Bulleted list"
                  disabled={
                    locked
                  }
                  onClick={() =>
                    executeCommand(
                      'insertUnorderedList',
                    )
                  }
                >
                  <List
                    size={16}
                  />
                </ToolbarButton>

                <ToolbarButton
                  label="Numbered list"
                  disabled={
                    locked
                  }
                  onClick={() =>
                    executeCommand(
                      'insertOrderedList',
                    )
                  }
                >
                  <ListOrdered
                    size={16}
                  />
                </ToolbarButton>

                <ToolbarButton
                  label="Checklist"
                  disabled={
                    locked
                  }
                  onClick={
                    insertChecklist
                  }
                >
                  <Check
                    size={16}
                  />
                </ToolbarButton>

                <ToolbarButton
                  label="Code"
                  disabled={
                    locked
                  }
                  onClick={() =>
                    executeCommand(
                      'formatBlock',
                      'pre',
                    )
                  }
                >
                  <Code2
                    size={16}
                  />
                </ToolbarButton>

                <ToolbarButton
                  label="Quote"
                  disabled={
                    locked
                  }
                  onClick={() =>
                    executeCommand(
                      'formatBlock',
                      'blockquote',
                    )
                  }
                >
                  <span className="text-lg font-bold">
                    “
                  </span>
                </ToolbarButton>

                <ToolbarDivider />

                <ToolbarButton
                  label="Align left"
                  disabled={
                    locked
                  }
                  onClick={() =>
                    executeCommand(
                      'justifyLeft',
                    )
                  }
                >
                  <AlignLeft
                    size={16}
                  />
                </ToolbarButton>

                <ToolbarButton
                  label="Align center"
                  disabled={
                    locked
                  }
                  onClick={() =>
                    executeCommand(
                      'justifyCenter',
                    )
                  }
                >
                  <AlignCenter
                    size={16}
                  />
                </ToolbarButton>

                <ToolbarButton
                  label="Align right"
                  disabled={
                    locked
                  }
                  onClick={() =>
                    executeCommand(
                      'justifyRight',
                    )
                  }
                >
                  <AlignRight
                    size={16}
                  />
                </ToolbarButton>

                <ToolbarDivider />

                <ToolbarButton
                  label="Insert link"
                  disabled={
                    locked
                  }
                  onClick={
                    insertLink
                  }
                >
                  <Link2
                    size={16}
                  />
                </ToolbarButton>

                {/* COLOR */}
                <div className="relative">
                  <ToolbarButton
                    label="Text color"
                    disabled={
                      locked
                    }
                    onClick={() => {
                      setColorOpen(
                        (value) =>
                          !value,
                      );

                      setCategoryOpen(
                        false,
                      );
                    }}
                  >
                    <Palette
                      size={16}
                    />
                  </ToolbarButton>

                  {colorOpen && (
                    <div className="absolute left-0 top-11 z-50 w-44 rounded-2xl border border-[#ead6de] bg-white p-3 shadow-2xl">
                      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#b18b9a]">
                        Text color
                      </p>

                      <div className="grid grid-cols-5 gap-2">
                        {TEXT_COLORS.map(
                          (
                            color,
                          ) => (
                            <button
                              key={
                                color
                              }
                              type="button"
                              aria-label={`Text color ${color}`}
                              onClick={() =>
                                changeTextColor(
                                  color,
                                )
                              }
                              className="h-7 w-7 rounded-full border border-black/10 shadow-sm transition hover:scale-110"
                              style={{
                                backgroundColor:
                                  color,
                              }}
                            />
                          ),
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <ToolbarButton
                  label="Highlight"
                  disabled={
                    locked
                  }
                  onClick={() => {
                    const color =
                      window.prompt(
                        'Enter a highlight color:',
                        '#fff1a8',
                      );

                    if (
                      color
                    ) {
                      executeCommand(
                        'hiliteColor',
                        color,
                      );
                    }
                  }}
                >
                  <Highlighter
                    size={16}
                  />
                </ToolbarButton>
              </div>
            </div>

            {/* EDITING AREA */}
            <div
              className={`bg-[#fffdfd] px-5 py-7 transition sm:px-10 sm:py-10 ${
                editorFocused
                  ? 'ring-2 ring-inset ring-[#e5798f]/10'
                  : ''
              }`}
            >
              <div
                ref={
                  editorRef
                }
                contentEditable={
                  !locked
                }
                suppressContentEditableWarning
                spellCheck
                onInput={
                  handleEditorInput
                }
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
                onKeyDown={(
                  event,
                ) => {
                  if (
                    event.key ===
                    'Tab'
                  ) {
                    event.preventDefault();

                    executeCommand(
                      'insertText',
                      '    ',
                    );
                  }
                }}
                className={`note-editor min-h-[55vh] w-full outline-none sm:min-h-[620px] ${
                  locked
                    ? 'cursor-not-allowed opacity-65'
                    : ''
                }`}
                data-placeholder="Start writing your thoughts..."
              />

              <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-[#f4e5e9] pt-4 text-xs text-[#b18b9a]">
                <div className="flex items-center gap-3">
                  <span>
                    {wordCount}{' '}
                    {wordCount ===
                    1
                      ? 'word'
                      : 'words'}
                  </span>

                  <span>
                    {characterCount}{' '}
                    {characterCount ===
                    1
                      ? 'character'
                      : 'characters'}
                  </span>
                </div>

                <span>
                  {locked
                    ? 'Editing locked'
                    : editorFocused
                      ? 'Editing'
                      : 'Click anywhere to continue'}
                </span>
              </div>
            </div>
          </div>

          {/* DESKTOP SIDEBAR */}
          <aside className="hidden h-fit lg:block">
            <div className="sticky top-5 space-y-4">
              {/* CATEGORY CARD */}
              <div className="rounded-3xl border border-[#f0dce3] bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-bold text-[#513342]">
                    Category
                  </h2>

                  <span className="rounded-full bg-[#fff0f4] px-2.5 py-1 text-[11px] font-bold text-[#c45470]">
                    {formatCategory(
                      note.category,
                    )}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {CATEGORY_OPTIONS.map(
                    (
                      category,
                    ) => {
                      const active =
                        normalizeCategory(
                          note.category,
                        ) ===
                        category;

                      return (
                        <button
                          key={
                            category
                          }
                          type="button"
                          disabled={
                            locked
                          }
                          onClick={() =>
                            selectCategory(
                              category,
                            )
                          }
                          className={`rounded-xl px-3 py-2.5 text-left text-xs font-semibold capitalize transition disabled:cursor-not-allowed disabled:opacity-40 ${
                            active
                              ? 'bg-[#fff0f4] text-[#c45470]'
                              : 'bg-[#faf6f8] text-[#805f6d] hover:bg-[#fff0f4]'
                          }`}
                        >
                          {formatCategory(
                            category,
                          )}
                        </button>
                      );
                    },
                  )}
                </div>

                <div className="mt-3 flex gap-2">
                  <input
                    type="text"
                    value={
                      customCategory
                    }
                    onChange={(
                      event,
                    ) =>
                      setCustomCategory(
                        event
                          .target
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
                        addCustomCategory();
                      }
                    }}
                    placeholder="Custom category"
                    disabled={
                      locked
                    }
                    className="min-w-0 flex-1 rounded-xl border border-[#ead6de] px-3 py-2 text-xs outline-none focus:border-[#e5798f] disabled:opacity-50"
                  />

                  <button
                    type="button"
                    onClick={
                      addCustomCategory
                    }
                    disabled={
                      locked ||
                      !customCategory.trim()
                    }
                    className="rounded-xl bg-[#e5798f] px-3 text-xs font-bold text-white disabled:opacity-40"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* NOTE OPTIONS */}
              <div className="rounded-3xl border border-[#f0dce3] bg-white p-5 shadow-sm">
                <h2 className="mb-3 font-bold text-[#513342]">
                  Note options
                </h2>

                <div className="space-y-2">
                  <SidebarAction
                    active={
                      Boolean(
                        note.pinned,
                      )
                    }
                    onClick={() =>
                      toggleFlag(
                        'pinned',
                      )
                    }
                    disabled={
                      locked
                    }
                  >
                    <Pin
                      size={16}
                    />
                    <span>
                      {note.pinned
                        ? 'Pinned'
                        : 'Pin note'}
                    </span>
                  </SidebarAction>

                  <SidebarAction
                    active={
                      Boolean(
                        note.favorite,
                      )
                    }
                    onClick={() =>
                      toggleFlag(
                        'favorite',
                      )
                    }
                    disabled={
                      locked
                    }
                  >
                    <span className="text-base">
                      {note.favorite
                        ? '★'
                        : '☆'}
                    </span>

                    <span>
                      {note.favorite
                        ? 'Favorite'
                        : 'Add favorite'}
                    </span>
                  </SidebarAction>

                  <SidebarAction
                    active={
                      Boolean(
                        note.archived,
                      )
                    }
                    onClick={() =>
                      toggleFlag(
                        'archived',
                      )
                    }
                    disabled={
                      locked
                    }
                  >
                    <Archive
                      size={16}
                    />

                    <span>
                      {note.archived
                        ? 'Archived'
                        : 'Archive note'}
                    </span>
                  </SidebarAction>

                  <SidebarAction
                    active={
                      locked
                    }
                    onClick={
                      toggleLock
                    }
                  >
                    {locked ? (
                      <Lock
                        size={16}
                      />
                    ) : (
                      <Unlock
                        size={16}
                      />
                    )}

                    <span>
                      {locked
                        ? 'Unlock editing'
                        : 'Lock editing'}
                    </span>
                  </SidebarAction>
                </div>
              </div>

              {/* INFORMATION */}
              <div className="rounded-3xl border border-[#f0dce3] bg-white p-5 shadow-sm">
                <h2 className="mb-4 font-bold text-[#513342]">
                  Note information
                </h2>

                <div className="space-y-3 text-sm">
                  <InfoRow
                    label="Words"
                    value={String(
                      wordCount,
                    )}
                  />

                  <InfoRow
                    label="Characters"
                    value={String(
                      characterCount,
                    )}
                  />

                  <InfoRow
                    label="Category"
                    value={formatCategory(
                      note.category,
                    )}
                  />

                  <InfoRow
                    label="Created"
                    value={formatDate(
                      note.created_at,
                    )}
                  />

                  <InfoRow
                    label="Updated"
                    value={formatDate(
                      note.updated_at,
                    )}
                  />
                </div>
              </div>

              {/* ACTIONS */}
              <div className="rounded-3xl border border-[#f0dce3] bg-white p-5 shadow-sm">
                <h2 className="mb-3 font-bold text-[#513342]">
                  Actions
                </h2>

                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={
                      copyNote
                    }
                    className="flex w-full items-center gap-3 rounded-2xl border border-[#f0dce3] px-4 py-3 text-left text-sm font-semibold text-[#805f6d] transition hover:bg-[#fff7f8]"
                  >
                    <Check
                      size={17}
                    />
                    Copy note
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      void shareNote()
                    }
                    className="flex w-full items-center gap-3 rounded-2xl border border-[#f0dce3] px-4 py-3 text-left text-sm font-semibold text-[#805f6d] transition hover:bg-[#fff7f8]"
                  >
                    <Share2
                      size={17}
                    />
                    Share note
                  </button>

                  {/* DELETE ALSO IN SIDEBAR */}
                  <button
                    type="button"
                    onClick={() =>
                      void deleteNote()
                    }
                    disabled={
                      deleting
                    }
                    className="flex w-full items-center gap-3 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-left text-sm font-semibold text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Trash2
                      size={17}
                    />

                    {deleting
                      ? 'Deleting...'
                      : 'Delete note'}
                  </button>
                </div>
              </div>
            </div>
          </aside>
        </section>
      </div>

      {/* MOBILE BOTTOM ACTION BAR */}
      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-[#eadce2] bg-white/95 px-3 py-2 shadow-[0_-10px_30px_rgba(181,105,130,0.10)] backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-1">
          <MobileAction
            label="Undo"
            disabled={
              locked ||
              !canUndo
            }
            onClick={
              undo
            }
          >
            <Undo2
              size={17}
            />
          </MobileAction>

          <MobileAction
            label="Redo"
            disabled={
              locked ||
              !canRedo
            }
            onClick={
              redo
            }
          >
            <Redo2
              size={17}
            />
          </MobileAction>

          <MobileAction
            label="Category"
            onClick={() => {
              setCategoryOpen(
                true,
              );

              window.scrollTo({
                top: 0,
                behavior:
                  'smooth',
              });
            }}
          >
            <span className="text-sm font-black">
              #
            </span>
          </MobileAction>

          <MobileAction
            label="Copy"
            onClick={
              copyNote
            }
          >
            <Check
              size={17}
            />
          </MobileAction>

          <MobileAction
            label="Share"
            onClick={() =>
              void shareNote()
            }
          >
            <Share2
              size={17}
            />
          </MobileAction>

          {/* MOBILE DELETE BUTTON */}
          <MobileAction
            label={
              deleting
                ? 'Deleting'
                : 'Delete'
            }
            disabled={
              deleting
            }
            danger
            onClick={() =>
              void deleteNote()
            }
          >
            <Trash2
              size={17}
            />
          </MobileAction>
        </div>
      </div>

      <style jsx global>{`
        .note-editor {
          color: #321f2b;
          font-size: 1.05rem;
          line-height: 1.9;
          overflow-wrap: anywhere;
          word-break: break-word;
        }

        .note-editor:focus {
          outline: none;
        }

        .note-editor:empty::before {
          content: attr(data-placeholder);
          color: #d7b9c5;
          pointer-events: none;
        }

        .note-editor p {
          min-height: 1.9em;
          margin: 0 0 1rem;
        }

        .note-editor h1,
        .note-editor h2,
        .note-editor h3,
        .note-editor h4 {
          margin: 1.35rem 0 0.75rem;
          color: #321f2b;
          font-weight: 800;
          line-height: 1.3;
        }

        .note-editor h1 {
          font-size: 2.15rem;
        }

        .note-editor h2 {
          font-size: 1.7rem;
        }

        .note-editor h3 {
          font-size: 1.4rem;
        }

        .note-editor h4 {
          font-size: 1.15rem;
        }

        .note-editor ul,
        .note-editor ol {
          margin: 1rem 0;
          padding-left: 1.8rem;
        }

        .note-editor ul {
          list-style: disc;
        }

        .note-editor ol {
          list-style: decimal;
        }

        .note-editor li {
          margin: 0.3rem 0;
        }

        .note-editor blockquote {
          margin: 1.25rem 0;
          border-left: 4px solid #e5798f;
          border-radius: 0 1rem 1rem 0;
          background: #fff7f8;
          padding: 0.85rem 1rem;
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
          font-family:
            ui-monospace,
            SFMono-Regular,
            Menlo,
            Monaco,
            Consolas,
            monospace;
          font-size: 0.9rem;
          line-height: 1.7;
        }

        .note-editor code {
          border-radius: 0.35rem;
          background: #f6edf1;
          padding: 0.15rem 0.35rem;
          font-family:
            ui-monospace,
            SFMono-Regular,
            Menlo,
            Monaco,
            Consolas,
            monospace;
          font-size: 0.9em;
        }

        .note-editor pre code {
          background: transparent;
          padding: 0;
        }

        .note-editor a {
          color: #c45470;
          text-decoration: underline;
          text-underline-offset: 3px;
        }

        .note-editor hr {
          margin: 1.75rem 0;
          border: 0;
          border-top: 1px solid #eadce2;
        }

        .note-editor img {
          max-width: 100%;
          height: auto;
          border-radius: 1rem;
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

        .enotes-checklist {
          margin: 0.55rem 0;
        }

        .enotes-checklist label {
          display: flex;
          align-items: flex-start;
          gap: 0.65rem;
          cursor: pointer;
        }

        .enotes-checklist input[type='checkbox'] {
          width: 18px;
          height: 18px;
          margin-top: 5px;
          flex-shrink: 0;
          accent-color: #e5798f;
        }

        .enotes-checklist span {
          min-width: 0;
        }

        @media (max-width: 640px) {
          .note-editor {
            font-size: 0.98rem;
            line-height: 1.8;
          }

          .note-editor h1 {
            font-size: 1.75rem;
          }

          .note-editor h2 {
            font-size: 1.45rem;
          }

          .note-editor h3 {
            font-size: 1.2rem;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          * {
            scroll-behavior: auto !important;
          }
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
      className="inline-flex h-9 min-w-9 shrink-0 items-center justify-center rounded-xl border border-transparent px-2 text-[#805f6d] transition hover:border-[#ead6de] hover:bg-white hover:text-[#321f2b] disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return (
    <span className="mx-1 hidden h-6 w-px shrink-0 bg-[#eadce2] sm:block" />
  );
}

function SidebarAction({
  children,
  onClick,
  active = false,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'bg-[#fff0f4] text-[#c45470]'
          : 'text-[#805f6d] hover:bg-[#fff7f8]'
      }`}
    >
      {children}
    </button>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-[#b18b9a]">
        {label}
      </span>

      <span className="max-w-[170px] text-right font-semibold text-[#805f6d]">
        {value}
      </span>
    </div>
  );
}

function MobileAction({
  label,
  children,
  onClick,
  disabled = false,
  danger = false,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-10 min-w-10 flex-1 items-center justify-center rounded-xl transition disabled:cursor-not-allowed disabled:opacity-30 ${
        danger
          ? 'text-red-500 hover:bg-red-50'
          : 'text-[#805f6d] hover:bg-[#fff7f8]'
      }`}
    >
      {children}
    </button>
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-[#fff7f8]">
          <div className="h-9 w-9 animate-spin rounded-full border-4 border-[#f4d6df] border-t-[#e5798f]" />
        </main>
      }
    >
      <NoteEditor />
    </Suspense>
  );
}
