/* ============================================================
   Video project model.

   The editor manipulates THIS state — never a rendered file.
   Undo/redo snapshots are cheap (plain JSON, source clips are
   referenced by URL, not duplicated). Export renders this model
   once, on demand.

   Designed so future features (keyframes, chroma key, captions,
   beat detection…) slot in as new optional fields without a
   schema break: everything lives in nested, versioned JSON.
   ============================================================ */

export type AspectRatio = 'original' | '16:9' | '9:16' | '1:1' | '4:5';

export type ElementKind = 'text' | 'sticker' | 'image' | 'video' | 'gif' | 'shape';

export type TransitionType = 'none' | 'fade' | 'crossfade' | 'slide' | 'zoom' | 'wipe';

/** Crop window as fractions (0-1) of the SOURCE frame, kept per side. */
export interface CropRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ClipTransform {
  scale: number;       // 1 = fit (uniform user zoom)
  scale_x: number;     // axis fit factor: rendered width = cover-fit width × scale × scale_x
  scale_y: number;     // axis fit factor: rendered height = cover-fit height × scale × scale_y
  offset_x: number;    // px in canvas space (from center)
  offset_y: number;
  rotation: number;    // degrees
  flip_h: boolean;
  flip_v: boolean;
  crop: CropRect | null; // 0-1 fractions of the source frame
}

export interface ClipAdjustments {
  brightness: number;  // 100 = normal
  contrast: number;
  saturate: number;
  hue: number;         // degrees
  blur: number;        // px
  sepia: number;       // 0-100
  grayscale: number;   // 0-100
}

export interface AudioProcessing {
  noiseReduction: number;
  highPassHz: number;
  lowPassHz: number;
  compressor: boolean;
}

export interface VideoClip {
  id: string;
  /** storage/CDN url of the source file (never duplicated per edit) */
  src: string;
  /** original file name (for library display) */
  name: string;
  /** full duration of the source video, seconds */
  sourceDuration: number;
  /** source pixel dimensions (used for on-canvas box math; optional for legacy projects) */
  source_width?: number;
  source_height?: number;
  /** trim window inside the source */
  trimStart: number;
  trimEnd: number;
  speed: number;                 // 0.25 … 4
  volume: number;                // 0-1 (original audio)
  muted: boolean;
  reverse?: boolean;
  audioProcessing?: AudioProcessing;
  track_id?: string;
  transform: ClipTransform;
  adjustments: ClipAdjustments;
  filter: string;                // css filter preset id or 'none'
  /** motion effect applied while this clip plays (renders into the export) */
  effect: EffectType;
  /** transition INTO this clip (plays over the previous clip's tail) */
  transitionIn: { type: TransitionType; duration: number };
}

/** Extensible effect ids — new effects append here; renderer switches on id. */
export type EffectType = 'none' | 'zoom' | 'shake' | 'pulse' | 'vignette';

export const EFFECT_PRESETS: { id: EffectType; name: string; hint: string }[] = [
  { id: 'none', name: 'None', hint: 'No motion effect' },
  { id: 'zoom', name: 'Zoom in', hint: 'Slow push-in over the clip' },
  { id: 'shake', name: 'Shake', hint: 'Handheld camera shake' },
  { id: 'pulse', name: 'Pulse', hint: 'Rhythmic scale pulse' },
  { id: 'vignette', name: 'Vignette', hint: 'Darkened corners' },
];

export interface TimelineTrack {
  id: string;
  name: string;
  kind: 'video' | 'audio' | 'overlay';
  order: number;
  muted?: boolean;
  locked?: boolean;
}

/* ---------- keyframes ----------

   Keyframes live on timeline ELEMENTS (text/sticker/image/video/gif),
   stored in project JSON. `t` is seconds relative to the element's own
   start — so keyframes survive moving the element on the timeline.
   Between keyframes values interpolate LINEARLY; before the first and
   after the last keyframe the value is held (constant). The element's
   static property remains the fallback when a property has no keyframes.
   ---------------------------------------------------------------- */

/* Note: property ids deliberately avoid names that already exist on
   TimelineElement (x/y/scale/rotation/opacity/volume are numbers there) —
   keyframe lists live under *_kf keys so the two never collide. */
export type KeyframeProperty = 'pos_x_kf' | 'pos_y_kf' | 'scale_kf' | 'rotation_kf' | 'opacity_kf' | 'volume_kf';

