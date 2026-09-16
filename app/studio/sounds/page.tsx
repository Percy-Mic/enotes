'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Heart, Lock, Play, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useEntitlements } from '@/lib/entitlements';

/* ============================================================
   /studio/sounds — the licensed sound library.
   Every row carries license metadata (license_type, rights_holder,
   commercial_use, attribution_required, restrictions) so the UI can
   show exactly what a sound may be used for. Premium rows are
   filtered by RLS (has_entitlement) — the client can't see them
   without the entitlement.
   ============================================================ */

interface SoundRow {
  id: string;
  title: string;
  artist: string;
  category: string;
  url: string;
  duration_seconds: number;
  license_type: string;
  rights_holder: string;
  commercial_use: boolean;
  attribution_required: boolean;
  restrictions: string | null;
  premium: boolean;
  plays: number;
}

const CATEGORIES = [
  'all', 'trending', 'cinematic', 'chill', 'emotional', 'happy', 'romantic',
  'electronic', 'ambient', 'acoustic', 'lofi', 'dramatic', 'corporate',
  'gaming', 'nature', 'sfx',
];

export default function SoundsPage() {
  const [sounds, setSounds] = useState<SoundRow[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [favOnly, setFavOnly] = useState(false);
  const [loading, setLoading] = useState(true);
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

      const [{ data }, { data: favs }] = await Promise.all([
        supabase.from('sounds').select('*').order('plays', { ascending: false }).limit(200),
        supabase.from('favorite_sounds').select('sound_id').eq('user_id', user.id),
      ]);
      setSounds((data || []) as SoundRow[]);
      setFavorites(new Set((favs || []).map((f: { sound_id: string }) => f.sound_id)));
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    let list = sounds;
    if (category !== 'all') list = list.filter((s) => s.category === category);
    if (favOnly) list = list.filter((s) => favorites.has(s.id));
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((s) => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q));
    return list;
  }, [sounds, category, query, favOnly, favorites]);

  const toggleFav = async (id: string) => {
    if (!meId) return;
    const isFav = favorites.has(id);
    setFavorites((prev) => {
      const next = new Set(prev);
      if (isFav) next.delete(id);
      else next.add(id);
      return next;
    });
    if (isFav) {
      await supabase.from('favorite_sounds').delete().eq('sound_id', id).eq('user_id', meId);
    } else {
      await supabase.from('favorite_sounds').insert({ sound_id: id, user_id: meId });
    }
  };

  return (
    <main className="min-h-[100dvh] bg-[#FFF7F8] px-3 pb-24 pt-5 text-[#111111] sm:px-6 md:pb-10">
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Sounds</h1>
            <p className="text-sm text-[#6B6B6B]">Licensed audio for your videos — rights shown on every track.</p>
          </div>
          <Link href="/studio/video" className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-[#FFB6C1]">
            Editor
          </Link>
        </header>

        <div className="space-y-2 rounded-2xl border border-[#E8E2E4] bg-white p-3 shadow-sm">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9C9497]" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sounds…"
              aria-label="Search sounds"
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
            <button
              onClick={() => setFavOnly((v) => !v)}
              className={`ml-auto shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${favOnly ? 'bg-[#E5798F] text-white' : 'bg-[#F3EFF0] text-[#6B6B6B]'}`}
            >
              ♥ Favorites
            </button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-2xl bg-[#EFE9EB]" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#E8E2E4] bg-white/60 px-6 py-14 text-center">
            <div className="text-4xl">🎵</div>
            <h2 className="mt-3 text-lg font-semibold">{favOnly ? 'No favorites yet' : 'No sounds yet'}</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-[#6B6B6B]">
              {favOnly
                ? 'Tap the heart on any sound to save it here.'
                : 'Admins add licensed tracks (see SETUP-CHECKLIST §8 for the seed SQL with license metadata).'}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((s) => (
              <li key={s.id} className="rounded-2xl border border-[#E8E2E4] bg-white p-3 shadow-sm">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F3EFF0]">
                    <Play className="h-4 w-4 text-[#6B6B6B]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {s.title} {s.premium && <Lock className="inline h-3 w-3 text-amber-500" />}
                    </p>
                    <p className="truncate text-[11px] text-[#6B6B6B]">
                      {s.artist} · {Math.round(s.duration_seconds)}s · {s.license_type}
                      {s.attribution_required && ' · attribution required'}
                    </p>
                  </div>
                  <button
                    onClick={() => void toggleFav(s.id)}
                    aria-label={favorites.has(s.id) ? 'Remove favorite' : 'Add favorite'}
                    className="flex h-9 w-9 items-center justify-center rounded-full"
                  >
                    <Heart className={`h-4 w-4 ${favorites.has(s.id) ? 'fill-[#E5798F] text-[#E5798F]' : 'text-[#9C9497]'}`} />
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <audio
                    src={s.url}
                    controls
                    preload="none"
                    className="h-9 flex-1"
                    onPlay={() => void supabase.rpc('record_sound_play', { p_sound: s.id })}
                  />
                  <Link
                    href={`/studio/video?sound=${s.id}`}
                    className="shrink-0 rounded-lg bg-black px-3 py-2 text-xs font-bold text-[#FFB6C1]"
                  >
                    Use
                  </Link>
                </div>
                {s.restrictions && (
                  <p className="mt-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700">
                    ⚠ {s.restrictions}
                    {!s.commercial_use && ' · personal/non-commercial use only'}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
