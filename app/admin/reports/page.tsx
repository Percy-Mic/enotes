'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertOctagon,
  ArrowLeft,
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  Flag,
  Loader2,
  Search,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

/* ============================================================
   /admin/reports — admin-only moderation queue.

   Authorization is DATABASE-enforced: the page hides itself for
   non-admins, and every query/RPC below additionally fails closed
   under the reports RLS policies + is_current_user_admin() guards
   in the migration. Hiding the UI is a courtesy, not the control.
   ============================================================ */

type ReportRow = {
  id: string;
  reporter_id: string;
  target_type: string;
  target_id: string;
  reason: string;
  details: string | null;
  status: string;
  admin_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  reporter?: { username?: string | null; full_text_name?: string | null; avatar_url?: string | null } | null;
};

type TargetSnapshot = {
  found: boolean;
  type?: string;
  data?: Record<string, unknown> | null;
};

const STATUSES = ['open', 'reviewing', 'resolved', 'dismissed'] as const;
type StatusFilter = 'all' | (typeof STATUSES)[number];

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-amber-100 text-amber-800',
  reviewing: 'bg-blue-100 text-blue-800',
  resolved: 'bg-green-100 text-green-800',
  dismissed: 'bg-gray-100 text-gray-600',
};

function timeAgo(iso: string) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

/** Human-readable summary of the reported target from the admin RPC snapshot. */
function targetSummary(snap: TargetSnapshot | null): React.ReactNode {
  if (!snap || !snap.found) return <span className="italic text-black/40">Content no longer exists (deleted)</span>;
  const d = snap.data || {};
  switch (snap.type) {
    case 'post': {
      const text = String(d.content || '').slice(0, 220);
      return (
        <div className="space-y-1">
          <p className="whitespace-pre-wrap text-sm">{text || <span className="italic text-black/40">(media-only post)</span>}</p>
          {d.media_url ? (
            String(d.media_type) === 'video' ? (
              <video src={String(d.media_url)} controls className="max-h-64 rounded-lg" preload="metadata" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={String(d.media_url)} alt="reported media" className="max-h-64 rounded-lg" />
            )
          ) : null}
        </div>
      );
    }
    case 'comment':
      return <p className="whitespace-pre-wrap text-sm">{String(d.content || '').slice(0, 220)}</p>;
    case 'message':
      return (
        <div className="space-y-1">
          <p className="whitespace-pre-wrap text-sm">{d.deleted_at ? <span className="italic text-black/40">(message deleted)</span> : String(d.content || '').slice(0, 220)}</p>
          {d.media_url ? (
            String(d.media_type) === 'video' ? (
              <video src={String(d.media_url)} controls className="max-h-64 rounded-lg" preload="metadata" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={String(d.media_url)} alt="reported media" className="max-h-64 rounded-lg" />
            )
          ) : null}
        </div>
      );
    case 'profile':
      return (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {d.avatar_url ? <img src={String(d.avatar_url)} alt="" className="h-10 w-10 rounded-full object-cover" /> : null}
          <div>
            <p className="text-sm font-semibold">{String(d.full_text_name || d.username || 'User')}</p>
            <p className="text-xs text-black/45">@{String(d.username || 'unknown')}</p>
          </div>
        </div>
      );
    case 'conversation':
      return (
        <p className="text-sm">
          {d.is_group ? 'Group' : 'Direct'} conversation{d.title ? ` · ${String(d.title)}` : ''}
        </p>
      );
    default:
      return <span className="text-sm">{snap.type}</span>;
  }
}

