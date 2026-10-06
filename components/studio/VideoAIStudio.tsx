'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { uploadFile } from '@/lib/storage/upload';
import {
  AlertTriangle,
  Bot,
  Captions,
  Check,
  ChevronRight,
  Loader2,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';

import type { VideoClip, TimelineElement } from '@/lib/video/project';

export type VideoAIEditAction = {
  type:
    | 'set_clip_speed'
    | 'set_clip_volume'
    | 'set_clip_mute'
    | 'set_clip_filter'
    | 'set_clip_effect'
    | 'set_clip_mask'
    | 'set_clip_transition'
    | 'trim_clip'
    | 'transform_clip'
    | 'set_clip_adjustments'
    | 'fit_clip'
    | 'set_aspect'
    | 'delete_clip'
    | 'duplicate_clip'
    | 'generate_captions'
    | 'transcribe'
    | 'transform_element'
    | 'set_element_opacity'
    | 'delete_element'
    | 'retime_element'
    | 'set_keyframe'
    | 'add_text_element'
    | 'split_clip'
    | 'reorder_clip'
    | 'add_stock_video'
    | 'add_library_audio'
    | 'add_audio_clip'
    | 'speak_narration'
    | 'cut_on_beats';
  clipId?: string | null;
  elementId?: string | null;
  value?: number | string | boolean | null;
  value2?: number | string | boolean | null;
  object?: Record<string, unknown> | null;
};

export type VideoAICaption = {
  id: string;
  text: string;
  start: number;
  end: number;
  confidence?: number | null;
  needsReview?: boolean;
  speaker?: string | null;
};

type VisionFrame = {
  clipId: string;
  time: number;
  dataUrl: string;
  label: string;
};

async function extractFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement, time: number, label: string) {
  await new Promise<void>((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Video frame could not be decoded.'));
    };
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    try {
      video.currentTime = Math.max(0, Math.min(Math.max(0, video.duration - 0.05), time));
    } catch {
      cleanup();
      reject(new Error('Video frame seek failed.'));
    }
  });

  const maxDimension = 512;
  const scale = Math.min(1, maxDimension / Math.max(video.videoWidth || 1, video.videoHeight || 1));
  canvas.width = Math.max(1, Math.round((video.videoWidth || 640) * scale));
  canvas.height = Math.max(1, Math.round((video.videoHeight || 360) * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable.');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  return {
    time,
    dataUrl: canvas.toDataURL('image/jpeg', 0.68),
    label,
  };
}

