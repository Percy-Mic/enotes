import type { MaskSpec } from '@/lib/video/project';
import { connectAudioEffects } from '@/lib/video/audio-effects';

import { drawAdvancedEffectStack } from '@/lib/video/advanced-effects';
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
  clipDuration, clipSourceTimeAtLocal, FILTER_PRESETS, resolveTime, resolveClipValues, resolveClipAdjustments, projectDuration, normalizeProject, isPlaceholder, isAudioPlaceholder,
  containFit, croppedAspect, resolveElementValues,
  type VideoProject, type TimelineElement, type VideoClip, type CropRect, type ClipAdjustments, type EffectType,
} from '@/lib/video/project';

export interface ExportSettings {
  resolutionHeight: number;      // 720 | 1080 | 1440 | 2160
  fps: number;                   // 24 | 30 | 60
  qualityBitrate: number;        // bits/sec
  format: 'mp4' | 'webm';        // MP4 preferred; WebM remains available when the browser cannot encode MP4
}

export const EXPORT_QUALITY_PRESETS: { id: string; name: string; bitrate: number }[] = [
  { id: 'low', name: 'Smaller file', bitrate: 2_500_000 },
  { id: 'medium', name: 'Balanced', bitrate: 6_000_000 },
  { id: 'high', name: 'High quality', bitrate: 12_000_000 },
];

/*
 * Supabase Free projects have a 50 MB global object limit. Keep rendered
 * exports comfortably below that ceiling so an otherwise-valid MP4 is not
 * rejected after the expensive client-side render has already finished.
 *
 * This only applies to the final export. Source media can still be much
 * larger because it is not re-encoded here.
 */
export const MAX_STUDIO_EXPORT_BYTES = 45 * 1024 * 1024;
const EXPORT_AUDIO_BITRATE = 128_000;

function storageSafeVideoBitrate(durationSeconds: number, requested: number): number {
  const duration = Math.max(0.25, durationSeconds);
  const totalBits = MAX_STUDIO_EXPORT_BYTES * 8;
  const videoBudget = Math.floor(totalBits / duration) - EXPORT_AUDIO_BITRATE;

  /*
   * Do not artificially lower very short exports. For longer exports, reduce
   * only as much as necessary to fit the storage budget.
   */
  return Math.max(250_000, Math.min(requested, videoBudget));
}

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
type PlaybackStateStore = Map<HTMLVideoElement, PlaybackRecord>;
const playbackState: PlaybackStateStore = new Map();

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
async function syncPlaybackVideo(
  video: HTMLVideoElement,
  _src: string,
  target: number,
  playing: boolean,
  forceSeek = false,
  rate = 1,
  reverse = false,
  stateStore: PlaybackStateStore = playbackState
): Promise<void> {
  const state = stateStore.get(video);
  const safeTarget = Math.max(0, target);
  const rateChanged = !state || Math.abs(state.rate - rate) > 0.001;

  /*
   * IMPORTANT: playback state is keyed by the actual HTMLVideoElement, not
   * by URL. The editor can have the same source in the main canvas,
   * fullscreen canvas and effect previews at the same time. A URL-keyed
   * state made those independent decoders fight each other.
   */
  const needsSeek =
    forceSeek ||
    !state ||
    Math.abs(video.currentTime - safeTarget) >
      (playing && !reverse ? 0.45 : playing && reverse ? 0.02 : 0.12) ||
    Math.abs(state.lastTarget - safeTarget) > 0.8;

  if (rateChanged) {
    try {
      video.playbackRate = Math.min(16, Math.max(0.0625, rate));
    } catch {}
  }

  if (!playing) {
    if (!video.paused) video.pause();
    stateStore.set(video, { lastTarget: safeTarget, playing: false, rate });
    if (needsSeek) await seekAndWait(video, safeTarget);
    return;
  }

  /* Reverse playback cannot be driven by native play(). It remains paused
     and seeks only when the requested frame changes. */
  if (reverse) {
    if (!video.paused) video.pause();
    if (needsSeek) await seekAndWait(video, safeTarget);
    stateStore.set(video, { lastTarget: safeTarget, playing: false, rate });
    return;
  }

  /*
   * On a real timeline jump, wait for the decoder to finish the seek before
   * painting. During ordinary playback we do NOT seek every frame; the
   * browser's decoder remains the clock and advances naturally.
   */
  if (needsSeek) {
    await seekAndWait(video, safeTarget);
  }

  if (video.paused) {
    try {
      await video.play();
    } catch {
      stateStore.set(video, { lastTarget: safeTarget, playing: false, rate });
      return;
    }

    /*
     * play() resolving only means playback was accepted — not that a new
     * decoded frame has reached the compositor. Wait for one presented frame
     * before drawImage() so the canvas never paints the decoder's old/empty
     * frame during startup.
     */
    await waitForPresentedVideoFrame(video);
  } else {
    /*
     * The timeline clock can advance faster than the decoder/compositor on
     * mobile devices. Do not rasterize a playing <video> on an arbitrary
     * requestAnimationFrame tick: wait for the next decoded/presented frame
     * so the canvas doesn't intermittently repeat stale or black pixels.
     * waitForPresentedVideoFrame has a bounded fallback for stalled decoders
     * and browsers without requestVideoFrameCallback.
     */
    await waitForPresentedVideoFrame(video);
  }

  stateStore.set(video, { lastTarget: safeTarget, playing: true, rate });
}


async function waitForPresentedVideoFrame(video: HTMLVideoElement): Promise<void> {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth <= 0 || video.videoHeight <= 0) {
    return;
  }

  const rvfc = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (
      callback: (now: number, metadata: VideoFrameCallbackMetadata) => void
    ) => number;
  };

  if (typeof rvfc.requestVideoFrameCallback === 'function') {
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      try {
        rvfc.requestVideoFrameCallback(() => finish());
        window.setTimeout(finish, 120);
      } catch {
        finish();
      }
    });
  } else {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }
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
    // CORS MUST be set before a remote src. Cached/local blob sources do not
    // depend on the network and remain canvas-safe for the current origin.
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');

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
    /*
     * Do not put remote media URLs through the Cache API. Video/audio elements
     * use HTTP Range requests and third-party CDNs such as Pexels can reject
     * cache interception with ERR_CACHE_OPERATION_NOT_SUPPORTED. Local blob:
     * URLs are already offline-first and need no extra cache layer.
     */
    video.src = src;

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
interface ReverseCacheEntry {
  frames: ReverseFrame[];
  builtAt: number;
  src: string;
  trimStart: number;
  trimEnd: number;
}
function reverseCacheKey(src: string, trimStart: number, trimEnd: number): string {
  return src + "::" + trimStart.toFixed(4) + "::" + trimEnd.toFixed(4);
}
function disposeReverseFrame(frame: ReverseFrame) {
  const bmp = frame.bmp as ImageBitmap;
  if (typeof bmp?.close === 'function') bmp.close();
}
function disposeReverseCacheEntry(entry: ReverseCacheEntry | undefined) {
  if (!entry) return;
  for (const frame of entry.frames) disposeReverseFrame(frame);
}
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
  if (!src) {
    reverseCache.forEach((entry) => disposeReverseCacheEntry(entry));
    reverseCache.clear();
    return;
  }
  const keysToDelete: string[] = [];

  reverseCache.forEach((entry, key) => {
    if (entry.src === src) {
      disposeReverseCacheEntry(entry);
      keysToDelete.push(key);
    }
  });

  keysToDelete.forEach((key) => {
    reverseCache.delete(key);
  });
}
function evictReverseCache() {
  while (reverseCache.size >= REVERSE_MAX_SOURCES) {
    let oldestKey = '';
    let oldestAt = Infinity;
    reverseCache.forEach((entry, key) => {
      if (entry.builtAt < oldestAt) { oldestAt = entry.builtAt; oldestKey = key; }
    });
    if (!oldestKey) break;
    disposeReverseCacheEntry(reverseCache.get(oldestKey));
    reverseCache.delete(oldestKey);
  }
}
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
async function buildReverseFrames(
  video: HTMLVideoElement,
  trimStart: number,
  trimEnd: number
): Promise<ReverseFrame[]> {
  const from = Math.max(0, trimStart);
  const to = Math.max(from + 0.1, Math.min(trimEnd, video.duration || trimEnd));
  const span = to - from;
  const step = Math.max(0.1, span / REVERSE_MAX_FRAMES);
  const frames: ReverseFrame[] = [];
  const canvas = document.createElement('canvas');
  canvas.width = REVERSE_THUMB_W;
  canvas.height = Math.max(1, Math.round((REVERSE_THUMB_W * (video.videoHeight || 9)) / (video.videoWidth || 16)));
  const c2d = canvas.getContext('2d');
  if (!c2d) return [];

  const snapshot = async (t: number) => {
    c2d.drawImage(video, 0, 0, canvas.width, canvas.height);
    if (typeof createImageBitmap === 'function') {
      try { frames.push({ t, bmp: await createImageBitmap(canvas) }); return; } catch {}
    }
    const copy = document.createElement('canvas');
    copy.width = canvas.width; copy.height = canvas.height;
    copy.getContext('2d')!.drawImage(canvas, 0, 0);
    frames.push({ t, bmp: copy });
  };

  video.pause();
  await seekAndWait(video, from);
  if (video.readyState < 2) return [];

  const v = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: (now: number, metadata: { mediaTime: number }) => void) => number;
    cancelVideoFrameCallback?: (id: number) => void;
  };
  const hasRVFC = typeof v.requestVideoFrameCallback === 'function';

  await new Promise<void>((resolve) => {
    let nextSample = from;
    let settled = false;
    let timeoutId: number | null = null;
    let callbackId: number | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timeoutId != null) window.clearTimeout(timeoutId);
      if (callbackId != null) { try { v.cancelVideoFrameCallback?.(callbackId); } catch {} }
      video.pause();
      resolve();
    };
    const onFrame = async (_now: number, metadata: { mediaTime: number }) => {
      if (settled) return;
      const current = Number.isFinite(metadata.mediaTime) ? metadata.mediaTime : video.currentTime;
      if (current >= nextSample - 0.001) {
        await snapshot(Math.min(nextSample, to));
        nextSample += step;
      }
      if (current >= to - 0.001 || nextSample > to + step * 0.5) {
        await snapshot(to);
        finish();
        return;
      }
      if (hasRVFC) callbackId = v.requestVideoFrameCallback!(onFrame);
    };
    if (hasRVFC) {
      callbackId = v.requestVideoFrameCallback!(onFrame);
    } else {
      const tick = async () => {
        if (settled) return;
        const current = video.currentTime;
        if (current >= nextSample - 0.001) {
          await snapshot(Math.min(nextSample, to));
          nextSample += step;
        }
        if (current >= to - 0.001 || nextSample > to + step * 0.5) {
          await snapshot(to);
          finish();
          return;
        }
        window.requestAnimationFrame(() => void tick());
      };
      window.requestAnimationFrame(() => void tick());
    }
    timeoutId = window.setTimeout(() => finish(), Math.max(15000, (span + 8) * 1000));
    void video.play().catch(() => finish());
  });

  if (!frames.length || frames[0].t > from + step * 0.5) {
    await seekAndWait(video, from);
    await snapshot(from);
  }
  if (frames[frames.length - 1]?.t < to - step * 0.5) {
    await seekAndWait(video, to);
    await snapshot(to);
  }
  frames.sort((x, y) => x.t - y.t);
  return frames;
}

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
const imageLoading = new Map<string, Promise<HTMLImageElement>>();

function imageSourceError(src: string, reason = 'The image could not be decoded') {
  return new Error(`${reason}: ${src.slice(0, 100)}…`);
}

function clipMaskPath(ctx: CanvasRenderingContext2D, mask: MaskSpec, W: number, H: number) {
  const amount = Math.max(0, Math.min(1, mask.amount ?? 0.5));
  const cx = W / 2, cy = H / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(((mask.rotation || 0) * Math.PI) / 180);
  ctx.beginPath();
  if (mask.shape === 'ellipse') {
    ctx.ellipse(0, 0, W * (0.5 * Math.max(.05, amount)), H * .5, 0, 0, Math.PI * 2);
  } else if (mask.shape === 'rectangle') {
    const w = W * Math.max(.05, amount), h = H * Math.max(.05, amount);
    ctx.rect(-w / 2, -h / 2, w, h);
  } else if (mask.shape === 'split') {
    const x = -W / 2 + W * amount;
    ctx.rect(-W / 2, -H / 2, W * amount, H);
  } else if (mask.shape === 'shutter') {
    const gap = H * .5 * amount;
    ctx.rect(-W / 2, -gap, W, gap);
    ctx.rect(-W / 2, 0, W, gap);
  } else {
    ctx.rect(-W / 2, -H / 2, W, H);
  }
  ctx.closePath();
  ctx.restore();
  return true;
}

function applyMaskClip(ctx: CanvasRenderingContext2D, mask: MaskSpec | undefined, W: number, H: number) {
  if (!mask || mask.shape === 'none') return false;
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(((mask.rotation || 0) * Math.PI) / 180);
  const amount = Math.max(0.05, Math.min(1, mask.amount ?? 0.5));
  const path = new Path2D();
  const addShape = (p: Path2D) => {
    if (mask.shape === 'ellipse') p.ellipse(0, 0, W * .5 * amount, H * .5 * amount, 0, 0, Math.PI * 2);
    else if (mask.shape === 'rectangle') p.rect(-W * .5 * amount, -H * .5 * amount, W * amount, H * amount);
    else if (mask.shape === 'split') p.rect(-W/2, -H/2, W*amount, H);
    else if (mask.shape === 'shutter') { const gap=H*.5*amount; p.rect(-W/2,-gap,W,gap); p.rect(-W/2,0,W,gap); }
    else p.rect(-W/2,-H/2,W,H);
  };
  if (mask.invert) {
    path.rect(-W/2,-H/2,W,H);
    addShape(path);
    ctx.clip(path, 'evenodd');
  } else {
    addShape(path);
    ctx.clip(path);
  }
  /* Feather is represented as a subtle edge overlay in the compositor.
     Keeping the geometric clip exact avoids leaking pixels outside the mask. */
  return true;
}
function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src);
  if (cached && cached.complete && cached.naturalWidth > 0 && cached.naturalHeight > 0) {
    return Promise.resolve(cached);
  }

  const pending = imageLoading.get(src);
  if (pending) return pending;

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    /* Set CORS before src. This is required for Supabase/Cloudinary images
       that will later be painted into a canvas and exported. */
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = async () => {
      try {
        /* onload means the resource arrived, not necessarily that a decoded
           frame is ready for drawImage. Explicitly decode before caching it.
           This prevents the first main-track image frame from becoming a
           black canvas on slower devices. */
        if (typeof img.decode === 'function') {
          try { await img.decode(); } catch { /* onload is still a valid fallback */ }
        }
        if (!img.naturalWidth || !img.naturalHeight) {
          throw imageSourceError(src, 'The image loaded but has no decoded pixels');
        }
        imageCache.set(src, img);
        resolve(img);
      } catch (error) {
        reject(error instanceof Error ? error : imageSourceError(src));
      } finally {
        imageLoading.delete(src);
      }
    };
    img.onerror = () => {
      imageLoading.delete(src);
      reject(imageSourceError(src, 'Could not load image'));
    };
    img.src = src;
  });

  imageLoading.set(src, promise);
  return promise;
}

