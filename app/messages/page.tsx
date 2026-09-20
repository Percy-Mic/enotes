'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BellOff, MessageCircle, Plus, Search, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import type { Conversation } from '@/types/social';
import Avatar from '@/components/social/Avatar';
import { usePresence } from '@/lib/hooks';

export default function MessagesPage() {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [meId, setMeId] = useState<string | null>(null);
  const { statusOf } = usePresence(meId);

  const loadConversations = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setMeId(user.id);

    /* one query per table, no per-conversation loops (performance) */
    const { data: memberships } = await supabase
      .from('conversation_members')
      .select('conversation_id, last_read_at, muted')
      .eq('user_id', user.id);

    const rows = memberships || [];
    const convIds = rows.map((m: any) => m.conversation_id);
    if (!convIds.length) {
      setConversations([]);
      setLoading(false);
      return;
    }

    const [{ data: convs }, { data: memberRows }, { data: lastMessages }] = await Promise.all([
      supabase.from('conversations').select('id, is_group, title, avatar_url, created_by, updated_at').in('id', convIds).order('updated_at', { ascending: false }),
      supabase
        .from('conversation_members')
        .select('conversation_id, user_id, profiles!conversation_members_user_id_fkey(id, full_text_name, username, avatar_url)')
        .in('conversation_id', convIds)
        .neq('user_id', user.id),
      supabase
        .from('messages')
        .select('conversation_id, content, sender_id, message_type, created_at')
        .in('conversation_id', convIds)
        .order('created_at', { ascending: false })
        .limit(500),
    ]);

    const lastReadMap = new Map(rows.map((m: any) => [m.conversation_id, m.last_read_at]));
    const mutedMap = new Map(rows.map((m: any) => [m.conversation_id, !!m.muted]));
    const membersByConv = new Map<string, { id: string; full_text_name?: string; username?: string; avatar_url?: string }[]>();
    (memberRows || []).forEach((row: any) => {
      const list = membersByConv.get(row.conversation_id) || [];
      if (row.profiles) list.push(row.profiles);
      membersByConv.set(row.conversation_id, list);
    });

    const lastByConv = new Map<string, { content: string; created_at: string; sender_id: string; message_type: string | null }>();
    const unreadByConv = new Map<string, number>();
    for (const msg of (lastMessages || []) as { conversation_id: string; content: string; created_at: string; sender_id: string; message_type: string | null }[]) {
      if (!lastByConv.has(msg.conversation_id)) lastByConv.set(msg.conversation_id, msg);
      const lastRead = lastReadMap.get(msg.conversation_id) || '1970-01-01T00:00:00Z';
      if (new Date(msg.created_at) > new Date(lastRead)) {
        unreadByConv.set(msg.conversation_id, (unreadByConv.get(msg.conversation_id) || 0) + 1);
      }
    }

    const list = ((convs || []) as Conversation[]).map((conv) => {
      const last = lastByConv.get(conv.id);
      const members = membersByConv.get(conv.id) || [];
      /* chat-list prefix: "you: " for my own last message, "[username]: "
         everyone else's (1:1 included — explicit attribution on both sides,
         per the requested "you: " / "[username]: " format). Media-only
         messages fall back to a readable noun instead of a blank line. */
      let lastMessage: string | null = null;
      if (last) {
        const isVoice = last.message_type === 'audio';
        const body = isVoice ? 'Voice message' : last.content;
        if (last.sender_id === user.id) {
          lastMessage = `you: ${body}`;
        } else if (conv.is_group) {
          const sender = members.find((m) => m.id === last.sender_id);
          const name = sender?.username || sender?.full_text_name || 'someone';
          lastMessage = `[${name}]: ${body}`;
        } else {
          const chatmate = members.find((m) => m.id !== user.id);
          const name = chatmate?.username || chatmate?.full_text_name || 'someone';
          lastMessage = `[${name}]: ${body}`;
        }
      }
      return {
      ...conv,
      members,
      last_message: lastMessage,
      last_message_at: last?.created_at || null,
      unread_count: unreadByConv.get(conv.id) || 0,
      muted: mutedMap.get(conv.id) || false,
      };
    });

    setConversations(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) {
        router.replace('/auth/sign-in');
        return;
      }
      await loadConversations();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  /* realtime: refresh on any new message in any of my conversations */
  useEffect(() => {
    const channel = supabase
      .channel('messages-inbox')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        loadConversations();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadConversations]);

  const filtered = conversations.filter((conv) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    const title = conv.is_group ? conv.title || '' : conv.members?.[0]?.full_text_name || conv.members?.[0]?.username || '';
    return title.toLowerCase().includes(q) || (conv.last_message || '').toLowerCase().includes(q);
  });

  const titleOf = (conv: Conversation) => {
    if (conv.is_group) return conv.title || 'Group chat';
    const other = conv.members?.[0];
    return other?.full_text_name || other?.username || 'Conversation';
  };

  return (
    <main className="min-h-[100dvh] bg-[#FFF7F8] px-3 pb-24 pt-5 text-[#111111] sm:px-6 md:pb-10">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Chats</h1>
            <p className="text-sm text-[#6B6B6B]">Direct messages and communities.</p>
          </div>
          <Link
            href="/messages/new"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-[#FFB6C1] shadow transition hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> New
          </Link>
        </header>

        {/* search */}
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-[#9B9B9B]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations…"
            className="w-full rounded-2xl border border-[#E8E2E4] bg-white py-3 pl-11 pr-4 text-base shadow-sm focus:border-[#1E90FF] focus:outline-none"
            aria-label="Search conversations"
          />
        </div>

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-2xl bg-white/70" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#E8E2E4] bg-white/60 px-6 py-14 text-center">
            <MessageCircle className="mx-auto h-8 w-8 text-[#E8E2E4]" />
            <h2 className="mt-3 text-lg font-semibold">{query ? 'No matching chats' : 'No conversations yet'}</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-[#6B6B6B]">
              {query ? 'Try a different search.' : 'Open someone’s profile and tap Message, or start a group chat.'}
            </p>
            {!query && (
              <Link href="/search" className="mt-5 inline-block rounded-xl bg-black px-5 py-2.5 text-sm font-semibold text-[#FFB6C1]">
                Find people
              </Link>
            )}
          </div>
        ) : (
          <ul className="space-y-2.5">
            {filtered.map((conv) => {
              const other = conv.members?.[0];
              const online = !conv.is_group && other && statusOf(other.id) === 'online';
              return (
                <li key={conv.id}>
                  <Link
                    href={`/messages/${conv.id}`}
                    className="flex items-center gap-3 rounded-2xl border border-[#E8E2E4] bg-white p-3.5 shadow-sm transition hover:shadow"
                  >
                    <span className="relative shrink-0">
                      {conv.is_group ? (
                        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#EDE4FF] to-[#D8C7FA] text-[#6D4AC2]">
                          <Users className="h-6 w-6" />
                        </span>
                      ) : (
                        <Avatar src={other?.avatar_url} name={titleOf(conv)} size={48} />
                      )}
                      {online && (
                        <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-500" aria-label="Online" />
                      )}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                          {titleOf(conv)}
                          {conv.muted && <BellOff className="h-3 w-3 text-[#9B9B9B]" />}
                        </p>
                        {conv.last_message_at && (
                          <span className="shrink-0 text-[10px] text-[#9B9B9B]">
                            {new Date(conv.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-[#6B6B6B]">
                        {conv.last_message || (conv.is_group ? 'No messages yet' : 'Say hello ♡')}
                      </p>
                    </div>

                    {(conv.unread_count || 0) > 0 && (
                      <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-[#E5798F] px-1.5 text-[11px] font-bold text-white">
                        {conv.unread_count! > 9 ? '9+' : conv.unread_count}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

    </main>
  );
}
