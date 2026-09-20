'use client';

import React, { useEffect, useState } from 'react';
import { Loader2, MessageSquare, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import type { Message } from '@/types/social';

interface ConversationOption {
  id: string;
  is_group: boolean;
  title: string | null;
  members: { user_id: string; profiles: { id: string; full_text_name: string; username: string; avatar_url: string | null } | null }[];
}

/**
 * Forward destination sheet: pick a conversation, resend the message there.
 * Full-width bottom sheet (mobile-first), max 60vh, tap-outside to close —
 * same interaction contract as the message-action sheet.
 */
export default function ForwardSheet({
  message,
  onClose,
}: {
  message: Message;
  onClose: (forwarded: boolean) => void;
}) {
  const [conversations, setConversations] = useState<ConversationOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [failedTo, setFailedTo] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !active) { setLoading(false); return; }
      const { data: memberships } = await supabase
        .from('conversation_members')
        .select('conversation_id, user_id, profiles!conversation_members_user_id_fkey(id, full_text_name, username, avatar_url)')
        .eq('user_id', user.id);
      const ids = (memberships || []).map((m: { conversation_id: string }) => m.conversation_id);
      if (!ids.length || !active) { setLoading(false); return; }
      const [{ data: convs }, { data: others }] = await Promise.all([
        supabase.from('conversations').select('id, is_group, title').in('id', ids),
        supabase
          .from('conversation_members')
          .select('conversation_id, user_id, profiles!conversation_members_user_id_fkey(id, full_text_name, username, avatar_url)')
          .in('conversation_id', ids)
          .neq('user_id', user.id),
      ]);
      if (!active) return;
      const othersBy = new Map<string, ConversationOption['members']>();
      for (const o of ((others || []) as unknown as { conversation_id: string; user_id: string; profiles: ConversationOption['members'][number]['profiles'] | ConversationOption['members'][number]['profiles'][] }[])) {
        /* PostgREST embeds many-to-one as an object (or null) — accept both
           shapes so the row never silently loses its profile. */
        const raw = o.profiles;
        const p = (Array.isArray(raw) ? raw[0] : raw) || null;
        othersBy.set(o.conversation_id, [...(othersBy.get(o.conversation_id) || []), { user_id: o.user_id, profiles: p }]);
      }
      const opts = ((convs || []) as ConversationOption[]).map((c) => ({ ...c, members: othersBy.get(c.id) || [] }));
      setConversations(opts);
      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  const label = (c: ConversationOption) =>
    c.title || (c.members[0]?.profiles?.full_text_name || c.members[0]?.profiles?.username || 'Conversation');

  const forward = async (c: ConversationOption) => {
    setSendingTo(c.id);
    setFailedTo(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setFailedTo(c.id); setSendingTo(null); return; }
    const { error } = await supabase.from('messages').insert({
      conversation_id: c.id,
      sender_id: user.id,
      content: message.content,
      message_type: message.message_type,
      media_url: message.media_url,
      media_type: message.media_type,
      media_name: message.media_name,
      reply_to_id: null,
    });
    if (error) {
      setFailedTo(c.id);
      setSendingTo(null);
    } else {
      onClose(true);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-label="Forward message">
      <button type="button" tabIndex={-1} aria-label="Cancel forward" className="absolute inset-0 cursor-default bg-black/40" onClick={() => onClose(false)} />
      <div className="relative z-10 max-h-[60vh] overflow-hidden rounded-t-3xl border-t border-black/5 bg-white shadow-2xl" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-black/15" />
        <div className="flex items-center justify-between px-5 pb-2 pt-3">
          <h2 className="text-sm font-bold">Forward to…</h2>
          <button type="button" onClick={() => onClose(false)} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-black/5" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[46vh] overflow-y-auto overscroll-contain px-2 pb-2">
          {loading ? (
            <p className="flex items-center justify-center gap-2 py-8 text-xs text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading chats…</p>
          ) : conversations.length === 0 ? (
            <p className="py-8 text-center text-xs text-gray-500">No other conversations yet.</p>
          ) : (
            <ul>
              {conversations.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={sendingTo !== null}
                    onClick={() => forward(c)}
                    className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-black/5 disabled:opacity-50"
                  >
                    {c.members[0]?.profiles?.avatar_url ? (
                      <img src={c.members[0].profiles.avatar_url} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/5">
                        <MessageSquare className="h-4 w-4 text-gray-500" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{label(c)}</span>
                      <span className="block truncate text-[11px] text-gray-500">{c.is_group ? 'Group chat' : 'Direct chat'}</span>
                    </span>
                    {sendingTo === c.id ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" aria-label="Forwarding" />
                    ) : failedTo === c.id ? (
                      <span className="shrink-0 text-[11px] font-bold text-red-600">Failed — retry</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