async function extractProjectVisionFrames(project: unknown, selectedClipId?: string | null): Promise<VisionFrame[]> {
  const raw = project && typeof project === 'object'
    ? project as { clips?: Array<Record<string, unknown>> }
    : {};
  const clips = Array.isArray(raw.clips) ? raw.clips : [];
  const frames: VisionFrame[] = [];

  const orderedClips = selectedClipId
    ? [
        ...clips.filter((clip) => clip?.id === selectedClipId),
        ...clips.filter((clip) => clip?.id !== selectedClipId),
      ]
    : clips;

  for (const clip of orderedClips.slice(0, 8)) {
    const clipId = typeof clip.id === 'string' ? clip.id : '';
    const src = typeof clip.src === 'string' ? clip.src : '';
    if (!clipId || !/^https?:\/\//i.test(src)) continue;

    const sourceDuration = Math.max(0.1, Number(clip.sourceDuration) || 0.1);
    const trimStart = Math.max(0, Math.min(sourceDuration - 0.05, Number(clip.trimStart) || 0));
    const trimEnd = Math.max(trimStart + 0.05, Math.min(sourceDuration, Number(clip.trimEnd) || sourceDuration));
    const midpoint = trimStart + (trimEnd - trimStart) * 0.5;
    const times = selectedClipId === clipId
      ? [trimStart, midpoint, trimEnd]
      : [trimStart + (trimEnd - trimStart) * 0.18, midpoint];

    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.src = src;

    try {
      await new Promise<void>((resolve, reject) => {
        const onLoaded = () => { cleanup(); resolve(); };
        const onError = () => { cleanup(); reject(new Error('Video could not be loaded.')); };
        const cleanup = () => {
          video.removeEventListener('loadedmetadata', onLoaded);
          video.removeEventListener('error', onError);
        };
        video.addEventListener('loadedmetadata', onLoaded, { once: true });
        video.addEventListener('error', onError, { once: true });
        video.load();
      });

      const canvas = document.createElement('canvas');
      for (let index = 0; index < times.length; index += 1) {
        try {
          const frame = await extractFrame(video, canvas, times[index], index === 0 ? 'opening' : index === 1 ? 'middle' : 'ending');
          frames.push({ clipId, ...frame });
        } catch {
          // One undecodable frame should not prevent the other clips from being inspected.
        }
      }
    } catch {
      // CORS/private media can prevent canvas inspection; metadata is still sent to the AI.
    } finally {
      video.removeAttribute('src');
      video.load();
    }
  }

  return frames.slice(0, 18);
}


/**
 * Build a small browser-local analysis proxy for large video sources.
 * The original project clip is never modified. The proxy is intentionally
 * short, 640px wide, and WebM-compressed so AI analysis stays lightweight.
 */
async function createAIVideoProxy(
  sourceUrl: string,
  startAt = 0,
  maxSeconds = 18,
): Promise<{ url: string; type: 'video' }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in is required to prepare an AI video proxy.');

  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = sourceUrl;

  try {
    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error('The video could not be prepared for AI analysis.')); };
      const cleanup = () => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onError);
      };
      video.addEventListener('loadedmetadata', onLoaded, { once: true });
      video.addEventListener('error', onError, { once: true });
      video.load();
    });

    const duration = Number.isFinite(video.duration) ? video.duration : maxSeconds;
    const start = Math.max(0, Math.min(Math.max(0, duration - 0.1), startAt));
    const end = Math.min(duration, start + maxSeconds);
    if (!(end > start)) throw new Error('The selected video has no usable frames for AI analysis.');

    const maxWidth = 640;
    const scale = Math.min(1, maxWidth / Math.max(1, video.videoWidth || 640));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round((video.videoWidth || 640) * scale));
    canvas.height = Math.max(2, Math.round((video.videoHeight || 360) * scale));
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx || typeof canvas.captureStream !== 'function') {
      throw new Error('This browser does not support local AI video proxy encoding.');
    }

    const stream = canvas.captureStream(8);
    const mimeCandidates = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    const mimeType = mimeCandidates.find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('This browser does not support a compatible AI proxy encoder.');

    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 900_000 });
    const chunks: Blob[] = [];
    const stopped = new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => reject(new Error('AI proxy encoding failed.'));
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    });

    await new Promise<void>((resolve, reject) => {
      const onSeeked = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error('The video could not seek to the AI analysis range.')); };
      const cleanup = () => {
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
      };
      video.addEventListener('seeked', onSeeked, { once: true });
      video.addEventListener('error', onError, { once: true });
      video.currentTime = start;
    });

    let raf = 0;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      if (recorder.state !== 'inactive') recorder.stop();
      stream.getTracks().forEach((track) => track.stop());
      video.pause();
    };

    const draw = () => {
      if (finished) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      if (video.currentTime >= end - 0.04) {
        finish();
        return;
      }
      raf = requestAnimationFrame(draw);
    };

    recorder.start(250);
    await video.play();
    draw();
    await new Promise<void>((resolve) => {
      const check = () => {
        if (finished) resolve();
        else window.setTimeout(check, 100);
      };
      check();
    });

    const blob = await stopped;
    if (blob.size > 24 * 1024 * 1024) {
      throw new Error('The generated AI proxy is still too large.');
    }
    const file = new File([blob], `enotes-ai-proxy-${Date.now()}.webm`, { type: mimeType });
    const uploaded = await uploadFile(file, 'studio-media', user.id);
    return { url: uploaded.url, type: 'video' };
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

async function shouldProxyVideo(url: string, duration = 0): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    const size = Number(response.headers.get('content-length') || 0);
    if (size > 80 * 1024 * 1024) return true;
  } catch {
    /* Cross-origin HEAD can be blocked; duration remains the fallback. */
  }
  return duration > 45;
}

type Props = {
  projectId?: string | null;
  project: unknown;
  selectedMediaUrl?: string | null;
  selectedMediaType?: 'image' | 'video' | 'audio' | null;
  selectedClipId?: string | null;
  selectedElementId?: string | null;
  onAddCaptions?: (captions: VideoAICaption[]) => void;
  onAddMedia?: (media: { url: string; name: string }) => void;
  onAddStockVideo?: (media: { url: string; name: string; width: number; height: number; duration: number; photographer: string; provider: 'pexels' | 'pixabay' }) => void;
  onAddLibraryAudio?: (soundId: string) => Promise<void> | void;
  onApplyActions?: (actions: VideoAIEditAction[]) => void | Promise<void | { applied: number; failed: string[] }>;
};

