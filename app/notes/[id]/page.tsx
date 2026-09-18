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
  FileText,
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
import type { NoteRow } from '@/app/notes/page';

type SaveState =
  | 'idle'
  | 'loading'
  | 'saving'
  | 'saved'
  | 'unsaved'
  | 'error';

type NoticeType = 'success' | 'error' | 'info';

type Notice = {
  type: NoticeType;
  message: string;
};

type HistorySnapshot = {
  title: string;
  content: string;
};

const DEFAULT_CONTENT =
  '<p>Start writing your note here...</p>';

const DEFAULT_CATEGORY = 'General';

const CATEGORIES = [
  'General',
  'Personal',
  'Ideas',
  'Work',
  'School',
  'Projects',
  'Important',
  'Todo',
  'Diary',
  'Other',
];

const FONT_SIZES = [
  { label: 'Small', value: '2' },
  { label: 'Normal', value: '3' },
  { label: 'Large', value: '5' },
  { label: 'Huge', value: '7' },
];

function normalizeCategory(value: unknown) {
  const category = String(value ?? '').trim();
  return category || DEFAULT_CATEGORY;
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return 'Not saved yet';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Not saved yet';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function createEmptyNote(userId: string): NoteRow {
  const now = new Date().toISOString();

  return {
    id: 'new',
    user_id: userId,
    title: '',
    content: DEFAULT_CONTENT,
    category: DEFAULT_CATEGORY,
    is_pinned: false,
    is_favorite: false,
    is_archived: false,
    created_at: now,
    updated_at: now,
  };
}

function getTextFromHtml(html: string) {
  if (typeof window === 'undefined') {
    return html.replace(/<[^>]*>/g, ' ');
  }

  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
}

function countWords(text: string) {
  const trimmed = text.trim();

  if (!trimmed) return 0;

  return trimmed.split(/\s+/).filter(Boolean).length;
}

