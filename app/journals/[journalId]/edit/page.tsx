'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bold,
  CheckCircle2,
  Copy,
  Eye,
  FileAudio,
  Home,
  Italic,
  Link2,
  Lock,
  Maximize2,
  MousePointer2,
  PenLine,
  Plus,
  RotateCcw,
  RotateCw,
  Save,
  Smile,
  Sparkles,
  StickyNote,
  Trash2,
  Type,
  Underline,
  Unlock,
  Undo2,
  Redo2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

import { supabase } from '@/lib/supabase/client';

import {
  BASE_HEIGHT,
  BASE_WIDTH,
  emptyDocument,
  makeId,
  normalizeElement,
  normalizePage,
  safeJson,
  type CanvasElement,
  type JournalDocument,
  type JournalElementType,
  type JournalPageData,
} from '@/lib/editor/journalDocument';

import { useHistory, useHistoryShortcuts } from '@/lib/editor/history';
import { uploadFile } from '@/lib/storage/upload';

import StickerPicker from '@/components/pickers/StickerPicker';
import EmojiPicker from '@/components/pickers/EmojiPicker';
import GifPicker, { type GifItem } from '@/components/pickers/GifPicker';
import IconPicker, { IconGlyph } from '@/components/pickers/IconPicker';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 1.25;
const MOBILE_BP = 1024;

const GRID_SIZE = 10;
const SNAP_DISTANCE = 8;
const MIN_ELEMENT_SIZE = 40;

const FONT_OPTIONS = [
  'Georgia',
  'Times New Roman',
  'Garamond',
  'Arial',
  'Inter',
  'Courier New',
  'Comic Sans MS',
];

const PAPER_COLORS = [
  '#FFFDF8',
  '#FFF7F8',
  '#FFF9E8',
  '#F8F3EA',
  '#F5F0E8',
  '#FDF5F0',
  '#F7F2FF',
  '#EEF7F2',
];

type MobileTab = 'canvas' | 'tools' | 'page';

type ToolPanel =
  | 'none'
  | 'stickers'
  | 'emoji'
  | 'gif'
  | 'icons';

type GestureMode =
  | 'none'
  | 'drag'
  | 'resize'
  | 'canvas-pan'
  | 'element-transform';

interface Point {
  x: number;
  y: number;
}

interface GestureSnapshot {
  element: CanvasElement;
  startPoint: Point;
  startCenter: Point;
  startDistance: number;
  startAngle: number;
  startWidth: number;
  startHeight: number;
  startRotation: number;
}

interface TouchPoint {
  x: number;
  y: number;
}

interface GuideState {
  vertical: number | null;
  horizontal: number | null;
}

function clamp(
  value: number,
  min: number,
  max: number,
) {
  return Math.max(min, Math.min(max, value));
}

function distance(a: Point, b: Point) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function angle(a: Point, b: Point) {
  return Math.atan2(b.y - a.y, b.x - a.x) * (180 / Math.PI);
}