const SUGGESTIONS = [
  { label: 'Finish the entire edit', prompt: 'Finish the entire edit professionally in one pass. Treat every clip: trim weak frames, tighten pacing, apply one consistent color treatment across the whole timeline, add professional transitions between clips, and deliver the right text/motion layer for this piece. Emit the complete action list now.' },
  { label: 'Make it an advertisement', prompt: 'Turn this project into a polished short advertisement. You may reuse, trim, reorder, duplicate, and style the existing footage. If extra B-roll would materially improve it, request suitable free stock footage.' },
  { label: 'Make this cinematic', prompt: 'Make the selected clip feel cinematic using real editor effects, color adjustments, motion, and tasteful keyframes.' },
  { label: 'Improve the pacing', prompt: 'Improve the pacing of this project. Use cuts, trims, speed changes, beat-friendly timing, and clip ordering where appropriate.' },
  { label: 'Make it social-ready', prompt: 'Prepare this project for social media. Choose a suitable aspect ratio, improve framing, captions, text hierarchy, and pacing.' },
  { label: 'Make the suggestions', prompt: 'Apply the suggestions from your previous response to the current project. Do not ask me to restate them.' },
  { label: 'Add captions', prompt: 'Generate accurate timed captions and add them to the timeline with readable animated styling.' },
];

/* Destructive actions remove user content. They are held for explicit
   confirmation with a human-readable list of exactly what disappears
   before anything is applied. */
const DESTRUCTIVE_ACTIONS = new Set(['delete_clip', 'delete_element', 'split_clip']);

function resolveActionTargets(
  action: VideoAIEditAction,
  project: unknown,
): { kind: 'clip' | 'element'; label: string }[] {
  const p = (project || {}) as { clips?: VideoClip[]; elements?: TimelineElement[] };
  const clips = Array.isArray(p.clips) ? p.clips : [];
  const elements = Array.isArray(p.elements) ? p.elements : [];
  if (action.type === 'delete_clip') {
    const hit = clips.find((c) => c.id === action.clipId);
    if (!hit) return [];
    const seconds = Math.max(0, (hit.trimEnd ?? hit.sourceDuration) - (hit.trimStart ?? 0));
    return [{ kind: 'clip', label: `“${hit.name || 'Untitled clip'}” (${seconds.toFixed(1)}s)` }];
  }
  if (action.type === 'delete_element') {
    const hit = elements.find((el) => el.id === action.elementId);
    if (!hit) return [];
    const what = hit.kind === 'text' ? 'Text overlay' : hit.kind === 'image' ? 'Image overlay' : hit.kind === 'video' ? 'Video overlay' : hit.kind === 'sticker' ? 'Sticker' : hit.kind === 'gif' ? 'GIF overlay' : 'Overlay';
    const preview = hit.kind === 'text' && hit.content ? ` … ${String(hit.content).slice(0, 40)}` : '';
    return [{ kind: 'element', label: `${what}${preview}` }];
  }
  if (action.type === 'split_clip') {
    const at = Number(action.value);
    if (!Number.isFinite(at)) return [];
    let acc = 0;
    for (const clip of clips) {
      const d = Math.max(0, (clip.trimEnd ?? clip.sourceDuration) - (clip.trimStart ?? 0)) / (clip.speed || 1);
      if (at > acc + 0.15 && at < acc + d - 0.15) {
        return [{ kind: 'clip', label: `“${clip.name || 'Untitled clip'}” at ${at.toFixed(1)}s` }];
      }
      acc += d;
    }
    return [];
  }
  return [];
}

