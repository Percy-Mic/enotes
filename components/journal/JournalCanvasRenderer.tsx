'use client';

import React from 'react';
import {
  Link2,
  Volume2,
  Play,
  ExternalLink,
} from 'lucide-react';

export const CANVAS_WIDTH = 800;
export const CANVAS_HEIGHT = 1100;

export type ElementType =
  | 'text'
  | 'media'
  | 'sticker'
  | 'link'
  | 'drawing'
  | 'shape';

export interface Point {
  x: number;
  y: number;
}

export interface DrawingData {
  paths: Point[][];
  color?: string;
  strokeWidth?: number;
}

export interface CanvasElement {
  id: string;
  type: ElementType;

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

  text_align?: 'left' | 'center' | 'right';

  bold?: boolean;
  italic?: boolean;
  underline?: boolean;

  border_radius?: number;

  object_fit?: 'cover' | 'contain';

  /* shape support (edit studio fields) */
  shape?: string;
  fill?: string;
  stroke?: string;
  stroke_width?: number;

  /* legacy renderer fields kept for compatibility */
  shape_type?: string;
  border_color?: string;
  border_width?: number;

  /* optional styling */
  shadow?: string;
  padding?: number;
}

export interface JournalCanvasRendererProps {
  elements?: CanvasElement[] | string | null;
  scale?: number;
  className?: string;
  interactive?: boolean;
}

