import type { AudioTrack, TimelineElement, VideoClip, VideoProject } from '@/lib/video/project';
import { clipDuration, resolveClipValues, resolveElementValues } from '@/lib/video/project';

export type CreatomateResolution = 720 | 1080 | 1440 | 2160;

export interface CreatomateRenderScript {
  output_format: 'mp4';
  width: number;
  height: number;
  frame_rate?: number;
  duration?: number;
  elements: any[];
}

function validSource(value: string | undefined): value is string {
  return !!value && (value.startsWith('http://') || value.startsWith('https://'));
}

function positionElement(x: number, y: number, width: number, height: number, canvas: VideoProject['canvas']) {
  return {
    x: Math.round((x / Math.max(1, canvas.width)) * 100) + '%',
    y: Math.round((y / Math.max(1, canvas.height)) * 100) + '%',
    width: Math.max(1, Math.round((width / Math.max(1, canvas.width)) * 100)) + '%',
    height: Math.max(1, Math.round((height / Math.max(1, canvas.height)) * 100)) + '%',
  };
}

function clipToElement(project: VideoProject, clip: VideoClip, source: string, start: number) {
  const duration = Math.max(0.05, clipDuration(clip));
  const values = resolveClipValues(clip, 0);
  const width = Math.max(1, (clip.source_width || project.canvas.width) * values.scale * clip.transform.scale_x);
  const height = Math.max(1, (clip.source_height || project.canvas.height) * values.scale * clip.transform.scale_y);
  const x = (project.canvas.width - width) / 2 + clip.transform.offset_x;
  const y = (project.canvas.height - height) / 2 + clip.transform.offset_y;
  const out: any = {
    id: clip.id,
    type: clip.media_type === 'image' ? 'image' : 'video',
    track: 1,
    time: start,
    duration,
    source,
    ...positionElement(x, y, width, height, project.canvas),
    rotation: clip.transform.rotation || 0,
    opacity: 1,
    volume: clip.muted ? 0 : Math.max(0, Math.min(1, values.volume)),
  };
  if (clip.speed && clip.speed !== 1) out.speed = clip.speed;
  if (clip.trimStart > 0) out.trim_start = clip.trimStart;
  if (clip.transform.flip_h) out.flip_x = true;
  if (clip.transform.flip_v) out.flip_y = true;
  return out;
}

function textToElement(project: VideoProject, el: TimelineElement) {
  const values = resolveElementValues(el, 0);
  const out: any = {
    id: el.id,
    type: 'text',
    track: Math.max(2, Math.round(el.z || 2)),
    time: el.start,
    duration: Math.max(0.05, el.end - el.start),
    text: el.content || '',
    ...positionElement(values.x, values.y, el.width * values.scale, el.height * values.scale, project.canvas),
    x_alignment: '50%',
    y_alignment: '50%',
    font_family: el.font_family || 'Arial',
    font_weight: el.font_weight || 700,
    font_size: Math.max(8, Math.round(el.font_size || 48)),
    fill_color: el.color || '#ffffff',
    opacity: values.opacity,
    rotation: values.rotation || 0,
  };
  if (el.background) out.background_color = el.background;
  if (el.shadow) out.shadow = true;
  return out;
}

function overlayToElement(project: VideoProject, el: TimelineElement, source: string) {
  const values = resolveElementValues(el, 0);
  return {
    id: el.id,
    type: el.kind === 'video' ? 'video' : 'image',
    track: Math.max(2, Math.round(el.z || 2)),
    time: el.start,
    duration: Math.max(0.05, el.end - el.start),
    source,
    ...positionElement(values.x, values.y, el.width * values.scale, el.height * values.scale, project.canvas),
    rotation: values.rotation || 0,
    opacity: values.opacity,
    volume: Math.max(0, Math.min(1, values.volume)),
  };
}

function audioToElement(audio: AudioTrack, source: string) {
  return {
    id: audio.id,
    type: 'audio',
    track: 1,
    time: audio.start,
    duration: Math.max(0.05, audio.trimEnd - audio.trimStart),
    source,
    volume: Math.max(0, Math.min(1, audio.volume)),
    audio_fade_in: Math.max(0, audio.fadeIn || 0),
    audio_fade_out: Math.max(0, audio.fadeOut || 0),
    trim_start: Math.max(0, audio.trimStart || 0),
  };
}

export function projectToCreatomate(
  project: VideoProject,
  sources: Record<string, string>,
  resolutionHeight: CreatomateResolution = 1080,
): CreatomateRenderScript {
  const aspect = project.canvas.width / Math.max(1, project.canvas.height);
  const height = resolutionHeight;
  const width = Math.max(1, Math.round(height * aspect));
  const elements: any[] = [];
  let timeline = 0;

  for (const clip of project.clips) {
    const source = sources[clip.src] || clip.src;
    if (!validSource(source)) continue;
    elements.push(clipToElement(project, clip, source, timeline));
    timeline += clipDuration(clip);
  }

  for (const el of project.elements) {
    if (el.kind === 'text') elements.push(textToElement(project, el));
    else if (el.src) {
      const source = sources[el.src] || el.src;
      if (validSource(source)) elements.push(overlayToElement(project, el, source));
    }
  }

  for (const audio of project.audio) {
    const source = sources[audio.src] || audio.src;
    if (validSource(source)) elements.push(audioToElement(audio, source));
  }

  const duration = Math.max(
    timeline,
    ...project.elements.map((e) => e.end),
    ...project.audio.map((a) => a.start + Math.max(0, a.trimEnd - a.trimStart)),
    0.1,
  );

  return { output_format: 'mp4', width, height, duration, elements };
}

export function collectCreatomateSources(project: VideoProject) {
  const values = new Set<string>();
  project.clips.forEach((c) => values.add(c.src));
  project.audio.forEach((a) => values.add(a.src));
  project.elements.forEach((e) => { if (e.src) values.add(e.src); });
  return Array.from(values);
}
