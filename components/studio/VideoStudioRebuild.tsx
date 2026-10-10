'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ChevronDown, Download, Film, FolderOpen, Gauge, Image as ImageIcon,
  Keyboard, Layers3, Maximize2, Mic, Minus, Music2, Pause, Play, Plus, Redo2,
  RotateCcw, Save, Scissors, Settings2, Sparkles, Trash2, Type, Undo2,
  Upload, Volume2, VolumeX, Wand2, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { uploadFile } from '@/lib/storage/upload';
import {
  DEFAULT_ADJUSTMENTS, DEFAULT_AUDIO_PROCESSING, DEFAULT_TRANSFORM, EFFECT_PRESETS,
  FILTER_PRESETS, TEXT_ANIMATION_PRESETS, clipDuration, emptyProject, makeVideoId,
  projectDuration, normalizeProject, resolveClipValues, resolveElementValues, sanitizeCrop,
  upsertClipKeyframe, upsertKeyframe,
  type AspectRatio, type AudioTrack, type KeyframeProperty, type TimelineElement,
  type VideoClip, type VideoProject,
} from '@/lib/video/project';
import {
  EXPORT_QUALITY_PRESETS, ExportCancelledError, VideoRenderer, defaultExportSettings,
  type ExportProgress, type ExportSettings,
} from '@/lib/video/renderer';
import { type CloudRenderResolution } from '@/lib/video/json2video';

type Selection =
  | { kind: 'clip'; id: string }
  | { kind: 'element'; id: string }
  | { kind: 'audio'; id: string }
  | null;

type Panel = 'media' | 'text' | 'audio' | 'speed' | 'transitions' | 'filters' | 'effects' | 'motion' | 'animation' | 'crop' | 'transform' | 'export' | null;

const PANEL_LABELS: Record<Exclude<Panel, null>, string> = {
  media: 'Media', text: 'Text', audio: 'Audio', speed: 'Speed', transitions: 'Transitions',
  filters: 'Filters', effects: 'Effects', motion: 'Motion', animation: 'Animation',
  crop: 'Crop', transform: 'Transform', export: 'Export',
};

function fmtTime(value: number) {
  const t = Math.max(0, value);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t % 1) * 10);
  return `${m}:${String(s).padStart(2, '0')}.${f}`;
}

function inferAspect(width: number, height: number): AspectRatio {
  return width >= height ? '16:9' : '9:16';
}

function mediaDuration(file: File): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    if (file.type.startsWith('image/')) {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ duration: 5, width: img.naturalWidth || 1080, height: img.naturalHeight || 1080 });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The image could not be decoded.')); };
      img.src = url;
      return;
    }
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 5;
      const width = video.videoWidth || 1280;
      const height = video.videoHeight || 720;
      URL.revokeObjectURL(url);
      resolve({ duration, width, height });
    };
    video.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The video could not be decoded by this browser.')); };
    video.src = url;
  });
}

function audioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const d = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 10;
      URL.revokeObjectURL(url);
      resolve(d);
    };
    audio.onerror = () => { URL.revokeObjectURL(url); resolve(10); };
    audio.src = url;
  });
}

function Button({
  children, active, onClick, title, disabled,
}: {
  children: React.ReactNode; active?: boolean; onClick?: () => void; title?: string; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition
        ${active ? 'border-[#ffb6c1] bg-[#ffb6c1] text-black' : 'border-white/10 bg-white/[0.055] text-white/80 hover:bg-white/[0.1]'}
        ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
    >
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-white/8 p-4">
      <h3 className="mb-3 text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">{title}</h3>
      {children}
    </section>
  );
}

function CloudIcon() { return <span className="grid h-4 w-4 place-items-center text-[10px] font-black">☁</span>; }

