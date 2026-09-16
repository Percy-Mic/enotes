'use client';

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

/**
 * ShareToCommunityModal — pick one of YOUR existing posts (feed posts,
 * video exports, anything you authored) and pin it into a community.
 * The insert is validated by RLS: only members can share.
 */
export default function ShareToCommunityModal({
  communityId,
  communityName,
  myId,
  onClose,
  onShared,
}: {
  communityId: string;
  communityName: string;
  myId: string | null;
  onClose: () => void;
  onShared: () => void;
}) {
  const [posts, setPosts] = useState<{ id: string; content: string; media_type: string; created_at: string }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (!myId) return;
      const { data, error: err } = await supabase
        .from('posts')
        .select('id, content, media_type, created_at')
        .eq('author_id', myId)
        .is('deleted_at', null)
        /* Sharing exposes a post to every community member, so private and
           followers-only posts must never be offerable here. */
        .in('visibility', ['public', 'link'])
        .order('created_at', { ascending: false })
        .limit(25);
      if (err) setError(err.message);
      setPosts(data || []);
      setLoading(false);
    })();
  }, [myId]);

  const share = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase
      .from('community_posts')
      .insert({ community_id: communityId, post_id: selected, posted_by: myId });
    setBusy(false);
    if (err) {
      setError(err.message.includes('row-level security')
        ? 'Join the community first, then share.'
        : err.message);
      return;
    }
    onShared();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={`Share a post to ${communityName}`}>
      <div className="w-full max-w-lg rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <header className="flex items-center justify-between border-b border-[#F0EAEC] px-5 py-4">
          <h2 className="text-sm font-bold">Share a post to {communityName}</h2>
          <button onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-[#FFF7F8]">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="max-h-[50dvh] overflow-y-auto p-4">
          {loading ? (
            <p className="py-8 text-center text-sm text-[#6B6B6B]">Loading your posts…</p>
          ) : posts.length === 0 ? (
            <p className="py-8 text-center text-sm text-[#6B6B6B]">
              Nothing shareable yet — only public posts can be shared to communities.
            </p>
          ) : (
            <ul className="space-y-2">
              {posts.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => setSelected(p.id)}
                    className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${
                      selected === p.id ? 'border-[#E5798F] bg-[#FFF7F8]' : 'border-[#E8E2E4] hover:bg-[#FFF7F8]/60'
                    }`}
                    aria-pressed={selected === p.id}
                  >
                    <span className="rounded-lg bg-[#FFF7F8] px-2 py-1 text-[10px] font-bold uppercase text-[#E5798F]">
                      {p.media_type}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">{p.content || '(media post)'}</span>
                    <span className="text-[10px] text-[#9B9B9B]">{new Date(p.created_at).toLocaleDateString()}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && <p className="px-5 pb-2 text-xs font-semibold text-red-600">{error}</p>}

        <footer className="border-t border-[#F0EAEC] p-4">
          <button
            onClick={share}
            disabled={!selected || busy}
            className="w-full rounded-xl bg-black py-3 text-sm font-bold text-[#FFB6C1] disabled:opacity-40"
          >
            {busy ? 'Sharing…' : 'Share to community'}
          </button>
        </footer>
      </div>
    </div>
  );
}
