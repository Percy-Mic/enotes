'use client';

import { useEffect, useState } from 'react';
import { Check, Film, Loader2, Play, X, Sparkles, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

export type PracticeAssignment = {
  id: string;
  title: string;
  client_name: string;
  client_avatar_url?: string | null;
  topic: string;
  brief: string;
  editing_goal?: string | null;
  required_style?: string | null;
  target_platform?: string | null;
  difficulty: string;
  orientation: 'vertical' | 'horizontal' | 'square';
  target_duration_seconds?: number | null;
  requirements: unknown;
  allowed_features: unknown;
  max_attempts?: number | null;
  time_limit_seconds?: number | null;
};

export type PracticeMedia = {
  id: string;
  assignment_id: string;
  media_type: 'video' | 'image' | 'audio';
  storage_path: string;
  public_url?: string | null;
  file_name?: string | null;
  mime_type?: string | null;
  duration_seconds?: number | null;
  width?: number | null;
  height?: number | null;
  sort_order: number;
  role?: string | null;
  description?: string | null;
};

export type PracticeSession = {
  id: string;
  assignment_id: string;
  attempt_number: number;
};

type Props = {
  userId: string;
  open: boolean;
  onClose: () => void;
  onStart: (assignment: PracticeAssignment, media: PracticeMedia[], session: PracticeSession) => void;
};

const list = (value: unknown) =>
  Array.isArray(value) ? value.map(String).filter(Boolean) : [];

export default function PracticeMode({ userId, open, onClose, onStart }: Props) {
  const [assignments, setAssignments] = useState<PracticeAssignment[]>([]);
  const [selected, setSelected] = useState<PracticeAssignment | null>(null);
  const [media, setMedia] = useState<PracticeMedia[]>([]);
  const [requirements, setRequirements] = useState<{ id: string; label: string; description?: string | null; required: boolean }[]>([]);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiBrief, setAiBrief] = useState<{ message: string; concept?: string; deliverables?: string[]; direction?: string; hook?: string } | null>(null);
  const [aiBriefLoading, setAiBriefLoading] = useState(false);
  const [aiBriefError, setAiBriefError] = useState<string | null>(null);
  const [aiBriefNonce, setAiBriefNonce] = useState(0);

  useEffect(() => {
    if (!open || !userId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      const { data, error: queryError } = await supabase
        .from('practice_assignments')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false });
      if (cancelled) return;
      if (queryError) {
        setError(queryError.message);
      } else {
        const rows = (data || []) as PracticeAssignment[];
        setAssignments(rows);
        setSelected(rows[0] || null);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, userId]);

  useEffect(() => {
    if (!selected) {
      setMedia([]);
      setRequirements([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [mediaResult, reqResult] = await Promise.all([
        supabase
          .from('practice_assignment_media')
          .select('*')
          .eq('assignment_id', selected.id)
          .order('sort_order', { ascending: true }),
        supabase
          .from('practice_assignment_requirements')
          .select('id,label,description,required')
          .eq('assignment_id', selected.id)
          .order('sort_order', { ascending: true }),
      ]);
      if (cancelled) return;
      if (mediaResult.error) {
        setError(mediaResult.error.message);
        setMedia([]);
      } else {
        setMedia((mediaResult.data || []) as PracticeMedia[]);
      }
      if (!reqResult.error) {
        setRequirements((reqResult.data || []) as typeof requirements);
      }
    })();
    return () => { cancelled = true; };
  }, [selected]);

  if (!open) return null;

  useEffect(() => {
    if (!selected) {
      setAiBrief(null);
      setAiBriefError(null);
      return;
    }
    let cancelled = false;
    setAiBriefLoading(true);
    setAiBriefError(null);
    setAiBrief(null);
    void (async () => {
      try {
        const response = await fetch('/api/video/ai', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            operation: 'assistant',
            prompt: [
              'You are the senior creative director assigning a real video-editing job in enotes Practice Mode.',
              'Create a concise client-facing creative brief for the editor based ONLY on the supplied assignment and media metadata.',
              'Do not invent media that is not supplied. Do not ask the editor to buy assets.',
              'This is an assignment brief, NOT an instruction to execute edits and NOT a request for code.',
              'Return a natural, specific message that explains WHAT video the editor must create, WHO it is for, the intended viewer reaction, the story/concept, pacing, visual direction, text/caption direction, audio direction, and what a successful final export should accomplish.',
              'Return JSON with exactly these keys: message, concept, deliverables, direction, hook. deliverables must be an array of 2-5 concrete outcomes.',
              '',
              'ASSIGNMENT:',
              JSON.stringify({
                title: selected.title,
                client_name: selected.client_name,
                topic: selected.topic,
                existing_brief: selected.brief,
                editing_goal: selected.editing_goal,
                required_style: selected.required_style,
                target_platform: selected.target_platform,
                difficulty: selected.difficulty,
                orientation: selected.orientation,
                target_duration_seconds: selected.target_duration_seconds,
                requirements: selected.requirements,
                allowed_features: selected.allowed_features,
                media: media.map((item) => ({
                  type: item.media_type,
                  file_name: item.file_name,
                  role: item.role,
                  description: item.description,
                  duration_seconds: item.duration_seconds,
                  width: item.width,
                  height: item.height,
                })),
              }),
            ].join('\n'),
            project: { practiceAssignment: selected },
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || 'The AI creative director could not prepare the brief.');
        const output = data?.output || {};
        if (!cancelled) {
          setAiBrief({
            message: String(output.message || output.brief || '').trim(),
            concept: typeof output.concept === 'string' ? output.concept : undefined,
            deliverables: Array.isArray(output.deliverables) ? output.deliverables.map(String).filter(Boolean).slice(0, 5) : undefined,
            direction: typeof output.direction === 'string' ? output.direction : undefined,
            hook: typeof output.hook === 'string' ? output.hook : undefined,
          });
        }
      } catch (e) {
        if (!cancelled) setAiBriefError(e instanceof Error ? e.message : 'The AI creative director is unavailable.');
      } finally {
        if (!cancelled) setAiBriefLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selected, media, aiBriefNonce]);
  
  const start = async () => {
    if (!selected || !media.length) {
      setError('This practice assignment does not have any media yet.');
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const resolvedMedia = await Promise.all(
        media.map(async (item) => {
          if (item.public_url || !item.storage_path) return item;
          const signed = await supabase.storage
            .from('studio-media')
            .createSignedUrl(item.storage_path, 60 * 60 * 6);
          return signed.data?.signedUrl
            ? { ...item, public_url: signed.data.signedUrl }
            : item;
        }),
      );

      const { data: existing, error: existingError } = await supabase
        .from('practice_sessions')
        .select('id,assignment_id,attempt_number,status')
        .eq('assignment_id', selected.id)
        .eq('user_id', userId)
        .eq('status', 'in_progress')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingError) throw existingError;

      if (existing) {
        onStart(selected, resolvedMedia, existing as PracticeSession);
        return;
      }

      const { data: previous, error: previousError } = await supabase
        .from('practice_sessions')
        .select('attempt_number')
        .eq('assignment_id', selected.id)
        .eq('user_id', userId)
        .order('attempt_number', { ascending: false })
        .limit(1);

      if (previousError) throw previousError;

      const nextAttempt = Number(previous?.[0]?.attempt_number || 0) + 1;
      if (selected.max_attempts && nextAttempt > selected.max_attempts) {
        throw new Error('You have reached the maximum attempts for this assignment.');
      }

      const { data: session, error: sessionError } = await supabase
        .from('practice_sessions')
        .insert({
          assignment_id: selected.id,
          user_id: userId,
          attempt_number: nextAttempt,
          status: 'in_progress',
          started_at: new Date().toISOString(),
        })
        .select('id,assignment_id,attempt_number')
        .single();

      if (sessionError || !session) throw sessionError || new Error('Could not start the practice session.');

      onStart(selected, resolvedMedia, session as PracticeSession);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start practice mode.');
    } finally {
      setStarting(false);
    }
  };

  const duration = selected?.target_duration_seconds;
  const requirementsToShow = requirements.length ? requirements : list(selected?.requirements).map((label, i) => ({
    id: `json-${i}`,
    label,
    required: true,
  }));

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/75 p-2 backdrop-blur-sm sm:items-center sm:p-6">
      <div className="max-h-[94dvh] w-full max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-[#101010] text-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E5798F]/15 text-[#FFB6C1]">
            <Film className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#FFB6C1]">Practice Mode</p>
            <h2 className="truncate text-base font-bold">Take a real client editing brief</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-white/55 hover:bg-white/10 hover:text-white" aria-label="Close practice mode">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid max-h-[calc(94dvh-68px)] overflow-y-auto md:grid-cols-[280px_1fr]">
          <aside className="border-b border-white/10 p-3 md:border-b-0 md:border-r">
            <p className="mb-2 px-2 text-[10px] font-bold uppercase tracking-wider text-white/35">Available client jobs</p>
            <div className="space-y-1.5">
              {loading ? (
                <div className="flex items-center gap-2 p-3 text-xs text-white/45"><Loader2 className="h-4 w-4 animate-spin" /> Loading briefs…</div>
              ) : assignments.map((assignment) => (
                <button
                  key={assignment.id}
                  type="button"
                  onClick={() => setSelected(assignment)}
                  className={`w-full rounded-2xl border px-3 py-3 text-left transition ${selected?.id === assignment.id ? 'border-[#E5798F]/50 bg-[#E5798F]/10' : 'border-white/5 bg-white/[0.025] hover:border-white/15'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-xs font-bold">{assignment.client_name.slice(0, 1).toUpperCase()}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-bold">{assignment.title}</span>
                      <span className="block truncate text-[9px] text-white/40">{assignment.client_name} · {assignment.difficulty}</span>
                    </span>
                  </div>
                </button>
              ))}
              {!loading && !assignments.length && (
                <p className="rounded-xl border border-dashed border-white/10 p-4 text-center text-xs text-white/40">No practice assignments are published yet.</p>
              )}
            </div>
          </aside>

          <main className="min-w-0 p-4 sm:p-6">
            {selected ? (
              <div className="space-y-4">
                <div className="rounded-3xl border border-[#E5798F]/20 bg-gradient-to-br from-[#E5798F]/10 via-white/[0.025] to-transparent p-4 sm:p-5">
                  <div className="mb-4 flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#E5798F] text-sm font-black">{selected.client_name.slice(0, 1).toUpperCase()}</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[#FFB6C1]">Client request</p>
                      <h3 className="mt-1 text-lg font-black">{selected.client_name}</h3>
                      <p className="text-xs text-white/45">{selected.title}</p>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-6 text-white/80 whitespace-pre-wrap">{selected.brief}</div>

                <div className="mt-3 overflow-hidden rounded-2xl border border-[#FFB6C1]/20 bg-gradient-to-br from-[#FFB6C1]/10 via-white/[0.03] to-transparent">
                  <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FFB6C1]/15">
                      <Sparkles className="h-4 w-4 text-[#FFB6C1]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#FFB6C1]">AI creative director</p>
                      <p className="text-xs font-bold text-white">What you need to create</p>
                    </div>
                    {aiBriefLoading && <Loader2 className="h-4 w-4 animate-spin text-[#FFB6C1]" />}
                  </div>
                  <div className="p-4">
                    {aiBriefLoading ? (
                      <div className="space-y-2">
                        <div className="h-3 animate-pulse rounded bg-white/10" />
                        <div className="h-3 w-11/12 animate-pulse rounded bg-white/10" />
                        <div className="h-3 w-4/5 animate-pulse rounded bg-white/10" />
                      </div>
                    ) : aiBriefError ? (
                      <div className="flex items-start gap-3">
                        <p className="flex-1 text-xs leading-5 text-amber-100/80">{aiBriefError}</p>
                        <button type="button" onClick={() => {
                          setAiBriefNonce((value) => value + 1);
                        }} className="rounded-lg border border-white/10 p-2 text-white/50 hover:bg-white/10" title="Regenerate AI brief">
                          <RefreshCw className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : aiBrief?.message ? (
                      <div className="space-y-3">
                        <p className="text-sm leading-6 text-white/85">{aiBrief.message}</p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {aiBrief.concept && <div className="rounded-xl bg-black/20 p-3"><p className="text-[9px] font-black uppercase tracking-wider text-white/35">Concept</p><p className="mt-1 text-xs leading-5 text-white/70">{aiBrief.concept}</p></div>}
                          {aiBrief.hook && <div className="rounded-xl bg-black/20 p-3"><p className="text-[9px] font-black uppercase tracking-wider text-white/35">Opening hook</p><p className="mt-1 text-xs leading-5 text-white/70">{aiBrief.hook}</p></div>}
                          {aiBrief.direction && <div className="rounded-xl bg-black/20 p-3 sm:col-span-2"><p className="text-[9px] font-black uppercase tracking-wider text-white/35">Creative direction</p><p className="mt-1 text-xs leading-5 text-white/70">{aiBrief.direction}</p></div>}
                        </div>
                        {aiBrief.deliverables?.length ? (
                          <div>
                            <p className="mb-2 text-[9px] font-black uppercase tracking-wider text-white/35">Deliverables</p>
                            <div className="space-y-1.5">
                              {aiBrief.deliverables.map((item, index) => <div key={index} className="flex items-start gap-2 text-xs text-white/65"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" /><span>{item}</span></div>)}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-xs text-white/40">The AI creative director did not return a brief.</p>
                    )}
                  </div>
                </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl bg-white/[0.04] p-3"><p className="text-[9px] uppercase tracking-wider text-white/35">Topic</p><p className="mt-1 text-xs font-bold">{selected.topic}</p></div>
                  <div className="rounded-2xl bg-white/[0.04] p-3"><p className="text-[9px] uppercase tracking-wider text-white/35">Format</p><p className="mt-1 text-xs font-bold">{selected.orientation} · {selected.target_platform || 'Any platform'}</p></div>
                  <div className="rounded-2xl bg-white/[0.04] p-3"><p className="text-[9px] uppercase tracking-wider text-white/35">Target</p><p className="mt-1 text-xs font-bold">{duration ? `${duration}s` : 'Flexible'} · {selected.required_style || 'Your style'}</p></div>
                </div>

                {selected.editing_goal && <div className="rounded-2xl border border-white/10 p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-white/35">Editing goal</p><p className="mt-1 text-sm text-white/75">{selected.editing_goal}</p></div>}

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-white/35">Client media · {media.length} assets</p>
                    <span className="text-[9px] text-white/30">All clips belong to this brief</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {media.map((item) => (
                      <div key={item.id} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]">
                        {item.public_url ? (
                          item.media_type === 'image'
                            ? <img src={item.public_url} alt={item.description || item.file_name || ''} className="aspect-video w-full object-cover" />
                            : <video src={item.public_url} muted playsInline preload="metadata" className="aspect-video w-full object-cover" />
                        ) : (
                          <div className="flex aspect-video items-center justify-center bg-black text-[9px] text-white/30">Storage path only</div>
                        )}
                        <div className="p-2">
                          <p className="truncate text-[10px] font-bold">{item.file_name || item.role || item.media_type}</p>
                          <p className="truncate text-[9px] text-white/35">{item.role || item.description || 'Client asset'}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {requirementsToShow.length > 0 && (
                  <div className="rounded-2xl border border-white/10 p-4">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-white/35">Client checklist</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {requirementsToShow.map((item) => (
                        <div key={item.id} className="flex items-start gap-2 text-xs text-white/65">
                          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#FFB6C1]" />
                          <span>{item.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {error && <p className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-xs text-red-200">{error}</p>}

                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 pt-4">
                  <button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-xs font-bold text-white/55 hover:bg-white/5">Not now</button>
                  <button type="button" onClick={() => void start()} disabled={starting || !media.length} className="inline-flex items-center gap-2 rounded-xl bg-[#E5798F] px-5 py-2.5 text-xs font-black text-white shadow-lg shadow-[#E5798F]/20 disabled:opacity-50">
                    {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
                    Start editing this brief
                  </button>
                </div>
              </div>
            ) : (
              <div className="py-16 text-center text-sm text-white/40">Choose a client assignment to begin.</div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}