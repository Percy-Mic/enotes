'use client';

import React from 'react';
import {
  Link2,
  Volume2,
  Play,
  ExternalLink,
  ImageOff,
  Loader2,
} from 'lucide-react';

export const CANVAS_WIDTH = 800;
export const CANVAS_HEIGHT = 1100;

export type ElementType =
  | 'text'
  | 'media'
  | 'gif'
  | 'icon'
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

  shape?: string;
  fill?: string;
  stroke?: string;
  stroke_width?: number;

  shape_type?: string;
  border_color?: string;
  border_width?: number;

  shadow?: string;
  padding?: number;
}

export interface JournalCanvasRendererProps {
  elements?: CanvasElement[] | string | null;
  scale?: number;
  className?: string;
  interactive?: boolean;
}

/* =========================================================
   JSON HELPERS
   ========================================================= */

export function safeJson<T = any>(
  value: unknown,
  fallback: T,
): T {
  if (
    value !== null &&
    typeof value === 'object'
  ) {
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

/* =========================================================
   MEDIA TYPE NORMALIZATION
   ========================================================= */

function normalizeMediaType(
  value: unknown,
): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .split(';')[0]
    .trim();
}

/**
 * Gets the file extension from a URL safely.
 *
 * Works with:
 *   image.gif
 *   image.gif?token=123
 *   image.gif#section
 *   Supabase Storage signed URLs
 */
function getUrlExtension(
  url: string,
): string {
  if (!url) {
    return '';
  }

  try {
    const parsed = new URL(
      url,
      typeof window !== 'undefined'
        ? window.location.origin
        : 'http://localhost',
    );

    const pathname =
      parsed.pathname.toLowerCase();

    const lastDot =
      pathname.lastIndexOf('.');

    if (lastDot === -1) {
      return '';
    }

    return pathname
      .slice(lastDot + 1)
      .trim();
  } catch {
    const clean = String(url)
      .split('?')[0]
      .split('#')[0]
      .toLowerCase();

    const lastDot =
      clean.lastIndexOf('.');

    if (lastDot === -1) {
      return '';
    }

    return clean
      .slice(lastDot + 1)
      .trim();
  }
}

/**
 * Detects the actual media kind.
 *
 * GIF is intentionally checked FIRST because old records may
 * contain:
 *
 *   media_type = "gif"
 *   media_type = "image/gif"
 *   media_type = "image/GIF"
 *   media_type = ""
 *   media_url = ".../something.gif"
 *
 * The URL extension therefore acts as an additional source
 * of truth.
 */
function detectMediaKind(
  element: CanvasElement,
):
  | 'gif'
  | 'video'
  | 'audio'
  | 'image'
  | 'unknown' {
  const mediaType =
    normalizeMediaType(
      element.media_type,
    );

  const mediaUrl =
    String(
      element.media_url ?? '',
    ).trim();

  const content =
    String(
      element.content ?? '',
    ).trim();

  const extensionFromUrl =
    getUrlExtension(mediaUrl);

  const extensionFromContent =
    getUrlExtension(content);

  const extension =
    extensionFromUrl ||
    extensionFromContent;

  /* =======================================================
     GIF
     ======================================================= */

  if (
    mediaType === 'gif' ||
    mediaType === 'image/gif' ||
    mediaType.startsWith('image/gif') ||
    extension === 'gif'
  ) {
    return 'gif';
  }

  /* =======================================================
     VIDEO
     ======================================================= */

  if (
    mediaType === 'video' ||
    mediaType.startsWith('video/') ||
    extension === 'mp4' ||
    extension === 'webm' ||
    extension === 'mov' ||
    extension === 'm4v' ||
    extension === 'ogv'
  ) {
    return 'video';
  }

  /* =======================================================
     AUDIO
     ======================================================= */

  if (
    mediaType === 'audio' ||
    mediaType.startsWith('audio/') ||
    extension === 'mp3' ||
    extension === 'wav' ||
    extension === 'ogg' ||
    extension === 'm4a' ||
    extension === 'aac' ||
    extension === 'flac' ||
    extension === 'opus'
  ) {
    return 'audio';
  }

  /* =======================================================
     IMAGE
     ======================================================= */

  if (
    mediaType === 'image' ||
    mediaType.startsWith('image/') ||
    extension === 'jpg' ||
    extension === 'jpeg' ||
    extension === 'png' ||
    extension === 'webp' ||
    extension === 'avif' ||
    extension === 'bmp' ||
    extension === 'svg'
  ) {
    return 'image';
  }

  return 'unknown';
}

/* =========================================================
   ELEMENT NORMALIZATION
   ========================================================= */

export function normalizeElement(
  raw: any,
  index = 0,
): CanvasElement {
  const rawType =
    String(
      raw?.type ?? 'text',
    )
      .trim()
      .toLowerCase();

  let type: ElementType =
    'text';

  if (
    rawType === 'media' ||
    rawType === 'gif' ||
    rawType === 'icon' ||
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

  const contentMeta =
    safeJson<any>(
      raw?.content,
      {},
    );

  const healedShape =
    rawType === 'text' &&
    typeof raw?.content ===
      'string' &&
    raw.content
      .trim()
      .startsWith('{') &&
    contentMeta &&
    typeof contentMeta ===
      'object' &&
    contentMeta.shape
      ? contentMeta
      : null;

  const shapeName =
    raw?.shape ||
    raw?.shape_type ||
    contentMeta?.shape ||
    healedShape?.shape ||
    'rectangle';

  const contentLooksLikeGifUrl =
    typeof raw?.content === 'string' &&
    /^https?:\/\//i.test(raw.content.trim()) &&
    /\.gif(?:$|[?#])/i.test(raw.content.trim());

  const effectiveType: ElementType =
    healedShape
      ? 'shape'
      : type === 'gif' || (type === 'text' && contentLooksLikeGifUrl)
        ? 'media'
        : type;

  const fillColor =
    raw?.fill ||
    contentMeta?.fill ||
    healedShape?.fill ||
    raw?.background ||
    '#F6D5DF';

  const strokeColor =
    raw?.stroke ||
    raw?.border_color ||
    contentMeta?.stroke ||
    healedShape?.stroke ||
    '#8B5260';

  const strokeWidth =
    Number(
      raw?.stroke_width ??
        raw?.border_width ??
        contentMeta?.stroke_width ??
        healedShape?.stroke_width ??
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
        ? JSON.stringify(
            drawing,
          )
        : effectiveType ===
              'shape' &&
            healedShape
          ? ''
          : String(
              raw?.content ?? '',
            ),

    media_url:
      raw?.media_url != null
        ? String(raw.media_url).trim()
        : rawType === 'gif' && (raw?.url != null || raw?.src != null)
          ? String(raw?.url ?? raw?.src).trim()
          : type === 'text' && contentLooksLikeGifUrl
            ? String(raw.content).trim()
            : undefined,

    media_type:
      raw?.media_type != null
        ? normalizeMediaType(raw.media_type)
        : rawType === 'gif' || contentLooksLikeGifUrl
          ? 'image/gif'
          : undefined,

    href:
      raw?.href ||
      (
        type === 'link'
          ? String(
              raw?.content ?? '',
            )
          : undefined
      ),

    position_x:
      Number(
        raw?.position_x ??
          raw?.x ??
          20,
      ),

    position_y:
      Number(
        raw?.position_y ??
          raw?.y ??
          20,
      ),

    width:
      Math.max(
        20,
        Number(
          raw?.width ?? 260,
        ),
      ),

    height:
      Math.max(
        20,
        Number(
          raw?.height ?? 160,
        ),
      ),

    z_index:
      Number(
        raw?.z_index ?? 1,
      ),

    opacity:
      raw?.opacity == null
        ? 1
        : Math.max(
            0,
            Math.min(
              1,
              Number(
                raw.opacity,
              ),
            ),
          ),

    rotation:
      Number(
        raw?.rotation ?? 0,
      ),

    locked:
      Boolean(
        raw?.locked,
      ),

    font_size:
      Number(
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

    bold:
      Boolean(
        raw?.bold,
      ),

    italic:
      Boolean(
        raw?.italic,
      ),

    underline:
      Boolean(
        raw?.underline,
      ),

    border_radius:
      Number(
        raw?.border_radius ??
          6,
      ),

    object_fit:
      raw?.object_fit ===
        'contain'
        ? 'contain'
        : 'cover',

    shape:
      String(
        shapeName,
      ),

    fill:
      String(
        fillColor,
      ),

    stroke:
      String(
        strokeColor,
      ),

    stroke_width:
      strokeWidth,

    border_color:
      String(
        strokeColor,
      ),

    border_width:
      strokeWidth,

    shadow:
      raw?.shadow ||
      undefined,

    padding:
      Number(
        raw?.padding ?? 14,
      ),
  };
}

export function normalizeElements(
  value: unknown,
): CanvasElement[] {
  let parsed: unknown =
    value;

  if (
    typeof parsed ===
    'string'
  ) {
    try {
      parsed =
        JSON.parse(
          parsed,
        );
    } catch {
      return [];
    }
  }

  if (
    !Array.isArray(
      parsed,
    )
  ) {
    return [];
  }

  return parsed
    .filter(Boolean)
    .map(
      (
        element,
        index,
      ) =>
        normalizeElement(
          element,
          index,
        ),
    );
}

/* =========================================================
   STICKERS
   ========================================================= */

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

/* =========================================================
   DRAWING
   ========================================================= */

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
      aria-hidden="true"
    >
      {(drawing.paths || [])
        .map(
          (
            path,
            index,
          ) => (
            <polyline
              key={index}
              points={path
                .map(
                  (
                    point,
                  ) =>
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

/* =========================================================
   SHAPES
   ========================================================= */

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
  const requested =
    String(
      element.shape ||
        element.shape_type ||
        'rectangle',
    ).toLowerCase();

  const shape =
    (
      SHAPE_NAMES as readonly string[]
    ).includes(
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

  const sw =
    Math.max(
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
        aria-hidden="true"
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

  if (
    shape === 'triangle'
  ) {
    return (
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-full w-full"
        aria-hidden="true"
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

  if (
    shape === 'diamond'
  ) {
    return (
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-full w-full"
        aria-hidden="true"
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

  if (
    shape === 'star'
  ) {
    return (
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-full w-full"
        aria-hidden="true"
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

  if (
    shape === 'heart'
  ) {
    return (
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-full w-full"
        aria-hidden="true"
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

  if (
    shape === 'line'
  ) {
    return (
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-full w-full"
        aria-hidden="true"
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

  if (
    shape === 'speech'
  ) {
    return (
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-full w-full"
        aria-hidden="true"
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

  if (
    shape === 'cloud'
  ) {
    return (
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-full w-full"
        aria-hidden="true"
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

  if (
    shape === 'hexagon'
  ) {
    return (
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-full w-full"
        aria-hidden="true"
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

  return (
    <div
      className="h-full w-full"
      style={{
        background:
          fill,
        border:
          `${sw}px solid ${stroke}`,
        borderRadius:
          element.border_radius ??
          6,
      }}
    />
  );
}

/* =========================================================
   MEDIA UNAVAILABLE
   ========================================================= */

function MediaUnavailable({
  element,
}: {
  element: CanvasElement;
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 border border-[#BFAF9E] bg-[#F7EFE3] p-4 text-center">
      <ImageOff className="h-6 w-6 text-[#8B7562]" />

      <div className="text-sm font-semibold text-[#5D4737]">
        Media unavailable
      </div>

      <div className="max-w-full break-all text-[10px] text-[#8B7562]">
        {element.content ||
          'The media could not be loaded.'}
      </div>
    </div>
  );
}

/* =========================================================
   MEDIA LOADING
   ========================================================= */

function MediaLoading({
  label = 'Loading media…',
}: {
  label?: string;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#F7EFE3] text-[#6D5848]">
      <Loader2 className="h-5 w-5 animate-spin" />

      <span className="text-[10px] font-medium">
        {label}
      </span>
    </div>
  );
}

/* =========================================================
   MEDIA
   ========================================================= */

function MediaView({
  element,
}: {
  element: CanvasElement;
}) {
  const mediaUrl =
    String(
      element.media_url ?? '',
    ).trim();

  if (!mediaUrl) {
    return (
      <MediaUnavailable
        element={element}
      />
    );
  }

  const kind =
    detectMediaKind(
      element,
    );

  const objectFit =
    element.object_fit ||
    'cover';

  /* =======================================================
     GIF
     ======================================================= */

  if (kind === 'gif') {
    return (
      <div className="relative h-full w-full overflow-hidden bg-transparent">
        <img
          src={mediaUrl}
          alt={
            element.content ||
            'Animated GIF'
          }
          draggable={false}
          loading="eager"
          decoding="async"
          referrerPolicy="no-referrer"
          className="block h-full w-full select-none"
          style={{
            objectFit,
            objectPosition:
              'center center',
          }}
          onError={(event) => {
            console.error(
              'Journal GIF failed to load:',
              {
                url: mediaUrl,
                mediaType:
                  element.media_type,
                element,
              },
            );

            const target =
              event.currentTarget;

            target.style.display =
              'none';

            const parent =
              target.parentElement;

            if (
              parent &&
              !parent.querySelector(
                '[data-gif-error="true"]',
              )
            ) {
              const error =
                document.createElement(
                  'div',
                );

              error.dataset.gifError =
                'true';

              error.className =
                'absolute inset-0 flex flex-col items-center justify-center bg-[#F7EFE3] p-4 text-center text-[#5D4737]';

              error.innerHTML = `
                <div style="font-weight:600;font-size:14px">
                  GIF could not be loaded
                </div>
                <div style="font-size:10px;margin-top:6px;word-break:break-all;opacity:.7">
                  Check the Supabase Storage URL and bucket access.
                </div>
              `;

              parent.appendChild(
                error,
              );
            }
          }}
        />

        <div className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/60 px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-white shadow-sm backdrop-blur-sm">
          GIF
        </div>
      </div>
    );
  }

  /* =======================================================
     VIDEO
     ======================================================= */

  if (
    kind === 'video'
  ) {
    return (
      <div className="relative h-full w-full overflow-hidden bg-black">
        <video
          src={mediaUrl}
          controls
          playsInline
          preload="metadata"
          className="h-full w-full"
          style={{
            objectFit,
            objectPosition:
              'center center',
          }}
          onError={(event) => {
            console.error(
              'Journal video failed to load:',
              mediaUrl,
              event,
            );
          }}
        />

        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[10px] text-white shadow-sm backdrop-blur-sm">
          <Play className="h-3 w-3 fill-current" />
          Video
        </div>
      </div>
    );
  }

  /* =======================================================
     AUDIO
     ======================================================= */

  if (
    kind === 'audio'
  ) {
    return (
      <div className="flex h-full w-full flex-col justify-center gap-3 border border-[#BFAF9E] bg-[#F7EFE3] p-4">
        <div className="flex min-w-0 items-center gap-2 font-serif text-sm font-bold text-[#3D2B1F]">
          <Volume2 className="h-5 w-5 shrink-0" />

          <span className="truncate">
            {element.content ||
              'Audio recording'}
          </span>
        </div>

        <audio
          src={mediaUrl}
          controls
          preload="metadata"
          className="w-full"
          onError={(event) => {
            console.error(
              'Journal audio failed to load:',
              mediaUrl,
              event,
            );
          }}
        />
      </div>
    );
  }

  /* =======================================================
     IMAGE
     ======================================================= */

  if (
    kind === 'image'
  ) {
    return (
      <div className="relative h-full w-full overflow-hidden bg-transparent">
        <img
          src={mediaUrl}
          alt={
            element.content ||
            'Journal image'
          }
          draggable={false}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="block h-full w-full select-none"
          style={{
            objectFit,
            objectPosition:
              'center center',
          }}
          onError={(event) => {
            console.error(
              'Journal image failed to load:',
              {
                url: mediaUrl,
                mediaType:
                  element.media_type,
                element,
              },
            );
          }}
        />
      </div>
    );
  }

  /* =======================================================
     UNKNOWN
     ======================================================= */

  /**
   * Old journal records may not contain a valid media_type.
   *
   * Try the URL as an image before declaring it unavailable.
   *
   * GIFs never reach this block because detectMediaKind()
   * identifies .gif first.
   */
  return (
    <div className="relative h-full w-full overflow-hidden bg-transparent">
      <img
        src={mediaUrl}
        alt={
          element.content ||
          'Journal media'
        }
        draggable={false}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        className="block h-full w-full select-none"
        style={{
          objectFit,
          objectPosition:
            'center center',
        }}
        onError={(event) => {
          console.error(
            'Unknown journal media failed to load:',
            {
              url: mediaUrl,
              mediaType:
                element.media_type,
              element,
            },
          );

          const target =
            event.currentTarget;

          target.style.display =
            'none';

          const parent =
            target.parentElement;

          if (
            parent &&
            !parent.querySelector(
              '[data-media-error="true"]',
            )
          ) {
            const error =
              document.createElement(
                'div',
              );

            error.dataset.mediaError =
              'true';

            error.className =
              'absolute inset-0 flex flex-col items-center justify-center bg-[#F7EFE3] p-4 text-center text-[#5D4737]';

            error.innerHTML = `
              <div style="font-weight:600;font-size:14px">
                Media could not be loaded
              </div>
              <div style="font-size:10px;margin-top:6px;word-break:break-all;opacity:.7">
                Check the media URL and Supabase Storage access.
              </div>
            `;

            parent.appendChild(
              error,
            );
          }
        }}
      />
    </div>
  );
}

/* =========================================================
   CANVAS ELEMENT
   ========================================================= */

export function renderCanvasElement(
  element: CanvasElement,
) {
  const common: React.CSSProperties =
    {
      position:
        'absolute',

      left:
        element.position_x,

      top:
        element.position_y,

      width:
        element.width,

      height:
        element.height,

      zIndex:
        element.z_index ?? 1,

      opacity:
        element.opacity ?? 1,

      transform:
        `rotate(${element.rotation || 0}deg)`,

      transformOrigin:
        'center center',

      boxSizing:
        'border-box',

      pointerEvents:
        'auto',
    };

  /* =======================================================
     TEXT
     ======================================================= */

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

            lineHeight:
              1.35,

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

  /* =======================================================
     MEDIA
     ======================================================= */

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

  /* =======================================================
     LINK
     ======================================================= */

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

  /* =======================================================
     DRAWING
     ======================================================= */

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

  /* =======================================================
     SHAPE
     ======================================================= */

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

  /* =======================================================
     ICON
     ======================================================= */

  if (element.type === 'icon') {
    return (
      <div
        key={element.id}
        className="flex select-none items-center justify-center overflow-visible"
        style={{
          ...common,
          fontSize: Math.min(element.width, element.height) * 0.72,
          lineHeight: 1,
          color: element.color || '#2b2520',
          userSelect: 'none',
        }}
      >
        {element.content || '✦'}
      </div>
    );
  }

  /* =======================================================
     STICKER
     ======================================================= */

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

        lineHeight:
          1,

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

/* =========================================================
   MAIN RENDERER
   ========================================================= */

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

  const safeScale =
    Number.isFinite(scale) &&
    scale > 0
      ? scale
      : 1;

  const sortedElements =
    [...normalized].sort(
      (a, b) =>
        a.z_index -
        b.z_index,
    );

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      data-interactive={
        interactive
          ? 'true'
          : 'false'
      }
      style={{
        width:
          CANVAS_WIDTH *
          safeScale,

        height:
          CANVAS_HEIGHT *
          safeScale,

        background:
          'transparent',

        position:
          'relative',

        flexShrink: 0,
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

          transform:
            `scale(${safeScale})`,

          overflow:
            'hidden',
        }}
      >
        {sortedElements.map(
          renderCanvasElement,
        )}
      </div>
    </div>
  );
}