export default function AdminReportsPage() {
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<TargetSnapshot | null>(null);
  const [snapLoading, setSnapLoading] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const PAGE_SIZE = 20;

  const load = useCallback(async (status: StatusFilter, term: string, pageNum: number) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setAuthorized(false);
      setLoading(false);
      return;
    }
    const { data: isAdmin, error: adminError } = await supabase.rpc('is_current_user_admin');
    if (adminError || !isAdmin) {
      setAuthorized(false);
      setLoading(false);
      return;
    }
    setAuthorized(true);

    let query = supabase
      .from('reports')
      .select(
        'id, reporter_id, target_type, target_id, reason, details, status, admin_note, reviewed_at, created_at, reporter:profiles!reports_reporter_id_fkey(username, full_text_name, avatar_url)',
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })
      .range(pageNum * PAGE_SIZE, pageNum * PAGE_SIZE + PAGE_SIZE - 1);

    if (status !== 'all') query = query.eq('status', status);
    if (term.trim()) query = query.ilike('reason', `%${term.trim()}%`);

    const { data, error, count } = await query;
    if (error) {
      setActionError(`Could not load reports — ${error.message}`);
      setReports([]);
      setPageCount(0);
    } else {
      setReports((data || []) as unknown as ReportRow[]);
      setPageCount(Math.max(1, Math.ceil((count || 0) / PAGE_SIZE)));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    setLoading(true);
    void load(statusFilter, search, page);
  }, [load, statusFilter, search, page]);

  const openDetail = async (r: ReportRow) => {
    if (expandedId === r.id) {
      setExpandedId(null);
      setSnapshot(null);
      return;
    }
    setExpandedId(r.id);
    setSnapshot(null);
    setNoteDraft(r.admin_note || '');
    setActionError(null);
    setSnapLoading(true);
    const { data, error } = await supabase.rpc('admin_report_target', { p_report_id: r.id });
    setSnapLoading(false);
    if (error) setActionError(`Could not load the reported content — ${error.message}`);
    else setSnapshot(data as TargetSnapshot);

    /* move to reviewing automatically the first time an admin opens it */
    if (r.status === 'open') {
      await supabase.rpc('admin_set_report_status', { p_report_id: r.id, p_status: 'reviewing' });
      setReports((list) => list.map((x) => (x.id === r.id ? { ...x, status: 'reviewing' } : x)));
      if (statusFilter === 'open') setExpandedId(null); // it left the filter; avoid confusion
    }
  };

  const setStatus = async (r: ReportRow, status: (typeof STATUSES)[number]) => {
    setBusyId(r.id);
    setActionError(null);
    const { error } = await supabase.rpc('admin_set_report_status', {
      p_report_id: r.id,
      p_status: status,
      p_note: noteDraft.trim() || null,
    });
    setBusyId(null);
    if (error) {
      setActionError(`Could not update the report — ${error.message}`);
      return;
    }
    setReports((list) => list.filter((x) => (x.id === r.id ? (statusFilter === 'all' ? { ...x, status } : false) : true)) as ReportRow[]);
    setExpandedId(null);
    setSnapshot(null);
  };

  if (loading) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-[#fff7f8]">
        <div className="flex items-center gap-2 text-sm text-black/50">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading reports…
        </div>
      </main>
    );
  }

  if (!authorized) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-[#fff7f8] px-5">
        <div className="w-full max-w-md rounded-3xl border border-black/10 bg-white p-8 text-center shadow-sm">
          <Ban className="mx-auto h-10 w-10 text-red-500" />
          <h1 className="mt-4 text-xl font-bold">Access denied</h1>
          <p className="mt-2 text-sm leading-6 text-black/50">Only platform administrators can open the moderation queue.</p>
          <Link href="/admin" className="mt-6 inline-flex rounded-xl bg-[#1e90ff] px-5 py-3 text-sm font-bold text-white">
            Back to admin
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-[#fff7f8] text-[#171717]">
      <header className="border-b border-black/10 bg-white">
        <div className="mx-auto max-w-4xl px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="flex h-10 w-10 items-center justify-center rounded-xl border border-black/10 bg-white" aria-label="Back to admin">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-red-500/10 text-red-500">
              <AlertOctagon className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl font-bold">Reports</h1>
              <p className="text-sm text-black/45">Moderation queue — posts, comments, users, messages</p>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-5 sm:px-6">
        {/* filters */}
        <div className="flex flex-wrap items-center gap-2">
          {(['open', 'reviewing', 'resolved', 'dismissed', 'all'] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setPage(0); setExpandedId(null); }}
              className={`min-h-[38px] rounded-xl px-3.5 text-xs font-semibold capitalize transition ${
                statusFilter === s ? 'bg-black text-white' : 'border border-black/10 bg-white text-black/60 hover:bg-black/5'
              }`}
            >
              {s}
            </button>
          ))}
          <label className="ml-auto flex min-h-[38px] flex-1 items-center gap-2 rounded-xl border border-black/10 bg-white px-3 sm:max-w-xs">
            <Search className="h-4 w-4 shrink-0 text-black/35" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              placeholder="Search reason or details…"
              className="w-full bg-transparent text-sm outline-none"
              aria-label="Search reports"
            />
          </label>
        </div>

        {actionError && (
          <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs text-red-600" role="alert">{actionError}</p>
        )}

        {reports.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-dashed border-black/10 bg-white/60 px-6 py-14 text-center">
            <Flag className="mx-auto h-8 w-8 text-black/20" />
            <h2 className="mt-3 text-lg font-semibold">No {statusFilter === 'all' ? '' : statusFilter} reports</h2>
            <p className="mt-1 text-sm text-black/45">The queue is clear.</p>
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {reports.map((r) => (
              <li key={r.id} className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${STATUS_STYLES[r.status] || 'bg-gray-100'}`}>
                    {r.status}
                  </span>
                  <span className="rounded-full bg-black/5 px-2.5 py-1 text-[10px] font-bold uppercase">{r.target_type}</span>
                  <span className="rounded-full bg-black/5 px-2.5 py-1 text-[10px] font-semibold">{r.reason}</span>
                  <span className="ml-auto text-xs text-black/40">{timeAgo(r.created_at)}</span>
                </div>

                <p className="mt-2 text-sm">
                  Reported by <span className="font-semibold">{r.reporter?.full_text_name || r.reporter?.username || 'a user'}</span>
                  {r.details ? <> — “{r.details.slice(0, 160)}”</> : null}
                </p>
                {r.reviewed_at && (
                  <p className="mt-1 text-xs text-black/40">Last reviewed {timeAgo(r.reviewed_at)}{r.admin_note ? ` · note: ${r.admin_note.slice(0, 120)}` : ''}</p>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => void openDetail(r)}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-black/10 px-3 text-xs font-semibold hover:bg-black/5"
                  >
                    <Eye className="h-3.5 w-3.5" /> Inspect content
                  </button>
                  {r.status !== 'resolved' && (
                    <button
                      onClick={() => void setStatus(r, 'resolved')}
                      disabled={busyId === r.id}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-green-600 px-3 text-xs font-bold text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" /> Resolve
                    </button>
                  )}
                  {r.status !== 'dismissed' && (
                    <button
                      onClick={() => void setStatus(r, 'dismissed')}
                      disabled={busyId === r.id}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-black/10 px-3 text-xs font-semibold hover:bg-black/5 disabled:opacity-50"
                    >
                      Dismiss
                    </button>
                  )}
                </div>

                {expandedId === r.id && (
                  <div className="mt-3 rounded-xl border border-black/10 bg-[#faf7f8] p-3">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-black/40">Reported content</p>
                    {snapLoading ? (
                      <div className="flex items-center gap-2 py-3 text-xs text-black/45">
                        <Loader2 className="h-4 w-4 animate-spin" /> Loading content…
                      </div>
                    ) : (
                      <div className="rounded-lg bg-white p-3">{targetSummary(snapshot)}</div>
                    )}
                    <label className="mt-3 block space-y-1">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-black/40">Admin note (saved with the next action)</span>
                      <textarea
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        rows={2}
                        maxLength={1000}
                        className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-[#1e90ff]"
                      />
                    </label>
                    <p className="mt-1 text-[10px] text-black/35">Target id: {r.target_id}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {pageCount > 1 && (
          <div className="mt-5 flex items-center justify-center gap-3">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="inline-flex min-h-[38px] items-center rounded-xl border border-black/10 bg-white px-3 text-xs font-semibold disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" /> Prev
            </button>
            <span className="text-xs text-black/50">Page {page + 1} of {pageCount}</span>
            <button
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={page >= pageCount - 1}
              className="inline-flex min-h-[38px] items-center rounded-xl border border-black/10 bg-white px-3 text-xs font-semibold disabled:opacity-40"
            >
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