export const KEYFRAMABLE_PROPERTIES: { id: KeyframeProperty; label: string; min: number; max: number }[] = [
  { id: 'pos_x_kf', label: 'Position X', min: -2000, max: 4000 },
  { id: 'pos_y_kf', label: 'Position Y', min: -2000, max: 4000 },
  { id: 'scale_kf', label: 'Scale', min: 0.05, max: 4 },
  { id: 'rotation_kf', label: 'Rotation', min: -180, max: 180 },
  { id: 'opacity_kf', label: 'Opacity', min: 0, max: 1 },
  { id: 'volume_kf', label: 'Volume', min: 0, max: 1 },
];

export interface ElementKeyframe {
  id: string;
  /** seconds after the element's start; always ≥ 0 */
  t: number;
  value: number;
}

export type ElementKeyframeMap = Partial<Record<KeyframeProperty, ElementKeyframe[]>>;

/** Linear interpolation over a sorted keyframe list; holds at the ends. */
export function sampleKeyframes(kfs: ElementKeyframe[] | undefined, t: number, fallback: number): number {
  if (!kfs || kfs.length === 0) return fallback;
  if (kfs.length === 1) return kfs[0].value;
  if (t <= kfs[0].t) return kfs[0].value;
  const last = kfs[kfs.length - 1];
  if (t >= last.t) return last.value;
  for (let i = 1; i < kfs.length; i++) {
    if (t <= kfs[i].t) {
      const a = kfs[i - 1];
      const b = kfs[i];
      const span = b.t - a.t;
      if (span <= 1e-6) return b.value;
      const u = (t - a.t) / span;
      return a.value + (b.value - a.value) * u;
    }
  }
  return last.value;
}

/** Insert-or-replace a keyframe at time t (replaces one within 0.05s). Returns the updated MAP. */
export function upsertKeyframe(el: TimelineElement, prop: KeyframeProperty, t: number, value: number): ElementKeyframeMap {
  const map: ElementKeyframeMap = { ...(el.keyframes || {}) };
  const list = [...(map[prop] || [])];
  const existing = list.findIndex((k) => Math.abs(k.t - t) < 0.05);
  if (existing >= 0) list[existing] = { ...list[existing], value };
  else list.push({ id: makeVideoId('kf'), t, value });
  list.sort((a, b) => a.t - b.t);
  map[prop] = list;
  return map;
}

/** Remove one keyframe; drops the property entirely when the list empties. Returns the updated MAP (undefined when empty). */
export function removeKeyframe(el: TimelineElement, prop: KeyframeProperty, keyframeId: string): ElementKeyframeMap | undefined {
  const map: ElementKeyframeMap = { ...(el.keyframes || {}) };
  const list = (map[prop] || []).filter((k) => k.id !== keyframeId);
  if (list.length === 0) delete map[prop];
  else map[prop] = list;
  return Object.keys(map).length ? map : undefined;
}

/**
 * Animated values for an element at a moment in time.
 * `timeIn` is seconds after the element start. Static fields are the
 * fallback so a property without keyframes behaves exactly as before.
 */
export function resolveElementValues(
  el: TimelineElement,
  timeIn: number
): { x: number; y: number; scale: number; rotation: number; opacity: number; volume: number } {
  const kf = el.keyframes;
  return {
    x: sampleKeyframes(kf?.pos_x_kf, timeIn, el.x),
    y: sampleKeyframes(kf?.pos_y_kf, timeIn, el.y),
    scale: sampleKeyframes(kf?.scale_kf, timeIn, 1),
    rotation: sampleKeyframes(kf?.rotation_kf, timeIn, el.rotation),
    opacity: Math.max(0, Math.min(1, sampleKeyframes(kf?.opacity_kf, timeIn, el.opacity))),
    volume: Math.max(0, Math.min(1, sampleKeyframes(kf?.volume_kf, timeIn, el.volume ?? 1))),
  };
}

