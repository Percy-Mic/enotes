'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertOctagon,
  ArrowRight,
  LayoutTemplate,
  Loader2,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

export default function AdminPage() {
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [openReports, setOpenReports] = useState(0);

  useEffect(() => {
    async function load() {
      try {
        const {
          data: {
            user,
          },
        } = await supabase.auth.getUser();

        if (!user) {
          setAuthorized(false);
          return;
        }

        const {
          data: isAdmin,
          error: adminError,
        } = await supabase.rpc('is_current_user_admin');

        if (adminError || !isAdmin) {
          setAuthorized(false);
          return;
        }

        setAuthorized(true);

        const {
          count,
          error,
        } = await supabase
          .from('templates')
          .select('*', {
            count: 'exact',
            head: true,
          })
          .eq('status', 'pending');

        if (!error) {
          setPendingCount(count || 0);
        }

        const {
          count: openReports,
          error: reportsError,
        } = await supabase
          .from('reports')
          .select('*', {
            count: 'exact',
            head: true,
          })
          .in('status', ['open', 'reviewing']);

        if (!reportsError) {
          setOpenReports(openReports || 0);
        }
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  if (loading) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-[#fff7f8]">
        <div className="flex items-center gap-2 text-sm text-black/50">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading admin...
        </div>
      </main>
    );
  }

  if (!authorized) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-[#fff7f8] px-5">
        <div className="w-full max-w-md rounded-3xl border border-black/10 bg-white p-8 text-center shadow-sm">
          <XCircle className="mx-auto h-10 w-10 text-red-500" />

          <h1 className="mt-4 text-xl font-bold">
            Access denied
          </h1>

          <p className="mt-2 text-sm leading-6 text-black/50">
            Your account does not have administrator
            privileges.
          </p>

          <Link
            href="/"
            className="mt-6 inline-flex rounded-xl bg-[#1e90ff] px-5 py-3 text-sm font-bold text-white"
          >
            Return home
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-[#fff7f8] text-[#171717]">
      <header className="border-b border-black/10 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-5 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#1e90ff]/10 text-[#1e90ff]">
              <ShieldCheck className="h-6 w-6" />
            </div>

            <div>
              <h1 className="text-xl font-bold">
                enotes Admin
              </h1>

              <p className="text-sm text-black/45">
                Platform administration
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-6">
        <h2 className="text-2xl font-bold">
          Administration
        </h2>

        <p className="mt-2 max-w-2xl text-sm leading-6 text-black/50">
          Manage creator content and platform moderation
          from one place.
        </p>

        <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Link
            href="/admin/templates"
            className="group rounded-3xl border border-black/10 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="flex items-start justify-between">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#1e90ff]/10 text-[#1e90ff]">
                <LayoutTemplate className="h-6 w-6" />
              </div>

              {pendingCount > 0 && (
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">
                  {pendingCount} pending
                </span>
              )}
            </div>

            <h3 className="mt-5 text-lg font-bold">
              Template moderation
            </h3>

            <p className="mt-2 text-sm leading-6 text-black/50">
              Review creator templates, approve or reject
              submissions, feature published templates and
              archive content.
            </p>

            <div className="mt-5 flex items-center gap-2 text-sm font-bold text-[#1e90ff]">
              Open moderation
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
            </div>
          </Link>

          <Link
            href="/admin/reports"
            className="group rounded-3xl border border-black/10 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="flex items-start justify-between">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10 text-red-500">
                <AlertOctagon className="h-6 w-6" />
              </div>

              {openReports > 0 && (
                <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700">
                  {openReports} active
                </span>
              )}
            </div>

            <h3 className="mt-5 text-lg font-bold">
              Reports
            </h3>

            <p className="mt-2 text-sm leading-6 text-black/50">
              Review reported posts, comments, users and messages.
              Inspect content, resolve or dismiss with an audit trail.
            </p>

            <div className="mt-5 flex items-center gap-2 text-sm font-bold text-red-500">
              Open reports
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
            </div>
          </Link>
        </div>
      </div>
    </main>
  );
}