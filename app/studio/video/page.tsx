'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, ArrowRight, Bot, Check, Copy, Crop, Download, Film, FlipHorizontal, FlipVertical,
  Image as ImageIcon, Layers, Loader2, Lock, Mic, MicOff, Music, Pause, Play, Plus, Redo2, RotateCcw, RotateCw,
  Scissors, Search, SkipBack, SkipForward, SlidersHorizontal, Sparkles, Trash2, Type, Undo2,
  Upload, Users, VolumeX, Volume2, X, Save, Share2, Maximize2, Minimize2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useMobileGestures } from '@/lib/gestures/useMobileGestures';
import { useHistory, useHistoryShortcuts } from '@/lib/editor/history';
import { useEntitlements } from '@/lib/entitlements';
import { uploadFile } from '@/lib/storage/upload';
import { normalizeVideoDuration, ExportCancelledError } from '@/lib/video/renderer';
import SharePostPicker from '@/components/community/SharePostPicker';
import VideoAIStudio, { type VideoAIEditAction } from '@/components/studio/VideoAIStudio';
import {
  CANVAS_SIZES, DEFAULT_ADJUSTMENTS, DEFAULT_AUDIO_PROCESSING, DEFAULT_TRANSFORM, EFFECT_PRESETS, FILTER_PRESETS, KEYFRAMABLE_PROPERTIES, SPEED_OPTIONS,
  addTimelineTrack, clipDuration, clipIndexAtTime, coverFit, croppedAspect, emptyProject, isPlaceholder, makeVideoId, moveElementToTrack, normalizeProject,
  placeholderSrc, projectDuration, removeKeyframe, removeTimelineTrack, resolveClipAdjustments, resolveClipValues, resolveElementValues, resolveTime, sanitizeCrop, upsertClipKeyframe, upsertKeyframe,
  type AspectRatio, type AudioTrack, type CropRect, type KeyframeProperty, type TimelineElement, type VideoClip, type VideoProject,
} from '@/lib/video/project';
import {
  EXPORT_QUALITY_PRESETS, VideoRenderer, defaultExportSettings, invalidateReversedCache, fitIntoBox,
  type ExportProgress, type ExportResult, type ExportSettings,
} from '@/lib/video/renderer';

/* ============================================================
   /studio/video — professional mobile-first editing workspace.

   Layout model (all breakpoints): fixed 100dvh app shell —
   header · scrollable stage+timeline · contextual bar · tool panel
   · bottom nav. The timeline scrolls BOTH axes (lanes beyond the
   fold stay reachable), the tool panel scrolls independently, and
   the two scroll containers are isolated (overscroll-contain +
   touch-action rules) so a drag never scrolls the wrong thing.

   Direct manipulation on the canvas — Pointer Events only
   (mouse/touch/stylus share one path):
     • main video clip: drag to move · corner to scale · edge to
       stretch one axis · top handle to rotate
     • overlays: same, plus per-element crop
     • CROP MODE: real source crop for clips AND media overlays —
       moveable/resizable crop region with live preview. Crop is
       stored as fractions of the source in the project model and
       applied by the shared drawFrame(), so preview, timeline and
       the exported file all respect it (never CSS hiding).

   Speed uses video.playbackRate in preview and playbackRate on the
   decoded audio graph in export, so 0.25×–4× actually changes
   pacing and the exported duration (trim ÷ speed) matches.

   Everything operates on the VideoProject model; export renders
   that model with the SAME drawFrame() as the preview. No mockups:
   every control is wired, failures surface real messages, and
   exports can be cancelled.
   ============================================================ */

interface EditorDoc {
  title: string;
  project: VideoProject;
}

const TOOLS = ['media', 'text', 'overlays', 'audio', 'motion', 'look', 'ai', 'crop', 'export'] as const;
type Tool = (typeof TOOLS)[number];

const TOOL_LABELS: Record<Tool, string> = {
  media: 'Media',
  text: 'Text',
  overlays: 'Overlays',
  audio: 'Audio',
  motion: 'Motion',
  look: 'Effects',
  ai: 'AI Studio',
  crop: 'Crop',
  export: 'Export',
};

/** Width (px) of the fixed track-label column in the timeline. */
const LABEL_W = 64;
/** Timeline base scale before zoom. */
const BASE_PX_PER_SEC = 46;
/** Tap/slop threshold separating taps from drags. */
const TAP_SLOP = 8;
/** Screen-space touch target for transform handles. Keep the visible handle compact; the hit area is larger. */
const HANDLE_PX = 32;
/** Distance of the rotate handle above the top edge (canvas units). */
const ROTATE_HANDLE_DY = 34;

const EDITOR_ACTION_PILL = "flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-white/[0.07] px-3 text-[10px] font-semibold text-white/80 active:bg-white/[0.13] focus-visible:ring-2 focus-visible:ring-[#FFB6C1]";
function fmt(t: number): string {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const d = Math.floor((s % 1) * 10);
  return `${m}:${sec.toString().padStart(2, '0')}.${d}`;
}

const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type LookPreviewProps = {
  project: VideoProject;
  clipId: string;
  playhead: number;
  effect?: VideoClip['effect'];
  filter?: string;
};

function LookPreview({ project, clipId, playhead, effect, filter }: LookPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<VideoRenderer | null>(null);
  if (!rendererRef.current) rendererRef.current = new VideoRenderer();

  useEffect(() => {
    const render = async () => {
      const canvas = canvasRef.current;
      const renderer = rendererRef.current;
      if (!canvas || !renderer) return;
      const previewProject: VideoProject = {
        ...project,
        clips: project.clips.map((clip) =>
          clip.id === clipId
            ? { ...clip, ...(effect !== undefined ? { effect } : {}), ...(filter !== undefined ? { filter } : {}) }
            : clip
        ),
      };
      try {
        await renderer.drawFrame(canvas, previewProject, playhead, { previewing: true, playing: false });
      } catch {
        /* Media may briefly be undecodable while the user is scrubbing. */
      }
    };
    void render();
  }, [project, clipId, playhead, effect, filter]);

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/50">
      <canvas ref={canvasRef} className="block aspect-video h-auto w-full object-contain" />
    </div>
  );
}


async function detectBeatMarkers(audio: AudioTrack): Promise<number[]> {
  if (!audio.src) return [];
  const response = await fetch(audio.src, { mode: 'cors' });
  if (!response.ok) throw new Error('The audio file could not be read for beat detection.');
  const buffer = await response.arrayBuffer();
  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) throw new Error('Beat detection is not supported in this browser.');
  const ctx = new AudioContextCtor();
  try {
    const decoded = await ctx.decodeAudioData(buffer.slice(0));
    const channels = decoded.numberOfChannels;
    const sampleRate = decoded.sampleRate;
    const start = Math.max(0, audio.trimStart || 0);
    const end = Math.min(decoded.duration, audio.trimEnd || decoded.duration);
    const from = Math.floor(start * sampleRate);
    const to = Math.max(from + 1, Math.floor(end * sampleRate));
    const step = 1024;
    const hop = 512;
    const energy: { t: number; v: number }[] = [];
    for (let i = from; i < to; i += hop) {
      let sum = 0;
      let count = 0;
      for (let j = 0; j < step && i + j < to; j += 4) {
        let sample = 0;
        for (let c = 0; c < channels; c++) sample += decoded.getChannelData(c)[i + j] || 0;
        sample /= channels;
        sum += sample * sample;
        count++;
      }
      energy.push({ t: i / sampleRate, v: Math.sqrt(sum / Math.max(1, count)) });
    }
    const values = energy.map((x) => x.v);
    const sorted = [...values].sort((a, b) => a - b);
    const floor = sorted[Math.floor(sorted.length * 0.45)] || 0;
    const ceiling = sorted[Math.floor(sorted.length * 0.9)] || floor;
    const threshold = Math.max(floor * 1.35, ceiling * 0.52, 0.015);
    const markers: number[] = [];
    let last = -Infinity;
    for (let i = 2; i < energy.length - 2; i++) {
      const current = energy[i];
      if (current.v < threshold) continue;
      if (current.v < energy[i - 1].v || current.v < energy[i + 1].v) continue;
      if (current.v < energy[i - 2].v || current.v < energy[i + 2].v) continue;
      const projectTime = audio.start + (current.t - start);
      if (projectTime - last >= 0.22) {
        markers.push(Number(projectTime.toFixed(3)));
        last = projectTime;
      }
      if (markers.length >= 500) break;
    }
    return markers;
  } finally {
    void ctx.close();
  }
}


/* ------------------------------------------------------------------ */
/* Geometry (shared with the renderer's clipDrawRect math)             */

/** On-canvas rectangle of a main clip's rendered video box. */
function clipBoxRect(clip: VideoClip, canvasW: number, canvasH: number) {
  const srcAspect =
    clip.source_width && clip.source_height
      ? clip.source_width / clip.source_height
      : canvasW / Math.max(1, canvasH);
  const effAspect = croppedAspect(srcAspect, clip.transform.crop);
  const cover = coverFit(canvasW, canvasH, effAspect);
  const w = cover.w * clip.transform.scale * clip.transform.scale_x;
  const h = cover.h * clip.transform.scale * clip.transform.scale_y;
  return {
    cx: canvasW / 2 + clip.transform.offset_x,
    cy: canvasH / 2 + clip.transform.offset_y,
    w,
    h,
  };
}

type Gesture =
  | 'move'
  | 'rotate'
  | 'resize-n' | 'resize-s' | 'resize-e' | 'resize-w'
  | 'resize-ne' | 'resize-nw' | 'resize-se' | 'resize-sw';

const CORNER_SIGNS: Record<string, { sx: -1 | 1; sy: -1 | 1 }> = {
  'resize-nw': { sx: -1, sy: -1 },
  'resize-ne': { sx: 1, sy: -1 },
  'resize-sw': { sx: -1, sy: 1 },
  'resize-se': { sx: 1, sy: 1 },
};

function isCornerGesture(g: Gesture): g is 'resize-ne' | 'resize-nw' | 'resize-se' | 'resize-sw' {
  return g === 'resize-ne' || g === 'resize-nw' || g === 'resize-se' || g === 'resize-sw';
}
function isEdgeGesture(g: Gesture): g is 'resize-n' | 'resize-s' | 'resize-e' | 'resize-w' {
  return g === 'resize-n' || g === 'resize-s' || g === 'resize-e' || g === 'resize-w';
}

/* ------------------------------------------------------------------ */