/* ---------- motion effects (rendered into the export, not just preview) ---------- */

export interface EffectOffset { scaleMul: number; dx: number; dy: number }

/** Canvas-diagonal reference so drift offsets scale with resolution. */
const W0REF = 720;

function effectLayers(clip: VideoClip): Array<{ type: EffectType; intensity: number }> {
  if (Array.isArray(clip.effects) && clip.effects.length) {
    return clip.effects.filter((layer) => layer.type !== 'none');
  }
  return clip.effect === 'none'
    ? []
    : [{ type: clip.effect, intensity: Math.min(1, Math.max(0, clip.effect_intensity ?? 1)) }];
}

function effectTransform(clip: VideoClip, timeIn: number, dur: number): EffectOffset {
  const layers = effectLayers(clip);
  if (!layers.length) return { scaleMul: 1, dx: 0, dy: 0 };
  const p = Math.min(1, Math.max(0, timeIn / Math.max(dur, 0.1)));
  let scaleMul = 1, dx = 0, dy = 0;
  for (const layer of layers) {
    const i = Math.min(1, Math.max(0, layer.intensity));
    switch (layer.type) {
      case 'zoom': scaleMul *= 1 + 0.12 * i * p; break;
      case 'shake': { const t = timeIn * 18; scaleMul *= 1 + 0.04 * i; dx += Math.sin(t) * 6 * i; dy += Math.cos(t * 1.7) * 6 * i; break; }
      case 'pulse': scaleMul *= 1 + 0.04 * i * Math.sin((timeIn * Math.PI * 2) / 0.8); break;
      case 'glitch': { const t = timeIn * 42; scaleMul *= 1 + 0.01 * i; dx += Math.sin(t) * 3 * i; dy += Math.cos(t * 1.37) * 2 * i; break; }
      case 'dream': scaleMul *= 1 + 0.018 * i * Math.sin(timeIn * 3); break;
      case 'film': scaleMul *= 1 + 0.008 * i * Math.sin(timeIn * 1.7); break;
      case 'chromatic': scaleMul *= 1 + 0.015 * i; dx += Math.sin(timeIn * 9) * 2 * i; dy += Math.cos(timeIn * 7) * 1.5 * i; break;
      case 'ken-burns': scaleMul *= 1 + 0.18 * i * p; dx += 0.018 * W0REF * i * p; dy -= 0.012 * W0REF * i * p; break;
      case 'dolly-out': scaleMul *= 1 + 0.16 * i * (1 - p); break;
      case 'handheld': {
        const t1 = timeIn * 7.3, t2 = timeIn * 11.1, t3 = timeIn * 0.9;
        scaleMul *= 1 + 0.025 * i;
        dx += (Math.sin(t1) * 3.2 + Math.sin(t2) * 1.4 + Math.sin(t3) * 2.1) * i;
        dy += (Math.cos(t1 * 1.27) * 2.6 + Math.cos(t2 * 0.87) * 1.2) * i;
        break;
      }
      default: break;
    }
  }
  return { scaleMul, dx, dy };
}

function clipMotionTransform(clip: VideoClip, timeIn: number, dur: number) {
  const preset = clip.motion_preset || 'none';
  if (preset === 'none') return { scale: 1, dx: 0, dy: 0, rotation: 0, opacity: 1 };
  const amount = Math.max(0, Math.min(2, clip.motion_amount ?? 1));
  const p = Math.min(1, Math.max(0, timeIn / Math.max(0.1, dur)));
  const phase = timeIn * Math.PI * 2;
  switch (preset) {
    case 'zoom-in':
      return { scale: 1 + 0.35 * amount * p, dx: 0, dy: 0, rotation: 0, opacity: 1 };
    case 'zoom-out':
      return { scale: 1 + 0.35 * amount * (1 - p), dx: 0, dy: 0, rotation: 0, opacity: 1 };
    case 'spin':
      return { scale: 1.03, dx: 0, dy: 0, rotation: 360 * amount * p, opacity: 1 };
    case 'float':
      return {
        scale: 1.04 + Math.abs(Math.sin(phase * 0.5)) * 0.01 * amount,
        dx: 0,
        dy: Math.sin(phase * 0.65) * 22 * amount,
        rotation: Math.sin(phase * 0.65) * 2 * amount,
        opacity: 1,
      };
    case 'pop': {
      const q = p < 0.2 ? p / 0.2 : 1 - ((p - 0.2) / 0.8) * 0.08;
      return { scale: 0.82 + 0.26 * Math.min(1, q) * amount, dx: 0, dy: 0, rotation: 0, opacity: 1 };
    }
    case 'shake':
      return {
        scale: 1.04,
        dx: Math.sin(timeIn * Math.PI * 10) * 14 * amount,
        dy: Math.sin(timeIn * Math.PI * 8) * 8 * amount,
        rotation: Math.sin(timeIn * Math.PI * 8) * 2 * amount,
        opacity: 1,
      };
    default:
      return { scale: 1, dx: 0, dy: 0, rotation: 0, opacity: 1 };
  }
}

function applyChromaKeyPixels(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  settings: NonNullable<VideoClip['chromaKey']>,
) {
  if (!settings.enabled || width < 1 || height < 1) return;
  const match = /^#?([0-9a-f]{6})$/i.exec(settings.color || '#00ff00');
  if (!match) return;
  const hex = match[1];
  const kr = parseInt(hex.slice(0, 2), 16);
  const kg = parseInt(hex.slice(2, 4), 16);
  const kb = parseInt(hex.slice(4, 6), 16);
  const tolerance = Math.max(0, Math.min(255, Number(settings.tolerance) || 0));
  const softness = Math.max(0.001, Math.min(255, Number(settings.softness) || 1));
  const spill = Math.max(0, Math.min(1, Number(settings.spill) || 0));
  const pixels = ctx.getImageData(0, 0, width, height);
  const data = pixels.data;
  const inner = tolerance;
  const outer = tolerance + softness;
  const keyIsGreen = kg >= kr && kg >= kb;
  const keyIsRed = kr >= kg && kr >= kb;
  const keyIsBlue = kb >= kr && kb >= kg;
  for (let p = 0; p < data.length; p += 4) {
    const dr = data[p] - kr;
    const dg = data[p + 1] - kg;
    const db = data[p + 2] - kb;
    const distance = Math.sqrt(dr * dr + dg * dg + db * db);
    if (distance <= inner) {
      data[p + 3] = 0;
      continue;
    }
    if (distance < outer) {
      const edge = (distance - inner) / (outer - inner);
      data[p + 3] = Math.round(data[p + 3] * edge);
      if (spill > 0 && edge < 1) {
        if (keyIsGreen) data[p + 1] = Math.min(data[p + 1], Math.round(Math.max(data[p], data[p + 2]) + (data[p + 1] - Math.max(data[p], data[p + 2])) * (1 - spill * (1 - edge))));
        else if (keyIsRed) data[p] = Math.min(data[p], Math.round(Math.max(data[p + 1], data[p + 2]) + (data[p] - Math.max(data[p + 1], data[p + 2])) * (1 - spill * (1 - edge))));
        else if (keyIsBlue) data[p + 2] = Math.min(data[p + 2], Math.round(Math.max(data[p], data[p + 1]) + (data[p + 2] - Math.max(data[p], data[p + 1])) * (1 - spill * (1 - edge))));
      }
    }
  }
  ctx.putImageData(pixels, 0, 0);
}

function effectFilterCss(clip: VideoClip, timeIn: number): string {
  const parts: string[] = [];
  for (const layer of effectLayers(clip)) {
    const i = Math.min(1, Math.max(0, layer.intensity));
    switch (layer.type) {
      case 'vhs': parts.push('contrast(' + (1 + 0.08 * i) + ') saturate(' + (1 - 0.1 * i) + ') sepia(' + (0.12 * i) + ')'); break;
      case 'dream': parts.push('brightness(' + (1 + 0.08 * i) + ') saturate(' + (1 + 0.08 * i) + ') blur(' + (0.7 * i) + 'px)'); break;
      case 'film': parts.push('contrast(' + (1 + 0.06 * i) + ') saturate(' + (1 - 0.08 * i) + ') sepia(' + (0.05 * i) + ')'); break;
      case 'chromatic': parts.push('saturate(' + (1 + 0.18 * i) + ') hue-rotate(' + (Math.sin(timeIn * 8) * 3 * i) + 'deg)'); break;
      case 'glow': parts.push('brightness(' + (1 + 0.05 * i) + ') contrast(' + (1 - 0.04 * i) + ') blur(' + (0.35 * i) + 'px)'); break;
      case 'bloom': parts.push('brightness(' + (1 + 0.08 * i) + ') blur(' + (0.45 * i) + 'px)'); break;
      case 'motion-blur': parts.push('blur(' + (1.2 * i) + 'px)'); break;
      case 'negative': parts.push('invert(' + (100 * i) + '%)'); break;
      case 'posterize': parts.push('contrast(' + (1 + 1.4 * i) + ') saturate(' + (1 + 0.4 * i) + ')'); break;
      case 'old-film': parts.push('sepia(' + (0.38 * i) + ') contrast(' + (1 + 0.12 * i) + ') saturate(' + (1 - 0.28 * i) + ')'); break;
      case 'crt': parts.push('contrast(' + (1 + 0.16 * i) + ') saturate(' + (1 + 0.08 * i) + ')'); break;
      case 'flicker': parts.push('brightness(' + (1 + Math.sin(timeIn * 31) * 0.08 * i) + ')'); break;
      case 'solarize': parts.push('contrast(' + (1 + 1.8 * i) + ') brightness(' + (1 + 0.08 * i) + ')'); break;
      case 'threshold': parts.push('grayscale(1) contrast(' + (1 + 3.5 * i) + ')'); break;
      case 'pixelate': parts.push('contrast(' + (1 + 0.45 * i) + ') saturate(' + (1 - 0.25 * i) + ')'); break;
      case 'duotone': parts.push('grayscale(' + (0.85 * i) + ') contrast(' + (1 + 0.3 * i) + ')'); break;
      case 'thermal': parts.push('saturate(' + (1 + 2.2 * i) + ') contrast(' + (1 + 0.35 * i) + ') hue-rotate(' + (210 * i) + 'deg)'); break;
      case 'blueprint': parts.push('grayscale(' + (0.92 * i) + ') contrast(' + (1 + 0.55 * i) + ') hue-rotate(' + (165 * i) + 'deg) saturate(' + (1 + 1.5 * i) + ')'); break;
      case 'cyberpunk': parts.push('contrast(' + (1 + 0.25 * i) + ') saturate(' + (1 + 0.8 * i) + ') hue-rotate(' + (Math.sin(timeIn * 1.7) * 14 * i) + 'deg)'); break;
      case 'dreamy-glow': parts.push('brightness(' + (1 + 0.1 * i) + ') saturate(' + (1 + 0.16 * i) + ') blur(' + (0.9 * i) + 'px)'); break;
      default: break;
    }
  }
  return parts.join(' ');
}