function actionLabel(action: VideoAIEditAction) {
  switch (action.type) {
    case 'set_clip_speed': return `Speed → ${action.value}×`;
    case 'set_clip_volume': return 'Volume adjusted';
    case 'set_clip_mute': return action.value ? 'Muted' : 'Unmuted';
    case 'set_clip_filter': return `Filter → ${String(action.value)}`;
    case 'set_clip_effect': return `Effect → ${String(action.value)}`;
    case 'set_clip_transition': return `Transition → ${String(action.value)}`;
    case 'trim_clip': return 'Trim adjusted';
    case 'transform_clip': return 'Transform adjusted';
    case 'set_clip_adjustments': return 'Color adjustments';
    case 'fit_clip': return `Fit → ${String(action.value || 'contain')}`;
    case 'set_aspect': return `Canvas → ${String(action.value)}`;
    case 'delete_clip': return 'Clip removed';
    case 'duplicate_clip': return 'Clip duplicated';
    case 'generate_captions': return 'Captions generated';
    case 'transcribe': return 'Transcript generated';
    case 'transform_element': return 'Overlay transform adjusted';
    case 'retime_element': return 'Overlay retimed';
    case 'delete_element': return 'Overlay removed';
    case 'set_element_opacity': return 'Overlay opacity adjusted';
    case 'set_keyframe': return 'Motion keyframe added';
    case 'add_text_element': return 'Text added';
    case 'split_clip': return 'Clip split';
    case 'reorder_clip': return 'Clip reordered';
    case 'add_stock_video': return `Stock footage → ${String(action.object?.query || 'selected topic')}`;
    case 'add_library_audio': return `Library audio → ${String(action.object?.soundId || 'selected sound')}`;
    case 'add_audio_clip': return `Audio placed → ${Number(action.object?.start || 0).toFixed(1)}s`;
    case 'speak_narration': return 'Narration synthesized';
    case 'cut_on_beats': return 'Cuts locked to the beat';
    default: return 'Edit applied';
  }
}

