'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Bookmark, BookmarkCheck, Crown, Film, Play, Search, Star } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useEntitlements } from '@/lib/entitlements';

/* ============================================================
   /studio/templates — the marketplace gallery.
   Approved templates only (enforced by RLS too). Search, category
   filters, premium gating (server-enforced via has_entitlement in
   RLS + client affordance), save/favorite, creator attribution.
   ============================================================ */

interface TemplateRow {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  aspect_ratio: string;
  duration_seconds: number;
  thumbnail_url: string | null;
  preview_url: string | null;
  premium: boolean;
  price_cents: number;
  currency: string;
  featured: boolean;
  views: number;
  uses: number;
  saves: number;
  rating_sum: number;
  rating_count: number;
  creator: { id: string; username: string; full_text_name: string; avatar_url: string; creator_verified: boolean };
}

const CATEGORIES = [
  'all', 'trending', 'popular', 'new', 'travel', 'birthday', 'wedding', 'memories',
  'love', 'friends', 'family', 'business', 'reels', 'cinematic', 'vlog',
  'gaming', 'music', 'minimal', 'journal', 'seasonal',
];

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [premiumOnly, setPremiumOnly] = useState<'all' | 'free' | 'premium'>('all');
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [meId, setMeId] = useState<string | null>(null);
  const ents = useEntitlements(meId);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        window.location.href = '/auth/sign-in';
        return;
      }
      setMeId(user.id);

      const { data, error: err } = await supabase
        .from('templates')
        .select(
          `id, title, description, category, tags, aspect_ratio, duration_seconds,
           thumbnail_url, preview_url, premium, price_cents, currency, featured,
           views, uses, saves, rating_sum, rating_count,
           creator:profiles!templates_creator_id_fkey(id, username, full_text_name, avatar_url, creator_verified)`
        )
        .eq('status', 'published')
        .order('featured', { ascending: false })
        .order('uses', { ascending: false })
        .limit(60);

      if (err) {
        setError(err.message);
      } else {
        setTemplates((data || []) as unknown as TemplateRow[]);
      }

      const { data: saved } = await supabase
        .from('saved_templates')
        .select('template_id')
        .eq('user_id', user.id);
      setSavedIds(new Set((saved || []).map((s: { template_id: string }) => s.template_id)));

      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    let list = templates;
    if (category !== 'all') list = list.filter((t) => t.category === category);
    if (premiumOnly !== 'all') list = list.filter((t) => (premiumOnly === 'premium' ? t.premium : !t.premium));
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          (t.tags || []).some((tag) => String(tag).toLowerCase().includes(q)) ||
          t.creator.username?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [templates, category, query, premiumOnly]);

  const toggleSave = async (id: string) => {
    if (!meId) return;
    const isSaved = savedIds.has(id);
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (isSaved) next.delete(id);
      else next.add(id);
      return next;
    });
    if (isSaved) {
      await supabase.from('saved_templates').delete().eq('template_id', id).eq('user_id', meId);
    } else {
      await supabase.from('saved_templates').insert({ template_id: id, user_id: meId });
      void supabase.from('template_events').insert({ template_id: id, event: 'save' });
    }
  };

  const [usingId, setUsingId] = useState<string | null>(null);
  const [useError, setUseError] = useState<string | null>(null);

  /* "Use" goes through the use_template RPC: the database copies the
     published template into a NEW video_projects row owned by the caller
     and returns its id — the original template can never be mutated and
     premium gating is enforced server-side, not by hiding the button. */
  const useTemplate = async (t: TemplateRow) => {
    if (usingId) return;
    setUsingId(t.id);
    setUseError(null);
    void supabase.from('template_events').insert({ template_id: t.id, event: 'open' });

    const { data, error } = await supabase.rpc('use_template', { p_template_id: t.id });
    if (error || !data) {
      setUsingId(null);
      setUseError(
        error?.message.includes('premium')
          ? 'This is a premium template — upgrade to Pro to use it.'
          : error?.message || 'Could not create a project from this template.'
      );
      return;
    }
    window.location.href = `/studio/video?project=${data}`;
  };

  const ratingOf = (t: TemplateRow) =>
    t.rating_count > 0 ? (t.rating_sum / t.rating_count).toFixed(1) : null;

  return (
    <main className="min-h-[100dvh] bg-[#FFF7F8] px-3 pb-24 pt-5 text-[#111111] sm:px-6 md:pb-10">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Templates</h1>
            <p className="text-sm text-[#6B6B6B]">Pick a template, add your media, export in seconds.</p>
          </div>
          <div className="flex gap-2">
            <Link href="/studio/video" className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-[#FFB6C1]">
              <Film className="mr-1 inline h-4 w-4" /> Blank project
            </Link>
            <Link href="/studio" className="rounded-xl border border-[#E8E2E4] bg-white px-4 py-2 text-sm font-semibold">
              Creator hub
            </Link>
          </div>
        </header>

        {/* search + filters */}
        <div className="space-y-2 rounded-2xl border border-[#E8E2E4] bg-white p-3 shadow-sm">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9C9497]" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search templates, tags, creators…"
              aria-label="Search templates"
              className="w-full rounded-xl border border-[#E8E2E4] py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#E5798F]"
            />
          </div>
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-1">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold capitalize ${
                  category === c ? 'bg-black text-[#FFB6C1]' : 'bg-[#F3EFF0] text-[#6B6B6B]'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            {(['all', 'free', 'premium'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPremiumOnly(p)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize ${
                  premiumOnly === p ? 'bg-[#E5798F] text-white' : 'bg-[#F3EFF0] text-[#6B6B6B]'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* grid */}
        {useError && (
          <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-600">{useError}</p>
        )}
        {loading ? (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="aspect-[9/14] animate-pulse rounded-2xl bg-[#EFE9EB]" />
            ))}
          </div>
        ) : error ? (
          <div className="mt-6 rounded-2xl border border-dashed border-[#E8E2E4] bg-white/60 px-6 py-14 text-center">
            <p className="text-sm font-semibold text-red-600">{error}</p>
            <p className="mt-1 text-xs text-[#6B6B6B]">Run migration 20260913000001 in Supabase to create the marketplace tables.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-[#E8E2E4] bg-white/60 px-6 py-14 text-center">
            <div className="text-4xl">🎬</div>
            <h2 className="mt-3 text-lg font-semibold">No templates found</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-[#6B6B6B]">
              Try a different category — or create the first one from any project in the editor.
            </p>
            <Link href="/studio/video" className="mt-5 inline-block rounded-xl bg-black px-5 py-2.5 text-sm font-semibold text-[#FFB6C1]">
              Open the editor
            </Link>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {filtered.map((t) => {
              const locked = t.premium && !ents.has('templates.premium') && !ents.has(`template.use:${t.id}`);
              const rating = ratingOf(t);
              return (
                <article key={t.id} className="group overflow-hidden rounded-2xl border border-[#E8E2E4] bg-white shadow-sm">
                  <div className="relative aspect-[9/14] bg-[#F3EFF0]">
                    {t.preview_url ? (
                      <video src={t.preview_url} muted loop playsInline preload="metadata" className="h-full w-full object-cover" />
                    ) : t.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.thumbnail_url} alt={t.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-4xl">🎞</div>
                    )}
                    {t.featured && (
                      <span className="absolute left-2 top-2 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-black">
                        ★ Featured
                      </span>
                    )}
                    <button
                      onClick={() => void toggleSave(t.id)}
                      aria-label={savedIds.has(t.id) ? 'Remove from saved' : 'Save template'}
                      className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur"
                    >
                      {savedIds.has(t.id) ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
                    </button>
                    <div className="absolute inset-x-2 bottom-2 flex items-center justify-between text-[10px] font-semibold text-white">
                      <span className="rounded-full bg-black/55 px-2 py-0.5 backdrop-blur">{t.uses} uses</span>
                      {rating && (
                        <span className="rounded-full bg-black/55 px-2 py-0.5 backdrop-blur">
                          <Star className="inline h-3 w-3 fill-current" /> {rating}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1.5 p-3">
                    <h3 className="truncate text-sm font-bold">{t.title}</h3>
                    <Link
                      href={t.creator.username ? `/u/${t.creator.username}` : '#'}
                      className="flex items-center gap-1.5 text-[11px] text-[#6B6B6B]"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={t.creator.avatar_url || '/default-avatar.png'} alt="" className="h-4 w-4 rounded-full" />
                      <span className="truncate">@{t.creator.username}</span>
                      {t.creator.creator_verified && <span title="Verified creator">✓</span>}
                    </Link>
                    <div className="flex items-center justify-between pt-0.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${t.premium ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {t.premium ? <Crown className="inline h-3 w-3" /> : null} {t.premium ? `$${(t.price_cents / 100).toFixed(2)}` : 'Free'}
                      </span>
                      {locked ? (
                        <span className="rounded-lg bg-[#F3EFF0] px-2.5 py-1.5 text-[10px] font-bold text-[#6B6B6B]">
                          Pro / purchase
                        </span>
                      ) : (
                        <button
                          onClick={() => void useTemplate(t)}
                          disabled={usingId !== null}
                          className="flex items-center gap-1 rounded-lg bg-black px-2.5 py-1.5 text-[10px] font-bold text-[#FFB6C1] disabled:opacity-50"
                        >
                          <Play className="h-3 w-3" /> {usingId === t.id ? 'Opening…' : 'Use'}
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
