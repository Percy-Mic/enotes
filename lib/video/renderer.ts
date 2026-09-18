/* ============================================================
   Video export renderer — the part that makes the editor REAL.

   Renders the VideoProject frame-by-frame onto a canvas:
     • source clips with trim, speed, reverse, transform (scale/
       per-axis scale/offset/rotation/flip/crop), CSS-filter
       adjustments and per-clip transitions (fade/crossfade/
       slide/zoom/wipe)
     • text overlays (font, size, weight, color, align, bg,
       outline, shadow, opacity, animations) at their start→end
     • stickers/emojis/images/GIF/video overlays — with their own
       crop, timed, layered by z
     • project audio (music + voiceover) mixed with volume,
       fades, playbackRate (speed) and per-clip cleanup through a
       WebAudio graph into the recording

   Frames are captured via canvas.captureStream() and encoded by
   MediaRecorder → WebM/MP4. This runs 100% client-side. The same
   drawFrame() powers the live preview, so what you see is what
   exports — including crop, resize, position and speed.

   Browser support: Chrome/Edge (webm/vp9 or vp8+opus), Firefox
   (webm), Safari ≥ 14.1 (mp4 where available). Fallbacks below.
   ============================================================ */

import {
  clipDuration, FILTER_PRESETS, resolveTime, projectDuration, normalizeProject, isPlaceholder,
  coverFit, croppedAspect, resolveElementValues,
  type VideoProject, type TimelineElement, type VideoClip, type CropRect,
} from '@/lib/video/project';

export interface ExportSettings {
  resolutionHeight: number;      // 720 | 1080 | 1440 | 2160
  fps: number;                   // 24 | 30 | 60
  qualityBitrate: number;        // bits/sec
  format: 'webm';                // MediaRecorder containers actually supported
}

export const EXPORT_QUALITY_PRESETS: { id: string; name: string; bitrate: number }[] = [
  { id: 'low', name: 'Smaller file', bitrate: 2_500_000 },
  { id: 'medium', name: 'Balanced', bitrate: 6_000_000 },
  { id: 'high', name: 'High quality', bitrate: 12_000_000 },
];

export type ExportPhase = 'preparing' | 'processing' | 'rendering' | 'uploading' | 'complete' | 'failed' | 'cancelled';

export interface ExportProgress {
  phase: ExportPhase;
  percent: number;      // 0-100
  message: string;
}

export interface ExportResult {
  blob: Blob;
  url: string;
  durationSeconds: number;
  width: number;
  height: number;
  format: string;
}

/** Thrown when the user cancels an in-flight export — the editor
    shows "cancelled", not "failed". */
export class ExportCancelledError extends Error {
  constructor() {
    super('Export cancelled.');
    this.name = 'ExportCancelledError';
  }
}

/* ---------- media loading (cached so re-exports are instant) ---------- */

const videoCache = new Map<string, HTMLVideoElement>();
const videoLoading = new Map<string, Promise<HTMLVideoElement>>();

// Playback state is deliberately separate from the project clock. The browser
// decoder owns the clock while playing; the editor only seeks when the active
// clip changes or the playhead jumps. This prevents the seek/play/seek/play
// loop that caused the preview to blink.
interface PlaybackRecord { lastTarget: number; playing: boolean; rate: number }
const playbackState = new Map<string, PlaybackRecord>();

/**
 * Keep one cached <video> aligned with the project clock.
 * `rate` is the clip's speed — applied as playbackRate so the decoder
 * plays faster/slower NATURALLY (no per-frame reseek fighting, correct
 * audio pitch-handling in export, and trim×speed timing stays exact).
 *
 * REVERSE (bug fix): a <video> decoder can only advance FORWARD — calling
 * play() on a reversed clip after seeking made the frame run backwards
 * (seek) then forwards again (decode) every frame, so the preview visibly
 * stuttered forward and the exported frames were wrong too. Reversed
 * playback is therefore a pure seek-per-frame render: the element stays
 * PAUSED and holds each frame while drawFrame paints it at the editor's
 * frame rate, exactly like scrubbing.
 */
function syncPlaybackVideo(
  video: HTMLVideoElement,
  src: string,
  target: number,
  playing: boolean,
  forceSeek = false,
  rate = 1,
  reverse = false
) {
  const state = playbackState.get(src);
  const safeTarget = Math.max(0, target);
  const rateChanged = !state || Math.abs(state.rate - rate) > 0.001;
  /* Reversed playback advances ONLY by seeking (per-frame), so it gets a
     near-zero threshold — coarse thresholds would let the project clock run
     ahead while the picture repeats the same frame (judder/freeze). */
  const needsSeek =
    forceSeek || !state ||
    Math.abs(video.currentTime - safeTarget) > (playing && !reverse ? 0.45 : playing && reverse ? 0.02 : 0.12) ||
    (state && Math.abs(state.lastTarget - safeTarget) > 0.8);

  if (rateChanged) {
    try { video.playbackRate = Math.min(16, Math.max(0.0625, rate)); } catch { /* out of range */ }
  }

  if (!playing) {
    if (!video.paused) video.pause();
    playbackState.set(src, { lastTarget: safeTarget, playing: false, rate });
    return needsSeek ? seekAndWait(video, safeTarget) : Promise.resolve();
  }

  if (playing && reverse) {
    if (!video.paused) video.pause();
    const seeked = needsSeek ? seekAndWait(video, safeTarget) : Promise.resolve();
    playbackState.set(src, { lastTarget: safeTarget, playing: false, rate });
    return seeked;
  }

  if (needsSeek) {
    try { video.currentTime = safeTarget; } catch { /* decoder keeps its last frame */ }
  }
  if (video.paused) void video.play().catch(() => undefined);
  playbackState.set(src, { lastTarget: safeTarget, playing: true, rate });
  return Promise.resolve();
}

function pauseInactiveVideos(activeSources: Set<string>) {
  videoCache.forEach((video, src) => {
    if (!activeSources.has(src) && !video.paused) video.pause();
  });
}

/**
 * Seek a video element and WAIT for the frame to actually be available.
 * Setting currentTime is asynchronous — drawing immediately afterwards
 * captures the PREVIOUS frame, which is why previews could show stale
 * frames/black frames while scrubbing. The timeout keeps playback smooth
 * if a seek stalls.
 */
function seekAndWait(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    const onSeeked = () => {
      /* Prefer a frame-presented callback (exact frame on screen) when the
         browser supports it; fall back to resolving immediately. */
      type RVFC = { requestVideoFrameCallback?: (cb: () => void) => number };
      const rvfc = video as unknown as RVFC;
      if (typeof rvfc.requestVideoFrameCallback === 'function') {
        rvfc.requestVideoFrameCallback!(() => finish());
        window.setTimeout(finish, 120); // rVFC fires right after present; belt & braces
      } else {
        finish();
      }
    };
    video.addEventListener('seeked', onSeeked);
    try {
      video.currentTime = Math.max(0, time);
    } catch {
      finish();
      return;
    }
    window.setTimeout(finish, 500); // slow storage/large files — was 120ms (too short)
  });
}