function countCharacters(text: string) {
  return text.length;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function NoteEditor() {
  const params = useParams();
  const router = useRouter();

  const routeId = useMemo(() => {
    const value = params?.id;

    if (Array.isArray(value)) {
      return value[0] ?? '';
    }

    return String(value ?? '');
  }, [params]);

  const initialRouteIdRef = useRef(routeId);

  const isNewRoute =
    initialRouteIdRef.current === 'new';

  const titleRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);

  const saveTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const mountedRef = useRef(true);

  const noteRef = useRef<NoteRow | null>(null);

  const dirtyRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const creationInFlightRef = useRef(false);

  const saveVersionRef = useRef(0);
  const lastSavedVersionRef = useRef(0);

  const historyRef = useRef<HistorySnapshot[]>([]);
  const redoRef = useRef<HistorySnapshot[]>([]);
  const historyApplyingRef = useRef(false);

  const [note, setNote] = useState<NoteRow | null>(null);

  const [loading, setLoading] = useState(true);

  const [saveState, setSaveState] =
    useState<SaveState>('loading');

  const [notice, setNotice] =
    useState<Notice | null>(null);

  const [locked, setLocked] = useState(false);

  const [categoryOpen, setCategoryOpen] =
    useState(false);

  const [customCategory, setCustomCategory] =
    useState('');

  const [heading, setHeading] =
    useState('p');

  const [fontSize, setFontSize] =
    useState('3');

  const [editorFocused, setEditorFocused] =
    useState(false);

  const [historyLength, setHistoryLength] =
    useState(0);

  const [redoLength, setRedoLength] =
    useState(0);

  const [deleting, setDeleting] =
    useState(false);

  const [userId, setUserId] =
    useState<string | null>(null);

  const showNotice = useCallback(
    (
      type: NoticeType,
      message: string,
      duration = 3500,
    ) => {
      if (!mountedRef.current) return;

      setNotice({
        type,
        message,
      });

      window.setTimeout(() => {
        if (mountedRef.current) {
          setNotice((current) =>
            current?.message === message
              ? null
              : current,
          );
        }
      }, duration);
    },
    [],
  );

  const currentSnapshot = useCallback((): HistorySnapshot => {
    return {
      title: titleRef.current?.value ?? noteRef.current?.title ?? '',
      content:
        editorRef.current?.innerHTML ??
        noteRef.current?.content ??
        '',
    };
  }, []);

  const updateHistoryIndicators = useCallback(() => {
    setHistoryLength(historyRef.current.length);
    setRedoLength(redoRef.current.length);
  }, []);

  const pushHistory = useCallback(
    (snapshot?: HistorySnapshot) => {
      if (historyApplyingRef.current) return;

      const next = snapshot ?? currentSnapshot();

      const previous =
        historyRef.current[
          historyRef.current.length - 1
        ];

      if (
        previous &&
        previous.title === next.title &&
        previous.content === next.content
      ) {
        return;
      }

      historyRef.current = [
        ...historyRef.current,
        next,
      ].slice(-100);

      redoRef.current = [];

      updateHistoryIndicators();
    },
    [currentSnapshot, updateHistoryIndicators],
  );

  const applySnapshot = useCallback(
    (snapshot: HistorySnapshot) => {
      historyApplyingRef.current = true;

      if (titleRef.current) {
        titleRef.current.value = snapshot.title;
      }

      if (editorRef.current) {
        editorRef.current.innerHTML =
          snapshot.content || '<p><br></p>';
      }

      setNote((current) =>
        current
          ? {
              ...current,
              title: snapshot.title,
              content: snapshot.content,
            }
          : current,
      );

      if (noteRef.current) {
        noteRef.current = {
          ...noteRef.current,
          title: snapshot.title,
          content: snapshot.content,
        };
      }

      historyApplyingRef.current = false;
    },
    [],
  );

  const undo = useCallback(() => {
    if (!historyRef.current.length) return;

    const current = currentSnapshot();

    redoRef.current = [
      ...redoRef.current,
      current,
    ].slice(-100);

    const previous =
      historyRef.current.pop();

    if (!previous) return;

    applySnapshot(previous);

    dirtyRef.current = true;
    saveVersionRef.current += 1;

    setSaveState('unsaved');

    updateHistoryIndicators();
  }, [
    applySnapshot,
    currentSnapshot,
    updateHistoryIndicators,
  ]);

  const redo = useCallback(() => {
    if (!redoRef.current.length) return;

    const current = currentSnapshot();

    historyRef.current = [
      ...historyRef.current,
      current,
    ].slice(-100);

    const next = redoRef.current.pop();

    if (!next) return;

    applySnapshot(next);

    dirtyRef.current = true;
    saveVersionRef.current += 1;

    setSaveState('unsaved');

    updateHistoryIndicators();
  }, [
    applySnapshot,
    currentSnapshot,
    updateHistoryIndicators,
  ]);

  const markDirty = useCallback(() => {
    if (historyApplyingRef.current) return;

    dirtyRef.current = true;
    saveVersionRef.current += 1;

    setSaveState('unsaved');

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {
      void saveNow();
    }, 800);
  }, []);

  const syncFromInputs = useCallback(() => {
    const title =
      titleRef.current?.value.trim() ?? '';

    const content =
      editorRef.current?.innerHTML ??
      '<p><br></p>';

    setNote((current) =>
      current
        ? {
            ...current,
            title,
            content,
          }
        : current,
    );

    if (noteRef.current) {
      noteRef.current = {
        ...noteRef.current,
        title,
        content,
      };
    }
  }, []);

  const ensureRow = useCallback(async () => {
    if (!userId) {
      throw new Error('You must be signed in.');
    }

    if (noteRef.current?.id !== 'new') {
      return noteRef.current;
    }

    if (creationInFlightRef.current) {
      return noteRef.current;
    }

    creationInFlightRef.current = true;

    const source =
      noteRef.current ?? createEmptyNote(userId);

    const title =
      titleRef.current?.value.trim() || 'Untitled Note';

    const content =
      editorRef.current?.innerHTML ||
      DEFAULT_CONTENT;

    const category =
      normalizeCategory(source.category);

    const { data, error } = await supabase
      .from('notes')
      .insert({
        user_id: userId,
        title,
        content,
        category,
        is_pinned: Boolean(source.is_pinned),
        is_favorite: Boolean(source.is_favorite),
        is_archived: Boolean(source.is_archived),
      })
      .select('*')
      .single();

    creationInFlightRef.current = false;

    if (error) {
      throw error;
    }

    noteRef.current = data as NoteRow;

    setNote(data as NoteRow);

    dirtyRef.current = false;
    lastSavedVersionRef.current =
      saveVersionRef.current;

    setSaveState('saved');

    router.replace(`/notes/${data.id}`);

    return data as NoteRow;
  }, [router, userId]);

  const saveNow = useCallback(async () => {
    if (!userId) return;

    if (saveInFlightRef.current) {
      return;
    }

    if (!dirtyRef.current && !isNewRoute) {
      return;
    }

    saveInFlightRef.current = true;

    const versionAtStart =
      saveVersionRef.current;

    try {
      setSaveState('saving');

      syncFromInputs();

      if (isNewRoute && noteRef.current?.id === 'new') {
        await ensureRow();
      } else {
        const current =
          noteRef.current;

        if (!current) {
          return;
        }

        const title =
          titleRef.current?.value.trim() ?? '';

        const content =
          editorRef.current?.innerHTML ??
          '<p><br></p>';

        const { data, error } =
          await supabase
            .from('notes')
            .update({
              title,
              content,
              category:
                normalizeCategory(
                  current.category,
                ),
              is_pinned:
                Boolean(current.is_pinned),
              is_favorite:
                Boolean(current.is_favorite),
              is_archived:
                Boolean(current.is_archived),
            })
            .eq('id', current.id)
            .eq('user_id', userId)
            .select('*')
            .single();

        if (error) {
          throw error;
        }

        if (data) {
          noteRef.current =
            data as NoteRow;

          setNote(data as NoteRow);
        }
      }

      if (
        versionAtStart ===
        saveVersionRef.current
      ) {
        dirtyRef.current = false;

        lastSavedVersionRef.current =
          versionAtStart;

        setSaveState('saved');
      } else {
        setSaveState('unsaved');

        if (saveTimerRef.current) {
          clearTimeout(
            saveTimerRef.current,
          );
        }

        saveTimerRef.current =
          setTimeout(() => {
            void saveNow();
          }, 800);
      }
    } catch (error) {
      console.error(
        'Failed to save note:',
        error,
      );

      setSaveState('error');

      showNotice(
        'error',
        error instanceof Error
          ? error.message
          : 'Failed to save your note.',
      );
    } finally {
      saveInFlightRef.current = false;
    }
  }, [
    ensureRow,
    isNewRoute,
    showNotice,
    syncFromInputs,
    userId,
  ]);

  const updateFlag = useCallback(
    async (
      field:
        | 'is_pinned'
        | 'is_favorite'
        | 'is_archived',
    ) => {
      if (!noteRef.current) return;

      const nextValue =
        !Boolean(noteRef.current[field]);

      noteRef.current = {
        ...noteRef.current,
        [field]: nextValue,
      };

      setNote({
        ...noteRef.current,
      });

      dirtyRef.current = true;
      saveVersionRef.current += 1;

      setSaveState('unsaved');

      if (isNewRoute) {
        if (saveTimerRef.current) {
          clearTimeout(
            saveTimerRef.current,
          );
        }

        saveTimerRef.current =
          setTimeout(() => {
            void saveNow();
          }, 400);

        return;
      }

      try {
        const { error } =
          await supabase
            .from('notes')
            .update({
              [field]: nextValue,
            })
            .eq('id', noteRef.current.id)
            .eq('user_id', userId);

        if (error) {
          throw error;
        }

        dirtyRef.current = false;
        setSaveState('saved');
      } catch (error) {
        console.error(error);

        showNotice(
          'error',
          'Could not update the note.',
        );

        noteRef.current = {
          ...noteRef.current,
          [field]: !nextValue,
        };

        setNote({
          ...noteRef.current,
        });

        setSaveState('error');
      }
    },
    [
      isNewRoute,
      saveNow,
      showNotice,
      userId,
    ],
  );

  const executeCommand = useCallback(
    (
      command: string,
      value?: string,
    ) => {
      if (locked) return;

      editorRef.current?.focus();

      pushHistory();

      try {
        document.execCommand(
          command,
          false,
          value,
        );
      } catch (error) {
        console.error(
          `execCommand(${command}) failed`,
          error,
        );
      }

      syncFromInputs();
      markDirty();
    },
    [
      locked,
      markDirty,
      pushHistory,
      syncFromInputs,
    ],
  );

  const formatHeading = useCallback(
    (value: string) => {
      if (locked) return;

      setHeading(value);

      executeCommand(
        'formatBlock',
        value,
      );
    },
    [executeCommand, locked],
  );

  const changeFontSize = useCallback(
    (value: string) => {
      if (locked) return;

      setFontSize(value);

      executeCommand(
        'fontSize',
        value,
      );
    },
    [executeCommand, locked],
  );

  const createLink = useCallback(() => {
    if (locked) return;

    const url = window.prompt(
      'Enter the URL:',
      'https://',
    );

    if (!url) return;

    executeCommand(
      'createLink',
      url.trim(),
    );
  }, [executeCommand, locked]);

  const insertChecklist = useCallback(() => {
    if (locked) return;

    const selectedText =
      window.getSelection()?.toString() ?? '';

    pushHistory();

    const text =
      selectedText.trim() ||
      'Checklist item';

    const html = `
      <div class="enotes-checklist-item">
        <label>
          <input type="checkbox" />
          <span>${escapeHtml(text)}</span>
        </label>
      </div>
    `;

    executeCommand(
      'insertHTML',
      html,
    );
  }, [
    executeCommand,
    locked,
    pushHistory,
  ]);

  const insertHorizontalRule =
    useCallback(() => {
      if (locked) return;

      executeCommand(
        'insertHorizontalRule',
      );
    }, [executeCommand, locked]);

  const insertCode = useCallback(() => {
    if (locked) return;

    const selected =
      window.getSelection()?.toString() ?? '';

    const content =
      selected || 'code';

    const html = `
      <pre><code>${escapeHtml(
        content,
      )}</code></pre>
    `;

    executeCommand(
      'insertHTML',
      html,
    );
  }, [executeCommand, locked]);

  const setTextColor = useCallback(() => {
    if (locked) return;

    const color =
      window.prompt(
        'Enter a text color:',
        '#E5798F',
      );

    if (!color) return;

    executeCommand(
      'foreColor',
      color.trim(),
    );
  }, [executeCommand, locked]);

  const setHighlight = useCallback(() => {
    if (locked) return;

    const color =
      window.prompt(
        'Enter a highlight color:',
        '#FFF2A8',
      );

    if (!color) return;

    editorRef.current?.focus();

    pushHistory();

    try {
      document.execCommand(
        'hiliteColor',
        false,
        color.trim(),
      );
    } catch {
      try {
        document.execCommand(
          'backColor',
          false,
          color.trim(),
        );
      } catch {
        // Ignore unsupported command.
      }
    }

    syncFromInputs();
    markDirty();
  }, [
    locked,
    markDirty,
    pushHistory,
    syncFromInputs,
  ]);

  const selectCategory =
    useCallback(
      (category: string) => {
        const normalized =
          normalizeCategory(category);

        if (!noteRef.current) return;

        noteRef.current = {
          ...noteRef.current,
          category: normalized,
        };

        setNote({
          ...noteRef.current,
        });

        setCategoryOpen(false);

        dirtyRef.current = true;
        saveVersionRef.current += 1;

        setSaveState('unsaved');

        if (saveTimerRef.current) {
          clearTimeout(
            saveTimerRef.current,
          );
        }

        saveTimerRef.current =
          setTimeout(() => {
            void saveNow();
          }, 500);
      },
      [saveNow],
    );

  const addCustomCategory =
    useCallback(() => {
      const value =
        customCategory.trim();

      if (!value) return;

      selectCategory(value);
      setCustomCategory('');
    }, [
      customCategory,
      selectCategory,
    ]);

  const toggleLock = useCallback(() => {
    setLocked((current) => {
      const next = !current;

      showNotice(
        'info',
        next
          ? 'Editing is locked on this device.'
          : 'Editing is unlocked.',
      );

      return next;
    });
  }, [showNotice]);

  const copyNote = useCallback(
    async () => {
      const current =
        noteRef.current;

      if (!current) return;

      const title =
        titleRef.current?.value ||
        current.title ||
        'Untitled Note';

      const content =
        editorRef.current?.innerHTML ||
        current.content ||
        '';

      const text =
        `${title}\n\n${getTextFromHtml(
          content,
        )}`.trim();

      try {
        await navigator.clipboard.writeText(
          text,
        );

        showNotice(
          'success',
          'Note copied to your clipboard.',
        );
      } catch {
        showNotice(
          'error',
          'Could not copy the note.',
        );
      }
    },
    [showNotice],
  );

  const shareNote = useCallback(
    async () => {
      const current =
        noteRef.current;

      if (!current || current.id === 'new') {
        await saveNow();
      }

      const id =
        noteRef.current?.id;

      if (!id || id === 'new') {
        showNotice(
          'error',
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
          await navigator.share({
            title:
              titleRef.current?.value ||
              'My note',
            text: 'Shared from enotes',
            url,
          });

          return;
        }

        await navigator.clipboard.writeText(
          url,
        );

        showNotice(
          'success',
          'Note link copied.',
        );
      } catch (error) {
        if (
          error instanceof DOMException &&
          error.name === 'AbortError'
        ) {
          return;
        }

        showNotice(
          'error',
          'Could not share the note.',
        );
      }
    },
    [saveNow, showNotice],
  );

  const deleteNote = useCallback(
    async () => {
      const current =
        noteRef.current;

      if (
        !current ||
        current.id === 'new'
      ) {
        router.push('/notes');
        return;
      }

      const confirmed =
        window.confirm(
          'Delete this note permanently?',
        );

      if (!confirmed) return;

      setDeleting(true);

      try {
        const { error } =
          await supabase
            .from('notes')
            .delete()
            .eq('id', current.id)
            .eq('user_id', userId);

        if (error) {
          throw error;
        }

        router.push('/notes');
        router.refresh();
      } catch (error) {
        console.error(error);

        showNotice(
          'error',
          'Could not delete this note.',
        );

        setDeleting(false);
      }
    },
    [
      router,
      showNotice,
      userId,
    ],
  );

  const handleTitleInput =
    useCallback(() => {
      pushHistory();
      syncFromInputs();
      markDirty();
    }, [
      markDirty,
      pushHistory,
      syncFromInputs,
    ]);

  const handleEditorInput =
    useCallback(() => {
      pushHistory();
      syncFromInputs();
      markDirty();
    }, [
      markDirty,
      pushHistory,
      syncFromInputs,
    ]);

  const handleEditorKeyDown =
    useCallback(
      (event: React.KeyboardEvent) => {
        const modifier =
          event.ctrlKey ||
          event.metaKey;

        if (modifier) {
          const key =
            event.key.toLowerCase();

          if (key === 'b') {
            event.preventDefault();
            executeCommand('bold');
            return;
          }

          if (key === 'i') {
            event.preventDefault();
            executeCommand('italic');
            return;
          }

          if (key === 'u') {
            event.preventDefault();
            executeCommand('underline');
            return;
          }

          if (key === 's') {
            event.preventDefault();
            void saveNow();
            return;
          }

          if (
            key === 'z' &&
            !event.shiftKey
          ) {
            event.preventDefault();
            undo();
            return;
          }

          if (
            key === 'z' &&
            event.shiftKey
          ) {
            event.preventDefault();
            redo();
            return;
          }

          if (key === 'y') {
            event.preventDefault();
            redo();
            return;
          }
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

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      if (saveTimerRef.current) {
        clearTimeout(
          saveTimerRef.current,
        );
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setSaveState('loading');

      try {
        const {
          data: {
            user,
          },
          error: authError,
        } = await supabase.auth.getUser();

        if (authError) {
          throw authError;
        }

        if (!user) {
          router.replace('/signin');
          return;
        }

        if (cancelled) return;

        setUserId(user.id);

        if (isNewRoute) {
          const empty =
            createEmptyNote(user.id);

          noteRef.current = empty;

          setNote(empty);

          dirtyRef.current = true;

          setSaveState('unsaved');

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

        if (error) {
          throw error;
        }

        if (!data) {
          router.replace('/notes');
          return;
        }

        if (cancelled) return;

        const loaded =
          data as NoteRow;

        noteRef.current = loaded;

        setNote(loaded);

        dirtyRef.current = false;

        setSaveState('saved');
      } catch (error) {
        console.error(
          'Failed to load note:',
          error,
        );

        if (!cancelled) {
          setSaveState('error');

          showNotice(
            'error',
            error instanceof Error
              ? error.message
              : 'Could not load this note.',
            5000,
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [
    isNewRoute,
    routeId,
    router,
    showNotice,
  ]);

  useEffect(() => {
    if (loading || !note) return;

    if (titleRef.current) {
      titleRef.current.value =
        note.title ?? '';
    }

    if (editorRef.current) {
      editorRef.current.innerHTML =
        note.content ||
        '<p><br></p>';
    }

    historyRef.current = [];
    redoRef.current = [];

    updateHistoryIndicators();
  }, [
    loading,
    note,
    updateHistoryIndicators,
  ]);

  useEffect(() => {
    function handleBeforeUnload(
      event: BeforeUnloadEvent,
    ) {
      if (
        dirtyRef.current ||
        saveInFlightRef.current
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    }

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
  }, []);

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
          }

          if (dirtyRef.current) {
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
    const handleGlobalKey =
      (event: KeyboardEvent) => {
        const modifier =
          event.ctrlKey ||
          event.metaKey;

        if (
          modifier &&
          event.key.toLowerCase() ===
            's'
        ) {
          event.preventDefault();
          void saveNow();
        }
      };

    window.addEventListener(
      'keydown',
      handleGlobalKey,
    );

    return () => {
      window.removeEventListener(
        'keydown',
        handleGlobalKey,
      );
    };
  }, [saveNow]);

  useEffect(() => {
    const editor =
      editorRef.current;

    if (!editor) return;

    const handleChecklistClick =
      (event: MouseEvent) => {
        const target =
          event.target as HTMLElement | null;

        if (
          !target ||
          target.tagName !== 'INPUT'
        ) {
          return;
        }

        const input =
          target as HTMLInputElement;

        if (
          input.type !== 'checkbox'
        ) {
          return;
        }

        if (locked) {
          event.preventDefault();
          return;
        }

        pushHistory();

        const label =
          input.closest('label');

        const span =
          label?.querySelector(
            'span',
          );

        if (span) {
          span.style.textDecoration =
            input.checked
              ? 'line-through'
              : 'none';

          span.style.opacity =
            input.checked
              ? '0.55'
              : '1';
        }

        syncFromInputs();
        markDirty();
      };

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
    locked,
    markDirty,
    pushHistory,
    syncFromInputs,
  ]);

  const plainText = useMemo(() => {
    return getTextFromHtml(
      note?.content ?? '',
    );
  }, [note?.content]);

  const wordCount =
    countWords(plainText);

  const characterCount =
    countCharacters(plainText);

  const saveLabel =
    saveState === 'loading'
      ? 'Loading…'
      : saveState === 'saving'
        ? 'Saving…'
        : saveState === 'saved'
          ? 'Saved'
          : saveState === 'unsaved'
            ? 'Unsaved changes'
            : saveState === 'error'
              ? 'Save failed'
              : 'Ready';

  const saveIndicatorClass =
    saveState === 'saved'
      ? 'text-emerald-600'
      : saveState === 'error'
        ? 'text-red-600'
        : saveState === 'saving'
          ? 'text-blue-600'
          : 'text-slate-500';

  if (loading) {
    return (
      <main className="min-h-screen bg-[#FFF7F8]">
        <div className="mx-auto flex min-h-screen max-w-7xl items-center justify-center px-4">
          <div className="flex flex-col items-center gap-4">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#E5798F]/20 border-t-[#E5798F]" />
            <p className="text-sm font-medium text-slate-500">
              Loading your note…
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (!note) {
    return (
      <main className="min-h-screen bg-[#FFF7F8]">
        <div className="mx-auto flex min-h-screen max-w-xl items-center justify-center px-4">
          <div className="w-full rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <FileText className="mx-auto mb-4 h-12 w-12 text-slate-300" />
            <h1 className="text-xl font-bold text-slate-900">
              Note unavailable
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              This note could not be loaded.
            </p>

            <Link
              href="/notes"
              className="mt-6 inline-flex rounded-xl bg-[#E5798F] px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Back to notes
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#FFF7F8] text-slate-900">
      <div className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 shadow-sm backdrop-blur-xl">
        <div className="mx-auto max-w-[1500px] px-3 sm:px-5 lg:px-8">
          <div className="flex min-h-16 items-center gap-2">
            <Link
              href="/notes"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              aria-label="Back to notes"
            >
              <span className="text-xl">
                ←
              </span>
            </Link>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <input
                  ref={titleRef}
                  type="text"
                  defaultValue={
                    note.title ?? ''
                  }
                  onChange={
                    handleTitleInput
                  }
                  disabled={locked}
                  placeholder="Untitled note"
                  className="w-full min-w-0 border-0 bg-transparent p-0 text-base font-bold outline-none placeholder:text-slate-300 sm:text-lg"
                />
              </div>

              <div className="hidden items-center gap-2 text-xs text-slate-400 sm:flex">
                <span>
                  {normalizeCategory(
                    note.category,
                  )}
                </span>

                <span>•</span>

                <span
                  className={
                    saveIndicatorClass
                  }
                >
                  {saveLabel}
                </span>

                {!isNewRoute &&
                  note.updated_at && (
                    <>
                      <span>•</span>
                      <span>
                        {formatTimestamp(
                          note.updated_at,
                        )}
                      </span>
                    </>
                  )}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  updateFlag(
                    'is_pinned',
                  )
                }
                className={`hidden h-10 w-10 items-center justify-center rounded-xl transition sm:inline-flex ${
                  note.is_pinned
                    ? 'bg-amber-50 text-amber-600'
                    : 'text-slate-500 hover:bg-slate-100'
                }`}
                title="Pin"
              >
                <Pin className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={toggleLock}
                className={`hidden h-10 w-10 items-center justify-center rounded-xl transition sm:inline-flex ${
                  locked
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-500 hover:bg-slate-100'
                }`}
                title={
                  locked
                    ? 'Unlock editing'
                    : 'Lock editing'
                }
              >
                {locked ? (
                  <Lock className="h-4 w-4" />
                ) : (
                  <Unlock className="h-4 w-4" />
                )}
              </button>

              <button
                type="button"
                onClick={() =>
                  void saveNow()
                }
                disabled={
                  saveState === 'saving'
                }
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#E5798F] px-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:px-4"
              >
                <Save className="h-4 w-4" />
                <span className="hidden sm:inline">
                  Save
                </span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1 overflow-x-auto pb-2 pt-0.5 sm:hidden">
            <button
              type="button"
              onClick={() =>
                updateFlag('is_pinned')
              }
              className={`flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold ${
                note.is_pinned
                  ? 'bg-amber-50 text-amber-600'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              <Pin className="h-3.5 w-3.5" />
              Pin
            </button>

            <button
              type="button"
              onClick={toggleLock}
              className={`flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold ${
                locked
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {locked ? (
                <Lock className="h-3.5 w-3.5" />
              ) : (
                <Unlock className="h-3.5 w-3.5" />
              )}
              {locked ? 'Locked' : 'Lock'}
            </button>

            <button
              type="button"
              onClick={() =>
                void shareNote()
              }
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-xs font-semibold text-slate-600"
            >
              <Share2 className="h-3.5 w-3.5" />
              Share
            </button>
          </div>
        </div>
      </div>

      {notice && (
        <div className="fixed right-4 top-20 z-[70] max-w-[calc(100vw-2rem)] sm:right-6">
          <div
            className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm font-medium shadow-xl ${
              notice.type === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : notice.type === 'error'
                  ? 'border-red-200 bg-red-50 text-red-800'
                  : 'border-blue-200 bg-blue-50 text-blue-800'
            }`}
          >
            <Check className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {notice.message}
            </span>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-[1500px] px-3 py-4 sm:px-5 sm:py-6 lg:px-8 lg:py-8">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
          <section className="min-w-0">
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 bg-white">
                <div className="flex items-center gap-1 overflow-x-auto px-3 py-2">
                  <button
                    type="button"
                    onClick={undo}
                    disabled={
                      locked ||
                      historyLength === 0
                    }
                    className="toolbar-button"
                    title="Undo"
                  >
                    <Undo2 className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    onClick={redo}
                    disabled={
                      locked ||
                      redoLength === 0
                    }
                    className="toolbar-button"
                    title="Redo"
                  >
                    <Redo2 className="h-4 w-4" />
                  </button>

                  <div className="toolbar-divider" />

                  <button
                    type="button"
                    onClick={() =>
                      executeCommand(
                        'bold',
                      )
                    }
                    disabled={locked}
                    className="toolbar-button"
                    title="Bold (Ctrl+B)"
                  >
                    <Bold className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      executeCommand(
                        'italic',
                      )
                    }
                    disabled={locked}
                    className="toolbar-button"
                    title="Italic (Ctrl+I)"
                  >
                    <Italic className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      executeCommand(
                        'underline',
                      )
                    }
                    disabled={locked}
                    className="toolbar-button"
                    title="Underline (Ctrl+U)"
                  >
                    <Underline className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      executeCommand(
                        'strikeThrough',
                      )
                    }
                    disabled={locked}
                    className="toolbar-button"
                    title="Strikethrough"
                  >
                    <Strikethrough className="h-4 w-4" />
                  </button>

                  <div className="toolbar-divider" />

                  <div className="relative shrink-0">
                    <select
                      value={heading}
                      onChange={(event) =>
                        formatHeading(
                          event.target.value,
                        )
                      }
                      disabled={locked}
                      className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 outline-none transition focus:border-[#E5798F]"
                      title="Heading"
                    >
                      <option value="p">
                        Normal
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

                  <select
                    value={fontSize}
                    onChange={(event) =>
                      changeFontSize(
                        event.target.value,
                      )
                    }
                    disabled={locked}
                    className="h-9 shrink-0 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 outline-none transition focus:border-[#E5798F]"
                    title="Font size"
                  >
                    {FONT_SIZES.map(
                      (item) => (
                        <option
                          key={item.value}
                          value={
                            item.value
                          }
                        >
                          {item.label}
                        </option>
                      ),
                    )}
                  </select>

                  <div className="toolbar-divider" />

                  <button
                    type="button"
                    onClick={() =>
                      executeCommand(
                        'insertUnorderedList',
                      )
                    }
                    disabled={locked}
                    className="toolbar-button"
                    title="Bullet list"
                  >
                    <List className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      executeCommand(
                        'insertOrderedList',
                      )
                    }
                    disabled={locked}
                    className="toolbar-button"
                    title="Numbered list"
                  >
                    <ListOrdered className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    onClick={
                      insertChecklist
                    }
                    disabled={locked}
                    className="toolbar-button"
                    title="Checklist"
                  >
                    <Check className="h-4 w-4" />
                  </button>

                  <div className="toolbar-divider" />

                  <button
                    type="button"
                    onClick={() =>
                      executeCommand(
                        'justifyLeft',
                      )
                    }
                    disabled={locked}
                    className="toolbar-button"
                    title="Align left"
                  >
                    <AlignLeft className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      executeCommand(
                        'justifyCenter',
                      )
                    }
                    disabled={locked}
                    className="toolbar-button"
                    title="Align center"
                  >
                    <AlignCenter className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      executeCommand(
                        'justifyRight',
                      )
                    }
                    disabled={locked}
                    className="toolbar-button"
                    title="Align right"
                  >
                    <AlignRight className="h-4 w-4" />
                  </button>

                  <div className="toolbar-divider" />

                  <button
                    type="button"
                    onClick={
                      createLink
                    }
                    disabled={locked}
                    className="toolbar-button"
                    title="Insert link"
                  >
                    <Link2 className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    onClick={
                      insertCode
                    }
                    disabled={locked}
                    className="toolbar-button"
                    title="Code"
                  >
                    <Code2 className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    onClick={
                      insertHorizontalRule
                    }
                    disabled={locked}
                    className="toolbar-button"
                    title="Horizontal rule"
                  >
                    <span className="text-base font-bold">
                      ―
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={
                      setTextColor
                    }
                    disabled={locked}
                    className="toolbar-button"
                    title="Text color"
                  >
                    <Palette className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    onClick={
                      setHighlight
                    }
                    disabled={locked}
                    className="toolbar-button"
                    title="Highlight"
                  >
                    <Highlighter className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div
                className={`min-h-[65vh] bg-white px-4 py-5 sm:px-8 sm:py-8 lg:px-12 lg:py-10 ${
                  editorFocused
                    ? 'ring-2 ring-inset ring-[#E5798F]/10'
                    : ''
                }`}
              >
                <div
                  ref={editorRef}
                  contentEditable={
                    !locked
                  }
                  suppressContentEditableWarning
                  spellCheck
                  onInput={
                    handleEditorInput
                  }
                  onKeyDown={
                    handleEditorKeyDown
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
                  className="note-editor mx-auto min-h-[60vh] max-w-[900px] outline-none"
                  data-placeholder="Start writing..."
                />
              </div>

              <div className="border-t border-slate-200 bg-slate-50/70 px-4 py-3 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                  <div className="flex flex-wrap items-center gap-3">
                    <span>
                      {wordCount}{' '}
                      {wordCount === 1
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

                  <div>
                    {locked
                      ? 'Editing locked'
                      : editorFocused
                        ? 'Editing'
                        : 'Click anywhere to continue writing'}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <aside className="hidden lg:block">
            <div className="sticky top-24 space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-bold text-slate-900">
                    Note options
                  </h2>

                  <ChevronDown className="h-4 w-4 text-slate-400" />
                </div>

                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() =>
                      updateFlag(
                        'is_pinned',
                      )
                    }
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                      note.is_pinned
                        ? 'bg-amber-50 text-amber-700'
                        : 'hover:bg-slate-50 text-slate-600'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <Pin className="h-4 w-4" />
                      Pinned
                    </span>

                    <span>
                      {note.is_pinned
                        ? 'On'
                        : 'Off'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      updateFlag(
                        'is_favorite',
                      )
                    }
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                      note.is_favorite
                        ? 'bg-pink-50 text-[#E5798F]'
                        : 'hover:bg-slate-50 text-slate-600'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-base">
                        ♥
                      </span>
                      Favorite
                    </span>

                    <span>
                      {note.is_favorite
                        ? 'On'
                        : 'Off'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      updateFlag(
                        'is_archived',
                      )
                    }
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                      note.is_archived
                        ? 'bg-slate-100 text-slate-800'
                        : 'hover:bg-slate-50 text-slate-600'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <Archive className="h-4 w-4" />
                      Archived
                    </span>

                    <span>
                      {note.is_archived
                        ? 'On'
                        : 'Off'}
                    </span>
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 text-sm font-bold text-slate-900">
                  Category
                </h2>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() =>
                      setCategoryOpen(
                        (value) =>
                          !value,
                      )
                    }
                    className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:border-slate-300"
                  >
                    <span>
                      {normalizeCategory(
                        note.category,
                      )}
                    </span>

                    <ChevronDown className="h-4 w-4 text-slate-400" />
                  </button>

                  {categoryOpen && (
                    <div className="absolute left-0 right-0 top-full z-20 mt-2 rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
                      {CATEGORIES.map(
                        (category) => (
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
                            className={`w-full rounded-lg px-3 py-2 text-left text-sm transition hover:bg-slate-50 ${
                              normalizeCategory(
                                note.category,
                              ) ===
                              category
                                ? 'font-semibold text-[#E5798F]'
                                : 'text-slate-600'
                            }`}
                          >
                            {
                              category
                            }
                          </button>
                        ),
                      )}

                      <div className="my-1 border-t border-slate-100" />

                      <div className="flex gap-1 p-1">
                        <input
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
                              addCustomCategory();
                            }
                          }}
                          placeholder="Custom..."
                          className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-[#E5798F]"
                        />

                        <button
                          type="button"
                          onClick={
                            addCustomCategory
                          }
                          className="rounded-lg bg-[#E5798F] px-2.5 text-xs font-semibold text-white"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 text-sm font-bold text-slate-900">
                  Actions
                </h2>

                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={
                      copyNote
                    }
                    className="side-action"
                  >
                    <FileText className="h-4 w-4" />
                    Copy note
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      void shareNote()
                    }
                    className="side-action"
                  >
                    <Share2 className="h-4 w-4" />
                    Share
                  </button>

                  <button
                    type="button"
                    onClick={
                      toggleLock
                    }
                    className="side-action"
                  >
                    {locked ? (
                      <Unlock className="h-4 w-4" />
                    ) : (
                      <Lock className="h-4 w-4" />
                    )}
                    {locked
                      ? 'Unlock editing'
                      : 'Lock editing'}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      void deleteNote()
                    }
                    disabled={deleting}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    {deleting
                      ? 'Deleting…'
                      : 'Delete note'}
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 text-sm font-bold text-slate-900">
                  Note information
                </h2>

                <div className="space-y-2 text-xs text-slate-500">
                  <div className="flex justify-between gap-3">
                    <span>Words</span>
                    <span className="font-semibold text-slate-700">
                      {wordCount}
                    </span>
                  </div>

                  <div className="flex justify-between gap-3">
                    <span>Characters</span>
                    <span className="font-semibold text-slate-700">
                      {characterCount}
                    </span>
                  </div>

                  <div className="flex justify-between gap-3">
                    <span>Created</span>
                    <span className="text-right font-medium text-slate-700">
                      {formatTimestamp(
                        note.created_at,
                      )}
                    </span>
                  </div>

                  <div className="flex justify-between gap-3">
                    <span>Updated</span>
                    <span className="text-right font-medium text-slate-700">
                      {formatTimestamp(
                        note.updated_at,
                      )}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/95 px-3 py-2 shadow-[0_-5px_20px_rgba(0,0,0,0.06)] backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-1">
          <button
            type="button"
            onClick={undo}
            disabled={
              locked ||
              historyLength === 0
            }
            className="mobile-action"
            title="Undo"
          >
            <Undo2 className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={redo}
            disabled={
              locked ||
              redoLength === 0
            }
            className="mobile-action"
            title="Redo"
          >
            <Redo2 className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() =>
              updateFlag(
                'is_favorite',
              )
            }
            className={`mobile-action ${
              note.is_favorite
                ? 'text-[#E5798F]'
                : ''
            }`}
            title="Favorite"
          >
            <span className="text-lg">
              ♥
            </span>
          </button>

          <button
            type="button"
            onClick={
              copyNote
            }
            className="mobile-action"
            title="Copy"
          >
            <FileText className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() =>
              void shareNote()
            }
            className="mobile-action"
            title="Share"
          >
            <Share2 className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() =>
              void deleteNote()
            }
            disabled={deleting}
            className="mobile-action text-red-500"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <style jsx global>{`
        .toolbar-button {
          display: inline-flex;
          height: 36px;
          width: 36px;
          flex-shrink: 0;
          align-items: center;
          justify-content: center;
          border-radius: 9px;
          color: #475569;
          transition:
            background-color 150ms ease,
            color 150ms ease,
            opacity 150ms ease;
        }

        .toolbar-button:hover:not(:disabled) {
          background: #f1f5f9;
          color: #0f172a;
        }

        .toolbar-button:disabled {
          cursor: not-allowed;
          opacity: 0.35;
        }

        .toolbar-divider {
          width: 1px;
          height: 24px;
          flex-shrink: 0;
          margin: 0 3px;
          background: #e2e8f0;
        }

        .side-action {
          display: flex;
          width: 100%;
          align-items: center;
          gap: 8px;
          border-radius: 12px;
          padding: 10px 12px;
          text-align: left;
          font-size: 14px;
          font-weight: 500;
          color: #475569;
          transition:
            background-color 150ms ease,
            color 150ms ease;
        }

        .side-action:hover {
          background: #f8fafc;
          color: #0f172a;
        }

        .mobile-action {
          display: inline-flex;
          height: 40px;
          width: 40px;
          align-items: center;
          justify-content: center;
          border-radius: 11px;
          color: #64748b;
          transition:
            background-color 150ms ease,
            color 150ms ease,
            opacity 150ms ease;
        }

        .mobile-action:active {
          background: #f1f5f9;
        }

        .mobile-action:disabled {
          cursor: not-allowed;
          opacity: 0.3;
        }

        .note-editor {
          color: #1e293b;
          font-size: 16px;
          line-height: 1.8;
          word-break: break-word;
        }

        .note-editor:focus {
          outline: none;
        }

        .note-editor:empty::before {
          content: attr(data-placeholder);
          color: #cbd5e1;
          pointer-events: none;
        }

        .note-editor p {
          min-height: 1.8em;
          margin: 0 0 0.85em;
        }

        .note-editor h1,
        .note-editor h2,
        .note-editor h3,
        .note-editor h4 {
          color: #0f172a;
          font-weight: 750;
          line-height: 1.25;
        }

        .note-editor h1 {
          margin: 0.8em 0 0.5em;
          font-size: 2rem;
        }

        .note-editor h2 {
          margin: 0.8em 0 0.5em;
          font-size: 1.6rem;
        }

        .note-editor h3 {
          margin: 0.7em 0 0.45em;
          font-size: 1.3rem;
        }

        .note-editor h4 {
          margin: 0.6em 0 0.4em;
          font-size: 1.1rem;
        }

        .note-editor ul,
        .note-editor ol {
          margin: 0.75em 0;
          padding-left: 1.8rem;
        }

        .note-editor li {
          margin: 0.3em 0;
        }

        .note-editor blockquote {
          margin: 1rem 0;
          border-left: 4px solid #e5798f;
          border-radius: 0 10px 10px 0;
          background: #fff7f8;
          padding: 0.8rem 1rem;
          color: #64748b;
          font-style: italic;
        }

        .note-editor pre {
          overflow-x: auto;
          margin: 1rem 0;
          border-radius: 12px;
          background: #0f172a;
          padding: 1rem;
          color: #f8fafc;
          font-family:
            ui-monospace,
            SFMono-Regular,
            Menlo,
            Monaco,
            Consolas,
            monospace;
          font-size: 0.875rem;
          line-height: 1.65;
        }

        .note-editor code {
          border-radius: 5px;
          background: #f1f5f9;
          padding: 0.15em 0.35em;
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
          color: #2563eb;
          text-decoration: underline;
          text-underline-offset: 3px;
        }

        .note-editor hr {
          margin: 1.5rem 0;
          border: 0;
          border-top: 1px solid #e2e8f0;
        }

        .note-editor img {
          max-width: 100%;
          height: auto;
          border-radius: 12px;
        }

        .note-editor .enotes-checklist-item {
          margin: 0.45rem 0;
        }

        .note-editor
          .enotes-checklist-item
          label {
          display: flex;
          align-items: flex-start;
          gap: 9px;
          cursor: pointer;
        }

        .note-editor
          .enotes-checklist-item
          input[type='checkbox'] {
          width: 17px;
          height: 17px;
          margin-top: 5px;
          flex-shrink: 0;
          accent-color: #e5798f;
        }

        .note-editor
          .enotes-checklist-item
          span {
          min-width: 0;
        }

        @media (max-width: 640px) {
          .note-editor {
            font-size: 15px;
            line-height: 1.75;
          }

          .note-editor h1 {
            font-size: 1.7rem;
          }

          .note-editor h2 {
            font-size: 1.4rem;
          }

          .note-editor h3 {
            font-size: 1.2rem;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .toolbar-button,
          .side-action,
          .mobile-action {
            transition: none;
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
        <main className="min-h-screen bg-[#FFF7F8]">
          <div className="flex min-h-screen items-center justify-center">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#E5798F]/20 border-t-[#E5798F]" />
          </div>
        </main>
      }
    >
      <NoteEditor />
    </Suspense>
  );
}