export interface TimelineElement {
  id: string;
  kind: ElementKind;
  /** text content / emoji / sticker value / image url */
  content: string;
  /** media url for images; null for text/emoji */
  src: string | null;
  /** Optional timeline lane. Legacy projects may omit this. */
  track_id?: string;
  /** seconds relative to the PROJECT timeline */
  start: number;
  end: number;
  x: number;            // px from canvas left
  y: number;            // px from canvas top
  width: number;
  height: number;
  rotation: number;
  opacity: number;      // 0-1
  z: number;
  /** video-overlay crop, fractions of the SOURCE frame (video/image kinds) */
  crop?: CropRect | null;
  /* text-only */
  font_size?: number;
  font_family?: string;
  font_weight?: number;
  color?: string;
  align?: 'left' | 'center' | 'right';
  background?: string | null;
  stroke_color?: string | null;
  shadow?: boolean;
  animation?: 'none' | 'fade' | 'pop' | 'slide-up';
  // Optional video-overlay fields kept for backward-compatible project JSON.
  media_type?: string;
  source_duration?: number;
  trim_start?: number;
  trim_end?: number;
  speed?: number;
  volume?: number;
  muted?: boolean;
  reverse?: boolean;
  object_fit?: 'contain' | 'cover';
  flip_h?: boolean;
  flip_v?: boolean;
  /** per-property keyframes (see KeyframeProperty); omitted when none */
  keyframes?: ElementKeyframeMap;
}

export interface AudioTrack {
  id: string;
  name: string;
  src: string;
  /** seconds into the project where playback begins */
  start: number;
  /** trim window inside the source audio */
  trimStart: number;
  trimEnd: number;
  volume: number;       // 0-1
  fadeIn: number;       // seconds
  fadeOut: number;      // seconds
  kind: 'music' | 'voiceover';
}

export interface VideoProject {
  version: 1 | 2;
  aspect: AspectRatio;
  canvas: { width: number; height: number };
  clips: VideoClip[];
  elements: TimelineElement[];
  audio: AudioTrack[];
  /** Timeline lanes used by the editor UI. Kept alongside legacy clips/elements/audio arrays. */
  tracks: TimelineTrack[];
  /* project-wide original-audio mute */
  masterMuted: boolean;
}

export const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 4];

export const FILTER_PRESETS: { id: string; name: string; css: string }[] = [
  { id: 'none', name: 'Original', css: '' },
  { id: 'warm', name: 'Warm', css: 'sepia(0.25) saturate(1.3) brightness(1.05)' },
  { id: 'cool', name: 'Cool', css: 'hue-rotate(15deg) saturate(1.1) brightness(1.02)' },
  { id: 'mono', name: 'Mono', css: 'grayscale(1) contrast(1.1)' },
  { id: 'vivid', name: 'Vivid', css: 'saturate(1.6) contrast(1.15)' },
  { id: 'faded', name: 'Faded', css: 'contrast(0.85) brightness(1.1) saturate(0.8)' },
  { id: 'dramatic', name: 'Dramatic', css: 'contrast(1.4) brightness(0.92) saturate(1.2)' },
  { id: 'dream', name: 'Dream', css: 'blur(1px) brightness(1.08) saturate(1.15)' },
];

export const CANVAS_SIZES: Record<Exclude<AspectRatio, 'original'>, { width: number; height: number }> = {
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
};

export const DEFAULT_AUDIO_PROCESSING: AudioProcessing = {
  noiseReduction: 0,
  highPassHz: 80,
  lowPassHz: 14000,
  compressor: false,
};

/* ---------- crop + geometry helpers (shared editor ↔ renderer) ---------- */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Validate/clamp a crop so it can never invert or vanish (each side ≤ 45%). */
export function sanitizeCrop(input: Partial<CropRect> | null | undefined): CropRect | null {
  if (!input || typeof input !== 'object') return null;
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const crop: CropRect = {
    top: clamp(num(input.top), 0, 0.45),
    right: clamp(num(input.right), 0, 0.45),
    bottom: clamp(num(input.bottom), 0, 0.45),
    left: clamp(num(input.left), 0, 0.45),
  };
  /* a crop that removes ≥ 90% of a axis is degenerate — drop it */
  if (crop.top + crop.bottom >= 0.9 || crop.left + crop.right >= 0.9) return null;
  return crop;
}

/** Aspect ratio of the source frame AFTER cropping. */
export function croppedAspect(sourceAspect: number, crop: CropRect | null | undefined): number {
  if (!crop) return sourceAspect;
  const w = sourceAspect * (1 - crop.left - crop.right);
  const h = 1 - crop.top - crop.bottom;
  return w / Math.max(0.05, h);
}