/**
 * Some sources (MediaRecorder webm, certain phone mp4s) report duration as
 * Infinity until you seek past the end — Chrome's documented quirk. Every
 * seek we make then lands past the last decodable frame → black preview and
 * black exports. This forces the browser to resolve the real duration once.
 */
export function normalizeVideoDuration(video: HTMLVideoElement): Promise<number> {
  return new Promise((resolve) => {
    if (Number.isFinite(video.duration) && video.duration > 0) {
      resolve(video.duration);
      return;
    }
    const done = (d: number) => {
      video.removeEventListener('timeupdate', onTime);
      video.ontimeupdate = null;
      try { video.currentTime = 0; } catch { /* ignore */ }
      resolve(Number.isFinite(d) && d > 0 ? d : 0);
    };
    const onTime = () => done(video.duration);
    video.addEventListener('timeupdate', onTime);
    try {
      video.currentTime = 1e101; // jump far past the end to force duration resolution
    } catch {
      done(NaN);
    }
    window.setTimeout(() => done(video.duration), 3000); // never hang
  });
}

function loadVideo(src: string): Promise<HTMLVideoElement> {
  const cached = videoCache.get(src);
  if (cached) return Promise.resolve(cached);
  const pending = videoLoading.get(src);
  if (pending) return pending;

  const promise = new Promise<HTMLVideoElement>((resolve, reject) => {
    const video = document.createElement('video');
    // CORS MUST be set before src, otherwise some CDN/Supabase responses
    // become unusable by canvas and can appear as intermittent blank frames.
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.src = src;

    const timeout = window.setTimeout(() => {
      videoLoading.delete(src);
      reject(new Error('Timed out loading video — the source may be unreachable or in a format this browser cannot decode.'));
    }, 20000);

    const fail = () => {
      window.clearTimeout(timeout);
      videoLoading.delete(src);
      reject(new Error(`Could not load video: ${src.slice(0, 60)}…`));
    };

    video.onerror = fail;
    video.onloadeddata = async () => {
      try {
        window.clearTimeout(timeout);
        await normalizeVideoDuration(video);
        videoCache.set(src, video);
        videoLoading.delete(src);
        resolve(video);
      } catch (e) {
        videoLoading.delete(src);
        reject(e);
      }
    };
  });
  videoLoading.set(src, promise);
  return promise;
}

/* ============================================================
   REVERSED-FRAME CACHE — makes reverse actually usable.

   Measured on MediaRecorder-produced WebM (the app's own uploads and
   recordings): a FORWARD seek averages ~150ms, but a BACKWARD seek
   averages ~390ms (the files carry almost no cue points, so the decoder
   re-scans from the start). Per-frame seek-based reverse therefore plays
   at ~2.5 fps, stutters in preview, desyncs realtime exports and can even
   produce a broken recording.

   Fix: for reversed clips we walk the source ONCE, forward (fast), and
   snapshot fixed-size poster frames into memory. Reversed playback and
   export then paint pure cache hits — no seeks at all — so reverse runs
   at the editor's full frame rate.

   Bounds: fixed 160×90 thumbnails (≈77 KB each; a 60s clip ≈ 7 MB),
   capped at 2 cached sources (oldest evicted), invalidated whenever a
   clip for that source is edited (updateClip → invalidateReversedCache).
   Falls back to the old seek-per-frame path when memory is unavailable.
   ============================================================ */

interface ReverseFrame { t: number; bmp: ImageBitmap | HTMLCanvasElement }
interface ReverseCacheEntry { frames: ReverseFrame[]; builtAt: number }
/* Frame width: 160px previews looked blocky the moment a reversed clip was
   exported (×7 upscale to a 1080p canvas). 400px survives a 1080p export
   acceptably while keeping memory bounded. */
const REVERSE_THUMB_W = 400;
/* Hard budget: at most 450 snapshots per source (worst case ≈ 160 MB of
   bitmaps). Longer trims widen the step instead of growing memory. */
const REVERSE_MAX_FRAMES = 450;
const REVERSE_MAX_SOURCES = 2;
const reverseCache = new Map<string, ReverseCacheEntry>();

/** Invalidate the reversed-frame cache for a source (call on clip edit). */
export function invalidateReversedCache(src?: string) {
  if (src) reverseCache.delete(src);
  else reverseCache.clear();
}

function evictReverseCache() {
  while (reverseCache.size >= REVERSE_MAX_SOURCES) {
    let oldestKey = '';
    let oldestAt = Infinity;
    reverseCache.forEach((entry, key) => {
      if (entry.builtAt < oldestAt) { oldestAt = entry.builtAt; oldestKey = key; }
    });
    if (!oldestKey) break;
    reverseCache.delete(oldestKey);
  }
}

/**
 * A video element used ONLY by the reversed-frame cache build.
 *
 * Why not the shared loadVideo element: while the build walks the source
 * (hundreds of seeks over several seconds), the preview render loop is
 * simultaneously seeking/drawing that SAME element for the seek-path
 * fallback — the two fight and the preview shows torn/stale frames until
 * the build finishes. A detached element is invisible and owned solely by
 * the build; it is deliberately NOT put into videoCache.
 */
async function loadDetachedVideo(src: string): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.src = src;
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('reverse-cache load timeout')), 20000);
    video.onerror = () => { window.clearTimeout(timeout); reject(new Error('reverse-cache load error')); };
    video.onloadeddata = () => { window.clearTimeout(timeout); resolve(); };
  });
  await normalizeVideoDuration(video); // Infinity-duration WebM guard
  return video;
}

/**
 * Snapshot the clip's trimmed range into fixed-interval poster frames,
 * scanning FORWARD (the fast direction) with waits for each decoded frame.
 * Step starts at 1/10s; for trims longer than the frame budget the step
 * widens (still covering the full trim) rather than growing memory.
 * Returns [] when snapshotting isn't possible (decoder stalls); caller
 * falls back to the seek path.
 */
