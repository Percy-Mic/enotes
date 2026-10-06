'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Sparkles, Volume2, Wand2 } from 'lucide-react';

type GeneratedAudio = {
  url: string;
  storage_path: string;
  kind: string;
  title: string;
};

type Props = {
  onAdd: (audio: { title: string; url: string; storage_path: string; duration_seconds: number }, kind: 'music' | 'voiceover') => void;
};

export default function ElevenLabsAudioTools({ onAdd }: Props) {
  const [mode, setMode] = useState<'voice' | 'sfx' | 'music'>('voice');
  const [text, setText] = useState('');
  const [voices, setVoices] = useState<Array<{ voice_id: string; name: string }>>([]);
  const [voiceId, setVoiceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/video/elevenlabs?action=voices')
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data?.error || 'Could not load ElevenLabs voices.');
        const list = Array.isArray(data?.voices) ? data.voices : [];
        if (!cancelled) {
          setVoices(list.map((v: any) => ({ voice_id: String(v.voice_id), name: String(v.name || 'Voice') })));
          if (!voiceId && list[0]?.voice_id) setVoiceId(String(list[0].voice_id));
        }
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load voices.'); });
    return () => { cancelled = true; };
  }, []);

  const placeholder = useMemo(() => {
    if (mode === 'voice') return 'Type narration, dialogue, captions, or an AI voiceover…';
    if (mode === 'sfx') return 'Describe the sound: cinematic whoosh, camera shutter, rain on glass…';
    return 'Describe the music: emotional Filipino acoustic intro, upbeat OPM-inspired instrumental…';
  }, [mode]);

  const generate = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/video/elevenlabs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: mode === 'voice' ? 'text-to-speech' : mode === 'sfx' ? 'sound-effect' : 'music',
          text: text.trim(),
          voice_id: mode === 'voice' ? voiceId : undefined,
          music_length_ms: mode === 'music' ? 30000 : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'ElevenLabs generation failed.');

      const audio = new Audio(data.url);
      await new Promise<void>((resolve) => {
        audio.onloadedmetadata = () => resolve();
        audio.onerror = () => resolve();
      });
      onAdd({
        title: mode === 'voice' ? 'AI voiceover' : mode === 'sfx' ? 'AI sound effect' : 'AI music',
        url: data.url,
        storage_path: data.storage_path,
        duration_seconds: Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : mode === 'music' ? 30 : 5,
      }, mode === 'voice' ? 'voiceover' : 'music');
      setText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E5798F]/15 text-[#E5798F]"><Sparkles className="h-4 w-4" /></div>
        <div>
          <p className="text-sm font-bold">AI Audio</p>
          <p className="text-[9px] text-white/35">Powered by ElevenLabs · generated audio is saved to your Studio project</p>
        </div>
      </div>
      <div className="mb-2 grid grid-cols-3 gap-1.5">
        {([
          ['voice', 'AI Voice'],
          ['sfx', 'Sound FX'],
          ['music', 'AI Music'],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setMode(id)}
            className={`rounded-lg border px-2 py-2 text-[9px] font-bold ${mode === id ? 'border-[#E5798F] bg-[#E5798F]/15 text-white' : 'border-white/10 bg-black/20 text-white/45'}`}>
            {label}
          </button>
        ))}
      </div>
      {mode === 'voice' && (
        <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}
          className="mb-2 h-9 w-full rounded-lg border border-white/10 bg-black/30 px-2 text-[10px] text-white outline-none">
          {voices.length === 0 && <option value="">Loading voices…</option>}
          {voices.map((voice) => <option key={voice.voice_id} value={voice.voice_id}>{voice.name}</option>)}
        </select>
      )}
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder}
        className="min-h-20 w-full resize-y rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-white outline-none focus:border-[#E5798F]" />
      <button type="button" disabled={busy || !text.trim() || (mode === 'voice' && !voiceId)} onClick={() => void generate()}
        className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#E5798F] text-xs font-bold text-white disabled:opacity-40">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
        {busy ? 'Generating…' : mode === 'voice' ? 'Generate voiceover' : mode === 'sfx' ? 'Generate sound effect' : 'Generate music'}
      </button>
      {error && <p className="mt-2 text-[10px] leading-4 text-red-300">{error}</p>}
    </section>
  );
}