/** Cover-fit a region of `aspect` into a box: returns the drawn size. */
export function coverFit(boxW: number, boxH: number, aspect: number): { w: number; h: number } {
  const boxAspect = boxW / Math.max(1, boxH);
  if (aspect > boxAspect) return { w: boxH * aspect, h: boxH };
  return { w: boxW, h: boxW / aspect };
}

export function normalizeProject(input: unknown): VideoProject {
  const raw = (input && typeof input === 'object' ? input : {}) as Partial<VideoProject> & Record<string, unknown>;
  const aspect = (['original', '16:9', '9:16', '1:1', '4:5'] as AspectRatio[]).includes(raw.aspect as AspectRatio)
    ? raw.aspect as AspectRatio
    : 'original';
  const fallbackCanvas = aspect === 'original' ? { width: 1080, height: 1350 } : { ...CANVAS_SIZES[aspect] };
  const canvasRaw = raw.canvas && typeof raw.canvas === 'object' ? raw.canvas as { width?: unknown; height?: unknown } : {};
  const canvas = {
    width: Number.isFinite(Number(canvasRaw.width)) && Number(canvasRaw.width) > 0 ? Number(canvasRaw.width) : fallbackCanvas.width,
    height: Number.isFinite(Number(canvasRaw.height)) && Number(canvasRaw.height) > 0 ? Number(canvasRaw.height) : fallbackCanvas.height,
  };

  const clips: VideoClip[] = Array.isArray(raw.clips) ? raw.clips.map((c) => {
    const clip = (c && typeof c === 'object' ? c : {}) as Partial<VideoClip> & Record<string, unknown>;
    const sourceDuration = Math.max(0.2, Number(clip.sourceDuration) || 5);
    const trimStart = Math.max(0, Math.min(sourceDuration - 0.1, Number(clip.trimStart) || 0));
    const trimEnd = Math.max(trimStart + 0.1, Math.min(sourceDuration, Number(clip.trimEnd) || sourceDuration));
    const transformRaw = (clip.transform && typeof clip.transform === 'object' ? clip.transform : {}) as Partial<ClipTransform>;
    const transform: ClipTransform = {
      ...DEFAULT_TRANSFORM,
      ...transformRaw,
      scale: clamp(Number(transformRaw.scale) || 1, 0.1, 4),
      scale_x: clamp(Number(transformRaw.scale_x) || 1, 0.05, 4),
      scale_y: clamp(Number(transformRaw.scale_y) || 1, 0.05, 4),
      offset_x: Number(transformRaw.offset_x) || 0,
      offset_y: Number(transformRaw.offset_y) || 0,
      rotation: Number(transformRaw.rotation) || 0,
      flip_h: Boolean(transformRaw.flip_h),
      flip_v: Boolean(transformRaw.flip_v),
      crop: sanitizeCrop(transformRaw.crop),
    };
    const adjustments = { ...DEFAULT_ADJUSTMENTS, ...(clip.adjustments && typeof clip.adjustments === 'object' ? clip.adjustments : {}) } as ClipAdjustments;
    const audioProcessing = { ...DEFAULT_AUDIO_PROCESSING, ...(clip.audioProcessing && typeof clip.audioProcessing === 'object' ? clip.audioProcessing : {}) } as AudioProcessing;
    return {
      id: String(clip.id || makeVideoId('clip')), src: String(clip.src || ''), name: String(clip.name || 'Untitled clip'),
      sourceDuration, trimStart, trimEnd, speed: Math.max(0.05, Number(clip.speed) || 1),
      volume: Math.max(0, Math.min(1, clip.volume == null ? 1 : Number(clip.volume))), muted: Boolean(clip.muted),
      reverse: Boolean(clip.reverse), audioProcessing, track_id: clip.track_id ? String(clip.track_id) : undefined, transform, adjustments, filter: String(clip.filter || 'none'),
      effect: (clip.effect || 'none') as EffectType,
      transitionIn: { ...DEFAULT_TRANSITION, ...(clip.transitionIn && typeof clip.transitionIn === 'object' ? clip.transitionIn : {}) } as VideoClip['transitionIn'],
      ...(Number(clip.source_width) > 0 ? { source_width: Number(clip.source_width) } : {}),
      ...(Number(clip.source_height) > 0 ? { source_height: Number(clip.source_height) } : {}),
    };
  }) : [];

  const elements: TimelineElement[] = Array.isArray(raw.elements) ? raw.elements.map((e) => {
    const el = (e && typeof e === 'object' ? e : {}) as Partial<TimelineElement> & Record<string, unknown>;
    const kind = (['text', 'sticker', 'image', 'video', 'gif', 'shape'] as ElementKind[]).includes(el.kind as ElementKind) ? el.kind as ElementKind : 'text';
    return {
      id: String(el.id || makeVideoId('el')), kind, content: String(el.content || ''), src: el.src == null ? null : String(el.src),
      track_id: el.track_id ? String(el.track_id) : undefined,
      start: Math.max(0, Number(el.start) || 0), end: Math.max(0.2, Number(el.end) || 0.2),
      x: Number(el.x) || 0, y: Number(el.y) || 0, width: Math.max(1, Number(el.width) || 200), height: Math.max(1, Number(el.height) || 150),
      rotation: Number(el.rotation) || 0, opacity: Math.max(0, Math.min(1, el.opacity == null ? 1 : Number(el.opacity))), z: Number(el.z) || 1,
      ...(el.crop !== undefined ? { crop: sanitizeCrop(el.crop as Partial<CropRect>) } : {}),
      ...(el.font_size != null ? { font_size: Number(el.font_size) } : {}), ...(el.font_family ? { font_family: String(el.font_family) } : {}),
      ...(el.font_weight != null ? { font_weight: Number(el.font_weight) } : {}), ...(el.color ? { color: String(el.color) } : {}),
      ...(el.align ? { align: el.align as TimelineElement['align'] } : {}), ...(el.background !== undefined ? { background: el.background as string | null } : {}),
      ...(el.stroke_color !== undefined ? { stroke_color: el.stroke_color as string | null } : {}),
      ...(el.shadow !== undefined ? { shadow: Boolean(el.shadow) } : {}), ...(el.animation ? { animation: el.animation as TimelineElement['animation'] } : {}),
      ...(el.media_type ? { media_type: String(el.media_type) } : {}), ...(el.source_duration != null ? { source_duration: Number(el.source_duration) } : {}),
      ...(el.trim_start != null ? { trim_start: Number(el.trim_start) } : {}), ...(el.trim_end != null ? { trim_end: Number(el.trim_end) } : {}),
      ...(el.speed != null ? { speed: Number(el.speed) } : {}), ...(el.volume != null ? { volume: Number(el.volume) } : {}),
      ...(el.muted !== undefined ? { muted: Boolean(el.muted) } : {}), ...(el.reverse !== undefined ? { reverse: Boolean(el.reverse) } : {}),
      ...(el.object_fit ? { object_fit: el.object_fit === 'cover' ? 'cover' : 'contain' } : {}),
      flip_h: Boolean(el.flip_h),
      flip_v: Boolean(el.flip_v),
      ...(sanitizeKeyframes(el.keyframes) ? { keyframes: sanitizeKeyframes(el.keyframes) } : {}),
    };
  }) : [];

  const audio: AudioTrack[] = Array.isArray(raw.audio) ? raw.audio.map((a) => {
    const track = (a && typeof a === 'object' ? a : {}) as Partial<AudioTrack> & Record<string, unknown>;
    return {
      id: String(track.id || makeVideoId('aud')), name: String(track.name || 'Audio'), src: String(track.src || ''),
      start: Math.max(0, Number(track.start) || 0), trimStart: Math.max(0, Number(track.trimStart) || 0),
      trimEnd: Math.max(0.1, Number(track.trimEnd) || 0.1), volume: Math.max(0, Math.min(1, Number(track.volume) || 0)),
      fadeIn: Math.max(0, Number(track.fadeIn) || 0), fadeOut: Math.max(0, Number(track.fadeOut) || 0),
      kind: track.kind === 'voiceover' ? 'voiceover' : 'music',
    };
  }) : [];

  const tracks: TimelineTrack[] = Array.isArray(raw.tracks)
    ? (raw.tracks as unknown[]).map((value, index) => {
        const t = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
        return {
          id: String(t.id || makeVideoId('track')),
          name: String(t.name || `Track ${index + 1}`),
          kind: t.kind === 'audio' || t.kind === 'overlay' ? t.kind : 'video',
          order: Number.isFinite(Number(t.order)) ? Number(t.order) : index,
          muted: Boolean(t.muted),
          locked: Boolean(t.locked),
        } as TimelineTrack;
      })
    : [];

  const safeTracks: TimelineTrack[] = tracks.length
    ? [...tracks].sort((a, b) => a.order - b.order)
    : [
        { id: 'track-main', name: 'Main video', kind: 'video', order: 0, muted: false, locked: false },
        { id: 'track-overlay', name: 'Overlays', kind: 'overlay', order: 1, muted: false, locked: false },
        { id: 'track-audio', name: 'Audio', kind: 'audio', order: 2, muted: false, locked: false },
      ];

  return { version: 2, aspect, canvas, clips, elements, audio, tracks: safeTracks, masterMuted: Boolean(raw.masterMuted) };
}