async function buildReverseFrames(video: HTMLVideoElement, src: string, trimStart: number, trimEnd: number): Promise<ReverseFrame[]> {
  const from = Math.max(0, trimStart);
  const to = Math.max(from + 0.1, Math.min(trimEnd, video.duration || trimEnd));
  const span = to - from;
  const STEP = Math.max(0.1, span / REVERSE_MAX_FRAMES);
  const frames: ReverseFrame[] = [];
  const canvas = document.createElement('canvas');
  canvas.width = REVERSE_THUMB_W;
  canvas.height = Math.max(1, Math.round((REVERSE_THUMB_W * (video.videoHeight || 9)) / (video.videoWidth || 16)));
  const c2d = canvas.getContext('2d');
  if (!c2d) return [];

  /* Capture strategy: PLAY through the trimmed range once and snapshot on a
     timer, instead of seek-per-frame. Two reasons, both measured:
     • Seeking fires `seeked` the moment the position moves, often BEFORE the
       new frame is decoded — on slow/remote decodes that intermittently
       captures the PREVIOUS frame or a black one, which showed up as black
       gaps in reversed exports.
     • Forward playback is the decoder's fast path; a full pass costs about
       the trim duration and every snapshot is a fully-presented frame
       (rVFC-confirmed when available, last-known-frame otherwise).
     Frames are keyed on the forward timeline, so coverage beats exactness:
     a dropped snapshot simply leaves the neighbors in charge. */
  const snapshot = async (t: number) => {
    c2d.drawImage(video, 0, 0, canvas.width, canvas.height);
    let stored: ImageBitmap | HTMLCanvasElement = canvas;
    if (typeof createImageBitmap === 'function') {
      try { stored = await createImageBitmap(canvas); } catch { stored = canvas; }
    }
    // canvas is re-drawn every step — copy when bitmap creation failed
    if (stored === canvas) {
      const copy = document.createElement('canvas');
      copy.width = canvas.width; copy.height = canvas.height;
      copy.getContext('2d')!.drawImage(canvas, 0, 0);
      stored = copy;
    }
    frames.push({ t, bmp: stored });
  };

  video.pause();
  await seekAndWait(video, from);
  if (video.readyState < 2) return []; // decoder gave up — no cache

  let raf = 0;
  const t0 = performance.now();
  let nextT = from;
  await new Promise<void>((resolve) => {
    const done = () => {
      video.pause();
      if (raf) cancelAnimationFrame(raf);
      resolve();
    };
    const advance = () => {
      if (video.paused || video.ended || video.currentTime >= to - STEP / 2 || nextT > to + 1e-6) {
        done();
        return;
      }
      if (video.currentTime >= nextT) {
        void snapshot(Math.min(nextT, video.currentTime));
        nextT += STEP;
      }
    };
    type RVFC = { requestVideoFrameCallback?: (cb: () => void) => number };
    const rvfc = video as unknown as RVFC;
    if (typeof rvfc.requestVideoFrameCallback === 'function') {
      const loopFrame = () => {
        advance();
        if (!video.paused && !video.ended && nextT <= to + 1e-6) rvfc.requestVideoFrameCallback!(loopFrame);
      };
      /* advance() snapshots synchronously-drawn current frame — good enough
         here; the async bitmap conversion lands before the frame is consumed */
      rvfc.requestVideoFrameCallback(loopFrame);
    } else {
      const rafTick = () => {
        advance();
        if (!video.paused && !video.ended && nextT <= to + 1e-6) raf = requestAnimationFrame(rafTick);
      };
      raf = requestAnimationFrame(rafTick);
    }
    video.addEventListener('ended', done, { once: true });
    void video.play().catch(() => {});
    /* safety: never hang the build — bounded by the playthrough itself */
    window.setTimeout(done, ((span / Math.max(0.25, video.playbackRate)) + 6) * 1000);
  });

  /* Playthrough done (or safety-timed-out). Fill any grid slots the pass
     missed — usually the very end — with cheap targeted seeks so reversed
     playback never shows a stale gap at the boundary. */
  for (let t = from; t <= to + 1e-6; t += STEP) {
    if (frames.some((f) => Math.abs(f.t - t) < STEP / 2)) continue;
    await seekAndWait(video, Math.min(t, to));
    if (video.readyState < 2) break;
    snapshot(Math.min(t, to));
  }
  return frames;
}

/**
 * Nearest cached frame for source time t. Cache frames are keyed on the
 * FORWARD timeline, so for reversed playback the visual time maps directly.
 */
function nearestReverseFrame(entry: ReverseCacheEntry, t: number): ReverseFrame | null {
  const frames = entry.frames;
  if (!frames.length) return null;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t < t) lo = mid + 1; else hi = mid;
  }
  const after = frames[lo];
  const before = frames[Math.max(0, lo - 1)];
  return Math.abs(before.t - t) <= Math.abs(after.t - t) ? before : after;
}

const imageCache = new Map<string, HTMLImageElement>();

function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src);
  if (cached && cached.complete) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageCache.set(src, img);
      resolve(img);
    };
    img.onerror = () => reject(new Error(`Could not load image: ${src.slice(0, 60)}…`));
  });
}

/* ---------- motion effects (rendered into the export, not just preview) ---------- */

export interface EffectOffset { scaleMul: number; dx: number; dy: number }

function effectTransform(clip: VideoClip, timeIn: number, dur: number): EffectOffset {
  switch (clip.effect) {
    case 'zoom': {
      const p = Math.min(1, Math.max(0, timeIn / Math.max(dur, 0.1)));
      return { scaleMul: 1 + 0.12 * p, dx: 0, dy: 0 };
    }
    case 'shake': {
      const t = timeIn * 18;
      return { scaleMul: 1.04, dx: Math.sin(t) * 6, dy: Math.cos(t * 1.7) * 6 };
    }
    case 'pulse': {
      const s = 1 + 0.04 * Math.sin((timeIn * Math.PI * 2) / 0.8);
      return { scaleMul: s, dx: 0, dy: 0 };
    }
    default:
      return { scaleMul: 1, dx: 0, dy: 0 };
  }
}

/* ---------- source/destination rect for one clip ----------
   The cropped region of the source is cover-fit into the canvas,
   then multiplied by the user's scale / per-axis scale. This keeps
   crop aspect-correct (no stretching) and identical in preview,
   timeline thumbs and export. */
function clipDrawRect(
  clip: VideoClip,
  canvasW: number,
  canvasH: number,
  videoW: number,
  videoH: number,
  eff: EffectOffset = { scaleMul: 1, dx: 0, dy: 0 }
): { sx: number; sy: number; sw: number; sh: number; dw: number; dh: number } {
  const { scale, scale_x, scale_y, crop } = clip.transform;
  const srcAspect = videoW / Math.max(1, videoH);
  const effAspect = croppedAspect(srcAspect, crop);
  const cover = coverFit(canvasW, canvasH, effAspect);
  const dw = cover.w * scale * scale_x * eff.scaleMul;
  const dh = cover.h * scale * scale_y * eff.scaleMul;

  const c: CropRect | null = crop;
  const sx = c ? c.left * videoW : 0;
  const sy = c ? c.top * videoH : 0;
  const sw = Math.max(1, videoW * (1 - (c?.left || 0) - (c?.right || 0)));
  const sh = Math.max(1, videoH * (1 - (c?.top || 0) - (c?.bottom || 0)));
  return { sx, sy, sw, sh, dw, dh };
}

function filterCssFor(clip: VideoClip): string {
  const preset = FILTER_PRESETS.find((f) => f.id === clip.filter);
  const parts: string[] = [];
  if (preset && preset.css) parts.push(preset.css);
  const a = clip.adjustments;
  if (a.brightness !== 100) parts.push(`brightness(${a.brightness}%)`);
  if (a.contrast !== 100) parts.push(`contrast(${a.contrast}%)`);
  if (a.saturate !== 100) parts.push(`saturate(${a.saturate}%)`);
  if (a.hue !== 0) parts.push(`hue-rotate(${a.hue}deg)`);
  if (a.blur > 0) parts.push(`blur(${a.blur}px)`);
  if (a.sepia > 0) parts.push(`sepia(${a.sepia}%)`);
  if (a.grayscale > 0) parts.push(`grayscale(${a.grayscale}%)`);
  return parts.join(' ');
}