export function safeJson<T = any>(
  value: unknown,
  fallback: T,
): T {
  if (value && typeof value === 'object') {
    return value as T;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  return fallback;
}

export function normalizeElement(
  raw: any,
  index = 0,
): CanvasElement {
  const rawType = String(raw?.type ?? 'text');

  let type: ElementType = 'text';

  if (
    rawType === 'media' ||
    rawType === 'sticker' ||
    rawType === 'link' ||
    rawType === 'drawing' ||
    rawType === 'shape'
  ) {
    type = rawType;
  }

  const drawing =
    type === 'drawing'
      ? safeJson<DrawingData>(
          raw?.content,
          {
            paths: [],
            color: '#2b2520',
            strokeWidth: 5,
          },
        )
      : null;

  /* Shape metadata can live on the element fields or inside content JSON.
     Self-heal: the old editor saved shapes as type 'text' with {"shape":...}
     JSON content — recover those into real shape elements. */
  const contentMeta = safeJson<any>(
    raw?.content,
    {},
  );

  const healedShape =
    (rawType === 'text' || rawType == null) &&
    typeof raw?.content === 'string' &&
    raw.content.trim().startsWith('{') &&
    contentMeta &&
    typeof contentMeta === 'object' &&
    contentMeta.shape
      ? contentMeta
      : null;

  const shapeName =
    raw?.shape ||
    raw?.shape_type ||
    contentMeta.shape ||
    (healedShape ? healedShape.shape : 'rectangle');

  const effectiveType = healedShape ? 'shape' : type;

  const fillColor =
    raw?.fill ||
    contentMeta.fill ||
    (healedShape ? healedShape.fill : undefined) ||
    raw?.background ||
    '#F6D5DF';

  const strokeColor =
    raw?.stroke ||
    raw?.border_color ||
    contentMeta.stroke ||
    (healedShape ? healedShape.stroke : undefined) ||
    '#8B5260';

  const strokeWidth = Number(
    raw?.stroke_width ??
      raw?.border_width ??
      contentMeta.stroke_width ??
      (healedShape ? healedShape.stroke_width : undefined) ??
      4,
  );

  return {
    id: String(
      raw?.id ??
        `element-${index}`,
    ),

    type: effectiveType,

    content:
      type === 'drawing'
        ? JSON.stringify(drawing)
        : effectiveType === 'shape' && healedShape
          ? ''
          : String(
              raw?.content ?? '',
            ),

    media_url:
      raw?.media_url != null
        ? String(raw.media_url)
        : undefined,

    media_type:
      raw?.media_type != null
        ? String(raw.media_type)
        : undefined,

    href:
      raw?.href ||
      (type === 'link'
        ? String(
            raw?.content ?? '',
          )
        : undefined),

    position_x: Number(
      raw?.position_x ??
        raw?.x ??
        20,
    ),

    position_y: Number(
      raw?.position_y ??
        raw?.y ??
        20,
    ),

    width: Math.max(
      20,
      Number(
        raw?.width ?? 260,
      ),
    ),

    height: Math.max(
      20,
      Number(
        raw?.height ?? 160,
      ),
    ),

    z_index: Number(
      raw?.z_index ?? 1,
    ),

    opacity:
      raw?.opacity == null
        ? 1
        : Math.max(
            0,
            Math.min(
              1,
              Number(raw.opacity),
            ),
          ),

    rotation: Number(
      raw?.rotation ?? 0,
    ),

    locked: Boolean(
      raw?.locked,
    ),

    font_size: Number(
      raw?.font_size ?? 24,
    ),

    font_family:
      raw?.font_family ||
      'Georgia, serif',

    color:
      raw?.color ||
      '#2b2520',

    background:
      raw?.background ??
      'transparent',

    text_align:
      raw?.text_align ===
        'center' ||
      raw?.text_align ===
        'right'
        ? raw.text_align
        : 'left',

    bold: Boolean(
      raw?.bold,
    ),

    italic: Boolean(
      raw?.italic,
    ),

    underline: Boolean(
      raw?.underline,
    ),

    border_radius: Number(
      raw?.border_radius ?? 6,
    ),

    object_fit:
      raw?.object_fit ===
      'contain'
        ? 'contain'
        : 'cover',

    shape: String(shapeName),

    fill: String(fillColor),

    stroke: String(strokeColor),

    stroke_width: strokeWidth,

    border_color: String(strokeColor),

    border_width: strokeWidth,

    shadow:
      raw?.shadow ||
      undefined,

    padding: Number(
      raw?.padding ?? 14,
    ),
  };
}

export function normalizeElements(
  value: unknown,
): CanvasElement[] {
  let parsed: unknown = value;

  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .filter(Boolean)
    .map(
      (element, index) =>
        normalizeElement(
          element,
          index,
        ),
    );
}

/* ------------------------------------------------ */
/* STICKERS */
/* ------------------------------------------------ */

export const STICKERS: Record<
  string,
  string
> = {
  heart: '♥',
  '♥': '♥',

  heartOutline: '♡',
  '♡': '♡',

  star: '★',
  '★': '★',

  starSmall: '✦',
  '✦': '✦',

  flower: '✿',
  '✿': '✿',

  flower2: '❀',
  '❀': '❀',

  flower3: '❁',
  '❁': '❁',

  butterfly: '🦋',
  '🦋': '🦋',

  rose: '🌹',
  '🌹': '🌹',

  tulip: '🌷',
  '🌷': '🌷',

  sunflower: '🌻',
  '🌻': '🌻',

  leaf: '🍃',
  '🍃': '🍃',

  clover: '☘',
  '☘': '☘',

  coffee: '☕',
  '☕': '☕',

  music: '♫',
  '♫': '♫',

  music2: '♪',
  '♪': '♪',

  moon: '☾',
  '☾': '☾',

  sun: '☀',
  '☀': '☀',

  cloud: '☁',
  '☁': '☁',

  envelope: '✉',
  '✉': '✉',

  bow: '🎀',
  '🎀': '🎀',

  camera: '📷',
  '📷': '📷',

  smile: '☺',
  '☺': '☺',

  pencil: '✎',
  '✎': '✎',

  peace: '☮',
  '☮': '☮',

  sparkle: '✨',
  '✨': '✨',

  sparkles: '✧',
  '✧': '✧',

  diamond: '◆',
  '◆': '◆',

  diamondOutline: '◇',
  '◇': '◇',

  arrow: '➳',
  '➳': '➳',

  feather: '❧',
  '❧': '❧',

  swirl: '⌁',
  '⌁': '⌁',

  check: '✓',
  '✓': '✓',

  cross: '✕',
  '✕': '✕',

  sun2: '☼',
  '☼': '☼',
};

function DrawingView({
  content,
}: {
  content: string;
}) {
  const drawing =
    safeJson<DrawingData>(
      content,
      {
        paths: [],
        color: '#2b2520',
        strokeWidth: 5,
      },
    );

  return (
    <svg
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      className="pointer-events-none h-full w-full"
    >
      {(
        drawing.paths || []
      ).map(
        (path, index) => (
          <polyline
            key={index}
            points={path
              .map(
                (point) =>
                  `${point.x},${point.y}`,
              )
              .join(' ')}
            fill="none"
            stroke={
              drawing.color ||
              '#2b2520'
            }
            strokeWidth={
              drawing.strokeWidth ||
              5
            }
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ),
      )}
    </svg>
  );
}

/* ------------------------------------------------ */
/* SHAPES — mirrors the edit studio exactly:
/* rectangle, circle, triangle, diamond, star,
/* heart, line, speech, cloud, hexagon. */
/* ------------------------------------------------ */

const SHAPE_NAMES = [
  'rectangle',
  'circle',
  'ellipse',
  'triangle',
  'diamond',
  'star',
  'heart',
  'line',
  'speech',
  'cloud',
  'hexagon',
] as const;

function ShapeView({
  element,
}: {
  element: CanvasElement;
}) {
  const requested = String(
    element.shape ||
      element.shape_type ||
      'rectangle',
  ).toLowerCase();

  const shape =
    (SHAPE_NAMES as readonly string[]).includes(
      requested,
    )
      ? requested
      : 'rectangle';

  const fill =
    element.fill ||
    '#F6D5DF';

  const stroke =
    element.stroke ||
    element.border_color ||
    '#8B5260';

  const sw = Math.max(
    1,
    Number(
      element.stroke_width ??
        element.border_width ??
        4,
    ),
  );

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
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }

  /* rectangle (default) */
  return (
    <div
      className="h-full w-full"
      style={{
        background: fill,
        border: `${sw}px solid ${stroke}`,
        borderRadius:
          element.border_radius ?? 6,
      }}
    />
  );
}

