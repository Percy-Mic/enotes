'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Camera as CameraIcon, Loader2, Trash2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

interface CommunityRow {
  id: string;
  slug: string;
  name: string;
  emoji: string;
  icon_url: string | null;
}

const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Platform-admin icon manager for communities: upload / replace / remove
 * each community's icon image. Admins override any community (enforced by
 * the communities_update_with_admin + avatars_community_icon_* policies).
 */
export default function CommunityIconManager({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<CommunityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingId = useRef<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    /* icon_url needs migration 2026-09-19 — retry without it so the manager
       still lists communities (uploading will surface a clear error) when
       the column is missing. */
    const withIcon = await supabase
      .from('communities')
      .select('id, slug, name, emoji, icon_url')
      .order('members_count', { ascending: false })
      .limit(50);
    if (withIcon.error && withIcon.error.message.includes('icon_url')) {
      const withoutIcon = await supabase
        .from('communities')
        .select('id, slug, name, emoji')
        .order('members_count', { ascending: false })
        .limit(50);
      setRows(
        ((withoutIcon.data || []) as Omit<CommunityRow, 'icon_url'>[]).map((r) => ({ ...r, icon_url: null }))
      );
      setLoading(false);
      return;
    }
    if (withIcon.error) setError(withIcon.error.message);
    else setRows((withIcon.data || []) as CommunityRow[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = async (row: CommunityRow, file: File | null, remove: boolean) => {
    setBusyId(row.id);
    setErrorId(null);
    setError(null);
    try {
      let iconUrl: string | null = row.icon_url;

      if (remove && iconUrl) {
        try {
          const marker = '/object/public/avatars/';
          const idx = iconUrl.indexOf(marker);
          if (idx >= 0) await supabase.storage.from('avatars').remove([decodeURIComponent(iconUrl.slice(idx + marker.length))]);
        } catch { /* non-fatal */ }
        iconUrl = null;
      }

      if (file) {
        const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
        const path = `community-${row.id}/${crypto.randomUUID()}.${ext}`;
        const { error: upError } = await supabase.storage
          .from('avatars')
          .upload(path, file, { upsert: false, contentType: file.type });
        if (upError) throw new Error(upError.message.includes('row-level') ? 'Storage denied the upload — check the icon policies.' : upError.message);
        const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
        iconUrl = pub.publicUrl;

        if (row.icon_url) {
          try {
            const marker = '/object/public/avatars/';
            const idx = row.icon_url.indexOf(marker);
            if (idx >= 0) {
              const oldPath = decodeURIComponent(row.icon_url.slice(idx + marker.length));
              if (oldPath.startsWith(`community-${row.id}/`)) await supabase.storage.from('avatars').remove([oldPath]);
            }
          } catch { /* non-fatal */ }
        }
      }

      const { error: updError } = await supabase.from('communities').update({ icon_url: iconUrl }).eq('id', row.id);
      if (updError) {
        throw new Error(
          updError.message.includes('column') || updError.message.includes('icon_url')
            ? 'Run migration 2026-09-19_community_icon_image first.'
            : updError.message
        );
      }

      setRows((list) => list.map((r) => (r.id === row.id ? { ...r, icon_url: iconUrl } : r)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not update the icon.';
      setErrorId(row.id);
      setError(msg);
    } finally {
      setBusyId(null);
    }
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    const id = pendingId.current;
    pendingId.current = null;
    if (!f || !id) return;
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    if (!TYPES.includes(f.type)) { setError('Icons must be JPEG, PNG, WebP or GIF.'); setErrorId(id); return; }
    if (f.size > MAX_BYTES) { setError('Icon is too large — 5 MB maximum.'); setErrorId(id); return; }
    void pick(row, f, false);
  };

  const visible = rows.filter((r) => !query.trim() || r.name.toLowerCase().includes(query.trim().toLowerCase()) || r.slug.includes(query.trim().toLowerCase()));

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[85dvh] w-full max-w-lg overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Community icons">
        <div className="flex items-center justify-between border-b border-black/5 px-5 py-4">
          <div>
            <h3 className="font-bold">Community icons</h3>
            <p className="text-xs text-black/50">Upload an image to replace the emoji badge.</p>
          </div>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-black/5" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 pt-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search communities…"
            className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-[#1e90ff]"
            aria-label="Search communities"
          />
        </div>

        {error && <p role="alert" className="mx-5 mt-3 rounded-lg bg-red-50 p-2.5 text-xs text-red-600">{error}</p>}

        <div className="max-h-[52vh] overflow-y-auto px-2 py-3">
          {loading ? (
            <p className="flex items-center justify-center gap-2 py-8 text-sm text-black/50"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
          ) : visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-black/50">No communities found.</p>
          ) : (
            <ul>
              {visible.map((r) => (
                <li key={r.id} className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 ${errorId === r.id ? 'bg-red-50' : ''}`}>
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#FFF7F8] text-2xl ring-1 ring-black/5">
                    {r.icon_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.icon_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      r.emoji
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{r.name}</span>
                    <span className="block truncate text-[11px] text-black/45">/c/{r.slug}{r.icon_url ? ' · image icon' : ' · emoji'}</span>
                  </span>
                  {busyId === r.id ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-black/40" aria-label="Working" />
                  ) : (
                    <span className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => { pendingId.current = r.id; inputRef.current?.click(); }}
                        className="flex items-center gap-1 rounded-lg border border-black/10 px-2.5 py-1.5 text-xs font-semibold hover:bg-black/5"
                        aria-label={`Change icon for ${r.name}`}
                      >
                        <CameraIcon className="h-3.5 w-3.5" /> {r.icon_url ? 'Replace' : 'Upload'}
                      </button>
                      {r.icon_url && (
                        <button
                          type="button"
                          onClick={() => void pick(r, null, true)}
                          className="flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                          aria-label={`Remove icon for ${r.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={onFile} className="hidden" aria-hidden="true" />
      </div>
    </div>
  );
}
