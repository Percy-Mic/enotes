'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, ShieldAlert, X } from 'lucide-react';
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
  const [config, setConfig] = useState<{ key: string; value: unknown }[]>([]);
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
        supabase.from('platform_config').select('key, value'),
      ]);
      setPending((tpl || []) as unknown as PendingTemplate[]);
      setReports((rep || []) as unknown as ReportRow[]);
      setConfig((cfg || []) as never);
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
          <div className="space-y-3">
            <p className="text-xs text-[#6B6B6B]">
              Platform configuration (commission, plans). Change values in SQL — the app reads them dynamically:
            </p>
            {config.map((row) => (
              <div key={row.key} className="rounded-2xl border border-[#E8E2E4] bg-white p-4 shadow-sm">
                <p className="text-sm font-bold">{row.key}</p>
                <pre className="mt-1 overflow-x-auto rounded-lg bg-[#F3EFF0] p-2 text-[11px]">{JSON.stringify(row.value, null, 2)}</pre>
              </div>
            ))}
            <div className="rounded-2xl border border-[#E8E2E4] bg-white p-4 text-xs leading-relaxed text-[#6B6B6B] shadow-sm">
              <p className="font-semibold text-[#111111]">Update example</p>
              <pre className="mt-1 overflow-x-auto rounded-lg bg-[#F3EFF0] p-2 text-[11px]">{`update public.platform_config
set value = jsonb_set(value, '{commission_percent}', '10')
where key = 'marketplace';`}</pre>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