/* ---------- overlays ---------- */

function drawTextElement(ctx: CanvasRenderingContext2D, el: TimelineElement, canvasW: number, timeIn: number) {
  const fontSize = el.font_size || 48;
  const weight = el.font_weight || 700;
  /* keyframed values (fall back to the static fields when the property
     has no keyframes — identical behavior for keyframe-free elements) */
  const v = resolveElementValues(el, timeIn);
  ctx.save();
  ctx.globalAlpha = v.opacity;

  // entry animation
  let progress = 1;
  if (el.animation && el.animation !== 'none') {
    const ANIM = 0.4; // seconds
    progress = Math.min(1, timeIn / ANIM);
    if (el.animation === 'fade') ctx.globalAlpha = v.opacity * progress;
    if (el.animation === 'pop') ctx.scale(0.8 + 0.2 * easeOut(progress), 0.8 + 0.2 * easeOut(progress));
    if (el.animation === 'slide-up') ctx.translate(0, (1 - easeOut(progress)) * 40);
  }

  ctx.translate(v.x + el.width / 2, v.y + el.height / 2);
  ctx.rotate((v.rotation * Math.PI) / 180);
  if (v.scale !== 1) ctx.scale(v.scale, v.scale);

  ctx.font = `${weight} ${fontSize}px ${el.font_family || 'Poppins, sans-serif'}`;
  ctx.textAlign = (el.align || 'center') as CanvasTextAlign;
  ctx.textBaseline = 'middle';

  const lines = (el.content || '').split('\n');
  const lineHeight = fontSize * 1.25;
  const totalHeight = lines.length * lineHeight;

  if (el.background) {
    const metrics = ctx.measureText(lines.reduce((a, b) => (a.length > b.length ? a : b), ''));
    ctx.fillStyle = el.background;
    const padX = fontSize * 0.4;
    const padY = fontSize * 0.25;
    ctx.fillRect(-metrics.width / 2 - padX, -totalHeight / 2 - padY, metrics.width + padX * 2, totalHeight + padY * 2);
  }

  lines.forEach((line, i) => {
    const y = -totalHeight / 2 + lineHeight * (i + 0.5);
    if (el.stroke_color) {
      ctx.strokeStyle = el.stroke_color;
      ctx.lineWidth = Math.max(2, fontSize / 12);
      ctx.strokeText(line, 0, y);
    }
    if (el.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = fontSize / 5;
      ctx.shadowOffsetY = 2;
    } else {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
    }
    ctx.fillStyle = el.color || '#FFFFFF';
    ctx.fillText(line, 0, y);
  });

  void canvasW;
  ctx.restore();
}