function VideoEditor() {
  const router = useRouter();
  const search = useSearchParams();
  const templateId = search.get('template');
  const projectId = search.get('project');
  const soundParam = search.get('sound');

  const history = useHistory<EditorDoc>({ title: 'Untitled project', project: emptyProject('9:16') });
  const { state: doc, setState: setDoc } = history;
  const project = doc.project;

  const [meId, setMeId] = useState<string | null>(null);
  const { has, loading: entLoading } = useEntitlements(meId);

  /* ---------- refs & playback ---------- */
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const audioReplaceInputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<VideoRenderer>(new VideoRenderer());
  const docRef = useRef(doc);
  docRef.current = doc;

  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playheadRef = useRef(0);
  playheadRef.current = playhead;
  const drawingRef = useRef(false);
  const pendingRef = useRef<number | null>(null);
  const lastSrcErrRef = useRef<string | null>(null);

  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [rippleEnabled, setRippleEnabled] = useState(false);
  const [tool, setTool] = useState<Tool>('media');
  const [toolDrawerOpen, setToolDrawerOpen] = useState(false);
  const [lookPreviewEffect, setLookPreviewEffect] = useState<VideoClip['effect'] | null>(null);
  const [lookPreviewFilter, setLookPreviewFilter] = useState<string | null>(null);
  const [clipSoundMenuOpen, setClipSoundMenuOpen] = useState(false);
  const [clipSpeedMenuOpen, setClipSpeedMenuOpen] = useState(false);
  const [frameMode, setFrameMode] = useState<'motion' | 'layer' | 'ai-drawing' | 'ai-portrait'>('motion');
  const [beatBusy, setBeatBusy] = useState(false);
  const openTool = useCallback((next: Tool) => {
    setTool(next);
    setToolDrawerOpen(true);
  }, []);
  const [stockQuery, setStockQuery] = useState('nature');
  const [stockProvider, setStockProvider] = useState<'all' | 'pexels' | 'pixabay'>('all');
  const [stockOrientation, setStockOrientation] = useState<'all' | 'landscape' | 'portrait' | 'square'>('all');
  const [stockVideos, setStockVideos] = useState<{ id: string; url: string; thumbnail: string; width: number; height: number; duration: number; sourceUrl: string; photographer: string; provider: 'pexels' | 'pixabay' }[]>([]);
  const [stockBusy, setStockBusy] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [effectSearch, setEffectSearch] = useState('');
  const [effectCategory, setEffectCategory] = useState<'Trending' | 'Motion' | 'Retro' | 'Cinematic' | 'All'>('Trending');

  /** Active crop session: which entity is being cropped + its starting crop
      (so Cancel can restore). null = normal editing. */
  const [cropMode, setCropMode] = useState<
    | { type: 'clip'; id: string; initial: CropRect | null }
    | { type: 'element'; id: string; initial: CropRect | null }
    | null
  >(null);

  /* FULLSCREEN PREVIEW — distraction-free, 100dvh playback of the timeline
     via a second canvas mirrored from the same drawFrame() the export uses.
     Tap/click or Space toggles play; Esc or the button exits. */
  const [fullscreen, setFullscreen] = useState(false);
  const fsCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const togglePlayRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!fullscreen) return;
    let cancelled = false;
    const mirror = async () => {
      const fsCanvas = fsCanvasRef.current;
      if (!fsCanvas || cancelled) return;
      try {
        await rendererRef.current.drawFrame(fsCanvas, docRef.current.project, playheadRef.current, {
          previewing: true,
          playing,
        });
      } catch {
        /* transient mid-seek draw errors are non-fatal here */
      }
    };
    void mirror();
    const t = setInterval(() => void mirror(), 200);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [fullscreen, playing, playhead, project]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setFullscreen(false);
      }
      if (e.key === ' ') {
        e.preventDefault();
        togglePlayRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const duration = useMemo(() => projectDuration(project), [project]);
  const selectedClip = project.clips.find((c) => c.id === selectedClipId) || null;
  const selectedElement = project.elements.find((e) => e.id === selectedElementId) || null;
  const selectedAudio = project.audio.find((a) => a.id === selectedAudioId) || null;

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  /* ---------- auth ---------- */
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.replace('/auth/sign-in');
      else setMeId(data.user.id);
    });
  }, [router]);

  /** Seek helper that keeps ref + state in lockstep (used by drags & keys). */
  const seekTo = useCallback((t: number) => {
    const clamped = Math.max(0, t);
    playheadRef.current = clamped;
    setPlayhead(clamped);
  }, []);

  /* ---------- preview drawing (same renderer as export) ----------
     Latest-wins: if a draw is in flight and the playhead/project changes
     again, we queue the newest request instead of dropping it — every edit
     ends with a frame that reflects the FINAL state. */
  /* ---------- timeline audio preview ----------
     The canvas renderer intentionally draws video into a canvas, so project
     audio tracks cannot be heard from the canvas itself. Keep a small set of
     real HTMLAudioElements synchronized with the project clock for editing
     playback. This is preview-only; export mixing remains in renderer.ts. */
  const previewAudioRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const previewAudioUnlockedRef = useRef(false);

  const syncPreviewAudio = useCallback(async (time: number, shouldPlay: boolean) => {
    const p = docRef.current.project;
    const lanes = p.tracks.filter((t) => t.kind === 'audio');
    const soloActive = lanes.some((t) => t.solo);
    const activeIds = new Set<string>();

    /* Main-track videos also carry their original audio. The canvas renderer
       intentionally mutes its <video> elements because they are painted into
       a canvas, so the editor needs real audio elements for the source sound.
       Main clips are sequential, therefore their project start is accumulated
       from clipDuration(). */
    let clipStart = 0;
    for (const clip of p.clips) {
      const clipId = `clip-audio:${clip.id}`;
      const clipProjectDuration = Math.max(0.05, clipDuration(clip));
      const inRange = !p.masterMuted &&
        !clip.muted &&
        clip.volume > 0 &&
        !!clip.src &&
        !isPlaceholder(clip.src) &&
        time >= clipStart &&
        time < clipStart + clipProjectDuration;

      if (inRange) {
        activeIds.add(clipId);
        let audio = previewAudioRef.current.get(clipId);
        if (!audio || audio.src !== clip.src) {
          audio?.pause();
          audio = new Audio(clip.src);
          audio.preload = 'auto';
          audio.crossOrigin = 'anonymous';
          previewAudioRef.current.set(clipId, audio);
        }

        const local = Math.max(0, time - clipStart);
        const target = Math.max(
          0,
          Math.min(
            Math.max(0, clip.trimEnd - 0.01),
            clip.trimStart + local * Math.max(0.0625, clip.speed || 1)
          )
        );
        audio.playbackRate = Math.max(0.0625, Math.min(16, clip.speed || 1));
        audio.volume = Math.max(0, Math.min(1, clip.volume));
        if (Math.abs(audio.currentTime - target) > 0.18 || audio.paused) {
          try { audio.currentTime = target; } catch { /* wait for metadata */ }
        }
        if (shouldPlay && audio.paused) {
          try {
            await audio.play();
            previewAudioUnlockedRef.current = true;
          } catch {
            /* The Play button retries on the next synchronization pass. */
          }
        } else if (!shouldPlay) {
          audio.pause();
        }
      }

      clipStart += clipProjectDuration;
    }

    /* Separate music/voiceover lanes continue to play simultaneously. */
    for (const track of p.audio) {
      const lane = lanes.find((t) => t.id === track.track_id) || lanes[0];
      if (lane?.muted || (soloActive && !lane?.solo) || track.volume <= 0 || !track.src) continue;
      const key = `audio:${track.id}`;
      activeIds.add(key);

      let audio = previewAudioRef.current.get(key);
      if (!audio || audio.src !== track.src) {
        audio?.pause();
        audio = new Audio(track.src);
        audio.preload = 'auto';
        audio.crossOrigin = 'anonymous';
        previewAudioRef.current.set(key, audio);
      }

      const local = time - track.start;
      const duration = Math.max(0.05, track.trimEnd - track.trimStart);
      const inRange = local >= 0 && local < duration;
      const target = Math.max(0, Math.min(track.trimEnd - 0.01, track.trimStart + Math.max(0, local)));
      const fadeIn = track.fadeIn > 0 ? Math.min(1, local / track.fadeIn) : 1;
      const fadeOut = track.fadeOut > 0 ? Math.min(1, (duration - local) / track.fadeOut) : 1;
      const volume = Math.max(0, Math.min(1, track.volume * Math.min(fadeIn, fadeOut)));
      audio.volume = volume;

      if (!inRange || !shouldPlay) {
        audio.pause();
        if (!inRange) {
          try { audio.currentTime = target; } catch { /* media may not be ready */ }
        }
        continue;
      }

      if (Math.abs(audio.currentTime - target) > 0.18 || audio.paused) {
        try { audio.currentTime = target; } catch { /* wait for metadata */ }
      }
      if (audio.paused) {
        try {
          await audio.play();
          previewAudioUnlockedRef.current = true;
        } catch {
          /* Browser autoplay policy: the next user play click retries. */
        }
      }
    }

    previewAudioRef.current.forEach((audio, id) => {
      if (!activeIds.has(id)) audio.pause();
    });
  }, []);

  useEffect(() => () => {
    previewAudioRef.current.forEach((audio) => {
      audio.pause();
      audio.src = '';
    });
    previewAudioRef.current.clear();
  }, []);

  const drawOnce = useCallback(async (t: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (drawingRef.current) {
      pendingRef.current = t;
      return;
    }
    drawingRef.current = true;
    try {
      await rendererRef.current.drawFrame(canvas, docRef.current.project, t, { previewing: true, playing });
      await syncPreviewAudio(t, playing);
      /* surface undecodable/unreachable sources as a toast instead of a
         silently black canvas (fires at most once per source change) */
      const err = rendererRef.current.lastSourceError;
      if (err && err !== lastSrcErrRef.current) {
        lastSrcErrRef.current = err;
        notify('A clip in the timeline cannot be played in this browser — see the preview for which one.');
      } else if (!err) {
        lastSrcErrRef.current = null;
      }
    } finally {
      drawingRef.current = false;
    }
    if (pendingRef.current != null) {
      const next = pendingRef.current;
      pendingRef.current = null;
      void drawOnce(next);
    }
  }, [playing, notify, syncPreviewAudio]);

  useEffect(() => {
    if (!playing) {
      void drawOnce(playhead);
      void syncPreviewAudio(playhead, false);
    }
  }, [project, playhead, playing, drawOnce]);

  /* Play/pause with the universal fix: pressing play at the END of the
     timeline restarts from 0 instead of instantly stopping again. */
  const togglePlay = useCallback(() => {
    const wasPlaying = playing;
    if (!wasPlaying && playheadRef.current >= projectDuration(docRef.current.project) - 0.05) {
      playheadRef.current = 0;
      setPlayhead(0);
    }
    setPlaying((p) => !p);
  }, [playing]);
  /* latest togglePlay for the fullscreen Space handler (declared before it) */
  useEffect(() => {
    togglePlayRef.current = togglePlay;
  }, [togglePlay]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let timer = 0;
    let last = performance.now();
    let stop = false;
    const loop = async () => {
      if (stop) return;
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const total = projectDuration(docRef.current.project);
      let next = playheadRef.current + dt;
      if (next >= total) {
        next = total;
        setPlaying(false);
      }
      playheadRef.current = next;
      setPlayhead(next);
      await drawOnce(next);
      await syncPreviewAudio(next, true);
      schedule();
    };
    /* rAF is vsync-perfect but Chrome ZERO-throttles it in occluded
       tabs — playback would silently freeze. Fall back to a 30fps
       timer whenever the document is hidden. */
    const schedule = () => {
      if (stop) return;
      if (document.hidden) timer = window.setTimeout(() => void loop(), 33);
      else raf = requestAnimationFrame(loop);
    };
    schedule();
    return () => {
      stop = true;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [playing, drawOnce, syncPreviewAudio]);

  /* ---------- load template / existing project ---------- */
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    if (!templateId && !projectId) return;
    (async () => {
      if (projectId) {
        const { data, error } = await supabase
          .from('video_projects')
          .select('id, title, project, aspect_ratio')
          .eq('id', projectId)
          .maybeSingle();
        if (error || !data) {
          setLoadError('Project not found.');
          return;
        }
        history.reset(
          { title: data.title, project: normalizeProject({ ...emptyProject(data.aspect_ratio as AspectRatio), ...(data.project as object) }) },
          'Loaded project'
        );
        setSavedProjectId(data.id);
      } else if (templateId) {
        const { data, error } = await supabase
          .from('templates')
          .select('id, title, project, aspect_ratio, premium, creator_id, status')
          .eq('id', templateId)
          .maybeSingle();
        if (error || !data || data.status !== 'published') {
          setLoadError('Template not available.');
          return;
        }
        if (data.premium && !has('templates.premium') && !has(`template.use:${data.id}` as never)) {
          setLoadError('This is a premium template — Pro unlocks it (Phase 2 payments).');
          return;
        }
        const tplProject = normalizeProject({ ...emptyProject(data.aspect_ratio as AspectRatio), ...(data.project as object) });
        history.reset({ title: `${data.title} (from template)`, project: tplProject }, 'From template');
        // analytics (privacy-light): event row + counter via secure RPC
        void supabase.from('template_events').insert({ template_id: data.id, event: 'use' });
        void supabase.rpc('bump_template_use', { p_template: data.id });
        notify('Template loaded — replace the placeholders with your media.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, projectId]);

  /* ---------- deep-linked sound from the library ---------- */
  useEffect(() => {
    if (!soundParam || !meId) return;
    (async () => {
      const { data, error } = await supabase
        .from('sounds')
        .select('id, title, url, duration_seconds, premium')
        .eq('id', soundParam)
        .maybeSingle();
      if (error || !data) {
        notify('That sound is not available (it may be premium).');
        return;
      }
      const track: AudioTrack = {
        id: makeVideoId('aud'), name: data.title, src: data.url, start: 0,
        trimStart: 0, trimEnd: Math.max(1, Math.min(data.duration_seconds || 15, 15)),
        volume: 0.8, fadeIn: 0.5, fadeOut: 1, kind: 'music',
      };
      updateProject((p) => ({ ...p, audio: [...p.audio, track] }), 'Add sound from library');
      notify(`“${data.title}” added to your timeline.`);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soundParam, meId]);

  /* ---------- autosave ---------- */
  const [savedProjectId, setSavedProjectId] = useState<string | null>(projectId);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const saveTimer = useRef<number | null>(null);
  /* Set while an INSERT is in flight so a second concurrent saveNow() can't
     create a duplicate project row (autosave racing a manual save / 2 tabs). */
  const savingRef = useRef(false);

  /** Persist now. Returns false (and tells the user why) on failure —
      callers that MUST have a save (export) check the result. */
  const saveNow = useCallback(async (): Promise<boolean> => {
    if (!meId) {
      notify('Sign in to save your project.');
      return false;
    }
    if (!history.dirty && savedProjectId) return true;
    setSaving(true);
    const body = {
      user_id: meId,
      title: docRef.current.title || 'Untitled project',
      project: docRef.current.project,
      aspect_ratio: docRef.current.project.aspect,
      duration_seconds: projectDuration(docRef.current.project),
    };
    try {
      if (savedProjectId) {
        const { error } = await supabase.from('video_projects').update(body).eq('id', savedProjectId);
        if (error) throw new Error(error.message);
      } else {
        /* Guard against duplicate rows: autosave and a manual save (or two
           tabs) can race past the savedProjectId check. Re-read the id inside
           the save path, then claim the insert with a coordinated flag. */
        if (savingRef.current) return true;
        savingRef.current = true;
        try {
          const { data, error } = await supabase.from('video_projects').insert(body).select('id').single();
          if (error) throw new Error(error.message);
          if (data) {
            setSavedProjectId(data.id);
            window.history.replaceState(null, '', `/studio/video?project=${data.id}`);
          }
        } finally {
          savingRef.current = false;
        }
      }
      history.markClean();
      setLastSavedAt(new Date());
      return true;
    } catch (e) {
      notify(`Unable to save project — ${e instanceof Error ? e.message : 'unknown error'}. Your edits are still in the editor.`);
      return false;
    } finally {
      setSaving(false);
    }
  }, [meId, savedProjectId, history, notify]);

  useEffect(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    if (!meId || !history.dirty) return;
    saveTimer.current = window.setTimeout(() => void saveNow(), 1600);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [doc, meId, history.dirty, saveNow]);

  /* Warn before leaving with unsaved work or an export in flight. */
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (history.dirty || exportingRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [history.dirty]);

  /* ---------- undo/redo + editor shortcuts ---------- */
  useHistoryShortcuts({ undo: history.undo, redo: history.redo, canUndo: history.canUndo, canRedo: history.canRedo });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) {
        /* single-key shortcuts only when not typing */
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
        if (e.key === 'Escape') {
          if (cropMode) {
            setCropMode(null);
          } else {
            setSelectedClipId(null);
            setSelectedElementId(null);
            setSelectedAudioId(null);
          }
          return;
        }
        if (e.code === 'Space') {
          e.preventDefault();
          togglePlay();
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          seekTo(playheadRef.current - 1 / 30);
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          seekTo(playheadRef.current + 1 / 30);
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          if (selectedElementId) {
            e.preventDefault();
            updateProject((p) => ({ ...p, elements: p.elements.filter((el) => el.id !== selectedElementId) }), 'Delete overlay');
            setSelectedElementId(null);
          } else if (selectedClipId) {
            e.preventDefault();
            updateProject((p) => ({ ...p, clips: p.clips.filter((c) => c.id !== selectedClipId) }), 'Delete clip');
            setSelectedClipId(null);
          }
        }
        if (e.key === 's' || e.key === 'S') {
          if (selectedClip) {
            e.preventDefault();
            splitAtPlayhead();
          }
        }
        return;
      }
      if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveNow();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedElementId, selectedClipId, selectedClip, saveNow, seekTo, cropMode]);

  /* ---------- project mutations (through history) ---------- */
  const updateProject = useCallback(
    (fn: (p: VideoProject) => VideoProject, label: string, coalesceKey?: string) => {
      setDoc(
        (prev) => ({ ...prev, project: fn(prev.project) }),
        label,
        coalesceKey
      );
    },
    [setDoc]
  );

  const updateClip = useCallback(
    (clipId: string, patch: Partial<VideoClip>, label: string, coalesceKey?: string) => {
      updateProject(
        (p) => ({ ...p, clips: p.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)) }),
        label,
        coalesceKey
      );
      /* Editing a REVERSED clip invalidates its cached frames: trim/speed
         changes alter the sampled range, filter/adjustment/flip changes alter
         what each frame should look like (the cache stores painted-looking
         source pixels only). Cache misses fall back to the seek path, so
         this is always safe. */
      const target = docRef.current?.project.clips.find((c) => c.id === clipId);
      if (target?.reverse) invalidateReversedCache(target.src);
    },
    [updateProject]
  );

  /* ---------- import clips ---------- */
  const [importing, setImporting] = useState<{ name: string; percent: number } | null>(null);
  const [fileDragActive, setFileDragActive] = useState(false);

  const importFiles = useCallback(
    async (files: FileList | File[], replaceClipId?: string) => {
      if (!meId) return;
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('video/') && !file.type.startsWith('image/')) {
          notify(`"${file.name}" is not a video or image.`);
          continue;
        }

        setImporting({ name: file.name, percent: 10 });
        try {
          // probe dimensions/duration before committing
          const probeUrl = URL.createObjectURL(file);
          const meta = await new Promise<{ duration: number; w: number; h: number }>((res, rej) => {
            const el = document.createElement('video');
            el.preload = 'metadata';
            el.onloadedmetadata = async () => {
              /* Infinity duration (webm/screen recordings, some phone mp4s)
                 must be resolved BEFORE use, or the clip gets a nonsense trim
                 range → black preview and broken exports. */
              const dur = await normalizeVideoDuration(el);
              res({ duration: dur || 5, w: el.videoWidth, h: el.videoHeight });
            };
            el.onerror = () => rej(new Error(`Unable to load video "${file.name}" — the file may be corrupt or in an unsupported format.`));
            el.src = probeUrl;
          });
          URL.revokeObjectURL(probeUrl);

          /* DECODE PROBE — metadata can load for codecs the browser cannot
             decode (HEVC/H.265 phone videos are the classic case). Those files
             used to import fine, then show a black preview and export black.
             Asking for an actual frame here catches it at import time with a
             real explanation instead of silent failure later. */
          if (!file.type.startsWith('image/')) {
            const probeVideo = document.createElement('video');
            probeVideo.preload = 'auto';
            probeVideo.muted = true;
            probeVideo.src = URL.createObjectURL(file);
            const decodable = await new Promise<boolean>((res) => {
              const cleanup = (ok: boolean) => {
                URL.revokeObjectURL(probeVideo.src);
                res(ok);
              };
              probeVideo.onloadeddata = () => {
                probeVideo.currentTime = Math.min(0.1, (probeVideo.duration || 1) / 2);
              };
              probeVideo.onseeked = () => cleanup(true);
              probeVideo.onerror = () => cleanup(false);
              window.setTimeout(() => cleanup(false), 6000);
            });
            if (!decodable) {
              notify(
                `"${file.name}" uses a codec this browser cannot decode (common with HEVC/iPhone recordings). Re-export it as H.264 MP4 and try again.`
              );
              continue;
            }
          }

          setImporting({ name: file.name, percent: 35 });
          const up = await uploadFile(file, 'studio-media', meId);

          /* Optional Cloudinary mirror/optimization. Supabase remains the
             source of truth and the upload above always succeeds even when
             Cloudinary is not configured or its free quota is unavailable. */
          let mediaUrl = up.url;
          try {
            const cloudinaryResponse = await fetch('/api/video/cloudinary', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                url: mediaUrl,
                mediaType: file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : 'video',
                mode: project.aspect === '9:16' ? 'vertical' : project.aspect === '1:1' ? 'square' : 'optimize',
              }),
            });
            const cloudinary = await cloudinaryResponse.json().catch(() => ({}));
            if (cloudinaryResponse.ok && typeof cloudinary.url === 'string' && cloudinary.url) {
              mediaUrl = cloudinary.url;
            }
          } catch {
            /* Cloudinary is an optional optimization layer; keep Supabase URL. */
          }

          setImporting({ name: file.name, percent: 90 });

          const isImage = file.type.startsWith('image/');
          setImporting(null);

          if (isImage) {
            const img = new Image();
            img.src = mediaUrl;
            await img.decode().catch(() => undefined);
            const iw = img.naturalWidth || 320;
            const ih = img.naturalHeight || 240;
            /* fit inside 60% of the canvas, keeping the image's real aspect */
            const s = Math.min(1, (project.canvas.width * 0.6) / iw, (project.canvas.height * 0.6) / ih);
            const w = Math.round(iw * s);
            const h = Math.round(ih * s);
            const el: TimelineElement = {
              id: makeVideoId('el'), kind: 'image', content: file.name, src: mediaUrl, track_id: project.tracks[0]?.id,
              start: playheadRef.current, end: playheadRef.current + 4,
              x: Math.round((project.canvas.width - w) / 2), y: Math.round((project.canvas.height - h) / 2),
              width: w, height: h, rotation: 0, opacity: 1, z: project.elements.length + 1,
              animation: 'fade',
            };
            updateProject((p) => ({ ...p, elements: [...p.elements, el] }), 'Add image');
          } else {
            const replacement = replaceClipId
              ? docRef.current.project.clips.find((c) => c.id === replaceClipId)
              : null;

            if (replacement) {
              updateProject((p) => ({
                ...p,
                clips: p.clips.map((c) => c.id === replacement.id
                  ? {
                      ...c,
                      src: mediaUrl,
                      name: file.name,
                      sourceDuration: meta.duration,
                      trimStart: 0,
                      trimEnd: meta.duration,
                      source_width: meta.w || undefined,
                      source_height: meta.h || undefined,
                    }
                  : c),
              }), 'Replace clip');
              setSelectedClipId(replacement.id);
              notify('Clip replaced — your edit position and timeline slot were preserved.');
            } else {
              const clip: VideoClip = {
                id: makeVideoId('clip'), src: mediaUrl, name: file.name,
                sourceDuration: meta.duration, trimStart: 0,
                trimEnd: meta.duration, speed: 1, volume: 1, muted: false,
                source_width: meta.w || undefined, source_height: meta.h || undefined,
                transform: { ...DEFAULT_TRANSFORM }, adjustments: { ...DEFAULT_ADJUSTMENTS },
                filter: 'none', effect: 'none', reverse: false, audioProcessing: { ...DEFAULT_AUDIO_PROCESSING }, transitionIn: { type: 'none', duration: 0.5 },
              };
              updateProject((p) => ({ ...p, clips: [...p.clips, clip] }), 'Add clip');
              setSelectedClipId(clip.id);
            }
          }
        } catch (e) {
          setImporting(null);
          notify(e instanceof Error ? e.message : 'Media upload failed.');
        }
      }
    },
    [meId, notify, playheadRef, project.canvas.width, project.canvas.height, project.elements.length, project.tracks, updateProject]
  );

  /* ---------- stock footage + GIF libraries ---------- */
  const searchStockVideos = useCallback(async (reset = true, providerOverride?: 'all' | 'pexels' | 'pixabay') => {
    setStockBusy(true); setStockError(null);
    try {
      const page = reset ? 1 : Math.max(1, Number((window as any).__enotesStockPage || 1) + 1);
      const params = new URLSearchParams({
        query: stockQuery.trim() || 'nature',
        page: String(page),
        provider: providerOverride || stockProvider,
      });
      if (stockOrientation !== 'all') params.set('orientation', stockOrientation);
      const response = await fetch('/api/studio/stock-videos?' + params.toString());
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || 'Stock video search failed.');
      setStockVideos((prev) => reset ? (data.videos || []) : [...prev, ...(data.videos || [])]);
      (window as any).__enotesStockPage = page;
    } catch (error) { setStockError(error instanceof Error ? error.message : 'Stock video search failed.'); }
    finally { setStockBusy(false); }
  }, [stockOrientation, stockProvider, stockQuery]);

  const addStockVideo = useCallback((item: { url: string; width: number; height: number; duration: number; photographer: string; provider: 'pexels' | 'pixabay' }) => {
    const sourceDuration = Math.max(0.2, Number(item.duration) || 5);
    const clip: VideoClip = {
      id: makeVideoId('clip'), src: item.url, name: (item.provider === 'pixabay' ? 'Pixabay · ' : 'Pexels · ') + item.photographer,
      sourceDuration, trimStart: 0, trimEnd: Math.min(sourceDuration, 30), speed: 1, volume: 1, muted: false,
      source_width: item.width || undefined, source_height: item.height || undefined,
      transform: { ...DEFAULT_TRANSFORM }, adjustments: { ...DEFAULT_ADJUSTMENTS }, filter: 'none', effect: 'none', reverse: false,
      audioProcessing: { ...DEFAULT_AUDIO_PROCESSING }, transitionIn: { type: 'none', duration: 0.5 },
    };
    updateProject((p) => ({ ...p, clips: [...p.clips, clip] }), 'Add stock footage');
    setSelectedClipId(clip.id); setSelectedElementId(null); notify('Stock footage added to the main timeline.');
  }, [notify, updateProject]);

  const startPracticeProject = useCallback(async () => {
    setStockBusy(true);
    setStockError(null);
    try {
      const queries = ['city night', 'person walking', 'nature landscape', 'close up hands', 'street movement'];
      const results = await Promise.all(
        queries.map(async (query) => {
          // Pexels/Pixabay rank popular results, so page=1 + [0] returned
          // the same footage every time. Rotate the page and pick a random
          // result to make each new practice project genuinely fresh.
          const pageNumber = 1 + Math.floor(Math.random() * 5);
          const params = new URLSearchParams({
            query,
            page: String(pageNumber),
            provider: 'all',
          });
          const response = await fetch('/api/studio/stock-videos?' + params.toString(), { cache: 'no-store' });
          const data = await response.json();
          if (!response.ok || data.error) throw new Error(data.error || 'Practice footage search failed.');
          const videos = Array.isArray(data.videos) ? data.videos.filter((v: any) => v && v.url) : [];
          if (!videos.length) return null;
          return videos[Math.floor(Math.random() * videos.length)];
        })
      );

      const uniqueResults = results
        .filter(Boolean)
        .filter((item: any, index: number, list: any[]) =>
          list.findIndex((candidate: any) => candidate?.url === item?.url) === index
        );

      const clips = uniqueResults.map((item: any) => {
        const sourceDuration = Math.max(0.2, Number(item.duration) || 5);
        return {
          id: makeVideoId('clip'), src: String(item.url), name: 'Practice · ' + (item.photographer || 'Pexels'),
          sourceDuration, trimStart: 0, trimEnd: Math.min(sourceDuration, 6), speed: 1, volume: 1, muted: false,
          source_width: Number(item.width) || undefined, source_height: Number(item.height) || undefined,
          transform: { ...DEFAULT_TRANSFORM }, adjustments: { ...DEFAULT_ADJUSTMENTS }, filter: 'none', effect: 'none', reverse: false,
          audioProcessing: { ...DEFAULT_AUDIO_PROCESSING }, transitionIn: { type: 'none', duration: 0.5 },
        } as VideoClip;
      });
      if (clips.length < 3) throw new Error('Not enough stock footage was returned. Try again.');
      setDoc((prev) => ({
        ...prev,
        title: 'Cinematic Practice — Untitled',
        project: normalizeProject({ ...emptyProject(prev.project.aspect), clips }),
      }), 'Create practice project');
      setSelectedClipId(clips[0].id);
      setSelectedElementId(null);
      notify('Practice project created. The footage is raw — build the sequence yourself.');
    } catch (error) {
      setStockError(error instanceof Error ? error.message : 'Could not create practice project.');
    } finally {
      setStockBusy(false);
    }
  }, [notify, setDoc]);

  useEffect(() => {
    if (tool === 'media' && stockVideos.length === 0) void searchStockVideos(true);
    // Professional editor: no GIF/emoji/sticker browser in the video workflow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  /* ---------- clip ops ---------- */
  const splitAtPlayhead = useCallback(() => {
    const p = docRef.current.project;
    const t = playheadRef.current;
    const resolved = resolveTime(p, t);
    if (!resolved) return notify('Nothing to split — add a clip first.');
    let acc = 0;
    let index = -1;
    for (let i = 0; i < p.clips.length; i++) {
      const d = clipDuration(p.clips[i]);
      if (t < acc + d) { index = i; break; }
      acc += d;
    }
    if (index < 0) return;
    const clip = p.clips[index];
    const local = t - acc;
    const splitSource = clip.trimStart + local * clip.speed;
    if (splitSource - clip.trimStart < 0.15 || clip.trimEnd - splitSource < 0.15) {
      return notify('Move the playhead further inside the clip to split.');
    }
    const a: VideoClip = { ...clip, trimEnd: splitSource };
    const b: VideoClip = { ...clip, id: makeVideoId('clip'), trimStart: splitSource, transitionIn: { type: 'none', duration: 0.5 } };
    updateProject((pp) => ({ ...pp, clips: pp.clips.flatMap((c) => (c.id === clip.id ? [a, b] : [c])) }), 'Split clip');
    setSelectedClipId(b.id);
  }, [notify, updateProject]);

  const deleteClip = (id: string) => {
    if (cropMode?.type === 'clip' && cropMode.id === id) setCropMode(null);
    updateProject((p) => ({ ...p, clips: p.clips.filter((c) => c.id !== id) }), 'Delete clip');
    setSelectedClipId(null);
  };

  const duplicateClip = (clip: VideoClip) => {
    const copy = { ...clip, id: makeVideoId('clip'), name: `${clip.name} copy` };
    updateProject((p) => {
      const i = p.clips.findIndex((c) => c.id === clip.id);
      const clips = [...p.clips];
      clips.splice(i + 1, 0, copy);
      return { ...p, clips };
    }, 'Duplicate clip');
    setSelectedClipId(copy.id);
  };

  /* Narration timing guard — the placement window of an AI narration
     must never sit on top of an on-screen caption cue (speech competes
     with reading) and should land inside a music bed rather than across
     a music drop. The placement pass in applyAIActions uses these two
     helpers: the projector decides where narration can play, the
     shifter nudges a start to the nearest clear slot (or returns null
     when the whole timeline is spoken-through — then placement
     keeps the requested start and ducks the music instead). */
  const planCeilingRef = useRef(0);
  const narrationClearWindow = useCallback((p: VideoProject, start: number, span: number): { start: number; end: number } => {
    const captionWalls = p.elements
      .filter((el) => el.kind === 'text')
      .map((el) => ({ s: el.start, e: el.end }))
      .sort((a, b) => a.s - b.s);
    const musicWalls = p.audio
      .filter((a) => a.kind === 'music')
      .map((a) => ({
        s: Number(a.start) || 0,
        e: (Number(a.start) || 0) + Math.max(0.1, (Number(a.trimEnd) || 0) - (Number(a.trimStart) || 0)),
      }))
      .sort((a, b) => a.s - b.s);
    const fits = (from: number, until: number) =>
      !captionWalls.some((w) => from < w.e - 0.05 && until > w.s + 0.05) &&
      !musicWalls.some((w) => from < w.e - 0.05 && until > w.s + 0.05);
    if (fits(start, start + span)) return { start, end: start + span };
    /* candidate edges: 0, every caption end/start, every music end/start,
       plus the narration's own requested start as a lower bound. */
    const edges = new Set<number>([0]);
    for (const w of [...captionWalls, ...musicWalls]) { edges.add(w.s); edges.add(w.e); }
    const candidates = Array.from(edges).sort((a, b) => a - b);
    for (const candidate of candidates) {
      const from = Math.max(0, candidate);
      if (from + span <= Math.max(candidate, planCeilingRef.current) && fits(from, from + span)) {
        return { start: from, end: from + span };
      }
    }
    return { start: -1, end: -1 };
  }, []);

  const shiftNarrationClear = useCallback((p: VideoProject, start: number, span: number): { start: number; end: number } => {
    const window2 = narrationClearWindow(p, start, span);
    if (window2.start >= 0) return window2;
    return { start, end: start + span };
  }, [narrationClearWindow]);

  const applyAIActions = useCallback(async (actions: VideoAIEditAction[]) => {
    if (!actions.length) return { applied: 0, failed: [] as string[] };

    /* 'all' targets mean one shared decision applied to every clip
       (e.g. a unified color grade). Expanding them here keeps the AI's
       budget free for storytelling actions instead of N-1 repeats. */
    const expanded: VideoAIEditAction[] = [];
    for (const action of actions.slice(0, 24)) {
      if (action.clipId === 'all' && action.type !== 'set_keyframe') {
        for (const clip of docRef.current.project.clips) {
          expanded.push({ ...action, clipId: clip.id });
        }
      } else {
        expanded.push(action);
      }
    }

    const requestedActions = expanded.slice(0, 64);
    const clipTargetActions = new Set<VideoAIEditAction['type']>([
      'set_clip_speed', 'set_clip_volume', 'set_clip_mute', 'set_clip_filter',
      'set_clip_effect', 'set_clip_transition', 'trim_clip', 'transform_clip',
      'set_clip_adjustments', 'fit_clip', 'delete_clip', 'duplicate_clip',
      'set_keyframe',
    ]);
    const elementTargetActions = new Set<VideoAIEditAction['type']>([
      'transform_element', 'set_element_opacity', 'delete_element', 'retime_element',
    ]);
    const actionFailures: string[] = [];
    const applicableActions = requestedActions.filter((action) => {
      if (clipTargetActions.has(action.type) && action.type !== 'set_keyframe' && !action.clipId) {
        actionFailures.push(`${action.type}: no target clip`);
        return false;
      }
      if (elementTargetActions.has(action.type) && !action.elementId) {
        actionFailures.push(`${action.type}: no target overlay`);
        return false;
      }
      if (action.clipId && !docRef.current.project.clips.some((clip) => clip.id === action.clipId) && action.type !== 'split_clip') {
        actionFailures.push(`${action.type}: target clip no longer exists`);
        return false;
      }
      if (action.elementId && !docRef.current.project.elements.some((element) => element.id === action.elementId)) {
        actionFailures.push(`${action.type}: target overlay no longer exists`);
        return false;
      }
      return true;
    });
    const safeActions = applicableActions.slice(0, 64);

    /* Plan horizon — the furthest point this batch of actions intends to
       reach. On an (near-)empty timeline projectDuration() is ~0, and
       clamping text ends to it collapsed every AI text cue into a 0.25s
       sliver at t=0 that never shows on screen. Structural placement may
       extend the timeline, so the clamp ceiling is the plan's own horizon. */
    let planHorizon = 0;
    for (const action of safeActions) {
      const obj = action.object || {};
      if (action.type === 'add_text_element') {
        const s = Number(obj.start) || 0;
        const e = Number(obj.end);
        if (Number.isFinite(e)) planHorizon = Math.max(planHorizon, Math.min(e, s + 120));
      }
      if (action.type === 'add_audio_clip') {
        const s = Number(obj.start) || 0;
        const te = Number(obj.trimEnd);
        const ts = Number(obj.trimStart) || 0;
        if (Number.isFinite(te)) planHorizon = Math.max(planHorizon, Math.min(s + Math.max(0, te - ts), s + 600));
      }
    }
    const planCeiling = Math.max(
      projectDuration(docRef.current.project),
      planHorizon,
    );
    planCeilingRef.current = planCeiling;

    /*
     * Narration prep — ALL async work happens here, outside the sync
     * state updater: decode the synthesized WAV, measure its REAL
     * duration, upload to storage. The updater then only places tracks.
     */
    const preparedNarrations: Array<{ start: number; span: number; url: string } | null> = [];
    for (const action of safeActions) {
      if (action.type !== 'speak_narration' || !action.object) {
        preparedNarrations.push(null);
        continue;
      }
      const obj = action.object;
      const wavBase64 = typeof obj.audioBase64Wav === 'string' ? obj.audioBase64Wav : '';
      if (!wavBase64 || !meId) {
        preparedNarrations.push(null);
        continue;
      }
      try {
        const binary = atob(wavBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        const file = new File([bytes], 'ai-narration.wav', { type: 'audio/wav' });
        /* Duration is decoded from the actual audio, not estimated. */
        const probe = document.createElement('audio');
        probe.preload = 'metadata';
        const realDuration = await new Promise<number>((resolve) => {
          const done = () => resolve(Number.isFinite(probe.duration) && probe.duration > 0 ? probe.duration : 0);
          probe.onloadedmetadata = done;
          probe.onerror = () => resolve(0);
          probe.src = URL.createObjectURL(file);
        });
        const uploadedUrl = await uploadStudioMedia(file);
        const span = realDuration > 0 ? realDuration : Math.max(2, String(obj.text || '').split(/\s+/).length / 2.6);
        preparedNarrations.push({ start: Math.max(0, Number(obj.start) || 0), span, url: uploadedUrl });
      } catch {
        preparedNarrations.push(null);
      }
    }

    updateProject((p) => {
      let nextProject = { ...p };

      let narrationIndex = 0;

      for (const action of safeActions) {
        if (action.type === 'set_aspect' && typeof action.value === 'string' &&
            ['original', '16:9', '9:16', '1:1', '4:5', '3:2', '21:9'].includes(action.value)) {
          const aspect = action.value as AspectRatio;
          nextProject = {
            ...nextProject,
            aspect,
            canvas: aspect === 'original' ? nextProject.canvas : { ...CANVAS_SIZES[aspect] },
          };
          continue;
        }

        if (action.type === 'add_text_element' && action.object) {
          const obj = action.object;
          let start = Number(obj.start);
          let end = Number(obj.end);
          /* Snap cue starts to measured musical beats (within 0.25s) — a
             title landing on the downbeat reads as intentional, same rule
             audio placement already follows. */
          if (Number.isFinite(start) && nextProject.beatMarkers?.length) {
            const nearest = nextProject.beatMarkers.reduce(
              (best, beat) => (Math.abs(beat - start) < Math.abs(best - start) ? beat : best),
              nextProject.beatMarkers[0],
            );
            if (Math.abs(nearest - start) <= 0.25) {
              const shift = nearest - start;
              start = nearest;
              if (Number.isFinite(end)) end = Math.max(nearest + 0.25, end + shift);
            }
          }
          const safeStart = Number.isFinite(start) ? Math.max(0, start) : playheadRef.current;
          const safeEnd = Number.isFinite(end) ? Math.max(safeStart + 0.25, Math.min(planCeiling, end)) : Math.min(planCeiling, safeStart + 3);
          /* Lane assignment: put this cue on the first overlay track with no
             time overlap, so simultaneous AI texts sit on separate lanes
             instead of piling onto one crowded row. All lanes busy → add one. */
          const laneHasOverlap = (laneId: string) =>
            nextProject.elements.some((el) =>
              (el.track_id || nextProject.tracks[0]?.id) === laneId &&
              safeStart < el.end && el.start < safeEnd,
            );
          let cueLaneId = nextProject.tracks.find((track) => track.kind === 'overlay' && !laneHasOverlap(track.id))?.id;
          if (!cueLaneId) {
            nextProject = addTimelineTrack(nextProject, undefined, 'element');
            cueLaneId = nextProject.tracks[nextProject.tracks.length - 1]?.id;
          }
          const element: TimelineElement = {
            id: makeVideoId('ai-text'),
            kind: 'text',
            content: String(obj.text || 'Your message'),
            src: null,
            track_id: cueLaneId || nextProject.tracks.find((track) => track.kind === 'overlay')?.id || nextProject.tracks[0]?.id,
            start: safeStart,
            end: Math.max(safeStart + 0.25, safeEnd),
            x: Number.isFinite(Number(obj.x)) ? Number(obj.x) : nextProject.canvas.width * 0.08,
            y: Number.isFinite(Number(obj.y)) ? Number(obj.y) : nextProject.canvas.height * 0.72,
            width: Number.isFinite(Number(obj.width)) ? Math.max(40, Number(obj.width)) : nextProject.canvas.width * 0.84,
            height: Number.isFinite(Number(obj.height)) ? Math.max(30, Number(obj.height)) : 100,
            rotation: 0,
            opacity: 1,
            z: Math.max(...nextProject.elements.map((item) => item.z), 0) + 1,
            font_size: Number.isFinite(Number(obj.font_size)) ? Math.max(18, Number(obj.font_size)) : Math.max(30, Math.round(nextProject.canvas.width * 0.055)),
            font_family: String(obj.font_family || 'Poppins, sans-serif'),
            font_weight: Number.isFinite(Number(obj.font_weight)) ? Number(obj.font_weight) : 800,
            color: String(obj.color || '#FFFFFF'),
            align: (['center', 'left', 'right'].includes(String(obj.align)) ? String(obj.align) : 'center') as TimelineElement['align'],
            background: obj.background == null ? 'transparent' : String(obj.background),
            stroke_color: String(obj.stroke_color || '#000000'),
            shadow: obj.shadow !== false,
            animation: (['none','fade','pop','slide-up','slide-down','slide-left','slide-right','zoom-in','zoom-out','bounce','typewriter','shake','blur-in','rotate-in','elastic','mask-wipe'].includes(String(obj.animation))
              ? String(obj.animation)
              : 'pop') as TimelineElement['animation'],
          };
          nextProject = { ...nextProject, elements: [...nextProject.elements, element] };
          continue;
        }

        if (action.type === 'split_clip') {
          const timelineTime = Number(action.value);
          if (!Number.isFinite(timelineTime)) continue;
          let acc = 0;
          const index = nextProject.clips.findIndex((clip) => {
            const d = clipDuration(clip);
            const hit = timelineTime > acc + 0.15 && timelineTime < acc + d - 0.15;
            if (!hit) acc += d;
            return hit;
          });
          if (index >= 0) {
            const clip = nextProject.clips[index];
            const local = Math.max(0, timelineTime - nextProject.clips.slice(0, index).reduce((sum, item) => sum + clipDuration(item), 0));
            const splitSource = clip.trimStart + local * clip.speed;
            if (splitSource - clip.trimStart >= 0.15 && clip.trimEnd - splitSource >= 0.15) {
              const a: VideoClip = { ...clip, trimEnd: splitSource };
              const b: VideoClip = { ...clip, id: makeVideoId('clip'), trimStart: splitSource, transitionIn: { type: 'none', duration: 0.5 } };
              nextProject = { ...nextProject, clips: nextProject.clips.flatMap((item) => item.id === clip.id ? [a, b] : [item]) };
            }
          }
          continue;
        }

        if (action.type === 'reorder_clip' && action.object) {
          const from = Math.round(Number(action.object.fromIndex));
          const to = Math.round(Number(action.object.toIndex));
          if (Number.isFinite(from) && Number.isFinite(to) && from >= 0 && from < nextProject.clips.length) {
            const clips = [...nextProject.clips];
            const [moved] = clips.splice(from, 1);
            clips.splice(Math.max(0, Math.min(to, clips.length)), 0, moved);
            nextProject = { ...nextProject, clips };
          }
          continue;
        }

        if (action.type === 'delete_clip' && action.clipId) {
          nextProject = { ...nextProject, clips: nextProject.clips.filter((clip) => clip.id !== action.clipId) };
          continue;
        }

        if (action.type === 'duplicate_clip' && action.clipId) {
          const clip = nextProject.clips.find((item) => item.id === action.clipId);
          if (clip) {
            const copy = { ...clip, id: makeVideoId('clip'), name: `${clip.name} copy` };
            const i = nextProject.clips.findIndex((item) => item.id === clip.id);
            const clips = [...nextProject.clips];
            clips.splice(i + 1, 0, copy);
            nextProject = { ...nextProject, clips };
          }
          continue;
        }

        if (action.type === 'add_audio_clip') {
          const obj = action.object || {};
          let src = typeof obj.url === 'string' && /^https?:\/\//i.test(obj.url) ? obj.url : '';
          if (!src && typeof obj.soundId === 'string') {
            /* The library url lives server-side; the AI supplies the id and
               the panel's resolver (onAddLibraryAudio) already placed it.
               Here we only resolve placement for an existing track when the
               url is unavailable, otherwise skip — never invent a url. */
            continue;
          }
          if (!src) continue;
          const kind: 'music' | 'voiceover' = obj.kind === 'voiceover' ? 'voiceover' : 'music';
          const duration = projectDuration(nextProject);
          /* Snap the start to the nearest beat within 0.3s — cuts and cue
             starts landing on the downbeat read as intentional. */
          let start = Math.max(0, Number(obj.start) || 0);
          if (nextProject.beatMarkers?.length) {
            const nearest = nextProject.beatMarkers.reduce(
              (best, beat) => (Math.abs(beat - start) < Math.abs(best - start) ? beat : best),
              nextProject.beatMarkers[0]
            );
            if (Math.abs(nearest - start) <= 0.3) start = Math.max(0, nearest);
          }
          const trimStart = Math.max(0, Number(obj.trimStart) || 0);
          const trimEnd = Math.max(trimStart + 0.5, Number(obj.trimEnd) || trimStart + Math.min(30, duration - start));
          const track: AudioTrack = {
            id: makeVideoId('ai-aud'),
            name: kind === 'voiceover' ? 'AI voiceover' : 'AI music',
            src,
            provider: 'library',
            track_id: nextProject.tracks.find((item) => item.kind === 'audio')?.id,
            start,
            sourceDuration: Math.max(trimEnd, trimStart + 0.5),
            trimStart,
            trimEnd: Math.min(trimEnd, trimStart + 600),
            volume: Math.max(0.05, Math.min(1, Number(obj.volume) || (kind === 'music' ? 0.6 : 0.95))),
            fadeIn: Math.max(0, Math.min(3, Number(obj.fadeIn) || 0.6)),
            fadeOut: Math.max(0, Math.min(3, Number(obj.fadeOut) || 1)),
            kind,
          };
          nextProject = { ...nextProject, audio: [...nextProject.audio, track] };
          continue;
        }

        if (action.type === 'speak_narration') {
          /* Audio was prepared before this updater ran (decoded, measured,
             uploaded). Here we only place the track — measured duration,
             snapped to beats, trimmed to the timeline. */
          const prepared = preparedNarrations[narrationIndex];
          narrationIndex += 1;
          if (!prepared) continue;
          let start = prepared.start;
          if (nextProject.beatMarkers?.length) {
            const nearest = nextProject.beatMarkers.reduce(
              (best, beat) => (Math.abs(beat - start) < Math.abs(best - start) ? beat : best),
              nextProject.beatMarkers[0]
            );
            if (Math.abs(nearest - start) <= 0.3) start = Math.max(0, nearest);
          }
          /* Timing guard: move the narration off any caption window and
             off music boundaries; when no clear slot exists anywhere,
             keep the requested start and duck music under the speech. */
          const guard = shiftNarrationClear(nextProject, start, prepared.span);
          let duckMusic = false;
          if (guard.start >= 0 && guard.start !== start) {
            start = guard.start;
          } else if (guard.start >= 0) {
            /* already clear of captions; if it overlaps music, duck */
            duckMusic = nextProject.audio.some((a) => {
              if (a.kind !== 'music') return false;
              const ms = Number(a.start) || 0;
              const me = ms + Math.max(0.1, (Number(a.trimEnd) || 0) - (Number(a.trimStart) || 0));
              return start < me && start + prepared.span > ms;
            });
          } else {
            duckMusic = true;
          }
          if (duckMusic) {
            nextProject = {
              ...nextProject,
              audio: nextProject.audio.map((a) => (a.kind === 'music' ? { ...a, volume: Math.min(Number(a.volume) || 1, 0.18) } : a)),
            };
          }
          const timelineEnd = projectDuration(nextProject);
          const trimmedSpan = Math.min(prepared.span, Math.max(0.5, timelineEnd - start));
          const track: AudioTrack = {
            id: makeVideoId('ai-tts'),
            name: 'AI narration',
            src: prepared.url,
            provider: 'upload',
            track_id: nextProject.tracks.find((item) => item.kind === 'audio')?.id,
            start,
            sourceDuration: prepared.span,
            trimStart: 0,
            trimEnd: trimmedSpan,
            volume: 0.95,
            fadeIn: 0.15,
            fadeOut: 0.4,
            kind: 'voiceover',
          };
          nextProject = { ...nextProject, audio: [...nextProject.audio, track] };
          continue;
        }

        if (action.type === 'cut_on_beats' && action.object) {
          /* Rhythm-locked editing: retime every clip so its OUT point lands
             on a beat. Measured beats win; an even bpm grid is the fallback.
             Structural, so it runs before text/audio placement. */
          const obj = action.object;
          const policy = String(obj.trimPolicy || 'moderate') === 'tight' ? 0.9 : 0.75;
          let beats = (nextProject.beatMarkers || []).filter((t) => Number.isFinite(t) && t > 0.2);
          if (beats.length < 2) {
            const bpm = Number(obj.bpm) || 120;
            const total = nextProject.clips.reduce((sum, c) => sum + clipDuration(c), 0);
            beats = [];
            for (let t = 60 / bpm; t < total; t += 60 / bpm) beats.push(t);
          }
          if (beats.length >= 2) {
            let beatIdx = 0;
            const retimed = nextProject.clips.map((clip) => {
              const target = Math.max(0.3, clipDuration(clip) * policy);
              /* advance to the first beat that covers the requested span */
              while (
                beatIdx < beats.length - 1 &&
                beats[beatIdx + 1] - (beatIdx > 0 ? beats[0] : 0) < target
              ) beatIdx += 1;
              const startBeat = beatIdx > 0 ? beats[beatIdx - 1] ?? 0 : 0;
              const endBeat = beats[Math.min(beatIdx, beats.length - 1)];
              const span = Math.max(0.3, endBeat - startBeat);
              const speed = Math.max(0.25, Math.min(4, clip.speed || 1));
              const wantedSource = span * speed;
              const available = Math.max(0.2, clip.sourceDuration - clip.trimStart);
              const nextTrimEnd = Math.min(clip.sourceDuration, clip.trimStart + Math.min(wantedSource, available));
              const applied: VideoClip = {
                ...clip,
                trimEnd: nextTrimEnd,
                transitionIn: obj.applyTransitions === false ? clip.transitionIn : {
                  type: clip.transitionIn?.type && clip.transitionIn.type !== 'none' ? clip.transitionIn.type : 'crossfade',
                  duration: Math.min(0.6, span * 0.22),
                },
              };
              beatIdx += 1;
              return applied;
            });
            nextProject = { ...nextProject, clips: retimed };
          }
          continue;
        }

        if (action.type === 'delete_element' && action.elementId) {
          nextProject = { ...nextProject, elements: nextProject.elements.filter((element) => element.id !== action.elementId) };
          continue;
        }

        if (action.type === 'retime_element') {
          const target = nextProject.elements.find((element) => action.elementId === element.id);
          if (target && action.object) {
            const start = Number(action.object.start);
            const end = Number(action.object.end);
            if (Number.isFinite(start) || Number.isFinite(end)) {
              const dur = Math.max(0.25, target.end - target.start);
              const safeStart = Number.isFinite(start) ? Math.max(0, start) : target.start;
              const safeEnd = Number.isFinite(end) ? Math.max(safeStart + 0.25, Math.min(planCeiling, end)) : Math.min(planCeiling, safeStart + dur);
              nextProject = {
                ...nextProject,
                elements: nextProject.elements.map((element) =>
                  element.id === target.id ? { ...element, start: safeStart, end: safeEnd } : element
                ),
              };
            }
          }
          continue;
        }

        if (action.type === 'transform_element' || action.type === 'set_element_opacity') {
          nextProject = {
            ...nextProject,
            elements: nextProject.elements.map((element) => {
              if (action.elementId !== element.id) return element;
              const next = { ...element };
              if (action.type === 'set_element_opacity' && Number.isFinite(Number(action.value))) {
                next.opacity = Math.max(0, Math.min(1, Number(action.value)));
              }
              if (action.type === 'transform_element' && action.object) {
                const obj = action.object;
                if (Number.isFinite(Number(obj.x))) next.x = Number(obj.x);
                if (Number.isFinite(Number(obj.y))) next.y = Number(obj.y);
                if (Number.isFinite(Number(obj.width))) next.width = Math.max(8, Number(obj.width));
                if (Number.isFinite(Number(obj.height))) next.height = Math.max(8, Number(obj.height));
                if (Number.isFinite(Number(obj.rotation))) next.rotation = Number(obj.rotation);
                if (Number.isFinite(Number(obj.opacity))) next.opacity = Math.max(0, Math.min(1, Number(obj.opacity)));
              }
              return next;
            }),
          };
          continue;
        }

        if (action.type === 'set_keyframe' && action.object) {
          const property = String(action.object.property || '') as KeyframeProperty;
          const t = Number(action.object.t);
          const value = Number(action.object.value);
          if (!KEYFRAMABLE_PROPERTIES.some((item) => item.id === property) || !Number.isFinite(t) || !Number.isFinite(value)) continue;

          if (action.elementId) {
            const element = nextProject.elements.find((item) => item.id === action.elementId);
            if (element) {
              nextProject = {
                ...nextProject,
                elements: nextProject.elements.map((item) =>
                  item.id === element.id
                    ? { ...item, keyframes: upsertKeyframe(item, property, Math.max(0, t), value) }
                    : item
                ),
              };
            }
            continue;
          }

          if (action.clipId && action.clipId !== 'all') {
            const clip = nextProject.clips.find((item) => item.id === action.clipId);
            if (clip) {
              nextProject = {
                ...nextProject,
                clips: nextProject.clips.map((item) =>
                  item.id === clip.id
                    ? { ...item, keyframes: upsertClipKeyframe(item, property, Math.max(0, Math.min(clipDuration(item), t)), value) }
                    : item
                ),
              };
            }
          }
          continue;
        }

        if (!action.clipId) continue;
        const clip = nextProject.clips.find((item) => item.id === action.clipId);
        if (!clip) continue;
        let next = { ...clip };
        const numberValue = Number(action.value);

        if (action.type === 'set_clip_speed' && Number.isFinite(numberValue)) next.speed = Math.max(0.25, Math.min(4, numberValue));
        if (action.type === 'set_clip_volume' && Number.isFinite(numberValue)) next.volume = Math.max(0, Math.min(1, numberValue));
        if (action.type === 'set_clip_mute') next.muted = Boolean(action.value);
        if (action.type === 'set_clip_filter') next.filter = String(action.value || 'none');
        if (action.type === 'set_clip_effect') next.effect = String(action.value || 'none') as VideoClip['effect'];

        if (action.type === 'set_clip_transition') {
          next.transitionIn = {
            type: String(action.value || 'none') as VideoClip['transitionIn']['type'],
            duration: Math.max(0.2, Math.min(2, Number(action.value2) || 0.5)),
          };
        }

        if (action.type === 'trim_clip') {
          const start = Math.max(0, Math.min(next.sourceDuration - 0.1, Number(action.value)));
          const end = Math.max(start + 0.1, Math.min(next.sourceDuration, Number(action.value2)));
          if (Number.isFinite(start) && Number.isFinite(end)) {
            next.trimStart = start;
            next.trimEnd = end;
          }
        }

        if (action.type === 'transform_clip' && action.object) {
          const transform = { ...next.transform };
          const obj = action.object;
          if (Number.isFinite(Number(obj.offset_x))) transform.offset_x = Number(obj.offset_x);
          if (Number.isFinite(Number(obj.offset_y))) transform.offset_y = Number(obj.offset_y);
          if (Number.isFinite(Number(obj.scale))) transform.scale = Math.max(0.1, Math.min(4, Number(obj.scale)));
          if (Number.isFinite(Number(obj.scale_x))) transform.scale_x = Math.max(0.05, Math.min(4, Number(obj.scale_x)));
          if (Number.isFinite(Number(obj.scale_y))) transform.scale_y = Math.max(0.05, Math.min(4, Number(obj.scale_y)));
          if (Number.isFinite(Number(obj.rotation))) transform.rotation = Number(obj.rotation);
          next.transform = transform;
        }

        if (action.type === 'set_clip_adjustments' && action.object) {
          next.adjustments = {
            ...next.adjustments,
            ...Object.fromEntries(
              Object.entries(action.object)
                .filter(([, value]) => Number.isFinite(Number(value)))
                .map(([key, value]) => [key, Number(value)])
            ),
          };
        }

        if (action.type === 'fit_clip') {
          const mode = String(action.value || 'contain') === 'cover' ? 'cover' : 'contain';
          const sourceAspect = next.source_width && next.source_height
            ? next.source_width / next.source_height
            : nextProject.canvas.width / Math.max(1, nextProject.canvas.height);
          const effectiveAspect = croppedAspect(sourceAspect, next.transform.crop);
          const cover = coverFit(nextProject.canvas.width, nextProject.canvas.height, effectiveAspect);
          const fitScale = mode === 'contain'
            ? Math.min(nextProject.canvas.width / Math.max(1, cover.w), nextProject.canvas.height / Math.max(1, cover.h))
            : 1;
          next.transform = {
            ...DEFAULT_TRANSFORM,
            crop: next.transform.crop,
            scale: Math.max(0.05, Math.min(4, fitScale)),
          };
        }

        nextProject = {
          ...nextProject,
          clips: nextProject.clips.map((item) => item.id === clip.id ? next : item),
        };
      }

      return nextProject;
    }, 'AI edit plan');

    for (const action of safeActions) {
      if (action.type === 'duplicate_clip' && action.clipId) setSelectedClipId(action.clipId);
    }

    if (safeActions.length > 0) {
      notify(`Applied ${safeActions.length} AI edit ${safeActions.length === 1 ? 'change' : 'changes'}.`);
    } else if (actionFailures.length) {
      notify('No AI timeline changes were applied.');
    }
    return { applied: safeActions.length, failed: actionFailures };
  }, [notify, updateProject]);

  const moveClip = (id: string, dir: -1 | 1) => {
    updateProject((p) => {
      const i = p.clips.findIndex((c) => c.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= p.clips.length) return p;
      const clips = [...p.clips];
      [clips[i], clips[j]] = [clips[j], clips[i]];
      return { ...p, clips };
    }, 'Reorder clips');
  };

  const moveClipToIndex = (id: string, targetIndex: number) => {
    updateProject((p) => {
      const from = p.clips.findIndex((c) => c.id === id);
      if (from < 0) return p;
      const clips = [...p.clips];
      const [moved] = clips.splice(from, 1);
      const to = Math.max(0, Math.min(targetIndex, clips.length));
      clips.splice(to, 0, moved);
      return { ...p, clips };
    }, 'Reorder main-track clips', `reorder-${id}`);
  };

  const selectedClipTimeIn = useMemo(() => {
    if (!selectedClipId) return 0;
    let start = 0;
    for (const clip of project.clips) {
      if (clip.id === selectedClipId) {
        return Math.max(0, Math.min(clipDuration(clip), playhead - start));
      }
      start += clipDuration(clip);
    }
    return 0;
  }, [project.clips, selectedClipId, playhead]);

  const addMainClipKeyframe = useCallback((prop: KeyframeProperty) => {
    const clip = docRef.current.project.clips.find((c) => c.id === selectedClipId);
    if (!clip) return;
    /* Color-grade properties sample the RESOLVED adjustment stack so a new
       keyframe captures what the frame currently looks like. */
    const graded = resolveClipAdjustments(clip, selectedClipTimeIn);
    const values = resolveClipValues(clip, selectedClipTimeIn);
    const value =
      prop === 'pos_x_kf' ? values.offset_x :
      prop === 'pos_y_kf' ? values.offset_y :
      prop === 'scale_kf' ? values.scale :
      prop === 'rotation_kf' ? values.rotation :
      prop === 'opacity_kf' ? values.opacity :
      prop === 'brightness_kf' ? graded.brightness :
      prop === 'contrast_kf' ? graded.contrast :
      prop === 'saturate_kf' ? graded.saturate :
      prop === 'hue_kf' ? graded.hue :
      prop === 'temperature_kf' ? graded.temperature :
      prop === 'exposure_kf' ? graded.exposure :
      prop === 'vignette_kf' ? graded.vignette :
      prop === 'blur_kf' ? graded.blur :
      values.volume;
    updateClip(clip.id, { keyframes: upsertClipKeyframe(clip, prop, selectedClipTimeIn, value) }, 'Add clip keyframe', `clip-kf-${clip.id}-${prop}`);
  }, [selectedClipId, selectedClipTimeIn, updateClip]);

  const applyMotionPreset = useCallback((preset: 'zoom-in' | 'zoom-out' | 'spin' | 'float' | 'pop' | 'shake') => {
    const clip = docRef.current.project.clips.find((c) => c.id === selectedClipId);
    if (!clip) return;
    const d = Math.max(0.2, clipDuration(clip));
    const base = resolveClipValues(clip, 0);
    const make = (t: number, value: number) => ({ id: makeVideoId('kf'), t, value });
    const k = (posX: number[], posY: number[], scale: number[], rotation: number[], opacity: number[]) => ({
      pos_x_kf: [0, 0.5, 1].map((u, i) => make(u * d, posX[i])),
      pos_y_kf: [0, 0.5, 1].map((u, i) => make(u * d, posY[i])),
      scale_kf: [0, 0.5, 1].map((u, i) => make(u * d, scale[i])),
      rotation_kf: [0, 0.5, 1].map((u, i) => make(u * d, rotation[i])),
      opacity_kf: [0, 0.5, 1].map((u, i) => make(u * d, opacity[i])),
    });
    const x = base.offset_x, y = base.offset_y, r = base.rotation, sc = base.scale;
    let keyframes;
    switch (preset) {
      case 'zoom-in': keyframes = k([x,x,x],[y,y,y],[sc,sc*1.18,sc*1.35],[r,r,r],[1,1,1]); break;
      case 'zoom-out': keyframes = k([x,x,x],[y,y,y],[sc*1.35,sc*1.18,sc],[r,r,r],[1,1,1]); break;
      case 'spin': keyframes = k([x,x,x],[y,y,y],[sc,sc,sc],[r,r+180,r+360],[1,1,1]); break;
      case 'float': keyframes = k([x,x,x],[y-22,y+22,y],[sc,sc*1.02,sc],[r-2,r+2,r],[1,1,1]); break;
      case 'pop': keyframes = k([x,x,x],[y,y,y],[sc*0.82,sc*1.08,sc],[r,r,r],[0,1,1]); break;
      case 'shake': keyframes = k([x-14,x+14,x],[y,y-8,y],[sc,sc,sc],[r-2,r+2,r],[1,1,1]); break;
    }
    updateClip(clip.id, { keyframes: { ...(clip.keyframes || {}), ...keyframes } }, 'Apply motion preset');
    notify(`${preset.replace('-', ' ')} animation applied.`);
  }, [notify, selectedClipId, updateClip]);

  const removeMainClipKeyframe = useCallback((prop: KeyframeProperty) => {
    const clip = docRef.current.project.clips.find((c) => c.id === selectedClipId);
    if (!clip) return;
    const list = clip.keyframes?.[prop] || [];
    const hit = list.find((k) => Math.abs(k.t - selectedClipTimeIn) < 0.05);
    if (!hit) return;
    updateClip(clip.id, { keyframes: removeKeyframe({ id: clip.id, kind: 'video', content: '', src: clip.src, start: 0, end: clipDuration(clip), x: 0, y: 0, width: 1, height: 1, rotation: 0, opacity: 1, z: 1, keyframes: clip.keyframes }, prop, hit.id) }, 'Remove clip keyframe', `clip-kf-${clip.id}-${prop}`);
  }, [selectedClipId, selectedClipTimeIn, updateClip]);

  const toggleSelectedId = (id: string, additive = true) => {
    setSelectedIds((prev) => additive ? (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]) : [id]);
  };

  const deleteSelectedClips = () => {
    const ids = selectedIds.length ? selectedIds : (selectedClipId ? [selectedClipId] : []);
    if (!ids.length) return;
    updateProject((p) => ({ ...p, clips: p.clips.filter((c) => !ids.includes(c.id)) }), rippleEnabled ? 'Ripple delete clips' : 'Delete clips');
    setSelectedIds([]);
    setSelectedClipId(null);
    notify(rippleEnabled ? 'Ripple delete applied.' : 'Clips deleted.');
  };

  const toggleTrackFlag = (trackId: string, flag: 'muted' | 'locked' | 'solo') => {
    updateProject((p) => ({
      ...p,
      tracks: p.tracks.map((t) => {
        if (t.id !== trackId) return t;
        if (flag === 'solo') return { ...t, solo: !t.solo };
        return { ...t, [flag]: !t[flag] };
      }),
    }), flag === 'muted' ? 'Toggle track mute' : flag === 'solo' ? 'Toggle track solo' : 'Toggle track lock');
  };

  /* ---------- move a video overlay onto the main track ---------- */
  const moveVideoOverlayToMainTrack = (el: TimelineElement, targetIndex?: number) => {
    if (el.kind !== 'video' || !el.src) return notify('Only video overlays can be moved to the main track.');
    const sourceDuration = Math.max(0.2, el.source_duration || (el.trim_end || 0) || (el.end - el.start) * (el.speed || 1));
    const trimStart = Math.max(0, el.trim_start || 0);
    const trimEnd = Math.min(sourceDuration, Math.max(trimStart + 0.1, el.trim_end || sourceDuration));
    const clip: VideoClip = {
      id: makeVideoId('clip'), src: el.src, name: el.content || 'Video overlay',
      sourceDuration, trimStart, trimEnd, speed: Math.max(0.05, el.speed || 1),
      volume: el.volume ?? 1, muted: el.muted ?? false, reverse: el.reverse ?? false,
      audioProcessing: { ...DEFAULT_AUDIO_PROCESSING },
      /* carry the overlay's crop + flips into the clip transform */
      transform: { ...DEFAULT_TRANSFORM, crop: sanitizeCrop(el.crop), flip_h: !!el.flip_h, flip_v: !!el.flip_v },
      adjustments: { ...DEFAULT_ADJUSTMENTS }, filter: 'none', effect: 'none',
      transitionIn: { type: 'none', duration: 0.5 },
    };
    updateProject((p) => {
      const clips = [...p.clips];
      const at = targetIndex == null ? clips.length : Math.max(0, Math.min(targetIndex, clips.length));
      clips.splice(at, 0, clip);
      return { ...p, clips, elements: p.elements.filter((x) => x.id !== el.id) };
    }, 'Move overlay to main track');
    if (cropMode?.type === 'element' && cropMode.id === el.id) setCropMode(null);
    setSelectedElementId(null);
    setSelectedClipId(clip.id);
    notify(targetIndex == null ? 'Video moved to the main track.' : 'Video inserted into the main track.');
  };

  const addEditorTrack = () => {
    updateProject((p) => addTimelineTrack(p), 'Add overlay track');
    notify('New overlay track added.');
  };

  const deleteEditorTrack = (trackId: string) => {
    updateProject((p) => removeTimelineTrack(p, trackId), 'Delete overlay track');
    notify('Overlay track removed.');
  };

  const moveElementToEditorTrack = (elementId: string, trackId: string) => {
    updateProject((p) => moveElementToTrack(p, elementId, trackId), 'Move overlay to track', `trackmove-${elementId}`);
  };

  const rotateSelectedClip = (degrees: number) => {
    if (!selectedClip) return;
    const current = selectedClip.transform.rotation || 0;
    updateClip(selectedClip.id, { transform: { ...selectedClip.transform, rotation: current + degrees } }, degrees < 0 ? 'Rotate counterclockwise' : 'Rotate clockwise');
  };

  const [preparingReverse, setPreparingReverse] = useState<string | null>(null);

  const reverseSelectedClip = async () => {
    if (!selectedClip || preparingReverse) return;

    if (!selectedClip.reverse) {
      setPlaying(false);
      setPreparingReverse(selectedClip.id);
      try {
        await rendererRef.current.prepareReverseClip(selectedClip, (percent) => {
          if (percent >= 100) notify('Reverse ready.');
        });
        updateClip(selectedClip.id, { reverse: true }, 'Reverse clip');
        notify('Reverse applied.');
      } catch (e) {
        notify(e instanceof Error ? e.message : 'Could not prepare reverse playback.');
      } finally {
        setPreparingReverse(null);
      }
      return;
    }

    invalidateReversedCache(selectedClip.src);
    updateClip(selectedClip.id, { reverse: false }, 'Disable reverse');
    notify('Reverse disabled.');
  };

  const setNoiseReduction = (value: number) => {
    if (!selectedClip) return;
    updateClip(selectedClip.id, {
      audioProcessing: {
        ...(selectedClip.audioProcessing || DEFAULT_AUDIO_PROCESSING),
        noiseReduction: value,
      },
    }, 'Noise reduction', `noise-${selectedClip.id}`);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      else if (e.key.toLowerCase() === 's' && !mod) { e.preventDefault(); splitAtPlayhead(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && (selectedIds.length || selectedClipId)) { e.preventDefault(); deleteSelectedClips(); }
      else if (mod && e.key.toLowerCase() === 'd' && selectedClip) { e.preventDefault(); duplicateClip(selectedClip); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); seekTo(Math.max(0, playheadRef.current - (e.shiftKey ? 1 : 1/30))); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seekTo(Math.min(duration, playheadRef.current + (e.shiftKey ? 1 : 1/30))); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteSelectedClips, duplicateClip, duration, selectedClip, selectedClipId, selectedIds, splitAtPlayhead, togglePlay, seekTo]);

  /* ============================================================
     TIMELINE — pointer-driven (mouse, touch and stylus share one
     implementation; HTML5 drag-and-drop is intentionally NOT used
     so mobile behaves). Scrolls BOTH axes; the ruler stays sticky
     so the playhead is always reachable. Structure:

     [ruler + draggable playhead handle]
     [MAIN lane]     sequential clips — drag to reorder, edges trim
     [overlay lanes] absolute items — drag to move in time AND
                     across lanes, edges resize
     [AUDIO lane]    music/voiceover — drag start, edges trim
     ============================================================ */
  const timelineRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1); // 0.5× … 3× around the 46px base
  const pxPerSec = BASE_PX_PER_SEC * zoom;

  /* Minimap: viewport rectangle synced from the scroller on animation
     frames (scroll events fire far too often to setState directly). */
  const [minimapView, setMinimapView] = useState({ left: 0, width: 1, trackWidth: 1 });
  const minimapSyncRef = useRef<number | null>(null);
  const minimapDragRef = useRef(false);
  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const sync = () => {
      const inner = el.firstElementChild as HTMLElement | null;
      const trackWidth = inner ? inner.getBoundingClientRect().width : el.scrollWidth;
      const viewport = el.clientWidth;
      setMinimapView((prev) => {
        const left = el.scrollLeft;
        const width = Math.min(trackWidth, viewport);
        if (Math.abs(prev.left - left) < 1 && Math.abs(prev.width - width) < 1 && Math.abs(prev.trackWidth - trackWidth) < 1) return prev;
        return { left, width, trackWidth };
      });
      minimapSyncRef.current = null;
    };
    const schedule = () => {
      if (minimapSyncRef.current == null) minimapSyncRef.current = requestAnimationFrame(sync);
    };
    sync();
    el.addEventListener('scroll', schedule, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    if (ro) ro.observe(el);
    if (ro && el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', schedule);
      if (ro) ro.disconnect();
      if (minimapSyncRef.current != null) cancelAnimationFrame(minimapSyncRef.current);
    };
  }, [zoom, duration]);

  useMobileGestures(timelineRef, {
    onPinch: (scale, center) => {
      setZoom((value) => Math.max(0.5, Math.min(3, value * scale)));
      const el = timelineRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const relativeX = center.x - rect.left;
        el.scrollLeft = Math.max(0, el.scrollLeft + relativeX * (scale - 1));
      }
    },
    onTwoFingerPan: (delta) => {
      const el = timelineRef.current;
      if (!el) return;
      el.scrollLeft -= delta.x;
      el.scrollTop -= delta.y;
    },
    onTwoFingerTap: () => {
      setZoom(1);
      notify('Timeline zoom reset to 100%.');
    },
    onThreeFingerTap: () => {
      history.undo();
      notify('Undo.');
    },
    onThreeFingerSwipe: (direction) => {
      if (direction === 'left') {
        history.undo();
        notify('Undo.');
      } else if (direction === 'right') {
        history.redo();
        notify('Redo.');
      }
    },
    onLongPress: () => {
      setRippleEnabled((value) => !value);
      notify(`Ripple editing ${rippleEnabled ? 'off' : 'on'}.`);
    },
  }, true);
  const [pointerDragId, setPointerDragId] = useState<string | null>(null);

  /** Convert a clientX into timeline seconds (accounts for scroll + labels). */
  const timeAtClientX = useCallback(
    (clientX: number): number => {
      const el = timelineRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const t = (clientX - rect.left + el.scrollLeft - LABEL_W) / Math.max(1, pxPerSec);
      return Math.max(0, t);
    },
    [pxPerSec]
  );

  /** Continuous scrub from the ruler or the playhead handle. */
  const beginPlayheadDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    seekTo(timeAtClientX(e.clientX));
    const onMove = (ev: PointerEvent) => seekTo(timeAtClientX(ev.clientX));
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  /** Tap anywhere on a lane background to seek (never hijacks scrolling). */
  const laneTapSeek = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-timeline-item],[data-timeline-handle]')) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < TAP_SLOP) {
        seekTo(timeAtClientX(ev.clientX));
      }
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  /* ---------- timeline panning (desktop) ----------
     The scrollbar is intentionally hidden (no-scrollbar), so mouse users get
     explicit panning: horizontal-wheel and Shift+wheel pan directly, a plain
     vertical wheel converts to horizontal travel once the lanes can't scroll
     further vertically, and dragging empty timeline space pans (a still tap
     remains a seek via laneTapSeek). */
  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth + 1) return;
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop >= el.scrollHeight - el.clientHeight - 1;
      if (horizontal || e.shiftKey || (e.deltaY > 0 && atBottom) || (e.deltaY < 0 && atTop)) {
        e.preventDefault();
        el.scrollLeft += horizontal ? e.deltaX : e.deltaY;
      }
    };
    let panStart: { x: number; scrollLeft: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return; /* touch already scrolls natively */
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-timeline-item],[data-timeline-handle],button,[role="slider"]')) return;
      panStart = { x: e.clientX, scrollLeft: el.scrollLeft };
    };
    const onMove = (e: PointerEvent) => {
      if (!panStart) return;
      if (Math.abs(e.clientX - panStart.x) > 3) el.scrollLeft = panStart.scrollLeft - (e.clientX - panStart.x);
    };
    const onUp = () => { panStart = null; };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- main-track clip gestures ---------- */

  /** Trim handles at clip edges (source-window trim, like the original). */
  const startTrim = (e: React.PointerEvent, clip: VideoClip, edge: 'start' | 'end') => {
    e.preventDefault();
    e.stopPropagation();
    setPlaying(false);
    setSelectedClipId(clip.id);
    const startX = e.clientX;
    const startVal = edge === 'start' ? clip.trimStart : clip.trimEnd;
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / Math.max(1, pxPerSec);
      let next = startVal + dx * clip.speed;
      if (edge === 'start') next = Math.max(0, Math.min(next, clip.trimEnd - 0.2));
      else next = Math.min(clip.sourceDuration, Math.max(next, clip.trimStart + 0.2));
      updateClip(clip.id, edge === 'start' ? { trimStart: next } : { trimEnd: next }, 'Trim clip', `trim-${clip.id}`);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  /** Press-and-hold a clip to slide it through the main track (reorder). */
  const beginClipDrag = (e: React.PointerEvent, clip: VideoClip) => {
    if ((e.target as HTMLElement).closest('[data-timeline-handle]')) return; // trim handles win
    e.preventDefault();
    e.stopPropagation();
    setPlaying(false);
    setSelectedClipId(clip.id);
    setSelectedElementId(null);
    setPointerDragId(clip.id);
    const startX = e.clientX;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < 6) return;
      moved = true;
      const clips = docRef.current.project.clips;
      const x = timeAtClientX(ev.clientX) * Math.max(1, pxPerSec);
      let acc = 0;
      let target = clips.length;
      for (let i = 0; i < clips.length; i++) {
        const w = clipDuration(clips[i]) * Math.max(1, pxPerSec);
        if (x < acc + w / 2) { target = i; break; }
        acc += w;
      }
      const from = clips.findIndex((c) => c.id === clip.id);
      if (from < 0) return;
      const adjusted = from < target ? target - 1 : target;
      if (adjusted !== from) moveClipToIndex(clip.id, adjusted);
    };
    const onUp = () => {
      setPointerDragId(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  /* ---------- overlay lane gestures ---------- */

  /** Drag an overlay chip: horizontal = time, vertical = lane switch. */
  const beginOverlayItemDrag = (e: React.PointerEvent, el: TimelineElement) => {
    const track = project.tracks.find((t) => t.id === (el.track_id || project.tracks[0]?.id));
    if (track?.locked) return;
    if ((e.target as HTMLElement).closest('[data-timeline-handle]')) return;
    e.preventDefault();
    e.stopPropagation();
    setPlaying(false);
    setSelectedElementId(el.id);
    setSelectedClipId(null);
    setPointerDragId(el.id);
    const startX = e.clientX;
    const startY = e.clientY;
    const len = Math.max(0.2, el.end - el.start);
    const startStart = el.start;
    const maxStart = Math.max(duration, el.end) - len;
    let moved = false;
    let currentTrack = el.track_id || project.tracks[0]?.id || '';

    const laneRects = () =>
      Array.from(timelineRef.current?.querySelectorAll<HTMLElement>('[data-lane-id]') || []).map((n) => ({
        id: n.dataset.laneId || '',
        top: n.getBoundingClientRect().top,
        bottom: n.getBoundingClientRect().bottom,
      }));

    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < TAP_SLOP) return;
      moved = true;
      const dx = (ev.clientX - startX) / Math.max(1, pxPerSec);
      let nextStart = Math.max(0, Math.min(maxStart, startStart + dx));
      /* magnetic whole-second snap */
      const r = Math.round(nextStart);
      if (Math.abs(nextStart - r) < 0.08) nextStart = r;
      updateElement(el.id, { start: nextStart, end: nextStart + len }, 'Move overlay on timeline', `tlmove-${el.id}`);

      /* vertical: switch lane when the finger crosses one */
      const lane = laneRects().find((l) => ev.clientY >= l.top && ev.clientY <= l.bottom);
      if (!lane || lane.id === currentTrack) return;
      if (lane.id === '__main') {
        if (el.kind === 'video') {
          const latest = docRef.current.project.elements.find((x) => x.id === el.id);
          if (latest) { moveVideoOverlayToMainTrack(latest); setPointerDragId(null); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp); }
        }
        return;
      }
      currentTrack = lane.id;
      moveElementToEditorTrack(el.id, lane.id);
    };
    const onUp = () => {
      setPointerDragId(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  /** Resize an overlay item in time (left edge = start, right = end). */
  const beginOverlayItemResize = (e: React.PointerEvent, el: TimelineElement, edge: 'start' | 'end') => {
    const track = project.tracks.find((t) => t.id === (el.track_id || project.tracks[0]?.id));
    if (track?.locked) return;
    e.preventDefault();
    e.stopPropagation();
    setPlaying(false);
    setSelectedElementId(el.id);
    setSelectedClipId(null);
    const startX = e.clientX;
    const startStart = el.start;
    const startEnd = el.end;
    const maxEnd = Math.max(duration, el.end);
    const onMove = (ev: PointerEvent) => {
      const d = (ev.clientX - startX) / Math.max(1, pxPerSec);
      if (edge === 'start') {
        const ns = Math.max(0, Math.min(startEnd - 0.2, startStart + d));
        updateElement(el.id, { start: ns }, 'Trim overlay start', `tltrim-${el.id}`);
      } else {
        const ne = Math.max(startStart + 0.2, Math.min(maxEnd, startEnd + d));
        updateElement(el.id, { end: ne }, 'Trim overlay end', `tltrim-${el.id}`);
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  /* ---------- audio lane gestures ---------- */

  const beginAudioDrag = (e: React.PointerEvent, a: AudioTrack) => {
    if ((e.target as HTMLElement).closest('[data-timeline-handle]')) return;
    const sourceTrack = project.tracks.find((t) => t.id === a.track_id);
    if (sourceTrack?.locked) return;
    e.preventDefault();
    e.stopPropagation();
    setPlaying(false);
    setSelectedAudioId(a.id);
    setSelectedClipId(null);
    setSelectedElementId(null);
    setPointerDragId(a.id);

    const startX = e.clientX;
    const startY = e.clientY;
    const startStart = a.start;
    const startTrackId = a.track_id || project.tracks.find((t) => t.kind === 'audio')?.id;
    let moved = false;
    let currentTrackId = startTrackId;

    const laneRects = () =>
      Array.from(timelineRef.current?.querySelectorAll<HTMLElement>('[data-lane-kind="audio"]') || []).map((n) => ({
        id: n.dataset.laneId || '',
        top: n.getBoundingClientRect().top,
        bottom: n.getBoundingClientRect().bottom,
      }));

    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < TAP_SLOP) return;
      moved = true;

      const d = (ev.clientX - startX) / Math.max(1, pxPerSec);
      const ns = Math.max(0, startStart + d);
      const lanes = laneRects();
      const currentLane = lanes.find((l) => l.id === currentTrackId);
      const belowLastLane = lanes.length > 0 && ev.clientY > Math.max(...lanes.map((l) => l.bottom));

      if (belowLastLane) {
        updateProject((p) => {
          const audioTracks = p.tracks.filter((t) => t.kind === 'audio').sort((x, y) => x.order - y.order);
          const last = audioTracks[audioTracks.length - 1];
          if (!last || last.id !== currentTrackId) {
            return { ...p, audio: p.audio.map((item) => item.id === a.id ? { ...item, start: ns } : item) };
          }

          const newTrack = {
            id: makeVideoId('track'),
            name: `A${audioTracks.length + 1}`,
            kind: 'audio' as const,
            order: Math.max(...p.tracks.map((t) => t.order), -1) + 1,
            muted: false,
            locked: false,
            solo: false,
          };

          currentTrackId = newTrack.id;
          return {
            ...p,
            tracks: [...p.tracks, newTrack],
            audio: p.audio.map((item) => item.id === a.id ? { ...item, start: ns, track_id: newTrack.id } : item),
          };
        }, 'Create audio track', `audlane-${a.id}`);
        return;
      }

      const lane = lanes.find((l) => ev.clientY >= l.top && ev.clientY <= l.bottom);
      if (lane && lane.id !== currentTrackId) {
        const target = docRef.current.project.tracks.find((t) => t.id === lane.id);
        if (target && !target.locked) {
          currentTrackId = target.id;
          updateAudio(a.id, { start: ns, track_id: target.id }, 'Move audio to track', `audtrack-${a.id}`);
          return;
        }
      }

      updateAudio(a.id, { start: ns }, 'Move audio', `audmove-${a.id}`);
    };

    const onUp = () => {
      setPointerDragId(null);
      if (!moved) openTool('audio');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const beginAudioResize = (e: React.PointerEvent, a: AudioTrack, edge: 'start' | 'end') => {
    const track = project.tracks.find((t) => t.id === a.track_id);
    if (track?.locked) return;
    e.preventDefault();
    e.stopPropagation();
    setSelectedAudioId(a.id);
    const startX = e.clientX;
    const startTrimS = a.trimStart;
    const startTrimE = a.trimEnd;
    const onMove = (ev: PointerEvent) => {
      const d = (ev.clientX - startX) / Math.max(1, pxPerSec);
      if (edge === 'start') {
        const ns = Math.max(0, Math.min(startTrimE - 0.2, startTrimS + d));
        updateAudio(a.id, { trimStart: ns }, 'Trim audio start', `audtrim-${a.id}`);
      } else {
        const sourceDuration = Math.max(
          startTrimE,
          Number(a.sourceDuration) || startTrimE
        );
        const ne = Math.max(
          startTrimS + 0.2,
          Math.min(sourceDuration, startTrimE + d)
        );
        updateAudio(a.id, { trimEnd: ne }, 'Trim audio end', `audtrim-${a.id}`);
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  /* ---------- element ops ---------- */
  const addCaptionElement = () => {
    const start = playheadRef.current;
    const el: TimelineElement = {
      id: makeVideoId('caption'),
      kind: 'text',
      content: 'Caption',
      src: null,
      track_id: project.tracks[0]?.id,
      start,
      end: Math.min(duration, start + 3),
      x: project.canvas.width * 0.08,
      y: project.canvas.height * 0.76,
      width: project.canvas.width * 0.84,
      height: 92,
      rotation: 0,
      opacity: 1,
      z: Math.max(...project.elements.map((item) => item.z), 0) + 1,
      font_size: Math.max(32, Math.round(project.canvas.width * 0.045)),
      font_family: 'Poppins, sans-serif',
      font_weight: 800,
      color: '#FFFFFF',
      align: 'center',
      background: '#000000',
      stroke_color: '#000000',
      shadow: true,
      animation: 'pop',
    };
    updateProject((p) => ({ ...p, elements: [...p.elements, el] }), 'Add caption');
    setSelectedClipId(null);
    setSelectedElementId(el.id);
    openTool('text');
  };

  /* Upload to studio-media and optionally mirror to Cloudinary (best-
     effort). Returns the URL every consumer should use — the Supabase
     URL when Cloudinary is not configured, the optimized URL when it
     is. Shared so no upload site can forget the optimization step. */
  const uploadStudioMedia = useCallback(async (file: File): Promise<string> => {
    if (!meId) throw new Error('Sign in to upload media.');
    const up = await uploadFile(file, 'studio-media', meId);
    try {
      const cloudinaryResponse = await fetch('/api/video/cloudinary', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: up.url,
          mediaType: file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : 'video',
          mode: project.aspect === '9:16' ? 'vertical' : project.aspect === '1:1' ? 'square' : 'optimize',
        }),
      });
      const cloudinary = await cloudinaryResponse.json().catch(() => ({}));
      if (cloudinaryResponse.ok && typeof cloudinary.url === 'string' && cloudinary.url) {
        return cloudinary.url;
      }
    } catch { /* optional optimization layer — keep Supabase URL */ }
    return up.url;
  }, [meId, project.aspect]);

  const addTextElement = () => {
    const hasContent = project.clips.length + project.elements.length + project.audio.length > 0;
    const el: TimelineElement = {
      id: makeVideoId('el'), kind: 'text', content: 'Your text', src: null, track_id: project.tracks[0]?.id,
      start: playheadRef.current, end: hasContent ? Math.min(duration, playheadRef.current + 3) : playheadRef.current + 3,
      x: project.canvas.width / 2 - 200, y: project.canvas.height - 220,
      width: 400, height: 80, rotation: 0, opacity: 1, z: project.elements.length + 1,
      font_size: 54, font_family: 'Poppins, sans-serif', font_weight: 700, color: '#FFFFFF',
      align: 'center', background: null, stroke_color: '#000000', shadow: true, animation: 'pop',
    };
    updateProject((p) => ({ ...p, elements: [...p.elements, el] }), 'Add text');
    setSelectedElementId(el.id);
    openTool('text');
  };

  /* Legacy AI placeholder slivers: before the plan-horizon guard existed,
     add_text_element plans could land as sub-quarter-second cues pinned
     at t=0 with the fallback copy. They never render and only clutter
     the overlay track. This detector matches that exact shape — AI id
     prefix, placeholder/default text, sliver duration, zero pinned
     start — so the cleanup can never eat real (edited) text.
     Manual text uses the 'el-' id prefix, so it is always excluded. */
  const legacyAiElements = useMemo(() => project.elements.filter((el) => {
    if (!el.id.startsWith('ai-text-')) return false;
    const text = String(el.content || '').trim();
    if (!/^(your message|your story)$/i.test(text)) return false;
    if (el.end - el.start > 0.3) return false;
    if (el.start > 0.01) return false;
    return true;
  }), [project.elements]);

  const cleanupLegacyAiElements = useCallback(() => {
    if (legacyAiElements.length === 0) return;
    const doomed = new Set(legacyAiElements.map((el) => el.id));
    updateProject((p) => ({ ...p, elements: p.elements.filter((el) => !doomed.has(el.id)) }), 'Clean up legacy AI placeholder slivers');
    setSelectedElementId((current) => (current && doomed.has(current) ? null : current));
    notify(`Removed ${legacyAiElements.length} legacy AI placeholder ${legacyAiElements.length === 1 ? 'sliver' : 'slivers'} — no AI was used.`);
  }, [legacyAiElements, notify, setSelectedElementId, updateProject]);

  const addGifElement = useCallback((item: { url: string; width: number; height: number; description: string }) => {
    const start = playheadRef.current;
    const end = project.clips.length + project.elements.length + project.audio.length > 0 ? Math.min(duration, start + 3) : start + 3;
    const width = Math.min(project.canvas.width * 0.45, Math.max(120, item.width || 320));
    const height = width * ((item.height || 240) / Math.max(1, item.width || 320));
    const el: TimelineElement = { id: makeVideoId('el'), kind: 'gif', content: item.description || 'GIF', src: item.url, track_id: project.tracks[0]?.id, start, end, x: project.canvas.width / 2 - width / 2, y: project.canvas.height / 2 - height / 2, width, height, rotation: 0, opacity: 1, z: project.elements.length + 1, animation: 'pop', object_fit: 'contain' };
    updateProject((p) => ({ ...p, elements: [...p.elements, el] }), 'Add GIF');
    setSelectedElementId(el.id); setSelectedClipId(null); notify('GIF added to the overlay track.');
  }, [duration, notify, project.audio.length, project.canvas.height, project.canvas.width, project.clips.length, project.elements.length, project.tracks, updateProject]);



  const addVideoOverlay = async (file: File) => {
    if (!meId || !file.type.startsWith('video/')) return;
    setImporting({ name: file.name, percent: 15 });
    try {
      const probeUrl = URL.createObjectURL(file);
      const meta = await new Promise<{ duration: number; w: number; h: number }>((resolve, reject) => {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.muted = true;
        v.onloadedmetadata = async () => {
          const d = await normalizeVideoDuration(v);
          resolve({ duration: d || 5, w: v.videoWidth || 640, h: v.videoHeight || 360 });
        };
        v.onerror = () => reject(new Error(`Unable to load video "${file.name}" — the file may be corrupt or in an unsupported format.`));
        v.src = probeUrl;
      });
      URL.revokeObjectURL(probeUrl);
      setImporting({ name: file.name, percent: 45 });
      const mediaUrl = await uploadStudioMedia(file);
      const durationForLayer = Math.max(0.2, Math.min(meta.duration || 5, Math.max(0.2, duration - playheadRef.current)));
      const width = Math.min(project.canvas.width * 0.55, Math.max(180, meta.w || 640));
      const height = width * ((meta.h || 360) / Math.max(1, meta.w || 640));
      const el: TimelineElement = {
        id: makeVideoId('el'), kind: 'video', content: file.name, src: mediaUrl, media_type: 'video', track_id: project.tracks[0]?.id,
        source_duration: meta.duration, trim_start: 0, trim_end: Math.min(meta.duration, durationForLayer), speed: 1, volume: 1, muted: true, object_fit: 'contain',
        start: playheadRef.current, end: Math.min(duration, playheadRef.current + durationForLayer),
        x: (project.canvas.width - width) / 2, y: (project.canvas.height - height) / 2, width, height, rotation: 0, opacity: 1, z: project.elements.length + 1, animation: 'fade',
      };
      updateProject((p) => ({ ...p, elements: [...p.elements, el] }), 'Add video overlay');
      setSelectedElementId(el.id);
      setSelectedClipId(null);
      notify('Video overlay added. Drag it on the canvas or timeline.');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Video overlay import failed.');
    } finally {
      setImporting(null);
    }
  };

  const updateElement = (id: string, patch: Partial<TimelineElement>, label: string, coalesceKey?: string) => {
    updateProject(
      (p) => ({ ...p, elements: p.elements.map((el) => (el.id === id ? { ...el, ...patch } : el)) }),
      label,
      coalesceKey
    );
  };

  const deleteElement = (id: string) => {
    if (cropMode?.type === 'element' && cropMode.id === id) setCropMode(null);
    updateProject((p) => ({ ...p, elements: p.elements.filter((el) => el.id !== id) }), 'Delete overlay');
    setSelectedElementId(null);
  };

  const duplicateElement = (el: TimelineElement) => {
    const copy = { ...el, id: makeVideoId('el'), x: el.x + 24, y: el.y + 24, z: project.elements.length + 1 };
    updateProject((p) => ({ ...p, elements: [...p.elements, copy] }), 'Duplicate overlay');
    setSelectedElementId(copy.id);
  };

  /* ============================================================
     Direct manipulation on the preview (CapCut-style):
     • tap an overlay OR the main video → select it
     • drag → move · corner → resize · edge → stretch one axis
     • top handle → rotate (snaps to 15° near the snap points)
     All in CANVAS coordinates — canvasPoint() divides by the LIVE
     rendered size of the canvas, so browser zoom, responsive
     layout and canvas scaling all stay pixel-accurate.
     Preview ↔ export share drawFrame, so what you position here is
     exactly what renders in the export.
     ============================================================ */
  const canvasPoint = (e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: ((e.clientX - rect.left) / rect.width) * project.canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * project.canvas.height,
    };
  };

  const hitsElement = (el: TimelineElement, px: number, py: number) =>
    px >= el.x && px <= el.x + el.width && py >= el.y && py <= el.y + el.height;

  /** Topmost overlay under a canvas point (visible at the current playhead). */
  const elementAt = (px: number, py: number): TimelineElement | null => {
    const t = playheadRef.current;
    const visible = docRef.current.project.elements
      .filter((el) => t >= el.start && t < el.end)
      .sort((a, b) => a.z - b.z);
    for (let i = visible.length - 1; i >= 0; i--) {
      if (hitsElement(visible[i], px, py)) return visible[i];
    }
    return null;
  };

  /** Main clip whose (rotated) box contains the point — for tap-to-select. */
  const clipAt = (px: number, py: number): VideoClip | null => {
    const t = playheadRef.current;
    const resolved = resolveTime(docRef.current.project, t);
    if (!resolved) return null;
    const box = clipBoxRect(resolved.clip, project.canvas.width, project.canvas.height);
    const rad = -(resolved.clip.transform.rotation * Math.PI) / 180;
    const dx = px - box.cx;
    const dy = py - box.cy;
    const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
    return Math.abs(lx) <= box.w / 2 && Math.abs(ly) <= box.h / 2 ? resolved.clip : null;
  };

  /* handle positions for the selected element, in canvas units */
  const elementHandlePoints = (el: TimelineElement) => {
    const corner = (cx: 0 | 1, cy: 0 | 1) => {
      const rad = (el.rotation * Math.PI) / 180;
      const lx = cx * el.width - el.width / 2;
      const ly = cy * el.height - el.height / 2;
      return {
        x: el.x + el.width / 2 + lx * Math.cos(rad) - ly * Math.sin(rad),
        y: el.y + el.height / 2 + lx * Math.sin(rad) + ly * Math.cos(rad),
      };
    };
    const edgeMid = (ax: 'x' | 'y', at: 0 | 1) => {
      const rad = (el.rotation * Math.PI) / 180;
      const lx = (ax === 'x' ? at * el.width : el.width / 2) - el.width / 2;
      const ly = (ax === 'y' ? at * el.height : el.height / 2) - el.height / 2;
      return {
        x: el.x + el.width / 2 + lx * Math.cos(rad) - ly * Math.sin(rad),
        y: el.y + el.height / 2 + lx * Math.sin(rad) + ly * Math.cos(rad),
      };
    };
    const rad = (el.rotation * Math.PI) / 180;
    const rotate = {
      x: el.x + el.width / 2 - Math.sin(rad) * (el.height / 2 + ROTATE_HANDLE_DY),
      y: el.y + el.height / 2 - Math.cos(rad) * (el.height / 2 + ROTATE_HANDLE_DY),
    };
    return {
      'resize-nw': corner(0, 0),
      'resize-ne': corner(1, 0),
      'resize-sw': corner(0, 1),
      'resize-se': corner(1, 1),
      'resize-n': edgeMid('y', 0),
      'resize-s': edgeMid('y', 1),
      'resize-w': edgeMid('x', 0),
      'resize-e': edgeMid('x', 1),
      rotate,
    };
  };

  /* handle positions for the selected main clip, in canvas units */
  const clipHandlePoints = (clip: VideoClip) => {
    const box = clipBoxRect(clip, project.canvas.width, project.canvas.height);
    const rad = (clip.transform.rotation * Math.PI) / 180;
    const rot = (lx: number, ly: number) => ({
      x: box.cx + lx * Math.cos(rad) - ly * Math.sin(rad),
      y: box.cy + lx * Math.sin(rad) + ly * Math.cos(rad),
    });
    return {
      'resize-nw': rot(-box.w / 2, -box.h / 2),
      'resize-ne': rot(box.w / 2, -box.h / 2),
      'resize-sw': rot(-box.w / 2, box.h / 2),
      'resize-se': rot(box.w / 2, box.h / 2),
      'resize-n': rot(0, -box.h / 2),
      'resize-s': rot(0, box.h / 2),
      'resize-w': rot(-box.w / 2, 0),
      'resize-e': rot(box.w / 2, 0),
      rotate: rot(0, -box.h / 2 - ROTATE_HANDLE_DY),
    };
  };

  /** Screen-aware hit tolerance. The visible dot stays compact, but the
      invisible touch target is intentionally large enough for a fingertip. */
  const handleTolerance = () => {
    const canvas = canvasRef.current;
    if (!canvas || previewScale <= 0) return 56;
    return Math.max(HANDLE_PX, 56 / previewScale);
  };

  /* Active touch pointers on the preview. A second finger switches the
     canvas into multi-touch mode and must suspend the one-finger transform
     listener; otherwise the first finger keeps moving/resizing underneath
     pinch/rotate. */
  const canvasMultiTouchRef = useRef(false);

  /* ---------- overlay gestures on the canvas ---------- */
  const beginElementGesture = (el: TimelineElement, gesture: Gesture, e: React.PointerEvent<HTMLElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    e.preventDefault();
    e.stopPropagation();
    setPlaying(false);
    setSelectedElementId(el.id);
    setSelectedClipId(null);

    const start = canvasPoint(e);
    if (!start) return;

    const startX = start.x;
    const startY = start.y;
    const startEl = { ...el };
    const centerX = el.x + el.width / 2;
    const centerY = el.y + el.height / 2;
    const startAngle = Math.atan2(startY - centerY, startX - centerX);
    const keepAspect = el.kind !== 'text';
    const startAspect = el.width / Math.max(1, el.height);
    const minSize = 24;

    const onMove = (ev: PointerEvent) => {
      /* Once a second touch arrives, the mobile gesture recognizer owns the
         interaction. Do not let the original one-finger transform compete. */
      if (ev.pointerType !== 'mouse' && canvasMultiTouchRef.current) return;
      const p = canvasPoint(ev);
      if (!p) return;
      const dx = p.x - startX;
      const dy = p.y - startY;

      if (gesture === 'move') {
        updateElement(
          el.id,
          {
            x: Math.round(clampNum(startEl.x + dx, -startEl.width * 0.75, project.canvas.width - startEl.width * 0.25)),
            y: Math.round(clampNum(startEl.y + dy, -startEl.height * 0.75, project.canvas.height - startEl.height * 0.25)),
          },
          'Move overlay',
          `move-${el.id}`
        );
        return;
      }

      if (isCornerGesture(gesture)) {
        const { sx, sy } = CORNER_SIGNS[gesture];
        const rad = (startEl.rotation * Math.PI) / 180;
        /* pointer delta in the element's rotated frame */
        const lx = dx * Math.cos(rad) + dy * Math.sin(rad);
        const ly = -dx * Math.sin(rad) + dy * Math.cos(rad);
        const nw = Math.max(minSize, startEl.width + sx * lx);
        const nh = keepAspect ? nw / startAspect : Math.max(minSize, startEl.height + sy * ly);
        /* keep the opposite corner visually fixed */
        const ncx = centerX + (sx * lx) / 2;
        const ncy = centerY + (sy * ly) / 2;
        updateElement(
          el.id,
          {
            width: Math.round(nw),
            height: Math.round(nh),
            x: Math.round(ncx - nw / 2),
            y: Math.round(ncy - nh / 2),
          },
          'Resize overlay',
          `size-${el.id}`
        );
        return;
      }

      if (isEdgeGesture(gesture)) {
        const rad = (startEl.rotation * Math.PI) / 180;
        const lx = dx * Math.cos(rad) + dy * Math.sin(rad);
        const ly = -dx * Math.sin(rad) + dy * Math.cos(rad);
        let nw = startEl.width;
        let nh = startEl.height;
        let ncx = centerX;
        let ncy = centerY;
        if (gesture === 'resize-e' || gesture === 'resize-w') {
          nw = Math.max(minSize, startEl.width + lx);
          ncx = centerX + lx / 2;
          if (keepAspect) nh = nw / startAspect;
        } else {
          nh = Math.max(minSize, startEl.height + ly);
          ncy = centerY + ly / 2;
          if (keepAspect) nw = nh * startAspect;
        }
        updateElement(
          el.id,
          { width: Math.round(nw), height: Math.round(nh), x: Math.round(ncx - nw / 2), y: Math.round(ncy - nh / 2) },
          'Resize overlay',
          `size-${el.id}`
        );
        return;
      }

      /* rotate */
      const angle = Math.atan2(p.y - centerY, p.x - centerX);
      let deg = startEl.rotation + ((angle - startAngle) * 180) / Math.PI;
      const snapped = Math.round(deg / 15) * 15;
      if (Math.abs(deg - snapped) < 4) deg = snapped; // magnetic 15° snap
      updateElement(el.id, { rotation: Math.round(deg) }, 'Rotate overlay', `rot-${el.id}`);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  /* ---------- main-clip gestures on the canvas ----------
     The clip is represented by its rendered box (cover-fit × scale ×
     axis-scale, offset from center). Move = offset_x/y, corner =
     uniform scale, edges = scale_x/scale_y, top handle = rotation.
     The same numbers drive the export, so the box IS the truth. */
  const beginClipGesture = (clip: VideoClip, gesture: Gesture, e: React.PointerEvent<HTMLElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    e.preventDefault();
    e.stopPropagation();
    setPlaying(false);
    setSelectedClipId(clip.id);
    setSelectedElementId(null);

    const start = canvasPoint(e);
    if (!start) return;

    const startX = start.x;
    const startY = start.y;
    const startClip = { ...clip, transform: { ...clip.transform } };
    const box = clipBoxRect(startClip, project.canvas.width, project.canvas.height);
    const rad = (startClip.transform.rotation * Math.PI) / 180;
    const startAngle = Math.atan2(startY - box.cy, startX - box.cx);

    const onMove = (ev: PointerEvent) => {
      /* A second touch hands the interaction to useMobileGestures. */
      if (ev.pointerType !== 'mouse' && canvasMultiTouchRef.current) return;
      const p = canvasPoint(ev);
      if (!p) return;
      const dx = p.x - startX;
      const dy = p.y - startY;
      const T = startClip.transform;

      if (gesture === 'move') {
        /* keep ≥25% of the box visible on either axis */
        const ncx = clampNum(box.cx + dx, -box.w * 0.25, project.canvas.width + box.w * 0.25);
        const ncy = clampNum(box.cy + dy, -box.h * 0.25, project.canvas.height + box.h * 0.25);
        updateClip(
          clip.id,
          {
            transform: {
              ...T,
              offset_x: Math.round(ncx - project.canvas.width / 2),
              offset_y: Math.round(ncy - project.canvas.height / 2),
            },
          },
          'Move video',
          `cmove-${clip.id}`
        );
        return;
      }

      if (isCornerGesture(gesture)) {
        /* uniform scale: pointer distance from center vs at start */
        const d0 = Math.hypot(startX - box.cx, startY - box.cy);
        const d1 = Math.hypot(p.x - box.cx, p.y - box.cy);
        const r = clampNum(d1 / Math.max(8, d0), 0.1, 4);
        updateClip(
          clip.id,
          { transform: { ...T, scale: clampNum(T.scale * r, 0.1, 4) } },
          'Scale video',
          `cscale-${clip.id}`
        );
        return;
      }

      if (isEdgeGesture(gesture)) {
        /* stretch one axis in the clip's rotated frame */
        const dx0 = startX - box.cx;
        const dy0 = startY - box.cy;
        const l0x = dx0 * Math.cos(rad) + dy0 * Math.sin(rad);
        const l0y = -dx0 * Math.sin(rad) + dy0 * Math.cos(rad);
        const l1x = (p.x - box.cx) * Math.cos(rad) + (p.y - box.cy) * Math.sin(rad);
        const l1y = -(p.x - box.cx) * Math.sin(rad) + (p.y - box.cy) * Math.cos(rad);
        if (gesture === 'resize-e' || gesture === 'resize-w') {
          const r = clampNum(Math.abs(l1x) / Math.max(8, Math.abs(l0x)), 0.05, 4);
          updateClip(clip.id, { transform: { ...T, scale_x: clampNum(T.scale_x * r, 0.05, 4) } }, 'Stretch video', `csx-${clip.id}`);
        } else {
          const r = clampNum(Math.abs(l1y) / Math.max(8, Math.abs(l0y)), 0.05, 4);
          updateClip(clip.id, { transform: { ...T, scale_y: clampNum(T.scale_y * r, 0.05, 4) } }, 'Stretch video', `csy-${clip.id}`);
        }
        return;
      }

      /* rotate */
      const angle = Math.atan2(p.y - box.cy, p.x - box.cx);
      let deg = startClip.transform.rotation + ((angle - startAngle) * 180) / Math.PI;
      const snapped = Math.round(deg / 15) * 15;
      if (Math.abs(deg - snapped) < 4) deg = snapped;
      updateClip(clip.id, { transform: { ...T, rotation: Math.round(deg) } }, 'Rotate video', `crot-${clip.id}`);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const canvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (e.pointerType !== 'mouse' && canvasMultiTouchRef.current) {
      /* Multi-touch is owned exclusively by useMobileGestures. */
      return;
    }

    if (cropMode) return; // the crop overlay owns every gesture
    const p = canvasPoint(e);
    if (!p) return;
    const tol = handleTolerance();

    /* 1) handles of the current MAIN-clip selection win */
    if (selectedClip) {
      const pts = clipHandlePoints(selectedClip);
      for (const g of ['resize-nw', 'resize-ne', 'resize-sw', 'resize-se', 'resize-n', 'resize-s', 'resize-w', 'resize-e', 'rotate'] as Gesture[]) {
        const pt = pts[g as keyof typeof pts];
        if (pt && Math.hypot(p.x - pt.x, p.y - pt.y) <= tol) {
          beginClipGesture(selectedClip, g, e);
          return;
        }
      }
    }

    /* 2) handles of the current overlay selection */
    if (selectedElement) {
      const el = selectedElement;
      const pts = elementHandlePoints(el);
      for (const g of ['resize-nw', 'resize-ne', 'resize-sw', 'resize-se', 'resize-n', 'resize-s', 'resize-w', 'resize-e', 'rotate'] as Gesture[]) {
        const pt = pts[g as keyof typeof pts];
        if (pt && Math.hypot(p.x - pt.x, p.y - pt.y) <= tol) {
          beginElementGesture(el, g, e);
          return;
        }
      }
    }

    /* 3) tap/drag any overlay under the finger — topmost wins */
    const hit = elementAt(p.x, p.y);
    if (hit) {
      beginElementGesture(hit, 'move', e);
      return;
    }

    /* 4) the main video's body — select + move */
    const clipHit = clipAt(p.x, p.y);
    if (clipHit) {
      beginClipGesture(clipHit, 'move', e);
      return;
    }

    /* 5) empty canvas — drop the selection */
    setSelectedElementId(null);
    setSelectedClipId(null);
  };

  const canvasPointerUp = (_e: React.PointerEvent<HTMLCanvasElement>) => {};

  /* Mobile direct-manipulation gestures.
     One finger stays on the existing move/resize/rotate path.
     Two fingers add pinch-to-scale, rotate-to-rotate, and pan-to-move.
     The gesture helper only listens to touch/stylus pointers, so desktop
     mouse interaction remains unchanged. */
  useMobileGestures(canvasRef, {
    onMultiTouchStart: () => { canvasMultiTouchRef.current = true; },
    onMultiTouchEnd: () => { canvasMultiTouchRef.current = false; },
    onPinch: (scale, center) => {
      if (cropMode) return;

      /* If the user starts a two-finger gesture before a selection exists,
         resolve the object directly under the pinch center. This makes
         two-finger resize work without requiring a separate tap first. */
      let activeElement = docRef.current.project.elements.find((el) => el.id === selectedElementId) ?? null;
      let activeClip = docRef.current.project.clips.find((item) => item.id === selectedClipId) ?? null;

      if (!activeElement && !activeClip) {
        const p = canvasPoint({ clientX: center.x, clientY: center.y });
        if (p) {
          activeElement = elementAt(p.x, p.y);
          if (activeElement) {
            setSelectedElementId(activeElement.id);
            setSelectedClipId(null);
          } else {
            activeClip = clipAt(p.x, p.y);
            if (activeClip) {
              setSelectedClipId(activeClip.id);
              setSelectedElementId(null);
            }
          }
        }
      }

      const factor = clampNum(scale, 0.70, 1.30);

      if (activeElement) {
        const element = activeElement;
        const centerX = element.x + element.width / 2;
        const centerY = element.y + element.height / 2;
        const width = clampNum(element.width * factor, 24, 1400);
        const height = clampNum(element.height * factor, 24, 1400);
        updateElement(
          element.id,
          {
            width: Math.round(width),
            height: Math.round(height),
            x: Math.round(centerX - width / 2),
            y: Math.round(centerY - height / 2),
          },
          'Pinch resize overlay',
          `pinch-size-${element.id}`,
        );
        return;
      }

      const clip = activeClip;
      if (clip) {
        updateClip(
          clip.id,
          { transform: { ...clip.transform, scale: clampNum(clip.transform.scale * factor, 0.1, 4) } },
          'Pinch resize video',
          `pinch-scale-${clip.id}`,
        );
      }
    },
    onRotate: (degrees) => {
      if (cropMode) return;
      const element = docRef.current.project.elements.find((el) => el.id === selectedElementId);
      if (element) {
        const rotation = Math.round(element.rotation + degrees);
        updateElement(element.id, { rotation }, 'Two-finger rotate overlay', `pinch-rotate-${element.id}`);
        return;
      }

      const clip = docRef.current.project.clips.find((item) => item.id === selectedClipId);
      if (clip) {
        const rotation = Math.round(clip.transform.rotation + degrees);
        updateClip(
          clip.id,
          { transform: { ...clip.transform, rotation } },
          'Two-finger rotate video',
          `pinch-rotate-clip-${clip.id}`,
        );
      }
    },
    onTwoFingerPan: (delta) => {
      if (cropMode) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const scaleX = project.canvas.width / rect.width;
      const scaleY = project.canvas.height / rect.height;

      const element = docRef.current.project.elements.find((el) => el.id === selectedElementId);
      if (element) {
        updateElement(
          element.id,
          {
            x: Math.round(element.x + delta.x * scaleX),
            y: Math.round(element.y + delta.y * scaleY),
          },
          'Two-finger move overlay',
          `pinch-pan-${element.id}`,
        );
        return;
      }

      const clip = docRef.current.project.clips.find((item) => item.id === selectedClipId);
      if (clip) {
        updateClip(
          clip.id,
          {
            transform: {
              ...clip.transform,
              offset_x: Math.round(clip.transform.offset_x + delta.x * scaleX),
              offset_y: Math.round(clip.transform.offset_y + delta.y * scaleY),
            },
          },
          'Two-finger move video',
          `pinch-pan-clip-${clip.id}`,
        );
      }
    },
    onLongPress: (point) => {
      if (cropMode) return;
      const p = canvasPoint({ clientX: point.x, clientY: point.y });
      if (!p) return;
      const hit = elementAt(p.x, p.y);
      if (hit) {
        setSelectedElementId(hit.id);
        setSelectedClipId(null);
        setSelectedAudioId(null);
        return;
      }
      const clip = clipAt(p.x, p.y);
      if (clip) {
        setSelectedClipId(clip.id);
        setSelectedElementId(null);
        setSelectedAudioId(null);
      }
    },
  }, !cropMode);

  /* live canvas scale for screen-space selection handles */
  const [previewScale, setPreviewScale] = useState(0);
  const [previewSize, setPreviewSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const update = () => {
      const stage = stageRef.current;
      const maxW = Math.max(240, Math.min((stage?.clientWidth ?? window.innerWidth) - 24, window.innerWidth * 0.94));
      const maxH = Math.max(180, Math.min(window.innerHeight * 0.52, 620));
      const scale = Math.min(maxW / project.canvas.width, maxH / project.canvas.height);
      setPreviewSize({ width: Math.max(1, Math.round(project.canvas.width * scale)), height: Math.max(1, Math.round(project.canvas.height * scale)) });
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0) setPreviewScale(rect.width / project.canvas.width);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(canvas);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [project.canvas.width, project.canvas.height]);

  /* ---------- CROP MODE ----------
     Real source crop stored as source fractions. The overlay shows the
     clip/media's FULL frame box; you move/resize the bright inner region;
     every change re-renders the live preview through drawFrame() so the
     crop is exact before you commit. Cancel restores the starting crop. */
  const startClipCrop = () => {
    if (!selectedClip) return;
    setPlaying(false);
    setCropMode({ type: 'clip', id: selectedClip.id, initial: selectedClip.transform.crop });
    openTool('crop');
  };

  const startElementCrop = () => {
    if (!selectedElement) return;
    setPlaying(false);
    setCropMode({ type: 'element', id: selectedElement.id, initial: selectedElement.crop ?? null });
    openTool('crop');
  };

  const applyCropChange = (next: CropRect | null) => {
    if (!cropMode) return;
    if (cropMode.type === 'clip') {
      const clip = docRef.current.project.clips.find((c) => c.id === cropMode.id);
      if (!clip) return;
      updateClip(clip.id, { transform: { ...clip.transform, crop: next } }, next ? 'Crop video' : 'Reset crop', `crop-${clip.id}`);
    } else {
      const el = docRef.current.project.elements.find((x) => x.id === cropMode.id);
      if (!el) return;
      updateElement(el.id, { crop: next }, next ? 'Crop media' : 'Reset crop', `crop-${el.id}`);
    }
  };

  const cancelCrop = () => {
    if (!cropMode) return;
    applyCropChange(cropMode.initial);
    setCropMode(null);
  };


  /* ---------- PRO CROP WORKSPACE ----------
     Crop editing is deliberately separated from the normal Effects/Overlay
     inspector. The crop window remains directly manipulable on the preview,
     while this panel provides exact aspect presets, numeric edge controls,
     straighten/rotation, flips and quick framing actions. */
  const currentCrop: CropRect | null = cropMode
    ? cropMode.type === 'clip'
      ? project.clips.find((c) => c.id === cropMode.id)?.transform.crop ?? null
      : project.elements.find((el) => el.id === cropMode.id)?.crop ?? null
    : null;

  const cropSourceAspect = useMemo(() => {
    if (!cropMode) return project.canvas.width / Math.max(1, project.canvas.height);
    if (cropMode.type === 'clip') {
      const clip = project.clips.find((c) => c.id === cropMode.id);
      return clip?.source_width && clip?.source_height
        ? clip.source_width / clip.source_height
        : project.canvas.width / Math.max(1, project.canvas.height);
    }
    const el = project.elements.find((x) => x.id === cropMode.id);
    return el ? el.width / Math.max(1, el.height) : project.canvas.width / Math.max(1, project.canvas.height);
  }, [cropMode, project.canvas.height, project.canvas.width, project.clips, project.elements]);

  const setCropRotation = (rotation: number) => {
    if (!cropMode) return;
    if (cropMode.type === 'clip') {
      const clip = docRef.current.project.clips.find((c) => c.id === cropMode.id);
      if (clip) updateClip(clip.id, { transform: { ...clip.transform, rotation }, }, 'Straighten video', `crop-rotate-${clip.id}`);
    } else {
      const el = docRef.current.project.elements.find((x) => x.id === cropMode.id);
      if (el) updateElement(el.id, { rotation }, 'Straighten media', `crop-rotate-${el.id}`);
    }
  };

  const setCropFlip = (axis: 'horizontal' | 'vertical') => {
    if (!cropMode) return;
    if (cropMode.type === 'clip') {
      const clip = docRef.current.project.clips.find((c) => c.id === cropMode.id);
      if (clip) updateClip(clip.id, { transform: { ...clip.transform, [axis === 'horizontal' ? 'flip_h' : 'flip_v']: !clip.transform[axis === 'horizontal' ? 'flip_h' : 'flip_v'] } }, `Flip video ${axis}`);
    } else {
      const el = docRef.current.project.elements.find((x) => x.id === cropMode.id);
      if (el) updateElement(el.id, { [axis === 'horizontal' ? 'flip_h' : 'flip_v']: !el[axis === 'horizontal' ? 'flip_h' : 'flip_v'] }, `Flip media ${axis}`);
    }
  };

  const cropToAspect = (targetAspect: number | null) => {
    if (!cropMode) return;
    if (targetAspect == null) {
      applyCropChange(null);
      return;
    }
    const existing = currentCrop ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const currentAspect = croppedAspect(cropSourceAspect, existing);
    if (!Number.isFinite(targetAspect) || targetAspect <= 0) return;
    let next = { ...existing };
    if (Math.abs(currentAspect - targetAspect) < 0.001) return;
    if (currentAspect > targetAspect) {
      /* Too wide: remove width symmetrically until target is reached. */
      const visibleW = 1 - existing.left - existing.right;
      const visibleH = 1 - existing.top - existing.bottom;
      const wantedW = (targetAspect * visibleH) / Math.max(0.001, cropSourceAspect);
      const remove = Math.max(0, visibleW - wantedW);
      next.left = existing.left + remove / 2;
      next.right = existing.right + remove / 2;
    } else {
      /* Too tall: remove height symmetrically until target is reached. */
      const visibleW = 1 - existing.left - existing.right;
      const visibleH = 1 - existing.top - existing.bottom;
      const wantedH = (visibleW * cropSourceAspect) / targetAspect;
      const remove = Math.max(0, visibleH - wantedH);
      next.top = existing.top + remove / 2;
      next.bottom = existing.bottom + remove / 2;
    }
    applyCropChange(sanitizeCrop(next));
  };

  /* close crop mode if its target disappeared (deleted / moved tracks) */
  useEffect(() => {
    if (!cropMode) return;
    const exists =
      cropMode.type === 'clip'
        ? docRef.current.project.clips.some((c) => c.id === cropMode.id)
        : docRef.current.project.elements.some((el) => el.id === cropMode.id);
    if (!exists) setCropMode(null);
  }, [project.clips, project.elements, cropMode]);

  /** Full-frame box used as the crop editing surface. */
  const cropBaseRect = (): { left: number; top: number; width: number; height: number } | null => {
    if (!cropMode) return null;
    const W = project.canvas.width;
    const H = project.canvas.height;
    if (cropMode.type === 'clip') {
      const clip = project.clips.find((c) => c.id === cropMode.id);
      if (!clip) return null;
      const srcAspect =
        clip.source_width && clip.source_height ? clip.source_width / clip.source_height : W / H;
      const cover = coverFit(W, H, srcAspect);
      return { left: (W - cover.w) / 2, top: (H - cover.h) / 2, width: cover.w, height: cover.h };
    }
    /*
     * The crop surface for media overlays must mirror the RENDERER's source
     * mapping: fractions are relative to the SOURCE FRAME and the drawn area
     * is fitIntoBox(sw, sh, el.width, el.height, object_fit). Computing the
     * base from the element box alone misaligned handles vs pixels whenever
     * the source aspect differed from the box (the classic "crop selects the
     * wrong region" bug for contain-fit overlays).
     */
    const el = project.elements.find((x) => x.id === cropMode.id);
    if (!el) return null;
    if (el.kind === 'text' || el.kind === 'sticker' || el.kind === 'shape') {
      return { left: el.x, top: el.y, width: el.width, height: el.height };
    }
    const mediaAspect = mediaAspectRef.current.get(el.src || '') ?? (el.width / Math.max(1, el.height));
    const fit = el.object_fit === 'cover' ? 'cover' : 'contain';
    const drawn = fit === 'cover'
      ? fitIntoBox(1, mediaAspect, el.width, el.height, 'cover')
      : fitIntoBox(mediaAspect, 1, el.width, el.height, 'contain');
    return { left: el.x + (el.width - drawn.dw) / 2, top: el.y + (el.height - drawn.dh) / 2, width: Math.max(8, drawn.dw), height: Math.max(8, drawn.dh) };
  };

  /* ---------- audio ---------- */
  type SoundBrowserItem = {
    id: string;
    title: string;
    artist: string;
    url: string;
    duration_seconds: number;
    category: string;
    license?: string;
    source?: string;
    tags?: string[];
    description?: string;
    provider?: 'library' | 'freesound';
  };

  const [sounds, setSounds] = useState<SoundBrowserItem[]>([]);
  const [soundQuery, setSoundQuery] = useState('');
  const [soundCategory, setSoundCategory] = useState('Cinematic');
  const [soundProvider, setSoundProvider] = useState<'library' | 'freesound'>('library');
  const [soundPage, setSoundPage] = useState(1);
  const [soundPages, setSoundPages] = useState(1);
  const [soundCount, setSoundCount] = useState(0);
  const [soundBusy, setSoundBusy] = useState(false);
  const [previewingSoundId, setPreviewingSoundId] = useState<string | null>(null);
  const soundPreviewRef = useRef<HTMLAudioElement | null>(null);

  const toggleSoundPreview = useCallback((sound: SoundBrowserItem) => {
    const current = soundPreviewRef.current;
    if (current && previewingSoundId === sound.id) {
      current.pause();
      current.currentTime = 0;
      soundPreviewRef.current = null;
      setPreviewingSoundId(null);
      return;
    }

    if (current) {
      current.pause();
      current.currentTime = 0;
    }

    const audio = new Audio(sound.url);
    audio.preload = 'auto';
    audio.onended = () => {
      if (soundPreviewRef.current === audio) {
        soundPreviewRef.current = null;
        setPreviewingSoundId(null);
      }
    };
    audio.onerror = () => {
      if (soundPreviewRef.current === audio) {
        soundPreviewRef.current = null;
        setPreviewingSoundId(null);
      }
      notify('Sound preview could not be loaded.');
    };
    soundPreviewRef.current = audio;
    setPreviewingSoundId(sound.id);
    void audio.play().catch(() => {
      if (soundPreviewRef.current === audio) {
        soundPreviewRef.current = null;
        setPreviewingSoundId(null);
      }
    });
  }, [notify, previewingSoundId]);

  useEffect(() => () => {
    soundPreviewRef.current?.pause();
    soundPreviewRef.current = null;
  }, []);

  const soundCategories = [
    'Cinematic', 'Ambient', 'Nature', 'City', 'Footsteps',
    'Whoosh', 'Impact', 'Foley', 'UI', 'Crowd',
  ];

  const loadSounds = async () => {
    if (sounds.length || soundBusy) return;
    setSoundBusy(true);
    const { data } = await supabase
      .from('sounds')
      .select('id, title, artist, url, duration_seconds, category')
      .order('plays', { ascending: false })
      .limit(30);
    setSounds((data || []) as SoundBrowserItem[]);
    setSoundBusy(false);
  };

  const searchFreesound = async (
    query = soundQuery,
    page = 1,
    append = false,
    category = soundCategory
  ) => {
    setSoundBusy(true);
    try {
      const terms = [query.trim(), category !== 'All' ? category : '']
        .filter(Boolean)
        .join(' ')
        .trim() || 'cinematic';

      const params = new URLSearchParams({
        q: terms,
        page: String(page),
        page_size: '24',
      });
      const res = await fetch('/api/studio/sounds?' + params.toString(), { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load Freesound results.');

      const mapped: SoundBrowserItem[] = (json.results || []).map((s: any) => ({
        id: `freesound-${s.id}`,
        title: s.name,
        artist: s.username || 'Freesound creator',
        url: s.url,
        duration_seconds: Number(s.duration || 15),
        category: category || 'Freesound',
        license: s.license,
        source: s.source,
        tags: Array.isArray(s.tags) ? s.tags : [],
        description: s.description || '',
        provider: 'freesound',
      }));

      setSounds((prev) => append ? [...prev, ...mapped] : mapped);
      setSoundPage(Number(json.page) || page);
      setSoundPages(Number(json.pages) || 1);
      setSoundCount(Number(json.count) || mapped.length);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not load Freesound results.');
    } finally {
      setSoundBusy(false);
    }
  };

  useEffect(() => {
    if (tool === 'audio' && soundProvider === 'library') void loadSounds();
    if (tool === 'audio' && soundProvider === 'freesound' && sounds.length === 0) {
      void searchFreesound('', 1, false, soundCategory);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, soundProvider]);

  const addSoundTrack = (
    s: {
      title: string;
      url: string;
      duration_seconds: number;
      provider?: AudioTrack['provider'];
      sourceUrl?: string;
      license?: string;
      creator?: string;
    },
    kind: 'music' | 'voiceover'
  ) => {
    const track: AudioTrack = {
      id: makeVideoId('aud'),
      name: s.title,
      src: s.url,
      provider: s.provider,
      sourceUrl: s.sourceUrl,
      license: s.license,
      creator: s.creator,
      start: 0,
      sourceDuration: Math.max(0.1, Number(s.duration_seconds) || 15),
      trimStart: 0,
      trimEnd: Math.max(1, Math.min(Number(s.duration_seconds) || 15, duration || Number(s.duration_seconds) || 15)),
      volume: 0.8,
      fadeIn: 0.5,
      fadeOut: 1,
      kind,
    };
    updateProject((p) => {
      const end = track.start + Math.max(0.1, track.trimEnd - track.trimStart);
      const audioTracks = p.tracks.filter((t) => t.kind === 'audio').sort((x, y) => x.order - y.order);
      /* Never place new audio on a muted lane. Existing clips remain independent. */
      let target = audioTracks.find((lane) => !lane.locked && !lane.muted && p.audio.every((a) => {
        if ((a.track_id || audioTracks[0]?.id) !== lane.id) return true;
        const aEnd = a.start + Math.max(0.1, a.trimEnd - a.trimStart);
        return end <= a.start || track.start >= aEnd;
      }));

      let tracks = p.tracks;
      if (!target) {
        const nextNumber = audioTracks.length + 1;
        target = {
          id: makeVideoId('track'),
          name: `A${nextNumber}`,
          kind: 'audio' as const,
          order: p.tracks.length,
          muted: false,
          locked: false,
          solo: false,
        };
        tracks = [...p.tracks, target];
      }

      return {
        ...p,
        tracks,
        audio: [...p.audio, { ...track, track_id: target.id }],
      };
    }, 'Add audio');
    setSelectedClipId(null);
    setSelectedElementId(null);
    setSelectedAudioId(track.id);
    notify(`“${s.title}” added to the timeline.`);
  };

  const updateAudio = (id: string, patch: Partial<AudioTrack>, label: string, coalesceKey?: string) => {
    updateProject((p) => ({ ...p, audio: p.audio.map((a) => (a.id === id ? { ...a, ...patch } : a)) }), label, coalesceKey);
  };

  /* voiceover recording */
  const [recording, setRecording] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);

  const startVoiceover = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: mime || 'audio/webm' });
        if (meId) {
          const file = new File([blob], `voiceover-${Date.now()}.webm`, { type: blob.type });
          try {
            const mediaUrl = await uploadStudioMedia(file);
            /* measure the real recording duration instead of guessing */
            const dur = await new Promise<number>((res) => {
              const a = document.createElement('audio');
              a.onloadedmetadata = () => res(Number.isFinite(a.duration) && a.duration > 0 ? a.duration : 30);
              a.onerror = () => res(30);
              a.src = URL.createObjectURL(blob);
            });
            addSoundTrack({ title: 'Voiceover', url: mediaUrl, duration_seconds: dur }, 'voiceover');
            notify('Voiceover added to the timeline.');
          } catch {
            notify('Could not save the voiceover — the upload failed. Try again.');
          }
        }
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      notify('Microphone permission denied.');
    }
  };

  const stopVoiceover = () => {
    recRef.current?.stop();
    recRef.current = null;
    setRecording(false);
  };

  /* ---------- export ---------- */
  const [exportSettings, setExportSettings] = useState<ExportSettings | null>(null);
  const settings: ExportSettings = exportSettings ?? defaultExportSettings(project);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false);
  exportingRef.current = exporting;
  const exportUrlRef = useRef<string | null>(null);

  /* free the previous preview URL when a new export replaces it, and on
     unmount — object URLs otherwise leak for the life of the tab */
  useEffect(() => {
    return () => {
      if (exportUrlRef.current) URL.revokeObjectURL(exportUrlRef.current);
    };
  }, []);

  const runExport = async () => {
    if (!meId || exporting) return;
    setExportResult(null);
    setExportError(null);
    setExportProgress({ phase: 'preparing', percent: 0, message: 'Checking project…' });

    /* validate BEFORE recording so users get a clear reason, not a dead webm */
    const invalid = rendererRef.current.validateForExport(project);
    if (invalid) {
      setExportProgress({ phase: 'failed', percent: 100, message: invalid });
      setExportError(invalid);
      return;
    }

    /* pending edits MUST reach the database before rendering */
    const saved = await saveNow();
    if (!saved) {
      const msg = 'Your project could not be saved — fix the save error before exporting.';
      setExportProgress({ phase: 'failed', percent: 100, message: msg });
      setExportError(msg);
      return;
    }

    setExporting(true);
    try {
      const result = await rendererRef.current.export(project, settings, setExportProgress);

      // upload + register in the media library (reusable, not duplicated)
      // Normalize the MIME: MediaRecorder emits codec-suffixed types like
      // "video/webm;codecs=vp9,opus" which storage validation must strip —
      // passing them through raw makes the upload "Unsupported file type".
      setExportProgress({ phase: 'uploading', percent: 99, message: 'Uploading to your library…' });
      const ext = result.format === 'mp4' ? 'mp4' : 'webm';
      const bareType = (result.blob.type || 'video/webm').split(';')[0].trim().toLowerCase();
      const file = new File([result.blob], `export-${Date.now()}.${ext}`, { type: bareType });
      const mediaUrl = await uploadStudioMedia(file);
      const up = { path: mediaUrl.split('/studio-media/').pop() || '' };

      const { error: libError } = await supabase.from('media_library').insert({
        user_id: meId,
        bucket: 'studio-media',
        path: up.path,
        url: mediaUrl,
        media_type: 'video',
        size_bytes: result.blob.size,
        duration_seconds: result.durationSeconds,
        width: result.width,
        height: result.height,
        source: 'export',
        video_project_id: savedProjectId,
      });
      if (libError) notify(`Export saved, but it could not be added to your media library — ${libError.message}`);

      if (savedProjectId) {
        const { error: updError } = await supabase
          .from('video_projects')
          .update({ exported_url: mediaUrl })
          .eq('id', savedProjectId);
        if (updError) notify(`Could not link the export to this project — ${updError.message}`);
      }

      if (exportUrlRef.current) URL.revokeObjectURL(exportUrlRef.current);
      exportUrlRef.current = result.url;
      setExportProgress({ phase: 'complete', percent: 100, message: 'Export complete' });
      setExportResult(result);
      notify('Export saved to your media library.');
    } catch (e) {
      if (e instanceof ExportCancelledError || (e instanceof Error && e.name === 'ExportCancelledError')) {
        setExportProgress({ phase: 'cancelled', percent: 0, message: 'Export cancelled' });
      } else {
        const msg = e instanceof Error ? e.message : 'Render failed — please try again.';
        setExportProgress({ phase: 'failed', percent: 100, message: msg });
        setExportError(msg);
      }
    } finally {
      setExporting(false);
    }
  };

  const postExport = async () => {
    if (!exportResult || !meId) return;
    try {
      const ext = exportResult.format === 'mp4' ? 'mp4' : 'webm';
      const file = new File([exportResult.blob], `post-${Date.now()}.${ext}`, { type: exportResult.blob.type });
      const mediaUrl = await uploadStudioMedia(file);
      const { data, error } = await supabase
        .from('posts')
        .insert({ author_id: meId, content: doc.title, media_url: mediaUrl, media_type: 'video', visibility: 'public' })
        .select('id')
        .single();
      if (!error && data) {
        setSharedPostId(data.id);
        return data.id;
      }
      if (error) notify(`Could not create the post — ${error.message}`);
    } catch (e) {
      notify(`Could not create the post — ${e instanceof Error ? e.message : 'unknown error'}`);
    }
    return null;
  };

  /* insert the finished export into one of my journals as a video element
     (journal undo/redo tracks it like any other element — the journal stores
     the storage URL, never the binary) */
  const [journalPickOpen, setJournalPickOpen] = useState(false);
  const [myJournals, setMyJournals] = useState<{ id: string; title: string }[]>([]);

  /* community sharing of the exported video: it first becomes a feed post,
     then the picker pins that post into one of my joined communities */
  const [sharedPostId, setSharedPostId] = useState<string | null>(null);
  const [communityShareOpen, setCommunityShareOpen] = useState(false);
  const openCommunityShare = async () => {
    if (!exportResult) return;
    if (!sharedPostId) {
      const id = await postExport();
      if (id) setCommunityShareOpen(true);
      return;
    }
    setCommunityShareOpen(true);
  };

  const openJournalPicker = async () => {
    if (!meId) return;
    const { data } = await supabase
      .from('journals')
      .select('id, title')
      .eq('owner_id', meId)
      .order('created_at', { ascending: false })
      .limit(30);
    setMyJournals((data || []) as never);
    setJournalPickOpen((v) => !v);
  };

  const insertIntoJournal = async (journalId: string) => {
    if (!exportResult || !meId) return;
    try {
      // Journals store all elements inside journal_pages.elements (jsonb).
      // Find the last page — or create page 1 for an empty journal.
      let { data: page } = await supabase
        .from('journal_pages')
        .select('id, page_number, elements')
        .eq('journal_id', journalId)
        .order('page_number', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!page) {
        const { data: created, error } = await supabase
          .from('journal_pages')
          .insert({ journal_id: journalId, page_number: 1, elements: [] })
          .select('id, page_number, elements')
          .single();
        if (error) throw error;
        page = created;
      }
      const existing = Array.isArray(page.elements) ? page.elements : [];
      const aspect = exportResult.height / Math.max(1, exportResult.width);
      const element = {
        id: `studio-${crypto.randomUUID()}`,
        type: 'media',
        content: doc.title || 'Studio video',
        media_url: exportResult.url,
        media_type: exportResult.format === 'mp4' ? 'video/mp4' : 'video/webm',
        position_x: 100,
        position_y: 200,
        width: 360,
        height: Math.round(360 * aspect),
        z_index: existing.length + 1,
        opacity: 1,
        rotation: 0,
      };
      const { error } = await supabase
        .from('journal_pages')
        .update({ elements: [...existing, element] })
        .eq('id', page.id);
      if (error) throw error;
      notify('Video added to your journal. 📖');
      setJournalPickOpen(false);
    } catch (e) {
      notify(`Could not add to journal — ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  };

  /* ---------- save as template (creator) ---------- */
  const [tplOpen, setTplOpen] = useState(false);
  const [tplForm, setTplForm] = useState({ title: '', category: 'trending', premium: false, price_cents: 0 });

  /* saveAsTemplate: renders a REAL preview for the reviewer/admin —
     records the timeline through the same renderer as the export
     (MediaRecorder over canvas.captureStream) plus a poster thumbnail,
     uploads both, then inserts the template row. A submission without a
     preview would force the admin to approve blind. */
  const saveAsTemplate = async () => {
    if (!meId) return;
    notify('Rendering template preview…');

    let thumbnailUrl: string | null = null;
    let previewUrl: string | null = null;
    const total = projectDuration(project);

    try {
      if (canvasRef.current && total > 0.2) {
        /* poster: frame at 1s (or mid-point for ultra-short timelines) */
        const shot = canvasRef.current;
        await rendererRef.current.drawFrame(shot, docRef.current.project, Math.min(1, total / 2), { previewing: true, playing: false });
        const blob: Blob = await new Promise((res) => shot.toBlob((b) => res(b!), 'image/jpeg', 0.85));
        if (blob) {
          thumbnailUrl = await uploadStudioMedia(new File([blob], 'thumbnail.jpg', { type: 'image/jpeg' }));
        }

        /* video preview: play the timeline once while recording the canvas */
        if (typeof MediaRecorder !== 'undefined' && shot.captureStream) {
          const stream = (shot as HTMLCanvasElement & { captureStream: (fps: number) => MediaStream }).captureStream(30);
          const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
          if (mime) {
            const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
            const chunks: Blob[] = [];
            rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
            const done = new Promise<void>((res) => (rec.onstop = () => res()));
            rec.start(250);
            const stepT = 1 / 30;
            for (let t = 0; t <= total; t += stepT) {
              await rendererRef.current.drawFrame(shot, docRef.current.project, t, { previewing: true, playing: false });
            }
            rec.stop();
            await done;
            if (chunks.length) {
              const webm = new Blob(chunks, { type: 'video/webm' });
              const up = await uploadFile(new File([webm], 'preview.webm', { type: 'video/webm' }), 'studio-media', meId);
              previewUrl = up.url;
            }
          }
        }
      }
    } catch (e) {
      console.warn('[template] preview generation failed — submitting without it:', e);
    }

    // templates use placeholders so buyers insert their own media
    const tplProject: VideoProject = {
      ...project,
      clips: project.clips.map((c, i) =>
        isPlaceholder(c.src) ? c : { ...c, src: placeholderSrc(i), name: `Media ${i + 1}` }
      ),
      elements: project.elements.filter((el) => el.kind !== 'image' || isPlaceholder(el.src)),
      audio: [],
    };
    const { error } = await supabase.from('templates').insert({
      creator_id: meId,
      title: tplForm.title || doc.title,
      category: tplForm.category,
      project: tplProject,
      aspect_ratio: project.aspect,
      duration_seconds: total,
      thumbnail_url: thumbnailUrl,
      preview_url: previewUrl,
      premium: tplForm.premium,
      price_cents: tplForm.premium ? Math.max(0, tplForm.price_cents) : 0,
      status: 'pending',
    });
    if (error) return notify(`Could not submit the template — ${error.message}`);
    setTplOpen(false);
    notify(previewUrl ? 'Template submitted for review. 🎉' : 'Submitted — but the preview could not be rendered (timeline is empty?).');
  };

  /* ---------- derived ---------- */
  const resolutionOptions = [
    { h: 720, label: '720p', need: 'video.export.standard' as const },
    { h: 1080, label: '1080p', need: 'video.export.standard' as const },
    { h: 1440, label: '1440p HD', need: 'video.export.hd' as const },
    { h: 2160, label: '4K', need: 'video.export.4k' as const },
  ];

  const aspectChoices: { id: AspectRatio; label: string }[] = [
    { id: '9:16', label: '9:16 Reels' },
    { id: '16:9', label: '16:9 YouTube' },
    { id: '1:1', label: '1:1 Square' },
    { id: '4:5', label: '4:5 Feed' },
    { id: '3:2', label: '3:2 Photo' },
    { id: '21:9', label: '21:9 Cinema' },
    { id: 'original', label: 'Original' },
  ];

  const setAspect = (a: AspectRatio) => {
    const canvas = a === 'original' ? project.canvas : { ...CANVAS_SIZES[a] };
    updateProject((p) => ({ ...p, aspect: a, canvas }), 'Change canvas');
  };

  const placeholders = project.clips.filter((c) => isPlaceholder(c.src));

  /* ruler tick step adapts to zoom so labels never collide */
  const tickStep = pxPerSec >= 90 ? 1 : pxPerSec >= 45 ? 2 : 5;
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let t = 0; t <= duration + tickStep; t += tickStep) out.push(Number(t.toFixed(2)));
    return out;
  }, [duration, tickStep]);

  const timelineWidth = Math.max(duration * pxPerSec + 180, 560);

  /* which tool owns the selected overlay's inspector */
  const inspectorTool: Tool = selectedElement?.kind === 'text' ? 'text' : 'overlays';

  /* geometry for the on-canvas clip frame */
  const clipFrame = selectedClip && !playing && !cropMode
    ? clipBoxRect(selectedClip, project.canvas.width, project.canvas.height)
    : null;

  /* Media aspect cache for the crop workspace: crop fractions are relative
     to the SOURCE frame, so the overlay must know each overlay's media
     aspect to place handles over the pixels actually being cropped. */
  const mediaAspectRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const el of project.elements) {
        if (!el.src || mediaAspectRef.current.has(el.src)) continue;
        if (el.kind === 'image' || el.kind === 'gif' || el.kind === 'sticker') {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          try {
            await new Promise<void>((resolve) => {
              img.onload = () => resolve();
              img.onerror = () => resolve();
              img.src = el.src as string;
            });
            if (!cancelled && img.naturalWidth && img.naturalHeight) {
              mediaAspectRef.current.set(el.src, img.naturalWidth / img.naturalHeight);
            }
          } catch { /* aspect stays unknown; box fallback applies */ }
        } else if (el.kind === 'video') {
          try {
            const v = document.createElement('video');
            v.preload = 'metadata';
            v.crossOrigin = 'anonymous';
            await new Promise<void>((resolve) => {
              v.onloadedmetadata = () => resolve();
              v.onerror = () => resolve();
              v.src = el.src as string;
            });
            if (!cancelled && v.videoWidth && v.videoHeight) {
              mediaAspectRef.current.set(el.src, v.videoWidth / v.videoHeight);
            }
          } catch { /* aspect stays unknown; box fallback applies */ }
        }
      }
    })();
    return () => { cancelled = true; };
  }, [project.elements]);

  /* cropBaseRect reads mediaAspectRef, so this must run AFTER the ref
     declaration above — evaluating it earlier threw a TDZ ReferenceError
     that white-screened the editor whenever crop mode opened on a media
     overlay. */
  const cropRect = cropMode ? cropBaseRect() : null;

  /* ================================================================ */

  if (loadError) {
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 bg-[#111111] px-6 text-center text-white">
        <Lock className="h-8 w-8 text-white/50" />
        <p className="text-sm text-white/80">{loadError}</p>
        <Link href="/studio/templates" className="rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-black">
          Browse templates
        </Link>
      </main>
    );
  }

  return (
    <main
      className="flex h-[100dvh] flex-col overflow-hidden bg-[#0d0d0d] text-white"
      data-history-scoped="true"
    >
      {/* fullscreen preview overlay (renders above everything when active) */}
      {fullscreen && (
        <FullscreenPreview
          canvasRef={fsCanvasRef}
          total={duration}
          playing={playing}
          playhead={playhead}
          aspect={project.aspect === 'original' ? `${project.canvas.width}:${project.canvas.height}` : project.aspect}
          onToggle={togglePlay}
          onSeek={seekTo}
          onExit={() => setFullscreen(false)}
        />
      )}
      {/* ---------- top bar ---------- */}
      <header className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2">
        <Link href="/studio" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 focus-visible:ring-2 focus-visible:ring-[#FFB6C1]" aria-label="Back to studio">
          ←
        </Link>
        <input
          value={doc.title}
          onChange={(e) => setDoc({ ...doc, title: e.target.value }, 'Rename project', 'project-title')}
          aria-label="Project title"
          placeholder="Name your project…"
          className="min-w-0 flex-1 rounded-lg bg-transparent px-2 py-1.5 text-sm font-semibold outline-none placeholder:font-normal placeholder:text-white/30 focus:bg-white/10"
        />
        <button onClick={history.undo} disabled={!history.canUndo} aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 focus-visible:ring-2 focus-visible:ring-[#FFB6C1] disabled:opacity-30">
          <Undo2 className="h-4 w-4" />
        </button>
        <button onClick={history.redo} disabled={!history.canRedo} aria-label="Redo (Ctrl+Shift+Z)" title="Redo (Ctrl+Shift+Z)" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 focus-visible:ring-2 focus-visible:ring-[#FFB6C1] disabled:opacity-30">
          <Redo2 className="h-4 w-4" />
        </button>
        <span className="hidden text-[11px] text-white/40 sm:block">
          {saving ? 'Saving…' : history.dirty ? 'Unsaved' : lastSavedAt ? 'Saved' : ''}
        </span>
        <button
          onClick={() => void saveNow()}
          disabled={saving || !history.dirty}
          className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold focus-visible:ring-2 focus-visible:ring-[#FFB6C1] disabled:opacity-40"
          title="Save (Ctrl+S)"
        >
          <Save className="h-3.5 w-3.5" /> Save
        </button>
        <button
          onClick={() => { openTool('export'); }}
          className="flex items-center gap-1.5 rounded-lg bg-[#E5798F] px-3 py-1.5 text-xs font-bold text-white focus-visible:ring-2 focus-visible:ring-white"
          title="Export"
        >
          <Download className="h-3.5 w-3.5" /> Export
        </button>
      </header>

      {/* ---------- scrollable workspace: preview + timeline ----------
          The WHOLE editing area scrolls vertically when the viewport is
          short (landscape phones, small laptops, many timeline lanes) —
          nothing is clipped away, and the page itself never scrolls. */}
      <div
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
        onDragEnter={(e) => {
          if (Array.from(e.dataTransfer.types).includes('Files')) {
            e.preventDefault();
            setFileDragActive(true);
          }
        }}
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.types).includes('Files')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            setFileDragActive(true);
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setFileDragActive(false);
          }
        }}
        onDrop={(e) => {
          if (!Array.from(e.dataTransfer.types).includes('Files')) return;
          e.preventDefault();
          setFileDragActive(false);
          if (e.dataTransfer.files.length) void importFiles(e.dataTransfer.files);
        }}
      >
        {fileDragActive && (
          <div className="pointer-events-none absolute inset-2 z-[70] flex items-center justify-center rounded-2xl border-2 border-dashed border-[#E5798F] bg-[#E5798F]/15 backdrop-blur-sm">
            <div className="rounded-2xl border border-white/20 bg-black/80 px-6 py-5 text-center shadow-2xl">
              <Upload className="mx-auto h-8 w-8 text-[#FFB6C1]" />
              <p className="mt-2 text-sm font-bold">Drop media to import</p>
              <p className="mt-1 text-[11px] text-white/55">Video and image files · originals remain untouched</p>
            </div>
          </div>
        )}
        {/* ---------- preview stage ---------- */}
        <section ref={stageRef} className="shrink-0 px-3 pt-2">
          <div className="mx-auto flex w-fit items-center justify-center">
            <div className="relative overflow-visible rounded-2xl border border-white/10 bg-black shadow-lg">
              {/* enter fullscreen preview */}
              <button
                onClick={() => setFullscreen(true)}
                aria-label="Fullscreen preview"
                title="Fullscreen preview (Esc to exit)"
                className="absolute -top-11 right-0 z-30 flex h-9 items-center gap-1.5 rounded-lg bg-white/10 px-2.5 text-[10px] font-semibold text-white/80 hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-[#FFB6C1]"
              >
                <Maximize2 className="h-4 w-4" /><span className="hidden sm:inline">Fullscreen</span>
              </button>
              <canvas
                ref={canvasRef}
                onPointerDown={canvasPointerDown}
                onPointerUp={canvasPointerUp}
                onPointerCancel={canvasPointerUp}
                className="block select-none bg-black"
                style={{ width: previewSize?.width, height: previewSize?.height, maxWidth: '100%', maxHeight: '100%', touchAction: 'none' }}
                aria-label="Video preview — tap the video or an overlay to select, drag to move, corner to resize, edge to stretch, top handle to rotate"
              />
              {/* selection frame for the MAIN clip — same box the export uses */}
              {clipFrame && previewScale > 0 && selectedClip && (
                <div
                  className="pointer-events-none absolute"
                  style={{
                    left: (clipFrame.cx - clipFrame.w / 2) * previewScale,
                    top: (clipFrame.cy - clipFrame.h / 2) * previewScale,
                    width: clipFrame.w * previewScale,
                    height: clipFrame.h * previewScale,
                    transform: `rotate(${selectedClip.transform.rotation}deg)`,
                    outline: '1.5px dashed rgba(255,182,193,0.95)',
                  }}
                >
                  {/* Real touch targets: the visible dots are only visual. */}
                  {([
                    { gesture: 'resize-nw' as Gesture, cls: '-left-6 -top-6', label: 'Resize video top-left' },
                    { gesture: 'resize-ne' as Gesture, cls: '-right-6 -top-6', label: 'Resize video top-right' },
                    { gesture: 'resize-sw' as Gesture, cls: '-left-6 -bottom-6', label: 'Resize video bottom-left' },
                    { gesture: 'resize-se' as Gesture, cls: '-right-6 -bottom-6', label: 'Resize video bottom-right' },
                    { gesture: 'resize-n' as Gesture, cls: 'left-1/2 -top-6 -translate-x-1/2', label: 'Stretch video top' },
                    { gesture: 'resize-s' as Gesture, cls: 'bottom-[-24px] left-1/2 -translate-x-1/2', label: 'Stretch video bottom' },
                    { gesture: 'resize-w' as Gesture, cls: '-left-6 top-1/2 -translate-y-1/2', label: 'Stretch video left' },
                    { gesture: 'resize-e' as Gesture, cls: 'right-[-24px] top-1/2 -translate-y-1/2', label: 'Stretch video right' },
                  ]).map((h) => (
                    <span
                      key={h.gesture}
                      className={'pointer-events-auto absolute z-40 h-12 w-12 touch-none ' + h.cls}
                      onPointerDown={(e) => beginClipGesture(selectedClip, h.gesture, e)}
                      aria-label={h.label}
                      role="button"
                    />
                  ))}
                  <span
                    className="pointer-events-auto absolute z-40 left-1/2 -top-[58px] h-12 w-12 -translate-x-1/2 touch-none"
                    onPointerDown={(e) => beginClipGesture(selectedClip, 'rotate', e)}
                    aria-label="Rotate video"
                    role="button"
                  />

                  {([
                    { cls: 'left-0 top-0' },
                    { cls: 'right-0 top-0' },
                    { cls: 'left-0 bottom-0' },
                    { cls: 'right-0 bottom-0' },
                  ]).map((c, i) => (
                    <span
                      key={i}
                      className={`absolute h-5 w-5 sm:h-3.5 sm:w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#FFB6C1] shadow ${c.cls}`}
                    />
                  ))}
                  <span className="absolute left-1/2 top-0 h-5 w-5 sm:h-3.5 sm:w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#FFB6C1] shadow" />
                  <span className="absolute bottom-0 left-1/2 h-5 w-5 sm:h-3.5 sm:w-3.5 -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-white bg-[#FFB6C1] shadow" />
                  <span className="absolute left-0 top-1/2 h-5 w-5 sm:h-3.5 sm:w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#FFB6C1] shadow" />
                  <span className="absolute right-0 top-1/2 h-5 w-5 sm:h-3.5 sm:w-3.5 translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#FFB6C1] shadow" />
                  <span className="absolute left-1/2 top-0 flex h-9 w-9 sm:h-7 sm:w-7 -translate-x-1/2 -translate-y-[34px] items-center justify-center rounded-full border-2 border-white bg-[#FFB6C1] shadow">
                    <RotateCw className="h-3.5 w-3.5 text-white" />
                  </span>
                  <span className="absolute -top-5 left-0 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-bold text-white/90">
                    Video
                  </span>
                </div>
              )}

              {/* selection frame + handles for overlays — screen-space overlay
                  matching the canvas box. Positions resolve KEYFRAMES at the
                  playhead (same as drawTextElement/drawVideoElement), so the
                  frame follows animated elements instead of lagging behind at
                  the static x/y. */}
              {selectedElement && previewScale > 0 && !cropMode && (() => {
                const timeIn = Math.max(0, Math.min(selectedElement.end - selectedElement.start, playhead - selectedElement.start));
                const rv = resolveElementValues(selectedElement, timeIn);
                return (
                <div
                  className="pointer-events-none absolute"
                  style={{
                    left: rv.x * previewScale,
                    top: rv.y * previewScale,
                    width: selectedElement.width * rv.scale * previewScale,
                    height: selectedElement.height * rv.scale * previewScale,
                    transform: `rotate(${rv.rotation}deg)`,
                    outline: '1.5px solid rgba(229,121,143,0.95)',
                    outlineOffset: 0,
                  }}
                >
                  {([
                    { gesture: 'resize-nw' as Gesture, cls: '-left-6 -top-6', label: 'Resize overlay top-left' },
                    { gesture: 'resize-ne' as Gesture, cls: '-right-6 -top-6', label: 'Resize overlay top-right' },
                    { gesture: 'resize-sw' as Gesture, cls: '-left-6 -bottom-6', label: 'Resize overlay bottom-left' },
                    { gesture: 'resize-se' as Gesture, cls: '-right-6 -bottom-6', label: 'Resize overlay bottom-right' },
                    { gesture: 'resize-n' as Gesture, cls: 'left-1/2 -top-6 -translate-x-1/2', label: 'Stretch overlay top' },
                    { gesture: 'resize-s' as Gesture, cls: 'bottom-[-24px] left-1/2 -translate-x-1/2', label: 'Stretch overlay bottom' },
                    { gesture: 'resize-w' as Gesture, cls: '-left-6 top-1/2 -translate-y-1/2', label: 'Stretch overlay left' },
                    { gesture: 'resize-e' as Gesture, cls: 'right-[-24px] top-1/2 -translate-y-1/2', label: 'Stretch overlay right' },
                  ]).map((h) => (
                    <span
                      key={h.gesture}
                      className={'pointer-events-auto absolute z-40 h-12 w-12 touch-none ' + h.cls}
                      onPointerDown={(e) => beginElementGesture(selectedElement, h.gesture, e)}
                      aria-label={h.label}
                      role="button"
                    />
                  ))}
                  <span
                    className="pointer-events-auto absolute z-40 left-1/2 -top-[58px] h-12 w-12 -translate-x-1/2 touch-none"
                    onPointerDown={(e) => beginElementGesture(selectedElement, 'rotate', e)}
                    aria-label="Rotate overlay"
                    role="button"
                  />
                  {([
                    { cls: 'left-0 top-0' },
                    { cls: 'right-0 top-0' },
                    { cls: 'left-0 bottom-0' },
                    { cls: 'right-0 bottom-0' },
                  ]).map((c, i) => (
                    <span
                      key={i}
                      className={`absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#E5798F] shadow ${c.cls}`}
                    />
                  ))}
                  <span className="absolute left-1/2 top-0 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#E5798F] shadow" />
                  <span className="absolute bottom-0 left-1/2 h-3.5 w-3.5 -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-white bg-[#E5798F] shadow" />
                  <span className="absolute left-0 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#E5798F] shadow" />
                  <span className="absolute right-0 top-1/2 h-3.5 w-3.5 translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#E5798F] shadow" />
                  <span className="absolute left-1/2 top-0 flex h-9 w-9 sm:h-7 sm:w-7 -translate-x-1/2 -translate-y-[34px] items-center justify-center rounded-full border-2 border-white bg-[#E5798F] shadow">
                    <RotateCw className="h-3.5 w-3.5 text-white" />
                  </span>
                </div>
                );
              })()}

              {cropMode && cropRect && previewScale > 0 && (
                <CropOverlay
                  base={{
                    left: cropRect.left * previewScale,
                    top: cropRect.top * previewScale,
                    width: cropRect.width * previewScale,
                    height: cropRect.height * previewScale,
                  }}
                  crop={
                    cropMode.type === 'clip'
                      ? project.clips.find((c) => c.id === cropMode.id)?.transform.crop ?? null
                      : project.elements.find((el) => el.id === cropMode.id)?.crop ?? null
                  }
                  rotation={cropMode.type === 'clip'
                    ? (project.clips.find((c) => c.id === cropMode.id)?.transform.rotation ?? 0)
                    : (project.elements.find((el) => el.id === cropMode.id)?.rotation ?? 0)}
                  onChange={applyCropChange}
                  onRotate={(degrees) => setCropRotation(degrees)}
                  onApply={() => { setCropMode(null); notify('Crop applied — it renders in the export too.'); }}
                  onCancel={cancelCrop}
                  onReset={() => applyCropChange(null)}
                />
              )}

              {selectedElement && !cropMode && (
                <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-bold text-white/90">
                  Text: drag · corner/edge resize · top rotate
                </span>
              )}

            </div>
          </div>

          {/* crop mode controls stay below the preview so they never cover the media */}
          {cropMode && (
            <CropWorkspace
              crop={currentCrop}
              sourceAspect={cropSourceAspect}
              rotation={cropMode.type === 'clip' ? (project.clips.find((c) => c.id === cropMode.id)?.transform.rotation ?? 0) : (project.elements.find((el) => el.id === cropMode.id)?.rotation ?? 0)}
              onChange={applyCropChange}
              onAspect={cropToAspect}
              onRotate={setCropRotation}
              onFlip={setCropFlip}
              onReset={() => applyCropChange(null)}
              onCancel={cancelCrop}
              onApply={() => { setCropMode(null); notify('Crop applied — all crop and transform settings are preserved.'); }}
            />
          )}

              <p className="mx-auto max-w-md px-2 pb-1 text-center text-[10px] leading-4 text-white/35 sm:hidden">
                Drag to move · pinch to resize · two-finger twist to rotate · long-press to select
              </p>
          {/* transport */}
          <div className="flex items-center justify-center gap-3 py-1.5">
            <button onClick={() => seekTo(playheadRef.current - 1 / 30)} aria-label="Previous frame" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 focus-visible:ring-2 focus-visible:ring-[#FFB6C1]">
              <SkipBack className="h-4 w-4" />
            </button>
            <button onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-black focus-visible:ring-2 focus-visible:ring-[#FFB6C1]">
              {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </button>
            <button onClick={() => seekTo(playheadRef.current + 1 / 30)} aria-label="Next frame" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 focus-visible:ring-2 focus-visible:ring-[#FFB6C1]">
              <SkipForward className="h-4 w-4" />
            </button>
            <span className="w-24 text-center text-xs tabular-nums text-white/70" aria-live="off">
              {fmt(playhead)} / {fmt(duration)}
            </span>
            <button
              onClick={() => stageRef.current?.requestFullscreen?.().catch(() => undefined)}
              aria-label="Fullscreen preview"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 focus-visible:ring-2 focus-visible:ring-[#FFB6C1]"
            >
              <Sparkles className="h-4 w-4" />
            </button>
          </div>

          {/* Minimap — whole project at a glance with a draggable viewport
              window. Content rows are proportional to real times, so long
              edits stay navigable without scrubbing blind. Hidden while the
              project is empty (duration 0). */}
          {duration > 0 && (
            <div
              className="relative mt-1 h-10 select-none overflow-hidden rounded-lg border border-white/10 bg-[#0c0c0c]"
              role="slider"
              aria-label="Timeline minimap"
              aria-valuemin={0}
              aria-valuemax={Math.round(duration)}
              aria-valuenow={Math.round(playhead)}
              aria-valuetext={`Viewing ${fmt(minimapView.left / Math.max(1, minimapView.trackWidth) * duration)} of ${fmt(duration)}`}
              style={{ touchAction: 'none' }}
              onPointerDown={(e) => {
                const el = timelineRef.current;
                if (!el || minimapView.trackWidth <= 0) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = (e.clientX - rect.left) / rect.width;
                const inner = el.firstElementChild as HTMLElement | null;
                const trackWidth = inner ? inner.getBoundingClientRect().width : el.scrollWidth;
                el.scrollLeft = Math.max(0, ratio * trackWidth - el.clientWidth / 2);
                e.currentTarget.setPointerCapture(e.pointerId);
                minimapDragRef.current = true;
              }}
              onPointerMove={(e) => {
                if (!minimapDragRef.current) return;
                const el = timelineRef.current;
                if (!el) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const inner = el.firstElementChild as HTMLElement | null;
                const trackWidth = inner ? inner.getBoundingClientRect().width : el.scrollWidth;
                el.scrollLeft = Math.max(0, ratio * trackWidth - el.clientWidth / 2);
              }}
              onPointerUp={() => { minimapDragRef.current = false; }}
              onPointerCancel={() => { minimapDragRef.current = false; }}
            >
              {/* content bars: main clips / overlays / audio, proportional */}
              <div className="absolute inset-0">
                {project.clips.map((clip) => {
                  let acc = 0;
                  for (const c of project.clips) { if (c.id === clip.id) break; acc += clipDuration(c); }
                  return (
                    <div key={clip.id} className="absolute h-2 rounded-sm bg-[#E5798F]/55" style={{ left: `${(acc / Math.max(duration, 0.001)) * 100}%`, width: `${Math.max(0.4, (clipDuration(clip) / Math.max(duration, 0.001)) * 100)}%`, top: 4 }} />
                  );
                })}
                {project.elements.map((el) => (
                  <div key={el.id} className="absolute h-1.5 rounded-sm bg-[#7b5cff]/60" style={{ left: `${(el.start / Math.max(duration, 0.001)) * 100}%`, width: `${Math.max(0.3, ((el.end - el.start) / Math.max(duration, 0.001)) * 100)}%`, top: 18 }} />
                ))}
                {project.audio.map((a) => {
                  
                  
                  const s = Number(a.start ?? 0);
                  const e2 = Number(a.start ?? 0) + Math.max(0.1, (Number(a.trimEnd) || 0) - (Number(a.trimStart) || 0));
                  return (
                    <div key={a.id} className="absolute h-1.5 rounded-sm bg-emerald-400/50" style={{ left: `${(s / Math.max(duration, 0.001)) * 100}%`, width: `${Math.max(0.3, ((e2 - s) / Math.max(duration, 0.001)) * 100)}%`, top: 30 }} />
                  );
                })}
              </div>
              {/* viewport window */}
              <div
                className="pointer-events-none absolute inset-y-0 rounded-md border-2 border-white/70 bg-white/[0.08]"
                style={{
                  left: `${(minimapView.left / Math.max(1, minimapView.trackWidth)) * 100}%`,
                  width: `${Math.min(100, (minimapView.width / Math.max(1, minimapView.trackWidth)) * 100)}%`,
                }}
              />
              {/* playhead tick inside the minimap */}
              <div className="pointer-events-none absolute inset-y-0 w-px bg-[#FFB6C1]" style={{ left: `${(playhead / Math.max(duration, 0.001)) * 100}%` }} />
            </div>
          )}
        </section>

        {/* ---------- multi-track timeline ---------- */}
        <section className="shrink-0 border-t border-white/10 px-3 pb-1 pt-1.5">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-xs font-bold text-white">
              Timeline
              <span className="ml-2 font-normal text-white/35">drag to reorder · edges trim · tap ruler to seek</span>
            </p>
            <div className="flex items-center gap-1.5">
              <div className="flex items-center overflow-hidden rounded-lg border border-white/15" role="group" aria-label="Timeline zoom">
                <button onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))} disabled={zoom <= 0.5} aria-label="Zoom out" className="px-3 py-1.5 text-xs focus-visible:ring-2 focus-visible:ring-[#FFB6C1] disabled:opacity-40">−</button>
                <span className="px-1 text-[10px] tabular-nums text-white/50">{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.25) * 100) / 100))} disabled={zoom >= 3} aria-label="Zoom in" className="px-3 py-1.5 text-xs focus-visible:ring-2 focus-visible:ring-[#FFB6C1] disabled:opacity-40">+</button>
              </div>
              <button onClick={addEditorTrack} className="flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-[11px] font-semibold hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-[#FFB6C1]">
                <Plus className="h-3.5 w-3.5" /> Track
              </button>
            </div>
          </div>

          {/* scrolls BOTH axes: lanes beyond the fold stay reachable; the
              ruler is sticky so the playhead never scrolls out of view */}
          <div
            ref={timelineRef}
            className="no-scrollbar relative max-h-[38dvh] overflow-x-auto overflow-y-auto overscroll-contain rounded-xl border border-white/10 bg-[#0c0c0c]"
          >
            <div className="relative select-none" style={{ width: timelineWidth, minWidth: '100%' }} onPointerDown={laneTapSeek}>
              {/* ruler + playhead handle (drag to scrub) */}
              <div
                className="sticky top-0 z-40 flex h-6 items-stretch border-b border-white/10 bg-[#0c0c0c]"
                onPointerDown={beginPlayheadDrag}
                style={{ touchAction: 'none' }}
                role="slider"
                aria-label="Playhead position"
                aria-valuemin={0}
                aria-valuemax={Math.round(duration)}
                aria-valuenow={Math.round(playhead)}
                aria-valuetext={fmt(playhead)}
              >
                <div className="sticky left-0 z-10 flex w-16 shrink-0 items-center justify-center border-r border-white/10 bg-[#0c0c0c] text-[9px] font-bold tabular-nums text-[#FFB6C1]">
                  {fmt(playhead)}
                </div>
                <div className="relative flex-1">
                  {ticks.map((t) => (
                    <div key={t} className="absolute top-0 h-full" style={{ left: t * pxPerSec }}>
                      <span className="absolute top-0 h-2 w-px bg-white/25" />
                      <span className="absolute left-1 top-0.5 text-[8px] tabular-nums text-white/35">{fmt(t)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* MAIN track: sequential magnetic lane */}
              <div data-lane-id="__main" className="relative flex h-14 items-stretch border-b border-white/10 bg-white/[0.03]">
                <div className="sticky left-0 z-30 flex w-16 shrink-0 items-center border-r border-white/10 bg-[#111]/95 px-2 text-[9px] font-bold text-white/60 backdrop-blur">MAIN</div>
                <div className="relative flex min-w-0 flex-1 items-stretch gap-1 p-1">
                  {project.clips.map((clip) => {
                    const w = Math.max(42, clipDuration(clip) * pxPerSec);
                    const selected = clip.id === selectedClipId || selectedIds.includes(clip.id);
                    const dragging = clip.id === pointerDragId;
                    return (
                      <div
                        key={clip.id}
                        data-timeline-item="true"
                        onPointerDown={(e) => { if (e.shiftKey || e.ctrlKey || e.metaKey) { toggleSelectedId(clip.id); setSelectedClipId(clip.id); setSelectedElementId(null); return; } setSelectedIds([clip.id]); beginClipDrag(e, clip); }}
                        className={`relative shrink-0 touch-none overflow-hidden rounded-md border transition-shadow ${selected ? 'border-[#E5798F] bg-[#E5798F]/35 ring-1 ring-[#E5798F]/60' : 'border-white/15 bg-white/10'} ${dragging ? 'opacity-80 ring-2 ring-white/40' : 'cursor-grab active:cursor-grabbing'}`}
                        style={{ width: w }}
                        role="button"
                        aria-label={`Clip ${clip.name}, ${fmt(clipDuration(clip))}${selected ? ', selected' : ''}`}
                        aria-pressed={selected}
                        title="Drag to reorder • drag edges to trim"
                      >
                        {/* thumbnail: real first frame / media / glyph */}
                        <div className="pointer-events-none absolute inset-0 opacity-60">
                          <ClipThumb clip={clip} />
                        </div>
                        {/* transition badge */}
                        {clip.transitionIn.type !== 'none' && (
                          <span className="absolute left-0 top-0 z-20 rounded-br bg-[#7b5cff] px-1 py-px text-[7px] font-bold uppercase text-white" title={`Transition in: ${clip.transitionIn.type} (${clip.transitionIn.duration}s)`}>
                            {clip.transitionIn.type === 'crossfade' ? 'x-fade' : clip.transitionIn.type}
                          </span>
                        )}
                        {/* speed badge */}
                        {clip.speed !== 1 && (
                          <span className="absolute right-0 top-0 z-20 rounded-bl bg-black/70 px-1 py-px text-[7px] font-bold text-[#FFB6C1]" title={`Speed ${clip.speed}×`}>
                            {clip.speed}×
                          </span>
                        )}
                        {/* crop badge */}
                        {clip.transform.crop && (
                          <span className="absolute bottom-0 right-0 z-20 rounded-tl bg-black/70 px-1 py-px text-[7px] font-bold text-emerald-300" title="Cropped">
                            crop
                          </span>
                        )}
                        <span className="pointer-events-none absolute inset-x-0 top-1 z-10 block truncate px-2 text-center text-[9px] font-semibold text-white/90 drop-shadow">
                          {isPlaceholder(clip.src) ? '⬚ Placeholder' : clip.name}
                        </span>
                        <span className="pointer-events-none absolute bottom-0.5 left-1.5 z-10 text-[8px] tabular-nums text-white/60">{fmt(clipDuration(clip))}</span>
                        {/* trim handles */}
                        <span
                          data-timeline-handle="true"
                          onPointerDown={(e) => startTrim(e, clip, 'start')}
                          className="absolute inset-y-0 left-0 z-30 w-3.5 sm:w-2.5 cursor-ew-resize touch-none bg-gradient-to-r from-[#FFB6C1]/90 to-transparent"
                          role="slider"
                          aria-label={`Trim start of ${clip.name}`}
                        />
                        <span
                          data-timeline-handle="true"
                          onPointerDown={(e) => startTrim(e, clip, 'end')}
                          className="absolute inset-y-0 right-0 z-30 w-3.5 sm:w-2.5 cursor-ew-resize touch-none bg-gradient-to-l from-[#FFB6C1]/90 to-transparent"
                          role="slider"
                          aria-label={`Trim end of ${clip.name}`}
                        />
                      </div>
                    );
                  })}
                  {project.clips.length === 0 && (
                    <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-white/10 text-[10px] text-white/30">
                      Import a video in Media to start the main track
                    </div>
                  )}
                </div>
              </div>

              {/* Overlay lanes */}
              {project.tracks.map((track) => {
                const items = project.elements.filter((el) => (el.track_id || project.tracks[0]?.id) === track.id);
                /* Auto-collapse: an empty overlay lane shrinks to a slim
                   strip so deletions never leave a stack of ghost lanes.
                   Purely visual — the track and its id stay in the project,
                   it re-expands the moment an element lands on it, and it
                   remains a drop target while collapsed. */
                const collapsed = track.kind === 'overlay' && items.length === 0;
                return (
                  <div
                    key={track.id}
                    data-lane-id={track.id}
                    data-lane-kind="overlay"
                    data-lane-collapsed={collapsed || undefined}
                    className={`group relative flex ${collapsed ? 'h-6' : 'h-11'} items-stretch border-b border-white/10 ${collapsed ? 'bg-transparent' : 'bg-white/[0.015]'} transition-[height] duration-200`}
                  >
                    <div className="sticky left-0 z-30 flex w-16 shrink-0 items-center justify-between border-r border-white/10 bg-[#111]/95 px-1.5 backdrop-blur">
                      <span className={`truncate text-[9px] font-bold ${collapsed ? 'text-white/25' : 'text-white/50'}`}>{track.name}</span>
                       <div className={`flex shrink-0 items-center gap-0.5 ${collapsed ? 'opacity-0 transition-opacity group-hover:opacity-100' : ''}`}>{''}
                         <button onClick={() => toggleTrackFlag(track.id, 'muted')} className={`rounded p-1 ${track.muted ? 'bg-red-500/30 text-red-200' : 'text-white/35 hover:text-white'}`} aria-label={track.muted ? 'Unmute track' : 'Mute track'}>{track.muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}</button>
                         <button onClick={() => toggleTrackFlag(track.id, 'locked')} className={`rounded p-1 ${track.locked ? 'bg-amber-500/30 text-amber-200' : 'text-white/35 hover:text-white'}`} aria-label={track.locked ? 'Unlock track' : 'Lock track'}><Lock className="h-3 w-3" /></button>
                       </div>
                      {project.tracks.length > 1 && (
                        <button onClick={() => deleteEditorTrack(track.id)} className="rounded p-1 text-white/25 hover:text-red-300 focus-visible:ring-2 focus-visible:ring-[#FFB6C1]" title="Remove track" aria-label={`Remove ${track.name}`}>
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <div className="relative flex-1">
                      {items.map((el) => {
                        const selected = el.id === selectedElementId;
                        const dragging = el.id === pointerDragId;
                        return (
                          <div
                            key={el.id}
                            data-timeline-item="true"
                            onPointerDown={(e) => beginOverlayItemDrag(e, el)}
                            className={`absolute top-1 flex h-9 touch-none items-center overflow-hidden rounded border px-1 text-left text-[9px] ${selected ? 'z-20 border-white bg-[#E5798F]/50 ring-1 ring-white/60' : 'z-10 border-white/15 bg-[#7b5cff]/30'} ${dragging ? 'opacity-85 ring-2 ring-white/40' : 'cursor-grab active:cursor-grabbing'}`}
                            style={{ left: el.start * pxPerSec, width: Math.max(14, (el.end - el.start) * pxPerSec) }}
                            role="button"
                            aria-label={`${el.kind} overlay from ${fmt(el.start)} to ${fmt(el.end)}${selected ? ', selected' : ''}`}
                            aria-pressed={selected}
                            title="Drag to move in time or across tracks • edges trim"
                          >
                            <span className="pointer-events-none truncate">
                              {el.kind === 'text' ? `T ${el.content}` : el.kind === 'video' ? 'VIDEO' : el.kind === 'shape' ? 'SHAPE' : 'IMAGE'}
                            </span>
                            <span
                              data-timeline-handle="true"
                              onPointerDown={(e) => beginOverlayItemResize(e, el, 'start')}
                              className="absolute inset-y-0 left-0 z-10 w-3 sm:w-1.5 cursor-ew-resize bg-white/40"
                              role="slider"
                              aria-label="Overlay start"
                            />
                            <span
                              data-timeline-handle="true"
                              onPointerDown={(e) => beginOverlayItemResize(e, el, 'end')}
                              className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-ew-resize bg-white/40"
                              role="slider"
                              aria-label="Overlay end"
                            />
                          </div>
                        );
                      })}
                      {!collapsed && items.length === 0 && (
                        <span className="pointer-events-none absolute left-2 top-3 text-[9px] text-white/20">Drag text, media or video here</span>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Audio lanes: overlapping clips are separated into A1/A2/A3…
                  instead of being painted on top of each other. They still mix
                  acoustically when they overlap; Mute/Solo controls make the
                  audible source explicit. */}
              {project.tracks.filter((track) => track.kind === 'audio').map((track, audioIndex) => {
                const items = project.audio.filter((a) => (a.track_id || project.tracks.find((t) => t.kind === 'audio')?.id) === track.id);
                const soloActive = project.tracks.some((t) => t.kind === 'audio' && t.solo);
                const audible = !track.muted && (!soloActive || !!track.solo);
                return (
                  <div
                    key={track.id}
                    data-lane-id={track.id}
                    data-lane-kind="audio"
                    className={`relative flex h-14 items-stretch border-b border-white/10 ${audible ? 'bg-emerald-500/[0.055]' : 'bg-red-500/[0.025]'}`}
                  >
                    <div className="sticky left-0 z-30 flex w-16 shrink-0 items-center justify-between border-r border-white/10 bg-[#111]/95 px-1.5 backdrop-blur">
                      <div className="min-w-0">
                        <span className={`block text-[9px] font-black ${audible ? 'text-emerald-200' : 'text-red-200/60'}`}>A${audioIndex + 1}</span>
                        <span className="block truncate text-[7px] text-white/30">{items.length ? `${items.length} clip${items.length === 1 ? '' : 's'}` : 'empty'}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          onClick={() => toggleTrackFlag(track.id, 'muted')}
                          className={`rounded p-1 ${track.muted ? 'bg-red-500/30 text-red-200' : 'text-white/35 hover:text-white'}`}
                          aria-label={track.muted ? 'Unmute audio track' : 'Mute audio track'}
                          title={track.muted ? 'Unmute' : 'Mute track'}
                        >
                          {track.muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
                        </button>
                        <button
                          onClick={() => toggleTrackFlag(track.id, 'solo')}
                          className={`rounded px-1 py-0.5 text-[7px] font-black ${track.solo ? 'bg-amber-400 text-black' : 'text-white/35 hover:text-white'}`}
                          aria-label={track.solo ? 'Disable solo' : 'Solo audio track'}
                          title="Solo"
                        >S</button>
                      </div>
                    </div>
                    <div className="relative flex-1 overflow-hidden">
                      {items.map((a) => {
                        const selected = a.id === selectedAudioId;
                        const dragging = a.id === pointerDragId;
                        const clipLen = Math.max(0.1, a.trimEnd - a.trimStart);
                        const fadeIn = Math.min(clipLen / 2, Math.max(0, a.fadeIn));
                        const fadeOut = Math.min(clipLen / 2, Math.max(0, a.fadeOut));
                        const audibleClip = audible && a.volume > 0;
                        const bars = Array.from({ length: 28 }, (_, i) => {
                          const wave = 0.25 + 0.75 * Math.abs(Math.sin((i + a.id.length) * 1.73));
                          return wave;
                        });
                        return (
                          <div
                            key={a.id}
                            data-timeline-item="true"
                            onPointerDown={(ev) => beginAudioDrag(ev, a)}
                            className={`absolute top-1 h-12 touch-none overflow-hidden rounded-lg border px-1 text-left text-[8px] shadow-inner transition ${selected ? 'z-20 border-emerald-100 bg-emerald-500/45 ring-1 ring-emerald-100/70' : audibleClip ? 'z-10 border-emerald-300/30 bg-emerald-500/20' : 'z-10 border-red-300/20 bg-red-500/10 opacity-60'} ${dragging ? 'opacity-85 ring-2 ring-white/40' : 'cursor-grab active:cursor-grabbing'}`}
                            style={{ left: a.start * pxPerSec, width: Math.max(24, clipLen * pxPerSec) }}
                            role="button"
                            aria-label={`${a.kind} ${a.name} on A${audioIndex + 1} from ${fmt(a.start)}${selected ? ', selected' : ''}`}
                            aria-pressed={selected}
                            title="Drag horizontally to move • drag vertically to switch A tracks • edges trim"
                          >
                            <div className="absolute inset-x-0 bottom-0 flex h-5 items-end gap-px px-1 opacity-50">
                              {bars.map((h, i) => <span key={i} className="min-w-px flex-1 rounded-t bg-emerald-100" style={{ height: `${Math.round(h * 100)}%` }} />)}
                            </div>
                            {fadeIn > 0 && <span className="absolute inset-y-0 left-0 w-1/5 bg-gradient-to-r from-white/20 to-transparent" title={`Fade in ${fadeIn.toFixed(1)}s`} />}
                            {fadeOut > 0 && <span className="absolute inset-y-0 right-0 w-1/5 bg-gradient-to-l from-white/20 to-transparent" title={`Fade out ${fadeOut.toFixed(1)}s`} />}
                            <span className="relative z-10 block truncate px-1 pt-1 font-semibold text-emerald-50">{a.kind === 'voiceover' ? 'VO' : '♪'} {a.name}</span>
                            <span className="relative z-10 block truncate px-1 text-[7px] text-white/45">{a.provider || 'audio'} · {Math.round(a.volume * 100)}%</span>
                            <span data-timeline-handle="true" onPointerDown={(ev) => beginAudioResize(ev, a, 'start')} className="absolute inset-y-0 left-0 z-20 w-3 sm:w-2 cursor-ew-resize bg-emerald-200/40" role="slider" aria-label="Audio trim start" />
                            <span data-timeline-handle="true" onPointerDown={(ev) => beginAudioResize(ev, a, 'end')} className="absolute inset-y-0 right-0 z-20 w-2 cursor-ew-resize bg-emerald-200/40" role="slider" aria-label="Audio trim end" />
                          </div>
                        );
                      })}
                      {items.length === 0 && <span className="pointer-events-none absolute left-2 top-5 text-[8px] text-white/20">Drop audio here</span>}
                    </div>
                  </div>
                );
              })}

              {/* detected beat markers */}
              {(project.beatMarkers || []).filter((t) => t >= 0 && t <= duration).map((t) => (
                <button
                  key={t}
                  type="button"
                  className="absolute inset-y-0 z-30 w-px bg-emerald-300/60"
                  style={{ left: LABEL_W + t * pxPerSec }}
                  onClick={() => seekTo(t)}
                  aria-label={'Beat at ' + fmt(t)}
                  title={'Beat ' + fmt(t)}
                />
              ))}

              {/* playhead line across all lanes */}
              <div
                className="pointer-events-none absolute inset-y-0 z-50 w-px bg-[#FFB6C1] shadow-[0_0_8px_rgba(255,182,193,.8)]"
                style={{ left: LABEL_W + playhead * pxPerSec }}
              >
                <div className="absolute -left-1.5 top-0 h-3 w-3 rounded-full bg-[#FFB6C1]" />
              </div>
            </div>
          </div>

          <input
            ref={replaceInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.currentTarget.value = '';
              if (file && selectedClip) void importFiles([file], selectedClip.id);
            }}
          />

          <input
            ref={audioReplaceInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.currentTarget.value = '';
              if (!file || !selectedAudio || !meId) return;
              try {
                const up = await uploadFile(file, 'studio-media', meId);
                const durationSeconds = await new Promise<number>((resolve) => {
                  const audio = document.createElement('audio');
                  audio.preload = 'metadata';
                  audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) ? audio.duration : selectedAudio.sourceDuration || 15);
                  audio.onerror = () => resolve(selectedAudio.sourceDuration || 15);
                  audio.src = URL.createObjectURL(file);
                });
                updateAudio(selectedAudio.id, {
                  src: up.url,
                  name: file.name,
                  sourceDuration: durationSeconds,
                  trimStart: 0,
                  trimEnd: durationSeconds,
                }, 'Replace audio');
                notify('Audio replaced.');
              } catch (error) {
                notify(error instanceof Error ? error.message : 'Audio replacement failed.');
              }
            }}
          />

          {/* Contextual actions are hidden while a tool drawer is open so mobile never has two competing control layers. */}
          {!toolDrawerOpen && (selectedClip || selectedElement || selectedAudio) ? (
            <>
              {/* Mobile: one compact selection toolbar. Major tools stay in the bottom navigation. */}
              <div className="mt-1.5 flex items-center gap-1.5 overflow-x-auto border-t border-white/10 bg-[#101010]/96 px-1.5 py-1.5 backdrop-blur-xl md:hidden" aria-label="Selected item actions">
                {selectedClip && (
                  <>
                    <button onClick={() => openTool('motion')} className={EDITOR_ACTION_PILL} aria-label="Frame tools"><Sparkles className="h-4 w-4" />Frame</button>
                    <button onClick={() => openTool('look')} className={EDITOR_ACTION_PILL} aria-label="Effects"><Sparkles className="h-4 w-4" />Effects</button>
                    <button onClick={() => openTool('text')} className={EDITOR_ACTION_PILL} aria-label="Add text"><Type className="h-4 w-4" />Text</button>
                    <button onClick={splitAtPlayhead} className={EDITOR_ACTION_PILL} aria-label="Split clip"><Scissors className="h-4 w-4" />Split</button>
                    <button onClick={startClipCrop} className={EDITOR_ACTION_PILL} aria-label="Crop clip"><Crop className="h-4 w-4" />Crop</button>
                    <button onClick={() => setClipSpeedMenuOpen((v) => !v)} className={EDITOR_ACTION_PILL} aria-label="Change clip speed"><SkipForward className="h-4 w-4" />Speed</button>
                    <button onClick={() => updateClip(selectedClip.id, { muted: !selectedClip.muted }, 'Toggle clip audio')} className={EDITOR_ACTION_PILL} aria-label="Toggle clip audio">{selectedClip.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}{selectedClip.muted ? 'Unmute' : 'Volume'}</button>
                    <button onClick={() => deleteClip(selectedClip.id)} className={EDITOR_ACTION_PILL + ' text-red-300'} aria-label="Delete clip"><Trash2 className="h-4 w-4" />Delete</button>
                  </>
                )}
                {selectedElement && (
                  <>
                    <button onClick={() => openTool(inspectorTool)} className={EDITOR_ACTION_PILL} aria-label="Edit selected overlay"><Type className="h-4 w-4" />Edit</button>
                    {(selectedElement.kind === 'image' || selectedElement.kind === 'video') && <button onClick={startElementCrop} className={EDITOR_ACTION_PILL} aria-label="Crop selected overlay"><Crop className="h-4 w-4" />Crop</button>}
                    <button onClick={() => duplicateElement(selectedElement)} className={EDITOR_ACTION_PILL} aria-label="Duplicate selected overlay"><Copy className="h-4 w-4" />Duplicate</button>
                    <button onClick={() => updateElement(selectedElement.id, { rotation: selectedElement.rotation - 90 }, 'Rotate counterclockwise')} className={EDITOR_ACTION_PILL} aria-label="Rotate selected overlay"><RotateCcw className="h-4 w-4" />Rotate</button>
                    <button onClick={() => deleteElement(selectedElement.id)} className={EDITOR_ACTION_PILL + ' text-red-300'} aria-label="Delete selected overlay"><Trash2 className="h-4 w-4" />Delete</button>
                  </>
                )}
                {selectedAudio && (
                  <>
                    <button onClick={() => openTool('audio')} className={EDITOR_ACTION_PILL} aria-label="Adjust audio"><SlidersHorizontal className="h-4 w-4" />Adjust</button>
                    <button onClick={() => audioReplaceInputRef.current?.click()} className={EDITOR_ACTION_PILL} aria-label="Replace audio"><Film className="h-4 w-4" />Replace</button>
                    <button
                      onClick={async () => {
                        if (beatBusy) return;
                        setBeatBusy(true);
                        try {
                          const markers = await detectBeatMarkers(selectedAudio);
                          updateProject((p) => ({ ...p, beatMarkers: markers }), 'Detect audio beats');
                          notify(markers.length ? 'Detected ' + markers.length + ' beat markers.' : 'No strong beats were detected.');
                        } catch (error) {
                          notify(error instanceof Error ? error.message : 'Beat detection failed.');
                        } finally {
                          setBeatBusy(false);
                        }
                      }}
                      className={EDITOR_ACTION_PILL}
                      aria-label="Detect beats"
                      disabled={beatBusy}
                    >{beatBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{beatBusy ? 'Beats…' : 'Beats'}</button>
                    <button onClick={() => openTool('audio')} className={EDITOR_ACTION_PILL} aria-label="Adjust volume"><Volume2 className="h-4 w-4" />Volume</button>
                    <button onClick={() => updateProject((p) => ({ ...p, audio: p.audio.filter((x) => x.id !== selectedAudio.id), beatMarkers: (p.beatMarkers || []).filter((t) => t < selectedAudio.start || t > selectedAudio.start + Math.max(0, selectedAudio.trimEnd - selectedAudio.trimStart)) }), 'Remove audio')} className={EDITOR_ACTION_PILL + ' text-red-300'} aria-label="Remove audio"><Trash2 className="h-4 w-4" />Delete</button>
                  </>
                )}
              </div>

              {/* Desktop: richer contextual controls remain available without constraining the mobile workspace. */}
              <div className="hidden md:block mt-1.5 -mx-1 border-t border-white/10 bg-[#101010]/96 px-1.5 pt-1.5 backdrop-blur-xl" aria-label="Contextual editor actions">
                {selectedClip && (
                  <>
                    <div className="no-scrollbar flex items-center gap-1 overflow-x-auto pb-1">
                      {[
                        { label: 'Edit', icon: <Scissors className="h-4 w-4" />, action: () => openTool('motion') },
                        { label: 'Sound', icon: <Music className="h-4 w-4" />, action: () => { setClipSoundMenuOpen((v) => !v); setClipSpeedMenuOpen(false); } },
                        { label: 'Text', icon: <Type className="h-4 w-4" />, action: () => { addTextElement(); } },
                        { label: 'Effects', icon: <Sparkles className="h-4 w-4" />, action: () => openTool('look') },
                        { label: 'Magic', icon: <Sparkles className="h-4 w-4" />, action: () => { openTool('motion'); notify('Magic tools are ready in Motion — keyframes, speed and transform stay on-canvas.'); } },
                        { label: 'Captions', icon: <Type className="h-4 w-4" />, action: () => { addCaptionElement(); } },
                      ].map((item) => (
                        <button key={item.label} onClick={item.action} className="flex min-w-[64px] shrink-0 flex-col items-center justify-center gap-1 rounded-xl px-2.5 py-2 text-[9px] font-semibold text-white/65 active:bg-white/10 focus-visible:ring-2 focus-visible:ring-[#FFB6C1]" aria-label={item.label}>
                          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.07] text-white/90">{item.icon}</span>{item.label}
                        </button>
                      ))}
                    </div>
                    {clipSoundMenuOpen && (
                      <div className="no-scrollbar flex items-center gap-1 overflow-x-auto border-t border-white/5 py-1">
                        <button onClick={() => replaceInputRef.current?.click()} className={EDITOR_ACTION_PILL}><Film className="h-4 w-4" />Replace</button>
                        <button onClick={() => openTool('audio')} className={EDITOR_ACTION_PILL}><Sparkles className="h-4 w-4" />Sound effect</button>
                        <button onClick={() => { void startVoiceover(); setClipSoundMenuOpen(false); }} className={EDITOR_ACTION_PILL}><Mic className="h-4 w-4" />Voiceover</button>
                      </div>
                    )}
                    <div className="no-scrollbar flex items-center gap-1 overflow-x-auto border-t border-white/5 pt-1">
                      <button onClick={splitAtPlayhead} className={EDITOR_ACTION_PILL}><Scissors className="h-4 w-4" />Split</button>
                      <button onClick={() => openTool('media')} className={EDITOR_ACTION_PILL}><Film className="h-4 w-4" />Replace</button>
                      <button onClick={() => deleteClip(selectedClip.id)} className={EDITOR_ACTION_PILL + ' text-red-300'}><Trash2 className="h-4 w-4" />Delete</button>
                      <button onClick={() => { setClipSpeedMenuOpen((v) => !v); setClipSoundMenuOpen(false); }} className={EDITOR_ACTION_PILL}><SkipForward className="h-4 w-4" />Speed {selectedClip.speed}×</button>
                      {clipSpeedMenuOpen && <div className="flex shrink-0 items-center gap-1 rounded-xl border border-white/10 bg-[#181818] p-1">{SPEED_OPTIONS.map((speed) => <button key={speed} onClick={() => { updateClip(selectedClip.id, { speed }, 'Change speed', `speed-${selectedClip.id}`); setClipSpeedMenuOpen(false); }} className={`rounded-lg px-2.5 py-2 text-[10px] font-bold ${selectedClip.speed === speed ? 'bg-[#E5798F] text-white' : 'text-white/60 hover:bg-white/10'}`}>{speed}×</button>)}</div>}
                      <button onClick={startClipCrop} className={EDITOR_ACTION_PILL}><Crop className="h-4 w-4" />Crop</button>
                      <button onClick={() => updateClip(selectedClip.id, { muted: !selectedClip.muted }, 'Toggle clip audio')} className={EDITOR_ACTION_PILL}>{selectedClip.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}{selectedClip.muted ? 'Unmute' : 'Mute'}</button>
                      <button onClick={() => duplicateClip(selectedClip)} className={EDITOR_ACTION_PILL}><Copy className="h-4 w-4" />Duplicate</button>
                      <button onClick={() => void reverseSelectedClip()} disabled={preparingReverse === selectedClip.id} className={EDITOR_ACTION_PILL + ' disabled:opacity-40'}>{preparingReverse === selectedClip.id ? 'Preparing…' : 'Reverse'}</button>
                    </div>
                  </>
                )}
                {selectedElement && <div className="no-scrollbar flex items-center gap-1 overflow-x-auto pb-1">
                  <button onClick={() => openTool(inspectorTool)} className={EDITOR_ACTION_PILL}><Type className="h-4 w-4" />Edit</button>
                  {(selectedElement.kind === 'image' || selectedElement.kind === 'video') && <button onClick={startElementCrop} className={EDITOR_ACTION_PILL}><Crop className="h-4 w-4" />Crop</button>}
                  <button onClick={() => duplicateElement(selectedElement)} className={EDITOR_ACTION_PILL}><Copy className="h-4 w-4" />Duplicate</button>
                  <button onClick={() => updateElement(selectedElement.id, { z: Math.max(...project.elements.map((e) => e.z), 0) + 1 }, 'Bring to front')} className={EDITOR_ACTION_PILL}><ArrowRight className="h-4 w-4 rotate-[-90deg]" />Front</button>
                  <button onClick={() => updateElement(selectedElement.id, { rotation: selectedElement.rotation - 90 }, 'Rotate counterclockwise')} className={EDITOR_ACTION_PILL}><RotateCcw className="h-4 w-4" />Rotate</button>
                  {selectedElement.kind === 'video' && <button onClick={() => moveVideoOverlayToMainTrack(selectedElement)} className={EDITOR_ACTION_PILL}><Film className="h-4 w-4" />Main track</button>}
                  <button onClick={() => deleteElement(selectedElement.id)} className={EDITOR_ACTION_PILL + ' text-red-300'}><Trash2 className="h-4 w-4" />Delete</button>
                </div>}
                {selectedAudio && <div className="no-scrollbar flex items-center gap-1 overflow-x-auto pb-1">
                  <button onClick={() => openTool('audio')} className={EDITOR_ACTION_PILL}><Music className="h-4 w-4" />Edit</button>
                  <button onClick={() => updateAudio(selectedAudio.id, { start: Math.max(0, playhead) }, 'Set audio start at playhead')} className={EDITOR_ACTION_PILL}><Play className="h-4 w-4" />Start here</button>
                  <button onClick={() => updateProject((p) => ({ ...p, audio: p.audio.filter((x) => x.id !== selectedAudio.id) }), 'Remove audio')} className={EDITOR_ACTION_PILL + ' text-red-300'}><Trash2 className="h-4 w-4" />Remove</button>
                </div>}
              </div>
            </>
          ) : (
            <p className="mt-1.5 hidden text-center text-[10px] text-white/25 md:block">Select a clip, overlay or audio to reveal contextual editing tools.</p>
          )}

        </section>
      </div>

      {/* ---------- tool panels ---------- */}
      {toolDrawerOpen && (
        <>
          <button
            type="button"
            aria-label="Close editor tools"
            onClick={() => setToolDrawerOpen(false)}
            className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[1px]"
          />
          <section
            className="fixed bottom-[calc(64px+env(safe-area-inset-bottom))] left-0 right-0 z-50 flex h-[72dvh] max-h-[calc(100dvh-64px-env(safe-area-inset-bottom))] min-h-0 flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-[#151515]/98 shadow-2xl backdrop-blur-xl md:bottom-0 md:left-auto md:top-[57px] md:h-[calc(100dvh-57px)] md:w-[min(430px,92vw)] md:max-h-none md:rounded-none md:border-b-0 md:border-r-0 md:border-t-0"
            aria-label={`${TOOL_LABELS[tool]} tools`}
          >
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 px-3">
              <div className="h-1 w-10 rounded-full bg-white/20 md:hidden" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold">{TOOL_LABELS[tool]}</p>
                <p className="hidden text-[9px] text-white/35 md:block">Editor controls</p>
              </div>
              <button
                type="button"
                onClick={() => setToolDrawerOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/70 focus-visible:ring-2 focus-visible:ring-[#FFB6C1]"
                aria-label="Close tools"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-3 py-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:h-auto">

        {tool === 'media' && (
          <div className="space-y-3">
            {placeholders.length > 0 && (
              <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-200">
                Template placeholders ({placeholders.length}) — import media, then tap a placeholder to fill the next one.
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => void startPracticeProject()} disabled={stockBusy} className="rounded-xl border border-[#E5798F]/40 bg-[#E5798F]/10 px-3 py-3 text-left text-xs font-bold text-white disabled:opacity-50">
                <span className="block">Practice project</span>
                <span className="mt-1 block text-[9px] font-normal text-white/45">Free stock footage, ready to edit</span>
              </button>
              <Link href="/studio/templates" className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-left text-xs font-bold text-white hover:bg-white/[0.07]">
                <span className="block">Browse templates</span>
                <span className="mt-1 block text-[9px] font-normal text-white/45">Editable project templates</span>
              </Link>
            </div>

            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#E5798F] py-6 text-sm font-bold text-white shadow-lg transition hover:bg-[#d96a81]">
              <Upload className="h-5 w-5" /> Import raw video
              <input
                type="file"
                accept="video/*"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && void importFiles(e.target.files)}
              />
            </label>
            <p className="text-center text-[11px] text-white/40">
              Original files stay untouched. Edit non-destructively with trims, speed, transforms, effects and layers.
            </p>
            {importing && (
              <div className="rounded-xl bg-white/10 p-3 text-xs">
                <p className="mb-1 truncate">{importing.name}</p>
                <div className="h-1.5 overflow-hidden rounded bg-white/20">
                  <div className="h-full bg-[#E5798F] transition-all" style={{ width: `${importing.percent}%` }} />
                </div>
              </div>
            )}
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div><p className="text-sm font-bold">Stock footage</p><p className="text-[10px] text-white/40">Search real source video and place it on the timeline.</p></div>
                <span className="text-[9px] font-semibold uppercase text-white/35">{stockProvider === 'all' ? 'Pexels + Pixabay' : stockProvider}</span>
              </div>
              <div className="mb-2 flex gap-1 rounded-lg bg-white/[0.04] p-1">
                {(['all', 'pexels', 'pixabay'] as const).map((provider) => (
                  <button
                    key={provider}
                    type="button"
                    onClick={() => {
                      setStockProvider(provider);
                      void searchStockVideos(true, provider);
                    }}
                    className={`flex-1 rounded-md px-2 py-1.5 text-[10px] font-semibold capitalize ${stockProvider === provider ? 'bg-white/15 text-white' : 'text-white/45 hover:text-white/75'}`}
                  >
                    {provider === 'all' ? 'All sources' : provider}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" /><input value={stockQuery} onChange={(e) => setStockQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void searchStockVideos(true); }} placeholder="Search footage…" className="w-full rounded-lg bg-white/10 py-2 pl-9 pr-3 text-xs outline-none focus:ring-1 focus:ring-[#E5798F]" /></div>
                <select value={stockOrientation} onChange={(e) => { const v = e.target.value as typeof stockOrientation; setStockOrientation(v); window.setTimeout(() => void searchStockVideos(true), 0); }} className="rounded-lg bg-white/10 px-2 text-xs outline-none"><option value="all" className="text-black">All</option><option value="portrait" className="text-black">Portrait</option><option value="landscape" className="text-black">Landscape</option><option value="square" className="text-black">Square</option></select>
              </div>
              {stockError && <p className="mt-2 rounded-lg bg-red-500/10 p-2 text-[10px] text-red-200">{stockError}</p>}
              {stockBusy && stockVideos.length === 0 ? <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-[#FFB6C1]" /></div> : <div className="mt-2 grid max-h-56 grid-cols-3 gap-1.5 overflow-y-auto overscroll-contain">{stockVideos.map((v) => <button key={v.id} type="button" onClick={() => addStockVideo(v)} className="group relative aspect-video overflow-hidden rounded-lg border border-white/10 bg-black text-left" title={'Add footage by ' + v.photographer}>{v.thumbnail ? <img src={v.thumbnail} alt="" className="h-full w-full object-cover transition group-hover:scale-105" /> : <video src={v.url} muted preload="metadata" className="h-full w-full object-cover" />}<span className="absolute inset-x-0 bottom-0 truncate bg-black/65 px-1.5 py-1 text-[8px] text-white">{v.duration ? fmt(v.duration) : 'video'} · {v.photographer}</span></button>)}</div>}
              {stockVideos.length > 0 && <button type="button" onClick={() => void searchStockVideos(false)} disabled={stockBusy} className="mt-2 w-full rounded-lg border border-white/15 py-2 text-[10px] font-semibold disabled:opacity-40">{stockBusy ? 'Loading…' : 'Load more footage'}</button>}
              <p className="mt-2 text-center text-[9px] text-white/35">Stock footage provided by Pexels and Pixabay · keep the provider/creator attribution visible.</p>
            </div>
            {/* fill placeholders with imported library entries */}
            {placeholders.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-white/60">Recently imported</p>
                <LibraryPicker
                  meId={meId}
                  onPick={async (item) => {
                    const slot = placeholders[0];
                    if (!slot) return;
                    if (item.media_type === 'video') {
                      updateProject(
                        (p) => ({
                          ...p,
                          clips: p.clips.map((c) =>
                            c.id === slot.id
                              ? { ...c, src: item.url, name: 'Filled', sourceDuration: item.duration_seconds || 10, trimEnd: Math.min(c.trimEnd || 10, item.duration_seconds || 10) }
                              : c
                          ),
                        }),
                        'Fill placeholder'
                      );
                      notify('Placeholder filled.');
                    } else {
                      /* placeholders are raw-video slots — images/GIFs don't fill them */
                      notify('Placeholder slots take raw videos. Import images from the overlays panel instead.');
                    }
                  }}
                />
              </div>
            )}
            {/* canvas format */}
            <div>
              <p className="mb-1.5 text-xs font-semibold text-white/60">Canvas</p>
              <div className="flex flex-wrap gap-1.5">
                {aspectChoices.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setAspect(a.id)}
                    aria-pressed={project.aspect === a.id}
                    className={`rounded-lg px-3 py-2 text-xs font-semibold focus-visible:ring-2 focus-visible:ring-[#FFB6C1] ${project.aspect === a.id ? 'bg-[#E5798F] text-white' : 'bg-white/10 text-white/80'}`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {tool === 'text' && (
          <div className="space-y-3">
            <button onClick={addTextElement} className="flex w-full items-center justify-center gap-2 rounded-xl bg-white py-3 text-sm font-bold text-black focus-visible:ring-2 focus-visible:ring-[#FFB6C1]">
              <Type className="h-4 w-4" /> Add text at playhead
            </button>
            {legacyAiElements.length > 0 && (
              <button
                onClick={cleanupLegacyAiElements}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-300/25 bg-amber-300/10 py-2.5 text-xs font-semibold text-amber-100 transition hover:bg-amber-300/15"
                aria-label={`Clean up ${legacyAiElements.length} legacy AI placeholder slivers`}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clean up legacy AI elements ({legacyAiElements.length})
              </button>
            )}
            {selectedElement && (
              <ElementInspector
                el={selectedElement}
                duration={duration}
                playhead={playhead}
                updateElement={updateElement}
                onChange={(patch, label, key) => updateElement(selectedElement.id, patch, label, key)}
                onDuplicate={() => duplicateElement(selectedElement)}
                onDelete={() => deleteElement(selectedElement.id)}
                onCrop={startElementCrop}
              />
            )}
          </div>
        )}

        {tool === 'ai' && (
          <VideoAIStudio
            projectId={projectId}
            project={project}
            selectedMediaUrl={selectedClip?.src || selectedElement?.src || null}
            selectedMediaType={
              selectedClip
                ? 'video'
                : selectedElement?.kind === 'image'
                  ? 'image'
                  : selectedElement?.kind === 'video'
                    ? 'video'
                    : null
            }
            selectedClipId={selectedClipId}
            selectedElementId={selectedElementId}
            onApplyActions={applyAIActions}
            onAddStockVideo={(media) => {
              addStockVideo({
                url: media.url,
                width: media.width,
                height: media.height,
                duration: media.duration,
                photographer: media.photographer,
                provider: media.provider,
              });
            }}
            onAddLibraryAudio={async (soundId) => {
              const { data, error } = await supabase
                .from('sounds')
                .select('id,title,artist,category,url,duration_seconds,license_type,rights_holder,commercial_use,attribution_required,restrictions,premium')
                .eq('id', soundId)
                .maybeSingle();

              if (error || !data) throw new Error('That library sound is unavailable.');
              if (data.premium && !has('sounds.premium')) throw new Error('That library sound requires the appropriate entitlement.');
              if (data.commercial_use === false) throw new Error('That sound is not licensed for commercial use.');

              const alreadyAdded = docRef.current.project.audio.some((track) => track.src === data.url);
              if (alreadyAdded) {
                notify('“' + data.title + '” is already on the timeline.');
                return;
              }

              const sourceDuration = Math.max(0.1, Number(data.duration_seconds) || 15);
              const track: AudioTrack = {
                id: makeVideoId('ai-aud'),
                name: data.title,
                src: data.url,
                provider: 'library',
                track_id: docRef.current.project.tracks.find((track) => track.kind === 'audio')?.id,
                license: data.license_type || undefined,
                creator: data.artist || data.rights_holder || undefined,
                start: 0,
                sourceDuration,
                trimStart: 0,
                trimEnd: Math.min(sourceDuration, Math.max(8, Math.min(30, sourceDuration))),
                volume: 0.72,
                fadeIn: 0.6,
                fadeOut: 1,
                kind: 'music',
              };

              updateProject((p) => ({ ...p, audio: [...p.audio, track] }), 'AI add library audio');
              setSelectedAudioId(track.id);
              openTool('audio');
              notify('“' + data.title + '” added from the sound library.');
            }}
            onAddMedia={({ url, name }) => {
              const maxW = project.canvas.width * 0.78;
              const maxH = project.canvas.height * 0.52;
              const w = Math.round(maxW);
              const h = Math.round(maxH);
              const element: TimelineElement = {
                id: makeVideoId('ai-media'),
                kind: 'image',
                content: name,
                src: url,
                track_id: project.tracks[0]?.id,
                start: playheadRef.current,
                end: Math.min(duration, playheadRef.current + 4),
                x: Math.round((project.canvas.width - w) / 2),
                y: Math.round((project.canvas.height - h) / 2),
                width: w,
                height: h,
                rotation: 0,
                opacity: 1,
                z: Math.max(...project.elements.map((item) => item.z), 0) + 1,
                font_size: 48,
                font_family: 'Poppins, sans-serif',
                font_weight: 700,
                color: '#FFFFFF',
                align: 'center',
                background: 'transparent',
                stroke_color: '#000000',
                shadow: false,
                animation: 'pop',
              };
              updateProject((p) => ({ ...p, elements: [...p.elements, element] }), 'Add AI background removal');
              setSelectedClipId(null);
              setSelectedElementId(element.id);
              openTool('overlays');
              notify('AI background removal added as a new transparent layer.');
            }}
            onAddCaptions={(captions) => {
              const baseZ = Math.max(...project.elements.map((item) => item.z), 0);
              const clipIndex = selectedClipId ? project.clips.findIndex((item) => item.id === selectedClipId) : -1;
              const captionClip = clipIndex >= 0 ? project.clips[clipIndex] : null;
              const captionTimelineStart = clipIndex >= 0
                ? project.clips.slice(0, clipIndex).reduce((sum, item) => sum + clipDuration(item), 0)
                : 0;
              const sourceStart = captionClip?.trimStart ?? 0;
              const sourceEnd = captionClip?.trimEnd ?? Number.POSITIVE_INFINITY;
              const playbackSpeed = Math.max(0.05, captionClip?.speed ?? 1);
              const created = captions
                .filter((caption) => caption.end > sourceStart && caption.start < sourceEnd)
                .map((caption, index): TimelineElement => {
                  const localStart = Math.max(0, (caption.start - sourceStart) / playbackSpeed);
                  const localEnd = Math.max(localStart + 0.25, (Math.min(caption.end, sourceEnd) - sourceStart) / playbackSpeed);
                  return {
                id: makeVideoId('caption'),
                kind: 'text',
                content: caption.text,
                src: null,
                track_id: project.tracks[0]?.id,
                start: captionClip ? captionTimelineStart + localStart : caption.start,
                end: captionClip ? captionTimelineStart + localEnd : Math.max(caption.start + 0.25, caption.end),
                x: project.canvas.width * 0.08,
                y: project.canvas.height * 0.76,
                width: project.canvas.width * 0.84,
                height: 92,
                rotation: 0,
                opacity: 1,
                z: baseZ + index + 1,
                font_size: Math.max(30, Math.round(project.canvas.width * 0.043)),
                font_family: 'Poppins, sans-serif',
                font_weight: 800,
                color: '#FFFFFF',
                align: 'center',
                background: '#000000',
                stroke_color: '#000000',
                shadow: true,
                animation: 'pop',
                  };
                });
              if (!created.length) return;
              updateProject((p) => ({ ...p, elements: [...p.elements, ...created] }), 'Add AI captions');
              setSelectedClipId(null);
              setSelectedElementId(created[0].id);
              openTool('text');
              notify(`Added ${created.length} AI captions to the timeline.`);
            }}
          />
        )}

        {tool === 'overlays' && (
          <div className="space-y-3">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-sm font-bold">Layers & overlays</p>
              <p className="mt-1 text-[10px] leading-4 text-white/45">Add video and image layers above the main edit. Every layer remains editable, transformable and keyframe-ready.</p>
            </div>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#E5798F]/40 py-4 text-xs font-semibold text-white/80">
              <Film className="h-4 w-4" /> Add video overlay
              <input
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void addVideoOverlay(f); e.currentTarget.value = ''; }}
              />
            </label>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-white/20 py-4 text-xs font-semibold text-white/70">
              <ImageIcon className="h-4 w-4" /> Add image layer
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files && void importFiles(e.target.files)}
              />
            </label>
            {selectedElement && selectedElement.kind === 'video' && (
              <button
                onClick={() => moveVideoOverlayToMainTrack(selectedElement)}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#E5798F] px-3 py-2.5 text-xs font-bold focus-visible:ring-2 focus-visible:ring-white"
              >
                <Film className="h-4 w-4" /> Move video to main track
              </button>
            )}
            {selectedElement && (
              <ElementInspector
                el={selectedElement}
                duration={duration}
                playhead={playhead}
                updateElement={updateElement}
                onChange={(patch, label, key) => updateElement(selectedElement.id, patch, label, key)}
                onDuplicate={() => duplicateElement(selectedElement)}
                onDelete={() => deleteElement(selectedElement.id)}
                onCrop={startElementCrop}
              />
            )}
          </div>
        )}

        {tool === 'audio' && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <button
                onClick={recording ? stopVoiceover : startVoiceover}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold focus-visible:ring-2 focus-visible:ring-[#FFB6C1] ${recording ? 'bg-red-500 text-white' : 'bg-white text-black'}`}
              >
                {recording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                {recording ? 'Stop recording' : 'Record voiceover'}
              </button>
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-white/20 px-4 text-xs font-semibold text-white/80">
                <Music className="h-4 w-4" /> Upload audio
                <input
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file || !meId) return;
                    try {
                      const up = await uploadFile(file, 'studio-media', meId);
                      const dur = await new Promise<number>((res) => {
                        const a = document.createElement('audio');
                        a.onloadedmetadata = () => res(a.duration || 15);
                        a.onerror = () => res(15);
                        a.src = URL.createObjectURL(file);
                      });
                      addSoundTrack({ title: file.name, url: up.url, duration_seconds: dur, provider: 'upload' }, 'music');
                    } catch (err) {
                      notify(`Audio upload failed — ${err instanceof Error ? err.message : 'try again'}`);
                    } finally {
                      e.currentTarget.value = '';
                    }
                  }}
                />
              </label>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="mb-2 flex items-center gap-1 rounded-lg bg-white/[0.04] p-1">
                <button
                  type="button"
                  onClick={() => { setSoundProvider('library'); void loadSounds(); }}
                  className={`flex-1 rounded-md px-2 py-1.5 text-[10px] font-semibold ${soundProvider === 'library' ? 'bg-white/15 text-white' : 'text-white/45'}`}
                >
                  My library
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSoundProvider('freesound');
                    if (sounds.length === 0) void searchFreesound('', 1, false, soundCategory);
                  }}
                  className={`flex-1 rounded-md px-2 py-1.5 text-[10px] font-semibold ${soundProvider === 'freesound' ? 'bg-white/15 text-white' : 'text-white/45'}`}
                >
                  Freesound
                </button>
              </div>

              {soundProvider === 'freesound' ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-bold">Freesound browser</p>
                    <p className="mt-0.5 text-[10px] leading-4 text-white/45">
                      Search CC0 sounds, preview them, then add the preview directly to your timeline. Nothing is copied into your sound database.
                    </p>
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void searchFreesound(soundQuery, 1, false, soundCategory);
                    }}
                    className="flex gap-2"
                  >
                    <div className="relative min-w-0 flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                      <input
                        value={soundQuery}
                        onChange={(e) => setSoundQuery(e.target.value)}
                        placeholder="Search sound effects, ambience, music…"
                        aria-label="Search Freesound"
                        className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-xs outline-none focus:border-[#E5798F]"
                      />
                    </div>
                    <button type="submit" disabled={soundBusy} className="rounded-lg bg-[#E5798F] px-3 py-2 text-[10px] font-bold disabled:opacity-50">
                      Search
                    </button>
                  </form>

                  <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Sound categories">
                    {soundCategories.map((category) => (
                      <button
                        key={category}
                        type="button"
                        role="tab"
                        aria-selected={soundCategory === category}
                        onClick={() => {
                          setSoundCategory(category);
                          void searchFreesound(soundQuery, 1, false, category);
                        }}
                        className={`shrink-0 rounded-full border px-2.5 py-1.5 text-[9px] font-semibold transition ${soundCategory === category ? 'border-[#E5798F] bg-[#E5798F]/20 text-white' : 'border-white/10 bg-white/[0.03] text-white/50 hover:text-white'}`}
                      >
                        {category}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center justify-between text-[9px] text-white/35">
                    <span>{soundCount ? `${soundCount.toLocaleString()} CC0 sounds` : 'CC0 sounds'}</span>
                    {soundPage > 1 && <span>Page {soundPage} / {soundPages}</span>}
                  </div>

                  {soundBusy && sounds.length === 0 ? (
                    <div className="flex items-center justify-center gap-2 py-8 text-xs text-white/45">
                      <Loader2 className="h-4 w-4 animate-spin" /> Searching Freesound…
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {sounds.map((s) => (
                        <div key={s.id} className="rounded-xl border border-white/10 bg-white/[0.035] p-2.5">
                          <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-semibold">{s.title}</p>
                              <p className="mt-0.5 truncate text-[10px] text-white/45">
                                {s.artist} · {fmt(s.duration_seconds)} · {s.license || 'CC0'}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => addSoundTrack({
                                title: s.title,
                                url: s.url,
                                duration_seconds: s.duration_seconds,
                                provider: s.provider,
                                sourceUrl: s.source,
                                license: s.license,
                                creator: s.artist,
                              }, 'music')}
                              className="shrink-0 rounded-lg bg-[#E5798F] px-3 py-2 text-[10px] font-bold focus-visible:ring-2 focus-visible:ring-white"
                            >
                              Add
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() => toggleSoundPreview(s)}
                            className="mt-2 flex w-full items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-left text-[10px] font-semibold text-white/75 transition hover:bg-white/[0.08] active:scale-[0.99]"
                            aria-label={`${previewingSoundId === s.id ? 'Pause' : 'Preview'} ${s.title}`}
                          >
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#E5798F] text-white">
                              {previewingSoundId === s.id ? <Pause className="h-3.5 w-3.5 fill-current" /> : <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />}
                            </span>
                            <span>{previewingSoundId === s.id ? 'Previewing…' : 'Preview sound'}</span>
                          </button>

                          <div className="mt-2 flex items-center justify-between gap-2">
                            <div className="min-w-0 truncate text-[9px] text-white/35">
                              {s.tags?.slice(0, 4).join(' · ') || 'Freesound · CC0'}
                            </div>
                            {s.source && (
                              <a
                                href={s.source}
                                target="_blank"
                                rel="noreferrer"
                                className="shrink-0 text-[9px] font-semibold text-[#FFB6C1] hover:underline"
                              >
                                View source
                              </a>
                            )}
                          </div>
                        </div>
                      ))}

                      {!soundBusy && sounds.length === 0 && (
                        <div className="rounded-lg border border-dashed border-white/15 px-3 py-5 text-center text-xs text-white/50">
                          No Freesound results. Try a different search or category.
                        </div>
                      )}

                      {soundProvider === 'freesound' && soundPage < soundPages && (
                        <button
                          type="button"
                          onClick={() => void searchFreesound(soundQuery, soundPage + 1, true, soundCategory)}
                          disabled={soundBusy}
                          className="w-full rounded-lg border border-white/15 py-2.5 text-[10px] font-semibold disabled:opacity-40"
                        >
                          {soundBusy ? 'Loading…' : 'Load more sounds'}
                        </button>
                      )}
                    </div>
                  )}

                  <p className="text-center text-[9px] leading-4 text-white/30">
                    Freesound results here are filtered to Creative Commons 0. Preview files are used directly; the original Freesound file is not downloaded.
                  </p>
                </div>
              ) : (
                <>
                  <p className="mb-1.5 text-xs font-semibold text-white/60">Sound library</p>
                  {soundBusy && <p className="text-xs text-white/50">Loading sounds…</p>}
                  <ul className="space-y-1.5">
                    {sounds.map((s) => (
                      <li key={s.id} className="flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold">{s.title}</p>
                          <p className="truncate text-[10px] text-white/50">{s.artist} · {s.category}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleSoundPreview(s)}
                          className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-2.5 text-[9px] font-semibold text-white/75 transition hover:bg-white/10"
                          aria-label={`${previewingSoundId === s.id ? 'Pause' : 'Preview'} ${s.title}`}
                        >
                          {previewingSoundId === s.id ? <Pause className="h-3 w-3 fill-current" /> : <Play className="h-3 w-3 fill-current" />}
                          {previewingSoundId === s.id ? 'Pause' : 'Preview'}
                        </button>
                        <button onClick={() => addSoundTrack(s, 'music')} className="rounded-lg bg-[#E5798F] px-3 py-2 text-[11px] font-bold focus-visible:ring-2 focus-visible:ring-white">
                          Add
                        </button>
                      </li>
                    ))}
                    {!soundBusy && sounds.length === 0 && (
                      <li className="rounded-lg border border-dashed border-white/15 px-3 py-4 text-center text-xs text-white/50">
                        No sounds in your library yet.
                      </li>
                    )}
                  </ul>
                </>
              )}
            </div>

            {project.audio.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-white/60">Audio tracks</p>
                {project.audio.map((a) => (
                  <div key={a.id} className={`rounded-xl p-3 text-xs ${a.id === selectedAudioId ? 'bg-emerald-500/10 ring-1 ring-emerald-300/40' : 'bg-white/5'}`}>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="flex-1 truncate font-semibold">🎵 {a.name}</span>
                      <span className="text-white/50">{a.kind}</span>
                      <button onClick={() => updateProject((p) => ({ ...p, audio: p.audio.filter((x) => x.id !== a.id) }), 'Remove audio')} aria-label="Remove track" className="text-red-300 focus-visible:ring-2 focus-visible:ring-white">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="mb-2 flex flex-wrap gap-1.5 text-[9px] text-white/35">
                      {a.provider === 'freesound' && <span className="rounded bg-white/5 px-1.5 py-1">Freesound</span>}
                      {a.creator && <span className="rounded bg-white/5 px-1.5 py-1">{a.creator}</span>}
                      {a.license && <span className="rounded bg-white/5 px-1.5 py-1">{a.license}</span>}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-1">
                        <span className="text-white/60">Volume</span>
                        <Slider label="Volume" min={0} max={1} step={0.05} value={a.volume}
                          onChange={(v) => updateAudio(a.id, { volume: v }, 'Audio volume', `vol-${a.id}`)} />
                      </label>
                      <label className="space-y-1">
                        <span className="text-white/60">Start (s)</span>
                        <input type="number" min={0} max={Math.max(duration, 1)} step={0.5} value={Number(a.start.toFixed(1))}
                          onChange={(e) => updateAudio(a.id, { start: Math.max(0, Number(e.target.value)) }, 'Move audio', `start-${a.id}`)}
                          className="w-full rounded bg-white/10 px-2 py-1" />
                      </label>
                      <label className="space-y-1">
                        <span className="text-white/60">Fade in (s)</span>
                        <Slider label="Fade in (s)" min={0} max={5} step={0.5} value={a.fadeIn}
                          onChange={(v) => updateAudio(a.id, { fadeIn: v }, 'Fade in', `fi-${a.id}`)} />
                      </label>
                      <label className="space-y-1">
                        <span className="text-white/60">Fade out (s)</span>
                        <Slider label="Fade out (s)" min={0} max={5} step={0.5} value={a.fadeOut}
                          onChange={(v) => updateAudio(a.id, { fadeOut: v }, 'Fade out', `fo-${a.id}`)} />
                      </label>
                      <label className="space-y-1">
                        <span className="text-white/60">Trim start (s)</span>
                        <Slider label="Trim start (s)" min={0} max={Math.max(0.2, a.trimEnd - 0.2)} step={0.1} value={a.trimStart}
                          onChange={(v) => updateAudio(a.id, { trimStart: v }, 'Trim audio start', `ats-${a.id}`)} />
                      </label>
                      <label className="space-y-1">
                        <span className="text-white/60">Trim end (s)</span>
                        <Slider label="Trim end (s)" min={a.trimStart + 0.2} max={Math.max(a.trimStart + 0.4, a.trimEnd)} step={0.1} value={a.trimEnd}
                          onChange={(v) => updateAudio(a.id, { trimEnd: v }, 'Trim audio end', `ate-${a.id}`)} />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tool === 'motion' && (
          <div className="space-y-3">
            {selectedClip && (
              <div className="rounded-2xl border border-white/10 bg-[#111]/90 p-2">
                <div className="mb-2 flex gap-1 overflow-x-auto" role="tablist" aria-label="Frame tools">
                  {([
                    ['motion', 'Motion'],
                    ['layer', 'Layer'],
                    ['ai-drawing', 'AI Drawing'],
                    ['ai-portrait', 'AI Portrait'],
                  ] as const).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={frameMode === id}
                      onClick={() => setFrameMode(id)}
                      className={`shrink-0 rounded-xl px-3 py-2 text-[10px] font-bold ${frameMode === id ? 'bg-[#E5798F] text-white' : 'bg-white/[0.05] text-white/50'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {frameMode === 'motion' && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <button type="button" onClick={() => updateClip(selectedClip.id, { transform: { ...selectedClip.transform, scale: Math.min(4, selectedClip.transform.scale * 1.08) } }, 'Frame zoom in')} className={EDITOR_ACTION_PILL}>Zoom in</button>
                    <button type="button" onClick={() => updateClip(selectedClip.id, { transform: { ...selectedClip.transform, scale: Math.max(0.05, selectedClip.transform.scale / 1.08) } }, 'Frame zoom out')} className={EDITOR_ACTION_PILL}>Zoom out</button>
                    <button type="button" onClick={() => updateClip(selectedClip.id, { transform: { ...selectedClip.transform, rotation: 0 } }, 'Reset rotation')} className={EDITOR_ACTION_PILL}>Reset rotation</button>
                    <button type="button" onClick={() => updateClip(selectedClip.id, { transform: { ...selectedClip.transform, offset_x: 0, offset_y: 0 } }, 'Center frame')} className={EDITOR_ACTION_PILL}>Center frame</button>
                  </div>
                )}
                {frameMode === 'layer' && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <button type="button" onClick={() => updateClip(selectedClip.id, { transform: { ...selectedClip.transform, flip_h: !selectedClip.transform.flip_h } }, 'Flip layer horizontal')} className={EDITOR_ACTION_PILL}>Flip H</button>
                    <button type="button" onClick={() => updateClip(selectedClip.id, { transform: { ...selectedClip.transform, flip_v: !selectedClip.transform.flip_v } }, 'Flip layer vertical')} className={EDITOR_ACTION_PILL}>Flip V</button>
                    <button type="button" onClick={() => updateClip(selectedClip.id, { transform: { ...selectedClip.transform, offset_x: 0, offset_y: 0 } }, 'Center layer')} className={EDITOR_ACTION_PILL}>Center</button>
                    <button type="button" onClick={() => updateClip(selectedClip.id, { transform: { ...selectedClip.transform, scale_x: 1, scale_y: 1 } }, 'Reset layer size')} className={EDITOR_ACTION_PILL}>Reset size</button>
                  </div>
                )}
                {(frameMode === 'ai-drawing' || frameMode === 'ai-portrait') && (
                  <div className="rounded-xl border border-[#E5798F]/20 bg-[#E5798F]/10 p-3">
                    <p className="text-xs font-bold">{frameMode === 'ai-drawing' ? 'AI Drawing' : 'AI Portrait'}</p>
                    <p className="mt-1 text-[10px] leading-4 text-white/50">
                      This is an AI generation operation rather than a normal editor effect. Connect an AI video/image provider to generate the processed media, then add the result as a new editable layer.
                    </p>
                    <button type="button" onClick={() => openTool('ai')} className="mt-2 w-full rounded-xl bg-[#E5798F] py-2.5 text-[10px] font-bold">
                      Open Editing Assistant
                    </button>
                  </div>
                )}
              </div>
            )}
            {selectedElement ? (
              <ElementInspector
                el={selectedElement}
                duration={duration}
                playhead={playhead}
                updateElement={updateElement}
                onChange={(patch, label, key) => updateElement(selectedElement.id, patch, label, key)}
                onDuplicate={() => duplicateElement(selectedElement)}
                onDelete={() => deleteElement(selectedElement.id)}
                onCrop={startElementCrop}
              />
            ) : selectedClip ? (
              <div className="space-y-3 rounded-xl bg-white/5 p-3">
                <p className="text-xs font-semibold text-white/70">Selected video layer</p>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="text-[10px] leading-4 text-white/45">Transform is direct on the preview: drag to move, pinch to scale, and twist with two fingers to rotate. Use the compact handles for precise one-axis or corner resizing.</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button onClick={() => rotateSelectedClip(-90)} className={`${EDITOR_ACTION_PILL}`}><RotateCcw className="h-4 w-4" />90°</button>
                    <button onClick={() => rotateSelectedClip(90)} className={`${EDITOR_ACTION_PILL}`}><RotateCw className="h-4 w-4" />90°</button>
                    <button onClick={() => updateClip(selectedClip.id, { transform: { ...selectedClip.transform, flip_h: !selectedClip.transform.flip_h } }, 'Flip horizontal')} className={`${EDITOR_ACTION_PILL}`}><FlipHorizontal className="h-4 w-4" />Flip</button>
                    <button onClick={() => updateClip(selectedClip.id, { transform: { ...selectedClip.transform, flip_v: !selectedClip.transform.flip_v } }, 'Flip vertical')} className={`${EDITOR_ACTION_PILL}`}><FlipVertical className="h-4 w-4" />Flip V</button>
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold">Animation presets</p>
                      <p className="text-[10px] text-white/40">Real keyframes — preview and export use the same animation.</p>
                    </div>
                    <span className="text-[10px] text-[#FFB6C1]">No API</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {([
                      ['zoom-in','Zoom in'],['zoom-out','Zoom out'],['spin','Spin'],
                      ['float','Float'],['pop','Pop'],['shake','Shake'],
                    ] as const).map(([id,label]) => (
                      <button key={id} type="button" onClick={() => applyMotionPreset(id)}
                        className="rounded-xl bg-white/[0.07] px-2 py-2.5 text-[10px] font-semibold text-white/75 active:bg-[#E5798F]/25">
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold">Keyframes</p>
                      <p className="text-[10px] text-white/40">At {fmt(selectedClipTimeIn)} inside this clip</p>
                    </div>
                    <span className="text-[10px] text-[#FFB6C1]">◇ motion</span>
                  </div>
                  <div className="space-y-1.5">
                    {KEYFRAMABLE_PROPERTIES.map((p) => {
                      const list = selectedClip.keyframes?.[p.id] || [];
                      const atPlayhead = list.some((k) => Math.abs(k.t - selectedClipTimeIn) < 0.05);
                      if (p.id === 'volume_kf') return null;
                      return (
                        <div key={p.id} className="flex items-center gap-2">
                          <span className="w-24 shrink-0 text-[10px] text-white/60">{p.label}</span>
                          <span className="flex-1 text-[10px] text-white/35">{list.length ? `${list.length} points` : 'No keyframes'}</span>
                          <button
                            type="button"
                            onClick={() => atPlayhead ? removeMainClipKeyframe(p.id) : addMainClipKeyframe(p.id)}
                            className={`rounded-lg px-2.5 py-1.5 text-[10px] font-semibold ${atPlayhead ? 'bg-[#E5798F] text-white' : 'bg-white/10 text-white/75'}`}
                          >
                            {atPlayhead ? 'Remove' : 'Add ◇'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <p className="text-[10px] text-white/40">
                  Drag the playhead, change the clip, then add a keyframe. Preview and export interpolate the motion.
                </p>
              </div>
            ) : (
              <div className="rounded-xl bg-white/5 p-5 text-center text-xs text-white/45">
                Select a video, text, image, sticker, or overlay layer to edit motion.
              </div>
            )}
          </div>
        )}

        {tool === 'look' && (
          <div className="space-y-4">
            {selectedClip ? (
              <>
                {/* SPEED — real playbackRate in preview, real rate + duration in export */}
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-white/60">Speed</p>
                  <div className="flex flex-wrap gap-1.5">
                    {SPEED_OPTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => updateClip(selectedClip.id, { speed: s }, 'Change speed')}
                        aria-pressed={selectedClip.speed === s}
                        className={`rounded-lg px-3 py-2 text-xs font-semibold focus-visible:ring-2 focus-visible:ring-[#FFB6C1] ${selectedClip.speed === s ? 'bg-[#E5798F] text-white' : 'bg-white/10'}`}
                      >
                        {s}×
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-[10px] text-white/40">
                    Clip plays {fmt(clipDuration(selectedClip))} on the timeline · speed applies to preview, audio and the exported file.
                  </p>
                </div>

                {/* CROP */}
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-white/60">Crop</p>
                  <button
                    onClick={startClipCrop}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-white/10 py-2.5 text-xs font-semibold focus-visible:ring-2 focus-visible:ring-[#FFB6C1]"
                  >
                    <Crop className="h-4 w-4" /> {selectedClip.transform.crop ? 'Edit crop' : 'Crop this video'}
                  </button>
                  {selectedClip.transform.crop && (
                    <button
                      onClick={() => updateClip(selectedClip.id, { transform: { ...selectedClip.transform, crop: null } }, 'Reset crop')}
                      className="mt-1.5 w-full rounded-lg bg-white/5 py-2 text-[11px] text-white/60 focus-visible:ring-2 focus-visible:ring-[#FFB6C1]"
                    >
                      Remove crop
                    </button>
                  )}
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <div><p className="text-xs font-semibold text-white">Filter Library</p><p className="text-[10px] text-white/40">Hover to audition. Click to apply.</p></div>
                    <span className="rounded-full bg-white/10 px-2 py-1 text-[9px] font-semibold text-white/55">LIVE PREVIEW</span>
                  </div>
                  <LookPreview project={project} clipId={selectedClip.id} playhead={playhead} filter={lookPreviewFilter ?? selectedClip.filter} effect={selectedClip.effect} />
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {FILTER_PRESETS.map((f) => (
                      <button key={f.id}
                        onMouseEnter={() => setLookPreviewFilter(f.id)} onMouseLeave={() => setLookPreviewFilter(null)}
                        onFocus={() => setLookPreviewFilter(f.id)} onBlur={() => setLookPreviewFilter(null)}
                        onClick={() => updateClip(selectedClip.id, { filter: f.id }, 'Apply filter')}
                        aria-pressed={selectedClip.filter === f.id}
                        className={`group overflow-hidden rounded-xl border p-1 text-left transition ${selectedClip.filter === f.id ? 'border-[#E5798F] bg-[#E5798F]/10' : 'border-white/10 bg-white/[0.04] hover:border-white/25'}`}>
                        <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
                          <div className="absolute inset-0 bg-gradient-to-br from-white/20 via-transparent to-black/50" />
                          <span className="absolute bottom-1 left-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold">{f.name}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold">Adjust</p>
                      <p className="text-[10px] text-white/40">Color-grade the selected clip without leaving the timeline.</p>
                    </div>
                    <button
                      onClick={() => updateClip(selectedClip.id, { adjustments: { ...DEFAULT_ADJUSTMENTS } }, 'Reset adjustments')}
                      className="rounded-lg bg-white/10 px-2.5 py-1.5 text-[10px] font-semibold"
                    >
                      Reset
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <Slider label="Exposure" min={50} max={150} value={selectedClip.adjustments.exposure}
                      onChange={(v) => updateClip(selectedClip.id, { adjustments: { ...selectedClip.adjustments, exposure: v } }, 'Exposure', `ex-${selectedClip.id}`)} />
                    <Slider label="Brightness" min={50} max={150} value={selectedClip.adjustments.brightness}
                      onChange={(v) => updateClip(selectedClip.id, { adjustments: { ...selectedClip.adjustments, brightness: v } }, 'Brightness', `br-${selectedClip.id}`)} />
                    <Slider label="Contrast" min={50} max={150} value={selectedClip.adjustments.contrast}
                      onChange={(v) => updateClip(selectedClip.id, { adjustments: { ...selectedClip.adjustments, contrast: v } }, 'Contrast', `co-${selectedClip.id}`)} />
                    <Slider label="Saturation" min={0} max={200} value={selectedClip.adjustments.saturate}
                      onChange={(v) => updateClip(selectedClip.id, { adjustments: { ...selectedClip.adjustments, saturate: v } }, 'Saturation', `sa-${selectedClip.id}`)} />
                    <Slider label="Vibrance" min={0} max={200} value={selectedClip.adjustments.vibrance}
                      onChange={(v) => updateClip(selectedClip.id, { adjustments: { ...selectedClip.adjustments, vibrance: v } }, 'Vibrance', `vi-${selectedClip.id}`)} />
                    <Slider label="Temperature" min={-100} max={100} value={selectedClip.adjustments.temperature}
                      onChange={(v) => updateClip(selectedClip.id, { adjustments: { ...selectedClip.adjustments, temperature: v } }, 'Temperature', `te-${selectedClip.id}`)} />
                    <Slider label="Tint" min={-100} max={100} value={selectedClip.adjustments.tint}
                      onChange={(v) => updateClip(selectedClip.id, { adjustments: { ...selectedClip.adjustments, tint: v } }, 'Tint', `ti-${selectedClip.id}`)} />
                    <Slider label="Hue" min={-180} max={180} value={selectedClip.adjustments.hue}
                      onChange={(v) => updateClip(selectedClip.id, { adjustments: { ...selectedClip.adjustments, hue: v } }, 'Hue', `hu-${selectedClip.id}`)} />
                    <Slider label="Sharpen" min={0} max={100} value={selectedClip.adjustments.sharpen}
                      onChange={(v) => updateClip(selectedClip.id, { adjustments: { ...selectedClip.adjustments, sharpen: v } }, 'Sharpen', `sh-${selectedClip.id}`)} />
                    <Slider label="Blur" min={0} max={10} value={selectedClip.adjustments.blur}
                      onChange={(v) => updateClip(selectedClip.id, { adjustments: { ...selectedClip.adjustments, blur: v } }, 'Blur', `bl-${selectedClip.id}`)} />
                    <Slider label="Scale" min={50} max={200} value={selectedClip.transform.scale * 100}
                      onChange={(v) => updateClip(selectedClip.id, { transform: { ...selectedClip.transform, scale: v / 100 } }, 'Scale', `sc-${selectedClip.id}`)} />
                    <Slider label="Rotation" min={-180} max={180} value={selectedClip.transform.rotation}
                      onChange={(v) => updateClip(selectedClip.id, { transform: { ...selectedClip.transform, rotation: v } }, 'Rotate', `ro-${selectedClip.id}`)} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => updateClip(selectedClip.id, { transform: { ...selectedClip.transform, flip_h: !selectedClip.transform.flip_h } }, 'Flip H')} aria-pressed={selectedClip.transform.flip_h} className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-2 text-xs focus-visible:ring-2 focus-visible:ring-[#FFB6C1]">
                    <FlipHorizontal className="h-3.5 w-3.5" /> Flip H
                  </button>
                  <button onClick={() => updateClip(selectedClip.id, { transform: { ...selectedClip.transform, flip_v: !selectedClip.transform.flip_v } }, 'Flip V')} aria-pressed={selectedClip.transform.flip_v} className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-2 text-xs focus-visible:ring-2 focus-visible:ring-[#FFB6C1]">
                    <FlipVertical className="h-3.5 w-3.5" /> Flip V
                  </button>
                  <button onClick={() => updateClip(selectedClip.id, { transform: { ...DEFAULT_TRANSFORM, crop: selectedClip.transform.crop }, adjustments: { ...DEFAULT_ADJUSTMENTS }, filter: 'none' }, 'Reset look')} className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-2 text-xs focus-visible:ring-2 focus-visible:ring-[#FFB6C1]">
                    <RotateCw className="h-3.5 w-3.5" /> Reset
                  </button>
                </div>
                <div className="rounded-xl bg-white/5 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold">Audio cleanup</p>
                      <p className="text-[10px] text-white/45">High-pass/low-pass cleanup for original clip audio.</p>
                    </div>
                    <button
                      onClick={() => updateClip(selectedClip.id, { audioProcessing: { ...(selectedClip.audioProcessing || DEFAULT_AUDIO_PROCESSING), compressor: !(selectedClip.audioProcessing?.compressor ?? false) } }, 'Toggle compressor')}
                      aria-pressed={selectedClip.audioProcessing?.compressor ?? false}
                      className={`rounded-lg px-3 py-2 text-[10px] font-semibold focus-visible:ring-2 focus-visible:ring-white ${selectedClip.audioProcessing?.compressor ? 'bg-[#E5798F]' : 'bg-white/10'}`}
                    >
                      Compressor {selectedClip.audioProcessing?.compressor ? 'On' : 'Off'}
                    </button>
                  </div>
                  <Slider label="Noise reduction" min={0} max={100} step={5} value={selectedClip.audioProcessing?.noiseReduction ?? 0} onChange={(v) => setNoiseReduction(v)} />
                </div>
                {/* Effect library — audition the real clip before committing. */}
                <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <div><p className="text-xs font-semibold text-white">Effect Library</p><p className="text-[10px] text-white/40">Hover to preview. Click to apply. Preview and export use the same renderer.</p></div>
                    <span className="rounded-full bg-[#E5798F]/15 px-2 py-1 text-[9px] font-semibold text-[#ffb6c1]">AUDITION</span>
                  </div>
                  <LookPreview project={project} clipId={selectedClip.id} playhead={playhead} effect={lookPreviewEffect ?? selectedClip.effect} filter={selectedClip.filter} />
                  <div className="mt-3">
                    <div className="relative mb-2">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/35" />
                      <input value={effectSearch} onChange={(e) => setEffectSearch(e.target.value)} placeholder="Search effects" className="w-full rounded-xl border border-white/10 bg-black/20 py-2 pl-8 pr-3 text-xs outline-none focus:border-white/25" />
                    </div>
                    <div className="no-scrollbar mb-2 flex gap-1.5 overflow-x-auto">
                      {(['Trending','Motion','Retro','Cinematic','All'] as const).map((cat) => (
                        <button key={cat} onClick={() => setEffectCategory(cat)} className={`shrink-0 rounded-full px-3 py-1.5 text-[10px] font-semibold ${effectCategory === cat ? 'bg-white text-black' : 'bg-white/10 text-white/55'}`}>{cat}</button>
                      ))}
                    </div>
                    {(() => {
                      const categories: Record<string, string[]> = {
                        Trending: ['flash','glitch','chromatic','dream','film'],
                        Motion: ['zoom','ken-burns','dolly-out','handheld','shake','pulse'],
                        Retro: ['vhs','film-grain','light-leak','letterbox','film'],
                        Cinematic: ['ken-burns','dolly-out','dream','film','vignette'],
                        All: EFFECT_PRESETS.map((item) => item.id),
                      };
                      const ids = categories[effectCategory] || categories.All;
                      const q = effectSearch.trim().toLowerCase();
                      const filtered = EFFECT_PRESETS.filter((fx) => ids.includes(fx.id) && (!q || (fx.name + ' ' + fx.hint).toLowerCase().includes(q)));
                      return (
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {filtered.map((fx) => {
                            const gated = fx.id !== 'none' && fx.id !== 'zoom' && !has('video.advanced_effects');
                            return (
                              <button key={fx.id} onMouseEnter={() => setLookPreviewEffect(fx.id)} onMouseLeave={() => setLookPreviewEffect(null)} onFocus={() => setLookPreviewEffect(fx.id)} onBlur={() => setLookPreviewEffect(null)} onClick={() => updateClip(selectedClip.id, { effect: fx.id, effect_intensity: fx.id === 'none' ? 0 : (selectedClip.effect_intensity ?? 1) }, 'Apply effect')} disabled={gated} aria-pressed={selectedClip.effect === fx.id} title={gated ? 'Advanced effect' : fx.hint} className={`group min-w-0 rounded-xl border p-2 text-left transition focus-visible:ring-2 focus-visible:ring-[#FFB6C1] ${selectedClip.effect === fx.id ? 'border-[#E5798F] bg-[#E5798F]/10' : gated ? 'border-white/5 bg-white/[0.02] text-white/30' : 'border-white/10 bg-white/[0.04] hover:border-white/25'}`}>
                                <div className="mb-2 flex h-14 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-white/10 via-white/[0.03] to-black"><span className="text-[10px] font-bold">{fx.name}</span></div>
                                <div className="flex items-center justify-between gap-2"><span className="truncate text-[9px] text-white/45">{fx.hint}</span>{gated && <span className="text-[9px]">PRO</span>}</div>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                  {selectedClip.effect !== 'none' && (
                    <div className="mt-3 rounded-xl bg-black/20 p-2.5">
                      <Slider label={`Effect intensity ${Math.round((selectedClip.effect_intensity ?? 1) * 100)}%`} min={0} max={100} value={(selectedClip.effect_intensity ?? 1) * 100}
                        onChange={(v) => updateClip(selectedClip.id, { effect_intensity: v / 100 }, 'Effect intensity', `fx-intensity-${selectedClip.id}`)} />
                    </div>
                  )}
                </div>

                {/* transition into this clip */}
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-white/60">Transition in</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(['none', 'fade', 'crossfade', 'slide', 'push', 'zoom', 'zoom-blur', 'whip-pan', 'spin', 'wipe', 'luma-wipe', 'dip-black', 'blur', 'glitch-cut', 'film-burn'] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => updateClip(selectedClip.id, { transitionIn: { type: t, duration: selectedClip.transitionIn.duration } }, 'Transition')}
                        aria-pressed={selectedClip.transitionIn.type === t}
                        className={`rounded-lg px-3 py-2 text-xs capitalize focus-visible:ring-2 focus-visible:ring-[#FFB6C1] ${selectedClip.transitionIn.type === t ? 'bg-[#E5798F] text-white' : 'bg-white/10'}`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  {selectedClip.transitionIn.type !== 'none' && (
                    <Slider label="Transition duration" min={0.2} max={1.5} step={0.1} value={selectedClip.transitionIn.duration}
                      onChange={(v) => updateClip(selectedClip.id, { transitionIn: { ...selectedClip.transitionIn, duration: v } }, 'Transition length', `tr-${selectedClip.id}`)} />
                  )}
                </div>
              </>
            ) : (
              <p className="text-xs text-white/50">Select a clip on the timeline to edit its look, speed, crop and transitions.</p>
            )}
          </div>
        )}

        {tool === 'export' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <label className="space-y-1">
                <span className="text-white/60">Resolution</span>
                <select
                  value={settings.resolutionHeight}
                  onChange={(e) => setExportSettings({ ...settings, resolutionHeight: Number(e.target.value) })}
                  className="w-full rounded-lg bg-white/10 px-2 py-2"
                >
                  {resolutionOptions.map((o) => {
                    const allowed = !entLoading && has(o.need);
                    return (
                      <option key={o.h} value={o.h} disabled={!allowed} className="text-black">
                        {o.label}{allowed ? '' : ' — Pro'}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-white/60">Quality</span>
                <select
                  value={settings.qualityBitrate}
                  onChange={(e) => setExportSettings({ ...settings, qualityBitrate: Number(e.target.value) })}
                  className="w-full rounded-lg bg-white/10 px-2 py-2"
                >
                  {EXPORT_QUALITY_PRESETS.map((q) => (
                    <option key={q.id} value={q.bitrate} className="text-black">{q.name}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-white/60">Frame rate</span>
                <select
                  value={settings.fps}
                  onChange={(e) => setExportSettings({ ...settings, fps: Number(e.target.value) })}
                  className="w-full rounded-lg bg-white/10 px-2 py-2"
                >
                  {[24, 30, 60].map((f) => (
                    <option key={f} value={f} className="text-black">{f} fps</option>
                  ))}
                </select>
              </label>
              <div className="space-y-1">
                <span className="text-white/60">Duration</span>
                <p className="rounded-lg bg-white/10 px-2 py-2">{fmt(duration)}</p>
              </div>
            </div>

            {exportError && (
              <div role="alert" className="rounded-xl border border-red-400/40 bg-red-500/10 p-3 text-xs text-red-200">
                {exportError}
              </div>
            )}

            {exportProgress && (
              <div className="rounded-xl bg-white/10 p-3 text-xs">
                <p className="mb-1 capitalize">{exportProgress.phase} — {exportProgress.message}</p>
                <div className="h-1.5 overflow-hidden rounded bg-white/20">
                  <div className="h-full bg-[#E5798F] transition-all" style={{ width: `${exportProgress.percent}%` }} />
                </div>
              </div>
            )}

            {!exportResult ? (
              <div className="flex gap-2">
                <button
                  onClick={runExport}
                  disabled={exporting}
                  className="flex-1 rounded-xl bg-white py-3 text-sm font-bold text-black focus-visible:ring-2 focus-visible:ring-[#FFB6C1] disabled:opacity-50"
                >
                  {exporting ? 'Rendering… keep this tab open' : 'Export video'}
                </button>
                {exporting && (
                  <button
                    onClick={() => rendererRef.current.cancelExport()}
                    className="rounded-xl border border-white/25 px-4 py-3 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-[#FFB6C1]"
                  >
                    Cancel
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <video src={exportResult.url} controls className="w-full rounded-xl border border-white/10" />
                <div className="grid grid-cols-2 gap-2">
                  <a href={exportResult.url} download={`${doc.title || 'video'}.${exportResult.format}`} className="flex items-center justify-center gap-2 rounded-xl bg-white py-2.5 text-xs font-bold text-black">
                    <Download className="h-4 w-4" /> Download
                  </a>
                  <button onClick={postExport} className="flex items-center justify-center gap-2 rounded-xl bg-[#E5798F] py-2.5 text-xs font-bold text-white">
                    <Share2 className="h-4 w-4" /> Post to feed
                  </button>
                </div>
                <button
                  onClick={openCommunityShare}
                  disabled={!sharedPostId}
                  title={sharedPostId ? 'Share this video into one of your communities' : 'Post to feed first — a community share links to a feed post'}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/20 py-2.5 text-xs font-semibold disabled:opacity-40"
                >
                  <Users className="h-4 w-4" /> Share to community
                </button>
                <button
                  onClick={openJournalPicker}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/20 py-2.5 text-xs font-semibold"
                >
                  <Film className="h-4 w-4" /> Insert into journal
                </button>
                {journalPickOpen && (
                  <div className="space-y-1 rounded-xl bg-white/5 p-2">
                    {myJournals.length === 0 && (
                      <p className="px-2 py-1.5 text-[11px] text-white/50">No journals yet — create one first.</p>
                    )}
                    {myJournals.map((j) => (
                      <button
                        key={j.id}
                        onClick={() => void insertIntoJournal(j.id)}
                        className="block w-full truncate rounded-lg px-2 py-2 text-left text-xs hover:bg-white/10"
                      >
                        📖 {j.title}
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-center text-[11px] text-white/50">Saved to your media library · {exportResult.width}×{exportResult.height} · {exportResult.format}</p>
              </div>
            )}

            {communityShareOpen && sharedPostId && (
              <SharePostPicker
                postId={sharedPostId}
                postLabel={doc.title || 'your video'}
                onClose={() => setCommunityShareOpen(false)}
              />
            )}

            <div className="space-y-2 border-t border-white/10 pt-3">
              <button onClick={() => setTplOpen((v) => !v)} className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/20 py-2.5 text-xs font-semibold">
                <Film className="h-4 w-4" /> Save as template {has('creator.marketplace') ? '' : '(review required)'}
              </button>
              {tplOpen && (
                <div className="space-y-2 rounded-xl bg-white/5 p-3">
                  <input
                    value={tplForm.title}
                    onChange={(e) => setTplForm({ ...tplForm, title: e.target.value })}
                    placeholder="Template title"
                    className="w-full rounded-lg bg-white/10 px-3 py-2 text-xs"
                  />
                  <select
                    value={tplForm.category}
                    onChange={(e) => setTplForm({ ...tplForm, category: e.target.value })}
                    className="w-full rounded-lg bg-white/10 px-3 py-2 text-xs"
                  >
                    {['trending', 'popular', 'new', 'travel', 'birthday', 'wedding', 'memories', 'love', 'friends', 'family', 'business', 'reels', 'cinematic', 'vlog', 'gaming', 'music', 'minimal', 'journal', 'seasonal'].map((c) => (
                      <option key={c} value={c} className="text-black">{c}</option>
                    ))}
                  </select>
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={tplForm.premium} onChange={(e) => setTplForm({ ...tplForm, premium: e.target.checked })} />
                    Premium (paid) template
                  </label>
                  {tplForm.premium && (
                    <input
                      type="number" min={0} step={50}
                      value={tplForm.price_cents}
                      onChange={(e) => setTplForm({ ...tplForm, price_cents: Number(e.target.value) })}
                      placeholder="Price in cents (e.g. 299 = $2.99)"
                      className="w-full rounded-lg bg-white/10 px-3 py-2 text-xs"
                    />
                  )}
                  <button onClick={saveAsTemplate} className="w-full rounded-lg bg-white py-2 text-xs font-bold text-black">
                    Submit for review
                  </button>
                  <p className="text-[10px] text-white/40">
                    Clips become placeholders — buyers add their own media. Admins approve before it appears in the marketplace.
                  </p>
                </div>
              )}
              <button onClick={() => void saveNow()} className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/20 py-2.5 text-xs font-semibold">
                <Save className="h-4 w-4" /> Save project
              </button>
            </div>
          </div>
        )}
            </div>
          </section>
        </>
      )}

      {/* ---------- bottom tool tabs (safe-area aware) ---------- */}
      <nav
        className="sticky bottom-0 z-40 grid grid-cols-8 border-t border-white/10 bg-[#161616]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
        aria-label="Editor tools"
      >
        {(
          [
            ['media', <Film key="f" className="h-5 w-5" />],
            ['text', <Type key="t" className="h-5 w-5" />],
            ['overlays', <Layers key="o" className="h-5 w-5" />],
            ['audio', <Music key="m" className="h-5 w-5" />],
            ['motion', <Sparkles key="mo" className="h-5 w-5" />],
            ['look', <SlidersHorizontal key="l" className="h-5 w-5" />],
            ['ai', <Bot key="ai" className="h-5 w-5" />],
            ['export', <Upload key="e" className="h-5 w-5" />],
          ] as [Tool, React.ReactNode][]
        ).map(([id, icon]) => (
          <button
            key={id}
            onClick={() => {
              if (tool === id && toolDrawerOpen) setToolDrawerOpen(false);
              else openTool(id);
            }}
            className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-semibold focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#FFB6C1] ${tool === id ? 'text-[#FFB6C1]' : 'text-white/50'}`}
            aria-current={tool === id}
          >
            {icon}
            {TOOL_LABELS[id]}
          </button>
        ))}
      </nav>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[60] md:bottom-6 flex justify-center px-6">
          <p className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-black shadow-lg">{toast}</p>
        </div>
      )}
    </main>
  );
}

/* ---------- small helpers used above ---------- */

function Slider({ label, min, max, step = 1, value, onChange }: {
  label: string; min: number; max: number; step?: number; value: number; onChange: (v: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const clampValue = (v: number) => {
    const snapped = Math.round(v / step) * step;
    return Number(clampNum(snapped, min, max).toFixed(4));
  };
  const setFromClientX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    onChange(clampValue(min + ((clientX - rect.left) / rect.width) * (max - min)));
  };
  return (
    <label className="block select-none">
      <span className="mb-1.5 flex items-center justify-between text-[10px] font-semibold text-white/55">
        <span>{label}</span>
        <span className="rounded-full bg-white/[0.07] px-1.5 py-0.5 tabular-nums text-white/70">{Number(value.toFixed(2))}</span>
      </span>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          setFromClientX(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) setFromClientX(e.clientX);
        }}
        onKeyDown={(e) => {
          const delta = step * (e.shiftKey ? 10 : 1);
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onChange(clampValue(value - delta)); }
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onChange(clampValue(value + delta)); }
          if (e.key === 'Home') { e.preventDefault(); onChange(min); }
          if (e.key === 'End') { e.preventDefault(); onChange(max); }
        }}
        className="group relative h-7 w-full touch-none cursor-pointer"
      >
        <span className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/10" />
        <span className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[#E5798F]" style={{ width: `${((value - min) / Math.max(0.0001, max - min)) * 100}%` }} />
        <span className="absolute top-1/2 h-4 w-4 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-white bg-[#E5798F] shadow-lg transition-transform group-active:scale-110" style={{ left: `${((value - min) / Math.max(0.0001, max - min)) * 100}%` }} />
      </div>
    </label>
  );
}

/** Real thumbnail for a timeline clip block: first frame for videos,
    the image itself for images, a glyph for placeholders/stickers. */
function ClipThumb({ clip }: { clip: VideoClip }) {
  if (isPlaceholder(clip.src)) {
    return <span className="flex h-full w-full items-center justify-center text-lg text-white/30">⬚</span>;
  }
  if (/\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(clip.src) || clip.src.startsWith('data:image/')) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={clip.src} alt="" className="h-full w-full object-cover" />;
  }
  return (
    <video
      src={clip.src}
      preload="metadata"
      muted
      playsInline
      className="h-full w-full object-cover"
      aria-hidden="true"
    />
  );
}

/* ============================================================
   CropOverlay — the real crop workflow.
   The dimmed full-frame box is the clip/media's FULL source frame
   mapped onto the canvas; the bright inner window is the region
   that survives. Drag inside to move it, drag the 8 handles to
   resize it. Every change commits through onChange (coalesced
   history) so the live preview re-renders the crop EXACTLY as it
   will export. Nothing here is CSS pretending: drawFrame() crops
   the source itself via drawImage source-rect math.
   ============================================================ */
function CropWorkspace({ crop, sourceAspect, rotation: initialRotation, onChange, onAspect, onRotate, onFlip, onReset, onCancel, onApply }: {
  crop: CropRect | null;
  sourceAspect: number;
  rotation: number;
  onChange: (next: CropRect | null) => void;
  onAspect: (aspect: number | null) => void;
  onRotate: (rotation: number) => void;
  onFlip: (axis: 'horizontal' | 'vertical') => void;
  onReset: () => void;
  onCancel: () => void;
  onApply: () => void;
}) {
  const c = crop ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const [rotation, setRotation] = useState(initialRotation);
  useEffect(() => {
    setRotation(initialRotation);
  }, [initialRotation]);

  const aspectPresets = [
    { label: 'Original', value: null, icon: '◫' },
    { label: '16:9', value: 16 / 9, icon: '▭' },
    { label: '9:16', value: 9 / 16, icon: '▯' },
    { label: '1:1', value: 1, icon: '□' },
    { label: '4:5', value: 4 / 5, icon: '▯' },
    { label: '4:3', value: 4 / 3, icon: '▭' },
    { label: '3:2', value: 3 / 2, icon: '▭' },
    { label: '21:9', value: 21 / 9, icon: '▬' },
  ];

  const setRot = (v: number) => {
    const next = ((v + 180) % 360 + 360) % 360 - 180;
    setRotation(next);
    onRotate(next);
  };

  const beginRotateScrub = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    const update = (clientX: number) => {
      const ratio = clampNum((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      setRot(-180 + ratio * 360);
    };
    update(e.clientX);
  };

  return (
    <aside
      className="relative z-[55] mx-auto mt-2 w-full max-w-[520px] rounded-2xl border border-white/10 bg-[#0b0b0b]/98 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] text-white shadow-2xl backdrop-blur-xl md:pb-3"
      style={{ touchAction: 'pan-y' }}
      aria-label="Professional crop controls"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#E5798F]/15 text-[#FFB6C1]"><Crop className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Crop</p>
          <p className="text-[10px] text-white/40">Drag the frame. Pinch to resize. Two fingers rotate.</p>
        </div>
        <span className="rounded-full bg-white/[0.06] px-2 py-1 text-[10px] font-semibold text-white/55">{Math.round(rotation)}°</span>
      </div>

      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">Frame</p>
          <span className="text-[9px] text-white/30">No coordinates needed</span>
        </div>
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-1">
          {aspectPresets.map((p) => (
            <button
              key={p.label}
              onClick={() => onAspect(p.value)}
              aria-pressed={p.value == null ? !crop : Math.abs(croppedAspect(sourceAspect, c) - p.value) < 0.03}
              className="flex min-w-[58px] shrink-0 flex-col items-center gap-1 rounded-xl border border-white/10 bg-white/[0.045] px-2.5 py-2 text-[9px] font-semibold text-white/65 active:bg-[#E5798F]/20 aria-pressed:bg-[#E5798F]/20 aria-pressed:text-white"
            >
              <span className="text-base leading-none">{p.icon}</span>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 rounded-xl bg-white/[0.035] px-3 py-2.5">
        <div className="mb-1.5 flex items-center justify-between text-[9px] font-semibold text-white/40">
          <span>Straighten</span><span className="tabular-nums text-white/65">{Math.round(rotation)}°</span>
        </div>
        <div
          onPointerDown={beginRotateScrub}
          onPointerMove={(e) => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = clampNum((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
            setRot(-180 + ratio * 360);
          }}
          className="relative h-8 touch-none rounded-lg bg-white/[0.04]"
          role="slider"
          tabIndex={0}
          aria-label="Straighten"
          aria-valuemin={-180}
          aria-valuemax={180}
          aria-valuenow={rotation}
        >
          <div className="absolute inset-x-2 top-1/2 h-px bg-white/15" />
          <div className="absolute left-1/2 top-1/2 h-5 w-px -translate-y-1/2 bg-white/35" />
          <div className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/35" />
          <span className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#E5798F] shadow" style={{ left: `${((rotation + 180) / 360) * 100}%` }} />
        </div>
        <div className="mt-2 flex gap-1.5">
          <button onClick={() => setRot(rotation - 90)} className={`${EDITOR_ACTION_PILL} flex-1 justify-center`}>↶ 90°</button>
          <button onClick={() => setRot(rotation + 90)} className={`${EDITOR_ACTION_PILL} flex-1 justify-center`}>90° ↷</button>
          <button onClick={() => setRot(0)} className={`${EDITOR_ACTION_PILL} flex-1 justify-center`}>Reset</button>
        </div>
      </div>

      <div className="mt-2 flex gap-1.5">
        <button onClick={() => onFlip('horizontal')} className={`${EDITOR_ACTION_PILL} flex-1 justify-center`}><FlipHorizontal className="h-4 w-4" />Flip</button>
        <button onClick={() => onFlip('vertical')} className={`${EDITOR_ACTION_PILL} flex-1 justify-center`}><FlipVertical className="h-4 w-4" />Flip vertical</button>
        <button onClick={() => onChange(null)} className={`${EDITOR_ACTION_PILL} flex-1 justify-center`}>Full frame</button>
      </div>

      <div className="mt-3 flex gap-1.5 border-t border-white/10 pt-3">
        <button onClick={onCancel} className={`${EDITOR_ACTION_PILL} flex-1 justify-center`}>Cancel</button>
        <button onClick={onReset} className={`${EDITOR_ACTION_PILL} justify-center`}>Reset</button>
        <button onClick={onApply} className="flex-1 rounded-xl bg-[#E5798F] py-2.5 text-xs font-bold">Apply</button>
      </div>
    </aside>
  );
}
function CropOverlay({ base, crop, rotation = 0, onChange, onRotate, onApply, onCancel, onReset }: {
  base: { left: number; top: number; width: number; height: number };
  crop: CropRect | null;
  rotation?: number;
  onChange: (next: CropRect | null) => void;
  onRotate?: (degrees: number) => void;
  onApply: () => void;
  onCancel: () => void;
  onReset: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cropRef = useRef<CropRect>(crop ?? { top: 0, right: 0, bottom: 0, left: 0 });
  const rotationRef = useRef(rotation);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const singleRef = useRef<{ pointerId:number; mode:'move'|'n'|'s'|'e'|'w'|'ne'|'nw'|'se'|'sw'; startX:number; startY:number; startCrop:CropRect } | null>(null);
  const multiRef = useRef<{ distance:number; angle:number; center:{x:number;y:number}; crop:CropRect; rotation:number } | null>(null);

  useEffect(() => { cropRef.current = crop ?? { top: 0, right: 0, bottom: 0, left: 0 }; }, [crop]);
  useEffect(() => { rotationRef.current = rotation; }, [rotation]);

  const emitCrop = (next: CropRect) => {
    const safe = sanitizeCrop(next);
    cropRef.current = safe;
    onChange(safe);
  };

  const begin = (ev: React.PointerEvent) => {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    const target = ev.target as HTMLElement | null;
    if (target?.closest?.('button')) return; /* let Cancel/Reset/Apply clicks through untouched */
    const mode = (target?.closest?.('[data-crop-handle]') as HTMLElement | null)?.dataset.cropHandle as 'move'|'n'|'s'|'e'|'w'|'ne'|'nw'|'se'|'sw' || 'move';
    pointersRef.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointersRef.current.size === 1) {
      singleRef.current = { pointerId:ev.pointerId, mode, startX:ev.clientX, startY:ev.clientY, startCrop:{...cropRef.current} };
    } else if (pointersRef.current.size === 2) {
      const [a,b] = Array.from(pointersRef.current.values());
      const dx=b.x-a.x, dy=b.y-a.y;
      multiRef.current = {
        distance:Math.max(1,Math.hypot(dx,dy)),
        angle:Math.atan2(dy,dx)*180/Math.PI,
        center:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},
        crop:{...cropRef.current},
        rotation:rotationRef.current,
      };
      singleRef.current = null;
    }
    try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch {}
  };

  const move = (ev: React.PointerEvent) => {
    if (!pointersRef.current.has(ev.pointerId)) return;
    pointersRef.current.set(ev.pointerId,{x:ev.clientX,y:ev.clientY});
    const entries=Array.from(pointersRef.current.entries());
    if (entries.length >= 2 && multiRef.current) {
      ev.preventDefault();
      const [a,b]=entries.slice(0,2).map(([,p])=>p);
      const dx=b.x-a.x, dy=b.y-a.y;
      const distance=Math.max(1,Math.hypot(dx,dy));
      const angle=Math.atan2(dy,dx)*180/Math.PI;
      const center={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
      const rect=ev.currentTarget.getBoundingClientRect();
      if (!rect || rect.width<=0 || rect.height<=0) return;
      const start=multiRef.current;
      const zoom=clampNum(distance/start.distance,0.25,4);
      const sw=1-start.crop.left-start.crop.right;
      const sh=1-start.crop.top-start.crop.bottom;
      /* Pinching outward should zoom INTO the source, so the visible crop
         window becomes smaller. Pinching inward reveals more of the source. */
      const nw=clampNum(sw/zoom,0.06,1);
      const nh=clampNum(sh/zoom,0.06,1);
      const cx=clampNum((center.x-rect.left)/rect.width,0,1);
      const cy=clampNum((center.y-rect.top)/rect.height,0,1);
      let left=clampNum(cx-(cx-start.crop.left)*(nw/Math.max(.001,sw)),0,1-nw);
      let top=clampNum(cy-(cy-start.crop.top)*(nh/Math.max(.001,sh)),0,1-nh);
      emitCrop({left,right:1-left-nw,top,bottom:1-top-nh});
      if (onRotate) {
        const delta=normalizeCropAngle(angle-start.angle);
        if (Math.abs(delta)>0.15) {
          const next=((start.rotation+delta+180)%360+360)%360-180;
          rotationRef.current=next;
          onRotate(next);
        }
      }
      return;
    }
    const g=singleRef.current;
    if (!g || g.pointerId!==ev.pointerId) return;
    ev.preventDefault();
    const dx=(ev.clientX-g.startX)/Math.max(1,base.width);
    const dy=(ev.clientY-g.startY)/Math.max(1,base.height);
    let {top,right,bottom,left}=g.startCrop;
    const min=.06;
    if (g.mode==='move') {
      const sx=clampNum(dx,-left,right), sy=clampNum(dy,-top,bottom);
      left+=sx; right-=sx; top+=sy; bottom-=sy;
    } else {
      if(g.mode.includes('n')) top=clampNum(top+dy,0,1-bottom-min);
      if(g.mode.includes('s')) bottom=clampNum(bottom-dy,0,1-top-min);
      if(g.mode.includes('w')) left=clampNum(left+dx,0,1-right-min);
      if(g.mode.includes('e')) right=clampNum(right-dx,0,1-left-min);
    }
    emitCrop({top,right,bottom,left});
  };

  const end=(ev:React.PointerEvent)=>{
    pointersRef.current.delete(ev.pointerId);
    try { ev.currentTarget.releasePointerCapture(ev.pointerId); } catch {}
    if(pointersRef.current.size===0){singleRef.current=null;multiRef.current=null;}
    else if(pointersRef.current.size===1){
      const [id,p]=Array.from(pointersRef.current.entries())[0];
      singleRef.current={pointerId:id,mode:'move',startX:p.x,startY:p.y,startCrop:{...cropRef.current}};
      multiRef.current=null;
    }
  };

  const current=cropRef.current;
  const inner={
    left:base.left+current.left*base.width,
    top:base.top+current.top*base.height,
    width:Math.max(8,(1-current.left-current.right)*base.width),
    height:Math.max(8,(1-current.top-current.bottom)*base.height),
  };

  return (
    <div
      ref={ref}
      className="absolute inset-0 z-[70] overflow-hidden pointer-events-none"
      role="dialog"
      aria-label="Crop editor"
    >
      <div className="pointer-events-none absolute inset-0 bg-black/[0.18]" />
      <div
        className="pointer-events-auto absolute overflow-visible"
        style={{left:base.left,top:base.top,width:base.width,height:base.height,touchAction:'none'}}
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
      <div className="pointer-events-none absolute border-2 border-white shadow-[0_0_0_1px_rgba(255,255,255,0.25)]" style={{left:current.left*base.width,top:current.top*base.height,width:Math.max(8,(1-current.left-current.right)*base.width),height:Math.max(8,(1-current.top-current.bottom)*base.height)}}>
        <div className="absolute inset-0">
          <div className="absolute inset-y-0 left-1/3 w-px bg-white/30" />
          <div className="absolute inset-y-0 left-2/3 w-px bg-white/30" />
          <div className="absolute inset-x-0 top-1/3 h-px bg-white/30" />
          <div className="absolute inset-x-0 top-2/3 h-px bg-white/30" />
        </div>
        {([
          ['nw','-left-5 -top-5 cursor-nwse-resize'],['ne','-right-5 -top-5 cursor-nesw-resize'],
          ['sw','-left-5 -bottom-5 cursor-nesw-resize'],['se','-right-5 -bottom-5 cursor-nwse-resize']
        ] as const).map(([mode,cls]) => (
          <span key={mode} data-crop-handle={mode} className={"absolute z-20 h-11 w-11 touch-none rounded-md "+cls} role="slider" aria-label={"Resize crop "+mode}>
            <span className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-[4px] border-2 border-white bg-[#E5798F] shadow-lg" />
          </span>
        ))}
        {([
          ['n','left-1/2 top-0 h-10 w-14 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize'],['s','left-1/2 bottom-0 h-10 w-14 -translate-x-1/2 translate-y-1/2 cursor-ns-resize'],
          ['w','top-1/2 left-0 h-14 w-10 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize'],['e','top-1/2 right-0 h-14 w-10 translate-x-1/2 -translate-y-1/2 cursor-ew-resize']
        ] as const).map(([mode,cls]) => (
          <span key={mode} data-crop-handle={mode} className={"absolute z-20 touch-none "+cls} role="slider" aria-label={"Resize crop "+mode}>
            <span className="absolute left-1/2 top-1/2 h-1.5 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow" />
          </span>
        ))}
      </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
        <div className="rounded-full bg-black/65 px-3 py-1 text-[10px] font-semibold text-white/90 backdrop-blur">Drag · Pinch to zoom · Two fingers to move · Rotate</div>
      </div>
      <div className="pointer-events-auto absolute inset-x-0 bottom-2 flex items-center justify-center gap-2">
        <button onClick={onCancel} className="flex items-center gap-1 rounded-full border border-white/25 bg-black/75 px-4 py-2 text-xs font-semibold backdrop-blur"><X className="h-3.5 w-3.5" />Cancel</button>
        <button onClick={onReset} className="rounded-full border border-white/25 bg-black/75 px-4 py-2 text-xs font-semibold backdrop-blur">Reset</button>
        <button onClick={onApply} className="flex items-center gap-1 rounded-full bg-[#E5798F] px-4 py-2 text-xs font-bold text-white shadow"><Check className="h-3.5 w-3.5" />Apply</button>
      </div>
    </div>
  );
}

function normalizeCropAngle(value:number){let r=value%360;if(r>180)r-=360;if(r<-180)r+=360;return r;}
/** Recently exported/imported studio media — fills template placeholders without re-uploading. */
function LibraryPicker({ meId, onPick }: {
  meId: string | null;
  onPick: (item: { url: string; media_type: string; duration_seconds: number | null }) => Promise<void> | void;
}) {
  const [items, setItems] = useState<{ id: string; url: string; media_type: string; duration_seconds: number | null }[]>([]);

  useEffect(() => {
    if (!meId) return;
    supabase
      .from('media_library')
      .select('id, url, media_type, duration_seconds')
      .eq('user_id', meId)
      .order('created_at', { ascending: false })
      .limit(12)
      .then(({ data }) => setItems((data || []) as never));
  }, [meId]);

  if (items.length === 0) return null;
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {items.map((it) => (
        <button key={it.id} onClick={() => void onPick(it)} className="aspect-square overflow-hidden rounded-lg border border-white/15" aria-label="Use this media">
          {it.media_type === 'video' ? (
            <video src={it.url} muted preload="metadata" className="h-full w-full object-cover" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={it.url} alt="" className="h-full w-full object-cover" />
          )}
        </button>
      ))}
    </div>
  );
}

function ElementInspector({ el, duration, playhead, updateElement, onChange, onDuplicate, onDelete, onCrop }: {
  el: TimelineElement;
  duration: number;
  /** project-time playhead (s) — keyframes are captured at the playhead */
  playhead: number;
  /** direct element updater (used for keyframe edits) */
  updateElement: (id: string, patch: Partial<TimelineElement>, label: string, coalesceKey?: string) => void;
  onChange: (patch: Partial<TimelineElement>, label: string, coalesceKey?: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onCrop: () => void;
}) {
  /* ---- keyframes ---- */
  const elActive = playhead >= el.start && playhead < el.end;
  const timeIn = Math.max(0, Math.min(el.end - el.start, playhead - el.start));
  const keyframeProps = KEYFRAMABLE_PROPERTIES.filter((p) =>
    p.id === 'volume_kf' ? el.kind === 'video' : true
  );

  const addKeyframe = (prop: KeyframeProperty) => {
    const base = resolveElementValues(el, timeIn);
    const value = prop === 'pos_x_kf' ? base.x : prop === 'pos_y_kf' ? base.y : prop === 'scale_kf' ? base.scale : prop === 'rotation_kf' ? base.rotation : prop === 'opacity_kf' ? base.opacity : base.volume;
    updateElement(el.id, { keyframes: upsertKeyframe(el, prop, timeIn, value) }, `Add ${prop} keyframe`, `kf-${el.id}-${prop}`);
  };
  const removeKeyframeAt = (prop: KeyframeProperty) => {
    const list = el.keyframes?.[prop] || [];
    const hit = list.find((k) => Math.abs(k.t - timeIn) < 0.05);
    if (hit) updateElement(el.id, { keyframes: removeKeyframe(el, prop, hit.id) }, `Remove ${prop} keyframe`, `kf-${el.id}-${prop}`);
  };

  return (
    <div className="space-y-2 rounded-xl bg-white/5 p-3 text-xs">
      <div className="flex items-center gap-2">
        <span className="flex-1 font-semibold capitalize">{el.kind} overlay{el.crop ? ' · cropped' : ''}</span>
        {(el.kind === 'image' || el.kind === 'video') && (
          <button onClick={onCrop} className="rounded-lg bg-white/10 p-2" aria-label="Crop overlay media" title="Crop"><Crop className="h-3.5 w-3.5" /></button>
        )}
        <button onClick={onDuplicate} className="rounded-lg bg-white/10 p-2" aria-label="Duplicate overlay"><Copy className="h-3.5 w-3.5" /></button>
        <button onClick={onDelete} className="rounded-lg bg-red-500/20 p-2 text-red-200" aria-label="Delete overlay"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>

      {elActive ? (
        <details className="rounded-lg bg-white/5 p-2">
          <summary className="cursor-pointer select-none text-[11px] font-semibold text-white/70">
            Keyframes {(el.keyframes && Object.keys(el.keyframes).length) ? `· ${Object.values(el.keyframes).reduce((a, l) => a + (l?.length || 0), 0)}` : ''}
          </summary>
          <p className="mt-1 text-[10px] leading-snug text-white/45">
            Move the playhead, set the property, then “Add”. Values interpolate between keyframes in preview AND export.
          </p>
          <div className="mt-1.5 space-y-1.5">
            {keyframeProps.map((p) => {
              const list = el.keyframes?.[p.id] || [];
              const atPlayhead = list.some((k) => Math.abs(k.t - timeIn) < 0.05);
              return (
                <div key={p.id} className="flex items-center gap-1.5">
                  <span className="w-16 shrink-0 text-white/60">{p.label}</span>
                  <span className="flex-1 text-[10px] text-white/40">{list.length ? `${list.length} kf` : '—'}</span>
                  <button
                    onClick={() => (atPlayhead ? removeKeyframeAt(p.id) : addKeyframe(p.id))}
                    aria-pressed={atPlayhead}
                    className={`rounded px-2 py-1 text-[10px] font-semibold ${atPlayhead ? 'bg-[#E5798F] text-white' : 'bg-white/10 text-white/80'}`}
                    title={atPlayhead ? 'Remove keyframe at playhead' : 'Capture value at playhead'}
                  >
                    {atPlayhead ? 'Remove' : 'Add'}
                  </button>
                </div>
              );
            })}
          </div>
        </details>
      ) : (
        <p className="rounded bg-white/5 px-2 py-1.5 text-[10px] text-white/40">Move the playhead over this overlay to edit keyframes.</p>
      )}

      {el.kind === 'text' && (
        <>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-white/60">Text content</span>
              <span className="text-[10px] tabular-nums text-white/30">{el.content.length} chars</span>
            </div>
            <textarea
              value={el.content}
              onChange={(e) => onChange({ content: e.target.value }, 'Edit text', `txt-${el.id}`)}
              rows={5}
              className="min-h-32 w-full resize-y rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm leading-6 text-white outline-none transition focus:border-[#E5798F]/70 focus:ring-2 focus:ring-[#E5798F]/20"
              aria-label="Text content"
              placeholder="Type your title, caption, subtitle, or body text…"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Slider label="Size" min={16} max={140} value={el.font_size || 48} onChange={(v) => onChange({ font_size: v }, 'Text size', `fs-${el.id}`)} />
            <label className="space-y-1">
              <span className="text-white/60">Color</span>
              <input type="color" value={el.color || '#FFFFFF'} onChange={(e) => onChange({ color: e.target.value }, 'Text color', `tc-${el.id}`)} className="h-8 w-full rounded bg-white/10" aria-label="Text color" />
            </label>
            <label className="space-y-1">
              <span className="text-white/60">Font</span>
              <select value={el.font_family || 'Poppins, sans-serif'} onChange={(e) => onChange({ font_family: e.target.value }, 'Text font')} className="w-full rounded bg-white/10 px-2 py-1.5" aria-label="Font family">
                {['Poppins, sans-serif', 'Inter, sans-serif', 'Georgia, serif', 'Courier New, monospace'].map((f) => <option key={f} value={f} className="text-black">{f.split(',')[0]}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-white/60">Weight</span>
              <select value={el.font_weight || 700} onChange={(e) => onChange({ font_weight: Number(e.target.value) }, 'Text weight')} className="w-full rounded bg-white/10 px-2 py-1.5" aria-label="Font weight">
                {[400, 600, 700, 800].map((w) => <option key={w} value={w} className="text-black">{w}</option>)}
              </select>
            </label>
            <div className="space-y-1">
              <span className="text-white/60">Align</span>
              <div className="flex gap-1">
                {(['left', 'center', 'right'] as const).map((a) => (
                  <button
                    key={a}
                    onClick={() => onChange({ align: a }, 'Text align')}
                    aria-pressed={el.align === a}
                    aria-label={`Align ${a}`}
                    className={`flex-1 rounded bg-white/10 py-1.5 capitalize ${el.align === a ? 'ring-1 ring-[#E5798F]' : ''}`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
            <label className="space-y-1">
              <span className="text-white/60">Stroke</span>
              <input
                type="color"
                value={el.stroke_color || '#000000'}
                onChange={(e) => onChange({ stroke_color: e.target.value }, 'Text stroke', `stk-${el.id}`)}
                className="h-8 w-full rounded bg-white/10"
                aria-label="Stroke color"
              />
            </label>
            <label className="space-y-1">
              <span className="text-white/60">Background</span>
              <input
                type="color"
                value={el.background || '#000000'}
                onChange={(e) => onChange({ background: e.target.value }, 'Text background', `bg-${el.id}`)}
                className="h-8 w-full rounded bg-white/10"
                aria-label="Text background color"
              />
            </label>
            <div className="space-y-1">
              <span className="text-white/60">Effects</span>
              <div className="flex gap-1">
                <button
                  onClick={() => onChange({ shadow: !el.shadow }, 'Toggle text shadow')}
                  aria-pressed={!!el.shadow}
                  className={`flex-1 rounded py-1.5 text-[11px] ${el.shadow ? 'bg-[#E5798F] text-white' : 'bg-white/10'}`}
                >
                  Shadow
                </button>
                <button
                  onClick={() => onChange({ background: el.background ? null : '#000000' }, el.background ? 'Clear text background' : 'Set text background')}
                  aria-pressed={!!el.background}
                  className={`flex-1 rounded py-1.5 text-[11px] ${el.background ? 'bg-[#E5798F] text-white' : 'bg-white/10'}`}
                >
                  Bg {el.background ? 'on' : 'off'}
                </button>
              </div>
            </div>
            <label className="space-y-1">
              <span className="text-white/60">Animation</span>
              <select value={el.animation || 'none'} onChange={(e) => onChange({ animation: e.target.value as TimelineElement['animation'] }, 'Text animation')} className="w-full rounded bg-white/10 px-2 py-1.5" aria-label="Text animation">
                {['none', 'fade', 'pop', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'zoom-in', 'zoom-out', 'bounce', 'typewriter', 'shake', 'blur-in', 'rotate-in', 'elastic', 'mask-wipe'].map((a) => <option key={a} value={a} className="text-black">{a}</option>)}
              </select>
            </label>
          </div>
        </>
      )}

      {(el.kind === 'image' || el.kind === 'video') && (
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-white/60">Object fit</span>
            <select
              value={el.object_fit || 'contain'}
              onChange={(e) => onChange({ object_fit: e.target.value === 'cover' ? 'cover' : 'contain' }, 'Overlay object fit')}
              className="w-full rounded bg-white/10 px-2 py-1.5"
              aria-label="Object fit"
            >
              <option value="contain" className="text-black">Contain</option>
              <option value="cover" className="text-black">Cover</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-white/60">Animation</span>
            <select value={el.animation || 'none'} onChange={(e) => onChange({ animation: e.target.value as TimelineElement['animation'] }, 'Overlay animation')} className="w-full rounded bg-white/10 px-2 py-1.5" aria-label="Overlay animation">
              {['none', 'fade', 'pop', 'slide-up'].map((a) => <option key={a} value={a} className="text-black">{a}</option>)}
            </select>
          </label>
        </div>
      )}

      {el.kind === 'video' && (
        <div className="grid grid-cols-2 gap-2">
          <Slider
            label="Trim start (s)"
            min={0}
            max={Math.max(0.2, (el.source_duration || 10) - 0.2)}
            step={0.1}
            value={el.trim_start || 0}
            onChange={(v) => onChange({ trim_start: v }, 'Overlay trim start', `ots-${el.id}`)}
          />
          <Slider
            label="Trim end (s)"
            min={(el.trim_start || 0) + 0.2}
            max={Math.max((el.trim_start || 0) + 0.4, el.source_duration || 10)}
            step={0.1}
            value={el.trim_end || el.source_duration || 5}
            onChange={(v) => onChange({ trim_end: v }, 'Overlay trim end', `ote-${el.id}`)}
          />
          <Slider
            label="Volume"
            min={0}
            max={1}
            step={0.05}
            value={el.volume ?? 1}
            onChange={(v) => onChange({ volume: v }, 'Overlay volume', `ov-${el.id}`)}
          />
          <div className="space-y-1">
            <span className="text-white/60">Audio</span>
            <button
              onClick={() => onChange({ muted: !el.muted }, el.muted ? 'Unmute overlay' : 'Mute overlay')}
              aria-pressed={!!el.muted}
              className={`flex w-full items-center justify-center gap-1 rounded py-1.5 ${el.muted ? 'bg-[#E5798F] text-white' : 'bg-white/10'}`}
            >
              {el.muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
              {el.muted ? 'Muted' : 'Sound on'}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Slider label="Start (s)" min={0} max={Math.max(duration, 1)} step={0.1} value={el.start} onChange={(v) => onChange({ start: v, end: Math.max(v + 0.2, el.end) }, 'Overlay start', `st-${el.id}`)} />
        <Slider label="End (s)" min={el.start + 0.2} max={Math.max(duration, 1)} step={0.1} value={el.end} onChange={(v) => onChange({ end: v }, 'Overlay end', `en-${el.id}`)} />
        <Slider label="Width" min={20} max={el.kind === 'text' ? 800 : 500} value={el.width} onChange={(v) => onChange({ width: v, height: el.kind === 'text' ? el.height : v * (el.height / el.width) }, 'Resize overlay', `w-${el.id}`)} />
        <Slider label="Rotation" min={-180} max={180} value={el.rotation} onChange={(v) => onChange({ rotation: v }, 'Rotate overlay', `r-${el.id}`)} />
        <Slider label="Opacity" min={10} max={100} value={el.opacity * 100} onChange={(v) => onChange({ opacity: v / 100 }, 'Overlay opacity', `o-${el.id}`)} />
        <Slider label="Layer (z)" min={1} max={20} value={el.z} onChange={(v) => onChange({ z: v }, 'Layer order')} />
      </div>
    </div>
  );
}

/* ============================================================
   FullscreenPreview — 100dvh, distraction-free playback of the
   CURRENT timeline (same drawFrame as the export). Chrome-free
   except the controls a viewer expects: play/pause, seek,
   restart, and exit. Tap/click the video or press Space to play.
   ============================================================ */
function FullscreenPreview(props: {
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  total: number;
  playing: boolean;
  playhead: number;
  aspect: string;
  onToggle: () => void;
  onSeek: (t: number) => void;
  onExit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black" role="dialog" aria-label="Fullscreen preview">
      {/* video area — everything else floats */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden" onClick={props.onToggle}>
        <canvas
          ref={props.canvasRef}
          className="block h-full max-h-full w-auto max-w-full object-contain"
          style={{ aspectRatio: props.aspect.replace(':', ' / ') }}
          aria-label="Fullscreen video preview — tap to play or pause"
        />
        {!props.playing && (
          <span className="pointer-events-none absolute flex h-20 w-20 items-center justify-center rounded-full bg-black/50 backdrop-blur">
            <Play className="h-9 w-9 text-white drop-shadow" />
          </span>
        )}
      </div>

      {/* top bar */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent px-4 py-3">
        <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white/80 backdrop-blur">
          Preview · {props.playhead.toFixed(1)}s / {props.total.toFixed(1)}s
        </span>
        <button
          onClick={props.onExit}
          aria-label="Exit fullscreen preview"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-white"
        >
          <Minimize2 className="h-5 w-5" />
        </button>
      </div>

      {/* transport — big touch targets, professional playback feel */}
      <div className="relative z-10 bg-gradient-to-t from-black/90 to-transparent px-4 pb-5 pt-8">
        <input
          type="range"
          min={0}
          max={Math.max(props.total, 0.1)}
          step={0.05}
          value={props.playhead}
          onChange={(e) => props.onSeek(Number(e.target.value))}
          aria-label="Seek"
          className="w-full accent-[#FFB6C1]"
          onClick={(e) => e.stopPropagation()}
        />
        <div className="mt-2 flex items-center justify-center gap-5">
          <button
            onClick={() => props.onSeek(0)}
            aria-label="Restart from beginning"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-white"
          >
            <SkipBack className="h-5 w-5" />
          </button>
          <button
            onClick={props.onToggle}
            aria-label={props.playing ? 'Pause' : 'Play'}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-black shadow-lg transition hover:scale-105 focus-visible:ring-2 focus-visible:ring-white"
          >
            {props.playing ? <Pause className="h-7 w-7" /> : <Play className="h-7 w-7" />}
          </button>
          <button
            onClick={props.onExit}
            aria-label="Back to editing"
            className="flex h-11 items-center gap-2 rounded-full bg-white/10 px-5 text-sm font-semibold text-white transition hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-white"
          >
            <Check className="h-4 w-4" /> Done
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] text-white/40">
          Tap the video or press Space to play · Esc to exit
        </p>
      </div>
    </div>
  );
}

export default function StudioVideoPage() {
  return (
    <Suspense fallback={<main className="flex min-h-[100dvh] items-center justify-center bg-[#111111] text-sm text-white/60">Loading editor…</main>}>
      <VideoEditor />
    </Suspense>
  );
}