function drawEffectOverlay(ctx: CanvasRenderingContext2D, clip: VideoClip, timeIn: number, W: number, H: number) {
  for (const layer of effectLayers(clip)) {
    const effect = layer.type;
    const i = Math.min(1, Math.max(0, layer.intensity));
    if (effect === 'flash') {
      const alpha = Math.max(0, Math.sin(timeIn * Math.PI * 5)) * 0.18 * i;
      if (alpha > 0.01) { ctx.fillStyle = 'rgba(255,255,255,' + alpha + ')'; ctx.fillRect(0, 0, W, H); }
    } else if (effect === 'glitch') {
      ctx.save(); ctx.globalAlpha = 0.14 * i;
      const y = (Math.sin(timeIn * 31) * 0.5 + 0.5) * H;
      ctx.fillStyle = '#ff3355'; ctx.fillRect(0, y, W, Math.max(2, H * 0.012));
      ctx.fillStyle = '#33ccff'; ctx.fillRect(0, Math.min(H - 2, y + H * 0.018), W, Math.max(2, H * 0.008)); ctx.restore();
    } else if (effect === 'vhs' || effect === 'scanlines') {
      ctx.save(); ctx.globalAlpha = (effect === 'vhs' ? 0.12 : 0.08) * i; ctx.fillStyle = '#fff';
      const step = Math.max(4, H / (effect === 'vhs' ? 90 : 160));
      for (let y = 0; y < H; y += step) ctx.fillRect(0, y, W, 1); ctx.restore();
    } else if (effect === 'light-leak') {
      const t = timeIn * 0.7; const cx = W * (0.5 + 0.42 * Math.sin(t)); const cy = H * (0.5 + 0.42 * Math.cos(t * 1.317));
      const alpha = 0.22 + 0.12 * Math.sin(t * 2.1);
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      const leak = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.75);
      leak.addColorStop(0, `rgba(255,196,140,${Math.max(0, alpha) * i})`);
      leak.addColorStop(0.4, `rgba(255,140,90,${0.5 * Math.max(0, alpha) * i})`);
      leak.addColorStop(1, 'rgba(255,120,60,0)');
      ctx.fillStyle = leak; ctx.fillRect(0, 0, W, H); ctx.restore();
    } else if (effect === 'letterbox') {
      const bar = H * 0.11; ctx.save(); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, bar); ctx.fillRect(0, H - bar, W, bar); ctx.restore();
    } else if (effect === 'film-grain' || effect === 'noise') {
      ctx.save(); ctx.globalAlpha = (effect === 'film-grain' ? 0.06 : 0.11) * i;
      const seed = Math.floor(timeIn * 24);
      for (let band = 0; band < (effect === 'film-grain' ? 26 : 70); band += 1) {
        const n = Math.sin(seed * 91.7 + band * 373.091) * 43758.5453;
        const fx = (n - Math.floor(n)) * W;
        const n2 = Math.sin(seed * 17.3 + band * 911.13) * 12543.21;
        const fy = (n2 - Math.floor(n2)) * H;
        ctx.fillStyle = n > 0.5 ? '#fff' : '#000'; ctx.fillRect(fx, fy, Math.max(1, W / 480), Math.max(1, H / 480));
      }
      ctx.restore();
    } else if (effect === 'crt') {
      ctx.save();
      ctx.globalAlpha = 0.13 * i;
      ctx.fillStyle = '#00ffcc';
      const scan = Math.max(3, H / 110);
      for (let y = 0; y < H; y += scan) ctx.fillRect(0, y, W, 1);
      ctx.globalAlpha = 0.08 * i;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = Math.max(1, W / 900);
      ctx.strokeRect(W * 0.01, H * 0.01, W * 0.98, H * 0.98);
      ctx.restore();
    } else if (effect === 'old-film') {
      ctx.save();
      ctx.globalAlpha = 0.16 * i;
      const seed = Math.floor(timeIn * 18);
      for (let n = 0; n < 18; n += 1) {
        const x = Math.abs(Math.sin(seed * 12.73 + n * 41.17)) * W;
        const y = Math.abs(Math.sin(seed * 7.91 + n * 19.31)) * H;
        ctx.fillStyle = n % 3 === 0 ? '#fff' : '#111';
        ctx.fillRect(x, y, Math.max(1, W / 360), Math.max(1, H / 360));
      }
      ctx.globalAlpha = (0.035 + Math.abs(Math.sin(timeIn * 29)) * 0.035) * i;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    } else if (effect === 'flicker') {
      const alpha = Math.max(0, Math.sin(timeIn * 31)) * 0.08 * i;
      if (alpha > 0.005) { ctx.save(); ctx.fillStyle = 'rgba(255,244,210,' + alpha + ')'; ctx.fillRect(0, 0, W, H); ctx.restore(); }
    } else if (effect === 'film-burn') {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const t = timeIn * 0.8;
      const x = W * (0.2 + 0.8 * ((Math.sin(t) + 1) / 2));
      const burn = ctx.createRadialGradient(x, H * 0.45, 0, x, H * 0.45, Math.max(W, H) * 0.8);
      burn.addColorStop(0, 'rgba(255,210,80,' + (0.18 * i) + ')');
      burn.addColorStop(0.35, 'rgba(255,90,30,' + (0.1 * i) + ')');
      burn.addColorStop(1, 'rgba(255,30,0,0)');
      ctx.fillStyle = burn; ctx.fillRect(0, 0, W, H); ctx.restore();
    } else if (effect === 'halftone') {
      ctx.save();
      ctx.globalAlpha = 0.18 * i;
      ctx.fillStyle = '#fff';
      const step = Math.max(5, Math.min(13, W / 90));
      for (let y = step / 2; y < H; y += step) {
        for (let x = step / 2; x < W; x += step) {
          const r = step * (0.08 + 0.22 * (0.5 + 0.5 * Math.sin(x * 0.031 + y * 0.017)));
          ctx.beginPath(); ctx.arc(x, y, r * i, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();
    } else if (effect === 'pixelate') {
      ctx.save();
      ctx.globalAlpha = 0.12 * i;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      const step = Math.max(8, W / 80);
      for (let x = 0; x < W; x += step) ctx.strokeRect(x, 0, step, H);
      ctx.restore();
    } else if (effect === 'duotone') {
      ctx.save();
      ctx.globalAlpha = 0.28 * i;
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = '#ff2f92';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = '#132c7a';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    } else if (effect === 'thermal') {
      ctx.save();
      ctx.globalAlpha = 0.22 * i;
      ctx.globalCompositeOperation = 'screen';
      const grad = ctx.createLinearGradient(0, H, W, 0);
      grad.addColorStop(0, '#062bff'); grad.addColorStop(0.3, '#00e5ff'); grad.addColorStop(0.55, '#35ff58');
      grad.addColorStop(0.75, '#ffe500'); grad.addColorStop(1, '#ff2b00');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
      ctx.restore();
    } else if (effect === 'blueprint') {
      ctx.save();
      ctx.globalAlpha = 0.18 * i;
      ctx.strokeStyle = '#8cecff';
      ctx.lineWidth = Math.max(1, W / 900);
      const step = Math.max(18, W / 35);
      for (let x = 0; x < W; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y < H; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      ctx.restore();
    } else if (effect === 'cyberpunk') {
      ctx.save();
      ctx.globalAlpha = 0.13 * i;
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = '#00e5ff'; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = '#ff2bd6'; ctx.fillRect(0, 0, W, H);
      ctx.restore();
    } else if (effect === 'rgb-split') {
      ctx.save(); ctx.globalAlpha = 0.13 * i; ctx.globalCompositeOperation = 'screen';
      const shift = Math.sin(timeIn * 10) * Math.max(2, W * 0.004) * i;
      ctx.fillStyle = '#ff003c'; ctx.fillRect(Math.max(0, shift), 0, W, H);
      ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = '#00e5ff'; ctx.fillRect(Math.min(W - 1, Math.max(0, -shift)), 0, W, H);
      ctx.restore();
    }
  }
}

/* ---------- source/destination rect ---------- 
 for one clip ----------
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
  /*
   * Default media placement is CONTAIN, not COVER. A portrait source on a
   * landscape canvas therefore fits its full height instead of being enlarged
   * until it overflows. User transforms/keyframes can still scale or move the
   * media beyond the canvas intentionally after this baseline fit.
   */
  const fit = containFit(canvasW, canvasH, effAspect);
  const dw = fit.w * scale * scale_x * eff.scaleMul;
  const dh = fit.h * scale * scale_y * eff.scaleMul;

  const c: CropRect | null = crop;
  const sx = c ? c.left * videoW : 0;
  const sy = c ? c.top * videoH : 0;
  const sw = Math.max(1, videoW * (1 - (c?.left || 0) - (c?.right || 0)));
  const sh = Math.max(1, videoH * (1 - (c?.top || 0) - (c?.bottom || 0)));
  return { sx, sy, sw, sh, dw, dh };
}

function filterCssFor(clip: VideoClip, adjustmentsOverride?: ClipAdjustments): string {
  const preset = FILTER_PRESETS.find((f) => f.id === clip.filter);
  const parts: string[] = [];
  if (preset && preset.css) parts.push(preset.css);
  const a = adjustmentsOverride ?? clip.adjustments;
  if (a.brightness !== 100) parts.push(`brightness(${a.brightness}%)`);
  if (a.exposure !== 100) parts.push(`brightness(${a.exposure}%)`);
  if (a.contrast !== 100) parts.push(`contrast(${a.contrast}%)`);
  if (a.saturate !== 100) parts.push(`saturate(${a.saturate}%)`);
  if (a.vibrance !== 100) parts.push(`saturate(${a.vibrance}%)`);
  if (a.hue !== 0) parts.push(`hue-rotate(${a.hue}deg)`);
  if (a.temperature !== 0) parts.push(`sepia(${Math.min(100, Math.abs(a.temperature) * 0.22)}%)`);
  if (a.tint !== 0) parts.push(`hue-rotate(${a.tint * 0.18}deg)`);
  if (a.blur > 0) parts.push(`blur(${a.blur}px)`);
  if (a.sepia > 0) parts.push(`sepia(${a.sepia}%)`);
  if (a.grayscale > 0) parts.push(`grayscale(${a.grayscale}%)`);
  if (a.sharpen > 0) parts.push(`contrast(${100 + a.sharpen * 0.12}%)`);
  if (a.grain > 0) parts.push(`contrast(${100 + a.grain * 0.08}%)`);
  return parts.join(' ');
}

/* ---------- overlays ---------- */

function drawTextElement(ctx: CanvasRenderingContext2D, el: TimelineElement, canvasW: number, timeIn: number) {
  const requestedFontSize = el.font_size || 48;
  const weight = el.font_weight || 700;
  /* keyframed values (fall back to the static fields when the property
     has no keyframes — identical behavior for keyframe-free elements) */
  const v = resolveElementValues(el, timeIn);
  ctx.save();
  ctx.globalAlpha = v.opacity;

  // Professional text motion: legacy animation remains the fallback,
  // while new projects can control entrance, exit and looping motion independently.
  // Keep the renderer tolerant of legacy animation ids stored in older projects.
  const entryAnimation = String(el.animation_in ?? el.animation ?? 'none');
  const exitAnimation = el.animation_out ?? 'none';
  const loopAnimation = el.animation_loop ?? 'none';
  let progress = 1;
  let exitProgress = 1;
  if (entryAnimation && entryAnimation !== 'none') {
    const ANIM = Math.max(0.08, Math.min(2.5, el.animation_in_duration ?? 0.55));
    progress = Math.min(1, timeIn / ANIM);
    if (entryAnimation === 'fade') ctx.globalAlpha = v.opacity * progress;
    if (entryAnimation === 'pop') ctx.scale(0.8 + 0.2 * easeOut(progress), 0.8 + 0.2 * easeOut(progress));
    if (entryAnimation === 'slide-up') ctx.translate(0, (1 - easeOut(progress)) * 40);
    if (entryAnimation === 'slide-down') ctx.translate(0, -(1 - easeOut(progress)) * 40);
    if (entryAnimation === 'slide-left') ctx.translate((1 - easeOut(progress)) * 60, 0);
    if (entryAnimation === 'slide-right') ctx.translate(-(1 - easeOut(progress)) * 60, 0);
    if (entryAnimation === 'zoom-in') ctx.scale(1 + (1 - easeOut(progress)) * 0.45, 1 + (1 - easeOut(progress)) * 0.45);
    if (entryAnimation === 'zoom-out') ctx.scale(1 - (1 - easeOut(progress)) * 0.3, 1 - (1 - easeOut(progress)) * 0.3);
    if (entryAnimation === 'bounce') {
      /* Damped spring: overshoots then settles — no double-draw tricks. */
      const overshoot = 1 + Math.sin(progress * Math.PI * 2.2) * (1 - progress) * 0.35;
      ctx.scale(0.6 + 0.4 * easeOut(progress) * overshoot, 0.6 + 0.4 * easeOut(progress) * overshoot);
    }
    if (entryAnimation === 'blur-in') {
      ctx.globalAlpha = v.opacity * progress;
      /* Blur comes from the ctx filter stack; amount decays. */
      ctx.filter = `blur(${((1 - progress) * 8).toFixed(2)}px)`;
    }
    if (entryAnimation === 'rotate-in') {
      ctx.globalAlpha = v.opacity * progress;
      ctx.rotate((1 - easeOut(progress)) * -0.35);
      ctx.scale(0.7 + 0.3 * easeOut(progress), 0.7 + 0.3 * easeOut(progress));
    }
    if (entryAnimation === 'elastic') {
      /* Under-damped spring on scale — the kinetic-typography staple. */
      const k = 1 - Math.pow(1 - progress, 2);
      const spring = 1 + Math.sin(progress * Math.PI * 3) * (1 - progress) * 0.28;
      ctx.scale(k * spring || 0.001, k * spring || 0.001);
      ctx.globalAlpha = v.opacity * Math.min(1, progress * 2.5);
    }
    if (entryAnimation === 'fade-up' || entryAnimation === 'blur-up') ctx.translate(0, (1 - easeOut(progress)) * 55);
    if (entryAnimation === 'fade-down' || entryAnimation === 'blur-down') ctx.translate(0, -(1 - easeOut(progress)) * 55);
    if (entryAnimation === 'elastic-in' || entryAnimation === 'elastic-out') {
      const spring = 1 + Math.sin(progress * Math.PI * 2.6) * (1 - progress) * 0.3;
      const s = (entryAnimation === 'elastic-in' ? easeOut(progress) : 1 - (1 - easeOut(progress)) * 0.15) * spring;
      ctx.scale(Math.max(0.001, s), Math.max(0.001, s));
    }
    if (entryAnimation === 'glitch-in' || entryAnimation === 'glitch-out') {
      const jitter = (1 - progress) * 18;
      ctx.translate(Math.sin(timeIn * 60) * jitter, Math.cos(timeIn * 47) * jitter * 0.4);
      ctx.globalAlpha = v.opacity * Math.min(1, progress * 2);
    }
    if (entryAnimation === 'flip-in' || entryAnimation === 'flip-out') {
      const flip = entryAnimation === 'flip-in' ? (1 - progress) * Math.PI * 0.5 : progress * Math.PI * 0.15;
      ctx.rotate(flip);
      ctx.scale(Math.max(0.001, Math.cos(flip)), 1);
    }
    if (entryAnimation === 'wave') {
      ctx.translate(0, Math.sin(timeIn * 8) * 7);
      ctx.rotate(Math.sin(timeIn * 7) * 0.025);
    }
  }
  /* Independent exit animation. */
  {
    const EXIT = Math.max(0.08, Math.min(2.5, el.animation_out_duration ?? 0.35));
    const remaining = (el.end ?? Infinity) - el.start - timeIn;
    exitProgress = Math.max(0, Math.min(1, remaining / EXIT));
    if (exitProgress < 1) {
      const q = easeOut(exitProgress);
      if (exitAnimation === 'fade') ctx.globalAlpha *= exitProgress;
      if (exitAnimation === 'pop' || exitAnimation === 'zoom-in') ctx.scale(Math.max(0.001, q), Math.max(0.001, q));
      if (exitAnimation === 'zoom-out') ctx.scale(1 + (1 - q) * 0.25, 1 + (1 - q) * 0.25);
      if (exitAnimation === 'slide-up') ctx.translate(0, -(1 - q) * 55);
      if (exitAnimation === 'slide-down') ctx.translate(0, (1 - q) * 55);
      if (exitAnimation === 'slide-left') ctx.translate(-(1 - q) * 65, 0);
      if (exitAnimation === 'slide-right') ctx.translate((1 - q) * 65, 0);
      if (exitAnimation === 'blur-in') {
        ctx.globalAlpha *= exitProgress;
        ctx.filter = `blur(${((1 - q) * 8).toFixed(2)}px)`;
      }
      if (exitAnimation === 'rotate-in') ctx.rotate((1 - q) * 0.35);
      if (exitAnimation === 'flip-in') ctx.scale(Math.max(0.001, q), 1);
      if (exitAnimation === 'glitch-in') {
        ctx.translate(Math.sin(timeIn * 70) * (1 - q) * 16, Math.cos(timeIn * 53) * (1 - q) * 8);
        ctx.globalAlpha *= Math.min(1, exitProgress * 2);
      }
    }
  }

  ctx.translate(v.x + el.width / 2, v.y + el.height / 2);
  ctx.rotate((v.rotation * Math.PI) / 180);
  if (v.scale !== 1) ctx.scale(v.scale, v.scale);

  /* The element box is the source of truth. Clip the actual text rendering
     to that box so glyphs, shadows, strokes and animated effects cannot
     visually escape the selection/container square. */
  ctx.save();
  ctx.beginPath();
  ctx.rect(-el.width / 2, -el.height / 2, el.width, el.height);
  ctx.clip();

  // Loop motion runs after the static transform so it feels attached to the text.
  if (loopAnimation !== 'none') {
    const amount = Math.max(0, Math.min(2, el.animation_loop_amount ?? 1));
    if (loopAnimation === 'pulse') {
      const s = 1 + Math.sin(timeIn * 5.5) * 0.035 * amount;
      ctx.scale(s, s);
    } else if (loopAnimation === 'float') {
      ctx.translate(0, Math.sin(timeIn * 2.6) * 7 * amount);
    } else if (loopAnimation === 'shake') {
      ctx.translate(Math.sin(timeIn * 38) * 2.5 * amount, Math.cos(timeIn * 43) * 1.5 * amount);
    } else if (loopAnimation === 'wave') {
      ctx.rotate(Math.sin(timeIn * 4.5) * 0.035 * amount);
    } else if (loopAnimation === 'tracking') {
      const spacing = (Math.sin(timeIn * 3.2) * 3.5 * amount);
      const ctxSpacing = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
      ctxSpacing.letterSpacing = `${spacing.toFixed(2)}px`;
    } else if (loopAnimation === 'glitch') {
      ctx.translate(Math.sin(timeIn * 31) * 2.5 * amount, Math.cos(timeIn * 37) * 1.5 * amount);
      ctx.globalAlpha *= 0.92 + Math.sin(timeIn * 29) * 0.08 * amount;
    }
  }

  ctx.font = `${weight} ${requestedFontSize}px ${el.font_family || 'Poppins, sans-serif'}`;
  /* Text is always centered inside its element container. The container, not the
     measured line width, is the positioning reference, so every line shares
     the exact same horizontal center and the multi-line block is vertically
     centered by the line positions below. */
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const ctxWithSpacing = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if (typeof el.letter_spacing === 'number') ctxWithSpacing.letterSpacing = `${el.letter_spacing}px`;

  const rawContent = el.content || '';
  const content = el.text_case === 'uppercase' ? rawContent.toUpperCase() : el.text_case === 'lowercase' ? rawContent.toLowerCase() : el.text_case === 'capitalize' ? rawContent.replace(/\b\w/g, (m) => m.toUpperCase()) : rawContent;

  /* Wrap long text to the actual box instead of letting one unbroken line
     become wider than its selection frame. Explicit newlines are preserved. */
  const wrapWidth = Math.max(12, el.width);
  const lines = content.split('\n').flatMap((paragraph) => {
    if (!paragraph) return [''];
    const words = paragraph.split(/\s+/);
    const wrapped: string[] = [];
    let line = '';

    for (const word of words) {
      const candidate = line ? line + ' ' + word : word;
      if (!line || ctx.measureText(candidate).width <= wrapWidth) {
        line = candidate;
        continue;
      }

      wrapped.push(line);
      line = '';

      /* Break a single long word by glyphs instead of letting it escape the
         selection box. The requested font size is never reduced to make it fit. */
      let chunk = '';
      for (const char of word) {
        const candidateChunk = chunk + char;
        if (chunk && ctx.measureText(candidateChunk).width > wrapWidth) {
          wrapped.push(chunk);
          chunk = char;
        } else {
          chunk = candidateChunk;
        }
      }
      line = chunk;
    }

    if (line || wrapped.length === 0) wrapped.push(line);
    return wrapped;
  });

  /*
   * The font size is the user's actual design value.
   *
   * The previous renderer calculated a fitScale from the element box and
   * silently shrank the font whenever the box was smaller than the text.
   * That made the Size control appear capped and made canvas manipulation
   * disagree with what the user asked for.
   *
   * The element box is now the wrapping/clipping boundary; it never changes
   * the requested font size. Large typography can therefore be genuinely
   * large, and the user can resize the container when they want more room.
   */
  const fontSize = Math.max(1, requestedFontSize);
  ctx.font = `${weight} ${fontSize}px ${el.font_family || 'Poppins, sans-serif'}`;
  const lineHeight = fontSize * (el.line_height || 1.25);
  const totalHeight = lines.length * lineHeight;


  if (el.background) {
    const metrics = ctx.measureText(lines.reduce((a, b) => (a.length > b.length ? a : b), ''));
    ctx.fillStyle = el.background;
    const padX = fontSize * (el.background_padding ?? 0);
    const padY = fontSize * ((el.background_padding ?? 0) * 0.65);
    const bx = -metrics.width / 2 - padX;
    const by = -totalHeight / 2 - padY;
    const bw = metrics.width + padX * 2;
    const bh = totalHeight + padY * 2;
    const radius = Math.max(0, el.background_radius ?? fontSize * 0.15);
    if (radius > 0 && typeof ctx.roundRect === 'function') { ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, Math.min(radius, Math.min(bw, bh) / 2)); ctx.fill(); }
    else ctx.fillRect(bx, by, bw, bh);
  }
  const isTypewriter = entryAnimation === 'typewriter' || entryAnimation === 'typewriter-reveal';
  const isMaskWipe = entryAnimation === 'mask-wipe';
  /* Typewriter reveals characters at ~28 cps; other animations draw full text. */
  const totalChars = (el.content || '').length;
  const revealed = isTypewriter ? Math.min(totalChars, Math.floor((timeIn / Math.max(0.05, totalChars / 28)) + 0.001)) : totalChars;

  let consumed = 0;
  lines.forEach((line, i) => {
    const y = -totalHeight / 2 + lineHeight * (i + 0.5);
    let visibleLine = line;
    if (isTypewriter) {
      const startIdx = consumed;
      consumed += line.length + 1; // +1 for the newline
      const remaining = revealed - startIdx;
      if (remaining <= 0) return;
      visibleLine = line.slice(0, remaining);
    }
    if (entryAnimation === 'split-reveal') {
      const p = Math.max(0, Math.min(1, progress));
      const metricsW = ctx.measureText(line).width;
      ctx.save();
      ctx.beginPath();
      ctx.rect(-metricsW * p / 2, y - lineHeight * 0.7, metricsW * p, lineHeight * 1.4);
      ctx.clip();
    }
    if (isMaskWipe) {
      /* Per-line progressive reveal via clip rect (mask wipe). */
      const lineProgress = Math.max(0, Math.min(1, (progress * lines.length) - i));
      if (lineProgress <= 0) return;
      ctx.save();
      ctx.beginPath();
      const metricsW = ctx.measureText(line).width;
      const originX = el.align === 'left' ? -metricsW / 2 : el.align === 'right' ? metricsW / 2 - metricsW * lineProgress : -metricsW / 2;
      ctx.rect(originX, y - lineHeight * 0.7, metricsW * lineProgress + 2, lineHeight * 1.4);
      ctx.clip();
    }
    if (el.stroke_color) {
      ctx.strokeStyle = el.stroke_color;
      ctx.lineWidth = Math.max(1, el.stroke_width ?? fontSize / 12);
      ctx.strokeText(visibleLine, 0, y);
    }
    if (el.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,' + Math.max(0, Math.min(1, el.shadow_opacity ?? 0.55)) + ')';
      ctx.shadowBlur = el.shadow_blur ?? fontSize / 5;
      ctx.shadowOffsetY = 2;
    } else {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
    }
    if (el.text_effect === '3d') {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillText(visibleLine, 4, y + 4);
      ctx.fillStyle = el.color || '#FFFFFF';
      ctx.fillText(visibleLine, 0, y);
    } else if (el.text_effect === 'hollow' || el.text_effect === 'outline') {
      ctx.strokeStyle = el.stroke_color || el.color || '#FFFFFF';
      ctx.lineWidth = Math.max(1, el.stroke_width ?? 2);
      ctx.strokeText(visibleLine, 0, y);
    } else if (el.text_effect === 'neon' || el.text_effect === 'glow') {
      ctx.shadowColor = el.color || '#FFFFFF';
      ctx.shadowBlur = el.text_effect === 'neon' ? fontSize * 0.55 : fontSize * 0.35;
      ctx.fillStyle = el.color || '#FFFFFF';
      ctx.fillText(visibleLine, 0, y);
    } else if (el.text_effect === 'gradient') {
      const gradient = ctx.createLinearGradient(-fontSize * 2, y - fontSize, fontSize * 2, y + fontSize);
      gradient.addColorStop(0, el.color || '#FFFFFF');
      gradient.addColorStop(0.5, '#FFB6C1');
      gradient.addColorStop(1, '#E5798F');
      ctx.fillStyle = gradient;
      ctx.fillText(visibleLine, 0, y);
    } else if (el.text_effect === 'retro') {
      ctx.fillStyle = el.color || '#FFF3D6';
      ctx.shadowColor = 'rgba(0,0,0,.75)';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 3;
      ctx.shadowOffsetY = 3;
      ctx.fillText(visibleLine, 0, y);
    } else if (el.text_effect === 'glitch') {
      ctx.save();
      ctx.globalAlpha *= 0.8;
      ctx.fillStyle = '#00E5FF';
      ctx.fillText(visibleLine, Math.sin(timeIn * 45) * 4, y);
      ctx.fillStyle = '#FF2BD6';
      ctx.fillText(visibleLine, Math.cos(timeIn * 37) * -4, y);
      ctx.restore();
      ctx.fillStyle = el.color || '#FFFFFF';
      ctx.fillText(visibleLine, 0, y);
    } else {
      ctx.fillStyle = el.color || '#FFFFFF';
      ctx.fillText(visibleLine, 0, y);
    }    if (isTypewriter && i === lines.length - 1 && revealed < totalChars) {
      /* Caret blinks at 2 Hz while typing. */
      if (Math.floor(timeIn * 4) % 2 === 0) {
        const caretX = ctx.measureText(visibleLine).width / 2 + 4;
        ctx.fillStyle = el.color || '#FFFFFF';
        ctx.fillRect(caretX, y - fontSize * 0.55, Math.max(2, fontSize / 14), fontSize * 1.1);
      }
    }
    if (entryAnimation === 'split-reveal') ctx.restore();
    if (isMaskWipe) ctx.restore();
  });

  void canvasW;
  ctx.restore(); // container clip
  ctx.restore(); // element renderer state
}