/* ------------------------------------------------ */
/* MEDIA */
/* ------------------------------------------------ */

function MediaView({
  element,
}: {
  element: CanvasElement;
}) {
  if (!element.media_url) {
    return (
      <div className="flex h-full w-full items-center justify-center border border-[#BFAF9E] bg-[#F7EFE3] text-xs text-[#735F4E]">
        Media unavailable
      </div>
    );
  }

  const mediaType = String(
    element.media_type || '',
  ).toLowerCase();

  if (
    mediaType === 'video' ||
    mediaType === 'video/mp4' ||
    mediaType === 'video/webm' ||
    mediaType === 'video/quicktime'
  ) {
    return (
      <div className="relative h-full w-full overflow-hidden bg-black">
        <video
          src={element.media_url}
          controls
          playsInline
          preload="metadata"
          className="h-full w-full"
          style={{
            objectFit:
              element.object_fit ||
              'cover',
          }}
        />

        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[10px] text-white">
          <Play className="h-3 w-3 fill-current" />
          Video
        </div>
      </div>
    );
  }

  if (
    mediaType === 'audio' ||
    mediaType === 'audio/mpeg' ||
    mediaType === 'audio/mp3' ||
    mediaType === 'audio/wav' ||
    mediaType === 'audio/ogg'
  ) {
    return (
      <div className="flex h-full w-full flex-col justify-center gap-3 border border-[#BFAF9E] bg-[#F7EFE3] p-4">
        <div className="flex items-center gap-2 font-serif text-sm font-bold text-[#3D2B1F]">
          <Volume2 className="h-5 w-5" />

          <span className="truncate">
            {element.content ||
              'Audio recording'}
          </span>
        </div>

        <audio
          src={element.media_url}
          controls
          preload="metadata"
          className="w-full"
        />
      </div>
    );
  }

  return (
    <img
      src={element.media_url}
      alt={
        element.content ||
        'Journal image'
      }
      className="h-full w-full"
      draggable={false}
      style={{
        objectFit:
          element.object_fit ||
          'cover',
      }}
    />
  );
}

/* ------------------------------------------------ */
/* ELEMENT */
/* ------------------------------------------------ */