function Slider({
  label, value, min, max, step = 1, onChange,
}: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between text-[11px] text-white/65">
        <span>{label}</span><span>{Number(value).toFixed(step < 1 ? 2 : 0)}</span>
      </div>
      <input className="w-full accent-[#ffb6c1]" type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export default function VideoStudioRebuild() {
  const router = useRouter();
  const search = useSearchParams();
  const projectId = search.get('project');
  const isNew = search.get('new') === '1';

  const [project, setProject] = useState<VideoProject>(() => emptyProject());
  const projectRef = useRef(project);
  const [title, setTitle] = useState('Untitled project');
  const [userId, setUserId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(projectId);
  const [selection, setSelection] = useState<Selection>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [playhead, setPlayhead] = useState(0);
  const playheadRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [exportSettings, setExportSettings] = useState<ExportSettings>(() => ({ ...defaultExportSettings(emptyProject()), format: 'mp4' }));
  const [cloudRendering, setCloudRendering] = useState(false);
  const [cloudProgress, setCloudProgress] = useState(0);
  const [creatomateRendering, setCreatomateRendering] = useState(false);
  const [creatomateProgress, setCreatomateProgress] = useState(0);
  const [history, setHistory] = useState<VideoProject[]>([]);
  const [future, setFuture] = useState<VideoProject[]>([]);
  const [localSources, setLocalSources] = useState<Record<string, string>>({});
  const [selectedTrack, setSelectedTrack] = useState<'main' | 'overlay' | 'audio'>('main');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<VideoRenderer | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastUiTickRef = useRef(0);

  // Video decoding/seeking is asynchronous. Serialize preview renders so
  // multiple frames cannot race on the same canvas while a source is loading.
  const previewRenderBusyRef = useRef(false);
  const queuedPreviewRef = useRef<{ time: number; playing: boolean } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  useEffect(() => { projectRef.current = project; }, [project]);

  const commit = useCallback((next: VideoProject | ((p: VideoProject) => VideoProject)) => {
    setProject((previous) => {
      const value = typeof next === 'function' ? next(previous) : next;
      const normalized = normalizeProject(value);
      setHistory((h) => [...h.slice(-49), previous]);
      setFuture([]);
      projectRef.current = normalized;
      return normalized;
    });
  }, []);

  const replaceWithoutHistory = useCallback((next: VideoProject) => {
    const normalized = normalizeProject(next);
    projectRef.current = normalized;
    setProject(normalized);
  }, []);

  const selectedClip = selection?.kind === 'clip' ? project.clips.find((c) => c.id === selection.id) || null : null;
  const selectedElement = selection?.kind === 'element' ? project.elements.find((e) => e.id === selection.id) || null : null;
  const selectedAudio = selection?.kind === 'audio' ? project.audio.find((a) => a.id === selection.id) || null : null;

  const selectedLabel = selectedClip?.name || selectedElement?.content || selectedAudio?.name || 'Project';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!auth.user) { router.replace('/auth/sign-in'); return; }
      setUserId(auth.user.id);

      if (!projectId || isNew) return;
      const { data, error } = await supabase
        .from('video_projects')
        .select('id,title,project,aspect_ratio')
        .eq('id', projectId)
        .eq('user_id', auth.user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setMessage(error?.message || 'Project not found.');
        return;
      }
      setTitle(data.title || 'Untitled project');
      const loaded = normalizeProject(data.project);
      replaceWithoutHistory(loaded);
    })();
    return () => { cancelled = true; };
  }, [projectId, isNew, replaceWithoutHistory, router]);

  const render = useCallback(async (time = playheadRef.current, isPlaying = playingRef.current) => {
    queuedPreviewRef.current = { time: Math.max(0, time), playing: isPlaying };
    if (previewRenderBusyRef.current) return;

    previewRenderBusyRef.current = true;
    try {
      while (queuedPreviewRef.current) {
        const next = queuedPreviewRef.current;
        queuedPreviewRef.current = null;

        const canvas = canvasRef.current;
        if (!canvas) continue;
        if (!rendererRef.current) rendererRef.current = new VideoRenderer();

        const sourceMap = localSources;
        const current = projectRef.current;
        const renderProject: VideoProject = {
          ...current,
          clips: current.clips.map((clip) => sourceMap[clip.src] ? { ...clip, src: sourceMap[clip.src] } : clip),
          audio: current.audio.map((audio) => sourceMap[audio.src] ? { ...audio, src: sourceMap[audio.src] } : audio),
          elements: current.elements.map((el) => sourceMap[el.src || ''] ? { ...el, src: sourceMap[el.src || ''] } : el),
        };

        try {
          await rendererRef.current.drawFrame(
            canvas,
            renderProject,
            next.time,
            { previewing: !next.playing, playing: next.playing },
          );
        } catch (e) {
          setMessage(e instanceof Error ? e.message : 'Preview rendering failed.');
        }
      }
    } finally {
      previewRenderBusyRef.current = false;
      if (queuedPreviewRef.current) queueMicrotask(() => { void render(); });
    }
  }, [localSources]);

  useEffect(() => { void render(); }, [project, render]);

  useEffect(() => {
    playingRef.current = playing;
    if (!playing) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      void render(playheadRef.current, false);
      return;
    }
    const started = performance.now();
    const origin = playheadRef.current;
    const tick = () => {
      if (!playingRef.current) return;
      const duration = projectDuration(projectRef.current);
      const next = Math.min(duration, origin + (performance.now() - started) / 1000);
      playheadRef.current = next;
      if (performance.now() - lastUiTickRef.current > 80) {
        lastUiTickRef.current = performance.now();
        setPlayhead(next);
      }
      void render(next, true);
      if (next >= duration - 0.001) {
        playingRef.current = false;
        setPlaying(false);
        playheadRef.current = 0;
        setPlayhead(0);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); };
  }, [playing, render]);

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    Object.values(localSources).forEach((url) => { try { URL.revokeObjectURL(url); } catch {} });
  }, []);

  const setTime = (value: number) => {
    const next = Math.max(0, Math.min(projectDuration(projectRef.current), value));
    playheadRef.current = next;
    setPlayhead(next);
    void render(next, false);
  };

  const updateClip = (id: string, patch: Partial<VideoClip>) => commit((p) => ({
    ...p, clips: p.clips.map((c) => c.id === id ? { ...c, ...patch } : c),
  }));

  const updateElement = (id: string, patch: Partial<TimelineElement>) => commit((p) => ({
    ...p, elements: p.elements.map((e) => e.id === id ? { ...e, ...patch } : e),
  }));

  const updateAudio = (id: string, patch: Partial<AudioTrack>) => commit((p) => ({
    ...p, audio: p.audio.map((a) => a.id === id ? { ...a, ...patch } : a),
  }));

  const saveProject = async (silent = false) => {
    if (!userId) return;
    setBusy(true);
    setMessage(null);
    const payload = {
      user_id: userId,
      title: title.trim() || 'Untitled project',
      project,
      aspect_ratio: project.aspect,
      duration_seconds: projectDuration(project),
      project_version: 3,
      editor_version: 'enotes-video-rebuild-1',
      updated_at: new Date().toISOString(),
      deleted_at: null,
    };
    try {
      if (savedId) {
        const { error } = await supabase.from('video_projects').update(payload).eq('id', savedId).eq('user_id', userId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('video_projects').insert(payload).select('id').single();
        if (error || !data) throw error || new Error('Could not create project.');
        setSavedId(data.id);
        router.replace(`/studio/video?project=${data.id}`);
      }
      if (!silent) setMessage('Saved');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not save project.');
    } finally { setBusy(false); }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => { if (savedId && userId) void saveProject(true); }, 900);
    return () => window.clearTimeout(timer);
  }, [project, title, savedId, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const undo = () => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory((h) => h.slice(0, -1));
    setFuture((f) => [project, ...f].slice(0, 50));
    replaceWithoutHistory(previous);
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture((f) => f.slice(1));
    setHistory((h) => [...h, project].slice(-50));
    replaceWithoutHistory(next);
  };

  const addMedia = async (files: FileList | File[]) => {
    if (!userId) return;
    const list = Array.from(files);
    if (!list.length) return;
    setBusy(true);
    setMessage(null);
    try {
      let nextProject = projectRef.current;
      for (const file of list) {
        const isAudio = file.type.startsWith('audio/');
        const localUrl = URL.createObjectURL(file);
        const info = isAudio ? { duration: await audioDuration(file), width: 0, height: 0 } : await mediaDuration(file);
        const upload = await uploadFile(file, 'studio-media', userId);
        setLocalSources((map) => ({ ...map, [upload.url]: localUrl }));

        if (isAudio) {
          const trackId = nextProject.tracks.find((t) => t.kind === 'audio')?.id || 'track-audio';
          const audio: AudioTrack = {
            id: makeVideoId('audio'), name: file.name, src: upload.url, storage_path: upload.path,
            track_id: trackId, start: 0, sourceDuration: info.duration, trimStart: 0, trimEnd: info.duration,
            volume: 1, fadeIn: 0, fadeOut: 0, kind: 'music', audioProcessing: { ...DEFAULT_AUDIO_PROCESSING },
          };
          nextProject = { ...nextProject, audio: [...nextProject.audio, audio] };
          setSelection({ kind: 'audio', id: audio.id });
          continue;
        }

        if (nextProject.clips.length === 0) {
          const aspect = inferAspect(info.width, info.height);
          const canvas = aspect === '9:16' ? { width: 720, height: 1280 } : { width: 1280, height: 720 };
          nextProject = { ...nextProject, aspect, canvas };
        }

        const clipId = makeVideoId('clip');
        const clip: VideoClip = {
          id: clipId, src: upload.url, storage_path: upload.path, name: file.name,
          sourceDuration: info.duration, trimStart: 0, trimEnd: info.duration, speed: 1, volume: 1,
          muted: false, media_type: file.type.startsWith('image/') ? 'image' : 'video',
          transform: { ...DEFAULT_TRANSFORM }, adjustments: { ...DEFAULT_ADJUSTMENTS }, filter: 'none',
          effect: 'none', effect_intensity: 1, motion_preset: 'none', motion_amount: 1,
          transitionIn: { type: 'none', duration: 0.35 }, audioProcessing: { ...DEFAULT_AUDIO_PROCESSING },
          track_id: 'track-main', reverse: false,
        };
        nextProject = { ...nextProject, clips: [...nextProject.clips, clip] };
        setSelection({ kind: 'clip', id: clipId });
      }
      commit(nextProject);
      setPanel(null);
      setMessage(`${list.length} media item${list.length === 1 ? '' : 's'} added`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Media import failed.');
    } finally { setBusy(false); }
  };

  const addText = () => {
    const duration = Math.max(1, projectDuration(projectRef.current) || 5);
    const el: TimelineElement = {
      id: makeVideoId('text'), kind: 'text', content: 'Your text', src: null,
      start: Math.min(playheadRef.current, Math.max(0, duration - 0.5)),
      end: Math.min(duration, playheadRef.current + 3),
      x: project.canvas.width * 0.15, y: project.canvas.height * 0.42,
      width: project.canvas.width * 0.7, height: Math.min(180, project.canvas.height * 0.16),
      rotation: 0, opacity: 1, z: 100, font_size: Math.max(32, Math.round(project.canvas.width * 0.055)),
      font_family: 'Poppins, sans-serif', font_weight: 700, color: '#ffffff', align: 'center',
      background: null, stroke_color: null, shadow: true, stroke_width: 0, shadow_blur: 8,
      shadow_opacity: 0.55, background_radius: 18, background_padding: 0, letter_spacing: 0,
      line_height: 1.1, text_case: 'none', text_effect: 'none', animation: 'none',
      animation_in: 'fade', animation_out: 'none', animation_loop: 'none',
      animation_in_duration: 0.35, animation_out_duration: 0.3, animation_loop_amount: 1,
      text_preset: 'bold', track_id: 'track-overlay',
    };
    commit((p) => ({ ...p, elements: [...p.elements, el] }));
    setSelection({ kind: 'element', id: el.id });
    setPanel('text');
  };

  const addImageOverlay = async (file: File) => {
    if (!userId) return;
    setBusy(true);
    try {
      const localUrl = URL.createObjectURL(file);
      const info = await mediaDuration(file);
      const upload = await uploadFile(file, 'studio-media', userId);
      setLocalSources((map) => ({ ...map, [upload.url]: localUrl }));
      const el: TimelineElement = {
        id: makeVideoId('image'), kind: 'image', content: file.name, src: upload.url,
        storage_path: upload.path, start: playheadRef.current, end: playheadRef.current + Math.max(3, Math.min(8, projectDuration(projectRef.current) || 5)),
        x: project.canvas.width * 0.15, y: project.canvas.height * 0.15,
        width: project.canvas.width * 0.7, height: project.canvas.height * 0.7,
        rotation: 0, opacity: 1, z: 80, object_fit: 'contain', flip_h: false, flip_v: false,
        crop: null, track_id: 'track-overlay',
      };
      void info;
      commit((p) => ({ ...p, elements: [...p.elements, el] }));
      setSelection({ kind: 'element', id: el.id });
      setPanel(null);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Overlay import failed.'); }
    finally { setBusy(false); }
  };

  const deleteSelection = () => {
    if (!selection) return;
    if (selection.kind === 'clip') commit((p) => ({ ...p, clips: p.clips.filter((c) => c.id !== selection.id) }));
    if (selection.kind === 'element') commit((p) => ({ ...p, elements: p.elements.filter((e) => e.id !== selection.id) }));
    if (selection.kind === 'audio') commit((p) => ({ ...p, audio: p.audio.filter((a) => a.id !== selection.id) }));
    setSelection(null); setPanel(null);
  };

  const splitSelected = () => {
    if (!selectedClip) return;
    const start = project.clips.slice(0, project.clips.findIndex((c) => c.id === selectedClip.id)).reduce((s, c) => s + clipDuration(c), 0);
    const local = playheadRef.current - start;
    if (local <= 0.05 || local >= clipDuration(selectedClip) - 0.05 || selectedClip.reverse) {
      setMessage(selectedClip.reverse ? 'Split is temporarily disabled for reversed clips.' : 'Move the playhead inside the selected clip.');
      return;
    }
    const sourceSplit = selectedClip.trimStart + local * selectedClip.speed;
    const a = { ...selectedClip, trimEnd: Math.min(selectedClip.trimEnd, sourceSplit) };
    const b = { ...selectedClip, id: makeVideoId('clip'), trimStart: Math.max(selectedClip.trimStart, sourceSplit), transitionIn: { type: 'none' as const, duration: selectedClip.transitionIn.duration } };
    commit((p) => {
      const index = p.clips.findIndex((c) => c.id === selectedClip.id);
      const clips = [...p.clips]; clips.splice(index, 1, a, b);
      return { ...p, clips };
    });
    setSelection({ kind: 'clip', id: b.id });
  };

  const duplicateSelection = () => {
    if (selectedClip) {
      const copy = { ...selectedClip, id: makeVideoId('clip'), name: `${selectedClip.name} copy` };
      commit((p) => ({ ...p, clips: [...p.clips, copy] })); setSelection({ kind: 'clip', id: copy.id });
    } else if (selectedElement) {
      const copy = { ...selectedElement, id: makeVideoId('text'), x: selectedElement.x + 24, y: selectedElement.y + 24 };
      commit((p) => ({ ...p, elements: [...p.elements, copy] })); setSelection({ kind: 'element', id: copy.id });
    }
  };

  const addKeyframe = (prop: KeyframeProperty) => {
    if (selectedClip) {
      const start = project.clips.slice(0, project.clips.findIndex((c) => c.id === selectedClip.id)).reduce((s, c) => s + clipDuration(c), 0);
      const local = Math.max(0, playheadRef.current - start);
      const values = resolveClipValues(selectedClip, local);
      const value = prop === 'pos_x_kf' ? values.offset_x : prop === 'pos_y_kf' ? values.offset_y : prop === 'scale_kf' ? values.scale : prop === 'rotation_kf' ? values.rotation : prop === 'opacity_kf' ? values.opacity : prop === 'volume_kf' ? values.volume : 100;
      updateClip(selectedClip.id, { keyframes: upsertClipKeyframe(selectedClip, prop, local, value) });
      return;
    }
    if (selectedElement) {
      const local = Math.max(0, playheadRef.current - selectedElement.start);
      const values = resolveElementValues(selectedElement, local);
      const value = prop === 'pos_x_kf' ? values.x : prop === 'pos_y_kf' ? values.y : prop === 'scale_kf' ? values.scale : prop === 'rotation_kf' ? values.rotation : prop === 'opacity_kf' ? values.opacity : prop === 'volume_kf' ? values.volume : 100;
      updateElement(selectedElement.id, { keyframes: upsertKeyframe(selectedElement, prop, local, value) });
    }
  };

  const changeCanvas = (aspect: AspectRatio) => {
    const sizes: Record<string, { width: number; height: number }> = {
      '16:9': { width: 1280, height: 720 }, '9:16': { width: 720, height: 1280 }, '1:1': { width: 1080, height: 1080 },
      '4:5': { width: 1080, height: 1350 }, '3:2': { width: 1440, height: 960 }, '21:9': { width: 1680, height: 720 },
    };
    if (aspect === 'original') return;
    commit((p) => ({ ...p, aspect, canvas: sizes[aspect] }));
  };

  const downloadExport = async () => {
    if (!rendererRef.current) rendererRef.current = new VideoRenderer();
    setBusy(true); setPanel('export'); setMessage(null);
    try {
      // Export from the latest committed editor model, not the React render
      // that created this handler. This prevents exporting a stale effect stack
      // immediately after replacing a preset or restoring a project after refresh.
      const exportSnapshot = normalizeProject(projectRef.current);
      const renderProject: VideoProject = {
        ...exportSnapshot,
        clips: exportSnapshot.clips.map((c) => localSources[c.src] ? { ...c, src: localSources[c.src] } : c),
        audio: exportSnapshot.audio.map((a) => localSources[a.src] ? { ...a, src: localSources[a.src] } : a),
        elements: exportSnapshot.elements.map((e) => localSources[e.src || ''] ? { ...e, src: localSources[e.src || ''] } : e),
      };
      const result = await rendererRef.current.export(renderProject, exportSettings, setExportProgress);
      const a = document.createElement('a');
      a.href = result.url; a.download = `${(title || 'enotes-video').replace(/[^a-z0-9_-]+/gi, '-')}.${result.format.includes('mp4') ? 'mp4' : 'webm'}`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(result.url), 30000);
      setMessage('Local export complete');
    } catch (e) {
      if (e instanceof ExportCancelledError) setMessage('Export cancelled.');
      else setMessage(e instanceof Error ? e.message : 'Export failed.');
    } finally { setBusy(false); setExportProgress(null); }
  };

  const cloudExport = async () => {
    if (!project.clips.length) return;
    setBusy(true); setCloudRendering(true); setCloudProgress(5); setPanel('export'); setMessage('Starting cloud render…');
    try {
      const startResponse = await fetch('/api/video/render/json2video', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project: projectRef.current, resolutionHeight: exportSettings.resolutionHeight as CloudRenderResolution, bitrate: exportSettings.qualityBitrate }) });
      const started = await startResponse.json();
      if (!startResponse.ok || !started.project) throw new Error(started.error || 'JSON2Video could not start the render.');
      const renderProjectId = String(started.project);
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 2500));
        const pollResponse = await fetch('/api/video/render/json2video', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'status', renderProject: renderProjectId }) });
        const status = await pollResponse.json();
        if (!pollResponse.ok) throw new Error(status.error || 'Could not check cloud render status.');
        const movie = status.movie || status;
        const state = String(movie.status || '').toLowerCase();
        const progress = Number(movie.progress ?? movie.percent ?? 0);
        setCloudProgress(Math.min(95, Math.max(10, progress || 10 + Math.min(80, attempt))));
        if (state === 'done' && movie.url) {
          const a = document.createElement('a');
          a.href = movie.url; a.download = `${(title || 'enotes-video').replace(/[^a-z0-9_-]+/gi, '-')}-cloud.mp4`; a.target = '_blank'; a.rel = 'noopener'; a.click();
          setCloudProgress(100); setMessage('Cloud MP4 ready');
          return;
        }
        if (state === 'error' || state === 'failed') throw new Error(movie.message || movie.error || 'JSON2Video render failed.');
      }
      throw new Error('Cloud render timed out. The render may still be processing in JSON2Video.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Cloud export failed.'); }
    finally { setBusy(false); setCloudRendering(false); }
  };

  const creatomateExport = async () => {
    if (!project.clips.length) return;
    setBusy(true); setCreatomateRendering(true); setCreatomateProgress(5); setPanel('export'); setMessage('Starting Creatomate render…');
    try {
      const startResponse = await fetch('/api/video/render/creatomate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project: projectRef.current, resolutionHeight: exportSettings.resolutionHeight as 720 | 1080 | 1440 | 2160 }) });
      const started = await startResponse.json();
      if (!startResponse.ok || !started.id) throw new Error(started.error || 'Creatomate could not start the render.');
      const renderId = String(started.id);
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 2500));
        const pollResponse = await fetch('/api/video/render/creatomate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'status', renderId }) });
        const status = await pollResponse.json();
        if (!pollResponse.ok) throw new Error(status.error || 'Could not check Creatomate render status.');
        const state = String(status.status || '').toLowerCase();
        setCreatomateProgress(state === 'succeeded' ? 100 : Math.min(95, 10 + Math.round((attempt / 120) * 85)));
        if (state === 'succeeded' && status.url) {
          const a = document.createElement('a');
          a.href = status.url; a.download = (title || 'enotes-video').replace(/[^a-z0-9_-]+/gi, '-') + '-creatomate.mp4'; a.target = '_blank'; a.rel = 'noopener'; a.click();
          setCreatomateProgress(100); setMessage('Creatomate MP4 ready'); return;
        }
        if (state === 'failed') throw new Error(status.error_message || 'Creatomate render failed.');
      }
      throw new Error('Creatomate render timed out. The render may still be processing in Creatomate.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Creatomate export failed.'); }
    finally { setBusy(false); setCreatomateRendering(false); }
  };

  const onCanvasPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!selection || panel === 'crop') return;
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    const sx = project.canvas.width / rect.width;
    const sy = project.canvas.height / rect.height;
    const startX = e.clientX;
    const startY = e.clientY;
    const startClip = selectedClip ? { ...selectedClip.transform } : null;
    const startEl = selectedElement ? { x: selectedElement.x, y: selectedElement.y } : null;
    if (!startClip && !startEl) return;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) * sx;
      const dy = (ev.clientY - startY) * sy;
      if (selectedClip && startClip) updateClipDirect(selectedClip.id, {
        transform: { ...startClip, offset_x: startClip.offset_x + dx, offset_y: startClip.offset_y + dy },
      });
      if (selectedElement && startEl) updateElementDirect(selectedElement.id, { x: startEl.x + dx, y: startEl.y + dy });
    };
    const up = () => {
      target.releasePointerCapture?.(e.pointerId);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  const updateClipDirect = (id: string, patch: Partial<VideoClip>) => {
    setProject((p) => {
      const next = normalizeProject({ ...p, clips: p.clips.map((c) => c.id === id ? { ...c, ...patch } : c) });
      projectRef.current = next; return next;
    });
  };
  const updateElementDirect = (id: string, patch: Partial<TimelineElement>) => {
    setProject((p) => {
      const next = normalizeProject({ ...p, elements: p.elements.map((e) => e.id === id ? { ...e, ...patch } : e) });
      projectRef.current = next; return next;
    });
  };

  const total = Math.max(0.1, projectDuration(project));
  const timelineWidth = Math.max(900, total * 70 * zoom);
  const selectedKeys = useMemo(() => {
    if (selectedClip) return Object.values(selectedClip.keyframes || {}).flat();
    if (selectedElement) return Object.values(selectedElement.keyframes || {}).flat();
    return [];
  }, [selectedClip, selectedElement]);

  const contextual = selectedClip
    ? ['speed', 'transitions', 'transform', 'crop', 'filters', 'effects', 'motion', 'audio', 'split', 'duplicate', 'delete'] as const
    : selectedElement
      ? ['text', 'animation', 'transform', 'filters', 'effects', 'motion', 'duplicate', 'delete'] as const
      : selectedAudio
        ? ['audio', 'delete'] as const
        : ['media', 'text', 'audio', 'effects', 'export'] as const;

  const openContext = (action: typeof contextual[number]) => {
    if (action === 'split') return splitSelected();
    if (action === 'duplicate') return duplicateSelection();
    if (action === 'delete') return deleteSelection();
    if (action === 'text') return setPanel('text');
    if (action === 'speed') return setPanel('speed');
    if (action === 'transitions') return setPanel('transitions');
    if (action === 'filters') return setPanel('filters');
    if (action === 'animation') return setPanel('animation');
    if (action === 'transform') return setPanel('transform');
    if (action === 'crop') return setPanel('crop');
    if (action === 'effects') return setPanel('effects');
    if (action === 'motion') return setPanel('motion');
    if (action === 'audio') return setPanel('audio');
    if (action === 'media') return setPanel('media');
    if (action === 'export') return setPanel('export');
  };

  const renderSelectionBox = () => {
    if (!selection || (!selectedElement && !selectedClip)) return null;
    const c = project.canvas;
    if (selectedElement) {
      const left = (selectedElement.x / c.width) * 100;
      const top = (selectedElement.y / c.height) * 100;
      const width = (selectedElement.width / c.width) * 100;
      const height = (selectedElement.height / c.height) * 100;
      return <div className="pointer-events-none absolute border border-[#ffb6c1] shadow-[0_0_0_1px_rgba(0,0,0,.35)]" style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}>
        <span className="absolute -top-2 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[#ffb6c1]" />
        <span className="absolute -bottom-1.5 -right-1.5 h-3 w-3 rounded-sm border border-black bg-[#ffb6c1]" />
      </div>;
    }
    return <div className="pointer-events-none absolute inset-0 border border-[#ffb6c1]/70" />;
  };

  return (
    <main className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-[#0d0d0d] text-white" data-no-theme-scope>
      <input ref={fileInputRef} className="hidden" type="file" multiple accept="video/*,image/*" onChange={(e) => e.target.files && void addMedia(e.target.files)} />
      <input ref={audioInputRef} className="hidden" type="file" accept="audio/*" onChange={(e) => e.target.files?.[0] && void addMedia([e.target.files[0]])} />

      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-white/8 bg-[#101010] px-3">
        <button type="button" onClick={() => router.push('/studio')} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-white/8"><ArrowLeft className="h-4 w-4" /></button>
        <div className="min-w-0 flex-1">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full max-w-[320px] bg-transparent text-sm font-bold outline-none" aria-label="Project name" />
          <div className="text-[9px] text-white/35">{busy ? 'Working…' : message || 'Saved locally in the editor state'}</div>
        </div>
        <Button onClick={undo} disabled={!history.length} title="Undo"><Undo2 className="h-4 w-4" /></Button>
        <Button onClick={redo} disabled={!future.length} title="Redo"><Redo2 className="h-4 w-4" /></Button>
        <Button onClick={() => void saveProject()}><Save className="h-4 w-4" /> Save</Button>
        <Button active={panel === 'export'} onClick={() => setPanel('export')}><Download className="h-4 w-4" /> Export</Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-16 shrink-0 flex-col items-center gap-2 border-r border-white/8 bg-[#101010] py-3 lg:flex">
          {[
            ['media', FolderOpen], ['text', Type], ['audio', Music2], ['speed', Gauge], ['transitions', Film], ['filters', ImageIcon], ['effects', Wand2], ['motion', Sparkles], ['animation', RotateCcw], ['export', Download],
          ].map(([id, Icon]) => (
            <button key={String(id)} type="button" onClick={() => setPanel(id as Panel)}
              className={`grid h-12 w-12 place-items-center rounded-xl text-[9px] ${panel === id ? 'bg-white/10 text-[#ffb6c1]' : 'text-white/50 hover:bg-white/5'}`}>
              {React.createElement(Icon as React.ElementType, { className: 'h-5 w-5' })}
              <span>{PANEL_LABELS[id as Exclude<Panel, null>]}</span>
            </button>
          ))}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#080808] p-3 sm:p-6">
                <div
                  className="relative flex max-h-full max-w-full items-center justify-center"
                  style={{
                    aspectRatio: `${project.canvas.width}/${project.canvas.height}`,
                    width: 'min(100%, 980px)',
                    height: 'auto',
                    minWidth: 1,
                    minHeight: 1,
                  }}
                >
                  <div
                    className="relative h-full w-full overflow-visible rounded-md bg-black shadow-2xl"
                    style={{ aspectRatio: `${project.canvas.width}/${project.canvas.height}` }}
                    onPointerDown={onCanvasPointer}
                  >
                    <canvas
                      ref={canvasRef}
                      width={project.canvas.width}
                      height={project.canvas.height}
                      className="block h-full w-full rounded-md"
                      style={{ display: 'block' }}
                    />
                    {renderSelectionBox()}
                    {!project.clips.length && !project.elements.length && (
                      <button type="button" onClick={() => setPanel('media')} className="absolute inset-0 grid place-items-center text-white/45">
                        <span className="rounded-2xl border border-dashed border-white/15 bg-black/40 px-6 py-5 text-center">
                          <Upload className="mx-auto mb-2 h-6 w-6" /><strong className="block text-sm text-white/80">Import your first clip</strong><span className="text-xs">The canvas will follow the first media orientation.</span>
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="shrink-0 border-y border-white/8 bg-[#111]">
                <div className="flex items-center gap-2 overflow-x-auto px-3 py-2">
                  <Button onClick={() => setPlaying((v) => !v)}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</Button>
                  <Button onClick={() => setTime(0)}>0:00</Button>
                  <span className="font-mono text-xs text-white/70">{fmtTime(playhead)} / {fmtTime(total)}</span>
                  <div className="ml-auto flex items-center gap-1">
                    <Button onClick={() => setZoom((z) => Math.max(.5, z - .25))}><ZoomOut className="h-4 w-4" /></Button>
                    <Button onClick={() => setZoom((z) => Math.min(4, z + .25))}><ZoomIn className="h-4 w-4" /></Button>
                  </div>
                </div>
                <div ref={timelineRef} className="relative max-h-[240px] min-h-[150px] overflow-auto overscroll-contain px-2 pb-3">
                  <div className="relative" style={{ width: timelineWidth }}>
                    <div className="sticky top-0 z-20 h-6 bg-[#111]">
                      <div className="absolute inset-y-0 left-16 right-0" onPointerDown={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setTime((e.clientX - rect.left) / (70 * zoom));
                      }}>
                        {Array.from({ length: Math.ceil(total) + 1 }).map((_, i) => <span key={i} className="absolute top-1 text-[8px] text-white/25" style={{ left: i * 70 * zoom }}>{fmtTime(i)}</span>)}
                      </div>
                    </div>

                    {[
                      { kind: 'video' as const, label: 'VIDEO', items: project.clips, color: 'bg-[#e5798f]' },
                      { kind: 'overlay' as const, label: 'OVERLAY', items: project.elements, color: 'bg-[#7e8cff]' },
                      { kind: 'audio' as const, label: 'AUDIO', items: project.audio, color: 'bg-[#55c7a6]' },
                    ].map((lane) => (
                      <div key={lane.kind} className="relative flex min-h-[48px] border-t border-white/6">
                        <button type="button" onClick={() => setSelectedTrack(lane.kind === 'video' ? 'main' : lane.kind === 'audio' ? 'audio' : 'overlay')}
                          className="sticky left-0 z-10 w-16 shrink-0 bg-[#111] text-left text-[9px] font-bold tracking-wider text-white/35">{lane.label}</button>
                        <div className="relative flex-1">
                          {lane.items.map((item: any, index: number) => {
                            const start = lane.kind === 'video'
                              ? project.clips.slice(0,index).reduce((s,c)=>s+clipDuration(c),0)
                              : lane.kind === 'overlay' ? item.start : item.start;
                            const duration = lane.kind === 'video' ? clipDuration(item) : lane.kind === 'overlay' ? Math.max(.2,item.end-item.start) : Math.max(.2,item.trimEnd-item.trimStart);
                            const selected = selection?.id === item.id;
                            return (
                              <button key={item.id} type="button" onClick={() => { setSelection({ kind: lane.kind === 'video' ? 'clip' : lane.kind === 'overlay' ? 'element' : 'audio', id: item.id } as Selection); setPanel(null); setTime(start); }}
                                className={`absolute top-1 h-10 overflow-hidden rounded-md border px-2 text-left text-[9px] font-semibold ${selected ? 'border-white ring-1 ring-[#ffb6c1]' : 'border-white/10'} ${lane.color}`}
                                style={{ left: start * 70 * zoom, width: Math.max(34, duration * 70 * zoom) }}>
                                <span className="block truncate">{item.name || item.content || 'Layer'}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}

                    {selectedKeys.map((key: any) => (
                      <span key={key.id} className="absolute bottom-1 h-2 w-2 rounded-full bg-yellow-300" style={{ left: 64 + (key.t + (selectedClip ? project.clips.slice(0, project.clips.findIndex(c=>c.id===selectedClip.id)).reduce((s,c)=>s+clipDuration(c),0) : selectedElement?.start || 0)) * 70 * zoom }} />
                    ))}
                    <div className="pointer-events-none absolute bottom-0 top-6 w-px bg-[#ffb6c1]" style={{ left: 64 + playhead * 70 * zoom }} />
                  </div>
                </div>
              </div>

              <div className="shrink-0 overflow-x-auto border-b border-white/8 bg-[#101010] px-2 py-2 lg:hidden">
                <div className="flex gap-1.5">
                  {contextual.map((action) => (
                    <Button key={action} onClick={() => openContext(action as any)}>
                      {action === 'delete' ? <Trash2 className="h-4 w-4" /> : action === 'split' ? <Scissors className="h-4 w-4" /> : action === 'text' ? <Type className="h-4 w-4" /> : action === 'audio' ? <Volume2 className="h-4 w-4" /> : action === 'effects' ? <Wand2 className="h-4 w-4" /> : action === 'motion' ? <Sparkles className="h-4 w-4" /> : action === 'crop' ? <Maximize2 className="h-4 w-4" /> : <Settings2 className="h-4 w-4" />}
                      {action}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            {panel && (
              <aside className="absolute inset-y-0 right-0 z-30 w-[min(92vw,360px)] border-l border-white/8 bg-[#121212] shadow-2xl lg:relative lg:w-[360px] lg:shadow-none">
                <div className="flex h-12 items-center gap-2 border-b border-white/8 px-3">
                  <strong className="flex-1 text-sm">{PANEL_LABELS[panel]}</strong>
                  <button type="button" onClick={() => setPanel(null)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white/8"><X className="h-4 w-4" /></button>
                </div>
                <div className="h-[calc(100%-3rem)] overflow-y-auto">
                  {panel === 'media' && <Section title="Import"><div className="grid gap-2">
                    <Button onClick={() => fileInputRef.current?.click()}><Upload className="h-4 w-4" /> Video / Photo</Button>
                    <Button onClick={() => audioInputRef.current?.click()}><Music2 className="h-4 w-4" /> Audio</Button>
                    <Button onClick={addText}><Type className="h-4 w-4" /> Text</Button>
                  </div></Section>}

                  {panel === 'text' && selectedElement && <><Section title="Content"><textarea value={selectedElement.content} onChange={(e) => updateElement(selectedElement.id,{content:e.target.value})} className="min-h-24 w-full rounded-xl border border-white/10 bg-white/5 p-3 text-sm outline-none focus:border-[#ffb6c1]" /></Section>
                    <Section title="Typography"><div className="space-y-4">
                      <Slider label="Size" min={12} max={320} value={selectedElement.font_size || 48} onChange={(v)=>updateElement(selectedElement.id,{font_size:v})}/>
                      <Slider label="Letter spacing" min={-10} max={30} value={selectedElement.letter_spacing || 0} onChange={(v)=>updateElement(selectedElement.id,{letter_spacing:v})}/>
                      <label className="flex items-center justify-between text-xs text-white/70">Color<input type="color" value={selectedElement.color || '#ffffff'} onChange={(e)=>updateElement(selectedElement.id,{color:e.target.value})}/></label>
                      <div className="flex gap-2"><Button active={selectedElement.font_weight === 700} onClick={()=>updateElement(selectedElement.id,{font_weight:700})}>Bold</Button><Button active={selectedElement.font_weight === 400} onClick={()=>updateElement(selectedElement.id,{font_weight:400})}>Regular</Button></div>
                    </div></Section>
                    <Section title="Timing"><Slider label="Start" min={0} max={Math.max(0, total-.2)} step={.1} value={selectedElement.start} onChange={(v)=>updateElement(selectedElement.id,{start:Math.min(v,selectedElement.end-.1)})}/><Slider label="End" min={selectedElement.start+.1} max={total} step={.1} value={Math.min(selectedElement.end,total)} onChange={(v)=>updateElement(selectedElement.id,{end:Math.max(v,selectedElement.start+.1)})}/></Section>
                  </>}

                  {panel === 'audio' && selectedAudio && <><Section title="Audio"><Slider label="Volume" min={0} max={1} step={.01} value={selectedAudio.volume} onChange={(v)=>updateAudio(selectedAudio.id,{volume:v})}/><Slider label="Start" min={0} max={total} step={.1} value={selectedAudio.start} onChange={(v)=>updateAudio(selectedAudio.id,{start:v})}/><Slider label="Fade in" min={0} max={5} step={.1} value={selectedAudio.fadeIn} onChange={(v)=>updateAudio(selectedAudio.id,{fadeIn:v})}/><Slider label="Fade out" min={0} max={5} step={.1} value={selectedAudio.fadeOut} onChange={(v)=>updateAudio(selectedAudio.id,{fadeOut:v})}/></Section></>}
                  {panel === 'audio' && selectedClip && <><Section title="Original video audio"><Slider label="Volume" min={0} max={1} step={.01} value={selectedClip.volume} onChange={(v)=>updateClip(selectedClip.id,{volume:v})}/><div className="mt-3 flex gap-2"><Button active={selectedClip.muted} onClick={()=>updateClip(selectedClip.id,{muted:!selectedClip.muted})}>{selectedClip.muted ? <VolumeX className="h-4 w-4"/> : <Volume2 className="h-4 w-4"/>}{selectedClip.muted ? 'Muted' : 'Audio on'}</Button></div></Section></>}

                  {panel === 'speed' && selectedClip && <><Section title="Playback speed"><p className="mb-3 text-xs text-white/45">The source audio follows this clip's speed. Timeline duration updates automatically.</p><div className="grid grid-cols-4 gap-2">{[0.25,0.5,1,1.5,2,3,4].map((rate)=><button key={rate} type="button" onClick={()=>updateClip(selectedClip.id,{speed:rate})} className={`rounded-lg border p-2 text-xs font-semibold ${Math.abs(selectedClip.speed-rate)<0.001?'border-[#ffb6c1] bg-[#ffb6c1]/10':'border-white/10 bg-white/5'}`}>{rate}×</button>)}</div><div className="mt-4"><Slider label="Custom speed" min={0.25} max={4} step={0.05} value={selectedClip.speed} onChange={(v)=>updateClip(selectedClip.id,{speed:v})}/></div><div className="mt-4 rounded-lg bg-white/5 p-3 text-xs text-white/60">Effective duration: <strong className="text-white">{fmtTime(clipDuration(selectedClip))}</strong></div></Section></>}

                  {panel === 'transitions' && selectedClip && <><Section title="Transition into this clip"><p className="mb-3 text-xs text-white/45">Choose the transition from the previous clip into the selected clip.</p><div className="grid grid-cols-2 gap-2">{(['none','fade','crossfade','slide','zoom','wipe','dip-black','push','blur','zoom-blur','whip-pan','spin','luma-wipe','glitch-cut','film-burn'] as const).map((type)=><button key={type} type="button" onClick={()=>updateClip(selectedClip.id,{transitionIn:{...selectedClip.transitionIn,type}})} className={`rounded-lg border p-2 text-left text-xs ${selectedClip.transitionIn.type===type?'border-[#ffb6c1] bg-[#ffb6c1]/10':'border-white/10 bg-white/5'}`}>{type.replaceAll('-',' ')}</button>)}</div><div className="mt-4"><Slider label="Duration" min={0.05} max={Math.max(0.1,Math.min(3,clipDuration(selectedClip)))} step={0.05} value={Math.min(selectedClip.transitionIn.duration,Math.max(0.1,Math.min(3,clipDuration(selectedClip))))} onChange={(v)=>updateClip(selectedClip.id,{transitionIn:{...selectedClip.transitionIn,duration:v}})}/></div></Section></>}

                  {panel === 'filters' && selectedClip && <><Section title="Color filters"><div className="grid grid-cols-3 gap-2">{FILTER_PRESETS.map((f)=><button key={f.id} type="button" onClick={()=>updateClip(selectedClip.id,{filter:f.id})} className={`rounded-lg border p-2 text-left text-[10px] ${selectedClip.filter===f.id?'border-[#ffb6c1] bg-[#ffb6c1]/10':'border-white/10 bg-white/5'}`}>{f.name}</button>)}</div></Section><Section title="Color adjustments"><div className="space-y-4">{([['brightness','Brightness',0,200],['contrast','Contrast',0,200],['saturate','Saturation',0,200],['hue','Hue',-180,180],['blur','Blur',0,30],['temperature','Temperature',-100,100],['vignette','Vignette',0,100],['grain','Grain',0,100]] as const).map(([key,label,min,max])=><Slider key={key} label={label} min={min} max={max} step={1} value={(selectedClip.adjustments as any)[key] ?? (key==='brightness'||key==='contrast'||key==='saturate'?100:0)} onChange={(v)=>updateClip(selectedClip.id,{adjustments:{...selectedClip.adjustments,[key]:v}})}/>)}</div></Section></>}

                  {panel === 'effects' && selectedClip && <Section title="Visual effects"><div className="grid grid-cols-2 gap-2">{EFFECT_PRESETS.slice(0,24).map((f)=><button key={f.id} type="button" onClick={()=>updateClip(selectedClip.id,{effect:f.id,effects:f.id==='none'?[]:[{type:f.id,intensity:1}]})} className={`rounded-lg border p-2 text-left text-[10px] ${selectedClip.effect===f.id?'border-[#ffb6c1] bg-[#ffb6c1]/10':'border-white/10 bg-white/5'}`}>{f.name}</button>)}</div><div className="mt-4"><Slider label="Effect intensity" min={0} max={2} step={0.05} value={selectedClip.effect_intensity ?? 1} onChange={(v)=>updateClip(selectedClip.id,{effect_intensity:v,effects:selectedClip.effect==='none'?[]:[{type:selectedClip.effect,intensity:v}]})}/></div></Section>}

                  {panel === 'animation' && selectedElement && <><Section title="Text animation"><label className="mb-3 block text-xs text-white/60">Entrance<select value={selectedElement.animation_in || 'none'} onChange={(e)=>updateElement(selectedElement.id,{animation_in:e.target.value as any})} className="mt-1 w-full rounded-lg border border-white/10 bg-[#1a1a1a] p-2 text-white">{TEXT_ANIMATION_PRESETS.map((a)=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label className="mb-3 block text-xs text-white/60">Exit<select value={selectedElement.animation_out || 'none'} onChange={(e)=>updateElement(selectedElement.id,{animation_out:e.target.value as any})} className="mt-1 w-full rounded-lg border border-white/10 bg-[#1a1a1a] p-2 text-white">{TEXT_ANIMATION_PRESETS.map((a)=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label><div className="space-y-4"><Slider label="Entrance duration" min={0.05} max={2} step={0.05} value={selectedElement.animation_in_duration ?? 0.35} onChange={(v)=>updateElement(selectedElement.id,{animation_in_duration:v})}/><Slider label="Exit duration" min={0.05} max={2} step={0.05} value={selectedElement.animation_out_duration ?? 0.3} onChange={(v)=>updateElement(selectedElement.id,{animation_out_duration:v})}/></div></Section></>}

                  {panel === 'motion' && selectedClip && <Section title="Motion presets"><div className="grid grid-cols-2 gap-2">{(['none','zoom-in','zoom-out','spin','float','pop','shake'] as const).map((m)=><button key={m} type="button" onClick={()=>updateClip(selectedClip.id,{motion_preset:m,motion_amount:1})} className={`rounded-lg border p-3 text-left text-xs ${selectedClip.motion_preset===m?'border-[#ffb6c1] bg-[#ffb6c1]/10':'border-white/10 bg-white/5'}`}>{m.replaceAll('-',' ')}</button>)}</div><div className="mt-4"><Slider label="Amount" min={0} max={2} step={.05} value={selectedClip.motion_amount || 1} onChange={(v)=>updateClip(selectedClip.id,{motion_amount:v})}/></Section>}

                  {panel === 'motion' && selectedClip && <Section title="Motion presets"><div className="grid grid-cols-2 gap-2">{(['none','zoom-in','zoom-out','spin','float','pop','shake'] as const).map((m)=><button key={m} type="button" onClick={()=>updateClip(selectedClip.id,{motion_preset:m,motion_amount:1})} className={`rounded-lg border p-3 text-left text-xs ${selectedClip.motion_preset===m?'border-[#ffb6c1] bg-[#ffb6c1]/10':'border-white/10 bg-white/5'}`}>{m.replaceAll('-',' ')}</button>)}</div><div className="mt-4"><Slider label="Amount" min={0} max={2} step={.05} value={selectedClip.motion_amount || 1} onChange={(v)=>updateClip(selectedClip.id,{motion_amount:v})}/></div></Section>}

                  {panel === 'crop' && selectedClip && <Section title="Crop"><div className="grid grid-cols-2 gap-3">{(['top','right','bottom','left'] as const).map((side)=><Slider key={side} label={side} min={0} max={.45} step={.01} value={selectedClip.transform.crop?.[side] || 0} onChange={(v)=>updateClip(selectedClip.id,{transform:{...selectedClip.transform,crop:sanitizeCrop({...selectedClip.transform.crop,[side]:v})}})}/>)}</div><Button onClick={()=>updateClip(selectedClip.id,{transform:{...selectedClip.transform,crop:null}})}>Reset crop</Button></Section>}

                  {panel === 'transform' && <><Section title="Canvas"><div className="flex flex-wrap gap-2">{(['16:9','9:16','1:1','4:5','3:2','21:9'] as AspectRatio[]).map((a)=><Button key={a} active={project.aspect===a} onClick={()=>changeCanvas(a)}>{a}</Button>)}</div></Section>
                    {selectedClip && <Section title="Selected clip"><Slider label="Scale" min={.1} max={4} step={.01} value={selectedClip.transform.scale} onChange={(v)=>updateClip(selectedClip.id,{transform:{...selectedClip.transform,scale:v}})}/><Slider label="X" min={-2000} max={2000} value={selectedClip.transform.offset_x} onChange={(v)=>updateClip(selectedClip.id,{transform:{...selectedClip.transform,offset_x:v}})}/><Slider label="Y" min={-2000} max={2000} value={selectedClip.transform.offset_y} onChange={(v)=>updateClip(selectedClip.id,{transform:{...selectedClip.transform,offset_y:v}})}/><Slider label="Rotation" min={-180} max={180} value={selectedClip.transform.rotation} onChange={(v)=>updateClip(selectedClip.id,{transform:{...selectedClip.transform,rotation:v}})}/><div className="mt-3 flex gap-2"><Button onClick={()=>updateClip(selectedClip.id,{transform:{...selectedClip.transform,flip_h:!selectedClip.transform.flip_h}})}>Flip H</Button><Button onClick={()=>updateClip(selectedClip.id,{transform:{...selectedClip.transform,flip_v:!selectedClip.transform.flip_v}})}>Flip V</Button></div></Section>}
                    {selectedElement && <Section title="Selected layer"><Slider label="Scale" min={.1} max={4} step={.01} value={resolveElementValues(selectedElement,Math.max(0,playhead-selectedElement.start)).scale} onChange={(v)=>updateElement(selectedElement.id,{keyframes:upsertKeyframe(selectedElement,'scale_kf',Math.max(0,playhead-selectedElement.start),v)})}/><Slider label="Rotation" min={-180} max={180} value={selectedElement.rotation} onChange={(v)=>updateElement(selectedElement.id,{rotation:v})}/><Slider label="Opacity" min={0} max={1} step={.01} value={selectedElement.opacity} onChange={(v)=>updateElement(selectedElement.id,{opacity:v})}/></Section>}
                  </>}

                  {panel === 'export' && <><Section title="Export"><div className="space-y-3"><label className="block text-xs text-white/65">Resolution<select value={exportSettings.resolutionHeight} onChange={(e)=>setExportSettings(s=>({...s,resolutionHeight:Number(e.target.value)}))} className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 p-2 text-white"><option value="720">720p</option><option value="1080">1080p</option><option value="1440">1440p</option><option value="2160">4K</option></select></label><label className="block text-xs text-white/65">Quality<select value={exportSettings.qualityBitrate} onChange={(e)=>setExportSettings(s=>({...s,qualityBitrate:Number(e.target.value)}))} className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 p-2 text-white">{EXPORT_QUALITY_PRESETS.map(q=><option key={q.id} value={q.bitrate}>{q.name}</option>)}</select></label><p className="text-[11px] leading-5 text-white/45">Local uses the editor renderer. Cloud exports use JSON2Video or Creatomate, with both API keys kept on the server.</p><div className="grid grid-cols-1 gap-2 sm:grid-cols-3"><Button disabled={busy || !project.clips.length} onClick={()=>void downloadExport()}><Download className="h-4 w-4"/> Local MP4</Button><Button disabled={busy || !project.clips.length || cloudRendering || creatomateRendering} onClick={()=>void cloudExport()}><CloudIcon/> {cloudRendering ? "Rendering…" : "JSON2Video"}</Button><Button disabled={busy || !project.clips.length || cloudRendering || creatomateRendering} onClick={()=>void creatomateExport()}><CloudIcon/> {creatomateRendering ? "Rendering…" : "Creatomate"}</Button></div>{cloudRendering && <div><div className="mb-1 flex justify-between text-[10px] text-white/55"><span>JSON2Video</span><span>{cloudProgress}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-[#ffb6c1]" style={{width:`${cloudProgress}%`}}/></div></div>}{creatomateRendering && <div><div className="mb-1 flex justify-between text-[10px] text-white/55"><span>Creatomate</span><span>{creatomateProgress}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-[#ffb6c1]" style={{width:`${creatomateProgress}%`}}/></div></div>}{exportProgress && <div><div className="mb-1 flex justify-between text-[10px] text-white/55"><span>{exportProgress.message}</span><span>{exportProgress.percent}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-[#ffb6c1]" style={{width:`${exportProgress.percent}%`}}/></div></div>}</div></Section></>}

                  {panel === 'text' && !selectedElement && <Section title="Text"><Button onClick={addText}><Type className="h-4 w-4"/> Add text</Button></Section>}
                  {panel === 'audio' && !selectedAudio && <Section title="Audio"><Button onClick={()=>audioInputRef.current?.click()}><Upload className="h-4 w-4"/> Import audio</Button></Section>}
                  {panel === 'media' && !selectedClip && <Section title="Media"><Button onClick={()=>fileInputRef.current?.click()}><Upload className="h-4 w-4"/> Import video/photo</Button></Section>}
                  {panel === 'speed' && !selectedClip && <Section title="Speed"><p className="text-xs text-white/45">Select a video clip to adjust playback speed and linked source audio.</p></Section>}
                  {panel === 'transitions' && !selectedClip && <Section title="Transitions"><p className="text-xs text-white/45">Select the clip that should receive the transition.</p></Section>}
                  {panel === 'filters' && !selectedClip && <Section title="Filters"><p className="text-xs text-white/45">Select a video clip to adjust filters and color.</p></Section>}
                  {panel === 'animation' && !selectedElement && <Section title="Animation"><p className="text-xs text-white/45">Select a text or overlay layer to edit its animation.</p></Section>}
                  {panel === 'effects' && !selectedClip && <Section title="Effects"><p className="text-xs text-white/45">Select a video clip first. Effects are rendered by the same engine used for export.</p></Section>}
                  {panel === 'motion' && !selectedClip && <Section title="Motion"><p className="text-xs text-white/45">Select a video clip first.</p></Section>}
                  {panel === 'crop' && !selectedClip && <Section title="Crop"><p className="text-xs text-white/45">Select a video clip first.</p></Section>}

                  {selection && <Section title="Selection"><div className="flex flex-wrap gap-2"><Button onClick={duplicateSelection}><Layers3 className="h-4 w-4"/> Duplicate</Button><Button onClick={deleteSelection}><Trash2 className="h-4 w-4"/> Delete</Button>{selectedClip && <Button onClick={splitSelected}><Scissors className="h-4 w-4"/> Split at playhead</Button>}</div></Section>}
                  {(selectedClip || selectedElement) && <Section title="Keyframes"><div className="grid grid-cols-2 gap-2">{(['pos_x_kf','pos_y_kf','scale_kf','rotation_kf','opacity_kf'] as KeyframeProperty[]).map((p)=><Button key={p} onClick={()=>addKeyframe(p)}>{p.replace('_kf','')}</Button>)}</div></Section>}
                </div>
              </aside>
            )}
          </div>
        </div>
      </div>

      <footer className="flex shrink-0 items-center gap-2 overflow-x-auto border-t border-white/8 bg-[#101010] px-2 py-2 lg:hidden">
        {contextual.map((action) => <Button key={action} active={panel === action} onClick={()=>openContext(action as any)}>{action}</Button>)}
      </footer>
    </main>
  );
}