function easeOut(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

/** Contain/cover fit of a (possibly cropped) source into an element box. */
/**
 * Contain/cover fit of a (possibly cropped) source into an element box.
 * Exported so the editor's crop workspace can mirror the renderer's source
 * mapping exactly — crop handles must align with the pixels being cropped.
 */
export function fitIntoBox(
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

async function drawVideoElement(
  ctx: CanvasRenderingContext2D,
  el: TimelineElement,
  timeIn: number,
  previewing = false,
  playing = false,
  loadVideoFn: (src: string) => Promise<HTMLVideoElement> = loadVideo,
  syncVideoFn: (
    video: HTMLVideoElement,
    src: string,
    target: number,
    playing: boolean,
    forceSeek?: boolean,
    rate?: number,
    reverse?: boolean
  ) => Promise<void> = syncPlaybackVideo,
) {
  if (!el.src) return;
  const video = await loadVideoFn(el.src);
  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : (el.source_duration || 10);
  const speed = Math.max(0.05, el.speed || 1);
  const trimStart = Math.max(0, el.trim_start || 0);
  const trimEnd = Math.min(duration, Math.max(trimStart + 0.01, el.trim_end || duration));
  const target = Math.min(trimEnd - 0.01, Math.max(trimStart, trimStart + timeIn * speed));
  await syncVideoFn(video, el.src, target, !!playing, !previewing, speed, false);
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

/*
 * Transition engine.
 *
 * The incoming clip's frame is already painted when this runs, so every
 * transition is expressed as a post-process over the composed canvas plus
 * an incoming transform. Motion types (whip/zoom-blur/spin) also transform
 * the incoming frame through the returned `incoming` hint, applied by the
 * caller BEFORE overlay drawing so effects/transitions never fight.
 */
export interface TransitionResult {
  overlayAlpha: number;
  /** Motion applied to the incoming frame while the transition runs. */
  incoming?: { scale?: number; dx?: number; dy?: number; rotate?: number; blurPx?: number };
}

const transitionScratchCanvases = new WeakMap<HTMLCanvasElement, Map<string, HTMLCanvasElement>>();

function getTransitionScratchCanvas(
  owner: HTMLCanvasElement,
  slot: string,
  width: number,
  height: number,
): HTMLCanvasElement {
  let slots = transitionScratchCanvases.get(owner);
  if (!slots) {
    slots = new Map<string, HTMLCanvasElement>();
    transitionScratchCanvases.set(owner, slots);
  }
  let scratch = slots.get(slot);
  if (!scratch) {
    scratch = document.createElement('canvas');
    slots.set(slot, scratch);
  }
  if (scratch.width !== width) scratch.width = width;
  if (scratch.height !== height) scratch.height = height;
  return scratch;
}

function applyTransitionFrame(
  ctx: CanvasRenderingContext2D,
  hint: NonNullable<TransitionResult['incoming']>,
  canvasW: number,
  canvasH: number
) {
  const scale = hint.scale ?? 1;
  if (scale === 1 && !hint.dx && !hint.dy && !hint.rotate && !hint.blurPx) return;
  /* Snapshot first. Drawing ctx.canvas onto itself can yield undefined
     feedback on some GPU/browser combinations and is a common source of
     transition flashes and black preview frames. */
  const source = getTransitionScratchCanvas(ctx.canvas, 'incoming-transform', canvasW, canvasH);
  const sourceCtx = source.getContext('2d');
  if (!sourceCtx) return;
  sourceCtx.setTransform(1, 0, 0, 1, 0, 0);
  sourceCtx.clearRect(0, 0, canvasW, canvasH);
  sourceCtx.drawImage(ctx.canvas, 0, 0, canvasW, canvasH);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvasW, canvasH);
  if (hint.blurPx) ctx.filter = `blur(${hint.blurPx}px)`;
  ctx.translate(canvasW / 2 + (hint.dx || 0), canvasH / 2 + (hint.dy || 0));
  if (hint.rotate) ctx.rotate((hint.rotate * Math.PI) / 180);
  if (scale !== 1) ctx.scale(scale, scale);
  ctx.translate(-canvasW / 2, -canvasH / 2);
  ctx.drawImage(source, 0, 0);
  ctx.filter = 'none';
  ctx.restore();
}

function applyTransition(
  ctx: CanvasRenderingContext2D,
  type: string,
  duration: number,
  timeIn: number,
  canvasW: number,
  canvasH: number
): TransitionResult {
  // A transition is an intro to this clip, not a per-frame effect for its entire lifetime.
  // Returning immediately after its duration avoids snapshotting and compositing a full-size
  // canvas on every subsequent playback frame (which can starve both preview and audio).
  if (!type || type === 'none' || duration <= 0 || timeIn >= duration) return { overlayAlpha: 0 };
  const progress = Math.max(0, Math.min(1, timeIn / duration));
  const eased = easeOut(progress);
  const W = canvasW;
  const H = canvasH;
  /* Effects below that reuse the composed frame must read from an immutable
     snapshot, never from ctx.canvas itself. */
  let source: HTMLCanvasElement | null = null;
  const needsSource = type === 'crossfade' || type === 'slide' || type === 'zoom-blur' || type === 'whip-pan' || type === 'glitch-cut' || type === 'blur';
  if (needsSource) {
    source = getTransitionScratchCanvas(ctx.canvas, 'transition-snapshot', W, H);
    const sourceCtx = source.getContext('2d');
    if (!sourceCtx) return { overlayAlpha: 0 };
    sourceCtx.setTransform(1, 0, 0, 1, 0, 0);
    sourceCtx.globalAlpha = 1;
    sourceCtx.globalCompositeOperation = 'source-over';
    sourceCtx.filter = 'none';
    sourceCtx.clearRect(0, 0, W, H);
    sourceCtx.drawImage(ctx.canvas, 0, 0, W, H);
  }

  switch (type) {
    case 'fade':
      ctx.fillStyle = `rgba(0,0,0,${1 - eased})`;
      ctx.fillRect(0, 0, W, H);
      return { overlayAlpha: 0 };

    case 'crossfade': {
      /* True dissolve: pull the PREVIOUS composed state back over the new
         frame with decaying alpha instead of a black pull-up. The canvas
         keeps one frame of history via the editor's compositor, so this
         self-blend reads as a real cross-dissolve. */
      ctx.save();
      ctx.globalAlpha = (1 - eased) * 0.85;
      ctx.drawImage(source!, 0, 0);
      ctx.restore();
      return { overlayAlpha: 0 };
    }

    case 'slide': {
      const shift = (1 - eased) * W;
      ctx.save();
      ctx.globalCompositeOperation = 'copy';
      ctx.drawImage(source!, shift, 0);
      ctx.restore();
      return { overlayAlpha: 0 };
    }

    case 'push': {
      const shift = (1 - eased) * W;
      ctx.fillStyle = '#000';
      ctx.fillRect(shift, 0, W - shift, H);
      return { overlayAlpha: 0 };
    }

    case 'zoom': {
      const scale = 1 + (1 - eased) * 0.3;
      return { overlayAlpha: 0, incoming: { scale } };
    }

    case 'zoom-blur': {
      /* Scale push with a directional blur that decays — the classic
        CapCut-style punch. Blur is faked with layered self-blends. */
      const energy = 1 - eased;
      const scale = 1 + energy * 0.35;
      ctx.save();
      for (let layer = 1; layer <= 3; layer += 1) {
        ctx.globalAlpha = (0.16 * energy) / layer;
        const ls = scale * (1 + 0.035 * layer * energy);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.translate(W / 2, H / 2);
        ctx.scale(ls, ls);
        ctx.translate(-W / 2, -H / 2);
        ctx.drawImage(source!, 0, 0);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.restore();
      return { overlayAlpha: 0, incoming: { scale } };
    }

    case 'whip-pan': {
      /* Horizontal motion blur streak: the incoming frame slides in with
         layered horizontal offsets fading out — reads as a camera whip. */
      const energy = 1 - eased;
      const dx = energy * W * 0.9;
      ctx.save();
      for (let layer = 1; layer <= 4; layer += 1) {
        ctx.globalAlpha = (0.22 * energy) / layer;
        ctx.drawImage(source!, (dx * layer) / 4, 0);
      }
      ctx.restore();
      return { overlayAlpha: 0, incoming: { dx } };
    }

    case 'spin': {
      const rotate = (1 - eased) * 14;
      const scale = 1 + (1 - eased) * 0.22;
      return { overlayAlpha: 0, incoming: { rotate, scale } };
    }

    case 'wipe': {
      ctx.fillStyle = '#000';
      ctx.fillRect(W * eased, 0, W * (1 - eased), H);
      return { overlayAlpha: 0 };
    }

    case 'luma-wipe': {
      /* Soft-edged wipe using a gradient mask instead of a hard bar. */
      const x = W * eased;
      const feather = W * 0.18;
      const gradient = ctx.createLinearGradient(x - feather, 0, x + feather * 0.2, 0);
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(1, 'rgba(0,0,0,1)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, Math.min(W, x + feather), H);
      if (x + feather < W) {
        ctx.fillStyle = '#000';
        ctx.fillRect(x + feather, 0, W - x - feather, H);
      }
      return { overlayAlpha: 0 };
    }

    case 'glitch-cut': {
      /* Digital tearing: horizontal slice offsets with RGB split that
         collapse to zero as the cut completes. */
      const energy = 1 - eased;
      const slices = 7;
      const sliceH = H / slices;
      ctx.save();
      for (let s = 0; s < slices; s += 1) {
        const jitter = Math.sin(timeIn * 47 + s * 12.9898) * energy * W * 0.06;
        const y = s * sliceH;
        const noise = Math.sin(timeIn * 91.7 + s * 17.13);
        const snap = noise > 1 - energy * 0.5 ? noise * energy * W * 0.08 : 0;
        ctx.drawImage(source!, 0, y, W, sliceH, jitter + snap, y, W, sliceH);
      }
      if (energy > 0.4) {
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.18 * energy;
        ctx.fillStyle = '#f0f';
        ctx.fillRect(-3 * energy, 0, W, H);
        ctx.fillStyle = '#0ff';
        ctx.fillRect(3 * energy, 0, W, H);
      }
      ctx.restore();
      return { overlayAlpha: 0 };
    }

    case 'film-burn': {
      /* Exposure flash + warm bloom, decaying — like overexposed film
         reacting to a cut. */
      const energy = 1 - eased;
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.5 * energy;
      const bloom = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
      bloom.addColorStop(0, 'rgba(255,214,170,1)');
      bloom.addColorStop(0.55, 'rgba(255,150,80,0.55)');
      bloom.addColorStop(1, 'rgba(120,40,10,0)');
      ctx.fillStyle = bloom;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      return { overlayAlpha: 0, incoming: { scale: 1 + energy * 0.12 } };
    }

    case 'dip-black': {
      const alpha = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
      ctx.fillStyle = `rgba(0,0,0,${Math.max(0, Math.min(1, alpha))})`;
      ctx.fillRect(0, 0, W, H);
      return { overlayAlpha: 0 };
    }

    case 'blur': {
      const energy = 1 - eased;
      ctx.save();
      ctx.globalAlpha = energy * 0.9;
      ctx.filter = `blur(${Math.round(14 * energy)}px)`;
      /* Never draw the canvas onto itself. 'source' is the immutable frame
         snapshot created above for transitions that need post-processing. */
      if (source) ctx.drawImage(source, 0, 0);
      ctx.restore();
      return { overlayAlpha: 0 };
    }

    default:
      return { overlayAlpha: 0 };
  }
}

/* ---------- original clip audio + basic voice cleanup ---------- */

/**
 * Audio envelope for the incoming clip transition. This is shared by the
 * real-time preview and export so transitions do not look faded while their
 * soundtrack starts abruptly. Time is local to the clip's timeline duration.
 */
export function clipTransitionAudioGain(
  clip: VideoClip,
  localTime: number,
  timelineDuration: number,
): number {
  const transition = clip.transitionIn;
  if (!transition || !transition.type || transition.type === 'none') return 1;
  const duration = Math.min(
    Math.max(0, timelineDuration),
    Math.max(0, Number(transition.duration) || 0),
  );
  if (duration <= 0) return 1;
  return Math.max(0, Math.min(1, localTime / duration));
}


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
  /* Async media decoding can finish out of order. A render generation per
     canvas prevents stale preview frames from painting over the newest one. */
  private renderTokens = new WeakMap<HTMLCanvasElement, number>();
  /** Set when the most recent drawFrame hit an undecodable/unreachable clip
      source; cleared on the next successful draw. The editor surfaces this. */
  lastSourceError: string | null = null;

  /** Non-fatal rendering issues that affect an effect but should not blank the frame. */
  lastRenderWarning: string | null = null;

  /** Set while an export is running — the editor guards double-exports. */
  isExporting = false;

  /*
   * Effect/filter/motion preview cards must never share the main editor's
   * decoder. Each card has its own VideoRenderer, so isolated previews get
   * their own <video> elements and playback clock.
   */
  private isolatedVideoCache = new Map<string, HTMLVideoElement>();
  private isolatedVideoLoading = new Map<string, Promise<HTMLVideoElement>>();
  private isolatedPlaybackState: PlaybackStateStore = new Map();

  /* Reused clip compositor surface. Creating a large canvas every playback
     frame causes allocation/GC spikes, especially with animated effects. */
  private clipSurface: HTMLCanvasElement | null = null;
  private clipSurfaceCtx: CanvasRenderingContext2D | null = null;
  /*
   * Keep filtering on a second surface. Applying ctx.filter directly while
   * drawing a live <video> is unreliable on some Chromium GPU paths and was
   * the source of the "effect selected -> black frame" failure. The media is
   * now always decoded/painted normally first; CSS filters are a second-pass
   * operation over already-rasterized pixels.
   */
  private clipFilterSurface: HTMLCanvasElement | null = null;
  private clipFilterSurfaceCtx: CanvasRenderingContext2D | null = null;
  /* Reuse the clean-frame backup instead of allocating a full clip-sized
     canvas on every frame. Per-frame canvas allocation caused substantial
     GC and graphics-memory pressure on Android while editing. */
  private effectBackupSurface: HTMLCanvasElement | null = null;
  private effectBackupSurfaceCtx: CanvasRenderingContext2D | null = null;

  private getEffectBackupSurface(width: number, height: number) {
    const w = Math.max(1, Math.ceil(width));
    const h = Math.max(1, Math.ceil(height));
    if (!this.effectBackupSurface || !this.effectBackupSurfaceCtx ||
        this.effectBackupSurface.width !== w || this.effectBackupSurface.height !== h) {
      const canvas = this.effectBackupSurface || document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      this.effectBackupSurface = canvas;
      this.effectBackupSurfaceCtx = canvas.getContext('2d');
    }
    return { canvas: this.effectBackupSurface, ctx: this.effectBackupSurfaceCtx };
  }

  private getClipSurface(width: number, height: number) {
    const w = Math.max(1, Math.ceil(width));
    const h = Math.max(1, Math.ceil(height));
    if (!this.clipSurface || !this.clipSurfaceCtx || this.clipSurface.width !== w || this.clipSurface.height !== h) {
      const canvas = this.clipSurface || document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      this.clipSurface = canvas;
      this.clipSurfaceCtx = canvas.getContext('2d');
    }
    if (!this.clipFilterSurface || !this.clipFilterSurfaceCtx || this.clipFilterSurface.width !== w || this.clipFilterSurface.height !== h) {
      const canvas = this.clipFilterSurface || document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      this.clipFilterSurface = canvas;
      this.clipFilterSurfaceCtx = canvas.getContext('2d');
    }
    return {
      canvas: this.clipSurface,
      ctx: this.clipSurfaceCtx,
      filterCanvas: this.clipFilterSurface,
      filterCtx: this.clipFilterSurfaceCtx,
    };
  }

  private applyClipFilter(
    surface: HTMLCanvasElement,
    surfaceCtx: CanvasRenderingContext2D,
    filterCanvas: HTMLCanvasElement,
    filterCtx: CanvasRenderingContext2D,
    filter: string,
  ) {
    if (!filter || filter === 'none') {
      surfaceCtx.filter = 'none';
      return;
    }

    /*
     * Filter syntax is user/project data. Browsers differ in how strictly
     * CanvasRenderingContext2D.filter validates CSS filter strings. Test the
     * filter on the disposable filter context first; never clear the source
     * surface until the filter has been accepted.
     */
    try {
      filterCtx.setTransform(1, 0, 0, 1, 0, 0);
      filterCtx.globalAlpha = 1;
      filterCtx.globalCompositeOperation = 'source-over';
      filterCtx.filter = 'none';
      filterCtx.clearRect(0, 0, filterCanvas.width, filterCanvas.height);
      filterCtx.drawImage(surface, 0, 0);

      filterCtx.filter = filter;
      if (filterCtx.filter === 'none' && filter.trim() !== 'none') {
        surfaceCtx.filter = 'none';
        return;
      }

      filterCtx.clearRect(0, 0, filterCanvas.width, filterCanvas.height);
      filterCtx.drawImage(surface, 0, 0);

      surfaceCtx.filter = 'none';
      surfaceCtx.setTransform(1, 0, 0, 1, 0, 0);
      surfaceCtx.globalAlpha = 1;
      surfaceCtx.globalCompositeOperation = 'source-over';
      surfaceCtx.clearRect(0, 0, surface.width, surface.height);
      surfaceCtx.drawImage(filterCanvas, 0, 0);
    } catch {
      /*
       * The clean source surface is intentionally left alone whenever
       * possible. Reset state only; do not attempt a risky recovery draw.
       */
    } finally {
      try { surfaceCtx.filter = 'none'; } catch {}
      try { filterCtx.filter = 'none'; } catch {}
    }
  }

  /** Cooperative cancellation flag for the running export. */
  private exportCancelled = false;

  /** Sources whose reversed-frame cache is currently being built (one build at a time per source). */
  private reverseCacheBuilding = new Set<string>();

  private loadIsolatedVideo(src: string): Promise<HTMLVideoElement> {
    const cached = this.isolatedVideoCache.get(src);
    if (cached) return Promise.resolve(cached);
    const pending = this.isolatedVideoLoading.get(src);
    if (pending) return pending;

    const promise = new Promise<HTMLVideoElement>((resolve, reject) => {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.src = src;

      const timeout = window.setTimeout(() => {
        this.isolatedVideoLoading.delete(src);
        reject(new Error('Timed out loading video preview.'));
      }, 20000);

      const fail = () => {
        window.clearTimeout(timeout);
        this.isolatedVideoLoading.delete(src);
        reject(new Error('Could not load video preview.'));
      };

      video.onerror = fail;
      video.onloadeddata = async () => {
        try {
          window.clearTimeout(timeout);
          await normalizeVideoDuration(video);
          this.isolatedVideoCache.set(src, video);
          this.isolatedVideoLoading.delete(src);
          resolve(video);
        } catch (e) {
          this.isolatedVideoLoading.delete(src);
          reject(e);
        }
      };
    });

    this.isolatedVideoLoading.set(src, promise);
    return promise;
  }

  private syncIsolatedVideo(
    video: HTMLVideoElement,
    src: string,
    target: number,
    playing: boolean,
    forceSeek = false,
    rate = 1,
    reverse = false,
  ) {
    return syncPlaybackVideo(
      video,
      src,
      target,
      playing,
      forceSeek,
      rate,
      reverse,
      this.isolatedPlaybackState,
    );
  }

  /**
   * Prepare a reversed clip before the editor switches it on.
   */
  async prepareReverseClip(
    clip: VideoClip,
    onProgress?: (percent: number) => void
  ): Promise<void> {
    if (!clip.src || isPlaceholder(clip.src)) return;
    const key = reverseCacheKey(clip.src, clip.trimStart, clip.trimEnd);
    if (reverseCache.has(key)) { onProgress?.(100); return; }

    if (this.reverseCacheBuilding.has(key)) {
      for (let i = 0; i < 600; i++) {
        if (!this.reverseCacheBuilding.has(key)) break;
        await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
        onProgress?.(Math.min(95, Math.round((i / 600) * 95)));
      }
      if (reverseCache.has(key)) onProgress?.(100);
      return;
    }

    this.reverseCacheBuilding.add(key);
    try {
      onProgress?.(5);
      const builder = await loadDetachedVideo(clip.src);
      onProgress?.(20);
      const frames = await buildReverseFrames(builder, clip.trimStart, clip.trimEnd);
      if (!frames.length) throw new Error('The browser could not prepare reverse frames for this clip.');
      evictReverseCache();
      reverseCache.set(key, {
        frames,
        builtAt: Date.now(),
        src: clip.src,
        trimStart: clip.trimStart,
        trimEnd: clip.trimEnd,
      });
      onProgress?.(100);
    } finally {
      this.reverseCacheBuilding.delete(key);
    }
  }

  /** Cancel the in-flight export (safe to call anytime). */
  cancelExport() {
    this.exportCancelled = true;
  }

  /**
   * Wait for the browser's actual decoded video frame before composing the
   * next playing preview frame. This prevents the editor clock/rAF from
   * repeatedly painting the same decoder frame or racing a decoder update.
   */
  async waitForPlaybackFrame(project: VideoProject, time: number): Promise<void> {
    const resolved = resolveTime(normalizeProject(project), time);
    if (!resolved || resolved.clip.media_type === 'image') return;
    try {
      const video = await loadVideo(resolved.clip.src);
      if (!video || video.readyState < 2) return;
      const rvfc = video as HTMLVideoElement & {
        requestVideoFrameCallback?: (callback: (now: number, metadata: VideoFrameCallbackMetadata) => void) => number;
      };
      if (typeof rvfc.requestVideoFrameCallback !== 'function') return;
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        try {
          rvfc.requestVideoFrameCallback!(() => finish());
          window.setTimeout(finish, 100);
        } catch {
          finish();
        }
      });
    } catch {
      /* Visual playback can fall back to the next clock tick. */
    }
  }

  /** Draw one project-time frame onto the given canvas. Shared by preview + export. */
  async drawFrame(
    canvas: HTMLCanvasElement,
    project: VideoProject,
    time: number,
    opts: { previewing?: boolean; playing?: boolean; isolatedPreview?: boolean } = {}
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      this.lastSourceError = 'The preview canvas is unavailable. Reopen the editor preview to recover rendering.';
      return;
    }
    const contextState = ctx as CanvasRenderingContext2D & { isContextLost?: () => boolean };
    if (typeof contextState.isContextLost === 'function' && contextState.isContextLost()) {
      this.lastSourceError = 'The device temporarily lost its graphics canvas. Rendering will resume when the browser restores it.';
      return;
    }
    const token = (this.renderTokens.get(canvas) || 0) + 1;
    this.renderTokens.set(canvas, token);
    this.lastRenderWarning = null;
    const isCurrent = () => this.renderTokens.get(canvas) === token;
    project = normalizeProject(project);
    this.ctx = ctx;
    const { width: W, height: H } = project.canvas;
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }

    /* Keep the previous valid frame on the visible canvas while the next
       video frame is loading/decoding. Painting the background before awaits
       caused mobile decoders to expose a black canvas during transient stalls.
       Commit a new background only when this render has a drawable frame. */
    const background = project.background;
    let backgroundImage: HTMLImageElement | null = null;
    let backgroundVideo: HTMLVideoElement | null = null;
    if (background?.imageSrc) {
      try {
        backgroundImage = await loadImage(background.imageSrc);
      } catch {
        backgroundImage = null;
        this.lastRenderWarning = 'The canvas background image could not be loaded. Check that the file still exists and its URL is accessible, then re-upload it if needed.';
      }
    }
    if (background?.videoSrc) {
      try {
        /* The background owns a dedicated decoder. Reusing the timeline's
           URL-keyed videoCache lets a source used both as a background and as
           a clip fight over currentTime, causing one layer to flash or show
           the wrong frame. Use this renderer's isolated decoder in both
           preview and export; its clock is independent from timeline clips. */
        backgroundVideo = await this.loadIsolatedVideo(background.videoSrc);
        const duration = Number.isFinite(backgroundVideo.duration) && backgroundVideo.duration > 0
          ? backgroundVideo.duration
          : 1;
        const target = ((Math.max(0, time) % duration) + duration) % duration;
        await this.syncIsolatedVideo(
          backgroundVideo,
          background.videoSrc,
          target,
          !!opts.playing,
          false,
          1,
          false,
        );
      } catch {
        backgroundVideo = null;
        this.lastRenderWarning ||= 'The canvas background video could not be loaded or decoded. Check the source URL and browser video format support, then re-upload it if needed.';
      }
    }
    let backgroundPainted = false;
    const paintBackground = () => {
      if (background?.type === 'gradient') {
        const angle = ((Number(background.angle) || 0) * Math.PI) / 180;
        const radius = Math.hypot(W, H);
        const cx = W / 2;
        const cy = H / 2;
        const dx = Math.cos(angle) * radius;
        const dy = Math.sin(angle) * radius;
        const gradient = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
        gradient.addColorStop(0, background.color || '#000000');
        gradient.addColorStop(1, background.color2 || background.color || '#000000');
        ctx.fillStyle = gradient;
      } else {
        ctx.fillStyle = background?.color || '#000000';
      }
      ctx.fillRect(0, 0, W, H);
      const movingBackground = backgroundVideo && backgroundVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        && backgroundVideo.videoWidth > 0 && backgroundVideo.videoHeight > 0
        ? backgroundVideo
        : null;
      const stillBackground = backgroundImage && backgroundImage.naturalWidth > 0 && backgroundImage.naturalHeight > 0
        ? backgroundImage
        : null;
      const source = movingBackground || stillBackground;
      if (source) {
        const iw = movingBackground ? movingBackground.videoWidth : (source as HTMLImageElement).naturalWidth;
        const ih = movingBackground ? movingBackground.videoHeight : (source as HTMLImageElement).naturalHeight;
        const fitScale = background?.imageFit === 'contain' ? Math.min(W / iw, H / ih) : Math.max(W / iw, H / ih);
        const scale = fitScale * Math.max(0.25, Math.min(4, Number(background?.mediaScale) || 1));
        const dw = iw * scale;
        const dh = ih * scale;
        const dx = (W - dw) / 2 + (Number(background?.mediaOffsetX) || 0) * W;
        const dy = (H - dh) / 2 + (Number(background?.mediaOffsetY) || 0) * H;
        ctx.drawImage(source, dx, dy, dw, dh);
      }
      backgroundPainted = true;
    };

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
      const sourceTime = clipSourceTimeAtLocal(clip, local);
      const freeze = clip.freezeFrame;
      const isFreezeHold = !!freeze && freeze.duration > 0 && local >= freeze.at && local < freeze.at + freeze.duration;
      const timeIn = Math.max(0, time - acc);
      const dur = clipDuration(clip);
      const eff = effectTransform(clip, timeIn, dur);
      try {
        const image = clip.media_type === 'image' ? await loadImage(clip.src) : null;
        if (!isCurrent()) return;
        const video = image
          ? null
          : opts.isolatedPreview
            ? await this.loadIsolatedVideo(clip.src)
            : await loadVideo(clip.src);
        if (!isCurrent()) return;
        const target = clip.reverse
          ? Math.max(clip.trimStart, sourceTime)
          : Math.min(sourceTime, Math.max(0, (clip.sourceDuration || 0) - 0.05));
        const mediaReady = image
          ? image.complete && image.naturalWidth > 0 && image.naturalHeight > 0
          : !!video &&
            video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
            video.videoWidth > 0 &&
            video.videoHeight > 0;
        if (mediaReady) {
          this.lastSourceError = null;
          const animated = resolveClipValues(clip, timeIn);
          const animatedClip = animated.scale === clip.transform.scale && animated.rotation === clip.transform.rotation && animated.offset_x === clip.transform.offset_x && animated.offset_y === clip.transform.offset_y && animated.opacity === 1 && animated.volume === clip.volume
            ? clip
            : {
                ...clip,
                volume: animated.volume,
                opacity: animated.opacity,
                transform: { ...clip.transform, scale: animated.scale, offset_x: animated.offset_x, offset_y: animated.offset_y, rotation: animated.rotation },
              };
          const mediaW = image ? image.naturalWidth : video!.videoWidth;
          const mediaH = image ? image.naturalHeight : video!.videoHeight;
          const t = clipDrawRect(animatedClip, W, H, mediaW, mediaH, eff);

          /* REVERSE, fast path: paint from the pre-built frame cache instead
             of seek-per-frame (~2.5 fps measured → unusable). Cache is built
             on first sight of the reversed clip; while it builds (one fast
             forward pass) frames fall back to the seek path, then playback
             is pure memory hits at full frame rate. */
           /*
            * Clip-local compositor: filters, effects and masks are rendered
            * into the media's actual resized surface first. This prevents a
            * resized/moved clip from leaving its effects behind on the full
            * project canvas.
            */
           const surfaceState = this.getClipSurface(t.dw, t.dh);
           const surface = surfaceState.canvas;
           const sctx = surfaceState.ctx;
           const filterCanvas = surfaceState.filterCanvas;
           const filterCtx = surfaceState.filterCtx;
           if (!surface || !sctx || !filterCanvas || !filterCtx) return;
           sctx.setTransform(1, 0, 0, 1, 0, 0);
           sctx.globalAlpha = 1;
           sctx.globalCompositeOperation = 'source-over';
           sctx.filter = 'none';
           sctx.clearRect(0, 0, surface.width, surface.height);

           let paintedFromCache = false;
           if (clip.reverse) {
             const key = reverseCacheKey(clip.src, clip.trimStart, clip.trimEnd);
             let entry = reverseCache.get(key);
             if (!entry && !this.reverseCacheBuilding.has(key)) {
               this.reverseCacheBuilding.add(key);
               loadDetachedVideo(clip.src)
                 .then((builder) => buildReverseFrames(builder, clip.trimStart, clip.trimEnd))
                 .then((frames) => {
                   if (frames.length) {
                     evictReverseCache();
                     reverseCache.set(key, { frames, builtAt: Date.now(), src: clip.src, trimStart: clip.trimStart, trimEnd: clip.trimEnd });
                   }
                 })
                 .catch(() => {})
                 .finally(() => this.reverseCacheBuilding.delete(key));
             }
             entry = reverseCache.get(key);
             const frame = entry ? nearestReverseFrame(entry, sourceTime) : null;
             if (frame) {
               sctx.filter = 'none';
               sctx.drawImage(frame.bmp as CanvasImageSource, 0, 0, surface.width, surface.height);
               paintedFromCache = true;
             }
           }

           if (!paintedFromCache) {
             if (video) {
               if (opts.isolatedPreview) {
                await this.syncIsolatedVideo(video, clip.src, target, !!opts.playing && !isFreezeHold, !opts.previewing, clip.speed, !!clip.reverse);
              } else {
                await syncPlaybackVideo(video, clip.src, target, !!opts.playing && !isFreezeHold, !opts.previewing, clip.speed, !!clip.reverse);
              }
              if (!image && (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth <= 0 || video.videoHeight <= 0)) {
                return;
              }
               if (!isCurrent()) return;
             }
             sctx.save();
             sctx.filter = 'none';
             const maskSaved = applyMaskClip(sctx, clip.transform.mask, surface.width, surface.height);
             if (image) {
               sctx.drawImage(image, t.sx, t.sy, t.sw, t.sh, 0, 0, surface.width, surface.height);
             } else {
               /* IMPORTANT: never apply CSS filters while rasterizing a live
                  video frame. Paint the decoded frame normally first. */
               sctx.drawImage(video!, t.sx, t.sy, t.sw, t.sh, 0, 0, surface.width, surface.height);
             }
             if (maskSaved) sctx.restore();
             /* Chroma key runs on the same raster surface used by live preview
                and export, before motion and visual effects are composited. */
             if (clip.chromaKey?.enabled) {
               try {
                 applyChromaKeyPixels(sctx, surface.width, surface.height, clip.chromaKey);
               } catch (keyError) {
                 /* Preserve the unkeyed frame, but surface why the key could not
                    be applied instead of silently pretending the effect worked. */
                 const detail = keyError instanceof DOMException && keyError.name === 'SecurityError'
                   ? 'the browser blocked pixel access (often due to media CORS)'
                   : 'the source frame could not be processed';
                 this.lastRenderWarning = `Chroma key was skipped for "${clip.name || 'this clip'}" because ${detail}. Try a same-origin upload or a CORS-enabled media URL.`;
               }
             }
             sctx.filter = 'none';
             sctx.restore();

             /* Motion presets are deliberately applied AFTER the media has
                been rasterized into the fixed clip surface. This means Float,
                Spin, Zoom, etc. animate the pixels inside the clip frame while
                the frame itself stays exactly where the editor controls put it. */
             const motion = clipMotionTransform(clip, timeIn, dur);
             if (motion.scale !== 1 || motion.dx !== 0 || motion.dy !== 0 || motion.rotation !== 0) {
               filterCtx.setTransform(1, 0, 0, 1, 0, 0);
               filterCtx.globalAlpha = 1;
               filterCtx.globalCompositeOperation = 'copy';
               filterCtx.filter = 'none';
               filterCtx.clearRect(0, 0, filterCanvas.width, filterCanvas.height);
               filterCtx.drawImage(surface, 0, 0);

               sctx.setTransform(1, 0, 0, 1, 0, 0);
               sctx.globalAlpha = 1;
               sctx.globalCompositeOperation = 'source-over';
               sctx.filter = 'none';
               sctx.clearRect(0, 0, surface.width, surface.height);
               sctx.translate(surface.width / 2 + motion.dx, surface.height / 2 + motion.dy);
               sctx.rotate((motion.rotation * Math.PI) / 180);
               sctx.scale(motion.scale, motion.scale);
               sctx.translate(-surface.width / 2, -surface.height / 2);
               sctx.drawImage(filterCanvas, 0, 0);
               sctx.setTransform(1, 0, 0, 1, 0, 0);
               sctx.globalCompositeOperation = 'source-over';
             }
           }

           /*
            * EFFECT SAFETY BOUNDARY
            * ---------------------
            * A malformed/unsupported filter, blend mode, GPU canvas operation,
            * or newly-added effect must NEVER destroy the decoded base frame.
            * Previously every effect lived inside the outer media try/catch, so
            * one throwing effect made the whole editor report "Media cannot be
            * played" and left a black monitor.
            *
            * Keep an untouched raster backup, then restore it if any effect
            * fails. This also makes experimental effects safe to add later.
            */
           const backupState = this.getEffectBackupSurface(surface.width, surface.height);
           const effectBackup = backupState.canvas;
           const effectBackupCtx = backupState.ctx;
           if (effectBackup && effectBackupCtx) {
             effectBackupCtx.setTransform(1, 0, 0, 1, 0, 0);
             effectBackupCtx.globalAlpha = 1;
             effectBackupCtx.globalCompositeOperation = 'copy';
             effectBackupCtx.filter = 'none';
             effectBackupCtx.clearRect(0, 0, effectBackup.width, effectBackup.height);
             effectBackupCtx.drawImage(surface, 0, 0);
             effectBackupCtx.globalCompositeOperation = 'source-over';
           }

           try {
             /* Filters are deliberately a second pass over rasterized pixels.
                This keeps filter selection from turning the source frame black. */
             const adjustments = resolveClipAdjustments(clip, timeIn);
             const clipFilter = [filterCssFor(clip, adjustments), effectFilterCss(clip, timeIn)]
               .filter((value) => typeof value === 'string' && value.trim().length > 0)
               .join(' ');
             this.applyClipFilter(surface, sctx, filterCanvas, filterCtx, clipFilter);

             // Legacy effects are clipped to the media surface.
             drawEffectOverlay(sctx, clip, timeIn, surface.width, surface.height);

             // Advanced effects are optional. A bad layer is isolated so the
             // base video remains visible instead of crashing the compositor.
             if (clip.effects?.length) {
               const safeLayers = clip.effects.filter((layer) =>
                 layer &&
                 layer.type &&
                 layer.type !== 'none' &&
                 Number.isFinite(Number(layer.intensity ?? 1))
               );
               if (safeLayers.length) {
                 drawAdvancedEffectStack(sctx, safeLayers, timeIn, surface.width, surface.height);
               }
             }
           } catch (effectError) {
             /* Restore the clean media pixels and continue rendering. */
             if (effectBackupCtx) {
               sctx.setTransform(1, 0, 0, 1, 0, 0);
               sctx.globalAlpha = 1;
               sctx.globalCompositeOperation = 'source-over';
               sctx.filter = 'none';
               sctx.clearRect(0, 0, surface.width, surface.height);
               sctx.drawImage(effectBackup, 0, 0);
             }
             this.lastSourceError = null;
             void effectError;
           }

           // Only replace the visible frame after the decoder produced usable pixels.
           // If syncPlaybackVideo returns early during a transient stall, the previous
           // canvas frame remains intact instead of flashing the project background.
           if (!isCurrent()) return;
           paintBackground();

           // The finished clip surface is now transformed into project space.
           ctx.save();
           ctx.translate(W / 2 + animated.offset_x + eff.dx, H / 2 + animated.offset_y + eff.dy);
           ctx.rotate((animated.rotation * Math.PI) / 180);
           ctx.scale(animatedClip.transform.flip_h ? -1 : 1, animatedClip.transform.flip_v ? -1 : 1);
           ctx.globalAlpha = Math.max(0, Math.min(1, animated.opacity));
           ctx.drawImage(surface, -surface.width / 2, -surface.height / 2);
           ctx.restore();

          // transition INTO this clip; motion transitions transform the
          // freshly painted frame before overlays render
          const transition = applyTransition(ctx, clip.transitionIn.type, clip.transitionIn.duration, timeIn, W, H);
          if (transition.incoming) {
            applyTransitionFrame(ctx, transition.incoming, W, H);
          }
        }
      } catch {
        // Source undecodable/unreachable (e.g. HEVC phone video, deleted file,
        // unfilled template placeholder). Surface WHY instead of a silent black
        // canvas — the editor reads lastSourceError to show a real explanation.
        if (!isCurrent()) return;
        if (!backgroundPainted) paintBackground();
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

    // A gap, background-only project, or image-less frame still needs its
    // project background. Video renders paint it only after a valid frame exists.
    if (!backgroundPainted && isCurrent()) paintBackground();

    // overlays sorted by z
    const overlays = project.elements
      .filter((el) => time >= el.start && time < el.end)
      .sort((a, b) => a.z - b.z);

    for (const el of overlays) {
      if (!isCurrent()) return;
      const timeIn = Math.max(0, time - el.start);
      if (el.kind === 'text') {
        drawTextElement(ctx, el, W, timeIn);
      } else if (el.kind === 'video' || el.media_type === 'video') {
        try {
          if (opts.isolatedPreview) {
            await drawVideoElement(
              ctx,
              el,
              timeIn,
              !!opts.previewing,
              !!opts.playing,
              (src) => this.loadIsolatedVideo(src),
              (video, src, target, playing, forceSeek, rate, reverse) =>
                this.syncIsolatedVideo(video, src, target, playing, forceSeek, rate, reverse),
            );
          } else {
            await drawVideoElement(ctx, el, timeIn, !!opts.previewing, !!opts.playing);
          }
          if (!isCurrent()) return;
        } catch {
          this.lastSourceError = el.src;
        }
      } else {
        if (el.src && !imageCache.has(el.src)) await loadImage(el.src).catch(() => undefined);
        drawImageElement(ctx, el, timeIn);
      }
    }

    const activeSources = new Set<string>();
    // Background video is a first-class active layer. Without registering it
    // here, pauseInactiveVideos would pause it at the end of every playing frame.
    if (background?.videoSrc) activeSources.add(background.videoSrc);
    if (resolved?.clip.src) activeSources.add(resolved.clip.src);
    for (const el of overlays) {
      if (el.src && (el.kind === 'video' || el.media_type === 'video')) activeSources.add(el.src);
    }
    if (!isCurrent()) return;
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
          /*
           * Clip position keyframes are absolute project-canvas pixels.
           * Scale them exactly like the live transform when exporting to a
           * different output resolution; scale/rotation/opacity/volume remain
           * unitless and must not be changed.
           */
          keyframes: c.keyframes
            ? (Object.fromEntries(
                Object.entries(c.keyframes).map(([prop, frames]) => [
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
              ) as typeof c.keyframes)
            : undefined,
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
          if (clip && clip.media_type !== 'image') failedClips.add(clip.name || 'clip');
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
          try {
            await this.prepareReverseClip(clip, (p) => {
              onProgress?.({
                phase: 'processing',
                percent: Math.min(9, 4 + Math.round(p * 0.05)),
                message: 'Preparing reverse: ' + Math.round(p) + '%',
              });
            });
          } catch {}
        }
      }

      /*
       * A/V SYNC: render the very first visual frame BEFORE creating and
       * scheduling the audio graph. Previously audio could be scheduled
       * while the decoder was still preparing frame 0. On slower devices or
       * remote media, that made the soundtrack become audible before the
       * first video frame reached canvas.captureStream(). The exported file
       * then looked like the sound was "ahead" of the picture.
       *
       * Frame 0 is now decoded/painted first. Only after it is ready do we
       * start the recorder and schedule audio, so the captured timeline has
       * a real visual frame at its beginning instead of an empty/old canvas.
       */
      try {
        await this.drawFrame(canvas, scaled, 0, { previewing: true, playing: true, isolatedPreview: true });
      } catch (e) {
        throw e instanceof Error ? e : new Error('Unable to render the first video frame.');
      }

      onProgress?.({ phase: 'processing', percent: 5, message: 'Setting up audio mix…' });

      /* ---------- audio graph ----------
       * The project audio graph is the source of truth for export.
       * Do NOT run a throw-away MediaRecorder probe here: a probe can fail
       * while the real graph is valid, and the old fallback closed this
       * context and silently produced a video-only file.
       */
      const audioCtx = new AudioContext();
      if (audioCtx.state === 'suspended') {
        try { await audioCtx.resume(); } catch { /* checked below */ }
      }
      if (audioCtx.state !== 'running') {
        throw new Error('The audio engine could not start. Click Play once and export again.');
      }
      const destination = audioCtx.createMediaStreamDestination();

      const connectTrack = async (track: { src: string; volume: number; trimStart: number; fadeOutSec: number; fadeInSec: number; startAt: number; trackDuration: number; effects?: import('@/lib/video/project').AudioEffect[] }) => {
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

          /* connectAudioEffects terminates at the supplied final gain and output. Do not connect the returned gain again: the old code passed the same gain as both final node and output, creating a gain -> gain cycle. */
          connectAudioEffects(audioCtx, source, track.effects, destination, gain);
          source.start(t0, track.trimStart, Math.max(0.1, track.trackDuration));
        } catch {
          /* audio decode failure shouldn't kill the video export */
        }
      };

      /* Keep audio on the same project-time zero as the first captured visual frame.
         The recorder starts only after the graph is scheduled, so a fixed lead-in
         would otherwise make every exported soundtrack audibly late. */
      let startDelay = 0;

      // Main-track original audio. Prefer Web Audio decoding when the source is
      // a standalone audio stream, but do NOT assume a video container can be
      // passed to decodeAudioData(). MP4/WebM files are containers that must be
      // demuxed by the media element. When decodeAudioData() rejects the full
      // video file, fall back to an HTMLAudioElement + MediaElementAudioSourceNode
      // so AAC/Opus tracks embedded in the video remain audible in the export.
      //
      // The fallback is deliberately kept per-clip. One problematic clip must
      // not remove audio from every other clip in the project.
      const exportMediaAudio: Array<{ media: HTMLAudioElement; timer: number | null; stopTimer: number | null }> = [];
      const scheduleMediaClipAudio = async (
        clip: VideoClip,
        clipStart: number,
        clipDurationSec: number,
      ) => {
        if (clip.reverse) {
          throw new Error('Reverse clip audio requires a directly decodable audio buffer.');
        }

        const media = document.createElement('audio');
        media.crossOrigin = 'anonymous';
        media.preload = 'auto';
        media.volume = 1;
        media.muted = false;
        media.defaultMuted = false;
        media.src = clip.src;
        // Match AudioBufferSourceNode playback: linked source audio changes pitch
        // naturally with speed rather than using the browser's pitch correction.
        media.preservesPitch = false;

        const waitForMetadata = new Promise<void>((resolve, reject) => {
          if (media.readyState >= HTMLMediaElement.HAVE_METADATA) {
            resolve();
            return;
          }
          const onReady = () => {
            cleanup();
            resolve();
          };
          const onError = () => {
            cleanup();
            reject(new Error(media.error?.message || 'The video audio track could not be opened.'));
          };
          const cleanup = () => {
            media.removeEventListener('loadedmetadata', onReady);
            media.removeEventListener('error', onError);
          };
          media.addEventListener('loadedmetadata', onReady, { once: true });
          media.addEventListener('error', onError, { once: true });
        });
        await waitForMetadata;

        const source = audioCtx.createMediaElementSource(media);
        const volumeGain = audioCtx.createGain();
        const audioStart = audioCtx.currentTime + startDelay + clipStart;
        const audioSteps = Math.max(2, Math.ceil(clipDurationSec * 20));

        for (let i = 0; i <= audioSteps; i++) {
          const u = i / audioSteps;
          const value = resolveClipValues(clip, u * clipDurationSec).volume * clipTransitionAudioGain(clip, u * clipDurationSec, clipDurationSec);
          const at = audioStart + u * clipDurationSec;
          if (i === 0) volumeGain.gain.setValueAtTime(Math.max(0.0001, value), audioStart);
          else volumeGain.gain.linearRampToValueAtTime(Math.max(0.0001, value), at);
        }

        connectAudioEffects(audioCtx, source, clip.audioProcessing?.effects, destination, volumeGain);

        /*
         * Start the media element exactly at the clip's project position.
         * A media element has its own clock, so seeking to trimStart immediately
         * and then delaying play would be safe, but calling play() later can hit
         * autoplay policy on some browsers. Instead, start it muted at export
         * setup (inaudible autoplay is allowed), then seek to the real trim point
         * and unmute at the scheduled project start. The Web Audio gain remains
         * the final volume authority.
         */
        media.muted = true;
        media.currentTime = Math.max(0, clip.trimStart);
        const startDelayMs = Math.max(0, (audioStart - audioCtx.currentTime) * 1000);
        const timer = window.setTimeout(() => {
          try {
            media.currentTime = Math.max(0, clip.trimStart);
            media.muted = false;
            media.playbackRate = Math.max(0.0625, Math.min(16, clip.speed || 1));
            void media.play().catch(() => {
              /* The caller verifies the destination track; keep the media
                 object alive long enough for the browser to retry playback. */
            });
          } catch {}
        }, startDelayMs);
        // A media-element fallback must stop at the retimed clip boundary;
        // otherwise its audio can bleed underneath every later clip.
        const stopTimer = window.setTimeout(() => {
          media.pause();
          media.muted = true;
        }, startDelayMs + Math.max(0, clipDurationSec) * 1000);

        exportMediaAudio.push({ media, timer, stopTimer });
        void media.play().catch(() => {});
      };

      if (!scaled.masterMuted) {
        let clipStart = 0;
        for (const clip of scaled.clips) {
          const clipDurationSec = clipDuration(clip);
          if (clip.media_type !== 'image' && !clip.muted && clip.volume > 0 && !isPlaceholder(clip.src)) {
            try {
              const res = await fetch(clip.src);
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const array = await res.arrayBuffer();

              try {
                const decoded = await audioCtx.decodeAudioData(array);
                const source = audioCtx.createBufferSource();
                const trimLength = Math.max(0.05, clip.trimEnd - clip.trimStart);
                if (clip.reverse) {
                  source.buffer = reverseAudioSegment(audioCtx, decoded, clip.trimStart, clip.trimEnd);
                  source.playbackRate.value = Math.max(0.0625, Math.min(16, clip.speed));
                  const processed = connectAudioProcessing(audioCtx, source, 1, {
                    noiseReduction: clip.audioProcessing?.noiseReduction || 0,
                    highPassHz: clip.audioProcessing?.highPassHz || 80,
                    lowPassHz: clip.audioProcessing?.lowPassHz || 14000,
                    compressor: clip.audioProcessing?.compressor || false,
                  });
                  const volumeGain = audioCtx.createGain();
                  const audioStart = audioCtx.currentTime + startDelay + clipStart;
                  const audioSteps = Math.max(2, Math.ceil(clipDurationSec * 20));
                  for (let i = 0; i <= audioSteps; i++) {
                    const u = i / audioSteps;
                    const value = resolveClipValues(clip, u * clipDurationSec).volume * clipTransitionAudioGain(clip, u * clipDurationSec, clipDurationSec);
                    if (i === 0) volumeGain.gain.setValueAtTime(Math.max(0.0001, value), audioStart);
                    else volumeGain.gain.linearRampToValueAtTime(Math.max(0.0001, value), audioStart + u * clipDurationSec);
                  }
                  connectAudioEffects(audioCtx, processed, clip.audioProcessing?.effects, destination, volumeGain);
                  source.start(audioStart, 0, trimLength);
                } else {
                  source.buffer = decoded;
                  source.playbackRate.value = Math.max(0.0625, Math.min(16, clip.speed));
                  const processed = connectAudioProcessing(audioCtx, source, 1, {
                    noiseReduction: clip.audioProcessing?.noiseReduction || 0,
                    highPassHz: clip.audioProcessing?.highPassHz || 80,
                    lowPassHz: clip.audioProcessing?.lowPassHz || 14000,
                    compressor: clip.audioProcessing?.compressor || false,
                  });
                  const volumeGain = audioCtx.createGain();
                  const audioStart = audioCtx.currentTime + startDelay + clipStart;
                  const audioSteps = Math.max(2, Math.ceil(clipDurationSec * 20));
                  for (let i = 0; i <= audioSteps; i++) {
                    const u = i / audioSteps;
                    const value = resolveClipValues(clip, u * clipDurationSec).volume * clipTransitionAudioGain(clip, u * clipDurationSec, clipDurationSec);
                    if (i === 0) volumeGain.gain.setValueAtTime(Math.max(0.0001, value), audioStart);
                    else volumeGain.gain.linearRampToValueAtTime(Math.max(0.0001, value), audioStart + u * clipDurationSec);
                  }
                  connectAudioEffects(audioCtx, processed, clip.audioProcessing?.effects, destination, volumeGain);
                  source.start(audioStart, clip.trimStart, trimLength);
                }
              } catch {
                /*
                 * IMPORTANT: decodeAudioData() is not a reliable video-container
                 * demuxer. Fall through to the browser's media-element decoder
                 * instead of silently dropping the clip soundtrack.
                 */
                await scheduleMediaClipAudio(clip, clipStart, clipDurationSec);
              }
            } catch {
              /*
               * Network/fetch errors are still isolated to this clip. The
               * existing source validation reports unusable media separately.
               */
            }
          }
          clipStart += clipDurationSec;
        }
      }

      const audioTracks = project.tracks.filter((t) => t.kind === 'audio');
      const audioSoloActive = audioTracks.some((t) => t.solo);
      for (const audio of project.audio) {
        /* Template sound slots are intentionally silent until replaced. */
        if (isAudioPlaceholder(audio.src)) continue;
        const lane = audioTracks.find((t) => t.id === audio.track_id) || audioTracks[0];
        if (lane?.muted) continue;
        if (audioSoloActive && !lane?.solo) continue;
        await connectTrack({
          src: audio.src,
          volume: audio.volume,
          trimStart: audio.trimStart,
          fadeInSec: audio.fadeIn,
          fadeOutSec: audio.fadeOut,
          startAt: startDelay + audio.start,
          trackDuration: Math.max(0.1, audio.trimEnd - audio.trimStart),
          effects: audio.audioProcessing?.effects,
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
          const speed = Math.max(0.0625, Math.min(16, el.speed || 1));
          const source = audioCtx.createBufferSource();
          source.playbackRate.value = speed;
          const elStart = audioCtx.currentTime + startDelay + el.start;
          const elLen = Math.max(0.1, el.end - el.start);
          const trimStart = Math.max(0, el.trim_start || 0);
          const trimEnd = Math.min(decoded.duration, Math.max(trimStart + 0.05, el.trim_end || decoded.duration));
          const availableSource = Math.max(0.05, trimEnd - trimStart);
          const scheduledSourceDuration = Math.min(availableSource, elLen * speed);

          /*
           * Overlay video audio must follow the same trim/speed/reverse window
           * as the picture. Reverse uses a reversed buffer so the audio direction
           * cannot accidentally remain forward while the video runs backward.
           */
          source.buffer = el.reverse
            ? reverseAudioSegment(audioCtx, decoded, trimStart, trimStart + scheduledSourceDuration)
            : decoded;

          const gain = audioCtx.createGain();
          /* sample the volume curve (static + keyframes) into automation */
          const steps = Math.max(2, Math.ceil(elLen * 20));
          for (let i = 0; i <= steps; i++) {
            const u = i / steps;
            const vol = resolveElementValues(el, u * elLen).volume;
            if (i === 0) gain.gain.setValueAtTime(Math.max(0.0001, vol), elStart);
            else gain.gain.linearRampToValueAtTime(Math.max(0.0001, vol), elStart + u * elLen);
          }
          source.connect(gain).connect(destination);
          source.start(elStart, el.reverse ? 0 : trimStart, scheduledSourceDuration);
        } catch {
          /* overlay without decodable audio simply contributes silence */
        }
      }

      /* ---------- media recorder ---------- */
      const canvasStream = canvas.captureStream(settings.fps);

      /* Only require an audio track when the project actually contains
         audible audio. A deliberately silent project is still a valid export. */
      const exportAudioLanes = scaled.tracks.filter((t) => t.kind === 'audio');
      const exportSoloActive = exportAudioLanes.some((t) => t.solo);
      const hasExpectedAudio = !scaled.masterMuted && (
        scaled.clips.some((clip) =>
          clip.media_type !== 'image' &&
          !clip.muted &&
          clip.volume > 0 &&
          !!clip.src &&
          !isPlaceholder(clip.src)
        ) ||
        scaled.elements.some((el) =>
          el.kind === 'video' &&
          !el.muted &&
          !!el.src &&
          !isPlaceholder(el.src) &&
          (el.volume ?? 1) > 0
        ) ||
        scaled.audio.some((track) => {
          if (!track.src || isAudioPlaceholder(track.src) || track.volume <= 0) return false;
          const lane = exportAudioLanes.find((t) => t.id === track.track_id) || exportAudioLanes[0];
          if (lane?.muted) return false;
          if (exportSoloActive && !lane?.solo) return false;
          return true;
        })
      );

      const mixedAudioTracks = destination.stream.getAudioTracks();
      if (hasExpectedAudio && mixedAudioTracks.length === 0) {
        throw new Error('The audio mixer produced no audio track. Export stopped to prevent a silent video.');
      }

      const mixed = mixedAudioTracks.length > 0
        ? new MediaStream([
            ...canvasStream.getVideoTracks(),
            ...mixedAudioTracks,
          ])
        : canvasStream;

      const mimeCandidates = settings.format === 'mp4'
        ? [
            'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
            'video/mp4;codecs=avc1.4D401F,mp4a.40.2',
            'video/mp4',
          ]
        : [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm',
          ];
      const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';

      /*
       * The editor's product format is MP4. Do not silently produce WebM and
       * rename it .mp4: that creates a corrupt/mislabelled download.
       */
      if (settings.format === 'mp4' && !mimeType.includes('mp4')) {
        throw new Error(
          'MP4 export is not supported by this browser. Please use the latest Chrome or Edge to export MP4.'
        );
      }

      const effectiveVideoBitrate = storageSafeVideoBitrate(duration, settings.qualityBitrate);
      const bitrateWasReduced = effectiveVideoBitrate < settings.qualityBitrate;

      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(mixed, {
          ...(mimeType ? { mimeType } : {}),
          videoBitsPerSecond: effectiveVideoBitrate,
          audioBitsPerSecond: EXPORT_AUDIO_BITRATE,
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

      onProgress?.({
        phase: 'rendering',
        percent: 10,
        message: bitrateWasReduced
          ? `Rendering MP4 at ${(effectiveVideoBitrate / 1_000_000).toFixed(2)} Mbps to keep the export storage-safe…`
          : 'Rendering MP4 frames…',
      });
      recorder.start(250);

      /* Realtime export with deterministic timeline sampling. The recorder must
         run in real time, but keyframes/motion/transitions/text animation should
         be sampled on the exact output FPS grid rather than arbitrary rAF times.
         This keeps the exported edit aligned with the timeline without turning
         a 30-second export into a multi-minute sequence of decoder seeks. */
      const startedAt = performance.now();
      const frameDuration = 1 / settings.fps;
      const watchdogMs = Math.max(120_000, duration * 8_000);
      let lastFrameIndex = -1;
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
          const elapsed = (now - startedAt) / 1000;
          if (elapsed >= duration) {
            finishResolve();
            return;
          }
          const frameIndex = Math.min(
            Math.max(0, Math.floor(elapsed / frameDuration)),
            Math.max(0, Math.ceil(duration / frameDuration) - 1),
          );
          if (frameIndex !== lastFrameIndex) {
            const frameTime = Math.min(duration - 0.0001, frameIndex * frameDuration);
            try {
              await this.drawFrame(canvas, scaled, frameTime, { previewing: true, playing: true, isolatedPreview: true });
            } catch (e) {
              finishReject(e instanceof Error ? e : new Error('A frame failed to render.'));
              return;
            }
            lastFrameIndex = frameIndex;
            lastFrameAt = performance.now();
            onProgress?.({
              phase: 'rendering',
              percent: Math.min(99, 10 + Math.round((frameTime / duration) * 88)),
              message: `Rendering ${frameTime.toFixed(2)}s / ${duration.toFixed(2)}s`,
            });
          }
          requestAnimationFrame(() => void step());
        };
        void step();
      });

      recorder.stop();
      const blob = await done;
      exportMediaAudio.forEach(({ media, timer, stopTimer }) => {
        if (timer !== null) window.clearTimeout(timer);
        if (stopTimer !== null) window.clearTimeout(stopTimer);
        media.pause();
        media.removeAttribute('src');
        try { media.load(); } catch {}
      });
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
        format: 'mp4',
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
    format: 'mp4',
  };
}