export function addTimelineTrack<T extends VideoClip | AudioTrack | TimelineElement>(
  project: VideoProject,
  track?: T | TimelineTrack,
  kind: 'clip' | 'audio' | 'element' = 'clip'
): VideoProject {
  const normalized = normalizeProject(project);
  if (!track) {
    const nextKind: TimelineTrack['kind'] = kind === 'audio' ? 'audio' : kind === 'element' ? 'overlay' : 'video';
    const next: TimelineTrack = {
      id: makeVideoId('track'),
      name: nextKind === 'audio' ? 'Audio track' : nextKind === 'overlay' ? 'Overlay track' : 'Video track',
      kind: nextKind,
      order: normalized.tracks.length,
    };
    return { ...normalized, tracks: [...normalized.tracks, next] };
  }
  if ('name' in (track as object) && 'kind' in (track as object) && 'order' in (track as object)) {
    return { ...normalized, tracks: [...normalized.tracks, track as TimelineTrack] };
  }
  if (kind === 'audio') return { ...normalized, audio: [...normalized.audio, track as AudioTrack] };
  if (kind === 'element') {
    const el = track as TimelineElement;
    return { ...normalized, elements: [...normalized.elements, el] };
  }
  return { ...normalized, clips: [...normalized.clips, track as VideoClip] };
}

