'use client';

import { useState } from 'react';
import { Bot, Captions, CheckCircle2, FileAudio, ImagePlus, Loader2, Wand2 } from 'lucide-react';

type Props = {
  projectId?: string | null;
  project: unknown;
  selectedMediaUrl?: string | null;
  onAddCaptions?: (captions: { id: string; text: string; start: number; end: number }[]) => void;
  onAddMedia?: (media: { url: string; name: string }) => void;
};

const ACTIONS = [
  { id: 'analyze', label: 'AI analyze', hint: 'Find pacing, visual and audio improvements', icon: Wand2 },
  { id: 'assistant', label: 'Editing assistant', hint: 'Ask AI how to improve the current edit', icon: Bot },
  { id: 'generate-captions', label: 'Auto captions', hint: 'Timestamped captions from your selected media', icon: Captions },
  { id: 'transcribe', label: 'Transcribe', hint: 'Get a timestamped transcript', icon: FileAudio },
  { id: 'remove-background', label: 'Remove background', hint: 'Provider-ready AI image/video operation', icon: ImagePlus },
] as const;

export default function VideoAIStudio({ projectId, project, selectedMediaUrl, onAddCaptions, onAddMedia }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');

  async function run(operation: string) {
    setBusy(operation);
    setError(null);
    setResult(null);
    try {
      const response = await fetch('/api/video/ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operation, projectId, project, mediaUrl: selectedMediaUrl, prompt }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'AI request failed.');
      setResult(data.output);
      if (operation === 'generate-captions' && onAddCaptions && Array.isArray(data.output?.captions)) {
        onAddCaptions(data.output.captions);
      }
      if (operation === 'remove-background' && onAddMedia && data.output?.url) {
        onAddMedia({ url: data.output.url, name: 'AI background removed.png' });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI request failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-[#E5798F]/30 bg-gradient-to-br from-[#E5798F]/15 to-white/[0.03] p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E5798F]/20"><Wand2 className="h-5 w-5 text-[#FFB6C1]" /></div>
          <div><p className="text-sm font-bold">AI Studio</p><p className="text-[10px] text-white/45">AI is an optional layer. Normal editing stays local and instant.</p></div>
        </div>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
        placeholder="Tell the editor what you want… e.g. “Make this feel cinematic and faster.”"
        className="w-full resize-none rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-xs text-white outline-none focus:border-[#E5798F]/70"
      />

      {!selectedMediaUrl && <div className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-[11px] text-amber-100">Select an imported clip or image on the canvas/timeline first. AI media tools need the saved Studio media URL.</div>}

      <div className="grid grid-cols-1 gap-2">
        {ACTIONS.map(({ id, label, hint, icon: Icon }) => (
          <button key={id} type="button" onClick={() => void run(id)} disabled={!!busy} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-left transition hover:bg-white/[0.08] disabled:opacity-50">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.07]"><Icon className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1"><span className="block text-xs font-bold">{label}</span><span className="mt-0.5 block text-[10px] text-white/40">{hint}</span></span>
            {busy === id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4 text-white/20" />}
          </button>
        ))}
      </div>

      {error && <div className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-[11px] text-red-200">{error}</div>}
      {result != null && (
        <pre className="max-h-64 overflow-auto rounded-xl bg-black/30 p-3 text-[10px] leading-4 text-white/70">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
