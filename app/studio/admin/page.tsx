'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Loader2, Save, ShieldAlert, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useAlert } from '@/components/ui/Alert';

/* ============================================================
   /studio/admin — admin-only moderation queue.
   Access is enforced HERE for UX but ENFORCED by RLS in the DB:
   non-admins cannot read pending templates or update status
   (see supabase/migrations/2026-09-14_schema_enhancements.sql).
   ============================================================ */

interface PendingTemplate {
  id: string;
  title: string;
  category: string;
  premium: boolean;
  price_cents: number;
  created_at: string;
  creator: { username: string; full_text_name: string };
}

interface ReportRow {
  id: string;
  target_type: string;
  target_id: string;
  reason: string;
  details: string | null;
  status: string;
  created_at: string;
  reporter: { username: string };
}

export default function AdminPage() {
  const alert = useAlert();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<'templates' | 'reports' | 'config'>('templates');
  const [pending, setPending] = useState<PendingTemplate[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [config, setConfig] = useState<Record<string, any>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        window.location.href = '/auth/sign-in';
        return;
      }
      const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
      const isAdmin = !!(profile as { is_admin?: boolean } | null)?.is_admin;
      setAllowed(isAdmin);
      if (!isAdmin) return;

      const [{ data: tpl }, { data: rep }, { data: cfg }] = await Promise.all([
        supabase
          .from('templates')
          .select('id, title, category, premium, price_cents, created_at, creator:profiles!templates_creator_id_fkey(username, full_text_name)')
          .eq('status', 'pending')
          .order('created_at')
          .limit(100),
        supabase
          .from('reports')
          .select('id, target_type, target_id, reason, details, status, created_at, reporter:profiles!reports_reporter_id_fkey(username)')
          .eq('status', 'open')
          .order('created_at')
          .limit(100),
        supabase.from('platform_config').select('key, value').neq('key', 'push_send_secret'),
      ]);
      setPending((tpl || []) as unknown as PendingTemplate[]);
      setReports((rep || []) as unknown as ReportRow[]);
      setConfig(Object.fromEntries(((cfg || []) as { key: string; value: unknown }[]).map((row) => [row.key, row.value])));
    })();
  }, []);

  const moderate = async (id: string, action: 'published' | 'rejected' | 'archived') => {
    /* the review RPCs are the single write path: they flip status AND write
       the template_reviews audit row server-side (admins-only, enforced in SQL) */
    const rpc =
      action === 'published'
        ? 'admin_approve_template'
        : action === 'rejected'
          ? 'admin_reject_template'
          : 'admin_archive_template';
    setBusyId(id);
    const { error } = await supabase.rpc(rpc, {
      p_template_id: id,
      p_note: action === 'rejected' ? window.prompt('Rejection note (required):') || null : null,
    });
    if (error) {
      void alert({ title: 'Review failed', message: error.message, tone: 'error' });
    } else {
      setPending((prev) => prev.filter((t) => t.id !== id));
    }
    setBusyId(null);
  };

  if (allowed === null) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-[#FFF7F8] text-sm text-[#6B6B6B]">
        Checking access…
      </main>
    );
  }

  if (!allowed) {
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-2 bg-[#FFF7F8] px-6 text-center">
        <ShieldAlert className="h-10 w-10 text-[#C9C0C4]" />
        <h1 className="text-lg font-bold">Admins only</h1>
        <p className="max-w-sm text-sm text-[#6B6B6B]">
          You&apos;re not an admin. The first registered account is admin — grant more with
          {' '}
          <code className="rounded bg-[#F3EFF0] px-1">update profiles set is_admin = true where id = …</code>
        </p>
        <Link href="/studio" className="mt-3 rounded-xl bg-black px-5 py-2.5 text-sm font-semibold text-[#FFB6C1]">Back to studio</Link>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-[#FFF7F8] px-3 pb-24 pt-5 text-[#111111] sm:px-6 md:pb-10">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <header>
          <h1 className="text-xl font-bold">Admin moderation</h1>
          <p className="text-sm text-[#6B6B6B]">Review submissions and reports. Nothing goes public without approval.</p>
        </header>

        <div className="flex gap-1 rounded-xl bg-white p-1 shadow-sm">
          {([['templates', `Templates (${pending.length})`], ['reports', `Reports (${reports.length})`], ['config', 'Config']] as const).map(
            ([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`min-h-[40px] flex-1 rounded-lg text-sm font-semibold ${tab === key ? 'bg-black text-[#FFB6C1]' : 'text-[#6B6B6B]'}`}
              >
                {label}
              </button>
            )
          )}
        </div>

        {tab === 'templates' && (
          pending.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#E8E2E4] bg-white/60 px-6 py-12 text-center text-sm text-[#6B6B6B]">
              Queue clear — no templates waiting for review. 🎉
            </div>
          ) : (
            <ul className="space-y-3">
              {pending.map((t) => (
                <li key={t.id} className="rounded-2xl border border-[#E8E2E4] bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{t.title}</p>
                      <p className="text-xs text-[#6B6B6B]">
                        @{t.creator.username} · {t.category} · {t.premium ? `$${(t.price_cents / 100).toFixed(2)} premium` : 'free'}
                      </p>
                    </div>
                    <button
                      onClick={() => void moderate(t.id, 'published')}
                      disabled={busyId === t.id}
                      className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" /> Approve
                    </button>
                    <button
                      onClick={() => void moderate(t.id, 'rejected')}
                      disabled={busyId === t.id}
                      className="flex items-center gap-1 rounded-lg bg-red-100 px-3 py-2 text-xs font-bold text-red-600 disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" /> Reject
                    </button>
                    <button
                      onClick={() => void moderate(t.id, 'archived')}
                      disabled={busyId === t.id}
                      className="flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-2 text-xs font-bold text-gray-600 disabled:opacity-50"
                    >
                      Archive
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )
        )}

        {tab === 'reports' && (
          reports.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#E8E2E4] bg-white/60 px-6 py-12 text-center text-sm text-[#6B6B6B]">
              No open reports.
            </div>
          ) : (
            <ul className="space-y-3">
              {reports.map((r) => (
                <li key={r.id} className="rounded-2xl border border-[#E8E2E4] bg-white p-4 shadow-sm">
                  <p className="text-sm font-semibold">
                    {r.target_type} · {r.reason}
                  </p>
                  {r.details && <p className="mt-1 text-xs text-[#6B6B6B]">{r.details}</p>}
                  <p className="mt-1 text-[11px] text-[#9C9497]">
                    by @{r.reporter?.username} · {new Date(r.created_at).toLocaleString()} · target{' '}
                    <code className="rounded bg-[#F3EFF0] px-1">{r.target_id.slice(0, 8)}…</code>
                  </p>
                  <button
                    onClick={async () => {
                      await supabase.from('reports').update({ status: 'resolved' }).eq('id', r.id);
                      setReports((prev) => prev.filter((x) => x.id !== r.id));
                    }}
                    className="mt-2 rounded-lg bg-black px-3 py-1.5 text-xs font-bold text-[#FFB6C1]"
                  >
                    Mark resolved
                  </button>
                </li>
              ))}
            </ul>
          )
        )}

        {tab === 'config' && (
          <div className="space-y-4">
            <p className="text-xs text-[#6B6B6B]">Manage marketplace, plans, billing, and push delivery directly. Supabase RLS still requires platform-admin privileges.</p>
            {(['marketplace', 'plans', 'billing', 'push_endpoint'] as const).map((key) => {
              const value = config[key] as any;
              if (value == null) return null;
              const save = async () => {
                setSavingKey(key);
                const { error } = await supabase.from('platform_config').update({ value, updated_at: new Date().toISOString() }).eq('key', key);
                setSavingKey(null);
                if (error) void alert({ title: 'Save failed', message: error.message, tone: 'error' });
                else void alert({ title: 'Saved', message: key + ' updated.', tone: 'success' });
              };
              return (
                <section key={key} className="rounded-2xl border border-[#E8E2E4] bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div><h2 className="text-sm font-bold capitalize">{key.replace('_', ' ')}</h2><p className="text-[11px] text-[#8D8588]">{key === 'marketplace' ? 'Creator payouts and commission.' : key === 'plans' ? 'Storage and export limits.' : key === 'billing' ? 'Pro pricing and checkout providers.' : 'Notification delivery endpoint.'}</p></div>
                    <button onClick={() => void save()} disabled={savingKey === key} className="inline-flex items-center gap-1.5 rounded-lg bg-black px-3 py-2 text-xs font-bold text-[#FFB6C1] disabled:opacity-50">{savingKey === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save</button>
                  </div>
                  {key === 'marketplace' && (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <label className="text-xs font-semibold">Commission %<input className="mt-1 w-full rounded-lg border border-[#E8E2E4] px-3 py-2 text-sm" type="number" min="0" max="100" value={value.commission_percent ?? 15} onChange={(e) => setConfig(p => ({...p, marketplace:{...value, commission_percent:Number(e.target.value)}}))} /></label>
                      <label className="text-xs font-semibold">Payout minimum<input className="mt-1 w-full rounded-lg border border-[#E8E2E4] px-3 py-2 text-sm" type="number" min="0" value={value.payout_minimum ?? 25} onChange={(e) => setConfig(p => ({...p, marketplace:{...value, payout_minimum:Number(e.target.value)}}))} /></label>
                      <label className="text-xs font-semibold">Currency<input className="mt-1 w-full rounded-lg border border-[#E8E2E4] px-3 py-2 text-sm" value={value.currency ?? 'USD'} onChange={(e) => setConfig(p => ({...p, marketplace:{...value, currency:e.target.value.toUpperCase()}}))} /></label>
                    </div>
                  )}
                  {key === 'plans' && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {(['free','pro'] as const).map(plan => (
                        <div key={plan} className="rounded-xl border border-[#E8E2E4] p-3">
                          <p className="mb-2 text-sm font-bold capitalize">{plan}</p>
                          <label className="block text-xs font-semibold">Storage MB<input className="mt-1 w-full rounded-lg border border-[#E8E2E4] px-3 py-2 text-sm" type="number" min="0" value={value[plan]?.storage_mb ?? ''} onChange={(e) => setConfig(p => ({...p, plans:{...value, [plan]:{...(value[plan]||{}), storage_mb:Number(e.target.value)}}}))} /></label>
                          <label className="mt-2 block text-xs font-semibold">Export max height<input className="mt-1 w-full rounded-lg border border-[#E8E2E4] px-3 py-2 text-sm" type="number" min="0" value={value[plan]?.export_max_height ?? ''} onChange={(e) => setConfig(p => ({...p, plans:{...value, [plan]:{...(value[plan]||{}), export_max_height:Number(e.target.value)}}}))} /></label>
                        </div>
                      ))}
                    </div>
                  )}
                  {key === 'billing' && (
                    <div className="space-y-3">
                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="text-xs font-semibold">Pro amount (cents)<input className="mt-1 w-full rounded-lg border border-[#E8E2E4] px-3 py-2 text-sm" type="number" min="0" value={value.pro?.amount_cents ?? ''} onChange={(e) => setConfig(p => ({...p, billing:{...value, pro:{...(value.pro||{}), amount_cents:Number(e.target.value)}}}))} /></label>
                        <label className="text-xs font-semibold">Billing period (days)<input className="mt-1 w-full rounded-lg border border-[#E8E2E4] px-3 py-2 text-sm" type="number" min="1" value={value.pro?.billing_period_days ?? 30} onChange={(e) => setConfig(p => ({...p, billing:{...value, pro:{...(value.pro||{}), billing_period_days:Number(e.target.value)}}}))} /></label>
                        <label className="text-xs font-semibold">Currency<input className="mt-1 w-full rounded-lg border border-[#E8E2E4] px-3 py-2 text-sm" value={value.currency ?? 'PHP'} onChange={(e) => setConfig(p => ({...p, billing:{...value, currency:e.target.value.toUpperCase()}}))} /></label>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {Object.entries(value.providers || {}).map(([name, provider]: [string, any]) => <label key={name} className="flex items-center justify-between rounded-lg border border-[#E8E2E4] px-3 py-2 text-xs font-semibold">{name.toUpperCase()}<input type="checkbox" checked={provider?.enabled === true} onChange={(e) => setConfig(p => ({...p, billing:{...value, providers:{...(value.providers||{}), [name]:{...(provider||{}), enabled:e.target.checked}}}}))} /></label>)}
                      </div>
                      <p className="text-[11px] text-[#8D8588]">Payment API keys remain in Vercel environment variables.</p>
                    </div>
                  )}
                  {key === 'push_endpoint' && <input className="w-full rounded-lg border border-[#E8E2E4] px-3 py-2 text-sm" value={typeof value === 'string' ? value : ''} onChange={(e) => setConfig(p => ({...p, push_endpoint:e.target.value}))} />}
                </section>
              );
            })}
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-800"><strong>Protected:</strong> <code>push_send_secret</code> is never selected or rendered by this page.</div>
          </div>
        )}
    </main>
  );
}