export function removeTimelineTrack(project: VideoProject, trackId?: string): VideoProject {
  const normalized = normalizeProject(project);
  if (!trackId) return normalized;
  const tracks = normalized.tracks.filter((t) => t.id !== trackId);
  const elements = normalized.elements.filter((e) => e.track_id !== trackId);
  const clips = normalized.clips.filter((c) => c.track_id !== trackId);
  return { ...normalized, tracks: tracks.length ? tracks : normalized.tracks, elements, clips };
}

export function moveElementToTrack(project: VideoProject, elementId?: string, trackId?: string): VideoProject {
  const normalized = normalizeProject(project);
  if (!elementId || !trackId || !normalized.tracks.some((t) => t.id === trackId)) return normalized;
  return {
    ...normalized,
    elements: normalized.elements.map((el) => el.id === elementId ? { ...el, track_id: trackId } : el),
  };
}

export const DEFAULT_TRANSFORM: ClipTransform = {
  scale: 1,
  scale_x: 1,
  scale_y: 1,
  offset_x: 0,
  offset_y: 0,
  rotation: 0,
  flip_h: false,
  flip_v: false,
  crop: null,
};

export const DEFAULT_ADJUSTMENTS: ClipAdjustments = {
  brightness: 100,
  contrast: 100,
  saturate: 100,
  hue: 0,
  blur: 0,
  sepia: 0,
  grayscale: 0,
};

export const DEFAULT_TRANSITION = { type: 'none' as TransitionType, duration: 0.5 };

export function makeVideoId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export function emptyProject(aspect: AspectRatio = 'original'): VideoProject {
  const canvas =
    aspect === 'original' ? { width: 1080, height: 1350 } : { ...CANVAS_SIZES[aspect] };
  return {
    version: 1,
    aspect,
    canvas,
    clips: [],
    elements: [],
    audio: [],
    tracks: [
      { id: 'track-main', name: 'Main video', kind: 'video', order: 0, muted: false, locked: false },
      { id: 'track-overlay', name: 'Overlays', kind: 'overlay', order: 1, muted: false, locked: false },
      { id: 'track-audio', name: 'Audio', kind: 'audio', order: 2, muted: false, locked: false },
    ],
    masterMuted: false,
  };
}

/** Effective on-timeline duration of a clip (trim × speed). */
export function clipDuration(clip: VideoClip): number {
  const trimmed = Math.max(0.1, clip.trimEnd - clip.trimStart);
  return trimmed / Math.max(clip.speed, 0.05);
}

