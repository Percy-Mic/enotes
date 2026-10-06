import type { AudioTrack, TimelineElement, VideoClip, VideoProject } from '@/lib/video/project';
import { clipDuration, resolveClipValues, resolveElementValues } from '@/lib/video/project';

export type CloudRenderResolution = 720 | 1080 | 1440 | 2160;

export interface Json2VideoMovie {
  resolution: string;
  quality: 'low' | 'medium' | 'high';
  scenes: Array<{ duration: number; 'background-color'?: string; elements: any[] }>;
  'client-data'?: Record<string, unknown>;
}

function resolutionFor(project: VideoProject, height: CloudRenderResolution): string {
  const ratio = project.canvas.width / Math.max(1, project.canvas.height);
  const width = Math.round(height * ratio);
  if (height === 2160) return '4k';
  if (height === 1440) return '2k';
  if (height === 1080) return 'full-hd';
  return 'hd';
}

function qualityFor(bitrate: number): 'low' | 'medium' | 'high' {
  if (bitrate <= 3000000) return 'low';
  if (bitrate <= 8000000) return 'medium';
  return 'high';
}

function correctionFor(clip: VideoClip, timeIn = 0) {
  const a = clip.adjustments;
  return {
    brightness: Math.max(-1, Math.min(1, (a.brightness - 100) / 100)),
    contrast: Math.max(-10, Math.min(10, a.contrast / 100)),
    saturation: Math.max(0, Math.min(3, a.saturate / 100)),
    gamma: 1,
  };
}

function cropFor(clip: VideoClip) {
  const c = clip.transform.crop;
  if (!c) return undefined;
  const w = Math.max(1, clip.source_width || 1000);
  const h = Math.max(1, clip.source_height || 1000);
  return {
    x: Math.round(c.left * w),
    y: Math.round(c.top * h),
    width: Math.max(1, Math.round(w * (1 - c.left - c.right))),
    height: Math.max(1, Math.round(h * (1 - c.top - c.bottom))),
  };
}

function keyframesForClip(clip: VideoClip) {
  const kf = clip.keyframes;
  if (!kf) return undefined;
  const times = new Set<number>();
  Object.values(kf).forEach((list) => list?.forEach((item) => times.add(item.t)));
  if (!times.size) return undefined;

  return Array.from(times).sort((a, b) => a - b).map((t) => {
    const values = resolveClipValues(clip, t);
    return {
      time: t,
      x: values.offset_x + clip.source_width! * 0,
      y: values.offset_y + clip.source_height! * 0,
      zoom: Math.max(-10, Math.min(10, values.scale - 1)),
    };
  });
}

function transitionFor(clip: VideoClip): { style: string; duration: number } | undefined {
  const type = clip.transitionIn?.type;
  const duration = Math.max(0.05, clip.transitionIn?.duration || 0);
  if (!type || type === 'none' || duration <= 0) return undefined;
  const style: Record<string, string> = { fade: 'fade', crossfade: 'fade', 'dip-black': 'fade', slide: 'slide', push: 'slide', 'whip-pan': 'slide', zoom: 'zoom', 'zoom-blur': 'zoom', spin: 'zoom', wipe: 'wipe', 'luma-wipe': 'wipe', 'glitch-cut': 'wipe', 'film-burn': 'fade', blur: 'fade' };
  return { style: style[type] || 'fade', duration };
}

function clipElement(project: VideoProject, clip: VideoClip, src: string, start: number): any {
  const duration = Math.max(0.05, clipDuration(clip));
  const v = resolveClipValues(clip, 0);
  const base: any = {
    id: clip.id,
    type: clip.media_type === 'image' ? 'image' : 'video',
    src,
    start,
    duration,
    position: 'custom',
    x: Math.round((project.canvas.width - (clip.source_width || project.canvas.width) * v.scale * clip.transform.scale_x) / 2 + (clip.transform.offset_x || 0)),
    y: Math.round((project.canvas.height - (clip.source_height || project.canvas.height) * v.scale * clip.transform.scale_y) / 2 + (clip.transform.offset_y || 0)),
    width: Math.max(1, Math.round((clip.source_width || 1280) * v.scale * clip.transform.scale_x)),
    height: Math.max(1, Math.round((clip.source_height || 720) * v.scale * clip.transform.scale_y)),
    rotate: { angle: clip.transform.rotation || 0, speed: 0 },
    volume: clip.muted ? 0 : Math.max(0, Math.min(10, v.volume)),
    'flip-horizontal': !!clip.transform.flip_h,
    'flip-vertical': !!clip.transform.flip_v,
    correction: correctionFor(clip),
  };
  const crop = cropFor(clip);
  if (crop) base.crop = crop;
  if (clip.transitionIn?.type === 'fade') base['fade-in'] = Math.max(0, clip.transitionIn.duration || 0);
  const keyframes = keyframesForClip(clip);
  if (keyframes) base.keyframes = keyframes;
  if (clip.speed && clip.speed !== 1) base.speed = clip.speed;
  if (clip.trimStart > 0) base.seek = clip.trimStart;
  return base;
}

