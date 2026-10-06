'use client';

import { useEffect, useState } from 'react';
import { Check, Film, Loader2, Play, X } from 'lucide-react';
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

  const start = async () => {
    if (!selected || !media.length) {
      setError('This practice assignment does not have any media yet.');
      return;
    }
    setStarting(true);
    setError(null);
    try {
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

      onStart(selected, media, session as PracticeSession);
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
