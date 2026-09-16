'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowLeft, ArrowUp, Bold, CheckCircle2, Copy,
  Download, Eye, FileAudio, Home, Italic, Link2, Lock, Maximize2, MousePointer2, PenLine, Plus,
  RotateCcw, Save, Smile, Sparkles, StickyNote, Trash2, Type, Underline, Unlock, Undo2, Redo2,
  Upload, Video, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import {
  BASE_HEIGHT, BASE_WIDTH, emptyDocument, makeId, normalizeElement, normalizePage, safeJson,
  type CanvasElement, type JournalDocument, type JournalElementType, type JournalPageData,
} from '@/lib/editor/journalDocument';
import { useHistory, useHistoryShortcuts } from '@/lib/editor/history';
import { uploadFile } from '@/lib/storage/upload';
import { ICON_LIBRARY } from '@/lib/assets';
import StickerPicker from '@/components/pickers/StickerPicker';
import EmojiPicker from '@/components/pickers/EmojiPicker';
import GifPicker, { type GifItem } from '@/components/pickers/GifPicker';
import IconPicker, { IconGlyph } from '@/components/pickers/IconPicker';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 1.25;
const MOBILE_BP = 1024;

const FONT_OPTIONS = ['Georgia', 'Times New Roman', 'Garamond', 'Arial', 'Inter', 'Courier New', 'Comic Sans MS'];
const PAPER_COLORS = ['#FFFDF8', '#FFF7F8', '#FFF9E8', '#F8F3EA', '#F5F0E8', '#FDF5F0', '#F7F2FF', '#EEF7F2'];

type MobileTab = 'canvas' | 'tools' | 'page';
type ToolPanel = 'none' | 'stickers' | 'emoji' | 'gif' | 'icons';

/* ============================================================
   Element renderers (shared by canvas + preview)
   ============================================================ */

function ShapeView({ element }: { element: CanvasElement }) {
  const shape = element.shape || 'rectangle';
  const fill = element.fill || '#F6D5DF';
  const stroke = element.stroke || '#8B5260';
  const sw = element.stroke_width || 4;
  if (shape === 'circle' || shape === 'ellipse') return <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full"><ellipse cx="50" cy="50" rx="46" ry="46" fill={fill} stroke={stroke} strokeWidth={sw} vectorEffect="non-scaling-stroke" /></svg>;
  if (shape === 'triangle') return <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full"><polygon points="50,5 95,92 5,92" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" vectorEffect="non-scaling-stroke" /></svg>;
  if (shape === 'diamond') return <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full"><polygon points="50,4 96,50 50,96 4,50" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" vectorEffect="non-scaling-stroke" /></svg>;
  if (shape === 'star') return <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full"><polygon points="50,4 61,36 95,36 68,56 78,91 50,70 22,91 32,56 5,36 39,36" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" vectorEffect="non-scaling-stroke" /></svg>;
  if (shape === 'heart') return <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full"><path d="M50 88 C42 78 10 61 10 35 C10 16 31 7 50 25 C69 7 90 16 90 35 C90 61 58 78 50 88Z" fill={fill} stroke={stroke} strokeWidth={sw} vectorEffect="non-scaling-stroke" /></svg>;
  if (shape === 'line') return <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full"><line x1="8" y1="50" x2="92" y2="50" stroke={stroke} strokeWidth={sw} strokeLinecap="round" vectorEffect="non-scaling-stroke" /></svg>;
  if (shape === 'speech') return <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full"><path d="M12 15 Q12 8 20 8 H80 Q88 8 88 16 V64 Q88 72 80 72 H45 L28 91 V72 H20 Q12 72 12 64Z" fill={fill} stroke={stroke} strokeWidth={sw} vectorEffect="non-scaling-stroke" /></svg>;
  if (shape === 'cloud') return <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full"><path d="M20 70 C6 65 9 45 25 42 C25 24 45 16 58 30 C73 20 94 31 88 48 C101 55 95 74 80 74 H22Z" fill={fill} stroke={stroke} strokeWidth={sw} vectorEffect="non-scaling-stroke" /></svg>;
  if (shape === 'hexagon') return <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full"><polygon points="25,7 75,7 95,50 75,93 25,93 5,50" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" vectorEffect="non-scaling-stroke" /></svg>;
  return <div className="h-full w-full" style={{ background: fill, border: `${sw}px solid ${stroke}`, borderRadius: element.border_radius ?? 12 }} />;
}

interface Point { x: number; y: number; }

function DrawingEditor({ element, onChange }: { element: CanvasElement; onChange: (content: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useMemo(() => {
    const data = safeJson(element.content, { paths: [], color: '#2b2520', strokeWidth: 5 });
    return { paths: Array.isArray(data.paths) ? data.paths : [], color: data.color || '#2b2520', strokeWidth: Number(data.strokeWidth || 5) };
  }, [element.content]);
  const activePath = useRef<Point[] | null>(null);

  const redraw = useCallback((paths: Point[][]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    ctx.setTransform((ratio * rect.width) / 1000, 0, 0, (ratio * rect.height) / 1000, 0, 0);
    ctx.clearRect(0, 0, 1000, 1000);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = drawing.color;
    ctx.lineWidth = drawing.strokeWidth;
    paths.forEach((path) => {
      if (!path.length) return;
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      path.slice(1).forEach((pt) => ctx.lineTo(pt.x, pt.y));
      ctx.stroke();
    });
  }, [drawing.color, drawing.strokeWidth]);

  useEffect(() => {
    redraw(drawing.paths);
  }, [drawing.paths, redraw]);

  const point = (clientX: number, clientY: number, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    return { x: ((clientX - rect.left) / Math.max(rect.width, 1)) * 1000, y: ((clientY - rect.top) / Math.max(rect.height, 1)) * 1000 };
  };

  const start = (x: number, y: number) => {
    activePath.current = [point(x, y, canvasRef.current!)];
  };
  const move = (x: number, y: number) => {
    if (!activePath.current) return;
    activePath.current.push(point(x, y, canvasRef.current!));
    redraw([...drawing.paths, activePath.current]);
  };
  const end = () => {
    if (!activePath.current) return;
    const paths = [...drawing.paths, activePath.current];
    activePath.current = null;
    onChange(JSON.stringify({ ...drawing, paths }));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    start(e.clientX, e.clientY);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.stopPropagation();
    move(e.clientX, e.clientY);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.stopPropagation();
    end();
  };
  const onTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    e.stopPropagation();
    const t = e.touches[0];
    start(t.clientX, t.clientY);
  };
  const onTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const t = e.touches[0];
    move(t.clientX, t.clientY);
  };
  const onTouchEnd = (e: React.TouchEvent<HTMLCanvasElement>) => {
    e.stopPropagation();
    end();
  };

  return (
    <canvas
      ref={canvasRef}
      className="h-full w-full touch-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    />
  );
}

/* ============================================================
   The editor
   ============================================================ */

