/* ============================================================
   Journal document model — one immutable snapshot covers the
   cover + all pages + all elements, which is exactly what the
   undo/redo history stores. Element shape matches the
   `page_elements` JSON payload used by the existing editor
   (drop-in compatible with rows saved by the old studio).
   ============================================================ */

export type JournalElementType = 'text' | 'media' | 'sticker' | 'link' | 'drawing' | 'shape' | 'icon' | 'gif';
export type TextAlign = 'left' | 'center' | 'right';

export interface CanvasElement {
  id: string;
  type: JournalElementType;
  content: string;
  media_url?: string;
  media_type?: string;
  href?: string;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  z_index: number;
  opacity?: number;
  rotation?: number;
  locked?: boolean;
  font_size?: number;
  font_family?: string;
  color?: string;
  background?: string;
  text_align?: TextAlign;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  border_radius?: number;
  object_fit?: 'cover' | 'contain';
  shape?: string;
  fill?: string;
  stroke?: string;
  stroke_width?: number;
}

export interface JournalPageData {
  id: string;
  page_number: number;
  title: string;
  background: string;
  width: number;
  height: number;
  elements: CanvasElement[];
  created_at: string;
  updated_at?: string;
}

export interface JournalDocument {
  title: string;
  description: string;
  coverBackground: string;
  coverMediaType: string;
  coverMediaUrl: string;
  coverElements: CanvasElement[];
  pages: JournalPageData[];
}

export const BASE_WIDTH = 800;
export const BASE_HEIGHT = 1100;

export function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

export function safeJson(value: any, fallback: any = {}) {
  if (value && typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export function normalizeElement(raw: any, index = 0): CanvasElement {
  const rawContent = raw?.content;
  const type = raw?.type;
  const legacyDrawing = type === 'drawing' ? safeJson(rawContent, { paths: [] }) : null;
  const healedMeta =
    (type === 'text' || type == null) && rawContent && typeof rawContent === 'string' && rawContent.trim().startsWith('{')
      ? safeJson(rawContent, null)
      : null;
  const healedShape = healedMeta && typeof healedMeta === 'object' && healedMeta.shape ? healedMeta : null;
  const effectiveType = healedShape ? 'shape' : type;
  const contentMeta = safeJson(raw?.content, {});
  return {
    id: String(raw?.id ?? `element-${Date.now()}-${index}`),
    type: ['media', 'sticker', 'link', 'drawing', 'shape', 'icon', 'gif'].includes(effectiveType) ? effectiveType : 'text',
    content:
      effectiveType === 'shape' && healedShape
        ? ''
        : type === 'drawing' && legacyDrawing
          ? JSON.stringify(legacyDrawing)
          : String(rawContent ?? ''),
    media_url: raw?.media_url || undefined,
    media_type: raw?.media_type || undefined,
    href: raw?.href || (type === 'link' ? String(rawContent || '') : undefined),
    position_x: Number(raw?.position_x ?? raw?.x ?? 30),
    position_y: Number(raw?.position_y ?? raw?.y ?? 30),
    width: Math.max(40, Number(raw?.width ?? 260)),
    height: Math.max(40, Number(raw?.height ?? 160)),
    z_index: Number(raw?.z_index ?? 1),
    opacity: raw?.opacity == null ? 1 : Number(raw.opacity),
    rotation: Number(raw?.rotation ?? 0),
    locked: Boolean(raw?.locked),
    font_size: Number(raw?.font_size ?? 24),
    font_family: raw?.font_family || 'Georgia',
    color: raw?.color || '#2b2520',
    background: raw?.background || (type === 'text' ? 'rgba(255,255,255,0.68)' : 'transparent'),
    text_align: raw?.text_align || 'left',
    bold: Boolean(raw?.bold),
    italic: Boolean(raw?.italic),
    underline: Boolean(raw?.underline),
    border_radius: Number(raw?.border_radius ?? 12),
    object_fit: raw?.object_fit === 'contain' ? 'contain' : 'cover',
    shape: raw?.shape || contentMeta.shape || (healedShape ? healedShape.shape : 'rectangle'),
    fill: raw?.fill || contentMeta.fill || (healedShape ? healedShape.fill : undefined) || '#F6D5DF',
    stroke: raw?.stroke || contentMeta.stroke || (healedShape ? healedShape.stroke : undefined) || '#8B5260',
    stroke_width: Number(raw?.stroke_width ?? contentMeta.stroke_width ?? (healedShape ? healedShape.stroke_width : undefined) ?? 4),
  };
}

export function normalizePage(raw: any, index: number): JournalPageData {
  return {
    id: String(raw.id),
    page_number: Number(raw.page_number ?? index + 1),
    title: raw.title || `Page ${index + 1}`,
    background: raw.background || '#FFFDF8',
    width: Number(raw.width ?? BASE_WIDTH),
    height: Math.max(Number(raw.height ?? BASE_HEIGHT), BASE_HEIGHT),
    elements: Array.isArray(raw.elements) ? raw.elements.map((e: any, i: number) => normalizeElement(e, i)) : [],
    created_at: raw.created_at || new Date().toISOString(),
    updated_at: raw.updated_at,
  };
}

export function emptyDocument(title = 'My Journal'): JournalDocument {
  return {
    title,
    description: '',
    coverBackground: '#FFF7F8',
    coverMediaType: 'image',
    coverMediaUrl: '',
    coverElements: [],
    pages: [],
  };
}
