'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';

const EMOJIS = ['✨', '📚', '🎨', '📷', '🎵', '✈️', '🎮', '🍜', '💪', '📖', '🎬', '💻', '🌸', '☕', '🐾', '🌙'];
const TOPICS = ['general', 'writing', 'art', 'photography', 'music', 'travel', 'gaming', 'food', 'fitness', 'books', 'film', 'tech'];

export default function NewCommunityPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [topic, setTopic] = useState('general');
  const [emoji, setEmoji] = useState('✨');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const slugify = (s: string) =>
    s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

  const onName = (v: string) => {
    setName(v);
    setSlug(slugify(v));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const finalSlug = slugify(slug || name);
    if (!name.trim()) return setError('Give your community a name.');
    if (finalSlug.length < 3) return setError('The name is too short to make a link.');

    setBusy(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.replace('/auth/sign-in');
      return;
    }

    const { data, error: err } = await supabase
      .from('communities')
      .insert({
        name: name.trim(),
        slug: finalSlug,
        description: description.trim(),
        topic,
        emoji,
        created_by: user.id,
      })
      .select('id, slug')
      .single();

    if (err) {
      setError(err.code === '23505' ? 'That link is taken — tweak the name.' : err.message);
      setBusy(false);
      return;
    }

    // the creator is automatically the first member
    await supabase
      .from('community_members')
      .upsert({ community_id: data.id, user_id: user.id }, { onConflict: 'community_id,user_id' });

    router.push(`/communities/${data.slug}`);
  };

  return (
    <main className="min-h-[100dvh] bg-[#FFF7F8] px-3 pb-24 pt-5 text-[#111111] sm:px-6 md:pb-10">
      <div className="mx-auto w-full max-w-xl">
        <Link href="/communities" className="mb-4 inline-block text-sm font-semibold text-[#6B6B6B] hover:text-[#111111]">
          ← Communities
        </Link>

        <form onSubmit={submit} className="rounded-2xl border border-[#E8E2E4] bg-white p-5 shadow-sm">
          <h1 className="text-xl font-bold tracking-tight">Start a community</h1>
          <p className="mt-1 text-sm text-[#6B6B6B]">A home for people who share your interest.</p>

          <label className="mt-5 block">
            <span className="text-sm font-semibold">Name</span>
            <input
              value={name}
              onChange={(e) => onName(e.target.value)}
              placeholder="e.g. Morning Pages Club"
              maxLength={60}
              className="mt-1 w-full rounded-xl border border-[#E8E2E4] px-3.5 py-3 text-sm focus:border-[#E5798F] focus:outline-none"
            />
          </label>

          <label className="mt-3 block">
            <span className="text-sm font-semibold">Link</span>
            <span className="mt-1 flex items-center rounded-xl border border-[#E8E2E4] px-3.5 focus-within:border-[#E5798F]">
              <span className="text-sm text-[#9B9B9B]">/communities/</span>
              <input
                value={slug}
                onChange={(e) => setSlug(slugify(e.target.value))}
                placeholder="morning-pages"
                className="w-full bg-transparent py-3 text-sm outline-none"
              />
            </span>
          </label>

          <label className="mt-3 block">
            <span className="text-sm font-semibold">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this community about?"
              rows={3}
              maxLength={280}
              className="mt-1 w-full resize-none rounded-xl border border-[#E8E2E4] px-3.5 py-3 text-sm focus:border-[#E5798F] focus:outline-none"
            />
          </label>

          <p className="mt-4 text-sm font-semibold">Topic</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {TOPICS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTopic(t)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  topic === t ? 'bg-black text-[#FFB6C1]' : 'border border-[#E8E2E4] bg-white text-[#6B6B6B]'
                }`}
              >
                #{t}
              </button>
            ))}
          </div>

          <p className="mt-4 text-sm font-semibold">Icon</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {EMOJIS.map((em) => (
              <button
                key={em}
                type="button"
                onClick={() => setEmoji(em)}
                aria-pressed={emoji === em}
                className={`flex h-10 w-10 items-center justify-center rounded-xl text-xl transition ${
                  emoji === em ? 'bg-[#FFF7F8] ring-2 ring-[#E5798F]' : 'bg-white ring-1 ring-[#E8E2E4]'
                }`}
              >
                {em}
              </button>
            ))}
          </div>

          {error && <p className="mt-4 text-xs font-semibold text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="mt-6 w-full rounded-xl bg-black py-3 text-sm font-bold text-[#FFB6C1] disabled:opacity-40"
          >
            {busy ? 'Creating…' : 'Create community'}
          </button>
        </form>
      </div>
    </main>
  );
}