function midpoint(a: Point, b: Point): Point {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function snapValue(
  value: number,
  enabled = true,
) {
  if (!enabled) return value;

  const snapped =
    Math.round(value / GRID_SIZE) * GRID_SIZE;

  return Math.abs(snapped - value) <= SNAP_DISTANCE
    ? snapped
    : value;
}

function normalizeRotation(value: number) {
  let result = value % 360;

  if (result > 180) result -= 360;
  if (result < -180) result += 360;

  return result;
}

function ShapeView({
  element,
}: {
  element: CanvasElement;
}) {
  const shape = element.shape || 'rectangle';
  const fill = element.fill || '#F6D5DF';
  const stroke = element.stroke || '#8B5260';
  const sw = element.stroke_width || 4;

  if (
    shape === 'circle' ||
    shape === 'ellipse'
  ) {
    return (
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-full w-full"
      >
        <ellipse
          cx="50"
          cy="50"
          rx="46"
          ry="46"
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }

  if (shape === 'triangle') {
    return (
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-full w-full"
      >
        <polygon
          points="50,5 95,92 5,92"
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }

  if (shape === 'diamond') {
    return (
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-full w-full"
      >
        <polygon
          points="50,4 96,50 50,96 4,50"
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }

  if (shape === 'star') {
    return (
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-full w-full"
      >
        <polygon
          points="50,4 61,36 95,36 68,56 78,91 50,70 22,91 32,56 5,36 39,36"
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }

  if (shape === 'heart') {
    return (
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-full w-full"
      >
        <path
          d="M50 88 C42 78 10 61 10 35 C10 16 31 7 50 25 C69 7 90 16 90 35 C90 61 58 78 50 88Z"
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }

  if (shape === 'line') {
    return (
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-full w-full"
      >
        <line
          x1="8"
          y1="50"
          x2="92"
          y2="50"
          stroke={stroke}
          strokeWidth={sw}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }

  if (shape === 'speech') {
    return (
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-full w-full"
      >
        <path
          d="M12 15 Q12 8 20 8 H80 Q88 8 88 16 V64 Q88 72 80 72 H45 L28 91 V72 H20 Q12 72 12 64Z"
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }

  if (shape === 'cloud') {
    return (
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-full w-full"
      >
        <path
          d="M20 70 C6 65 9 45 25 42 C25 24 45 16 58 30 C73 20 94 31 88 48 C101 55 95 74 80 74 H22Z"
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }

  if (shape === 'hexagon') {
    return (
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-full w-full"
      >
        <polygon
          points="25,7 75,7 95,50 75,93 25,93 5,50"
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }

  return (
    <div
      className="h-full w-full"
      style={{
        background: fill,
        border: `${sw}px solid ${stroke}`,
        borderRadius: element.border_radius ?? 12,
      }}
    />
  );
}

function DrawingEditor({
  element,
  onChange,
}: {
  element: CanvasElement;
  onChange: (content: string) => void;
}) {
  const canvasRef =
    useRef<HTMLCanvasElement>(null);

  const drawing = useMemo(() => {
    const data = safeJson(
      element.content,
      {
        paths: [],
        color: '#2b2520',
        strokeWidth: 5,
      },
    );

    return {
      paths: Array.isArray(data.paths)
        ? data.paths
        : [],
      color: data.color || '#2b2520',
      strokeWidth: Number(
        data.strokeWidth || 5,
      ),
    };
  }, [element.content]);

  const activePath =
    useRef<Point[] | null>(null);

  const redraw = useCallback(
    (paths: Point[][]) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const ratio =
        window.devicePixelRatio || 1;

      const rect =
        canvas.getBoundingClientRect();

      canvas.width = Math.max(
        1,
        Math.round(rect.width * ratio),
      );

      canvas.height = Math.max(
        1,
        Math.round(rect.height * ratio),
      );

      ctx.setTransform(
        (ratio * rect.width) / 1000,
        0,
        0,
        (ratio * rect.height) / 1000,
        0,
        0,
      );

      ctx.clearRect(0, 0, 1000, 1000);

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = drawing.color;
      ctx.lineWidth = drawing.strokeWidth;

      paths.forEach((path) => {
        if (!path.length) return;

        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);

        path
          .slice(1)
          .forEach((point) =>
            ctx.lineTo(point.x, point.y),
          );

        ctx.stroke();
      });
    },
    [
      drawing.color,
      drawing.strokeWidth,
    ],
  );

  useEffect(() => {
    redraw(drawing.paths);
  }, [drawing.paths, redraw]);

  const getPoint = (
    clientX: number,
    clientY: number,
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return {
        x: 0,
        y: 0,
      };
    }

    const rect =
      canvas.getBoundingClientRect();

    return {
      x:
        ((clientX - rect.left) /
          Math.max(rect.width, 1)) *
        1000,
      y:
        ((clientY - rect.top) /
          Math.max(rect.height, 1)) *
        1000,
    };
  };

  const handlePointerDown = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    event.stopPropagation();

    event.currentTarget.setPointerCapture(
      event.pointerId,
    );

    activePath.current = [
      getPoint(
        event.clientX,
        event.clientY,
      ),
    ];
  };

  const handlePointerMove = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    event.stopPropagation();

    if (!activePath.current) return;

    activePath.current.push(
      getPoint(
        event.clientX,
        event.clientY,
      ),
    );

    redraw([
      ...drawing.paths,
      activePath.current,
    ]);
  };

  const handlePointerUp = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    event.stopPropagation();

    if (!activePath.current) return;

    const paths = [
      ...drawing.paths,
      activePath.current,
    ];

    activePath.current = null;

    onChange(
      JSON.stringify({
        ...drawing,
        paths,
      }),
    );
  };

  return (
    <canvas
      ref={canvasRef}
      className="h-full w-full touch-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    />
  );
}

export default function JournalCanvasStudio() {
  const params = useParams();

  const journalId =
    params?.journalId as string;

  const [initialDoc, setInitialDoc] =
    useState<JournalDocument | null>(null);

  const history =
    useHistory<JournalDocument>(
      emptyDocument(),
    );

  const doc =
    initialDoc
      ? history.state
      : emptyDocument();

  const {
    setState,
    undo,
    redo,
    canUndo,
    canRedo,
    undoLabel,
    redoLabel,
    reset,
    markClean,
    dirty,
  } = history;

  useHistoryShortcuts({
    undo,
    redo,
    canUndo,
    canRedo,
  });

  const [
    selectedElementId,
    setSelectedElementId,
  ] = useState<string | null>(null);

  const [
    selectedElementIds,
    setSelectedElementIds,
  ] = useState<string[]>([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    lastSavedAt,
    setLastSavedAt,
  ] = useState<Date | null>(null);

  const [
    uploadingFile,
    setUploadingFile,
  ] = useState(false);

  const [
    zoom,
    setZoom,
  ] = useState(0.6);

  const [
    autoFit,
    setAutoFit,
  ] = useState(true);

  const [
    tool,
    setTool,
  ] = useState<'select' | 'draw'>(
    'select',
  );

  const [
    drawColor,
    setDrawColor,
  ] = useState('#2b2520');

  const [
    drawWidth,
    setDrawWidth,
  ] = useState(5);

  const [
    showPreview,
    setShowPreview,
  ] = useState(false);

  const [
    previewIndex,
    setPreviewIndex,
  ] = useState(0);

  const [
    toolPanel,
    setToolPanel,
  ] = useState<ToolPanel>('none');

  const [
    deletedPageIds,
    setDeletedPageIds,
  ] = useState<string[]>([]);

  const [
    activePageId,
    setActivePageId,
  ] = useState<string | null>(null);

  const [
    vw,
    setVw,
  ] = useState(1024);

  const [
    vh,
    setVh,
  ] = useState(800);

  const [
    isMobile,
    setIsMobile,
  ] = useState(false);

  const [
    mobileTab,
    setMobileTab,
  ] = useState<MobileTab>('canvas');

  const [
    snapEnabled,
    setSnapEnabled,
  ] = useState(true);

  const [
    guideState,
    setGuideState,
  ] = useState<GuideState>({
    vertical: null,
    horizontal: null,
  });

  const [
    toast,
    setToast,
  ] = useState<{
    message: string;
    tone: 'success' | 'error';
  } | null>(null);

  const [
    showGestureHelp,
    setShowGestureHelp,
  ] = useState(false);

  const [
    confirmDeleteId,
    setConfirmDeleteId,
  ] = useState<string | null>(null);

  const [
    gestureMode,
    setGestureMode,
  ] = useState<GestureMode>('none');

  const canvasRef =
    useRef<HTMLDivElement>(null);

  const stageRef =
    useRef<HTMLDivElement>(null);

  const toastTimer =
    useRef<ReturnType<
      typeof setTimeout
    > | null>(null);

  const autosaveTimer =
    useRef<ReturnType<
      typeof setTimeout
    > | null>(null);

  const gestureRef =
    useRef<{
      mode: GestureMode;
      pointerId: number | null;
      elementId: string | null;
      startX: number;
      startY: number;
      startXElement: number;
      startYElement: number;
      startWidth: number;
      startHeight: number;
      startRotation: number;
      aspectRatio: number;
      resizeCorner:
        | 'nw'
        | 'ne'
        | 'sw'
        | 'se';
      shiftKey: boolean;
    }>({
      mode: 'none',
      pointerId: null,
      elementId: null,
      startX: 0,
      startY: 0,
      startXElement: 0,
      startYElement: 0,
      startWidth: 0,
      startHeight: 0,
      startRotation: 0,
      aspectRatio: 1,
      resizeCorner: 'se',
      shiftKey: false,
    });

  const touchPoints =
    useRef<Map<number, TouchPoint>>(
      new Map(),
    );

  const pinchRef =
    useRef<{
      elementId: string | null;
      startDistance: number;
      startAngle: number;
      startWidth: number;
      startHeight: number;
      startRotation: number;
      startCenter: Point;
      startZoom: number;
    } | null>(null);

  const canvasPanRef =
    useRef<{
      startMidpoint: Point;
      startZoom: number;
    } | null>(null);

  const longPressTimer =
    useRef<ReturnType<
      typeof setTimeout
    > | null>(null);

  const longPressStart =
    useRef<Point | null>(null);

  const showToast = useCallback(
    (
      message: string,
      tone:
        | 'success'
        | 'error' = 'success',
    ) => {
      if (toastTimer.current) {
        clearTimeout(
          toastTimer.current,
        );
      }

      setToast({
        message,
        tone,
      });

      toastTimer.current =
        setTimeout(
          () => setToast(null),
          3200,
        );
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (toastTimer.current) {
        clearTimeout(
          toastTimer.current,
        );
      }

      if (autosaveTimer.current) {
        clearTimeout(
          autosaveTimer.current,
        );
      }

      if (longPressTimer.current) {
        clearTimeout(
          longPressTimer.current,
        );
      }
    };
  }, []);

  useEffect(() => {
    const updateViewport = () => {
      setVw(window.innerWidth);
      setVh(window.innerHeight);
      setIsMobile(
        window.innerWidth < MOBILE_BP,
      );
    };

    updateViewport();

    window.addEventListener(
      'resize',
      updateViewport,
    );

    window.addEventListener(
      'orientationchange',
      updateViewport,
    );

    return () => {
      window.removeEventListener(
        'resize',
        updateViewport,
      );

      window.removeEventListener(
        'orientationchange',
        updateViewport,
      );
    };
  }, []);

  /*
   * Load journal.
   */
  useEffect(() => {
    if (!journalId) return;

    let cancelled = false;

    (async () => {
      setLoading(true);

      const [
        journalResult,
        pagesResult,
      ] = await Promise.all([
        supabase
          .from('journals')
          .select('*')
          .eq('id', journalId)
          .single(),

        supabase
          .from('journal_pages')
          .select('*')
          .eq(
            'journal_id',
            journalId,
          )
          .order(
            'page_number',
            {
              ascending: true,
            },
          ),
      ]);

      if (cancelled) return;

      if (journalResult.error) {
        console.error(
          journalResult.error,
        );
      }

      if (pagesResult.error) {
        console.error(
          pagesResult.error,
        );
      }

      const journal =
        journalResult.data;

      const fetchedPages =
        pagesResult.data;

      const nextDoc: JournalDocument =
        journal
          ? {
              title:
                journal.title || '',

              description:
                journal.description ||
                journal.foreword ||
                '',

              coverBackground:
                journal.background_color ||
                '#FFF7F8',

              coverMediaType:
                journal.cover_media_type ||
                journal.cover_type ||
                'image',

              coverMediaUrl:
                journal.cover_media_url ||
                journal.cover_url ||
                '',

              coverElements:
                Array.isArray(
                  journal.cover_elements,
                ) &&
                journal.cover_elements
                  .length
                  ? journal.cover_elements.map(
                      (
                        element: any,
                        index: number,
                      ) =>
                        normalizeElement(
                          element,
                          index,
                        ),
                    )
                  : journal.title
                    ? [
                        {
                          id: 'cover-title',
                          type: 'text',
                          content:
                            journal.title,
                          position_x: 180,
                          position_y: 150,
                          width: 440,
                          height: 100,
                          z_index: 2,
                          font_size: 48,
                          font_family:
                            'Georgia',
                          color:
                            '#6b332b',
                          background:
                            'transparent',
                          bold: true,
                          text_align:
                            'center',
                        } as CanvasElement,
                      ]
                    : [],

              pages:
                (
                  fetchedPages || []
                ).map(normalizePage),
            }
          : emptyDocument();

      setInitialDoc(
        nextDoc,
      );

      reset(
        nextDoc,
        'Loaded from database',
      );

      if (
        nextDoc.pages.length
      ) {
        setActivePageId(
          nextDoc.pages[0].id,
        );
      }

      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journalId]);

  const activeIsCover =
    activePageId === null;

  const activePage =
    doc.pages.find(
      (page) =>
        page.id ===
        activePageId,
    ) || null;

  const activeElements: CanvasElement[] =
    activeIsCover
      ? doc.coverElements
      : activePage?.elements || [];

  const selectedElement =
    activeElements.find(
      (element) =>
        element.id ===
        selectedElementId,
    ) || null;

  const selectedElements =
    activeElements.filter(
      (element) =>
        selectedElementIds.includes(
          element.id,
        ),
    );

  useEffect(() => {
    setSelectedElementId(null);
    setSelectedElementIds([]);
    setGuideState({
      vertical: null,
      horizontal: null,
    });
  }, [activePageId]);

  /*
   * Auto-fit.
   */
  useEffect(() => {
    if (!autoFit) return;

    const availableWidth =
      Math.max(
        200,
        vw -
          (isMobile
            ? 44
            : 90),
      );

    const availableHeight =
      Math.max(
        240,
        vh -
          (isMobile
            ? 250
            : 230),
      );

    const fit = Math.min(
      availableWidth /
        BASE_WIDTH,
      availableHeight /
        BASE_HEIGHT,
    );

    const nextZoom = clamp(
      fit,
      MIN_ZOOM,
      MAX_ZOOM,
    );

    setZoom((current) =>
      Math.abs(
        current -
          nextZoom,
      ) < 0.01
        ? current
        : nextZoom,
    );
  }, [
    autoFit,
    vw,
    vh,
    isMobile,
  ]);

  const mutateActiveElements =
    useCallback(
      (
        updater: (
          elements: CanvasElement[],
        ) => CanvasElement[],
        label: string,
        coalesceKey?: string,
      ) => {
        setState(
          (current) => {
            if (activeIsCover) {
              return {
                ...current,
                coverElements:
                  updater(
                    current.coverElements,
                  ),
              };
            }

            return {
              ...current,
              pages:
                current.pages.map(
                  (page) =>
                    page.id ===
                    activePageId
                      ? {
                          ...page,
                          elements:
                            updater(
                              page.elements,
                            ),
                        }
                      : page,
                ),
            };
          },
          label,
          coalesceKey,
        );
      },
      [
        activeIsCover,
        activePageId,
        setState,
      ],
    );

  const updateSelected =
    useCallback(
      (
        changes: Partial<CanvasElement>,
        label = 'Edit element',
        coalesceKey?: string,
      ) => {
        if (
          !selectedElementId
        ) {
          return;
        }

        mutateActiveElements(
          (elements) =>
            elements.map(
              (element) =>
                element.id ===
                selectedElementId
                  ? {
                      ...element,
                      ...changes,
                    }
                  : element,
            ),
          label,
          coalesceKey,
        );
      },
      [
        selectedElementId,
        mutateActiveElements,
      ],
    );

  const selectElement = useCallback(
    (
      id: string,
      additive = false,
    ) => {
      setSelectedElementId(id);

      setSelectedElementIds(
        (current) => {
          if (!additive) {
            return [id];
          }

          return current.includes(id)
            ? current.filter(
                (item) =>
                  item !== id,
              )
            : [...current, id];
        },
      );
    },
    [],
  );

  const deselectAll =
    useCallback(() => {
      setSelectedElementId(
        null,
      );

      setSelectedElementIds(
        [],
      );

      setGuideState({
        vertical: null,
        horizontal: null,
      });
    }, []);

  const deleteSelected =
    useCallback(() => {
      if (
        !selectedElementId
      ) {
        return;
      }

      mutateActiveElements(
        (elements) =>
          elements.filter(
            (element) =>
              !selectedElementIds.includes(
                element.id,
              ) &&
              element.id !==
                selectedElementId,
          ),
        'Delete element',
      );

      deselectAll();
    }, [
      selectedElementId,
      selectedElementIds,
      mutateActiveElements,
      deselectAll,
    ]);

  const duplicateSelected =
    useCallback(() => {
      if (!selectedElement) {
        return;
      }

      const selectedIds =
        selectedElementIds.length
          ? selectedElementIds
          : [selectedElement.id];

      const source =
        activeElements.filter(
          (element) =>
            selectedIds.includes(
              element.id,
            ),
        );

      const copies =
        source.map(
          (element, index) => ({
            ...element,
            id: makeId('copy'),
            position_x: clamp(
              element.position_x +
                24 +
                index * 8,
              0,
              BASE_WIDTH -
                element.width,
            ),
            position_y: clamp(
              element.position_y +
                24 +
                index * 8,
              0,
              BASE_HEIGHT -
                element.height,
            ),
            z_index:
              activeElements.length +
              index +
              1,
          }),
        );

      mutateActiveElements(
        (elements) => [
          ...elements,
          ...copies,
        ],
        'Duplicate element',
      );

      setSelectedElementId(
        copies[0]?.id ||
          null,
      );

      setSelectedElementIds(
        copies.map(
          (element) =>
            element.id,
        ),
      );
    }, [
      selectedElement,
      selectedElementIds,
      activeElements,
      mutateActiveElements,
    ]);

  const addElement = (
    type: JournalElementType,
    extra: Partial<CanvasElement> = {},
    label = `Add ${type}`,
  ) => {
    const count =
      activeElements.length;

    const element: CanvasElement =
      {
        id: makeId(type),
        type,

        content:
          extra.content ||
          (type === 'text'
            ? 'Write your memory here…'
            : ''),

        position_x: Math.min(
          50 +
            (count % 4) * 35,
          520,
        ),

        position_y: Math.min(
          60 +
            Math.floor(
              count / 4,
            ) *
              45,
          820,
        ),

        width:
          type === 'sticker'
            ? 90
            : type === 'drawing'
              ? 330
              : type === 'link'
                ? 360
                : type === 'gif'
                  ? 260
                  : 330,

        height:
          type === 'sticker'
            ? 90
            : type === 'drawing'
              ? 230
              : type === 'link'
                ? 82
                : type === 'gif'
                  ? 200
                  : 180,

        z_index:
          count + 1,

        font_size: 26,
        font_family: 'Georgia',
        color: '#2b2520',

        background:
          type === 'text'
            ? 'rgba(255,255,255,0.68)'
            : 'transparent',

        text_align: 'left',
        border_radius: 12,

        ...(type === 'drawing'
          ? {
              content:
                JSON.stringify({
                  paths: [],
                  color:
                    drawColor,
                  strokeWidth:
                    drawWidth,
                }),
            }
          : {}),

        ...(type === 'link'
          ? {
              href: 'https://',
              content:
                'Open this link',
            }
          : {}),

        ...extra,
      };

    mutateActiveElements(
      (elements) => [
        ...elements,
        element,
      ],
      label,
    );

    setSelectedElementId(
      element.id,
    );

    setSelectedElementIds([
      element.id,
    ]);

    setTool('select');

    if (isMobile) {
      setMobileTab(
        'canvas',
      );
    }
  };

  const addSticker = (
    value: string,
  ) =>
    addElement(
      'sticker',
      {
        content: value,
      },
      'Add sticker',
    );

  const addEmoji = (
    value: string,
  ) =>
    addElement(
      'sticker',
      {
        content: value,
      },
      'Add emoji',
    );

  const addIcon = (
    iconId: string,
  ) =>
    addElement(
      'icon',
      {
        content: iconId,
      },
      'Add icon',
    );

  const addGif = (
    gif: GifItem,
  ) =>
    addElement(
      'media',
      {
        content:
          gif.description ||
          'GIF',
        media_url: gif.url,
        media_type:
          'image/gif',
        width: 260,
        height:
          Math.round(
            (260 * gif.height) /
              Math.max(
                gif.width,
                1,
              ),
          ) || 200,
      },
      'Add GIF',
    );

  const addShape = (
    shape: string,
  ) => {
    const count =
      activeElements.length;

    const element: CanvasElement =
      {
        id: makeId('shape'),
        type: 'shape',

        content:
          JSON.stringify({
            shape,
            fill: '#F6D5DF',
            stroke: '#8B5260',
            stroke_width: 4,
          }),

        position_x: Math.min(
          70 +
            (count % 3) *
              45,
          560,
        ),

        position_y: Math.min(
          80 +
            Math.floor(
              count / 3,
            ) *
              50,
          820,
        ),

        width:
          shape === 'line'
            ? 360
            : 190,

        height:
          shape === 'line'
            ? 60
            : 150,

        z_index:
          count + 1,

        fill: '#F6D5DF',
        stroke: '#8B5260',
        stroke_width: 4,
        border_radius: 12,
      };

    mutateActiveElements(
      (elements) => [
        ...elements,
        element,
      ],
      'Add shape',
    );

    setSelectedElementId(
      element.id,
    );

    setSelectedElementIds([
      element.id,
    ]);
  };

  /*
   * Page operations.
   */
  const addPage = () => {
    const number =
      doc.pages.length + 1;

    const page: JournalPageData =
      {
        id: makeId(
          'temp-page',
        ),

        page_number: number,

        title:
          `Page ${number}`,

        background:
          '#FFFDF8',

        width: BASE_WIDTH,
        height: BASE_HEIGHT,

        elements: [],

        created_at:
          new Date().toISOString(),
      };

    setState(
      (current) => ({
        ...current,
        pages: [
          ...current.pages,
          page,
        ],
      }),
      'Add page',
    );

    setActivePageId(
      page.id,
    );

    deselectAll();
  };

  const deletePage = () => {
    if (
      activeIsCover ||
      !activePage
    ) {
      return;
    }

    if (
      !activePage.id.startsWith(
        'temp-page-',
      )
    ) {
      setDeletedPageIds(
        (ids) => [
          ...ids,
          activePage.id,
        ],
      );
    }

    setState(
      (current) => ({
        ...current,
        pages:
          current.pages
            .filter(
              (page) =>
                page.id !==
                activePage.id,
            )
            .map(
              (
                page,
                index,
              ) => ({
                ...page,
                page_number:
                  index + 1,
              }),
            ),
      }),
      'Delete page',
    );

    setActivePageId(null);
    deselectAll();
  };

  const duplicatePage = () => {
    if (
      activeIsCover ||
      !activePage
    ) {
      return;
    }

    const page: JournalPageData =
      {
        ...activePage,

        id: makeId(
          'temp-page',
        ),

        page_number:
          doc.pages.length +
          1,

        title:
          `${activePage.title} copy`,

        elements:
          activePage.elements.map(
            (element) => ({
              ...element,
              id: makeId(
                'copy',
              ),
            }),
          ),
      };

    setState(
      (current) => ({
        ...current,
        pages: [
          ...current.pages,
          page,
        ],
      }),
      'Duplicate page',
    );

    setActivePageId(
      page.id,
    );

    deselectAll();
  };

  const movePage = (
    direction: -1 | 1,
  ) => {
    if (
      activeIsCover ||
      !activePage
    ) {
      return;
    }

    setState(
      (current) => {
        const index =
          current.pages.findIndex(
            (page) =>
              page.id ===
              activePage.id,
          );

        const target =
          index + direction;

        if (
          index < 0 ||
          target < 0 ||
          target >=
            current.pages.length
        ) {
          return current;
        }

        const pages = [
          ...current.pages,
        ];

        [
          pages[index],
          pages[target],
        ] = [
          pages[target],
          pages[index],
        ];

        return {
          ...current,
          pages:
            pages.map(
              (
                page,
                pageIndex,
              ) => ({
                ...page,
                page_number:
                  pageIndex + 1,
              }),
            ),
        };
      },
      'Reorder pages',
    );
  };

  /*
   * Cover media.
   */
  const setCoverMedia = (
    kind: string,
    url: string,
  ) => {
    setState(
      (current) => ({
        ...current,
        coverMediaType:
          kind,
        coverMediaUrl:
          url,
      }),
      'Cover media',
    );
  };

  /*
   * Layer operations.
   */
  const bringForward = () => {
    if (!selectedElement) return;

    const highest =
      Math.max(
        ...activeElements.map(
          (element) =>
            element.z_index,
        ),
        0,
      );

    updateSelected(
      {
        z_index:
          highest + 1,
      },
      'Bring forward',
    );
  };

  const sendBackward = () => {
    if (!selectedElement) return;

    updateSelected(
      {
        z_index: Math.max(
          1,
          selectedElement.z_index -
            1,
        ),
      },
      'Send backward',
    );
  };

  const rotate = (
    delta: number,
  ) => {
    if (!selectedElement) return;

    updateSelected(
      {
        rotation:
          normalizeRotation(
            (selectedElement.rotation ||
              0) +
              delta,
          ),
      },
      'Rotate',
      `rotate-${selectedElement.id}`,
    );
  };

  /*
   * Upload media.
   */
  const handleFileUpload =
    async (
      event: React.ChangeEvent<HTMLInputElement>,
    ) => {
      const file =
        event.target.files?.[0];

      event.target.value = '';

      if (
        !file ||
        !journalId
      ) {
        return;
      }

      setUploadingFile(true);

      try {
        const {
          data: {
            user,
          },
        } =
          await supabase.auth.getUser();

        if (!user) {
          throw new Error(
            'Not signed in.',
          );
        }

        const upload =
          await uploadFile(
            file,
            'journal-media',
            user.id,
          );

        const mediaType =
          file.type.startsWith(
            'video/',
          )
            ? 'video'
            : file.type.startsWith(
                  'audio/',
                )
              ? 'audio'
              : 'image';

        addElement(
          'media',
          {
            content:
              file.name,
            media_url:
              upload.url,
            media_type:
              mediaType,
            object_fit:
              'cover',
          },
          'Add media',
        );

        showToast(
          'Media added to the page',
        );
      } catch (error: any) {
        showToast(
          `Upload failed: ${
            error?.message ||
            error
          }`,
          'error',
        );
      } finally {
        setUploadingFile(
          false,
        );
      }
    };

  /*
   * Alignment snapping.
   */
  const calculateSnap = (
    element: CanvasElement,
    proposedX: number,
    proposedY: number,
  ) => {
    if (!snapEnabled) {
      return {
        x: proposedX,
        y: proposedY,
        vertical: null,
        horizontal: null,
      };
    }

    let x = proposedX;
    let y = proposedY;

    let vertical:
      | number
      | null = null;

    let horizontal:
      | number
      | null = null;

    const elementCenterX =
      proposedX +
      element.width / 2;

    const elementCenterY =
      proposedY +
      element.height / 2;

    const pageCenterX =
      BASE_WIDTH / 2;

    const pageCenterY =
      BASE_HEIGHT / 2;

    if (
      Math.abs(
        elementCenterX -
          pageCenterX,
      ) <= SNAP_DISTANCE
    ) {
      x =
        pageCenterX -
        element.width / 2;

      vertical =
        pageCenterX;
    }

    if (
      Math.abs(
        elementCenterY -
          pageCenterY,
      ) <= SNAP_DISTANCE
    ) {
      y =
        pageCenterY -
        element.height / 2;

      horizontal =
        pageCenterY;
    }

    const snappedX =
      snapValue(x);

    const snappedY =
      snapValue(y);

    if (
      snappedX !== x &&
      vertical === null
    ) {
      vertical =
        snappedX;
    }

    if (
      snappedY !== y &&
      horizontal === null
    ) {
      horizontal =
        snappedY;
    }

    return {
      x: clamp(
        snappedX,
        0,
        BASE_WIDTH -
          element.width,
      ),
      y: clamp(
        snappedY,
        0,
        BASE_HEIGHT -
          element.height,
      ),
      vertical,
      horizontal,
    };
  };

  /*
   * Start a one-pointer drag.
   */
  const beginElementDrag =
    (
      event: React.PointerEvent,
      element: CanvasElement,
    ) => {
      if (
        tool !== 'select' ||
        element.locked
      ) {
        return;
      }

      event.stopPropagation();

      const additive =
        event.ctrlKey ||
        event.metaKey;

      selectElement(
        element.id,
        additive,
      );

      try {
        event.currentTarget.setPointerCapture(
          event.pointerId,
        );
      } catch {
        // Ignore capture errors.
      }

      const state =
        gestureRef.current;

      state.mode = 'drag';
      state.pointerId =
        event.pointerId;
      state.elementId =
        element.id;

      state.startX =
        event.clientX;

      state.startY =
        event.clientY;

      state.startXElement =
        element.position_x;

      state.startYElement =
        element.position_y;

      state.shiftKey =
        event.shiftKey;

      setGestureMode(
        'drag',
      );
    };

  /*
   * Resize.
   */
  const beginResize =
    (
      event: React.PointerEvent,
      element: CanvasElement,
      corner:
        | 'nw'
        | 'ne'
        | 'sw'
        | 'se',
    ) => {
      if (
        element.locked ||
        tool !== 'select'
      ) {
        return;
      }

      event.stopPropagation();

      selectElement(
        element.id,
      );

      try {
        event.currentTarget.setPointerCapture(
          event.pointerId,
        );
      } catch {
        // Ignore.
      }

      const state =
        gestureRef.current;

      state.mode = 'resize';
      state.pointerId =
        event.pointerId;
      state.elementId =
        element.id;

      state.startX =
        event.clientX;

      state.startY =
        event.clientY;

      state.startXElement =
        element.position_x;

      state.startYElement =
        element.position_y;

      state.startWidth =
        element.width;

      state.startHeight =
        element.height;

      state.startRotation =
        element.rotation ||
        0;

      state.aspectRatio =
        element.width /
        Math.max(
          element.height,
          1,
        );

      state.resizeCorner =
        corner;

      state.shiftKey =
        event.shiftKey;

      setGestureMode(
        'resize',
      );
    };

  /*
   * One-pointer move/resize.
   */
  useEffect(() => {
    const handleMove = (
      event: PointerEvent,
    ) => {
      const state =
        gestureRef.current;

      if (
        state.mode ===
          'none' ||
        !state.elementId
      ) {
        return;
      }

      const element =
        activeElements.find(
          (item) =>
            item.id ===
            state.elementId,
        );

      if (!element) return;

      const dx =
        (event.clientX -
          state.startX) /
        Math.max(
          zoom,
          0.01,
        );

      const dy =
        (event.clientY -
          state.startY) /
        Math.max(
          zoom,
          0.01,
        );

      if (
        state.mode === 'drag'
      ) {
        const rawX =
          state.startXElement +
          dx;

        const rawY =
          state.startYElement +
          dy;

        const snapped =
          calculateSnap(
            element,
            rawX,
            rawY,
          );

        setGuideState({
          vertical:
            snapped.vertical,
          horizontal:
            snapped.horizontal,
        });

        mutateActiveElements(
          (elements) =>
            elements.map(
              (item) =>
                item.id ===
                element.id
                  ? {
                      ...item,
                      position_x:
                        snapped.x,
                      position_y:
                        snapped.y,
                    }
                  : item,
            ),
          'Move element',
          `drag-${element.id}`,
        );

        return;
      }

      if (
        state.mode ===
        'resize'
      ) {
        let width =
          state.startWidth;

        let height =
          state.startHeight;

        let x =
          state.startXElement;

        let y =
          state.startYElement;

        const keepRatio =
          state.shiftKey ||
          event.shiftKey;

        switch (
          state.resizeCorner
        ) {
          case 'se':
            width =
              state.startWidth +
              dx;

            height =
              state.startHeight +
              dy;
            break;

          case 'sw':
            width =
              state.startWidth -
              dx;

            height =
              state.startHeight +
              dy;

            x =
              state.startXElement +
              dx;
            break;

          case 'ne':
            width =
              state.startWidth +
              dx;

            height =
              state.startHeight -
              dy;

            y =
              state.startYElement +
              dy;
            break;

          case 'nw':
            width =
              state.startWidth -
              dx;

            height =
              state.startHeight -
              dy;

            x =
              state.startXElement +
              dx;

            y =
              state.startYElement +
              dy;
            break;
        }

        if (keepRatio) {
          const ratio =
            state.aspectRatio;

          if (
            Math.abs(dx) >
            Math.abs(dy)
          ) {
            height =
              width /
              Math.max(
                ratio,
                0.01,
              );
          } else {
            width =
              height *
              ratio;
          }

          if (
            state.resizeCorner ===
              'nw' ||
            state.resizeCorner ===
              'sw'
          ) {
            x =
              state.startXElement +
              (state.startWidth -
                width);
          }

          if (
            state.resizeCorner ===
              'nw' ||
            state.resizeCorner ===
              'ne'
          ) {
            y =
              state.startYElement +
              (state.startHeight -
                height);
          }
        }

        width =
          Math.max(
            MIN_ELEMENT_SIZE,
            width,
          );

        height =
          Math.max(
            MIN_ELEMENT_SIZE,
            height,
          );

        if (
          x < 0
        ) {
          width += x;
          x = 0;
        }

        if (
          y < 0
        ) {
          height += y;
          y = 0;
        }

        width =
          Math.min(
            width,
            BASE_WIDTH - x,
          );

        height =
          Math.min(
            height,
            BASE_HEIGHT - y,
          );

        mutateActiveElements(
          (elements) =>
            elements.map(
              (item) =>
                item.id ===
                element.id
                  ? {
                      ...item,
                      position_x:
                        x,
                      position_y:
                        y,
                      width,
                      height,
                    }
                  : item,
            ),
          'Resize element',
          `resize-${element.id}`,
        );
      }
    };

    const handleEnd = () => {
      const state =
        gestureRef.current;

      if (
        state.mode ===
        'none'
      ) {
        return;
      }

      gestureRef.current.mode =
        'none';

      gestureRef.current.pointerId =
        null;

      gestureRef.current.elementId =
        null;

      setGestureMode(
        'none',
      );

      setGuideState({
        vertical: null,
        horizontal: null,
      });
    };

    window.addEventListener(
      'pointermove',
      handleMove,
    );

    window.addEventListener(
      'pointerup',
      handleEnd,
    );

    window.addEventListener(
      'pointercancel',
      handleEnd,
    );

    return () => {
      window.removeEventListener(
        'pointermove',
        handleMove,
      );

      window.removeEventListener(
        'pointerup',
        handleEnd,
      );

      window.removeEventListener(
        'pointercancel',
        handleEnd,
      );
    };
  }, [
    activeElements,
    zoom,
    mutateActiveElements,
    snapEnabled,
  ]);

  /*
   * Two-finger element transform.
   *
   * First finger selects the element.
   * Second finger enables:
   *
   * pinch = resize
   * rotation = rotate
   *
   * The element center remains the anchor.
   */
  const beginTwoFingerElementGesture =
    useCallback(
      (
        element: CanvasElement,
        first: TouchPoint,
        second: TouchPoint,
      ) => {
        if (
          element.locked
        ) {
          return;
        }

        const a: Point = first;
        const b: Point = second;

        const startDistance =
          distance(a, b);

        const startAngle =
          angle(a, b);

        const center = {
          x:
            element.position_x +
            element.width /
              2,

          y:
            element.position_y +
            element.height /
              2,
        };

        pinchRef.current = {
          elementId:
            element.id,

          startDistance,

          startAngle,

          startWidth:
            element.width,

          startHeight:
            element.height,

          startRotation:
            element.rotation ||
            0,

          startCenter:
            center,

          startZoom:
            zoom,
        };

        setGestureMode(
          'element-transform',
        );
      },
      [zoom],
    );

  /*
   * Canvas two-finger zoom.
   */
  const beginCanvasPinch =
    useCallback(
      (
        first: TouchPoint,
        second: TouchPoint,
      ) => {
        canvasPanRef.current = {
          startMidpoint:
            midpoint(
              first,
              second,
            ),

          startZoom:
            zoom,
        };

        setGestureMode(
          'canvas-pan',
        );
      },
      [zoom],
    );

  const handleCanvasPointerDown =
    (
      event: React.PointerEvent<HTMLDivElement>,
    ) => {
      if (
        tool !== 'select'
      ) {
        return;
      }

      /*
       * Empty canvas:
       * start a normal canvas touch
       * tracker. Two pointers later
       * become pinch zoom.
       */
      if (
        event.target ===
          event.currentTarget ||
        (
          event.target instanceof
            HTMLElement &&
          event.target.dataset.canvasSurface ===
            'true'
        )
      ) {
        try {
          event.currentTarget.setPointerCapture(
            event.pointerId,
          );
        } catch {
          // Ignore.
        }

        touchPoints.current.set(
          event.pointerId,
          {
            x:
              event.clientX,
            y:
              event.clientY,
          },
        );

        if (
          touchPoints.current
            .size === 1
        ) {
          deselectAll();
        }

        if (
          touchPoints.current
            .size === 2
        ) {
          const points =
            Array.from(
              touchPoints.current.values(),
            );

          beginCanvasPinch(
            points[0],
            points[1],
          );
        }

        return;
      }
    };

  const handleCanvasPointerMove =
    (
      event: React.PointerEvent<HTMLDivElement>,
    ) => {
      if (
        touchPoints.current.has(
          event.pointerId,
        )
      ) {
        touchPoints.current.set(
          event.pointerId,
          {
            x:
              event.clientX,
            y:
              event.clientY,
          },
        );
      }

      if (
        touchPoints.current
          .size < 2 ||
        !canvasPanRef.current
      ) {
        return;
      }

      const points =
        Array.from(
          touchPoints.current.values(),
        );

      const currentDistance =
        distance(
          points[0],
          points[1],
        );

      const initialDistance =
        120;

      /*
       * Smooth pinch scaling.
       * We intentionally use the
       * previous zoom as the base and
       * apply a restrained multiplier.
       */
      const ratio =
        currentDistance /
        Math.max(
          initialDistance,
          1,
        );

      const nextZoom =
        clamp(
          canvasPanRef.current
            .startZoom *
            clamp(
              ratio,
              0.55,
              1.8,
            ),
          MIN_ZOOM,
          MAX_ZOOM,
        );

      setAutoFit(false);
      setZoom(
        nextZoom,
      );
    };

  const handleCanvasPointerUp =
    (
      event: React.PointerEvent<HTMLDivElement>,
    ) => {
      touchPoints.current.delete(
        event.pointerId,
      );

      if (
        touchPoints.current
          .size < 2
      ) {
        canvasPanRef.current =
          null;
      }

      if (
        touchPoints.current
          .size === 0
      ) {
        setGestureMode(
          'none',
        );
      }
    };

  /*
   * Touch handling directly on an element.
   */
  const handleElementPointerDown =
    (
      event: React.PointerEvent<HTMLDivElement>,
      element: CanvasElement,
    ) => {
      if (
        tool !== 'select' ||
        element.locked
      ) {
        return;
      }

      event.stopPropagation();

      const isTouch =
        event.pointerType ===
        'touch';

      if (isTouch) {
        touchPoints.current.set(
          event.pointerId,
          {
            x:
              event.clientX,
            y:
              event.clientY,
          },
        );

        if (
          touchPoints.current
            .size === 2
        ) {
          const points =
            Array.from(
              touchPoints.current.values(),
            );

          beginTwoFingerElementGesture(
            element,
            points[0],
            points[1],
          );

          return;
        }
      }

      const additive =
        event.ctrlKey ||
        event.metaKey;

      selectElement(
        element.id,
        additive,
      );

      if (
        isTouch
      ) {
        longPressStart.current =
          {
            x:
              event.clientX,
            y:
              event.clientY,
          };

        if (
          longPressTimer.current
        ) {
          clearTimeout(
            longPressTimer.current,
          );
        }

        longPressTimer.current =
          setTimeout(() => {
            setSelectedElementId(
              element.id,
            );

            setMobileTab(
              'tools',
            );

            showToast(
              'Element selected — use Tools to edit it.',
            );
          }, 520);
      }

      beginElementDrag(
        event,
        element,
      );
    };

  const handleElementPointerMove =
    (
      event: React.PointerEvent<HTMLDivElement>,
      element: CanvasElement,
    ) => {
      if (
        event.pointerType ===
        'touch'
      ) {
        const point =
          touchPoints.current.get(
            event.pointerId,
          );

        if (point) {
          point.x =
            event.clientX;

          point.y =
            event.clientY;
        }

        if (
          longPressStart.current
        ) {
          const moved =
            Math.hypot(
              event.clientX -
                longPressStart.current
                  .x,
              event.clientY -
                longPressStart.current
                  .y,
            );

          if (
            moved > 12 &&
            longPressTimer.current
          ) {
            clearTimeout(
              longPressTimer.current,
            );

            longPressTimer.current =
              null;
          }
        }

        if (
          touchPoints.current
            .size >= 2
        ) {
          const points =
            Array.from(
              touchPoints.current.values(),
            );

          if (
            !pinchRef.current
          ) {
            beginTwoFingerElementGesture(
              element,
              points[0],
              points[1],
            );
          }

          const transform =
            pinchRef.current;

          if (!transform) {
            return;
          }

          const currentDistance =
            distance(
              points[0],
              points[1],
            );

          const currentAngle =
            angle(
              points[0],
              points[1],
            );

          const scale =
            currentDistance /
            Math.max(
              transform.startDistance,
              1,
            );

          const nextWidth =
            clamp(
              transform.startWidth *
                scale,
              MIN_ELEMENT_SIZE,
              BASE_WIDTH,
            );

          const nextHeight =
            clamp(
              transform.startHeight *
                scale,
              MIN_ELEMENT_SIZE,
              BASE_HEIGHT,
            );

          const rotationDelta =
            currentAngle -
            transform.startAngle;

          const nextRotation =
            normalizeRotation(
              transform.startRotation +
                rotationDelta,
            );

          const nextX =
            clamp(
              transform.startCenter
                .x -
                nextWidth / 2,
              0,
              BASE_WIDTH -
                nextWidth,
            );

          const nextY =
            clamp(
              transform.startCenter
                .y -
                nextHeight / 2,
              0,
              BASE_HEIGHT -
                nextHeight,
            );

          mutateActiveElements(
            (elements) =>
              elements.map(
                (item) =>
                  item.id ===
                  element.id
                    ? {
                        ...item,
                        width:
                          nextWidth,
                        height:
                          nextHeight,
                        position_x:
                          nextX,
                        position_y:
                          nextY,
                        rotation:
                          nextRotation,
                      }
                    : item,
              ),
            'Transform element',
            `transform-${element.id}`,
          );

          return;
        }
      }
    };

  const handleElementPointerUp =
    (
      event: React.PointerEvent<HTMLDivElement>,
    ) => {
      if (
        event.pointerType ===
        'touch'
      ) {
        touchPoints.current.delete(
          event.pointerId,
        );

        if (
          touchPoints.current
            .size === 0
        ) {
          pinchRef.current =
            null;

          longPressStart.current =
            null;

          if (
            longPressTimer.current
          ) {
            clearTimeout(
              longPressTimer.current,
            );

            longPressTimer.current =
              null;
          }

          setGestureMode(
            'none',
          );
        }
      }
    };

  /*
   * Keyboard manipulation.
   */
  useEffect(() => {
    const handleKeyDown = (
      event: KeyboardEvent,
    ) => {
      const target =
        event.target as HTMLElement | null;

      const isEditing =
        target?.tagName ===
          'INPUT' ||
        target?.tagName ===
          'TEXTAREA' ||
        target?.isContentEditable;

      if (isEditing) {
        return;
      }

      if (
        event.key ===
        'Escape'
      ) {
        deselectAll();
        return;
      }

      if (
        (
          event.key ===
            'Delete' ||
          event.key ===
            'Backspace'
        ) &&
        selectedElementId
      ) {
        event.preventDefault();
        deleteSelected();
        return;
      }

      if (
        !selectedElement
      ) {
        return;
      }

      const step =
        event.shiftKey
          ? 10
          : 1;

      let dx = 0;
      let dy = 0;

      switch (
        event.key
      ) {
        case 'ArrowLeft':
          dx = -step;
          break;

        case 'ArrowRight':
          dx = step;
          break;

        case 'ArrowUp':
          dy = -step;
          break;

        case 'ArrowDown':
          dy = step;
          break;

        default:
          return;
      }

      event.preventDefault();

      updateSelected(
        {
          position_x:
            clamp(
              selectedElement.position_x +
                dx,
              0,
              BASE_WIDTH -
                selectedElement.width,
            ),

          position_y:
            clamp(
              selectedElement.position_y +
                dy,
              0,
              BASE_HEIGHT -
                selectedElement.height,
            ),
        },
        'Move element',
        `keyboard-${selectedElement.id}`,
      );
    };

    window.addEventListener(
      'keydown',
      handleKeyDown,
    );

    return () =>
      window.removeEventListener(
        'keydown',
        handleKeyDown,
      );
  }, [
    selectedElement,
    selectedElementId,
    updateSelected,
    deleteSelected,
    deselectAll,
  ]);

  /*
   * Two-finger element gesture cleanup.
   */
  useEffect(() => {
    return () => {
      if (
        longPressTimer.current
      ) {
        clearTimeout(
          longPressTimer.current,
        );
      }
    };
  }, []);

  /*
   * Save.
   */
  const updateDocSilent =
    useCallback(
      (
        tempId: string,
        realId: string,
      ) => {
        setState(
          (current) => ({
            ...current,

            pages:
              current.pages.map(
                (page) =>
                  page.id ===
                  tempId
                    ? {
                        ...page,
                        id: realId,
                      }
                    : page,
              ),
          }),
          'Sync page id',
          `sync-${tempId}`,
        );

        setActivePageId(
          (current) =>
            current === tempId
              ? realId
              : current,
        );
      },
      [setState],
    );

  const saveAll = useCallback(
    async (
      silent = false,
    ) => {
      if (!journalId) return;

      if (!silent) {
        setSaving(true);
      }

      try {
        const {
          error:
            journalError,
        } =
          await supabase
            .from('journals')
            .update({
              title:
                doc.title,

              description:
                doc.description,

              foreword:
                doc.description,

              background_color:
                doc.coverBackground,

              cover_media_type:
                doc.coverMediaType,

              cover_type:
                doc.coverMediaType,

              cover_media_url:
                doc.coverMediaUrl ||
                null,

              cover_url:
                doc.coverMediaUrl ||
                null,

              cover_elements:
                doc.coverElements,
            })
            .eq(
              'id',
              journalId,
            );

        if (journalError) {
          throw journalError;
        }

        if (
          deletedPageIds.length
        ) {
          const {
            error,
          } =
            await supabase
              .from(
                'journal_pages',
              )
              .delete()
              .in(
                'id',
                deletedPageIds,
              );

          if (error) {
            throw error;
          }
        }

        for (
          let index = 0;
          index <
          doc.pages.length;
          index++
        ) {
          const page =
            doc.pages[index];

          const payload = {
            journal_id:
              journalId,

            page_number:
              index + 1,

            title:
              page.title ||
              `Page ${
                index + 1
              }`,

            background:
              page.background ||
              '#FFFDF8',

            width:
              BASE_WIDTH,

            height:
              BASE_HEIGHT,

            media_type:
              page.elements.find(
                (element) =>
                  element.type ===
                  'media',
              )?.media_type ||
              'image',

            media_url:
              page.elements.find(
                (element) =>
                  element.type ===
                  'media',
              )?.media_url ||
              null,

            stickers:
              page.elements
                .filter(
                  (element) =>
                    element.type ===
                    'sticker',
                )
                .map(
                  (element) =>
                    element.content,
                ),

            elements:
              page.elements,
          };

          if (
            page.id.startsWith(
              'temp-page-',
            )
          ) {
            const {
              data,
              error,
            } =
              await supabase
                .from(
                  'journal_pages',
                )
                .insert(
                  payload,
                )
                .select(
                  'id',
                )
                .maybeSingle();

            if (error) {
              throw error;
            }

            if (data?.id) {
              updateDocSilent(
                page.id,
                data.id as string,
              );
            }
          } else {
            const {
              error,
            } =
              await supabase
                .from(
                  'journal_pages',
                )
                .update(
                  payload,
                )
                .eq(
                  'id',
                  page.id,
                );

            if (error) {
              throw error;
            }
          }
        }

        setDeletedPageIds(
          [],
        );

        setLastSavedAt(
          new Date(),
        );

        markClean();

        if (!silent) {
          showToast(
            'Journal saved ✨',
          );
        }
      } catch (
        error: any
      ) {
        if (!silent) {
          showToast(
            `Error saving journal: ${
              error?.message ||
              error
            }`,
            'error',
          );
        }
      } finally {
        if (!silent) {
          setSaving(false);
        }
      }
    },
    [
      journalId,
      doc,
      deletedPageIds,
      markClean,
      updateDocSilent,
      showToast,
    ],
  );

  /*
   * Autosave.
   */
  useEffect(() => {
    if (
      !initialDoc ||
      !dirty
    ) {
      return;
    }

    if (
      autosaveTimer.current
    ) {
      clearTimeout(
        autosaveTimer.current,
      );
    }

    autosaveTimer.current =
      setTimeout(
        () => {
          saveAll(true);
        },
        2500,
      );

    return () => {
      if (
        autosaveTimer.current
      ) {
        clearTimeout(
          autosaveTimer.current,
        );
      }
    };
  }, [
    doc,
    dirty,
    initialDoc,
    saveAll,
  ]);

  /*
   * Warn before leaving.
   */
  useEffect(() => {
    const handler = (
      event: BeforeUnloadEvent,
    ) => {
      if (!dirty) return;

      event.preventDefault();
    };

    window.addEventListener(
      'beforeunload',
      handler,
    );

    return () =>
      window.removeEventListener(
        'beforeunload',
        handler,
      );
  }, [dirty]);

  /*
   * Render element.
   */
  const renderElement = (
    element: CanvasElement,
    interactive = true,
  ) => {
    const selected =
      interactive &&
      selectedElementIds.includes(
        element.id,
      );

    const primarySelected =
      interactive &&
      selectedElementId ===
        element.id;

    const inverseZoom =
      interactive
        ? 1 /
          Math.max(
            zoom,
            0.05,
          )
        : 1;

    const style: React.CSSProperties =
      {
        left:
          element.position_x,

        top:
          element.position_y,

        width:
          element.width,

        height:
          element.height,

        zIndex:
          element.z_index,

        opacity:
          element.opacity ??
          1,

        transform:
          `rotate(${
            element.rotation ||
            0
          }deg)`,

        borderRadius:
          element.border_radius ??
          12,

        touchAction:
          interactive
            ? 'none'
            : undefined,

        boxShadow:
          selected
            ? `0 0 0 ${
                2 *
                inverseZoom
              }px rgba(255,255,255,.95), 0 0 0 ${
                5 *
                inverseZoom
              }px #ec4899`
            : undefined,
      };

    return (
      <div
        key={element.id}
        data-element-id={
          element.id
        }
        onPointerDown={
          interactive
            ? (event) =>
                handleElementPointerDown(
                  event,
                  element,
                )
            : undefined
        }
        onPointerMove={
          interactive
            ? (event) =>
                handleElementPointerMove(
                  event,
                  element,
                )
            : undefined
        }
        onPointerUp={
          interactive
            ? handleElementPointerUp
            : undefined
        }
        onPointerCancel={
          interactive
            ? handleElementPointerUp
            : undefined
        }
        onClick={
          interactive
            ? (event) => {
                event.stopPropagation();

                selectElement(
                  element.id,
                  event.ctrlKey ||
                    event.metaKey,
                );
              }
            : undefined
        }
        className={`absolute ${
          interactive
            ? 'cursor-move select-none'
            : ''
        }`}
        style={style}
      >
        {element.type ===
          'text' &&
          (
            interactive ? (
              <textarea
                value={
                  element.content
                }
                onChange={(event) =>
                  updateSelected(
                    {
                      content:
                        event.target
                          .value,
                    },
                    'Edit text',
                    `text-${element.id}`,
                  )
                }
                onPointerDown={(
                  event,
                ) =>
                  event.stopPropagation()
                }
                data-history-scoped="true"
                className="h-full w-full resize-none border-0 outline-none focus:ring-0"
                placeholder="Write your memory…"
                style={{
                  fontFamily:
                    element.font_family,

                  fontSize:
                    element.font_size,

                  color:
                    element.color,

                  background:
                    element.background,

                  textAlign:
                    element.text_align,

                  fontWeight:
                    element.bold
                      ? 700
                      : 400,

                  fontStyle:
                    element.italic
                      ? 'italic'
                      : 'normal',

                  textDecoration:
                    element.underline
                      ? 'underline'
                      : 'none',

                  padding: 14,

                  lineHeight:
                    1.25,
                }}
              />
            ) : (
              <div
                className="h-full w-full overflow-hidden whitespace-pre-wrap"
                style={{
                  fontFamily:
                    element.font_family,

                  fontSize:
                    element.font_size,

                  color:
                    element.color,

                  background:
                    element.background,

                  textAlign:
                    element.text_align,

                  fontWeight:
                    element.bold
                      ? 700
                      : 400,

                  fontStyle:
                    element.italic
                      ? 'italic'
                      : 'normal',

                  textDecoration:
                    element.underline
                      ? 'underline'
                      : 'none',

                  padding: 14,

                  lineHeight:
                    1.25,
                }}
              >
                {
                  element.content
                }
              </div>
            )
          )}

        {element.type ===
          'media' &&
          element.media_url && (
            <div
              className="h-full w-full overflow-hidden bg-white/80"
              style={{
                borderRadius:
                  element.border_radius ??
                  12,
              }}
            >
              {element.media_type ===
              'video' ? (
                <video
                  src={
                    element.media_url
                  }
                  controls
                  playsInline
                  onPointerDown={(
                    event,
                  ) =>
                    event.stopPropagation()
                  }
                  className="h-full w-full"
                  style={{
                    objectFit:
                      element.object_fit,
                  }}
                />
              ) : element.media_type ===
                'audio' ? (
                <div className="flex h-full flex-col justify-center gap-2 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <FileAudio className="h-5 w-5" />

                    {
                      element.content
                    }
                  </div>

                  <audio
                    src={
                      element.media_url
                    }
                    controls
                    onPointerDown={(
                      event,
                    ) =>
                      event.stopPropagation()
                    }
                    className="w-full"
                  />
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={
                    element.media_url
                  }
                  alt={
                    element.content
                  }
                  draggable={false}
                  className="h-full w-full"
                  style={{
                    objectFit:
                      element.object_fit,
                  }}
                />
              )}
            </div>
          )}

        {element.type ===
          'gif' &&
          element.media_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={
                element.media_url
              }
              alt={
                element.content ||
                'GIF'
              }
              draggable={false}
              className="h-full w-full object-cover"
            />
          )}

        {element.type ===
          'icon' && (
            <div
              className="flex h-full w-full select-none items-center justify-center"
              style={{
                color:
                  element.color ||
                  '#2b2520',
              }}
            >
              <IconGlyph
                iconId={
                  element.content
                }
                className="h-[72%] w-[72%]"
              />
            </div>
          )}

        {element.type ===
          'link' && (
            <a
              href={
                element.href ||
                element.content
              }
              target="_blank"
              rel="noreferrer"
              onPointerDown={(
                event,
              ) =>
                event.stopPropagation()
              }
              onClick={(event) => {
                if (
                  interactive
                ) {
                  event.preventDefault();
                }
              }}
              className="flex h-full w-full items-center gap-3 border border-blue-200 bg-blue-50/80 p-4 text-blue-800 shadow-sm"
            >
              <Link2 className="h-6 w-6 shrink-0" />

              <span className="min-w-0 break-words text-sm font-semibold">
                {
                  element.content ||
                  element.href
                }
              </span>
            </a>
          )}

        {element.type ===
          'sticker' && (
            <div
              className="flex h-full w-full select-none items-center justify-center"
              style={{
                fontSize:
                  Math.min(
                    element.width,
                    element.height,
                  ) *
                  0.72,
              }}
            >
              {
                element.content
              }
            </div>
          )}

        {element.type ===
          'drawing' && (
            <div
              onPointerDown={(
                event,
              ) => {
                event.stopPropagation();

                setSelectedElementId(
                  element.id,
                );

                setSelectedElementIds(
                  [element.id],
                );
              }}
              className="h-full w-full overflow-hidden bg-transparent"
            >
              <DrawingEditor
                element={element}
                onChange={(
                  content,
                ) =>
                  updateSelected(
                    {
                      content,
                    },
                    'Draw',
                    `draw-${element.id}`,
                  )
                }
              />
            </div>
          )}

        {element.type ===
          'shape' && (
            <div className="h-full w-full">
              <ShapeView
                element={element}
              />
            </div>
          )}

        {primarySelected &&
          interactive && (
            <>
              {/* Rotation handle */}
              <div
                className="absolute left-1/2 z-50 flex -translate-x-1/2 items-center justify-center rounded-full border-2 border-white bg-[#2A211D] text-white shadow-lg"
                style={{
                  top:
                    -52 *
                    inverseZoom,

                  width:
                    36 *
                    inverseZoom,

                  height:
                    36 *
                    inverseZoom,

                  touchAction:
                    'none',
                }}
                onPointerDown={(
                  event,
                ) => {
                  event.stopPropagation();

                  const rect =
                    event.currentTarget.parentElement?.getBoundingClientRect();

                  if (!rect) return;

                  try {
                    event.currentTarget.setPointerCapture(
                      event.pointerId,
                    );
                  } catch {}

                  const centerX =
                    rect.left +
                    rect.width /
                      2;

                  const centerY =
                    rect.top +
                    rect.height /
                      2;

                  const initialAngle =
                    Math.atan2(
                      event.clientY -
                        centerY,
                      event.clientX -
                        centerX,
                    ) *
                    (180 /
                      Math.PI);

                  const startingRotation =
                    element.rotation ||
                    0;

                  const move =
                    (
                      moveEvent: PointerEvent,
                    ) => {
                      const currentAngle =
                        Math.atan2(
                          moveEvent.clientY -
                            centerY,
                          moveEvent.clientX -
                            centerX,
                        ) *
                        (180 /
                          Math.PI);

                      const delta =
                        currentAngle -
                        initialAngle;

                      updateSelected(
                        {
                          rotation:
                            normalizeRotation(
                              startingRotation +
                                delta,
                            ),
                        },
                        'Rotate element',
                        `rotate-handle-${element.id}`,
                      );
                    };

                  const stop =
                    () => {
                      window.removeEventListener(
                        'pointermove',
                        move,
                      );

                      window.removeEventListener(
                        'pointerup',
                        stop,
                      );

                      window.removeEventListener(
                        'pointercancel',
                        stop,
                      );
                    };

                  window.addEventListener(
                    'pointermove',
                    move,
                  );

                  window.addEventListener(
                    'pointerup',
                    stop,
                  );

                  window.addEventListener(
                    'pointercancel',
                    stop,
                  );
                }}
                aria-label="Rotate element"
              >
                <RotateCw
                  style={{
                    width:
                      17 *
                      inverseZoom,
                    height:
                      17 *
                      inverseZoom,
                  }}
                />
              </div>

              {/* Delete */}
              <button
                type="button"
                onPointerDown={(
                  event,
                ) =>
                  event.stopPropagation()
                }
                onClick={(event) => {
                  event.stopPropagation();

                  if (
                    confirmDeleteId ===
                    element.id
                  ) {
                    deleteSelected();

                    setConfirmDeleteId(
                      null,
                    );
                  } else {
                    setConfirmDeleteId(
                      element.id,
                    );
                  }
                }}
                className="absolute right-0 z-50 flex items-center justify-center rounded-full bg-white text-red-500 shadow-lg ring-1 ring-red-100"
                style={{
                  top:
                    -48 *
                    inverseZoom,

                  width:
                    38 *
                    inverseZoom,

                  height:
                    38 *
                    inverseZoom,
                }}
                aria-label={
                  confirmDeleteId ===
                  element.id
                    ? 'Confirm delete'
                    : 'Delete element'
                }
              >
                {confirmDeleteId ===
                element.id ? (
                  <span
                    style={{
                      fontSize:
                        9 *
                        inverseZoom,
                    }}
                  >
                    YES
                  </span>
                ) : (
                  <Trash2
                    style={{
                      width:
                        17 *
                        inverseZoom,

                      height:
                        17 *
                        inverseZoom,
                    }}
                  />
                )}
              </button>

              {/* NW */}
              <ResizeHandle
                corner="nw"
                inverseZoom={
                  inverseZoom
                }
                onStart={(event) =>
                  beginResize(
                    event,
                    element,
                    'nw',
                  )
                }
              />

              {/* NE */}
              <ResizeHandle
                corner="ne"
                inverseZoom={
                  inverseZoom
                }
                onStart={(event) =>
                  beginResize(
                    event,
                    element,
                    'ne',
                  )
                }
              />

              {/* SW */}
              <ResizeHandle
                corner="sw"
                inverseZoom={
                  inverseZoom
                }
                onStart={(event) =>
                  beginResize(
                    event,
                    element,
                    'sw',
                  )
                }
              />

              {/* SE */}
              <ResizeHandle
                corner="se"
                inverseZoom={
                  inverseZoom
                }
                onStart={(event) =>
                  beginResize(
                    event,
                    element,
                    'se',
                  )
                }
              />
            </>
          )}
      </div>
    );
  };

  const previewStageWidth =
    isMobile
      ? Math.max(
          240,
          Math.min(
            vw - 56,
            430,
          ),
        )
      : 430;

  const previewScale =
    previewStageWidth /
    BASE_WIDTH;

  if (
    loading ||
    !initialDoc
  ) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#B88C5A] font-serif text-[#3C2819]">
        Loading Journal
        Studio…
      </div>
    );
  }

  const showCanvas =
    !isMobile ||
    mobileTab === 'canvas';

  const showTools =
    !isMobile ||
    mobileTab === 'tools';

  const showPages =
    !isMobile ||
    mobileTab === 'page';

  const journalAside = (
    <aside className="rounded-2xl border border-[#D8C9BA] bg-[#FFFDF9] p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-serif font-bold">
          Journal
        </h2>

        <span className="text-lg">
          📖
        </span>
      </div>

      <div className="space-y-3">
        <label className="block text-xs font-semibold">
          Title

          <input
            value={
              doc.title
            }
            onChange={(event) =>
              setState(
                (current) => ({
                  ...current,
                  title:
                    event.target
                      .value,
                }),
                'Edit title',
                'doc-title',
              )
            }
            data-history-scoped="true"
            className="mt-1 w-full rounded-lg border bg-white p-2 text-sm"
          />
        </label>

        <label className="block text-xs font-semibold">
          Foreword / description

          <textarea
            value={
              doc.description
            }
            onChange={(event) =>
              setState(
                (current) => ({
                  ...current,
                  description:
                    event.target
                      .value,
                }),
                'Edit description',
                'doc-desc',
              )
            }
            data-history-scoped="true"
            className="mt-1 h-24 w-full resize-none rounded-lg border bg-white p-2 text-sm"
          />
        </label>

        <label className="block text-xs font-semibold">
          Cover paper

          <input
            type="color"
            value={
              doc.coverBackground
            }
            onChange={(event) =>
              setState(
                (current) => ({
                  ...current,
                  coverBackground:
                    event.target
                      .value,
                }),
                'Cover color',
                'doc-coverbg',
              )
            }
            className="mt-1 h-10 w-full rounded-lg border p-1"
          />
        </label>

        <label className="block text-xs font-semibold">
          Cover image / video

          <input
            type="file"
            accept="image/*,video/*"
            onChange={(
              event,
            ) => {
              const file =
                event.target.files?.[0];

              event.target.value =
                '';

              if (!file) {
                return;
              }

              setUploadingFile(
                true,
              );

              (async () => {
                try {
                  const {
                    data: {
                      user,
                    },
                  } =
                    await supabase.auth.getUser();

                  if (!user) {
                    throw new Error(
                      'Not signed in.',
                    );
                  }

                  const upload =
                    await uploadFile(
                      file,
                      'journal-media',
                      user.id,
                    );

                  setCoverMedia(
                    file.type.startsWith(
                      'video/',
                    )
                      ? 'video'
                      : 'image',
                    upload.url,
                  );

                  showToast(
                    'Cover media updated',
                  );
                } catch (
                  error: any
                ) {
                  showToast(
                    `Upload failed: ${
                      error?.message ||
                      error
                    }`,
                    'error',
                  );
                } finally {
                  setUploadingFile(
                    false,
                  );
                }
              })();
            }}
            className="mt-1 w-full text-xs"
          />
        </label>
      </div>

      <div className="mt-5 border-t pt-3">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">
          Pages
        </h3>

        <div className="max-h-64 space-y-1 overflow-y-auto">
          <button
            onClick={() => {
              setActivePageId(
                null,
              );

              deselectAll();
            }}
            className={`w-full rounded-lg px-2 py-2.5 text-left text-xs ${
              activeIsCover
                ? 'bg-pink-100 font-bold text-pink-800'
                : 'hover:bg-gray-100'
            }`}
          >
            📖 Cover
          </button>

          {doc.pages.map(
            (
              page,
              index,
            ) => (
              <button
                key={
                  page.id
                }
                onClick={() => {
                  setActivePageId(
                    page.id,
                  );

                  deselectAll();
                }}
                className={`w-full rounded-lg px-2 py-2.5 text-left text-xs ${
                  !activeIsCover &&
                  activePageId ===
                    page.id
                    ? 'bg-[#2A211D] font-bold text-[#FFD2DE]'
                    : 'hover:bg-gray-100'
                }`}
              >
                Page{' '}
                {index + 1} ·{' '}
                {page.title ||
                  'Untitled'}
              </button>
            ),
          )}
        </div>

        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <button
            onClick={
              addPage
            }
            className="rounded-lg bg-[#2A211D] px-2 py-2.5 text-xs font-bold text-[#FFD2DE]"
          >
            <Plus className="mr-1 inline h-3.5 w-3.5" />
            New
          </button>

          <button
            onClick={
              duplicatePage
            }
            disabled={
              activeIsCover
            }
            className="rounded-lg border px-2 py-2.5 text-xs disabled:opacity-40"
          >
            <Copy className="mr-1 inline h-3.5 w-3.5" />
            Copy
          </button>
        </div>

        {!activeIsCover && (
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <button
              onClick={() =>
                movePage(-1)
              }
              disabled={
                doc.pages.findIndex(
                  (page) =>
                    page.id ===
                    activePageId,
                ) <= 0
              }
              className="rounded-lg border px-2 py-2 text-xs disabled:opacity-40"
            >
              <ArrowUp className="mr-1 inline h-3 w-3" />
              Earlier
            </button>

            <button
              onClick={() =>
                movePage(1)
              }
              disabled={
                doc.pages.findIndex(
                  (page) =>
                    page.id ===
                    activePageId,
                ) >=
                doc.pages.length -
                  1
              }
              className="rounded-lg border px-2 py-2 text-xs disabled:opacity-40"
            >
              <ArrowDown className="mr-1 inline h-3 w-3" />
              Later
            </button>
          </div>
        )}

        {!activeIsCover && (
          <button
            onClick={
              deletePage
            }
            className="mt-1.5 w-full rounded-lg border border-red-200 px-2 py-2.5 text-xs text-red-500"
          >
            <Trash2 className="mr-1 inline h-3.5 w-3.5" />
            Delete page
          </button>
        )}
      </div>
    </aside>
  );

  const toolsAside = (
    <aside className="rounded-2xl border border-[#D8C9BA] bg-[#FFFDF9] p-3 shadow-sm">
      <h2 className="mb-3 font-serif font-bold">
        Scrapbook tools
      </h2>

      <div className="mb-3 grid grid-cols-4 gap-1">
        <button
          onClick={() =>
            setToolPanel(
              toolPanel ===
                'stickers'
                ? 'none'
                : 'stickers',
            )
          }
          className={`rounded-lg border p-2 text-[10px] font-bold ${
            toolPanel ===
            'stickers'
              ? 'bg-[#2A211D] text-[#FFD2DE]'
              : 'bg-white'
          }`}
        >
          <Sparkles className="mx-auto h-4 w-4" />
          Stickers
        </button>

        <button
          onClick={() =>
            setToolPanel(
              toolPanel ===
                'emoji'
                ? 'none'
                : 'emoji',
            )
          }
          className={`rounded-lg border p-2 text-[10px] font-bold ${
            toolPanel ===
            'emoji'
              ? 'bg-[#2A211D] text-[#FFD2DE]'
              : 'bg-white'
          }`}
        >
          <Smile className="mx-auto h-4 w-4" />
          Emoji
        </button>

        <button
          onClick={() =>
            setToolPanel(
              toolPanel ===
                'gif'
                ? 'none'
                : 'gif',
            )
          }
          className={`rounded-lg border p-2 text-[10px] font-bold ${
            toolPanel ===
            'gif'
              ? 'bg-[#2A211D] text-[#FFD2DE]'
              : 'bg-white'
          }`}
        >
          GIF
        </button>

        <button
          onClick={() =>
            setToolPanel(
              toolPanel ===
                'icons'
                ? 'none'
                : 'icons',
            )
          }
          className={`rounded-lg border p-2 text-[10px] font-bold ${
            toolPanel ===
            'icons'
              ? 'bg-[#2A211D] text-[#FFD2DE]'
              : 'bg-white'
          }`}
        >
          <StickyNote className="mx-auto h-4 w-4" />
          Icons
        </button>
      </div>

      {toolPanel ===
        'stickers' && (
        <div className="mb-3 max-h-72 overflow-hidden rounded-xl border bg-white">
          <StickerPicker
            onPick={
              addSticker
            }
          />
        </div>
      )}

      {toolPanel ===
        'emoji' && (
        <div className="mb-3 max-h-72 overflow-hidden rounded-xl border bg-white">
          <EmojiPicker
            onPick={
              addEmoji
            }
          />
        </div>
      )}

      {toolPanel ===
        'gif' && (
        <div className="mb-3 max-h-80 overflow-hidden rounded-xl border bg-white">
          <GifPicker
            onPick={addGif}
          />
        </div>
      )}

      {toolPanel ===
        'icons' && (
        <div className="mb-3 max-h-72 overflow-hidden rounded-xl border bg-white">
          <IconPicker
            onPick={
              addIcon
            }
          />
        </div>
      )}

      <div className="mb-4 rounded-xl border bg-[#FAF5EF] p-2">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-bold">
            Shapes
          </span>

          <span className="text-[10px] text-gray-400">
            tap to insert
          </span>
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          {[
            'rectangle',
            'circle',
            'triangle',
            'diamond',
            'star',
            'heart',
            'line',
            'speech',
            'cloud',
            'hexagon',
          ].map(
            (shape) => (
              <button
                key={
                  shape
                }
                title={
                  shape
                }
                onClick={() =>
                  addShape(
                    shape,
                  )
                }
                className="rounded-lg border bg-white p-2.5 text-[10px] font-semibold capitalize transition hover:bg-pink-50 active:scale-95"
              >
                {shape}
              </button>
            ),
          )}
        </div>
      </div>

      <div className="mb-4 rounded-xl border bg-[#FAF5EF] p-2">
        <div className="mb-2 text-xs font-bold">
          Drawing
        </div>

        <div className="flex items-center gap-2">
          <input
            type="color"
            value={
              drawColor
            }
            onChange={(event) =>
              setDrawColor(
                event.target
                  .value,
              )
            }
            className="h-10 w-10 rounded border p-0.5"
            aria-label="Drawing color"
          />

          <select
            value={
              drawWidth
            }
            onChange={(event) =>
              setDrawWidth(
                Number(
                  event.target
                    .value,
                ),
              )
            }
            className="flex-1 rounded-lg border bg-white p-2.5 text-xs"
          >
            <option value="2">
              Fine pen
            </option>
            <option value="5">
              Pen
            </option>
            <option value="9">
              Marker
            </option>
            <option value="16">
              Brush
            </option>
          </select>
        </div>

        <button
          onClick={() =>
            addElement(
              'drawing',
            )
          }
          className="mt-2 w-full rounded-lg border bg-white px-2 py-2.5 text-xs font-bold"
        >
          <PenLine className="mr-1 inline h-4 w-4" />
          Add sketch area
        </button>
      </div>

      <div className="mb-4 rounded-xl border bg-[#FAF5EF] p-2">
        <div className="mb-2 text-xs font-bold">
          Canvas interaction
        </div>

        <button
          type="button"
          onClick={() =>
            setSnapEnabled(
              (value) =>
                !value,
            )
          }
          className={`flex w-full items-center justify-between rounded-lg border bg-white px-3 py-2.5 text-xs font-semibold ${
            snapEnabled
              ? 'ring-2 ring-pink-200'
              : ''
          }`}
        >
          <span>
            Snap to grid
          </span>

          <span>
            {snapEnabled
              ? 'ON'
              : 'OFF'}
          </span>
        </button>

        <button
          type="button"
          onClick={() =>
            setShowGestureHelp(
              (value) =>
                !value,
            )
          }
          className="mt-1.5 w-full rounded-lg border bg-white px-3 py-2.5 text-xs font-semibold"
        >
          {showGestureHelp
            ? 'Hide gestures'
            : 'Show gestures'}
        </button>

        {showGestureHelp && (
          <div className="mt-2 rounded-lg bg-white p-3 text-[11px] leading-5 text-gray-600">
            <div>
              <b>One finger:</b>{' '}
              move
            </div>

            <div>
              <b>Two fingers:</b>{' '}
              resize + rotate
            </div>

            <div>
              <b>Pinch empty canvas:</b>{' '}
              zoom
            </div>

            <div>
              <b>Double tap:</b>{' '}
              edit text
            </div>

            <div>
              <b>Arrow keys:</b>{' '}
              move 1px
            </div>

            <div>
              <b>Shift + arrows:</b>{' '}
              move 10px
            </div>

            <div>
              <b>Ctrl/Cmd + click:</b>{' '}
              multi-select
            </div>
          </div>
        )}
      </div>

      {selectedElement ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold">
              Selected:{' '}
              {
                selectedElement.type
              }
            </span>

            <button
              onClick={() =>
                updateSelected(
                  {
                    locked:
                      !selectedElement.locked,
                  },
                  selectedElement.locked
                    ? 'Unlock element'
                    : 'Lock element',
                )
              }
              className="rounded-lg border p-2"
              aria-label={
                selectedElement.locked
                  ? 'Unlock element'
                  : 'Lock element'
              }
            >
              {selectedElement.locked ? (
                <Lock className="h-4 w-4" />
              ) : (
                <Unlock className="h-4 w-4" />
              )}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {(
              [
                'position_x',
                'position_y',
                'width',
                'height',
              ] as const
            ).map(
              (field) => (
                <label
                  key={
                    field
                  }
                  className="text-[10px] font-semibold text-gray-500"
                >
                  {field.replace(
                    '_',
                    ' ',
                  )}

                  <input
                    type="number"
                    inputMode="numeric"
                    value={Math.round(
                      selectedElement[
                        field
                      ],
                    )}
                    onChange={(
                      event,
                    ) =>
                      updateSelected(
                        {
                          [field]:
                            Number(
                              event
                                .target
                                .value,
                            ),
                        } as Partial<CanvasElement>,
                        `Edit ${field}`,
                        `pos-${selectedElement.id}-${field}`,
                      )
                    }
                    className="mt-1 w-full rounded border bg-white p-2 text-xs"
                  />
                </label>
              ),
            )}
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            <button
              onClick={() =>
                rotate(-5)
              }
              className="rounded border p-2.5"
              title="Rotate left"
            >
              <RotateCcw className="mx-auto h-4 w-4" />
            </button>

            <button
              onClick={() =>
                rotate(5)
              }
              className="rounded border p-2.5 text-xs font-bold"
            >
              +5°
            </button>

            <button
              onClick={
                bringForward
              }
              className="rounded border p-2.5 text-[10px] font-bold"
            >
              Front
            </button>

            <button
              onClick={
                sendBackward
              }
              className="rounded border p-2.5 text-[10px] font-bold"
            >
              Back
            </button>
          </div>

          <label className="block text-[10px] font-semibold text-gray-500">
            Rotation

            <input
              type="range"
              min={-180}
              max={180}
              value={
                selectedElement.rotation ||
                0
              }
              onChange={(event) =>
                updateSelected(
                  {
                    rotation:
                      Number(
                        event
                          .target
                          .value,
                      ),
                  },
                  'Rotate',
                  `rotation-${selectedElement.id}`,
                )
              }
              className="mt-1 w-full"
            />
          </label>

          <label className="block text-[10px] font-semibold text-gray-500">
            Opacity

            <input
              type="range"
              min={10}
              max={100}
              value={Math.round(
                (selectedElement.opacity ??
                  1) *
                  100,
              )}
              onChange={(event) =>
                updateSelected(
                  {
                    opacity:
                      Number(
                        event
                          .target
                          .value,
                      ) /
                      100,
                  },
                  'Opacity',
                  `opacity-${selectedElement.id}`,
                )
              }
              className="mt-1 w-full"
            />
          </label>

          {selectedElement.type ===
            'text' && (
            <div className="space-y-2 border-t pt-2">
              <div className="grid grid-cols-2 gap-1.5">
                <select
                  value={
                    selectedElement.font_family
                  }
                  onChange={(event) =>
                    updateSelected(
                      {
                        font_family:
                          event
                            .target
                            .value,
                      },
                      'Change font',
                    )
                  }
                  className="rounded border p-2.5 text-xs"
                >
                  {FONT_OPTIONS.map(
                    (font) => (
                      <option
                        key={
                          font
                        }
                      >
                        {
                          font
                        }
                      </option>
                    ),
                  )}
                </select>

                <input
                  type="number"
                  inputMode="numeric"
                  min={8}
                  max={120}
                  value={
                    selectedElement.font_size
                  }
                  onChange={(event) =>
                    updateSelected(
                      {
                        font_size:
                          Number(
                            event
                              .target
                              .value,
                          ),
                      },
                      'Font size',
                      `font-size-${selectedElement.id}`,
                    )
                  }
                  className="rounded border p-2.5 text-xs"
                />
              </div>

              <div className="flex gap-1">
                <button
                  onClick={() =>
                    updateSelected(
                      {
                        bold:
                          !selectedElement.bold,
                      },
                      'Bold',
                    )
                  }
                  className={`flex-1 rounded border p-2.5 ${
                    selectedElement.bold
                      ? 'bg-gray-200'
                      : ''
                  }`}
                >
                  <Bold className="mx-auto h-4 w-4" />
                </button>

                <button
                  onClick={() =>
                    updateSelected(
                      {
                        italic:
                          !selectedElement.italic,
                      },
                      'Italic',
                    )
                  }
                  className={`flex-1 rounded border p-2.5 ${
                    selectedElement.italic
                      ? 'bg-gray-200'
                      : ''
                  }`}
                >
                  <Italic className="mx-auto h-4 w-4" />
                </button>

                <button
                  onClick={() =>
                    updateSelected(
                      {
                        underline:
                          !selectedElement.underline,
                      },
                      'Underline',
                    )
                  }
                  className={`flex-1 rounded border p-2.5 ${
                    selectedElement.underline
                      ? 'bg-gray-200'
                      : ''
                  }`}
                >
                  <Underline className="mx-auto h-4 w-4" />
                </button>

                <button
                  onClick={() =>
                    updateSelected(
                      {
                        text_align:
                          'left',
                      },
                      'Align left',
                    )
                  }
                  className="flex-1 rounded border p-2.5"
                >
                  <AlignLeft className="mx-auto h-4 w-4" />
                </button>

                <button
                  onClick={() =>
                    updateSelected(
                      {
                        text_align:
                          'center',
                      },
                      'Align center',
                    )
                  }
                  className="flex-1 rounded border p-2.5"
                >
                  <AlignCenter className="mx-auto h-4 w-4" />
                </button>

                <button
                  onClick={() =>
                    updateSelected(
                      {
                        text_align:
                          'right',
                      },
                      'Align right',
                    )
                  }
                  className="flex-1 rounded border p-2.5"
                >
                  <AlignRight className="mx-auto h-4 w-4" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <label className="flex-1 text-[10px] font-semibold">
                  Ink

                  <input
                    type="color"
                    value={
                      selectedElement.color ||
                      '#2b2520'
                    }
                    onChange={(event) =>
                      updateSelected(
                        {
                          color:
                            event
                              .target
                              .value,
                        },
                        'Text color',
                        `color-${selectedElement.id}`,
                      )
                    }
                    className="mt-1 h-9 w-full rounded border p-1"
                  />
                </label>

                <label className="flex-1 text-[10px] font-semibold">
                  Paper

                  <input
                    type="color"
                    value={
                      selectedElement.background ===
                      'transparent'
                        ? '#ffffff'
                        : selectedElement.background?.startsWith(
                              '#',
                            )
                          ? selectedElement.background
                          : '#ffffff'
                    }
                    onChange={(event) =>
                      updateSelected(
                        {
                          background:
                            event
                              .target
                              .value,
                        },
                        'Element background',
                        `bg-${selectedElement.id}`,
                      )
                    }
                    className="mt-1 h-9 w-full rounded border p-1"
                  />
                </label>
              </div>
            </div>
          )}

          {selectedElement.type ===
            'media' && (
            <div className="space-y-2 border-t pt-2">
              <label className="text-xs font-semibold">
                Fit

                <select
                  value={
                    selectedElement.object_fit
                  }
                  onChange={(event) =>
                    updateSelected(
                      {
                        object_fit:
                          event
                            .target
                            .value as
                            | 'cover'
                            | 'contain',
                      },
                      'Media fit',
                    )
                  }
                  className="mt-1 w-full rounded border p-2.5 text-xs"
                >
                  <option value="cover">
                    Crop / fill
                  </option>

                  <option value="contain">
                    Show whole media
                  </option>
                </select>
              </label>
            </div>
          )}

          {selectedElement.type ===
            'link' && (
            <div className="space-y-2 border-t pt-2">
              <label className="text-xs font-semibold">
                Label

                <input
                  value={
                    selectedElement.content
                  }
                  onChange={(event) =>
                    updateSelected(
                      {
                        content:
                          event
                            .target
                            .value,
                      },
                      'Link label',
                      `link-label-${selectedElement.id}`,
                    )
                  }
                  className="mt-1 w-full rounded border p-2.5 text-xs"
                />
              </label>

              <label className="text-xs font-semibold">
                URL

                <input
                  value={
                    selectedElement.href ||
                    ''
                  }
                  onChange={(event) =>
                    updateSelected(
                      {
                        href:
                          event
                            .target
                            .value,
                      },
                      'Link URL',
                      `link-url-${selectedElement.id}`,
                    )
                  }
                  className="mt-1 w-full rounded border p-2.5 text-xs"
                  placeholder="https://…"
                  inputMode="url"
                />
              </label>
            </div>
          )}

          {selectedElement.type ===
            'shape' && (
            <div className="space-y-2 border-t pt-2">
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10px] font-semibold">
                  Fill

                  <input
                    type="color"
                    value={
                      selectedElement.fill ||
                      '#F6D5DF'
                    }
                    onChange={(event) =>
                      updateSelected(
                        {
                          fill:
                            event
                              .target
                              .value,

                          content:
                            JSON.stringify({
                              shape:
                                selectedElement.shape ||
                                'rectangle',

                              fill:
                                event
                                  .target
                                  .value,

                              stroke:
                                selectedElement.stroke ||
                                '#8B5260',

                              stroke_width:
                                selectedElement.stroke_width ||
                                4,
                            }),
                        },
                        'Shape fill',
                        `shape-fill-${selectedElement.id}`,
                      )
                    }
                    className="mt-1 h-9 w-full rounded border p-1"
                  />
                </label>

                <label className="text-[10px] font-semibold">
                  Outline

                  <input
                    type="color"
                    value={
                      selectedElement.stroke ||
                      '#8B5260'
                    }
                    onChange={(event) =>
                      updateSelected(
                        {
                          stroke:
                            event
                              .target
                              .value,

                          content:
                            JSON.stringify({
                              shape:
                                selectedElement.shape ||
                                'rectangle',

                              fill:
                                selectedElement.fill ||
                                '#F6D5DF',

                              stroke:
                                event
                                  .target
                                  .value,

                              stroke_width:
                                selectedElement.stroke_width ||
                                4,
                            }),
                        },
                        'Shape outline',
                        `shape-stroke-${selectedElement.id}`,
                      )
                    }
                    className="mt-1 h-9 w-full rounded border p-1"
                  />
                </label>
              </div>

              <label className="text-[10px] font-semibold">
                Outline width

                <input
                  type="range"
                  min={1}
                  max={14}
                  value={
                    selectedElement.stroke_width ||
                    4
                  }
                  onChange={(event) =>
                    updateSelected(
                      {
                        stroke_width:
                          Number(
                            event
                              .target
                              .value,
                          ),
                      },
                      'Outline width',
                      `stroke-width-${selectedElement.id}`,
                    )
                  }
                  className="mt-1 w-full"
                />
              </label>
            </div>
          )}

          {selectedElement.type ===
            'drawing' && (
            <div className="space-y-2 border-t pt-2">
              <div className="text-xs font-semibold">
                Sketch settings
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={
                    safeJson(
                      selectedElement.content,
                      {
                        color:
                          '#2b2520',
                      },
                    ).color ||
                    '#2b2520'
                  }
                  onChange={(event) => {
                    const data =
                      safeJson(
                        selectedElement.content,
                        {
                          paths: [],
                          color:
                            '#2b2520',
                          strokeWidth:
                            5,
                        },
                      );

                    updateSelected(
                      {
                        content:
                          JSON.stringify({
                            ...data,
                            color:
                              event
                                .target
                                .value,
                          }),
                      },
                      'Drawing color',
                      `drawing-color-${selectedElement.id}`,
                    );
                  }}
                  className="h-10 w-10 rounded border p-0.5"
                  aria-label="Drawing color"
                />

                <select
                  value={Number(
                    safeJson(
                      selectedElement.content,
                      {
                        strokeWidth:
                          5,
                      },
                    ).strokeWidth ||
                      5,
                  )}
                  onChange={(event) => {
                    const data =
                      safeJson(
                        selectedElement.content,
                        {
                          paths: [],
                          color:
                            '#2b2520',
                          strokeWidth:
                            5,
                        },
                      );

                    updateSelected(
                      {
                        content:
                          JSON.stringify({
                            ...data,
                            strokeWidth:
                              Number(
                                event
                                  .target
                                  .value,
                              ),
                          }),
                      },
                      'Pen size',
                    );
                  }}
                  className="flex-1 rounded border p-2.5 text-xs"
                >
                  <option value={2}>
                    Fine
                  </option>
                  <option value={5}>
                    Pen
                  </option>
                  <option value={9}>
                    Marker
                  </option>
                  <option value={16}>
                    Brush
                  </option>
                </select>
              </div>

              <button
                onClick={() => {
                  const data =
                    safeJson(
                      selectedElement.content,
                      {
                        paths: [],
                        color:
                          drawColor,
                        strokeWidth:
                          drawWidth,
                      },
                    );

                  updateSelected(
                    {
                      content:
                        JSON.stringify({
                          ...data,
                          paths: [],
                        }),
                    },
                    'Clear drawing',
                  );
                }}
                className="w-full rounded-lg border border-red-200 p-2.5 text-xs font-bold text-red-500"
              >
                <Trash2 className="mr-1 inline h-3.5 w-3.5" />
                Clear drawing
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={
                duplicateSelected
              }
              className="rounded-lg border p-2.5 text-xs font-bold"
            >
              <Copy className="mr-1 inline h-3.5 w-3.5" />
              Duplicate
            </button>

            <button
              onClick={
                deleteSelected
              }
              className="rounded-lg border border-red-200 p-2.5 text-xs font-bold text-red-500"
            >
              <Trash2 className="mr-1 inline h-3.5 w-3.5" />
              Delete
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed p-5 text-center text-xs text-gray-500">
          Select an element to move, resize, rotate, lock, duplicate, or delete it.
        </div>
      )}
    </aside>
  );

  return (
    <main
      className="min-h-[100dvh] overflow-x-hidden bg-[#B88C5A] pb-24 text-[#241F1B] xl:pb-6"
      style={{
        backgroundImage:
          'repeating-linear-gradient(0deg,rgba(255,255,255,.035) 0,rgba(255,255,255,.035) 1px,transparent 1px,transparent 6px),repeating-linear-gradient(90deg,rgba(70,40,15,.025) 0,rgba(70,40,15,.025) 2px,transparent 2px,transparent 13px)',
      }}
    >
      <header className="fixed inset-x-0 top-0 z-50 border-b-2 border-[#604328] bg-[#EAD7BC] shadow-[0_4px_0_rgba(58,36,20,.25)]">
        <div className="mx-auto flex h-14 max-w-[1500px] items-center justify-between gap-2 px-3 md:h-16 md:px-5">
          <div className="flex min-w-0 items-center gap-2 md:gap-3">
            <Link
              href="/journals"
              className="rounded-lg border bg-white p-2"
              aria-label="Back to journals"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>

            <Link
              href="/feed"
              className="hidden rounded-lg border bg-white p-2 sm:block"
              aria-label="Back to feed"
            >
              <Home className="h-4 w-4" />
            </Link>

            <div className="min-w-0">
              <h1 className="truncate font-serif text-sm font-bold md:text-lg">
                {doc.title ||
                  'Journal'}

                <span className="hidden sm:inline">
                  {' '}
                  — Studio
                </span>
              </h1>

              <p className="hidden text-[10px] text-gray-500 sm:block">
                {saving
                  ? 'Saving…'
                  : dirty
                    ? 'Unsaved changes · autosaving'
                    : lastSavedAt
                      ? `Saved ${lastSavedAt.toLocaleTimeString()}`
                      : 'All changes saved'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={undo}
              disabled={!canUndo}
              className="rounded-lg border bg-white p-2 disabled:opacity-30"
              aria-label={
                undoLabel
                  ? `Undo: ${undoLabel}`
                  : 'Nothing to undo'
              }
            >
              <Undo2 className="h-4 w-4" />
            </button>

            <button
              onClick={redo}
              disabled={!canRedo}
              className="rounded-lg border bg-white p-2 disabled:opacity-30"
              aria-label={
                redoLabel
                  ? `Redo: ${redoLabel}`
                  : 'Nothing to redo'
              }
            >
              <Redo2 className="h-4 w-4" />
            </button>

            <button
              onClick={() =>
                saveAll()
              }
              disabled={
                saving ||
                uploadingFile
              }
              className="rounded-lg bg-[#2A211D] px-3 py-2 text-xs font-semibold text-[#FFD2DE] disabled:opacity-50"
            >
              <Save className="mr-1 inline h-4 w-4" />
              {saving
                ? 'Saving'
                : 'Save'}
            </button>

            <button
              onClick={() => {
                setPreviewIndex(
                  activeIsCover
                    ? 0
                    : doc.pages.findIndex(
                        (page) =>
                          page.id ===
                          activePageId,
                      ) + 1,
                );

                setShowPreview(
                  true,
                );
              }}
              className="rounded-lg border bg-white px-2.5 py-2 text-xs font-semibold"
            >
              <Eye className="mr-1 inline h-4 w-4" />

              <span className="hidden sm:inline">
                Preview
              </span>
            </button>

            <Link
              href={`/journals/${journalId}`}
              className="hidden rounded-lg border bg-white px-2.5 py-2 text-xs font-semibold lg:block"
            >
              View Book
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] grid-cols-1 gap-4 p-3 pt-[76px] md:p-5 md:pt-[92px] xl:grid-cols-[260px_minmax(0,1fr)_290px]">
        <div className="hidden xl:block xl:order-1">
          {journalAside}
        </div>

        <section
          className={`${
            showCanvas
              ? ''
              : 'hidden'
          } min-w-0 rounded-2xl border border-[#D8C9BA] bg-[#8A6039] p-2 shadow-[inset_0_0_0_2px_rgba(60,35,18,.25)] md:p-4 xl:order-2`}
        >
          <div className="no-scrollbar mb-2 flex items-center justify-between gap-2 overflow-x-auto rounded-xl border border-[#D8C9BA] bg-[#FFFDF9] p-2">
            <div className="flex shrink-0 gap-1.5">
              <ToolButton
                active={
                  tool ===
                  'select'
                }
                onClick={() =>
                  setTool(
                    'select',
                  )
                }
                icon={
                  <MousePointer2 />
                }
                label="Select"
              />

              <ToolButton
                active={
                  tool ===
                  'draw'
                }
                onClick={() => {
                  setTool(
                    'draw',
                  );

                  addElement(
                    'drawing',
                  );
                }}
                icon={
                  <PenLine />
                }
                label="Draw"
              />

              <ToolButton
                onClick={() =>
                  addElement(
                    'text',
                  )
                }
                icon={
                  <Type />
                }
                label="Text"
              />

              <ToolButton
                onClick={() =>
                  addElement(
                    'link',
                  )
                }
                icon={
                  <Link2 />
                }
                label="Link"
              />

              <ToolButton
                onClick={() =>
                  addShape(
                    'rectangle',
                  )
                }
                icon={
                  <span className="text-sm">
                    ▣
                  </span>
                }
                label="Shape"
              />

              <label className="flex shrink-0 cursor-pointer items-center gap-1 rounded-lg bg-gray-100 px-2.5 py-2 text-xs font-semibold">
                <Upload className="h-4 w-4" />

                {uploadingFile
                  ? 'Uploading…'
                  : 'Media'}

                <input
                  type="file"
                  accept="image/*,video/*,audio/*"
                  onChange={
                    handleFileUpload
                  }
                  disabled={
                    uploadingFile
                  }
                  className="hidden"
                />
              </label>
            </div>

            <div className="flex shrink-0 items-center gap-1 border-l border-gray-200 pl-2">
              <button
                onClick={() => {
                  setAutoFit(
                    false,
                  );

                  setZoom(
                    (value) =>
                      Math.max(
                        MIN_ZOOM,
                        value -
                          0.08,
                      ),
                  );
                }}
                className="rounded-lg border bg-white p-2"
                aria-label="Zoom out"
              >
                <ZoomOut className="h-4 w-4" />
              </button>

              <span className="w-11 text-center text-xs font-semibold">
                {Math.round(
                  zoom * 100,
                )}
                %
              </span>

              <button
                onClick={() => {
                  setAutoFit(
                    false,
                  );

                  setZoom(
                    (value) =>
                      Math.min(
                        MAX_ZOOM,
                        value +
                          0.08,
                      ),
                  );
                }}
                className="rounded-lg border bg-white p-2"
                aria-label="Zoom in"
              >
                <ZoomIn className="h-4 w-4" />
              </button>

              <button
                onClick={() =>
                  setAutoFit(
                    true,
                  )
                }
                className={`rounded-lg border p-2 text-[10px] font-bold ${
                  autoFit
                    ? 'bg-pink-100 text-pink-700'
                    : 'bg-white'
                }`}
              >
                Fit
              </button>
            </div>
          </div>

          {!activeIsCover &&
            activePage && (
              <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-[#D8C9BA] bg-[#FFFDF9] p-2">
                <input
                  value={
                    activePage.title ||
                    ''
                  }
                  onChange={(event) =>
                    setState(
                      (current) => ({
                        ...current,
                        pages:
                          current.pages.map(
                            (page) =>
                              page.id ===
                              activePage.id
                                ? {
                                    ...page,
                                    title:
                                      event
                                        .target
                                        .value,
                                  }
                                : page,
                          ),
                      }),
                      'Rename page',
                      `page-title-${activePage.id}`,
                    )
                  }
                  data-history-scoped="true"
                  className="min-w-[140px] flex-1 rounded-lg border p-2.5 text-xs"
                  placeholder="Page title"
                />

                <div className="flex items-center gap-1.5">
                  {PAPER_COLORS.map(
                    (color) => (
                      <button
                        key={
                          color
                        }
                        title={
                          color
                        }
                        aria-label={`Paper color ${color}`}
                        onClick={() =>
                          setState(
                            (
                              current,
                            ) => ({
                              ...current,
                              pages:
                                current.pages.map(
                                  (
                                    page,
                                  ) =>
                                    page.id ===
                                    activePage.id
                                      ? {
                                          ...page,
                                          background:
                                            color,
                                        }
                                      : page,
                                ),
                            }),
                            'Page background',
                          )
                        }
                        className={`h-8 w-8 shrink-0 rounded-full border shadow-sm ${
                          activePage.background ===
                          color
                            ? 'ring-2 ring-pink-400 ring-offset-1'
                            : ''
                        }`}
                        style={{
                          background:
                            color,
                        }}
                      />
                    ),
                  )}
                </div>
              </div>
            )}

          <div
            ref={stageRef}
            className="relative flex items-start justify-center overflow-auto rounded-xl border-2 border-[#68472D] bg-[#8A6039] p-3 md:p-6"
            style={{
              minHeight:
                isMobile
                  ? `min(62dvh, ${
                      Math.round(
                        BASE_HEIGHT *
                          zoom,
                      ) +
                      48
                    }px)`
                  : `min(72vh, ${
                      Math.round(
                        BASE_HEIGHT *
                          zoom,
                      ) +
                      60
                    }px)`,
              touchAction:
                'pan-x pan-y',
            }}
            onPointerDown={
              handleCanvasPointerDown
            }
            onPointerMove={
              handleCanvasPointerMove
            }
            onPointerUp={
              handleCanvasPointerUp
            }
            onPointerCancel={
              handleCanvasPointerUp
            }
            data-canvas-surface="true"
          >
            <div
              className="relative shrink-0"
              style={{
                width:
                  BASE_WIDTH *
                    zoom +
                  18,

                height:
                  BASE_HEIGHT *
                    zoom +
                  18,
              }}
            >
              <div className="pointer-events-none absolute inset-0 translate-x-2 translate-y-2 border-2 border-[#4A2F1D] bg-[#6A4226] shadow-[6px_7px_0_#3B2517,0_25px_30px_rgba(42,25,12,.32)]" />

              <div className="pointer-events-none absolute inset-y-2 left-0 z-30 w-5 border-r-2 border-dashed border-[#F2E2C7]" />

              <div
                ref={canvasRef}
                data-canvas-surface="true"
                className="relative shrink-0 origin-top-left touch-none overflow-hidden border-2 border-[#73583F] shadow-[inset_9px_0_13px_rgba(49,31,18,.18),inset_-4px_0_7px_rgba(49,31,18,.08)]"
                style={{
                  width:
                    BASE_WIDTH *
                    zoom,

                  height:
                    BASE_HEIGHT *
                    zoom,

                  background:
                    activeIsCover
                      ? doc.coverBackground
                      : activePage?.background ||
                        '#FFFDF8',

                  backgroundImage:
                    'repeating-linear-gradient(0deg, rgba(90,60,30,.04) 0, rgba(90,60,30,.04) 1px, transparent 1px, transparent 31px),repeating-linear-gradient(90deg, rgba(90,60,30,.012) 0, rgba(90,60,30,.012) 1px, transparent 1px, transparent 19px)',

                  touchAction:
                    'none',
                }}
              >
                {activeIsCover &&
                  doc.coverMediaUrl && (
                    <div className="pointer-events-none absolute inset-0 opacity-30">
                      {doc.coverMediaType ===
                      'video' ? (
                        <video
                          src={
                            doc.coverMediaUrl
                          }
                          muted
                          autoPlay
                          loop
                          playsInline
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={
                            doc.coverMediaUrl
                          }
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                  )}

                <div
                  className="absolute left-0 top-0"
                  style={{
                    width:
                      BASE_WIDTH,

                    height:
                      BASE_HEIGHT,

                    transform:
                      `scale(${zoom})`,

                    transformOrigin:
                      'top left',
                  }}
                >
                  {activeElements
                    .sort(
                      (
                        a,
                        b,
                      ) =>
                        a.z_index -
                        b.z_index,
                    )
                    .map(
                      (
                        element,
                      ) =>
                        renderElement(
                          element,
                        ),
                    )}
                </div>

                {guideState.vertical !==
                  null && (
                  <div
                    className="pointer-events-none absolute top-0 z-[90] w-px bg-pink-500"
                    style={{
                      left:
                        guideState.vertical *
                        zoom,
                      height:
                        BASE_HEIGHT *
                        zoom,
                    }}
                  />
                )}

                {guideState.horizontal !==
                  null && (
                  <div
                    className="pointer-events-none absolute left-0 z-[90] h-px bg-pink-500"
                    style={{
                      top:
                        guideState.horizontal *
                        zoom,
                      width:
                        BASE_WIDTH *
                        zoom,
                    }}
                  />
                )}

                <div className="pointer-events-none absolute inset-y-0 left-0 z-20 w-8 bg-gradient-to-r from-black/10 to-transparent" />

                <div
                  className="pointer-events-none absolute inset-0 z-20 opacity-30"
                  style={{
                    backgroundImage:
                      'radial-gradient(circle at 17% 24%,rgba(92,53,24,.22) 0 1px,transparent 2px),radial-gradient(circle at 72% 67%,rgba(92,53,24,.15) 0 1px,transparent 2px),repeating-linear-gradient(0deg,transparent 0,transparent 45px,rgba(120,75,35,.035) 46px,transparent 47px)',
                  }}
                />

                <div className="pointer-events-none absolute inset-y-0 left-2 z-30 w-[11px] border-r border-dashed border-[#EBD9BA]/80" />
              </div>
            </div>
          </div>

          <p className="mt-2 text-center text-[10px] text-[#F1DEC5]">
            {isMobile
              ? 'Drag with one finger · pinch + rotate with two fingers · pinch empty canvas to zoom'
              : 'Drag to move · corner handles resize · top handle rotates · Shift preserves ratio · Ctrl/Cmd-click multi-select'}
          </p>
        </section>

        <div className="hidden xl:block xl:order-3">
          {toolsAside}
        </div>

        {isMobile &&
          showTools && (
            <section className="order-2">
              {toolsAside}
            </section>
          )}

        {isMobile &&
          showPages && (
            <section className="order-2">
              {journalAside}
            </section>
          )}
      </div>

      {isMobile && (
        <nav className="fixed inset-x-0 bottom-0 z-50 border-t-2 border-[#604328] bg-[#EAD7BC] pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_0_rgba(58,36,20,.15)]">
          <div className="mx-auto grid max-w-md grid-cols-3">
            {[
              {
                id: 'canvas',
                label: 'Canvas',
                icon: (
                  <PenLine className="h-5 w-5" />
                ),
              },
              {
                id: 'tools',
                label: 'Tools',
                icon: (
                  <Sparkles className="h-5 w-5" />
                ),
              },
              {
                id: 'page',
                label: 'Page',
                icon: (
                  <span className="text-lg leading-none">
                    📖
                  </span>
                ),
              },
            ].map(
              (tab) => (
                <button
                  key={
                    tab.id
                  }
                  onClick={() =>
                    setMobileTab(
                      tab.id as MobileTab,
                    )
                  }
                  className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-bold ${
                    mobileTab ===
                    tab.id
                      ? 'text-[#8B3A56]'
                      : 'text-[#765D48]'
                  }`}
                >
                  {tab.icon}

                  {tab.label}

                  <span
                    className={`mt-0.5 h-1 w-8 rounded-full ${
                      mobileTab ===
                      tab.id
                        ? 'bg-[#8B3A56]'
                        : 'bg-transparent'
                    }`}
                  />
                </button>
              ),
            )}
          </div>
        </nav>
      )}

      {showPreview && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#24170F]/80 p-2 backdrop-blur-sm">
          <div className="flex h-full w-full max-w-6xl flex-col overflow-hidden border-2 border-[#4A2F1D] bg-[#B88C5A] shadow-2xl">
            <div className="flex items-center justify-between border-b-2 border-[#604328] bg-[#EAD7BC] p-3">
              <div className="min-w-0">
                <b className="font-serif text-base md:text-lg">
                  Book Preview
                </b>

                <span className="ml-2 text-xs text-[#765D48]">
                  {previewIndex ===
                  0
                    ? 'Cover'
                    : `Page ${previewIndex}`}
                </span>
              </div>

              <button
                onClick={() =>
                  setShowPreview(
                    false,
                  )
                }
                className="rounded border-2 border-[#76563A] bg-[#F6E9D5] p-2"
                aria-label="Close preview"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex flex-1 items-center justify-center overflow-auto p-4 md:p-5">
              <div
                className="relative"
                style={{
                  width:
                    previewStageWidth +
                    24,

                  height:
                    ((previewStageWidth +
                      24) *
                      BASE_HEIGHT) /
                    BASE_WIDTH,
                }}
              >
                <div className="absolute -inset-[9px] border-[6px] border-[#422817] bg-[#654021] shadow-[7px_8px_0_#332015,0_25px_35px_rgba(42,25,12,.38)]" />

                <div className="absolute -inset-6 -z-10 bg-[#704A2D]/35 shadow-[0_35px_40px_rgba(38,22,10,.45)]" />

                <div className="absolute inset-[5px] z-10 overflow-hidden border-2 border-[#6E5742] bg-[#EFE3D2] shadow-[inset_10px_0_12px_rgba(49,31,18,.20),inset_-4px_0_6px_rgba(49,31,18,.10)]">
                  <div className="pointer-events-none absolute inset-y-3 left-2 z-40 w-[13px] border-r-2 border-dashed border-[#EDE0CA]/90" />

                  <div
                    className="absolute inset-[7px] overflow-hidden border border-[#A18E79] bg-white"
                    style={{
                      background:
                        previewIndex ===
                        0
                          ? doc.coverBackground
                          : doc.pages[
                                previewIndex -
                                  1
                              ]?.background ||
                            '#FFFDF8',
                    }}
                  >
                    {previewIndex ===
                      0 &&
                      doc.coverMediaUrl && (
                        <div className="pointer-events-none absolute inset-0 opacity-80">
                          {doc.coverMediaType ===
                          'video' ? (
                            <video
                              src={
                                doc.coverMediaUrl
                              }
                              muted
                              autoPlay
                              loop
                              playsInline
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={
                                doc.coverMediaUrl
                              }
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          )}
                        </div>
                      )}

                    <div
                      className="absolute left-0 top-0"
                      style={{
                        width:
                          BASE_WIDTH,

                        height:
                          BASE_HEIGHT,

                        transform:
                          `scale(${previewScale})`,

                        transformOrigin:
                          'top left',
                      }}
                    >
                      {(
                        previewIndex ===
                        0
                          ? doc.coverElements
                          : doc.pages[
                              previewIndex -
                                1
                            ]?.elements ||
                            []
                      )
                        .sort(
                          (
                            a,
                            b,
                          ) =>
                            a.z_index -
                            b.z_index,
                        )
                        .map(
                          (
                            element,
                          ) =>
                            renderElement(
                              element,
                              false,
                            ),
                        )}
                    </div>

                    <div className="pointer-events-none absolute inset-y-0 left-0 z-30 w-8 bg-gradient-to-r from-black/10 to-transparent" />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between border-t-2 border-[#604328] bg-[#EAD7BC] p-3">
              <button
                disabled={
                  previewIndex ===
                  0
                }
                onClick={() =>
                  setPreviewIndex(
                    (index) =>
                      Math.max(
                        0,
                        index -
                          1,
                      ),
                  )
                }
                className="border-2 border-[#5D3D26] bg-[#F6E9D5] px-4 py-2.5 font-serif text-xs font-bold disabled:opacity-30"
              >
                ← Previous
              </button>

              <span className="font-serif text-xs font-bold text-[#765D48]">
                {previewIndex ===
                0
                  ? 'Cover'
                  : `Page ${previewIndex} / ${doc.pages.length}`}
              </span>

              <button
                disabled={
                  previewIndex ===
                  doc.pages.length
                }
                onClick={() =>
                  setPreviewIndex(
                    (index) =>
                      Math.min(
                        doc.pages.length,
                        index +
                          1,
                      ),
                  )
                }
                className="border-2 border-[#2E1B11] bg-[#3A2518] px-4 py-2.5 font-serif text-xs font-bold text-[#F5DCC0] disabled:opacity-30"
              >
                Next →
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="pointer-events-none fixed left-1/2 top-16 z-[120] w-full max-w-xs -translate-x-1/2 px-4">
          <div
            className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-lg ${
              toast.tone ===
              'success'
                ? 'bg-emerald-800/95'
                : 'bg-red-800/95'
            }`}
          >
            {toast.tone ===
            'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <X className="h-4 w-4 shrink-0" />
            )}

            <span className="min-w-0 break-words">
              {
                toast.message
              }
            </span>
          </div>
        </div>
      )}
    </main>
  );
}

function ResizeHandle({
  corner,
  inverseZoom,
  onStart,
}: {
  corner:
    | 'nw'
    | 'ne'
    | 'sw'
    | 'se';

  inverseZoom: number;

  onStart: (
    event: React.PointerEvent<HTMLDivElement>,
  ) => void;
}) {
  const position =
    {
      nw: {
        left:
          -14 *
          inverseZoom,
        top:
          -14 *
          inverseZoom,
      },

      ne: {
        right:
          -14 *
          inverseZoom,
        top:
          -14 *
          inverseZoom,
      },

      sw: {
        left:
          -14 *
          inverseZoom,
        bottom:
          -14 *
          inverseZoom,
      },

      se: {
        right:
          -14 *
          inverseZoom,
        bottom:
          -14 *
          inverseZoom,
      },
    }[corner];

  return (
    <div
      onPointerDown={
        onStart
      }
      className="absolute z-50 flex cursor-se-resize items-center justify-center rounded-full bg-pink-500 shadow ring-2 ring-white"
      style={{
        ...position,

        width:
          36 *
          inverseZoom,

        height:
          36 *
          inverseZoom,

        touchAction:
          'none',
      }}
      aria-label={`Resize ${corner}`}
    >
      <Maximize2
        className="text-white"
        style={{
          width:
            16 *
            inverseZoom,

          height:
            16 *
            inverseZoom,

          transform:
            corner ===
              'nw'
              ? 'rotate(180deg)'
              : corner ===
                  'ne'
                ? 'rotate(270deg)'
                : corner ===
                    'sw'
                  ? 'rotate(90deg)'
                  : undefined,
        }}
      />
    </div>
  );
}

function ToolButton({
  active,
  onClick,
  icon,
  label,
}: {
  active?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={
        onClick
      }
      className={`flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-semibold transition active:scale-95 ${
        active
          ? 'bg-[#2A211D] text-[#FFD2DE]'
          : 'bg-gray-100'
      }`}
    >
      {React.isValidElement(
        icon,
      )
        ? React.cloneElement(
            icon as React.ReactElement<{
              className?: string;
            }>,
            {
              className:
                'h-4 w-4',
            },
          )
        : icon}

      {label}
    </button>
  );
}