export function renderCanvasElement(
  element: CanvasElement,
) {
  const common: React.CSSProperties =
    {
      position: 'absolute',

      left: element.position_x,

      top: element.position_y,

      width: element.width,

      height: element.height,

      zIndex:
        element.z_index ?? 1,

      opacity:
        element.opacity ?? 1,

      transform: `rotate(${element.rotation || 0}deg)`,

      transformOrigin:
        'center center',

      boxSizing: 'border-box',

      pointerEvents: 'auto',
    };

  /* TEXT */

  if (
    element.type ===
    'text'
  ) {
    return (
      <div
        key={element.id}
        className="overflow-hidden whitespace-pre-wrap"
        style={common}
      >
        <div
          className="h-full w-full"
          style={{
            padding:
              element.padding ??
              14,

            fontFamily:
              element.font_family ||
              'Georgia, serif',

            fontSize:
              element.font_size ||
              24,

            lineHeight: 1.35,

            color:
              element.color ||
              '#2b2520',

            background:
              element.background ||
              'transparent',

            textAlign:
              element.text_align ||
              'left',

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

            overflow:
              'hidden',

            wordBreak:
              'break-word',
          }}
        >
          {element.content}
        </div>
      </div>
    );
  }

  /* MEDIA */

  if (
    element.type ===
    'media'
  ) {
    return (
      <div
        key={element.id}
        className="overflow-hidden"
        style={{
          ...common,

          borderRadius:
            element.border_radius ??
            6,

          boxShadow:
            element.shadow ||
            undefined,
        }}
      >
        <MediaView
          element={element}
        />
      </div>
    );
  }

  /* LINK */

  if (
    element.type ===
    'link'
  ) {
    const href =
      element.href ||
      element.content;

    return (
      <a
        key={element.id}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="flex h-full w-full items-center gap-3 overflow-hidden border p-3 no-underline"
        style={{
          ...common,

          borderColor:
            element.border_color ||
            '#8D9DAA',

          borderWidth:
            element.border_width ??
            1,

          borderRadius:
            element.border_radius ??
            6,

          background:
            element.background ||
            '#EEF3F5',

          color:
            element.color ||
            '#29465B',

          boxShadow:
            element.shadow ||
            undefined,
        }}
      >
        <Link2 className="h-5 w-5 shrink-0" />

        <span className="min-w-0 flex-1 break-words text-sm font-semibold underline decoration-dotted">
          {element.content ||
            href}
        </span>

        <ExternalLink className="h-4 w-4 shrink-0 opacity-60" />
      </a>
    );
  }

  /* DRAWING */

  if (
    element.type ===
    'drawing'
  ) {
    return (
      <div
        key={element.id}
        style={common}
      >
        <DrawingView
          content={
            element.content
          }
        />
      </div>
    );
  }

  /* SHAPE */

  if (
    element.type ===
    'shape'
  ) {
    return (
      <div
        key={element.id}
        style={common}
      >
        <ShapeView
          element={element}
        />
      </div>
    );
  }

  /* STICKER */

  return (
    <div
      key={element.id}
      className="flex select-none items-center justify-center overflow-visible"
      style={{
        ...common,

        fontSize:
          Math.min(
            element.width,
            element.height,
          ) * 0.72,

        lineHeight: 1,

        fontFamily:
          element.font_family ||
          'Apple Color Emoji, Segoe UI Emoji, sans-serif',

        color:
          element.color ||
          '#2b2520',

        background:
          element.background ||
          'transparent',

        userSelect:
          'none',
      }}
    >
      {STICKERS[
        element.content
      ] ||
        element.content ||
        '✦'}
    </div>
  );
}

/* ------------------------------------------------ */
/* MAIN RENDERER */
/* ------------------------------------------------ */

export default function JournalCanvasRenderer({
  elements = [],
  scale = 1,
  className = '',
  interactive = false,
}: JournalCanvasRendererProps) {
  const normalized =
    normalizeElements(
      elements,
    );

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{
        width:
          CANVAS_WIDTH *
          scale,

        height:
          CANVAS_HEIGHT *
          scale,

        background:
          'transparent',
      }}
    >
      <div
        className="absolute left-0 top-0"
        style={{
          width:
            CANVAS_WIDTH,

          height:
            CANVAS_HEIGHT,

          transformOrigin:
            'top left',

          transform: `scale(${scale})`,
        }}
      >
        {normalized
          .sort(
            (a, b) =>
              a.z_index -
              b.z_index,
          )
          .map(
            renderCanvasElement,
          )}
      </div>
    </div>
  );
}