function textElement(el: TimelineElement): any {
  const duration = Math.max(0.05, el.end - el.start);
  const values = resolveElementValues(el, 0);
  const out: any = {
    id: el.id,
    type: 'text',
    text: el.content || '',
    start: el.start,
    duration,
    position: 'custom',
    x: Math.round(values.x),
    y: Math.round(values.y),
    width: Math.max(1, Math.round(el.width)),
    height: Math.max(1, Math.round(el.height)),
    rotate: { angle: values.rotation || 0, speed: 0 },
    opacity: values.opacity,
    color: el.color || '#ffffff',
    'font-size': Math.max(8, Math.round(el.font_size || 48)),
    'font-family': el.font_family || 'Arial',
    'font-weight': el.font_weight || 700,
    alignment: el.align || 'center',
  };
  if (el.background) out['background-color'] = el.background;
  if (el.shadow) out.shadow = true;
  if (el.stroke_color) out.stroke = { color: el.stroke_color, width: el.stroke_width || 1 };
  if (el.keyframes) {
    const times = new Set<number>();
    Object.values(el.keyframes).forEach((list) => list?.forEach((item) => times.add(item.t)));
    if (times.size) {
      out.keyframes = Array.from(times).sort((a, b) => a - b).map((t) => {
        const v = resolveElementValues(el, t);
        return { time: t, x: Math.round(v.x), y: Math.round(v.y), width: Math.round(el.width * v.scale), height: Math.round(el.height * v.scale) };
      });
    }
  }
  return out;
}

function overlayElement(el: TimelineElement, src: string): any {
  const duration = Math.max(0.05, el.end - el.start);
  const v = resolveElementValues(el, 0);
  const out: any = {
    id: el.id,
    type: el.kind === 'video' ? 'video' : 'image',
    src,
    start: el.start,
    duration,
    position: 'custom',
    x: Math.round(v.x),
    y: Math.round(v.y),
    width: Math.max(1, Math.round(el.width * v.scale)),
    height: Math.max(1, Math.round(el.height * v.scale)),
    rotate: { angle: v.rotation || 0, speed: 0 },
    volume: Math.max(0, Math.min(10, v.volume)),
  };
  if (el.crop) {
    const w = Math.max(1, (el as any).source_width || el.width);
    const h = Math.max(1, (el as any).source_height || el.height);
    out.crop = {
      x: Math.round(el.crop.left * w),
      y: Math.round(el.crop.top * h),
      width: Math.max(1, Math.round(w * (1 - el.crop.left - el.crop.right))),
      height: Math.max(1, Math.round(h * (1 - el.crop.top - el.crop.bottom))),
    };
  }
  return out;
}

function audioElement(audio: AudioTrack, src: string): any {
  return {
    id: audio.id,
    type: 'audio',
    src,
    start: audio.start,
    duration: Math.max(0.05, audio.trimEnd - audio.trimStart),
    volume: Math.max(0, Math.min(10, audio.volume)),
    'fade-in': Math.max(0, audio.fadeIn || 0),
    'fade-out': Math.max(0, audio.fadeOut || 0),
    seek: Math.max(0, audio.trimStart || 0),
  };
}

export function projectToJson2Video(
  project: VideoProject, sources: Record<string, string>, resolutionHeight: CloudRenderResolution = 1080, bitrate = 6000000,
): Json2VideoMovie {
  const scenes: Json2VideoMovie['scenes'] = [];
  let timeline = 0;
  for (const clip of project.clips) {
    const src = sources[clip.src] || clip.src, duration = Math.max(0.05, clipDuration(clip));
    if (src.startsWith('http://') || src.startsWith('https://')) {
      const sceneElements: any[] = [clipElement(project, clip, src, 0)];
      const sceneStart = timeline, sceneEnd = timeline + duration;
      for (const el of project.elements) {
        const overlapStart = Math.max(el.start, sceneStart), overlapEnd = Math.min(el.end, sceneEnd);
        if (overlapEnd <= overlapStart) continue;
        const localStart = overlapStart - sceneStart, localDuration = overlapEnd - overlapStart;
        const source = el.src ? (sources[el.src] || el.src) : null;
        if (el.kind === 'text') sceneElements.push(textElement({ ...el, start: localStart, end: localStart + localDuration }));
        else if (source && (source.startsWith('http://') || source.startsWith('https://')) && ['image','video','gif'].includes(el.kind)) sceneElements.push(overlayElement({ ...el, start: localStart, end: localStart + localDuration }, source));
      }
      const scene: Json2VideoMovie['scenes'][number] = { duration, 'background-color': '#000000', elements: sceneElements };
      const transition = transitionFor(clip);
      if (scenes.length && transition) scene.transition = transition;
      scenes.push(scene);
    }
    timeline += duration;
  }
  const movieAudio: any[] = [];
  for (const audio of project.audio) {
    const src = sources[audio.src] || audio.src;
    if (src.startsWith('http://') || src.startsWith('https://')) movieAudio.push(audioElement(audio, src));
  }
  const ratio = project.canvas.width / Math.max(1, project.canvas.height);
  return { resolution: ratio === 16 / 9 && resolutionHeight <= 1080 ? resolutionFor(project, resolutionHeight) : `${Math.round(resolutionHeight * ratio)}x${resolutionHeight}`, quality: qualityFor(bitrate), elements: movieAudio, scenes };
}
function projectDurationForCloud(project: VideoProject) {
  const clips = project.clips.reduce((sum, clip) => sum + clipDuration(clip), 0);
  const layers = project.elements.reduce((max, el) => Math.max(max, el.end), 0);
  const audio = project.audio.reduce((max, a) => Math.max(max, a.start + Math.max(0, a.trimEnd - a.trimStart)), 0);
  return Math.max(clips, layers, audio, 0.1);
}

export function collectProjectSources(project: VideoProject) {
  const sources = new Set<string>();
  project.clips.forEach((c) => sources.add(c.src));
  project.audio.forEach((a) => sources.add(a.src));
  project.elements.forEach((e) => { if (e.src) sources.add(e.src); });
  return Array.from(sources);
}