export function projectDuration(project: VideoProject): number {
  const clipsEnd = project.clips.reduce((acc, c) => acc + clipDuration(c), 0);
  const elementsEnd = project.elements.reduce((acc, e) => Math.max(acc, e.end), 0);
  const audioEnd = project.audio.reduce(
    (acc, a) => Math.max(acc, a.start + Math.max(0.1, a.trimEnd - a.trimStart)),
    0
  );
  return Math.max(clipsEnd, elementsEnd, audioEnd, 0.1);
}

/** Which clip is playing at project time t (index, or -1). */
export function clipIndexAtTime(project: VideoProject, t: number): number {
  let acc = 0;
  for (let i = 0; i < project.clips.length; i++) {
    const d = clipDuration(project.clips[i]);
    if (t < acc + d) return i;
    acc += d;
  }
  return project.clips.length - 1; // past the end: hold last frame
}

/** Map project time → { clip, timeInsideClipSource } for preview/render. */
export function resolveTime(project: VideoProject, t: number): { clip: VideoClip; sourceTime: number } | null {
  let acc = 0;
  for (const clip of project.clips) {
    const d = clipDuration(clip);
    if (t < acc + d) {
      const local = t - acc;
      return { clip, sourceTime: clip.trimStart + local * clip.speed };
    }
    acc += d;
  }
  return project.clips.length ? { clip: project.clips[project.clips.length - 1], sourceTime: project.clips[project.clips.length - 1].trimEnd } : null;
}

/** Sanitize a keyframe map coming from storage: finite values only, sorted, deduped. */
function sanitizeKeyframes(input: unknown): ElementKeyframeMap | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const out: ElementKeyframeMap = {};
  const valid: KeyframeProperty[] = ['pos_x_kf', 'pos_y_kf', 'scale_kf', 'rotation_kf', 'opacity_kf', 'volume_kf'];
  for (const prop of valid) {
    const raw = (input as Record<string, unknown>)[prop];
    if (!Array.isArray(raw)) continue;
    const list: ElementKeyframe[] = [];
    for (const item of raw) {
      const k = (item && typeof item === 'object' ? item : {}) as Partial<ElementKeyframe>;
      const t = Number(k.t);
      const value = Number(k.value);
      if (!Number.isFinite(t) || t < 0 || !Number.isFinite(value)) continue;
      list.push({ id: String(k.id || makeVideoId('kf')), t, value });
    }
    list.sort((a, b) => a.t - b.t);
    /* drop duplicates on the same time (keep the later entry) */
    const deduped = list.filter((k, i) => i === 0 || Math.abs(k.t - list[i - 1].t) >= 0.01);
    if (deduped.length > 0) out[prop] = deduped;
  }
  return Object.keys(out).length ? out : undefined;
}

/* ---------- template placeholders ---------- */

export interface TemplatePlaceholder {
  slot: number;
  label: string;         // "Your video 1", "Photo here", …
  kind: 'video' | 'image';
}

/** A template project uses `placeholder://slot/N` srcs that the user fills. */
export function placeholderSrc(slot: number) {
  return `placeholder://slot/${slot}`;
}

export function isPlaceholder(src: string | null | undefined) {
  return !!src && src.startsWith('placeholder://');
}

export function templatePlaceholders(project: VideoProject): TemplatePlaceholder[] {
  const slots = new Set<number>();
  for (const clip of project.clips) {
    if (isPlaceholder(clip.src)) {
      const n = Number(clip.src.split('/').pop());
      if (!Number.isNaN(n)) slots.add(n);
    }
  }
  return Array.from(slots)
    .sort((a, b) => a - b)
    .map((slot) => ({ slot, label: `Media ${slot + 1}`, kind: 'video' as const }));
}

/** Fill one placeholder slot with a user file url; returns a new project. */
export function fillPlaceholder(project: VideoProject, slot: number, src: string, sourceDuration: number, name: string): VideoProject {
  return {
    ...project,
    clips: project.clips.map((clip) =>
      clip.src === placeholderSrc(slot)
        ? {
            ...clip,
            src,
            name,
            sourceDuration: sourceDuration || clip.sourceDuration || 10,
            trimEnd: Math.min(clip.trimEnd || 10, sourceDuration || clip.trimEnd || 10),
          }
        : clip
    ),
  };
}