export default function JournalCanvasStudio() {
  const params = useParams();
  const router = useRouter();
  const journalId = params?.journalId as string;

  /* ---- history-managed document ---- */
  const [initialDoc, setInitialDoc] = useState<JournalDocument | null>(null);
  const history = useHistory<JournalDocument>(emptyDocument());
  const doc = initialDoc ? history.state : emptyDocument();
  const { setState, undo, redo, canUndo, canRedo, undoLabel, redoLabel, reset, markClean, dirty } = history;
  useHistoryShortcuts({ undo, redo, canUndo, canRedo });

  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  /* armed delete cancels itself whenever the selection changes */
  useEffect(() => {
    setConfirmDeleteId(null);
  }, [selectedElementId]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [canvasScale, setCanvasScale] = useState(1);
  const [zoom, setZoom] = useState(0.6);
  const [autoFit, setAutoFit] = useState(true);
  const [tool, setTool] = useState<'select' | 'draw'>('select');
  const [drawColor, setDrawColor] = useState('#2b2520');
  const [drawWidth, setDrawWidth] = useState(5);
  const [showPreview, setShowPreview] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [toolPanel, setToolPanel] = useState<ToolPanel>('none');
  const [deletedPageIds, setDeletedPageIds] = useState<string[]>([]);

  /* viewport */
  const [vw, setVw] = useState(1024);
  const [vh, setVh] = useState(800);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>('canvas');

  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((message: string, tone: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, tone });
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  useEffect(() => {
    const update = () => {
      setVw(window.innerWidth);
      setVh(window.innerHeight);
      setIsMobile(window.innerWidth < MOBILE_BP);
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  /* ---- load from the database once; history starts fresh ---- */
  useEffect(() => {
    if (!journalId) return;
    (async () => {
      setLoading(true);
      const [{ data: journal, error: journalError }, { data: fetchedPages, error: pagesError }] = await Promise.all([
        supabase.from('journals').select('*').eq('id', journalId).single(),
        supabase.from('journal_pages').select('*').eq('journal_id', journalId).order('page_number', { ascending: true }),
      ]);
      if (journalError) console.error(journalError);
      if (pagesError) console.error(pagesError);

      const nextDoc: JournalDocument = journal
        ? {
            title: journal.title || '',
            description: journal.description || journal.foreword || '',
            coverBackground: journal.background_color || '#FFF7F8',
            coverMediaType: journal.cover_media_type || journal.cover_type || 'image',
            coverMediaUrl: journal.cover_media_url || journal.cover_url || '',
            coverElements: (Array.isArray(journal.cover_elements) && journal.cover_elements.length
              ? journal.cover_elements.map((e: any, i: number) => normalizeElement(e, i))
              : journal.title
                ? [{ id: 'cover-title', type: 'text', content: journal.title, position_x: 180, position_y: 150, width: 440, height: 100, z_index: 2, font_size: 48, font_family: 'Georgia', color: '#6b332b', background: 'transparent', bold: true, text_align: 'center' } as CanvasElement]
                : []),
            pages: (fetchedPages || []).map(normalizePage),
          }
        : emptyDocument();

      setInitialDoc(nextDoc);
      reset(nextDoc, 'Loaded from database');
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journalId]);

  const activePageIndex = doc.pages.findIndex((p) => p.id === (doc as any).__activePageId) >= 0
    ? doc.pages.findIndex((p) => p.id === (doc as any).__activePageId)
    : -1;

  /* track active page OUTSIDE history (view state, not content) but persist
     selection per doc revision via a ref to avoid history pollution */
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const activeIsCover = activePageId === null;
  const activePage = doc.pages.find((p) => p.id === activePageId) || null;

  /* keep a valid selection target when switching pages */
  useEffect(() => {
    setSelectedElementId(null);
  }, [activePageId]);

  const activeElements: CanvasElement[] = activeIsCover ? doc.coverElements : activePage?.elements || [];

  /* keep canvasScale in sync with the rendered page element (drag math) */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const update = () => setCanvasScale((canvas.clientWidth || BASE_WIDTH) / BASE_WIDTH);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [loading, zoom, autoFit]);

  useEffect(() => {
    if (!autoFit) return;
    const availW = Math.max(200, vw - (isMobile ? 44 : 90));
    const availH = Math.max(240, vh - (isMobile ? 250 : 230));
    const fit = Math.min(availW / BASE_WIDTH, availH / BASE_HEIGHT);
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fit));
    setZoom((z) => (Math.abs(z - clamped) < 0.01 ? z : clamped));
  }, [autoFit, vw, vh, isMobile]);

  /* ============================================================
     Mutations — each one commits a labeled history entry.
     Drag/resize/typing pass a coalesceKey so they merge.
     ============================================================ */

  const updateDoc = setState;

  const mutateActiveElements = useCallback(
    (updater: (elements: CanvasElement[]) => CanvasElement[], label: string, coalesceKey?: string) => {
      updateDoc(
        (current) => {
          if (activeIsCover) {
            return { ...current, coverElements: updater(current.coverElements) };
          }
          return {
            ...current,
            pages: current.pages.map((p) => (p.id === activePageId ? { ...p, elements: updater(p.elements) } : p)),
          };
        },
        label,
        coalesceKey
      );
    },
    [activeIsCover, activePageId, updateDoc]
  );

  const selectedElement = activeElements.find((el) => el.id === selectedElementId) || null;

  const updateSelected = useCallback(
    (changes: Partial<CanvasElement>, label = 'Edit element', coalesceKey?: string) => {
      if (!selectedElementId) return;
      mutateActiveElements(
        (els) => els.map((el) => (el.id === selectedElementId ? { ...el, ...changes } : el)),
        label,
        coalesceKey
      );
    },
    [selectedElementId, mutateActiveElements]
  );

  const deleteSelected = () => {
    if (!selectedElementId) return;
    const el = selectedElement;
    mutateActiveElements((els) => els.filter((e) => e.id !== selectedElementId), `Delete ${el?.type || 'element'}`);
    setSelectedElementId(null);
  };

  const duplicateSelected = () => {
    if (!selectedElement) return;
    const copy: CanvasElement = {
      ...selectedElement,
      id: makeId('copy'),
      position_x: Math.min(BASE_WIDTH - selectedElement.width, selectedElement.position_x + 24),
      position_y: Math.min(BASE_HEIGHT - selectedElement.height, selectedElement.position_y + 24),
      z_index: activeElements.length + 1,
    };
    mutateActiveElements((els) => [...els, copy], 'Duplicate element');
    setSelectedElementId(copy.id);
  };

  const addElement = (type: JournalElementType, extra: Partial<CanvasElement> = {}, label = `Add ${type}`) => {
    const n = activeElements.length;
    const element: CanvasElement = {
      id: makeId(type),
      type,
      content: extra.content || (type === 'text' ? 'Write your memory here…' : ''),
      position_x: Math.min(50 + (n % 4) * 35, 520),
      position_y: Math.min(60 + Math.floor(n / 4) * 45, 820),
      width: type === 'sticker' ? 90 : type === 'drawing' ? 330 : type === 'link' ? 360 : type === 'gif' ? 260 : 330,
      height: type === 'sticker' ? 90 : type === 'drawing' ? 230 : type === 'link' ? 82 : type === 'gif' ? 200 : 180,
      z_index: n + 1,
      font_size: 26,
      font_family: 'Georgia',
      color: '#2b2520',
      background: type === 'text' ? 'rgba(255,255,255,0.68)' : 'transparent',
      text_align: 'left',
      border_radius: 12,
      ...(type === 'drawing' ? { content: JSON.stringify({ paths: [], color: drawColor, strokeWidth: drawWidth }) } : {}),
      ...(type === 'link' ? { href: 'https://', content: 'Open this link' } : {}),
      ...extra,
    };
    mutateActiveElements((els) => [...els, element], label);
    setSelectedElementId(element.id);
    setTool('select');
    if (isMobile) setMobileTab('canvas');
  };

  const addSticker = (value: string) => addElement('sticker', { content: value }, 'Add sticker');
  const addEmoji = (value: string) => addElement('sticker', { content: value }, 'Add emoji');
  const addIcon = (iconId: string) => addElement('icon', { content: iconId }, 'Add icon');
  const addGif = (gif: GifItem) =>
    addElement(
      'media',
      {
        content: gif.description || 'GIF',
        media_url: gif.url,
        media_type: 'image/gif',
        width: 260,
        height: Math.round((260 * gif.height) / Math.max(gif.width, 1)) || 200,
      },
      'Add GIF'
    );

  const addShape = (shape: string) => {
    const n = activeElements.length;
    const element: CanvasElement = {
      id: makeId('shape'),
      type: 'shape',
      content: JSON.stringify({ shape, fill: '#F6D5DF', stroke: '#8B5260', stroke_width: 4 }),
      position_x: Math.min(70 + (n % 3) * 45, 560),
      position_y: Math.min(80 + Math.floor(n / 3) * 50, 820),
      width: shape === 'line' ? 360 : 190,
      height: shape === 'line' ? 60 : 150,
      z_index: n + 1,
      fill: '#F6D5DF',
      stroke: '#8B5260',
      stroke_width: 4,
      border_radius: 12,
    };
    mutateActiveElements((els) => [...els, element], 'Add shape');
    setSelectedElementId(element.id);
  };

  /* ---- pages ---- */

  const addPage = () => {
    const number = doc.pages.length + 1;
    const page: JournalPageData = {
      id: makeId('temp-page'),
      page_number: number,
      title: `Page ${number}`,
      background: '#FFFDF8',
      width: BASE_WIDTH,
      height: BASE_HEIGHT,
      elements: [],
      created_at: new Date().toISOString(),
    };
    updateDoc((current) => ({ ...current, pages: [...current.pages, page] }), 'Add page');
    setActivePageId(page.id);
    setSelectedElementId(null);
  };

  const deletePage = () => {
    if (activeIsCover || !activePage) return;
    if (!activePage.id.startsWith('temp-page-')) {
      setDeletedPageIds((ids) => [...ids, activePage.id]);
    }
    updateDoc(
      (current) => ({
        ...current,
        pages: current.pages.filter((p) => p.id !== activePage.id).map((p, i) => ({ ...p, page_number: i + 1 })),
      }),
      'Delete page'
    );
    setActivePageId(null);
    setSelectedElementId(null);
  };

  const duplicatePage = () => {
    if (activeIsCover || !activePage) return;
    const page: JournalPageData = {
      ...activePage,
      id: makeId('temp-page'),
      page_number: doc.pages.length + 1,
      title: `${activePage.title} copy`,
      elements: activePage.elements.map((e) => ({ ...e, id: makeId('copy') })),
    };
    updateDoc((current) => ({ ...current, pages: [...current.pages, page] }), 'Duplicate page');
    setActivePageId(page.id);
    setSelectedElementId(null);
  };

  const movePage = (direction: -1 | 1) => {
    if (activeIsCover || !activePage) return;
    updateDoc((current) => {
      const idx = current.pages.findIndex((p) => p.id === activePage.id);
      const target = idx + direction;
      if (idx < 0 || target < 0 || target >= current.pages.length) return current;
      const pages = [...current.pages];
      [pages[idx], pages[target]] = [pages[target], pages[idx]];
      return { ...current, pages: pages.map((p, i) => ({ ...p, page_number: i + 1 })) };
    }, 'Reorder pages');
  };

  /* ---- cover media ---- */

  const setCoverMedia = (kind: string, url: string) => {
    updateDoc((current) => ({ ...current, coverMediaType: kind, coverMediaUrl: url }), 'Cover media');
  };

  /* ---- layer controls ---- */

  const bringForward = () =>
    selectedElement && updateSelected({ z_index: Math.max(...activeElements.map((e) => e.z_index), 0) + 1 }, 'Bring forward');
  const sendBackward = () =>
    selectedElement && updateSelected({ z_index: Math.max(1, selectedElement.z_index - 1) }, 'Send backward');

  const rotate = (delta: number) =>
    selectedElement && updateSelected({ rotation: (selectedElement.rotation || 0) + delta }, 'Rotate', `rotate-${selectedElement.id}`);

  /* ---- uploads ---- */

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !journalId) return;
    setUploadingFile(true);
    try {
      /* journal-media is a private bucket owned by the uploader's user folder */
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in.');
      const upload = await uploadFile(file, 'journal-media', user.id);
      const mediaType = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'image';
      addElement(
        'media',
        { content: file.name, media_url: upload.url, media_type: mediaType, object_fit: 'cover' },
        'Add media'
      );
      showToast('Media added to the page');
    } catch (error: any) {
      showToast(`Upload failed: ${error.message || error}`, 'error');
    } finally {
      setUploadingFile(false);
    }
  };

  /* ---- drag / resize (coalesced history via commit key) ---- */

  const startDrag = (e: React.PointerEvent | React.MouseEvent, el: CanvasElement) => {
    if (tool !== 'select' || el.locked) return;
    e.stopPropagation();
    const isTouch = 'pointerType' in e && e.pointerType === 'touch';
    if (!isTouch && 'pointerId' in e) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setSelectedElementId(el.id);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dragKey = `drag-${el.id}`;
    const bounds = { x: el.position_x, y: el.position_y };
    const last = { x: e.clientX, y: e.clientY };
    const clamp = () => {
      bounds.x = Math.max(0, Math.min(BASE_WIDTH - el.width, bounds.x));
      bounds.y = Math.max(0, Math.min(BASE_HEIGHT - el.height, bounds.y));
    };
    const apply = () =>
      mutateActiveElements(
        (els) => els.map((item) => (item.id === el.id ? { ...item, position_x: bounds.x, position_y: bounds.y } : item)),
        'Move element',
        dragKey
      );
    const move = (dx: number, dy: number) => {
      bounds.x += dx / canvasScale;
      bounds.y += dy / canvasScale;
      clamp();
      apply();
    };
    const onPointerMove = (ev: PointerEvent) => {
      move(ev.clientX - last.x, ev.clientY - last.y);
      last.x = ev.clientX;
      last.y = ev.clientY;
    };
    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
    const onMouseMove = (ev: MouseEvent) => {
      move(ev.clientX - last.x, ev.clientY - last.y);
      last.x = ev.clientX;
      last.y = ev.clientY;
    };
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    const onTouchMove = (ev: TouchEvent) => {
      ev.preventDefault();
      const t = ev.touches[0];
      move(t.clientX - last.x, t.clientY - last.y);
      last.x = t.clientX;
      last.y = t.clientY;
    };
    const onTouchEnd = () => {
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
    if (isTouch) {
      window.addEventListener('touchmove', onTouchMove, { passive: false });
      window.addEventListener('touchend', onTouchEnd);
    } else {
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    }
  };

  const startResize = (e: React.PointerEvent | React.MouseEvent, el: CanvasElement) => {
    if (el.locked) return;
    e.stopPropagation();
    const isTouch = 'pointerType' in e && e.pointerType === 'touch';
    if (!isTouch && 'pointerId' in e) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const size = { w: el.width, h: el.height };
    const last = { x: e.clientX, y: e.clientY };
    const resizeKey = `resize-${el.id}`;
    const apply = () =>
      mutateActiveElements(
        (els) => els.map((item) => (item.id === el.id ? { ...item, width: size.w, height: size.h } : item)),
        'Resize element',
        resizeKey
      );
    const move = (dx: number, dy: number) => {
      size.w = Math.max(50, Math.min(BASE_WIDTH - el.position_x, size.w + dx / canvasScale));
      size.h = Math.max(50, Math.min(BASE_HEIGHT - el.position_y, size.h + dy / canvasScale));
      apply();
    };
    const onPointerMove = (ev: PointerEvent) => {
      move(ev.clientX - last.x, ev.clientY - last.y);
      last.x = ev.clientX;
      last.y = ev.clientY;
    };
    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
    const onMouseMove = (ev: MouseEvent) => {
      move(ev.clientX - last.x, ev.clientY - last.y);
      last.x = ev.clientX;
      last.y = ev.clientY;
    };
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    const onTouchMove = (ev: TouchEvent) => {
      ev.preventDefault();
      const t = ev.touches[0];
      move(t.clientX - last.x, t.clientY - last.y);
      last.x = t.clientX;
      last.y = t.clientY;
    };
    const onTouchEnd = () => {
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
    if (isTouch) {
      window.addEventListener('touchmove', onTouchMove, { passive: false });
      window.addEventListener('touchend', onTouchEnd);
    } else {
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    }
  };

  /* ============================================================
     SAVE + AUTOSAVE (debounced 2.5s after any change)
     ============================================================ */

  const saveAll = useCallback(
    async (silent = false) => {
      if (!journalId) return;
      if (!silent) setSaving(true);
      try {
        const { error: journalError } = await supabase
          .from('journals')
          .update({
            title: doc.title,
            description: doc.description,
            foreword: doc.description,
            background_color: doc.coverBackground,
            cover_media_type: doc.coverMediaType,
            cover_type: doc.coverMediaType,
            cover_media_url: doc.coverMediaUrl || null,
            cover_url: doc.coverMediaUrl || null,
            cover_elements: doc.coverElements,
          })
          .eq('id', journalId);
        if (journalError) throw journalError;

        if (deletedPageIds.length) {
          const { error } = await supabase.from('journal_pages').delete().in('id', deletedPageIds);
          if (error) throw error;
        }

        for (let index = 0; index < doc.pages.length; index++) {
          const page = doc.pages[index];
          const payload = {
            journal_id: journalId,
            page_number: index + 1,
            title: page.title || `Page ${index + 1}`,
            background: page.background || '#FFFDF8',
            width: BASE_WIDTH,
            height: BASE_HEIGHT,
            media_type: page.elements.find((el) => el.type === 'media')?.media_type || 'image',
            media_url: page.elements.find((el) => el.type === 'media')?.media_url || null,
            stickers: page.elements.filter((el) => el.type === 'sticker').map((el) => el.content),
            elements: page.elements,
          };
          if (page.id.startsWith('temp-page-')) {
            const { data, error } = await supabase.from('journal_pages').insert(payload).select('id').maybeSingle();
            if (error) throw error;
            /* swap temp id → real id locally (no history entry) */
            if (data?.id) {
              const realId = (data as any).id as string;
              updateDocSilent(page.id, realId);
            }
          } else {
            const { error } = await supabase.from('journal_pages').update(payload).eq('id', page.id);
            if (error) throw error;
          }
        }
        setDeletedPageIds([]);
        setLastSavedAt(new Date());
        markClean();
        if (!silent) showToast('Journal saved ✨');
      } catch (error: any) {
        if (!silent) showToast(`Error saving journal: ${error.message || error}`, 'error');
      } finally {
        if (!silent) setSaving(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [journalId, doc, deletedPageIds, markClean]
  );

  /* silent local id swap for freshly inserted pages (keeps history intact) */
  const updateDocSilent = (tempId: string, realId: string) => {
    setState(
      (current) => ({
        ...current,
        pages: current.pages.map((p) => (p.id === tempId ? { ...p, id: realId } : p)),
      }),
      'Sync page id',
      `sync-${tempId}`
    );
    setActivePageId((cur) => (cur === tempId ? realId : cur));
  };

  /* autosave: 2.5s after the last change */
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!initialDoc || !dirty) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => saveAll(true), 2500);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [doc, dirty, initialDoc, saveAll]);

  /* warn before leaving with unsaved changes */
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  /* ============================================================
     RENDER
     ============================================================ */

  const renderElement = (el: CanvasElement, interactive = true) => {
    const selected = interactive && selectedElementId === el.id;
    const style: React.CSSProperties = {
      left: el.position_x,
      top: el.position_y,
      width: el.width,
      height: el.height,
      zIndex: el.z_index,
      opacity: el.opacity ?? 1,
      transform: `rotate(${el.rotation || 0}deg)`,
      borderRadius: el.border_radius ?? 12,
    };
    return (
      <div
        key={el.id}
        onPointerDown={interactive ? (e) => startDrag(e, el) : undefined}
        onClick={interactive ? (e) => { e.stopPropagation(); setSelectedElementId(el.id); } : undefined}
        className={`absolute ${interactive ? 'cursor-move' : ''} ${selected ? 'ring-2 ring-pink-500 ring-offset-2' : ''}`}
        style={style}
      >
        {el.type === 'text' && (interactive ? (
          <textarea
            value={el.content}
            onChange={(e) => updateSelected({ content: e.target.value }, 'Edit text', `text-${el.id}`)}
            onPointerDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            data-history-scoped="true"
            className="h-full w-full resize-none border-0 outline-none focus:ring-0"
            placeholder="Write your memory…"
            style={{ fontFamily: el.font_family, fontSize: el.font_size, color: el.color, background: el.background, textAlign: el.text_align, fontWeight: el.bold ? 700 : 400, fontStyle: el.italic ? 'italic' : 'normal', textDecoration: el.underline ? 'underline' : 'none', padding: 14, lineHeight: 1.25 }}
          />
        ) : (
          <div className="h-full w-full overflow-hidden whitespace-pre-wrap" style={{ fontFamily: el.font_family, fontSize: el.font_size, color: el.color, background: el.background, textAlign: el.text_align, fontWeight: el.bold ? 700 : 400, fontStyle: el.italic ? 'italic' : 'normal', textDecoration: el.underline ? 'underline' : 'none', padding: 14, lineHeight: 1.25 }}>{el.content}</div>
        ))}

        {el.type === 'media' && el.media_url && (
          <div className="h-full w-full overflow-hidden bg-white/80" style={{ borderRadius: el.border_radius ?? 12 }}>
            {el.media_type === 'video' ? (
              <video onPointerDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()} src={el.media_url} controls playsInline className="h-full w-full" style={{ objectFit: el.object_fit }} />
            ) : el.media_type === 'audio' ? (
              <div className="flex h-full flex-col justify-center gap-2 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold"><FileAudio className="h-5 w-5" /> {el.content}</div>
                <audio onPointerDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()} src={el.media_url} controls className="w-full" />
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={el.media_url} alt={el.content} className="h-full w-full" style={{ objectFit: el.object_fit }} draggable={false} />
            )}
          </div>
        )}

        {el.type === 'gif' && el.media_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={el.media_url} alt={el.content || 'GIF'} className="h-full w-full object-cover" draggable={false} />
        )}

        {el.type === 'icon' && (
          <div className="flex h-full w-full select-none items-center justify-center" style={{ color: el.color || '#2b2520' }}>
            <IconGlyph iconId={el.content} className="h-[72%] w-[72%]" />
          </div>
        )}

        {el.type === 'link' && (
          <a href={el.href || el.content} target="_blank" rel="noreferrer" onPointerDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()} onClick={(e) => interactive && e.preventDefault()} className="flex h-full w-full items-center gap-3 border border-blue-200 bg-blue-50/80 p-4 text-blue-800 shadow-sm">
            <Link2 className="h-6 w-6 shrink-0" />
            <span className="min-w-0 break-words text-sm font-semibold">{el.content || el.href}</span>
          </a>
        )}

        {el.type === 'sticker' && (
          <div className="flex h-full w-full select-none items-center justify-center" style={{ fontSize: Math.min(el.width, el.height) * 0.72 }}>{el.content}</div>
        )}

        {el.type === 'drawing' && (
          <div onPointerDown={(e) => { e.stopPropagation(); setSelectedElementId(el.id); }} onTouchStart={(e) => e.stopPropagation()} className="h-full w-full overflow-hidden bg-transparent">
            <DrawingEditor element={el} onChange={(content) => updateSelected({ content }, 'Draw', `draw-${el.id}`)} />
          </div>
        )}

        {el.type === 'shape' && <div className="h-full w-full"><ShapeView element={el} /></div>}

        {selected && (
          <>
            <div onPointerDown={(e) => startDrag(e, el)} className="absolute left-1/2 top-1 z-30 -translate-x-1/2 cursor-move rounded-full border border-white/80 bg-[#2A211D]/85 px-3 py-1 text-[10px] font-bold text-white shadow">⠿ drag</div>
            {/* Delete: 36px+ touch target, offset clear of the resize handle and
                the element body, hover rings on desktop, and a two-step
                confirm (tap turns it into "Confirm?"; second tap or a stray
                tap elsewhere cancels) so a stray tap cannot destroy work. */}
            {confirmDeleteId === el.id ? (
              <span className="absolute -top-11 right-0 z-40 flex items-center gap-1 rounded-xl bg-red-600 p-1 shadow-lg">
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); deleteSelected(); setConfirmDeleteId(null); }}
                  className="min-h-[36px] rounded-lg bg-white/15 px-3 text-xs font-bold text-white"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-white"
                  aria-label="Cancel delete"
                >
                  <X className="h-4 w-4" />
                </button>
              </span>
            ) : (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(el.id); }}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-red-500 shadow transition hover:ring-2 hover:ring-red-300"
                aria-label="Delete element (tap again to confirm)"
                title="Delete element"
              >
                <Trash2 className="h-4.5 w-4.5" />
              </button>
            )}
            <div onPointerDown={(e) => startResize(e, el)} className="absolute -bottom-3 -right-3 flex h-9 w-9 cursor-se-resize touch-manipulation items-center justify-center rounded-full bg-pink-500 shadow ring-2 ring-white"><Maximize2 className="h-4 w-4 text-white" /></div>
          </>
        )}
      </div>
    );
  };

  const previewStageWidth = isMobile ? Math.max(240, Math.min(vw - 56, 430)) : 430;
  const previewScale = previewStageWidth / BASE_WIDTH;

  if (loading || !initialDoc) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#B88C5A] font-serif text-[#3C2819]">Loading Journal Studio…</div>
    );
  }

  const showCanvas = !isMobile || mobileTab === 'canvas';
  const showTools = !isMobile || mobileTab === 'tools';
  const showPages = !isMobile || mobileTab === 'page';

  const journalAside = (
    <aside className="rounded-2xl border border-[#D8C9BA] bg-[#FFFDF9] p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between"><h2 className="font-serif font-bold">Journal</h2><span className="text-lg">📖</span></div>
      <div className="space-y-3">
        <label className="block text-xs font-semibold">Title
          <input value={doc.title} onChange={(e) => updateDoc((c) => ({ ...c, title: e.target.value }), 'Edit title', 'doc-title')} data-history-scoped="true" className="mt-1 w-full rounded-lg border bg-white p-2 text-sm" />
        </label>
        <label className="block text-xs font-semibold">Foreword / description
          <textarea value={doc.description} onChange={(e) => updateDoc((c) => ({ ...c, description: e.target.value }), 'Edit description', 'doc-desc')} data-history-scoped="true" className="mt-1 h-24 w-full resize-none rounded-lg border bg-white p-2 text-sm" />
        </label>
        <label className="block text-xs font-semibold">Cover paper
          <input type="color" value={doc.coverBackground} onChange={(e) => updateDoc((c) => ({ ...c, coverBackground: e.target.value }), 'Cover color', 'doc-coverbg')} className="mt-1 h-10 w-full rounded-lg border p-1" />
        </label>
        <label className="block text-xs font-semibold">Cover image / video
          <input type="file" accept="image/*,video/*" onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setUploadingFile(true);
            (async () => {
              try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) throw new Error('Not signed in.');
                const upload = await uploadFile(file, 'journal-media', user.id);
                setCoverMedia(file.type.startsWith('video/') ? 'video' : 'image', upload.url);
                showToast('Cover media updated');
              } catch (err: any) {
                showToast(`Upload failed: ${err.message || err}`, 'error');
              } finally {
                setUploadingFile(false);
              }
            })();
          }} className="mt-1 w-full text-xs" />
        </label>
      </div>
      <div className="mt-5 border-t pt-3">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">Pages</h3>
        <div className="max-h-64 space-y-1 overflow-y-auto">
          <button onClick={() => { setActivePageId(null); setSelectedElementId(null); }} className={`w-full rounded-lg px-2 py-2.5 text-left text-xs ${activeIsCover ? 'bg-pink-100 font-bold text-pink-800' : 'hover:bg-gray-100'}`}>📖 Cover</button>
          {doc.pages.map((p, i) => (
            <button key={p.id} onClick={() => { setActivePageId(p.id); setSelectedElementId(null); }} className={`w-full rounded-lg px-2 py-2.5 text-left text-xs ${!activeIsCover && activePageId === p.id ? 'bg-[#2A211D] font-bold text-[#FFD2DE]' : 'hover:bg-gray-100'}`}>
              Page {i + 1} · {p.title || 'Untitled'}
            </button>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <button onClick={addPage} className="rounded-lg bg-[#2A211D] px-2 py-2.5 text-xs font-bold text-[#FFD2DE]"><Plus className="mr-1 inline h-3.5 w-3.5" /> New</button>
          <button onClick={duplicatePage} disabled={activeIsCover} className="rounded-lg border px-2 py-2.5 text-xs disabled:opacity-40"><Copy className="mr-1 inline h-3.5 w-3.5" /> Copy</button>
        </div>
        {!activeIsCover && (
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <button onClick={() => movePage(-1)} disabled={doc.pages.findIndex((p) => p.id === activePageId) <= 0} className="rounded-lg border px-2 py-2 text-xs disabled:opacity-40"><ArrowUp className="mr-1 inline h-3 w-3" /> Earlier</button>
            <button onClick={() => movePage(1)} disabled={doc.pages.findIndex((p) => p.id === activePageId) >= doc.pages.length - 1} className="rounded-lg border px-2 py-2 text-xs disabled:opacity-40"><ArrowDown className="mr-1 inline h-3 w-3" /> Later</button>
          </div>
        )}
        {!activeIsCover && <button onClick={deletePage} className="mt-1.5 w-full rounded-lg border border-red-200 px-2 py-2.5 text-xs text-red-500"><Trash2 className="mr-1 inline h-3.5 w-3.5" /> Delete page</button>}
      </div>
    </aside>
  );

  const toolsAside = (
    <aside className="rounded-2xl border border-[#D8C9BA] bg-[#FFFDF9] p-3 shadow-sm">
      <h2 className="mb-3 font-serif font-bold">Scrapbook tools</h2>

      {/* picker tabs */}
      <div className="mb-3 grid grid-cols-4 gap-1">
        <button onClick={() => setToolPanel(toolPanel === 'stickers' ? 'none' : 'stickers')} className={`rounded-lg border p-2 text-[10px] font-bold ${toolPanel === 'stickers' ? 'bg-[#2A211D] text-[#FFD2DE]' : 'bg-white'}`}><Sparkles className="mx-auto h-4 w-4" /> Stickers</button>
        <button onClick={() => setToolPanel(toolPanel === 'emoji' ? 'none' : 'emoji')} className={`rounded-lg border p-2 text-[10px] font-bold ${toolPanel === 'emoji' ? 'bg-[#2A211D] text-[#FFD2DE]' : 'bg-white'}`}><Smile className="mx-auto h-4 w-4" /> Emoji</button>
        <button onClick={() => setToolPanel(toolPanel === 'gif' ? 'none' : 'gif')} className={`rounded-lg border p-2 text-[10px] font-bold ${toolPanel === 'gif' ? 'bg-[#2A211D] text-[#FFD2DE]' : 'bg-white'}`}>GIF</button>
        <button onClick={() => setToolPanel(toolPanel === 'icons' ? 'none' : 'icons')} className={`rounded-lg border p-2 text-[10px] font-bold ${toolPanel === 'icons' ? 'bg-[#2A211D] text-[#FFD2DE]' : 'bg-white'}`}><StickyNote className="mx-auto h-4 w-4" /> Icons</button>
      </div>

      {toolPanel === 'stickers' && (
        <div className="mb-3 max-h-72 overflow-hidden rounded-xl border bg-white">
          <StickerPicker onPick={(v) => addSticker(v)} />
        </div>
      )}
      {toolPanel === 'emoji' && (
        <div className="mb-3 max-h-72 overflow-hidden rounded-xl border bg-white">
          <EmojiPicker onPick={(v) => addEmoji(v)} />
        </div>
      )}
      {toolPanel === 'gif' && (
        <div className="mb-3 max-h-80 overflow-hidden rounded-xl border bg-white">
          <GifPicker onPick={addGif} />
        </div>
      )}
      {toolPanel === 'icons' && (
        <div className="mb-3 max-h-72 overflow-hidden rounded-xl border bg-white">
          <IconPicker onPick={addIcon} />
        </div>
      )}

      <div className="mb-4 rounded-xl border bg-[#FAF5EF] p-2">
        <div className="mb-2 flex items-center justify-between"><span className="text-xs font-bold">Shapes</span><span className="text-[10px] text-gray-400">tap to insert</span></div>
        <div className="grid grid-cols-4 gap-1.5">
          {['rectangle', 'circle', 'triangle', 'diamond', 'star', 'heart', 'line', 'speech', 'cloud', 'hexagon'].map((shape) => <button key={shape} title={shape} onClick={() => addShape(shape)} className="rounded-lg border bg-white p-2.5 text-[10px] font-semibold capitalize transition hover:bg-pink-50 active:scale-95">{shape}</button>)}
        </div>
      </div>

      <div className="mb-4 rounded-xl border bg-[#FAF5EF] p-2">
        <div className="mb-2 text-xs font-bold">Drawing</div>
        <div className="flex items-center gap-2">
          <input type="color" value={drawColor} onChange={(e) => setDrawColor(e.target.value)} className="h-10 w-10 rounded border p-0.5" aria-label="Drawing color" />
          <select value={drawWidth} onChange={(e) => setDrawWidth(Number(e.target.value))} className="flex-1 rounded-lg border bg-white p-2.5 text-xs" aria-label="Pen size">
            <option value="2">Fine pen</option><option value="5">Pen</option><option value="9">Marker</option><option value="16">Brush</option>
          </select>
        </div>
        <button onClick={() => addElement('drawing')} className="mt-2 w-full rounded-lg border bg-white px-2 py-2.5 text-xs font-bold"><PenLine className="mr-1 inline h-4 w-4" /> Add sketch area</button>
      </div>

      {selectedElement ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold">Selected: {selectedElement.type}</span>
            <button onClick={() => updateSelected({ locked: !selectedElement.locked }, selectedElement.locked ? 'Unlock element' : 'Lock element')} className="rounded-lg border p-2" aria-label={selectedElement.locked ? 'Unlock element' : 'Lock element'}>
              {selectedElement.locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(['position_x', 'position_y', 'width', 'height'] as const).map((f) => (
              <label key={f} className="text-[10px] font-semibold text-gray-500">{f.replace('_', ' ')}
                <input type="number" inputMode="numeric" value={Math.round(selectedElement[f])} onChange={(e) => updateSelected({ [f]: Number(e.target.value) } as Partial<CanvasElement>, `Edit ${f}`, `pos-${selectedElement.id}-${f}`)} className="mt-1 w-full rounded border bg-white p-2 text-xs" />
              </label>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <button onClick={() => rotate(-5)} className="rounded border p-2.5" title="Rotate left"><RotateCcw className="mx-auto h-4 w-4" /></button>
            <button onClick={() => rotate(5)} className="rounded border p-2.5 text-xs font-bold">+5°</button>
            <button onClick={bringForward} className="rounded border p-2.5 text-[10px] font-bold">Front</button>
          </div>
          <button onClick={sendBackward} className="w-full rounded border p-2.5 text-[10px] font-bold">Send backward</button>
          <label className="block text-[10px] font-semibold text-gray-500">Rotation
            <input type="range" min={-180} max={180} value={selectedElement.rotation || 0} onChange={(e) => updateSelected({ rotation: Number(e.target.value) }, 'Rotate', `rotslider-${selectedElement.id}`)} className="mt-1 w-full" />
          </label>
          <label className="block text-[10px] font-semibold text-gray-500">Opacity
            <input type="range" min={10} max={100} value={Math.round((selectedElement.opacity ?? 1) * 100)} onChange={(e) => updateSelected({ opacity: Number(e.target.value) / 100 }, 'Opacity', `op-${selectedElement.id}`)} className="mt-1 w-full" />
          </label>

          {selectedElement.type === 'text' && (
            <div className="space-y-2 border-t pt-2">
              <div className="grid grid-cols-2 gap-1.5">
                <select value={selectedElement.font_family} onChange={(e) => updateSelected({ font_family: e.target.value }, 'Change font')} className="rounded border p-2.5 text-xs">{FONT_OPTIONS.map((f) => <option key={f}>{f}</option>)}</select>
                <input type="number" inputMode="numeric" min={8} max={120} value={selectedElement.font_size} onChange={(e) => updateSelected({ font_size: Number(e.target.value) }, 'Font size', `fs-${selectedElement.id}`)} className="rounded border p-2.5 text-xs" />
              </div>
              <div className="flex gap-1">
                <button onClick={() => updateSelected({ bold: !selectedElement.bold }, 'Bold')} className={`flex-1 rounded border p-2.5 ${selectedElement.bold ? 'bg-gray-200' : ''}`}><Bold className="mx-auto h-4 w-4" /></button>
                <button onClick={() => updateSelected({ italic: !selectedElement.italic }, 'Italic')} className={`flex-1 rounded border p-2.5 ${selectedElement.italic ? 'bg-gray-200' : ''}`}><Italic className="mx-auto h-4 w-4" /></button>
                <button onClick={() => updateSelected({ underline: !selectedElement.underline }, 'Underline')} className={`flex-1 rounded border p-2.5 ${selectedElement.underline ? 'bg-gray-200' : ''}`}><Underline className="mx-auto h-4 w-4" /></button>
                <button onClick={() => updateSelected({ text_align: 'left' }, 'Align left')} className="flex-1 rounded border p-2.5"><AlignLeft className="mx-auto h-4 w-4" /></button>
                <button onClick={() => updateSelected({ text_align: 'center' }, 'Align center')} className="flex-1 rounded border p-2.5"><AlignCenter className="mx-auto h-4 w-4" /></button>
                <button onClick={() => updateSelected({ text_align: 'right' }, 'Align right')} className="flex-1 rounded border p-2.5"><AlignRight className="mx-auto h-4 w-4" /></button>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex-1 text-[10px] font-semibold">Ink<input type="color" value={selectedElement.color || '#2b2520'} onChange={(e) => updateSelected({ color: e.target.value }, 'Text color', `color-${selectedElement.id}`)} className="mt-1 h-9 w-full rounded border p-1" /></label>
                <label className="flex-1 text-[10px] font-semibold">Paper<input type="color" value={selectedElement.background === 'transparent' ? '#ffffff' : selectedElement.background?.startsWith('#') ? selectedElement.background : '#ffffff'} onChange={(e) => updateSelected({ background: e.target.value }, 'Element background', `bg-${selectedElement.id}`)} className="mt-1 h-9 w-full rounded border p-1" /></label>
              </div>
            </div>
          )}
          {selectedElement.type === 'media' && (
            <div className="space-y-2 border-t pt-2">
              <label className="text-xs font-semibold">Fit
                <select value={selectedElement.object_fit} onChange={(e) => updateSelected({ object_fit: e.target.value as 'cover' | 'contain' }, 'Media fit')} className="mt-1 w-full rounded border p-2.5 text-xs"><option value="cover">Crop / fill</option><option value="contain">Show whole media</option></select>
              </label>
            </div>
          )}
          {selectedElement.type === 'link' && (
            <div className="space-y-2 border-t pt-2">
              <label className="text-xs font-semibold">Label<input value={selectedElement.content} onChange={(e) => updateSelected({ content: e.target.value }, 'Link label', `ll-${selectedElement.id}`)} className="mt-1 w-full rounded border p-2.5 text-xs" /></label>
              <label className="text-xs font-semibold">URL<input value={selectedElement.href || ''} onChange={(e) => updateSelected({ href: e.target.value }, 'Link URL', `lu-${selectedElement.id}`)} className="mt-1 w-full rounded border p-2.5 text-xs" placeholder="https://…" inputMode="url" /></label>
            </div>
          )}
          {selectedElement.type === 'shape' && (
            <div className="space-y-2 border-t pt-2">
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10px] font-semibold">Fill<input type="color" value={selectedElement.fill || '#F6D5DF'} onChange={(e) => updateSelected({ fill: e.target.value, content: JSON.stringify({ shape: selectedElement.shape || 'rectangle', fill: e.target.value, stroke: selectedElement.stroke || '#8B5260', stroke_width: selectedElement.stroke_width || 4 }) }, 'Shape fill', `sf-${selectedElement.id}`)} className="mt-1 h-9 w-full rounded border p-1" /></label>
                <label className="text-[10px] font-semibold">Outline<input type="color" value={selectedElement.stroke || '#8B5260'} onChange={(e) => updateSelected({ stroke: e.target.value, content: JSON.stringify({ shape: selectedElement.shape || 'rectangle', fill: selectedElement.fill || '#F6D5DF', stroke: e.target.value, stroke_width: selectedElement.stroke_width || 4 }) }, 'Shape outline', `so-${selectedElement.id}`)} className="mt-1 h-9 w-full rounded border p-1" /></label>
              </div>
              <label className="text-[10px] font-semibold">Outline width<input type="range" min={1} max={14} value={selectedElement.stroke_width || 4} onChange={(e) => updateSelected({ stroke_width: Number(e.target.value) }, 'Outline width', `sw-${selectedElement.id}`)} className="mt-1 w-full" /></label>
            </div>
          )}
          {selectedElement.type === 'drawing' && (
            <div className="space-y-2 border-t pt-2">
              <div className="text-xs font-semibold">Sketch settings</div>
              <div className="flex items-center gap-2">
                <input type="color" value={safeJson(selectedElement.content, { color: '#2b2520' }).color || '#2b2520'} onChange={(e) => { const d = safeJson(selectedElement.content, { paths: [], color: '#2b2520', strokeWidth: 5 }); updateSelected({ content: JSON.stringify({ ...d, color: e.target.value }) }, 'Drawing color', `dc-${selectedElement.id}`); }} className="h-10 w-10 rounded border p-0.5" aria-label="Drawing color" />
                <select value={Number(safeJson(selectedElement.content, { strokeWidth: 5 }).strokeWidth || 5)} onChange={(e) => { const d = safeJson(selectedElement.content, { paths: [], color: '#2b2520', strokeWidth: 5 }); updateSelected({ content: JSON.stringify({ ...d, strokeWidth: Number(e.target.value) }) }, 'Pen size'); }} className="flex-1 rounded border p-2.5 text-xs"><option value={2}>Fine</option><option value={5}>Pen</option><option value={9}>Marker</option><option value={16}>Brush</option></select>
              </div>
              <button onClick={() => { const d = safeJson(selectedElement.content, { paths: [], color: drawColor, strokeWidth: drawWidth }); updateSelected({ content: JSON.stringify({ ...d, paths: [] }) }, 'Clear drawing'); }} className="w-full rounded-lg border border-red-200 p-2.5 text-xs font-bold text-red-500"><Trash2 className="mr-1 inline h-3.5 w-3.5" /> Clear drawing</button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-1.5">
            <button onClick={duplicateSelected} className="rounded-lg border p-2.5 text-xs font-bold"><Copy className="mr-1 inline h-3.5 w-3.5" /> Duplicate</button>
            <button onClick={deleteSelected} className="rounded-lg border border-red-200 p-2.5 text-xs font-bold text-red-500"><Trash2 className="mr-1 inline h-3.5 w-3.5" /> Delete</button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed p-5 text-center text-xs text-gray-500">Select anything on the page to edit, resize, rotate, lock, duplicate, or delete it.</div>
      )}
    </aside>
  );

  return (
    <main className="min-h-[100dvh] overflow-x-hidden bg-[#B88C5A] pb-24 text-[#241F1B] xl:pb-6" style={{ backgroundImage: 'repeating-linear-gradient(0deg,rgba(255,255,255,.035) 0,rgba(255,255,255,.035) 1px,transparent 1px,transparent 6px),repeating-linear-gradient(90deg,rgba(70,40,15,.025) 0,rgba(70,40,15,.025) 2px,transparent 2px,transparent 13px)' }}>
      {/* ================= HEADER ================= */}
      <header className="fixed inset-x-0 top-0 z-50 border-b-2 border-[#604328] bg-[#EAD7BC] shadow-[0_4px_0_rgba(58,36,20,.25)]">
        <div className="mx-auto flex h-14 max-w-[1500px] items-center justify-between gap-2 px-3 md:h-16 md:px-5">
          <div className="flex min-w-0 items-center gap-2 md:gap-3">
            <Link href="/journals" className="rounded-lg border bg-white p-2" aria-label="Back to journals"><ArrowLeft className="h-4 w-4" /></Link>
            <Link href="/feed" className="hidden rounded-lg border bg-white p-2 sm:block" aria-label="Back to feed"><Home className="h-4 w-4" /></Link>
            <div className="min-w-0">
              <h1 className="truncate font-serif text-sm font-bold md:text-lg">{doc.title || 'Journal'} <span className="hidden sm:inline">— Studio</span></h1>
              <p className="hidden text-[10px] text-gray-500 sm:block">
                {saving ? 'Saving…' : dirty ? 'Unsaved changes · autosaving' : lastSavedAt ? `Saved ${lastSavedAt.toLocaleTimeString()}` : 'All changes saved'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {/* Undo / Redo */}
            <button
              onClick={undo}
              disabled={!canUndo}
              className="rounded-lg border bg-white p-2 disabled:opacity-30"
              aria-label={undoLabel ? `Undo: ${undoLabel}` : 'Nothing to undo'}
              title={undoLabel ? `Undo: ${undoLabel} (Ctrl+Z)` : 'Nothing to undo (Ctrl+Z)'}
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              className="rounded-lg border bg-white p-2 disabled:opacity-30"
              aria-label={redoLabel ? `Redo: ${redoLabel}` : 'Nothing to redo'}
              title={redoLabel ? `Redo: ${redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo (Ctrl+Shift+Z)'}
            >
              <Redo2 className="h-4 w-4" />
            </button>
            <button onClick={() => saveAll()} disabled={saving || uploadingFile} className="rounded-lg bg-[#2A211D] px-3 py-2 text-xs font-semibold text-[#FFD2DE] disabled:opacity-50"><Save className="mr-1 inline h-4 w-4" />{saving ? 'Saving' : 'Save'}</button>
            <button onClick={() => { setPreviewIndex(activeIsCover ? 0 : (doc.pages.findIndex((p) => p.id === activePageId) + 1)); setShowPreview(true); }} className="rounded-lg border bg-white px-2.5 py-2 text-xs font-semibold"><Eye className="mr-1 inline h-4 w-4" /><span className="hidden sm:inline">Preview</span></button>
            <Link href={`/journals/${journalId}`} className="hidden rounded-lg border bg-white px-2.5 py-2 text-xs font-semibold lg:block">View Book</Link>
          </div>
        </div>
      </header>

      {/* ================= DESKTOP: 3-COLUMN GRID ================= */}
      <div className="mx-auto grid max-w-[1500px] grid-cols-1 gap-4 p-3 pt-[76px] md:p-5 md:pt-[92px] xl:grid-cols-[260px_minmax(0,1fr)_290px]">
        <div className="hidden xl:block xl:order-1">{journalAside}</div>

        {/* Canvas section */}
        <section className={`${showCanvas ? '' : 'hidden'} min-w-0 rounded-2xl border border-[#D8C9BA] bg-[#8A6039] p-2 shadow-[inset_0_0_0_2px_rgba(60,35,18,.25)] md:p-4 xl:order-2`}>
          {/* Tool strip */}
          <div className="no-scrollbar mb-2 flex items-center justify-between gap-2 overflow-x-auto rounded-xl border border-[#D8C9BA] bg-[#FFFDF9] p-2">
            <div className="flex shrink-0 gap-1.5">
              <ToolButton active={tool === 'select'} onClick={() => setTool('select')} icon={<MousePointer2 />} label="Select" />
              <ToolButton active={tool === 'draw'} onClick={() => { setTool('draw'); addElement('drawing'); }} icon={<PenLine />} label="Draw" />
              <ToolButton onClick={() => addElement('text')} icon={<Type />} label="Text" />
              <ToolButton onClick={() => addElement('link')} icon={<Link2 />} label="Link" />
              <ToolButton onClick={() => addShape('rectangle')} icon={<span className="text-sm">▣</span>} label="Shape" />
              <label className="flex shrink-0 cursor-pointer items-center gap-1 rounded-lg bg-gray-100 px-2.5 py-2 text-xs font-semibold">
                <Upload className="h-4 w-4" />{uploadingFile ? 'Uploading…' : 'Media'}
                <input type="file" accept="image/*,video/*,audio/*" onChange={handleFileUpload} disabled={uploadingFile} className="hidden" />
              </label>
            </div>
            <div className="flex shrink-0 items-center gap-1 border-l border-gray-200 pl-2">
              <button onClick={() => { setAutoFit(false); setZoom((z) => Math.max(MIN_ZOOM, z - 0.08)); }} className="rounded-lg border bg-white p-2" aria-label="Zoom out"><ZoomOut className="h-4 w-4" /></button>
              <span className="w-11 text-center text-xs font-semibold">{Math.round(zoom * 100)}%</span>
              <button onClick={() => { setAutoFit(false); setZoom((z) => Math.min(MAX_ZOOM, z + 0.08)); }} className="rounded-lg border bg-white p-2" aria-label="Zoom in"><ZoomIn className="h-4 w-4" /></button>
              <button onClick={() => setAutoFit(true)} className={`rounded-lg border p-2 text-[10px] font-bold ${autoFit ? 'bg-pink-100 text-pink-700' : 'bg-white'}`} title="Fit page to screen">Fit</button>
            </div>
          </div>

          {/* Page title + paper color strip */}
          {!activeIsCover && activePage && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-[#D8C9BA] bg-[#FFFDF9] p-2">
              <input value={activePage.title || ''} onChange={(e) => updateDoc((c) => ({ ...c, pages: c.pages.map((p) => (p.id === activePage.id ? { ...p, title: e.target.value } : p)) }), 'Rename page', `pagetitle-${activePage.id}`)} data-history-scoped="true" className="min-w-[140px] flex-1 rounded-lg border p-2.5 text-xs" placeholder="Page title" />
              <div className="flex items-center gap-1.5">
                {PAPER_COLORS.map((c) => (
                  <button key={c} title={c} aria-label={`Paper color ${c}`} onClick={() => updateDoc((cur) => ({ ...cur, pages: cur.pages.map((p) => (p.id === activePage.id ? { ...p, background: c } : p)) }), 'Page background')} className={`h-8 w-8 shrink-0 rounded-full border shadow-sm ${activePage.background === c ? 'ring-2 ring-pink-400 ring-offset-1' : ''}`} style={{ background: c }} />
                ))}
              </div>
            </div>
          )}

          {/* STAGE */}
          <div className="relative flex items-start justify-center overflow-auto rounded-xl border-2 border-[#68472D] bg-[#8A6039] p-3 md:p-6" style={{ minHeight: isMobile ? `min(62dvh, ${Math.round(BASE_HEIGHT * zoom) + 48}px)` : `min(72vh, ${Math.round(BASE_HEIGHT * zoom) + 60}px)` }} onPointerDown={() => { if (tool === 'select') setSelectedElementId(null); }} onTouchStart={() => { if (tool === 'select') setSelectedElementId(null); }}>
            <div className="relative shrink-0" style={{ width: BASE_WIDTH * zoom + 18, height: BASE_HEIGHT * zoom + 18 }}>
              <div className="pointer-events-none absolute inset-0 translate-x-2 translate-y-2 border-2 border-[#4A2F1D] bg-[#6A4226] shadow-[6px_7px_0_#3B2517,0_25px_30px_rgba(42,25,12,.32)]" />
              <div className="pointer-events-none absolute inset-y-2 left-0 z-30 w-5 border-r-2 border-dashed border-[#F2E2C7]" />
              <div
                ref={canvasRef}
                className="relative shrink-0 origin-top-left touch-manipulation overflow-hidden border-2 border-[#73583F] shadow-[inset_9px_0_13px_rgba(49,31,18,.18),inset_-4px_0_7px_rgba(49,31,18,.08)]"
                style={{ width: BASE_WIDTH * zoom, height: BASE_HEIGHT * zoom, background: activeIsCover ? doc.coverBackground : activePage?.background || '#FFFDF8', backgroundImage: 'repeating-linear-gradient(0deg, rgba(90,60,30,.04) 0, rgba(90,60,30,.04) 1px, transparent 1px, transparent 31px),repeating-linear-gradient(90deg, rgba(90,60,30,.012) 0, rgba(90,60,30,.012) 1px, transparent 1px, transparent 19px)' }}
              >
                {activeIsCover && doc.coverMediaUrl && (
                  <div className="pointer-events-none absolute inset-0 opacity-30">
                    {doc.coverMediaType === 'video' ? <video src={doc.coverMediaUrl} muted autoPlay loop playsInline className="h-full w-full object-cover" /> : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={doc.coverMediaUrl} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                )}
                <div className="absolute left-0 top-0" style={{ width: BASE_WIDTH, height: BASE_HEIGHT, transform: `scale(${zoom})`, transformOrigin: 'top left' }}>{activeElements.map((el) => renderElement(el))}</div>
                <div className="pointer-events-none absolute inset-y-0 left-0 z-20 w-8 bg-gradient-to-r from-black/10 to-transparent" />
                <div className="pointer-events-none absolute inset-0 z-20 opacity-30" style={{ backgroundImage: 'radial-gradient(circle at 17% 24%,rgba(92,53,24,.22) 0 1px,transparent 2px),radial-gradient(circle at 72% 67%,rgba(92,53,24,.15) 0 1px,transparent 2px),repeating-linear-gradient(0deg,transparent 0,transparent 45px,rgba(120,75,35,.035) 46px,transparent 47px)' }} />
                <div className="pointer-events-none absolute inset-y-0 left-2 z-30 w-[11px] border-r border-dashed border-[#EBD9BA]/80" />
              </div>
            </div>
          </div>
          <p className="mt-2 text-center text-[10px] text-[#F1DEC5]">
            {isMobile ? 'Drag to move · pink handle to resize' : 'Drag to move · corner handle to resize · Ctrl+Z undo · Ctrl+Shift+Z redo'}
          </p>
        </section>

        <div className="hidden xl:block xl:order-3">{toolsAside}</div>

        {isMobile && showTools && <section className="order-2">{toolsAside}</section>}
        {isMobile && showPages && <section className="order-2">{journalAside}</section>}
      </div>

      {/* ================= MOBILE BOTTOM TAB BAR ================= */}
      {isMobile && (
        <nav className="fixed inset-x-0 bottom-0 z-50 border-t-2 border-[#604328] bg-[#EAD7BC] pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_0_rgba(58,36,20,.15)]">
          <div className="mx-auto grid max-w-md grid-cols-3">
            {([
              { id: 'canvas', label: 'Canvas', icon: <PenLine className="h-5 w-5" /> },
              { id: 'tools', label: 'Tools', icon: <Sparkles className="h-5 w-5" /> },
              { id: 'page', label: 'Page', icon: <span className="text-lg leading-none">📖</span> },
            ] as { id: MobileTab; label: string; icon: React.ReactNode }[]).map((tab) => (
              <button key={tab.id} onClick={() => setMobileTab(tab.id)} className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-bold ${mobileTab === tab.id ? 'text-[#8B3A56]' : 'text-[#765D48]'}`}>
                {tab.icon}
                {tab.label}
                <span className={`mt-0.5 h-1 w-8 rounded-full ${mobileTab === tab.id ? 'bg-[#8B3A56]' : 'bg-transparent'}`} />
              </button>
            ))}
          </div>
        </nav>
      )}

      {/* ================= BOOK PREVIEW ================= */}
      {showPreview && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#24170F]/80 p-2 backdrop-blur-sm">
          <div className="flex h-full w-full max-w-6xl flex-col overflow-hidden border-2 border-[#4A2F1D] bg-[#B88C5A] shadow-2xl">
            <div className="flex items-center justify-between border-b-2 border-[#604328] bg-[#EAD7BC] p-3">
              <div className="min-w-0">
                <b className="font-serif text-base md:text-lg">Book Preview</b>
                <span className="ml-2 text-xs text-[#765D48]">{previewIndex === 0 ? 'Cover' : `Page ${previewIndex}`}</span>
              </div>
              <button onClick={() => setShowPreview(false)} className="rounded border-2 border-[#76563A] bg-[#F6E9D5] p-2" aria-label="Close preview"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex flex-1 items-center justify-center overflow-auto p-4 md:p-5">
              <div className="relative" style={{ width: previewStageWidth + 24, height: ((previewStageWidth + 24) * BASE_HEIGHT) / BASE_WIDTH }}>
                <div className="absolute -inset-[9px] border-[6px] border-[#422817] bg-[#654021] shadow-[7px_8px_0_#332015,0_25px_35px_rgba(42,25,12,.38)]" />
                <div className="absolute -inset-6 -z-10 bg-[#704A2D]/35 shadow-[0_35px_40px_rgba(38,22,10,.45)]" />
                {Array.from({ length: Math.max(3, Math.min(16, Math.ceil((doc.pages.length + 1) / 2))) }).map((_, n) => <div key={n} className="absolute z-0 border border-[#B5A38E] bg-[#E9DFCF]" style={{ inset: `${4 + n * 0.75}px ${3 - n * 0.08}px ${4 - n * 0.08}px ${4 - n * 0.48}px`, transform: `translateX(${-n * 1.2}px)` }} />)}
                <div className="absolute inset-[5px] z-10 overflow-hidden border-2 border-[#6E5742] bg-[#EFE3D2] shadow-[inset_10px_0_12px_rgba(49,31,18,.20),inset_-4px_0_6px_rgba(49,31,18,.10)]">
                  <div className="pointer-events-none absolute inset-y-3 left-2 z-40 w-[13px] border-r-2 border-dashed border-[#EDE0CA]/90" />
                  <div className="absolute inset-[7px] overflow-hidden border border-[#A18E79] bg-white" style={{ background: previewIndex === 0 ? doc.coverBackground : doc.pages[previewIndex - 1]?.background || '#FFFDF8' }}>
                    {previewIndex === 0 && doc.coverMediaUrl && (
                      <div className="pointer-events-none absolute inset-0 opacity-80">
                        {doc.coverMediaType === 'video' ? <video src={doc.coverMediaUrl} muted autoPlay loop playsInline className="h-full w-full object-cover" /> : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={doc.coverMediaUrl} alt="" className="h-full w-full object-cover" />
                        )}
                      </div>
                    )}
                    <div className="absolute left-0 top-0" style={{ width: BASE_WIDTH, height: BASE_HEIGHT, transform: `scale(${previewScale})`, transformOrigin: 'top left' }}>
                      {(previewIndex === 0 ? doc.coverElements : doc.pages[previewIndex - 1]?.elements || []).map((el) => renderElement(el, false))}
                    </div>
                    <div className="pointer-events-none absolute inset-y-0 left-0 z-30 w-8 bg-gradient-to-r from-black/10 to-transparent" />
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between border-t-2 border-[#604328] bg-[#EAD7BC] p-3">
              <button disabled={previewIndex === 0} onClick={() => setPreviewIndex((i) => Math.max(0, i - 1))} className="border-2 border-[#5D3D26] bg-[#F6E9D5] px-4 py-2.5 font-serif text-xs font-bold disabled:opacity-30">← Previous</button>
              <span className="font-serif text-xs font-bold text-[#765D48]">{previewIndex === 0 ? 'Cover' : `Page ${previewIndex} / ${doc.pages.length}`}</span>
              <button disabled={previewIndex === doc.pages.length} onClick={() => setPreviewIndex((i) => Math.min(doc.pages.length, i + 1))} className="border-2 border-[#2E1B11] bg-[#3A2518] px-4 py-2.5 font-serif text-xs font-bold text-[#F5DCC0] disabled:opacity-30">Next →</button>
            </div>
          </div>
        </div>
      )}

      {/* ================= TOAST ================= */}
      {toast && (
        <div className="pointer-events-none fixed left-1/2 top-16 z-[120] w-full max-w-xs -translate-x-1/2 px-4">
          <div className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-lg ${toast.tone === 'success' ? 'bg-emerald-800/95' : 'bg-red-800/95'}`}>
            {toast.tone === 'success' ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <X className="h-4 w-4 shrink-0" />}
            <span className="min-w-0 break-words">{toast.message}</span>
          </div>
        </div>
      )}
    </main>
  );
}

function ToolButton({ active, onClick, icon, label }: { active?: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick} className={`flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-semibold transition active:scale-95 ${active ? 'bg-[#2A211D] text-[#FFD2DE]' : 'bg-gray-100'}`}>
      {React.cloneElement(icon as React.ReactElement, { className: 'h-4 w-4' })}
      {label}
    </button>
  );
}