export default function VideoAIStudio({
  projectId,
  project,
  selectedMediaUrl,
  selectedMediaType,
  selectedClipId,
  selectedElementId,
  onAddCaptions,
  onAddMedia,
  onAddStockVideo,
  onAddLibraryAudio,
  onApplyActions,
}: Props) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingDestructive, setPendingDestructive] = useState<{ actions: VideoAIEditAction[]; targets: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Array<{
    role: 'user' | 'assistant';
    text: string;
    actions?: VideoAIEditAction[];
    reviewCount?: number;
  }>>([]);
  const [lastCaptions, setLastCaptions] = useState<VideoAICaption[]>([]);
  const [lastTranscript, setLastTranscript] = useState<string>('');
  const [conversationId, setConversationId] = useState<string | null>(null);

  /* Restore persisted chat history when the panel opens for a project. */
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/video/ai?projectId=${encodeURIComponent(projectId)}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        if (typeof data.conversationId === 'string') setConversationId(data.conversationId);
        const msgs = Array.isArray(data.messages) ? data.messages : [];
        if (msgs.length) {
          setConversation(msgs.map((m: { role: string; content: string; actions?: unknown[] }) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            text: String(m.content || '').replace(/^\\n+/, '').trimStart(),
            actions: Array.isArray(m.actions) ? (m.actions as VideoAIEditAction[]) : undefined,
          })));
        }
      } catch {
        /* History restore is best-effort. */
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const selectedLabel = useMemo(() => {
    if (selectedClipId) return 'Selected video clip';
    if (selectedElementId) return 'Selected overlay';
    return 'Whole project';
  }, [selectedClipId, selectedElementId]);

  async function askAssistant(request?: string) {
    const text = (request ?? prompt).trim();
    if (!text || busy) return;

    setBusy(true);
    setError(null);
    setPrompt('');
    setConversation((items) => [...items, { role: 'user', text }]);

    try {
      // Inspect the actual footage before asking the model to edit. The frames
      // are extracted from the same project clips currently visible in Studio.
      const visionFrames = await extractProjectVisionFrames(project, selectedClipId);

      // Large videos are automatically reduced to a short local proxy for AI.
      // The original clip remains untouched and continues to power the editor/export.
      let aiMediaUrl = selectedMediaUrl;
      let aiMediaType = selectedMediaType;
      if (selectedMediaUrl && selectedMediaType === 'video') {
        const rawProject = project && typeof project === 'object' ? project as { clips?: Array<{ id?: string; sourceDuration?: number; trimStart?: number }> } : {};
        const selectedClip = Array.isArray(rawProject.clips) ? rawProject.clips.find((clip) => clip?.id === selectedClipId) : null;
        const sourceDuration = Number(selectedClip?.sourceDuration || 0);
        const trimStart = Number(selectedClip?.trimStart || 0);
        if (await shouldProxyVideo(selectedMediaUrl, sourceDuration)) {
          const proxy = await createAIVideoProxy(selectedMediaUrl, trimStart, 18);
          aiMediaUrl = proxy.url;
          aiMediaType = proxy.type;
        }
      }

      const response = await fetch('/api/video/ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operation: 'assistant',
          projectId,
          project,
          mediaUrl: aiMediaUrl,
          mediaType: aiMediaType,
          mediaUrls: (() => {
            const raw = project && typeof project === 'object' ? project as { clips?: Array<{ src?: string }> } : {};
            const urls = Array.isArray(raw.clips)
              ? raw.clips
                  .map((clip) => clip?.src)
                  .filter((url): url is string => typeof url === 'string' && !/^(blob:|data:)/i.test(url))
                  .filter((url) => url !== selectedMediaUrl)
                  .slice(0, 10)
              : [];
              if (aiMediaUrl && !urls.includes(aiMediaUrl)) urls.unshift(aiMediaUrl);
            return urls.slice(0, 10).map((url) => ({ url, type: 'video' as const }));
          })(),
          selection: {
            clipId: selectedClipId,
            elementId: selectedElementId,
          },
          visionFrames,
          conversationId,
          beatMarkers: Array.isArray((project as { beatMarkers?: number[] })?.beatMarkers)
            ? (project as { beatMarkers?: number[] }).beatMarkers
            : null,
          conversation: conversation.slice(-10).map((message) => ({
            role: message.role,
            text: message.text,
            actions: message.actions || [],
          })),
          prompt: text,
          audioLibrary: await (async () => {
            try {
              const { data } = await supabase
                .from('sounds')
                .select('id,title,artist,category,duration_seconds,commercial_use,premium')
                .order('plays', { ascending: false })
                .limit(80);
              return Array.isArray(data) ? data : [];
            } catch {
              return [];
            }
          })(),
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'The editing assistant could not complete that request.');
      if (typeof data?.conversationId === 'string') setConversationId(data.conversationId);

      const output = data?.output || {};
      if (data?.degraded || output?.degraded) {
        throw new Error(String(output?.message || data?.message || 'The AI provider is temporarily unavailable. No changes were applied.'));
      }
      let actions: VideoAIEditAction[] = Array.isArray(output.actions) ? output.actions : [];
      const isActionRequest = /\b(add|apply|change|create|delete|remove|trim|split|move|edit|make|generate|set|adjust|replace|cut|mute|unmute|animate|resize|crop|rotate|narration|voiceover|voice over|caption|subtitle|music|audio|effect|filter|transition|motion)\b/i.test(text);
      const captions: VideoAICaption[] = Array.isArray(output.captions) ? output.captions : [];

      /* Never invent placeholder copy on the client. If the server somehow
         returns an empty text action, discard that action rather than silently
         turning it into a generic "YOUR STORY" overlay. */
      actions = actions.filter((action) => {
        if (action.type !== 'add_text_element') return true;
        const obj = action.object && typeof action.object === 'object' ? action.object : {};
        const text = typeof obj.text === 'string' ? obj.text.trim() : '';
        return Boolean(text) && !/^your message$/i.test(text) && !/^your story$/i.test(text);
      });

      const failedNotes: string[] = [];
      const narrationNotes: string[] = [];
      let applicationNote = '';
      const narrationActions = actions.filter((action) => action.type === 'speak_narration');
      for (const action of narrationActions) {
        /* Synthesis runs server-side (real audio, real duration); the result
           rides back and is applied here. Failures surface honestly below. */
        try {
          const synthResponse = await fetch('/api/video/ai', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              operation: 'speak_narration',
              projectId,
              project: { narrationRequest: { text: action.object?.text, start: action.object?.start, voice: action.object?.voice, style: action.object?.style } },
            }),
          });
          const synth = await synthResponse.json().catch(() => ({}));
          if (synthResponse.ok && synth?.output?.audioBase64Wav && onApplyActions) {
            try {
              const result = await Promise.resolve(onApplyActions([{
                type: 'speak_narration',
                object: {
                  text: synth.output.text,
                  start: synth.output.start,
                  audioBase64Wav: synth.output.audioBase64Wav,
                  mimeType: synth.output.mimeType || 'audio/wav',
                },
              }]));
              if (result && typeof result === 'object') {
                narrationNotes.push(`✓ Narration added to the timeline.${result.failed?.length ? ` ⚠️ ${result.failed.join(' · ')}` : ''}`);
              } else {
                narrationNotes.push('✓ Narration added to the timeline.');
              }
            } catch (applyError) {
              failedNotes.push('Voiceover was synthesized but could not be placed on the timeline' + (applyError instanceof Error ? ` (${applyError.message.slice(0, 120)})` : ''));
            }
          } else {
            /* A failed line must not block the rest of the plan — but it
               must never be reported as applied. */
            action.object = { ...(action.object || {}), narrationFailed: true };
            failedNotes.push("Voiceover couldn't be synthesized" + (synth?.error ? ` (${String(synth.error).slice(0, 120)})` : ''));
          }
        } catch (synthError) {
          action.object = { ...(action.object || {}), narrationFailed: true };
          failedNotes.push("Voiceover couldn't be synthesized" + (synthError instanceof Error ? ` (${synthError.message.slice(0, 120)})` : ''));
        }
      }

      const libraryAudioActions = actions.filter((action) => action.type === 'add_library_audio');
      for (const action of libraryAudioActions) {
        const soundId = typeof action.object?.soundId === 'string' ? action.object.soundId : '';
        if (!soundId || !onAddLibraryAudio) continue;
        try {
          await onAddLibraryAudio(soundId);
        } catch {
          /* A missing/unavailable library item must not block the rest of the edit. */
          failedNotes.push('A requested library sound was unavailable');
        }
      }

      const stockActions = actions.filter((action) => action.type === 'add_stock_video');
      for (const action of stockActions) {
        /* A missing query must not silently void the action — search with
           the user's own request text instead of skipping it. */
        const query = (typeof action.object?.query === 'string' ? action.object.query.trim() : '') || text.trim().slice(0, 80) || 'cinematic b-roll';
        if (!onAddStockVideo) continue;
        try {
          const params = new URLSearchParams({
            query,
            page: '1',
            provider: 'all',
          });
          const response = await fetch('/api/studio/stock-videos?' + params.toString());
          const stock = await response.json().catch(() => ({}));
          if (response.ok && Array.isArray(stock.videos) && stock.videos[0]) {
            const item = stock.videos[0];
            onAddStockVideo({
              url: item.url,
              name: item.provider === 'pixabay' ? `Pixabay · ${item.photographer || 'Stock footage'}` : `Pexels · ${item.photographer || 'Stock footage'}`,
              width: Number(item.width) || 1920,
              height: Number(item.height) || 1080,
              duration: Number(item.duration) || 5,
              photographer: String(item.photographer || 'Stock footage'),
              provider: item.provider === 'pixabay' ? 'pixabay' : 'pexels',
            });
          } else {
            failedNotes.push(`Stock footage “${query}” unavailable`);
          }
        } catch {
          /* Stock is optional; the editor still applies the rest of the plan. */
          failedNotes.push(`Stock footage “${query}” failed`);
        }
      }

      if (narrationNotes.length) applicationNote += `\n\n${narrationNotes.join(' · ')}`;
      if (isActionRequest && actions.length === 0 && !captions.length) {
        throw new Error('The AI understood the request but returned no executable edit actions. No changes were applied.');
      }

      if (isActionRequest && actions.length > 0 && !onApplyActions) {
        throw new Error('The AI created edit actions, but the editor is not ready to apply them. No changes were applied.');
      }

      if (actions.length && onApplyActions) {
        const applicable = actions.filter((action) =>
          action.type !== 'generate_captions' &&
          action.type !== 'transcribe' &&
          action.type !== 'add_stock_video' &&
          action.type !== 'add_library_audio' &&
          action.type !== 'speak_narration'
        );
        const destructive = applicable.filter((action) => DESTRUCTIVE_ACTIONS.has(action.type));
        if (destructive.length > 0) {
          const targets: string[] = [];
          for (const action of destructive) {
            for (const t of resolveActionTargets(action, project)) targets.push(t.label);
          }
          if (targets.length > 0) {
            setPendingDestructive({ actions: applicable, targets: Array.from(new Set(targets)) });
            applicationNote = '\n\n⏳ Waiting for your confirmation before applying destructive changes.';
          } else {
            /* Destructive actions whose targets no longer exist are dropped;
               the rest of the plan applies without a pointless prompt. */
            try {
              const result = await Promise.resolve(onApplyActions(applicable.filter((action) => !DESTRUCTIVE_ACTIONS.has(action.type))));
              if (result && typeof result === 'object') {
                applicationNote = `\n\n✓ Applied ${result.applied} change${result.applied === 1 ? '' : 's'}.${result.failed.length ? ` ⚠️ ${result.failed.join(' · ')}` : ''}`;
              }
            } catch (e) {
              applicationNote = `\n\n⚠️ The editor could not apply the requested changes: ${e instanceof Error ? e.message : 'unknown editor error'}`;
            }
          }
        } else {
          try {
            const result = await Promise.resolve(onApplyActions(applicable));
            if (result && typeof result === 'object') {
              applicationNote = `\n\n✓ Applied ${result.applied} of ${applicable.length} requested timeline change${applicable.length === 1 ? '' : 's'}.${result.failed.length ? ` ⚠️ ${result.failed.join(' · ')}` : ''}`;
            }
          } catch (e) {
            applicationNote = `\n\n⚠️ The editor could not apply the requested changes: ${e instanceof Error ? e.message : 'unknown editor error'}`;
          }
        }
      }

      if (typeof output?.transcript?.text === 'string') setLastTranscript(output.transcript.text);

      if (captions.length && onAddCaptions) {
        onAddCaptions(captions);
        setLastCaptions(captions);
      }

      setConversation((items) => [
        ...items,
        {
          role: 'assistant',
          text: (String(output.message || 'I prepared the edit.') + applicationNote + (failedNotes.length ? `\n\n⚠️ Couldn't apply: ${Array.from(new Set(failedNotes)).join(' · ')}` : '')).replace(/^\\n+/, '').trimStart(),
          actions,
          reviewCount: Number(output.reviewCount) || 0,
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The editing assistant failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0 space-y-3 overflow-x-hidden">
      <div className="overflow-hidden rounded-2xl border border-[#E5798F]/30 bg-gradient-to-br from-[#E5798F]/15 via-white/[0.03] to-black/20">
        <div className="flex items-center gap-3 p-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#E5798F]/20">
            <Bot className="h-5 w-5 text-[#FFB6C1]" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold">Editing Assistant</p>
            <p className="mt-0.5 text-[10px] leading-4 text-white/45">
              Tell me what you want changed. I can edit the project, transcribe, and build timed captions.
            </p>
          </div>
          <span className={`ml-auto flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-semibold ${
            busy
              ? 'border-[#FFB6C1]/20 bg-[#FFB6C1]/10 text-[#FFB6C1]'
              : 'border-emerald-300/15 bg-emerald-300/10 text-emerald-200'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${busy ? 'animate-pulse bg-[#FFB6C1]' : 'bg-emerald-300'}`} />
            {busy ? 'Analyzing…' : 'Ready'}
          </span>
        </div>

        <div className="border-t border-white/10 px-3 py-2">
          <div className="flex items-center gap-2 text-[10px] text-white/45">
            <Sparkles className="h-3.5 w-3.5 text-[#FFB6C1]" />
            Working with <span className="font-semibold text-white/70">{selectedLabel}</span>
          </div>
        </div>
      </div>

      {conversation.length > 0 && (
        <div className="max-h-[28dvh] min-w-0 space-y-2 overflow-x-hidden overflow-y-auto overscroll-contain pr-1">
          {conversation.map((message, index) => (
            <div key={index} className={message.role === 'user' ? 'ml-8' : 'mr-4'}>
              <div className={message.role === 'user'
                ? 'rounded-2xl rounded-br-md bg-[#E5798F] px-3 py-2.5 text-xs text-white'
                : 'rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.05] px-3 py-2.5 text-xs text-white/85'}>
                {message.text}
              </div>

              {message.role === 'assistant' && message.actions?.length ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {message.actions.map((action, actionIndex) => (
                    <span key={actionIndex} className={action.type === 'speak_narration' && action.object?.narrationFailed
                      ? 'inline-flex items-center gap-1 rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-1 text-[9px] font-semibold text-amber-200'
                      : 'inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[9px] font-semibold text-white/55'}>
                      {action.type === 'speak_narration' && action.object?.narrationFailed
                        ? <AlertTriangle className="h-2.5 w-2.5 text-amber-300" />
                        : <Check className="h-2.5 w-2.5 text-emerald-300" />}
                      {action.type === 'speak_narration' && action.object?.narrationFailed ? 'Voiceover failed' : actionLabel(action)}
                    </span>
                  ))}
                </div>
              ) : null}

              {message.role === 'assistant' && (message.reviewCount || 0) > 0 && (
                <div className="mt-1.5 rounded-xl border border-amber-300/15 bg-amber-300/10 px-3 py-2 text-[10px] text-amber-100">
                  {message.reviewCount} caption {message.reviewCount === 1 ? 'cue may' : 'cues may'} need a quick review because the speech-recognition confidence was lower.
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {pendingDestructive && (
        <div role="alertdialog" aria-label="Confirm destructive edits" className="rounded-2xl border border-red-400/30 bg-red-500/[0.08] p-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-300" />
            <p className="text-xs font-bold text-red-100">The assistant wants to remove {pendingDestructive.targets.length === 1 ? 'an item' : `${pendingDestructive.targets.length} items`}</p>
            <button type="button" onClick={() => setPendingDestructive(null)} className="ml-auto flex h-7 w-7 items-center justify-center rounded-full text-red-200/70 hover:bg-white/10" aria-label="Dismiss">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <ul className="mt-2 space-y-1">
            {pendingDestructive.targets.map((target, i) => (
              <li key={i} className="flex items-center gap-1.5 text-[11px] text-red-100/85">
                <span className="h-1 w-1 shrink-0 rounded-full bg-red-300" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{target}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-red-100/55">This cannot be undone in the assistant … undo is available in the editor history.</p>
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={() => {
                const pending = pendingDestructive;
                setPendingDestructive(null);
                if (pending && onApplyActions) void Promise.resolve(onApplyActions(pending.actions)).catch(() => undefined);
              }}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-500/90 px-3 text-[10px] font-bold text-white transition hover:bg-red-500"
            >
              <Check className="h-3.5 w-3.5" />
              Remove {pendingDestructive.targets.length === 1 ? 'it' : 'all'}
            </button>
            <button
              type="button"
              onClick={() => {
                const pending = pendingDestructive;
                setPendingDestructive(null);
                if (pending && onApplyActions) {
                  const destructive = new Set(pending.actions.filter((action) => DESTRUCTIVE_ACTIONS.has(action.type)).map((action) => `${action.type}:${action.clipId || action.elementId || ''}:${action.type === 'split_clip' ? String(action.value ?? '') : ''}`));
                  void Promise.resolve(onApplyActions(pending.actions.filter((action) => !destructive.has(`${action.type}:${action.clipId || action.elementId || ''}:${action.type === 'split_clip' ? String(action.value ?? '') : ''}`)))).catch(() => undefined);
                }
              }}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/15 px-3 text-[10px] font-bold text-white/75 transition hover:bg-white/10"
            >
              <X className="h-3.5 w-3.5" />
              Apply the rest
            </button>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-white/10 bg-[#111]/95 p-2 shadow-xl">
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void askAssistant();
            }
          }}
          rows={3}
          disabled={busy}
          placeholder="Ask your editing comrade…  “Make this cinematic”, “Add accurate captions”, “Make this faster”"
          className="w-full resize-none bg-transparent px-2 py-1.5 text-xs leading-5 text-white outline-none placeholder:text-white/25 disabled:opacity-50"
        />
        <div className="flex items-center justify-between gap-2 border-t border-white/10 px-1 pt-2">
          <span className="text-[9px] text-white/25">Enter to send · Shift+Enter for a new line</span>
          <button
            type="button"
            onClick={() => void askAssistant()}
            disabled={busy || !prompt.trim()}
            className="flex h-9 items-center gap-1.5 rounded-xl bg-[#E5798F] px-3 text-[10px] font-bold text-white transition hover:bg-[#d96d84] disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {busy ? 'Working…' : 'Send'}
          </button>
        </div>
      </div>

      {conversation.length === 0 && (
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold text-white/35">
            <Wand2 className="h-3 w-3" /> Try asking
          </div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion.label}
                type="button"
                disabled={busy}
                onClick={() => void askAssistant(suggestion.prompt)}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2.5 text-left text-[10px] font-semibold text-white/65 transition hover:bg-white/[0.07] disabled:opacity-40"
              >
                {suggestion.label}
                <ChevronRight className="h-3.5 w-3.5 text-white/25" />
              </button>
            ))}
          </div>
        </div>
      )}

      {lastTranscript && (
        <details className="rounded-2xl border border-white/10 bg-white/[0.025] p-3">
          <summary className="cursor-pointer list-none text-xs font-bold text-white/80">
            Transcript
            <span className="ml-2 text-[9px] font-normal text-white/35">timestamped source text</span>
          </summary>
          <div className="mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap rounded-xl bg-black/20 p-2.5 text-[10px] leading-4 text-white/65">
            {lastTranscript}
          </div>
        </details>
      )}

      {lastCaptions.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-3">
          <div className="flex items-center gap-2">
            <Captions className="h-4 w-4 text-[#FFB6C1]" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold">Caption track created</p>
              <p className="text-[10px] text-white/40">
                {lastCaptions.length} timed cues · word-level timing preserved
              </p>
            </div>
            <span className="rounded-full bg-emerald-300/10 px-2 py-1 text-[9px] font-semibold text-emerald-200">
              Synced
            </span>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-[11px] leading-4 text-red-200">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-2.5 text-[9px] leading-4 text-white/30">
        AI proposes only supported editor commands. The project state remains the source of truth, so edits can still be undone with the normal editor history.
      </div>
    </div>
  );
}
