'use client';

import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import {
  Bot,
  Captions,
  Check,
  ChevronRight,
  Loader2,
  Sparkles,
  Wand2,
} from 'lucide-react';

export type VideoAIEditAction = {
  type:
    | 'set_clip_speed'
    | 'set_clip_volume'
    | 'set_clip_mute'
    | 'set_clip_filter'
    | 'set_clip_effect'
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
    | 'set_keyframe'
    | 'add_text_element'
    | 'split_clip'
    | 'reorder_clip'
    | 'add_stock_video'
    | 'add_library_audio';
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
  onApplyActions?: (actions: VideoAIEditAction[]) => void;
};

const SUGGESTIONS = [
  { label: 'Make it an advertisement', prompt: 'Turn this project into a polished short advertisement. You may reuse, trim, reorder, duplicate, and style the existing footage. If extra B-roll would materially improve it, request suitable free stock footage.' },
  { label: 'Make this cinematic', prompt: 'Make the selected clip feel cinematic using real editor effects, color adjustments, motion, and tasteful keyframes.' },
  { label: 'Improve the pacing', prompt: 'Improve the pacing of this project. Use cuts, trims, speed changes, beat-friendly timing, and clip ordering where appropriate.' },
  { label: 'Make it social-ready', prompt: 'Prepare this project for social media. Choose a suitable aspect ratio, improve framing, captions, text hierarchy, and pacing.' },
  { label: 'Make the suggestions', prompt: 'Apply the suggestions from your previous response to the current project. Do not ask me to restate them.' },
  { label: 'Add captions', prompt: 'Generate accurate timed captions and add them to the timeline with readable animated styling.' },
];

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
    case 'set_element_opacity': return 'Overlay opacity adjusted';
    case 'set_keyframe': return 'Motion keyframe added';
    case 'add_text_element': return 'Text added';
    case 'split_clip': return 'Clip split';
    case 'reorder_clip': return 'Clip reordered';
    case 'add_stock_video': return `Stock footage → ${String(action.object?.query || 'selected topic')}`;
    case 'add_library_audio': return `Library audio → ${String(action.object?.soundId || 'selected sound')}`;
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
  const [error, setError] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Array<{
    role: 'user' | 'assistant';
    text: string;
    actions?: VideoAIEditAction[];
    reviewCount?: number;
  }>>([]);
  const [lastCaptions, setLastCaptions] = useState<VideoAICaption[]>([]);
  const [lastTranscript, setLastTranscript] = useState<string>('');

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
      const response = await fetch('/api/video/ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operation: 'assistant',
          projectId,
          project,
          mediaUrl: selectedMediaUrl,
          mediaType: selectedMediaType,
          mediaUrls: (() => {
            const raw = project && typeof project === 'object' ? project as { clips?: Array<{ src?: string }> } : {};
            const urls = Array.isArray(raw.clips)
              ? raw.clips
                  .map((clip) => clip?.src)
                  .filter((url): url is string => typeof url === 'string' && /^https?:\/\//i.test(url))
                  .slice(0, 10)
              : [];
            if (selectedMediaUrl && !urls.includes(selectedMediaUrl)) urls.unshift(selectedMediaUrl);
            return urls.slice(0, 10).map((url) => ({ url, type: 'video' as const }));
          })(),
          selection: {
            clipId: selectedClipId,
            elementId: selectedElementId,
          },
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

      const output = data?.output || {};
      const actions: VideoAIEditAction[] = Array.isArray(output.actions) ? output.actions : [];
      const captions: VideoAICaption[] = Array.isArray(output.captions) ? output.captions : [];

      const libraryAudioActions = actions.filter((action) => action.type === 'add_library_audio');
      for (const action of libraryAudioActions) {
        const soundId = typeof action.object?.soundId === 'string' ? action.object.soundId : '';
        if (!soundId || !onAddLibraryAudio) continue;
        try {
          await onAddLibraryAudio(soundId);
        } catch {
          /* A missing/unavailable library item must not block the rest of the edit. */
        }
      }

      const stockActions = actions.filter((action) => action.type === 'add_stock_video');
      for (const action of stockActions) {
        const query = typeof action.object?.query === 'string' ? action.object.query.trim() : '';
        if (!query || !onAddStockVideo) continue;
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
          }
        } catch {
          /* Stock is optional; the editor still applies the rest of the plan. */
        }
      }

      if (actions.length && onApplyActions) {
        onApplyActions(actions.filter((action) =>
          action.type !== 'generate_captions' &&
          action.type !== 'transcribe' &&
          action.type !== 'add_stock_video' &&
          action.type !== 'add_library_audio'
        ));
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
          text: String(output.message || 'I prepared the edit.'),
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
                    <span key={actionIndex} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[9px] font-semibold text-white/55">
                      <Check className="h-2.5 w-2.5 text-emerald-300" />
                      {actionLabel(action)}
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