function easeOut(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

/** Contain/cover fit of a (possibly cropped) source into an element box. */
function fitIntoBox(
  srcW: number,
  srcH: number,
  boxW: number,
  boxH: number,
  fit: 'contain' | 'cover'
): { dw: number; dh: number } {
  const srcAspect = srcW / Math.max(1, srcH);
  const boxAspect = boxW / Math.max(1, boxH);
  let dw = boxW;
  let dh = boxH;
  if (fit === 'contain') {
    if (srcAspect > boxAspect) dh = dw / srcAspect;
    else dw = dh * srcAspect;
  } else {
    if (srcAspect > boxAspect) dw = dh * srcAspect;
    else dh = dw / srcAspect;
  }
  return { dw, dh };
}

function drawImageElement(ctx: CanvasRenderingContext2D, el: TimelineElement, timeIn: number) {
  const img = imageCache.get(el.src || '');
  if (!img) return;
  const v = resolveElementValues(el, timeIn);
  ctx.save();
  ctx.globalAlpha = v.opacity;
  let scale = v.scale;
  if (el.animation === 'pop') {
    const progress = Math.min(1, timeIn / 0.35);
    scale *= 0.7 + 0.3 * easeOut(progress);
  }
  ctx.translate(v.x + el.width / 2, v.y + el.height / 2);
  ctx.rotate((v.rotation * Math.PI) / 180);
  ctx.scale(scale * (el.flip_h ? -1 : 1), scale * (el.flip_v ? -1 : 1));

  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const crop = el.crop || null;
  const sx = crop ? crop.left * iw : 0;
  const sy = crop ? crop.top * ih : 0;
  const sw = Math.max(1, iw * (1 - (crop?.left || 0) - (crop?.right || 0)));
  const sh = Math.max(1, ih * (1 - (crop?.top || 0) - (crop?.bottom || 0)));
  const { dw, dh } = fitIntoBox(sw, sh, el.width, el.height, el.object_fit || 'contain');
  ctx.drawImage(img, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

async function drawVideoElement(ctx: CanvasRenderingContext2D, el: TimelineElement, timeIn: number, previewing = false, playing = false) {
  if (!el.src) return;
  const video = await loadVideo(el.src);
  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : (el.source_duration || 10);
  const speed = Math.max(0.05, el.speed || 1);
  const trimStart = Math.max(0, el.trim_start || 0);
  const trimEnd = Math.min(duration, Math.max(trimStart + 0.01, el.trim_end || duration));
  const target = Math.min(trimEnd - 0.01, Math.max(trimStart, trimStart + timeIn * speed));
  await syncPlaybackVideo(video, el.src, target, !!playing, !previewing, speed, false);
  if (video.readyState < 2) return;

  const v = resolveElementValues(el, timeIn);
  /* keyframed/static volume drives the element's own audio in preview;
     export schedules the same curve through WebAudio (see export()) */
  try {
    if (!el.muted) video.volume = Math.max(0, Math.min(1, v.volume));
  } catch { /* volume setter is universally supported; belt and braces */ }

  ctx.save();
  ctx.globalAlpha = v.opacity;
  ctx.translate(v.x + el.width / 2, v.y + el.height / 2);
  ctx.rotate((v.rotation * Math.PI) / 180);
  ctx.scale(v.scale * (el.flip_h ? -1 : 1), v.scale * (el.flip_v ? -1 : 1));

  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;
  const crop = el.crop || null;
  const sx = crop ? crop.left * vw : 0;
  const sy = crop ? crop.top * vh : 0;
  const sw = Math.max(1, vw * (1 - (crop?.left || 0) - (crop?.right || 0)));
  const sh = Math.max(1, vh * (1 - (crop?.top || 0) - (crop?.bottom || 0)));
  const { dw, dh } = fitIntoBox(sw, sh, el.width, el.height, el.object_fit || 'contain');
  ctx.drawImage(video, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

/* ---------- transitions ---------- */

function applyTransition(
  ctx: CanvasRenderingContext2D,
  type: string,
  duration: number,
  timeIn: number,
  canvasW: number,
  canvasH: number
): { overlayAlpha: number } {
  if (!type || type === 'none' || duration <= 0) return { overlayAlpha: 0 };
  const progress = Math.min(1, timeIn / duration);

  if (type === 'fade') {
    ctx.fillStyle = `rgba(0,0,0,${1 - easeOut(progress)})`;
    ctx.fillRect(0, 0, canvasW, canvasH);
  } else if (type === 'crossfade') {
    // previous frame trails: approximate with a translucent black pull-up
    ctx.fillStyle = `rgba(0,0,0,${(1 - easeOut(progress)) * 0.6})`;
    ctx.fillRect(0, 0, canvasW, canvasH);
  } else if (type === 'slide') {
    const shift = (1 - easeOut(progress)) * canvasW;
    ctx.drawImage(ctx.canvas, shift, 0); // self-blend gives a slide smear
    ctx.save();
    ctx.globalCompositeOperation = 'copy';
    ctx.restore();
  } else if (type === 'zoom') {
    const scale = 1 + (1 - easeOut(progress)) * 0.25;
    ctx.save();
    ctx.translate(canvasW / 2, canvasH / 2);
    ctx.scale(scale, scale);
    ctx.translate(-canvasW / 2, -canvasH / 2);
    ctx.drawImage(ctx.canvas, 0, 0);
    ctx.restore();
  } else if (type === 'wipe') {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, canvasW * easeOut(progress), canvasH);
    ctx.clip();
    ctx.restore();
  }
  return { overlayAlpha: 0 };
}

/* ---------- original clip audio + basic voice cleanup ---------- */

function reverseAudioSegment(ctx: AudioContext, buffer: AudioBuffer, start: number, end: number): AudioBuffer {
  const sr = buffer.sampleRate;
  const from = Math.max(0, Math.floor(start * sr));
  const to = Math.min(buffer.length, Math.ceil(end * sr));
  const length = Math.max(1, to - from);
  const out = ctx.createBuffer(buffer.numberOfChannels, length, sr);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const input = buffer.getChannelData(ch);
    const output = out.getChannelData(ch);
    for (let i = 0; i < length; i++) output[i] = input[to - 1 - i] || 0;
  }
  return out;
}

function connectAudioProcessing(
  audioCtx: AudioContext,
  source: AudioBufferSourceNode,
  volume: number,
  processing: NonNullable<VideoClip['audioProcessing']>
): AudioNode {
  const gain = audioCtx.createGain();
  gain.gain.value = Math.max(0, volume);
  let node: AudioNode = gain;

  const reduction = Math.max(0, Math.min(100, processing.noiseReduction || 0));
  if (reduction > 0) {
    // Browser-only lightweight cleanup: remove low rumble and high hiss.
    // This is intentionally conservative; true spectral denoise requires a
    // server/worker DSP pipeline and should be a separate premium effect.
    const high = audioCtx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = Math.min(500, Math.max(60, processing.highPassHz || 80) + reduction * 1.2);
    high.Q.value = 0.7;

    const low = audioCtx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = Math.max(5000, Math.min(18000, (processing.lowPassHz || 14000) - reduction * 35));
    low.Q.value = 0.7;

    source.connect(high).connect(low).connect(gain);
  } else {
    source.connect(gain);
  }

  if (processing.compressor) {
    const compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -22;
    compressor.knee.value = 18;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.18;
    gain.connect(compressor);
    node = compressor;
  }
  return node;
}

/* ============================================================
   The renderer
   ============================================================ */

export class VideoRenderer {
  private ctx: CanvasRenderingContext2D | null = null;
  /** Set when the most recent drawFrame hit an undecodable/unreachable clip
      source; cleared on the next successful draw. The editor surfaces this. */
  lastSourceError: string | null = null;

  /** Set while an export is running — the editor guards double-exports. */
  isExporting = false;

  /** Cooperative cancellation flag for the running export. */
  private exportCancelled = false;

  /** Sources whose reversed-frame cache is currently being built (one build at a time per source). */
  private reverseCacheBuilding = new Set<string>();

  /** Cancel the in-flight export (safe to call anytime). */
  cancelExport() {
    this.exportCancelled = true;
  }

  /** Draw one project-time frame onto the given canvas. Shared by preview + export. */
  async drawFrame(
    canvas: HTMLCanvasElement,
    project: VideoProject,
    time: number,
    opts: { previewing?: boolean; playing?: boolean } = {}
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    project = normalizeProject(project);
    this.ctx = ctx;
    const { width: W, height: H } = project.canvas;
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);

    const resolved = resolveTime(project, time);
    if (resolved) {
      const { clip } = resolved;
      /* clip timing — shared by effects and transitions. Reverse is handled
         HERE (resolveTime maps forward only) so reversed clips preview AND
         export with the picture actually running backwards. */
      let acc = 0;
      for (const c of project.clips) {
        if (c.id === clip.id) break;
        acc += clipDuration(c);
      }
      const local = Math.max(0, time - acc);
      const trimmed = Math.max(0.1, clip.trimEnd - clip.trimStart);
      const sourceTime = clip.reverse
        ? Math.max(clip.trimStart, clip.trimEnd - local * clip.speed)
        : Math.min(clip.trimEnd, clip.trimStart + local * clip.speed);
      const timeIn = Math.max(0, time - acc);
      const dur = clipDuration(clip);
      const eff = effectTransform(clip, timeIn, dur);
      try {
        const video = await loadVideo(clip.src);
        const target = clip.reverse
          ? Math.max(clip.trimStart, sourceTime)
          : Math.min(sourceTime, Math.max(0, (clip.sourceDuration || 0) - 0.05));
        if (video.readyState >= 2) {
          this.lastSourceError = null;
          const t = clipDrawRect(clip, W, H, video.videoWidth, video.videoHeight, eff);

          /* REVERSE, fast path: paint from the pre-built frame cache instead
             of seek-per-frame (~2.5 fps measured → unusable). Cache is built
             on first sight of the reversed clip; while it builds (one fast
             forward pass) frames fall back to the seek path, then playback
             is pure memory hits at full frame rate. */
          let paintedFromCache = false;
          if (clip.reverse) {
            let entry = reverseCache.get(clip.src);
            if (!entry && !this.reverseCacheBuilding.has(clip.src)) {
              this.reverseCacheBuilding.add(clip.src);
              /* A DETACHED element is used for the build — seeking the shared
                 loadVideo element here would fight the preview's own
                 seek/play loop and tear frames until the build finished. */
              loadDetachedVideo(clip.src)
                .then((builder) => buildReverseFrames(builder, clip.src, clip.trimStart, clip.trimEnd))
                .then((frames) => {
                  if (frames.length) { evictReverseCache(); reverseCache.set(clip.src, { frames, builtAt: Date.now() }); }
                })
                .catch(() => { /* fall back to seek path silently */ })
                .finally(() => this.reverseCacheBuilding.delete(clip.src));
            }
            entry = reverseCache.get(clip.src);
            const frame = entry ? nearestReverseFrame(entry, sourceTime) : null;
            if (frame) {
              ctx.save();
              ctx.translate(W / 2 + clip.transform.offset_x + eff.dx, H / 2 + clip.transform.offset_y + eff.dy);
              ctx.rotate((clip.transform.rotation * Math.PI) / 180);
              ctx.scale(clip.transform.flip_h ? -1 : 1, clip.transform.flip_v ? -1 : 1);
              ctx.filter = filterCssFor(clip) || 'none';
              // cache frames keep the source's aspect — dest rect already matches
              ctx.drawImage(frame.bmp as CanvasImageSource, -t.dw / 2, -t.dh / 2, t.dw, t.dh);
              ctx.filter = 'none';
              ctx.restore();
              paintedFromCache = true;
            }
          }

          if (!paintedFromCache) {
            await syncPlaybackVideo(video, clip.src, target, !!opts.playing, !opts.previewing, clip.speed, !!clip.reverse);
            ctx.save();
            ctx.translate(W / 2 + clip.transform.offset_x + eff.dx, H / 2 + clip.transform.offset_y + eff.dy);
            ctx.rotate((clip.transform.rotation * Math.PI) / 180);
            ctx.scale(clip.transform.flip_h ? -1 : 1, clip.transform.flip_v ? -1 : 1);
            ctx.filter = filterCssFor(clip) || 'none';
            ctx.drawImage(video, t.sx, t.sy, t.sw, t.sh, -t.dw / 2, -t.dh / 2, t.dw, t.dh);
            ctx.filter = 'none';
            ctx.restore();
          }

          // transition INTO this clip
          applyTransition(ctx, clip.transitionIn.type, clip.transitionIn.duration, timeIn, W, H);
        }
      } catch {
        // Source undecodable/unreachable (e.g. HEVC phone video, deleted file,
        // unfilled template placeholder). Surface WHY instead of a silent black
        // canvas — the editor reads lastSourceError to show a real explanation.
        this.lastSourceError = clip.src;
        ctx.save();
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#999';
        ctx.font = 'bold 44px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Media cannot be played', W / 2, H / 2 - 30);
        ctx.font = '30px sans-serif';
        ctx.fillStyle = '#666';
        const label = (clip.name || 'source file').slice(0, 40);
        ctx.fillText(label, W / 2, H / 2 + 24);
        ctx.restore();
      }
    }

    // overlays sorted by z
    const overlays = project.elements
      .filter((el) => time >= el.start && time < el.end)
      .sort((a, b) => a.z - b.z);

    for (const el of overlays) {
      const timeIn = Math.max(0, time - el.start);
      if (el.kind === 'text') {
        drawTextElement(ctx, el, W, timeIn);
      } else if (el.kind === 'video' || el.media_type === 'video') {
        try {
          await drawVideoElement(ctx, el, timeIn, !!opts.previewing, !!opts.playing);
        } catch {
          this.lastSourceError = el.src;
        }
      } else {
        if (el.src && !imageCache.has(el.src)) await loadImage(el.src).catch(() => undefined);
        drawImageElement(ctx, el, timeIn);
      }
    }

    const activeSources = new Set<string>();
    if (resolved?.clip.src) activeSources.add(resolved.clip.src);
    for (const el of overlays) {
      if (el.src && (el.kind === 'video' || el.media_type === 'video')) activeSources.add(el.src);
    }
    if (!opts.playing) {
      videoCache.forEach((video, src) => {
        if (!activeSources.has(src) && !video.paused) video.pause();
      });
    } else {
      pauseInactiveVideos(activeSources);
    }

    /* vignette effect darkens the composed frame (clip + overlays) */
    if (resolved && resolved.clip.effect === 'vignette') {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.72);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    void opts;
  }

  /**
   * Validate a project before export — cheap checks that produce CLEAR
   * errors instead of a black webm. Returns null when OK.
   */
  validateForExport(project: VideoProject): string | null {
    const p = normalizeProject(project);
    if (p.clips.length === 0 && p.elements.length === 0) {
      return 'The timeline is empty — add at least one clip or overlay before exporting.';
    }
    for (const clip of p.clips) {
      if (isPlaceholder(clip.src)) {
        return `"${clip.name}" is an unfilled template placeholder — import your media to replace it first.`;
      }
      if (!clip.src) {
        return `"${clip.name}" has no source file — re-import it or delete the clip.`;
      }
      if (clip.trimEnd - clip.trimStart <= 0.05) {
        return `"${clip.name}" is trimmed to nothing — extend its trim before exporting.`;
      }
    }
    for (const el of p.elements) {
      if ((el.kind === 'image' || el.kind === 'video') && !el.src) {
        return `An ${el.kind} overlay is missing its source — delete it or re-add the media.`;
      }
    }
    for (const a of p.audio) {
      if (!a.src) return `"${a.name}" has no audio file — remove it or re-add the sound.`;
    }
    return null;
  }

  /**
   * Full export: renders every frame in realtime-ish playback while
   * recording the canvas + mixed audio. Reports progress via callback.
   * Throws ExportCancelledError when cancelled; Error with a clear message
   * on validation / media / timeout failures.
   */
  async export(
    project: VideoProject,
    settings: ExportSettings,
    onProgress?: (p: ExportProgress) => void
  ): Promise<ExportResult> {
    if (this.isExporting) throw new Error('An export is already running — wait for it to finish or cancel it.');
    const invalid = this.validateForExport(project);
    if (invalid) throw new Error(invalid);

    this.isExporting = true;
    this.exportCancelled = false;

    try {
      onProgress?.({ phase: 'preparing', percent: 0, message: 'Loading media…' });

      const duration = projectDuration(project);
      const aspect = project.canvas.width / project.canvas.height;
      const outH = Math.min(settings.resolutionHeight, 2160);
      const outW = Math.round((outH * aspect) / 2) * 2;

      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable — your browser may block hardware-accelerated canvas.');

      /* scale project coords → output size */
      const scaleX = outW / project.canvas.width;
      const scaleY = outH / project.canvas.height;
      const scaled: VideoProject = {
        ...project,
        canvas: { width: outW, height: outH },
        clips: project.clips.map((c) => ({
          ...c,
          transform: {
            ...c.transform,
            offset_x: c.transform.offset_x * scaleX,
            offset_y: c.transform.offset_y * scaleY,
          },
        })),
        elements: project.elements.map((e) => ({
          ...e,
          x: e.x * scaleX,
          y: e.y * scaleY,
          width: e.width * scaleX,
          height: e.height * scaleY,
          font_size: e.font_size ? e.font_size * scaleY : undefined,
          /* PARITY FIX: keyframed positions are absolute pixels too — without
             rescaling them, an element animated with position keyframes would
             sit somewhere else in the export than in the preview whenever the
             output resolution differs from the project canvas. */
          keyframes: e.keyframes
            ? (Object.fromEntries(
                Object.entries(e.keyframes).map(([prop, frames]) => [
                  prop,
                  (frames as { id: string; t: number; value: number }[]).map((k) => ({
                    ...k,
                    value:
                      prop === 'pos_x_kf'
                        ? k.value * scaleX
                        : prop === 'pos_y_kf'
                          ? k.value * scaleY
                          : k.value,
                  })),
                ])
              ) as typeof e.keyframes)
            : undefined,
        })),
      };

      /* preload everything first so rendering doesn't stall — and FAIL
         LOUDLY when media can't be loaded (deleted file, expired signed
         URL, unsupported codec) instead of exporting a broken video. */
      const uniqueSources = Array.from(
        new Set([
          ...scaled.clips.map((c) => c.src),
          ...scaled.elements.filter((e) => e.src).map((e) => e.src!),
        ])
      ).filter((src) => !isPlaceholder(src));

      const failedClips = new Set<string>();
      for (const src of uniqueSources) {
        if (this.exportCancelled) throw new ExportCancelledError();
        const isVideoOverlay = scaled.elements.some((e) => e.src === src && (e.kind === 'video' || e.media_type === 'video'));
        const isImageOverlay = scaled.elements.some((e) => e.src === src && e.kind !== 'text' && e.kind !== 'video' && e.media_type !== 'video');
        try {
          if (scaled.clips.some((c) => c.src === src) || isVideoOverlay) await loadVideo(src);
          else if (isImageOverlay || /\.(gif|png|jpe?g|webp|avif)$/i.test(src)) await loadImage(src);
        } catch {
          const clip = scaled.clips.find((c) => c.src === src);
          if (clip) failedClips.add(clip.name || 'clip');
          else if (!isVideoOverlay && !isImageOverlay) {
            /* decorative asset the painter skips anyway — ignore */
          } else {
            failedClips.add('an overlay');
          }
        }
      }
      if (failedClips.size > 0) {
        throw new Error(
          `Unable to load ${Array.from(failedClips).join(', ')} — the file may have been deleted, the link expired, or the format is not supported by this browser.`
        );
      }

      /* REVERSE: build frame caches BEFORE the render loop starts, so
         reversed clips export from memory at full frame rate — a build
         during recording would fight the recorder for the decoder and
         desync the timeline. Falls back to the seek path when a source
         cannot be snapshotted. */
      const reversedClips = scaled.clips.filter((c) => c.reverse && !isPlaceholder(c.src));
      if (reversedClips.length) {
        onProgress?.({ phase: 'processing', percent: 4, message: 'Preparing reversed clips…' });
        for (const clip of reversedClips) {
          if (this.exportCancelled) throw new ExportCancelledError();
          if (reverseCache.has(clip.src) || this.reverseCacheBuilding.has(clip.src)) continue;
          try {
            const frames = await buildReverseFrames(await loadDetachedVideo(clip.src), clip.src, clip.trimStart, clip.trimEnd);
            if (frames.length) { evictReverseCache(); reverseCache.set(clip.src, { frames, builtAt: Date.now() }); }
          } catch { /* seek-path fallback for this source */ }
        }
      }

      onProgress?.({ phase: 'processing', percent: 5, message: 'Setting up audio mix…' });

      /* ---------- audio graph ---------- */
      /* Two independent recorder-killer modes, both reproduced:
         1) Chrome starts an AudioContext SUSPENDED when it was created after
            the user gesture's transient activation expired — exports do
            seconds of async media prep before this line.
         2) Some browsers never emit recorder data when the mixed stream
            carries an audio track whose source context yields no samples —
            even when the context REPORTS "running" (a silent-ended context
            also triggers this). Video-only streams always record fine.
         Strategy: resume the context, then PROBE a tiny recording; if the
         browser will not emit bytes with an audio track attached, fall back
         to a video-only stream — a silent export beats no export. */
      const audioCtx = new AudioContext();
      if (audioCtx.state === 'suspended') {
        try { await audioCtx.resume(); } catch { /* fall through */ }
      }
      const destination = audioCtx.createMediaStreamDestination();

      const recorderEmitsWithAudioTrack = async (): Promise<boolean> => {
        try {
          const osc = audioCtx.createOscillator();
          osc.frequency.value = 440;
          const probeGain = audioCtx.createGain();
          probeGain.gain.value = 0.05;
          osc.connect(probeGain).connect(destination);
          osc.start();
          const probeCanvas = document.createElement('canvas');
          probeCanvas.width = 64;
          probeCanvas.height = 64;
          const pctx = probeCanvas.getContext('2d');
          pctx?.fillRect(0, 0, 64, 64);
          const stream = new MediaStream([
            ...probeCanvas.captureStream(15).getVideoTracks(),
            ...destination.stream.getAudioTracks(),
          ]);
          const rec = new MediaRecorder(stream);
          const bytes = await new Promise<number>((resolve) => {
            let sum = 0;
            rec.ondataavailable = (e) => { sum += e.data.size; };
            rec.onstop = () => resolve(sum);
            rec.onerror = () => resolve(-1);
            rec.start();
            window.setTimeout(() => rec.stop(), 350);
          });
          osc.stop();
          stream.getTracks().forEach((t) => t.stop());
          return bytes > 0;
        } catch {
          return false;
        }
      };
      const audioRunnable =
        audioCtx.state === 'running' && (await recorderEmitsWithAudioTrack());
      if (!audioRunnable) {
        void audioCtx.close().catch(() => undefined);
      }
      const connectTrack = async (track: { src: string; volume: number; trimStart: number; fadeOutSec: number; fadeInSec: number; startAt: number; trackDuration: number }) => {
        try {
          const res = await fetch(track.src);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = await res.arrayBuffer();
          const decoded = await audioCtx.decodeAudioData(buf);
          const source = audioCtx.createBufferSource();
          source.buffer = decoded;

          const gain = audioCtx.createGain();
          const t0 = audioCtx.currentTime + track.startAt;
          const fadeIn = track.fadeInSec;
          const fadeOut = track.fadeOutSec;

          gain.gain.setValueAtTime(0.0001, t0);
          if (fadeIn > 0) {
            gain.gain.exponentialRampToValueAtTime(Math.max(track.volume, 0.001), t0 + fadeIn);
          } else {
            gain.gain.setValueAtTime(Math.max(track.volume, 0.001), t0);
          }
          if (fadeOut > 0) {
            gain.gain.setValueAtTime(Math.max(track.volume, 0.001), t0 + track.trackDuration - fadeOut);
            gain.gain.exponentialRampToValueAtTime(0.0001, t0 + track.trackDuration);
          }

          source.connect(gain).connect(destination);
          source.start(t0, track.trimStart, Math.max(0.1, track.trackDuration));
        } catch {
          /* audio decode failure shouldn't kill the video export */
        }
      };

      let startDelay = 0.3; // small lead-in for graph setup

      // Main-track original audio. Clips remain sequential in the visual track;
      // their decoded audio is scheduled at the exact same project positions.
      // playbackRate = clip.speed keeps audio in sync with speed-changed video.
      if (!scaled.masterMuted) {
        let clipStart = 0;
        for (const clip of scaled.clips) {
          const clipDurationSec = clipDuration(clip);
          if (!clip.muted && clip.volume > 0 && !isPlaceholder(clip.src)) {
            try {
              const res = await fetch(clip.src);
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const array = await res.arrayBuffer();
              const decoded = await audioCtx.decodeAudioData(array);
              const source = audioCtx.createBufferSource();
              const trimLength = Math.max(0.05, clip.trimEnd - clip.trimStart);
              if (clip.reverse) {
                source.buffer = reverseAudioSegment(audioCtx, decoded, clip.trimStart, clip.trimEnd);
                source.playbackRate.value = Math.max(0.0625, Math.min(16, clip.speed));
                const processed = connectAudioProcessing(audioCtx, source, clip.volume, {
                  noiseReduction: clip.audioProcessing?.noiseReduction || 0,
                  highPassHz: clip.audioProcessing?.highPassHz || 80,
                  lowPassHz: clip.audioProcessing?.lowPassHz || 14000,
                  compressor: clip.audioProcessing?.compressor || false,
                });
                processed.connect(destination);
                source.start(audioCtx.currentTime + startDelay + clipStart, 0, trimLength);
              } else {
                source.buffer = decoded;
                source.playbackRate.value = Math.max(0.0625, Math.min(16, clip.speed));
                const processed = connectAudioProcessing(audioCtx, source, clip.volume, {
                  noiseReduction: clip.audioProcessing?.noiseReduction || 0,
                  highPassHz: clip.audioProcessing?.highPassHz || 80,
                  lowPassHz: clip.audioProcessing?.lowPassHz || 14000,
                  compressor: clip.audioProcessing?.compressor || false,
                });
                processed.connect(destination);
                source.start(audioCtx.currentTime + startDelay + clipStart, clip.trimStart, trimLength);
              }
            } catch {
              // Some video containers/codecs expose no decodable audio track.
            }
          }
          clipStart += clipDurationSec;
        }
      }

      for (const audio of project.audio) {
        await connectTrack({
          src: audio.src,
          volume: audio.volume,
          trimStart: audio.trimStart,
          fadeInSec: audio.fadeIn,
          fadeOutSec: audio.fadeOut,
          startAt: startDelay + audio.start,
          trackDuration: Math.max(0.1, audio.trimEnd - audio.trimStart),
        });
      }

      /* Overlay VIDEO clips with sound: scheduled at their element start,
         volume = keyframed curve (resolveElementValues) sampled at 20 Hz,
         automated through a GainNode so volume keyframes are audible in
         the export exactly as in preview. */
      for (const el of project.elements) {
        if (el.kind !== 'video' || el.muted || !el.src || isPlaceholder(el.src)) continue;
        try {
          const res = await fetch(el.src);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const array = await res.arrayBuffer();
          const decoded = await audioCtx.decodeAudioData(array);
          const source = audioCtx.createBufferSource();
          source.buffer = decoded;
          source.playbackRate.value = Math.max(0.0625, Math.min(16, el.speed || 1));
          const gain = audioCtx.createGain();
          const elStart = audioCtx.currentTime + startDelay + el.start;
          const elLen = Math.max(0.1, el.end - el.start);
          /* sample the volume curve (static + keyframes) into automation */
          const steps = Math.max(2, Math.ceil(elLen * 20));
          for (let i = 0; i <= steps; i++) {
            const u = i / steps;
            const vol = resolveElementValues(el, u * elLen).volume;
            if (i === 0) gain.gain.setValueAtTime(Math.max(0.0001, vol), elStart);
            else gain.gain.linearRampToValueAtTime(Math.max(0.0001, vol), elStart + u * elLen);
          }
          source.connect(gain).connect(destination);
          const trimStart = Math.max(0, el.trim_start || 0);
          const trimEnd = Math.min(decoded.duration, Math.max(trimStart + 0.05, el.trim_end || decoded.duration));
          source.start(elStart, trimStart, Math.max(0.05, trimEnd - trimStart));
        } catch {
          /* overlay without decodable audio simply contributes silence */
        }
      }

      /* ---------- media recorder ---------- */
      const canvasStream = canvas.captureStream(settings.fps);
      const mixed = audioRunnable
        ? new MediaStream([
            ...canvasStream.getVideoTracks(),
            ...destination.stream.getAudioTracks(),
          ])
        : canvasStream; /* audio unstartable → video-only export beats no export */

      const mimeCandidates = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4',
      ];
      const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(mixed, {
          ...(mimeType ? { mimeType } : {}),
          videoBitsPerSecond: settings.qualityBitrate,
        });
      } catch {
        throw new Error('This browser cannot record video (MediaRecorder unavailable). Try Chrome, Edge or Firefox.');
      }

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      const done = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType || 'video/webm' }));
      });

      onProgress?.({ phase: 'rendering', percent: 10, message: 'Rendering frames…' });
      recorder.start(250);

      /* realtime playback render loop (canvas.captureStream picks up draws).
         previewing:true lets cached videos play NATURALLY at playbackRate =
         speed (no per-frame seek storm). Reversed clips still seek per frame —
         the honest cost of client-side reverse. */
      const startedAt = performance.now();
      // watchdog: abort when frames stop progressing (stalled network/decoder)
      const watchdogMs = Math.max(120_000, duration * 8_000);
      let lastFrameAt = performance.now();
      await new Promise<void>((resolve, reject) => {
        let stopped = false;
        const finishResolve = () => {
          if (stopped) return;
          stopped = true;
          resolve();
        };
        const finishReject = (err: Error) => {
          if (stopped) return;
          stopped = true;
          reject(err);
        };
        const step = async () => {
          if (stopped) return;
          if (this.exportCancelled) {
            finishReject(new ExportCancelledError());
            return;
          }
          const now = performance.now();
          if (now - lastFrameAt > watchdogMs) {
            finishReject(new Error('Rendering stalled — a source video stopped responding. Check your connection and try again.'));
            return;
          }
          lastFrameAt = now;
          const elapsed = (now - startedAt) / 1000;
          if (elapsed >= duration) {
            finishResolve();
            return;
          }
          try {
            await this.drawFrame(canvas, scaled, elapsed, { previewing: true, playing: true });
          } catch (e) {
            finishReject(e instanceof Error ? e : new Error('A frame failed to render.'));
            return;
          }
          onProgress?.({
            phase: 'rendering',
            percent: Math.min(99, 10 + Math.round((elapsed / duration) * 88)),
            message: `Rendering ${elapsed.toFixed(1)}s / ${duration.toFixed(1)}s`,
          });
          requestAnimationFrame(() => void step());
        };
        void step();
      });

      recorder.stop();
      const blob = await done;
      destination.stream.getTracks().forEach((t) => t.stop());
      canvasStream.getTracks().forEach((t) => t.stop());
      void audioCtx.close();

      if (this.exportCancelled) throw new ExportCancelledError();
      if (blob.size < 1024) {
        throw new Error('The render produced no data — check that your clips are playable videos and try again.');
      }

      onProgress?.({ phase: 'complete', percent: 100, message: 'Export complete' });

      return {
        blob,
        url: URL.createObjectURL(blob),
        durationSeconds: duration,
        width: outW,
        height: outH,
        format: (mimeType || 'video/webm').includes('mp4') ? 'mp4' : 'webm',
      };
    } finally {
      this.isExporting = false;
      this.exportCancelled = false;
    }
  }
}

export function defaultExportSettings(project: VideoProject): ExportSettings {
  const shortSide = Math.min(project.canvas.width, project.canvas.height);
  return {
    resolutionHeight: shortSide >= 1300 ? 1080 : 720,
    fps: 30,
    qualityBitrate: 6_000_000,
    format: 'webm',
  };
}
