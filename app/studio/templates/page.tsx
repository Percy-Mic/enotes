'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Bookmark, BookmarkCheck, ChevronDown, ChevronRight, Crown, Film, Play, Search, Sparkles, Star } from 'lucide-react';
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
  created_at: string;
  project?: Record<string, unknown>;
  creator: { id: string; username: string; full_text_name: string; avatar_url: string; creator_verified: boolean };
}

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;
  return `${minutes}:${String(remaining).padStart(2, '0')}`;
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
  const [mediaType, setMediaType] = useState<'video' | 'image'>('video');
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
           views, uses, saves, rating_sum, rating_count, created_at, project,
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

  const templateMediaType = (t: TemplateRow): 'video' | 'image' => {
    const raw = t.project;
    const clips = Array.isArray(raw?.clips) ? raw.clips : [];
    const elements = Array.isArray(raw?.elements) ? raw.elements : [];
    const kinds = [...clips, ...elements].map((item) => String((item as Record<string, unknown>)?.kind || '')).filter(Boolean);
    if (kinds.some((kind) => kind === 'video')) return 'video';
    if (kinds.length > 0 && kinds.every((kind) => ['image', 'photo', 'sticker'].includes(kind))) return 'image';
    return 'video';
  };

  const filtered = useMemo(() => {
    let list = templates.filter((t) => templateMediaType(t) === mediaType);
    if (category !== 'all' && !['trending', 'popular', 'new'].includes(category)) list = list.filter((t) => t.category === category);
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
    if (category === 'popular') list = [...list].sort((a, b) => b.uses - a.uses);
    else if (category === 'new') list = [...list].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    else if (category === 'trending') list = [...list].sort((a, b) => (Number(b.featured) - Number(a.featured)) || (b.uses - a.uses) || (b.views - a.views));
    return list;
  }, [templates, category, query, premiumOnly, mediaType]);

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
    <main className="min-h-[100dvh] bg-[#f8f9fb] text-[#111]">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[1500px]">
        {/* CapCut-style workspace rail */}
        <aside className="hidden w-[74px] shrink-0 border-r border-[#e8eaee] bg-white lg:flex lg:flex-col lg:items-center lg:gap-5 lg:py-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-black text-lg font-black text-white">e</div>
          <Link href="/studio" className="flex flex-col items-center gap-1 text-[10px] font-semibold text-[#666]"><Film className="h-5 w-5" />Create</Link>
          <Link href="/studio/templates" className="flex flex-col items-center gap-1 text-[10px] font-bold text-[#111]"><Sparkles className="h-5 w-5" />Templates</Link>
          <Link href="/studio/video" className="flex flex-col items-center gap-1 text-[10px] font-semibold text-[#666]"><Play className="h-5 w-5" />Editor</Link>
        </aside>

        <div className="min-w-0 flex-1 px-4 pb-16 pt-4 sm:px-6 lg:px-10">
          <header className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-black text-sm font-black text-white lg:hidden">e</div>
              <div>
                <h1 className="text-lg font-bold">Templates</h1>
                <p className="hidden text-xs text-[#8b8f97] sm:block">Trending edits made by the enotes community.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/studio/video?new=1" className="rounded-lg bg-black px-3 py-2 text-xs font-bold text-white">+ Create new</Link>
              <Link href="/studio" className="hidden rounded-lg border border-[#e2e4e8] bg-white px-3 py-2 text-xs font-semibold sm:block">Creator hub</Link>
            </div>
          </header>

          {/* Hero/search banner modeled on the reference's information hierarchy. */}
          <section className="mt-5 overflow-hidden rounded-2xl bg-gradient-to-r from-[#b9dcff] via-[#e6d8ff] to-[#ffd5e8] px-6 py-7 shadow-sm sm:px-9 sm:py-8">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-black/50">enotes templates</p>
              <h2 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">Make stunning videos with a template.</h2>
              <p className="mt-2 max-w-xl text-sm leading-5 text-black/60">Choose a ready-made edit, replace the media and sounds, and keep the creator's transitions, effects, text, timing and keyframes.</p>
              <div className="mt-5 flex max-w-2xl overflow-hidden rounded-xl bg-white shadow-sm">
                <label className="relative flex shrink-0 items-center gap-1 border-r border-[#ececf0] px-3 py-3 text-xs font-semibold">
                  <select value={mediaType} onChange={(e) => setMediaType(e.target.value as 'video' | 'image')} aria-label="Template media type" className="appearance-none bg-transparent pr-4 outline-none">
                    <option value="video">Video</option>
                    <option value="image">Photo</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5" />
                </label>
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9ca0a8]" />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search templates" aria-label="Search templates" className="h-full w-full bg-transparent py-3 pl-9 pr-3 text-sm outline-none" />
                </div>
              </div>
            </div>
          </section>

          <div className="mt-5 flex items-end justify-between border-b border-[#e5e7eb]">
            <div className="flex gap-6">
              <button type="button" onClick={() => setMediaType('video')} className={`border-b-2 pb-3 text-sm font-bold ${mediaType === 'video' ? 'border-[#12b8d6] text-[#111]' : 'border-transparent text-[#8b8f97]'}`}>Video</button>
              <button type="button" onClick={() => setMediaType('image')} className={`border-b-2 pb-3 text-sm font-semibold ${mediaType === 'image' ? 'border-[#12b8d6] text-[#111]' : 'border-transparent text-[#8b8f97]'}`}>Photo</button>
            </div>
            <div className="hidden pb-2 text-[10px] text-[#92969e] sm:block">Creator templates · {templates.length}</div>
          </div>

          {/* Reference-style category strip */}
          <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-2 [scrollbar-width:none]">
            {CATEGORIES.map((c) => (
              <button key={c} onClick={() => setCategory(c)} className={`shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold capitalize transition ${category === c ? 'bg-black text-white' : 'bg-white text-[#646871] hover:bg-[#eef0f3]'}`}>
                {c === 'all' ? 'For You' : c}
              </button>
            ))}
            <span className="ml-auto hidden shrink-0 rounded-full bg-white px-3 py-2 text-[10px] font-semibold text-[#777] sm:block">{filtered.length} results</span>
          </div>

          <div className="mt-1 flex gap-2">
            {(['all', 'free', 'premium'] as const).map((p) => (
              <button key={p} onClick={() => setPremiumOnly(p)} className={`rounded-lg px-3 py-1.5 text-[10px] font-bold capitalize ${premiumOnly === p ? 'bg-[#111] text-white' : 'bg-white text-[#777]'}`}>{p === 'all' ? 'All' : p}</button>
            ))}
          </div>

          {useError && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-600">{useError}</p>}
          {loading ? (
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              {[0,1,2,3,4,5,6,7,8,9].map((i) => <div key={i} className="aspect-[3/4] animate-pulse rounded-xl bg-[#e9ebef]" />)}
            </div>
          ) : error ? (
            <div className="mt-6 rounded-2xl border border-dashed border-[#dfe2e7] bg-white px-6 py-14 text-center"><p className="text-sm font-semibold text-red-600">{error}</p><p className="mt-1 text-xs text-[#6B6B6B]">Run the marketplace migration in Supabase.</p></div>
          ) : filtered.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-[#dfe2e7] bg-white px-6 py-14 text-center"><div className="text-4xl">🎬</div><h2 className="mt-3 text-lg font-semibold">No templates found</h2><p className="mx-auto mt-1 max-w-sm text-sm text-[#6B6B6B]">Try another category or create the first template from the editor.</p><Link href="/studio/video" className="mt-5 inline-flex items-center gap-2 rounded-xl bg-black px-5 py-2.5 text-sm font-semibold text-white">Open editor <ArrowRight className="h-4 w-4" /></Link></div>
          ) : (
            <div className="mt-5 grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 xl:grid-cols-5">
              {filtered.map((t) => {
                const locked = t.premium && !ents.has('templates.premium') && !ents.has(`template.use:${t.id}`);
                const rating = ratingOf(t);
                return (
                  <article key={t.id} className="group min-w-0">
                    <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-[#e9ebef]">
                      {t.preview_url ? (
                        <video src={t.preview_url} muted loop playsInline preload="metadata" onMouseEnter={(e) => { void e.currentTarget.play().catch(() => {}); }} onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]" />
                      ) : t.thumbnail_url ? (
                        <img src={t.thumbnail_url} alt={t.title} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]" />
                      ) : <div className="flex h-full items-center justify-center text-4xl">🎞</div>}
                      <button onClick={() => toggleSave(t.id)} aria-label={savedIds.has(t.id) ? 'Remove from saved' : 'Save template'} className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur">{savedIds.has(t.id) ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}</button>
                      {t.featured && <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-1 text-[9px] font-black text-black">★ Featured</span>}
                      <div className="absolute inset-x-2 bottom-2 flex items-center justify-between text-[9px] font-bold text-white"><span className="rounded-full bg-black/50 px-2 py-1">{t.duration_seconds ? fmt(t.duration_seconds) : ''}</span>{rating && <span className="rounded-full bg-black/50 px-2 py-1"><Star className="mr-0.5 inline h-3 w-3 fill-current" />{rating}</span>}</div>
                    </div>
                    <div className="pt-2">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="line-clamp-2 text-sm font-bold leading-5">{t.title}</h3>
                        <span className="shrink-0 text-[10px] text-[#92969e]">{t.uses} uses</span>
                      </div>
                      <Link href={t.creator.username ? `/u/${t.creator.username}` : '#'} className="mt-1 flex items-center gap-1.5 text-[10px] text-[#858991]">
                        <img src={t.creator.avatar_url || '/default-avatar.png'} alt="" className="h-4 w-4 rounded-full" />
                        <span className="truncate">@{t.creator.username}</span>
                      </Link>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className={`rounded-full px-2 py-1 text-[9px] font-bold ${t.premium ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{t.premium ? <Crown className="mr-0.5 inline h-3 w-3" /> : null}{t.premium ? `$${(t.price_cents / 100).toFixed(2)}` : 'Free'}</span>
                        {locked ? <span className="rounded-lg bg-[#eef0f3] px-2.5 py-1.5 text-[9px] font-bold text-[#777]">Pro / purchase</span> : <button onClick={() => void useTemplate(t)} disabled={usingId !== null} className="flex items-center gap-1 rounded-lg bg-black px-2.5 py-1.5 text-[9px] font-bold text-white disabled:opacity-50"><Play className="h-3 w-3" />{usingId === t.id ? 'Opening…' : 'Use'}</button>}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
