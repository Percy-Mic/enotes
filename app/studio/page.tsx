'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { BarChart3, Coins, Film, LayoutTemplate, Music, ShieldCheck, Trash2, Video } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useAlert } from '@/components/ui/Alert';

/* ============================================================
   /studio — creator hub: your projects, your templates + their
   analytics (from template_events via the template_stats RPC and
   the counters on templates), your earnings ledger, and the admin
   moderation queue when you are an admin.
   ============================================================ */

interface ProjectRow {
  id: string;
  title: string;
  aspect_ratio: string;
  duration_seconds: number;
  exported_url: string | null;
  updated_at: string;
}

interface TemplateRow {
  id: string;
  title: string;
  status: string;
  premium: boolean;
  price_cents: number;
  uses: number;
  views: number;
  saves: number;
  rating_sum: number;
  rating_count: number;
  thumbnail_url: string | null;
}

interface EarningRow {
  net_cents: number;
  status: string;
}

export default function StudioPage() {
  const alert = useAlert();
  const [meId, setMeId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null); /* pending-confirm id */
  const [busyDelete, setBusyDelete] = useState(false);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [earnings, setEarnings] = useState<EarningRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        window.location.href = '/auth/sign-in';
        return;
      }
      setMeId(user.id);

      const [{ data: profile }, { data: proj }, { data: tpl }, { data: earn }] = await Promise.all([
        supabase.from('profiles').select('is_admin').eq('id', user.id).maybeSingle(),
        supabase
          .from('video_projects')
          .select('id, title, aspect_ratio, duration_seconds, exported_url, updated_at')
          .order('updated_at', { ascending: false })
          .limit(24),
        supabase
          .from('templates')
          .select('id, title, status, premium, price_cents, uses, views, saves, rating_sum, rating_count, thumbnail_url')
          /* MY templates only — RLS exposes others' published rows to the
             SELECT, but Submit/Unpublish are creator-only actions and must
             never render on a stranger's template */
          .eq('creator_id', user.id)
          .order('updated_at', { ascending: false })
          .limit(50),
        supabase.from('creator_earnings').select('net_cents, status').limit(500),
      ]);

      setIsAdmin(!!(profile as { is_admin?: boolean } | null)?.is_admin);
      setProjects((proj || []) as ProjectRow[]);
      setTemplates((tpl || []) as TemplateRow[]);
      setEarnings((earn || []) as EarningRow[]);
      setLoading(false);
    })();
  }, []);

  const netCents = earnings.reduce((acc, e) => acc + (e.status === 'paid_out' ? 0 : e.net_cents), 0);
  const paidCents = earnings.reduce((acc, e) => acc + (e.status === 'paid_out' ? e.net_cents : 0), 0);
  const totalUses = templates.reduce((acc, t) => acc + t.uses, 0);
  const approved = templates.filter((t) => t.status === 'published').length;

  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  /* Template lifecycle (creator's own templates; DB RLS is the enforcer):
     draft/rejected → submit for review · published → unpublish back to draft */
  const [tplBusyId, setTplBusyId] = useState<string | null>(null);
  const setTemplateStatus = async (id: string, status: 'pending' | 'draft') => {
    setTplBusyId(id);
    const { error } = await supabase.from('templates').update({ status }).eq('id', id);
    setTplBusyId(null);
    if (error) {
      void alert({
        title: 'Could not update template',
        message: error.message.includes('row-level security')
          ? 'Only the template creator can change its status.'
          : error.message,
        tone: 'error',
      });
      return;
    }
    setTemplates((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
  };

  /* Delete a project (and its saved timeline). Exports live in storage and
     media_library — independent assets that are intentionally kept. */
  const deleteProject = async (id: string) => {
    setBusyDelete(true);
    const { error } = await supabase.from('video_projects').delete().eq('id', id);
    setBusyDelete(false);
    if (error) {
      void alert({ title: 'Could not delete project', message: error.message, tone: 'error' });
      return;
    }
    setProjects((prev) => prev.filter((p) => p.id !== id));
    setDeletingId(null);
  };

  return (
    <main className="min-h-[100dvh] bg-[#FFF7F8] px-3 pb-24 pt-5 text-[#111111] sm:px-6 md:pb-10">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Studio</h1>
            <p className="text-sm text-[#6B6B6B]">Your projects, templates and creator tools.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/studio/video?new=1" className="flex items-center gap-1.5 rounded-xl bg-black px-4 py-2 text-sm font-semibold text-[#FFB6C1]">
              <Video className="h-4 w-4" /> New video
            </Link>
            <Link href="/studio/templates" className="flex items-center gap-1.5 rounded-xl border border-[#E8E2E4] bg-white px-4 py-2 text-sm font-semibold">
              <LayoutTemplate className="h-4 w-4" /> Marketplace
            </Link>
          </div>
        </header>

        {/* stats */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard icon={<Film className="h-4 w-4" />} label="Projects" value={String(projects.length)} />
          <StatCard icon={<LayoutTemplate className="h-4 w-4" />} label="Templates live" value={`${approved}/${templates.length}`} />
          <StatCard icon={<BarChart3 className="h-4 w-4" />} label="Template uses" value={String(totalUses)} />
          <StatCard icon={<Coins className="h-4 w-4" />} label="Available earnings" value={money(netCents)} sub={`${money(paidCents)} paid out`} />
        </section>

        {isAdmin && (
          <Link
            href="/studio/admin"
            className="flex items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800"
          >
            <ShieldCheck className="h-4 w-4" /> Admin moderation queue →
          </Link>
        )}

        {/* projects */}
        <section>
          <h2 className="mb-2 text-sm font-bold">Your projects</h2>
          {loading ? (
            <p className="text-sm text-[#6B6B6B]">Loading…</p>
          ) : projects.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#E8E2E4] bg-white/60 px-6 py-10 text-center">
              <p className="text-sm text-[#6B6B6B]">No projects yet. Start from a template or blank canvas.</p>
              <div className="mt-4 flex justify-center gap-2">
                <Link href="/studio/video" className="rounded-xl bg-black px-4 py-2 text-xs font-bold text-[#FFB6C1]">Blank project</Link>
                <Link href="/studio/templates" className="rounded-xl border border-[#E8E2E4] bg-white px-4 py-2 text-xs font-bold">Templates</Link>
              </div>
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {projects.map((p) => (
                <li key={p.id} className="group relative">
                  <Link
                    href={`/studio/video?project=${p.id}`}
                    className="block overflow-hidden rounded-2xl border border-[#E8E2E4] bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div className="flex aspect-video items-center justify-center bg-[#F3EFF0]">
                      {p.exported_url ? (
                        <video src={p.exported_url} muted preload="metadata" className="h-full w-full object-cover" />
                      ) : (
                        <Film className="h-8 w-8 text-[#C9C0C4]" />
                      )}
                    </div>
                    <div className="p-2.5">
                      <p className="truncate text-sm font-semibold">{p.title}</p>
                      <p className="text-[11px] text-[#6B6B6B]">
                        {p.aspect_ratio} · {Math.round(p.duration_seconds)}s · {new Date(p.updated_at).toLocaleDateString()}
                      </p>
                    </div>
                  </Link>
                  {/* delete — hover-revealed on desktop, always visible on touch; inline confirm so accidental taps don't nuke work */}
                  {deletingId === p.id ? (
                    <div className="absolute right-2 top-2 flex items-center gap-1 rounded-xl bg-white/95 p-1 shadow-lg ring-1 ring-black/10">
                      <button
                        onClick={() => void deleteProject(p.id)}
                        disabled={busyDelete}
                        className="rounded-lg bg-red-600 px-2 py-1 text-[11px] font-bold text-white disabled:opacity-50"
                      >
                        {busyDelete ? '…' : 'Delete'}
                      </button>
                      <button
                        onClick={() => setDeletingId(null)}
                        disabled={busyDelete}
                        className="rounded-lg px-2 py-1 text-[11px] font-semibold text-[#6B6B6B]"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeletingId(p.id)}
                      aria-label={`Delete project ${p.title}`}
                      title="Delete project"
                      className="absolute right-2 top-2 rounded-full bg-white/95 p-1.5 text-[#6B6B6B] opacity-0 shadow ring-1 ring-black/5 transition hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100 max-md:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* templates */}
        {templates.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-bold">Your templates</h2>
            <ul className="divide-y divide-[#E8E2E4] overflow-hidden rounded-2xl border border-[#E8E2E4] bg-white shadow-sm">
              {templates.map((t) => {
                const rating = t.rating_count > 0 ? (t.rating_sum / t.rating_count).toFixed(1) : '—';
                return (
                  <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                    <div className="flex h-12 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#F3EFF0]">
                      {t.thumbnail_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={t.thumbnail_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <LayoutTemplate className="h-4 w-4 text-[#C9C0C4]" />
                      )}
                    </div>
                    <div className="min-w-[9rem] flex-1">
                      <p className="truncate text-sm font-semibold">{t.title}</p>
                      <p className="text-[11px] text-[#6B6B6B]">
                        {t.uses} uses · {t.views} views · {t.saves} saves · ★ {rating}
                        {t.premium ? ` · $${(t.price_cents / 100).toFixed(2)}` : ' · Free'}
                      </p>
                    </div>
                    <div className="ml-auto flex w-full flex-wrap items-center justify-end gap-2 max-sm:justify-start sm:w-auto">
                      {(t.status === 'draft' || t.status === 'rejected') && (
                        <button
                          onClick={() => void setTemplateStatus(t.id, 'pending')}
                          disabled={tplBusyId === t.id}
                          className="shrink-0 rounded-lg bg-black px-3 py-2 text-[11px] font-bold text-[#FFB6C1] disabled:opacity-50"
                        >
                          {tplBusyId === t.id ? '…' : 'Submit for review'}
                        </button>
                      )}
                      {t.status === 'published' && (
                        <button
                          onClick={() => void setTemplateStatus(t.id, 'draft')}
                          disabled={tplBusyId === t.id}
                          className="shrink-0 rounded-lg border border-[#E8E2E4] px-3 py-2 text-[11px] font-semibold text-[#6B6B6B] hover:bg-gray-50 disabled:opacity-50"
                        >
                          {tplBusyId === t.id ? '…' : 'Unpublish'}
                        </button>
                      )}
                      <StatusPill status={t.status} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* sounds link */}
        <Link
          href="/studio/sounds"
          className="flex items-center gap-2 rounded-2xl border border-[#E8E2E4] bg-white px-4 py-3 text-sm font-semibold shadow-sm"
        >
          <Music className="h-4 w-4 text-[#E5798F]" /> Browse the licensed sound library →
        </Link>
      </div>
    </main>
  );
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-[#E8E2E4] bg-white p-3.5 shadow-sm">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-[#6B6B6B]">{icon} {label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
      {sub && <p className="text-[10px] text-[#9C9497]">{sub}</p>}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    published: 'bg-emerald-100 text-emerald-700',
    pending: 'bg-amber-100 text-amber-700',
    rejected: 'bg-red-100 text-red-600',
    draft: 'bg-gray-100 text-gray-600',
    archived: 'bg-gray-100 text-gray-400',
  };
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${styles[status] || 'bg-gray-100 text-gray-600'}`}>
      {status.replace('_', ' ')}
    </span>
  );
}
