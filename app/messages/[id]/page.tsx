'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, Ban, BellOff, BellRing, Camera, Check, Crown, Flag, Images, Loader2, LogOut,
  MoreVertical, Palette, Pencil, Phone, PhoneCall, Shield, Trash2, UserMinus, Users, Video, X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import type { ChatThemeRow, Conversation, Message, Profile } from '@/types/social';
import { CHAT_THEMES, type ChatTheme } from '@/lib/assets';
import Avatar from '@/components/social/Avatar';
import ChatComposer, { type ComposerPayload } from '@/components/chat/ChatComposer';
import MessageRow from '@/components/chat/MessageRow';
import ChatThemePicker from '@/components/chat/ChatThemePicker';
import MediaGallery from '@/components/chat/MediaGallery';
import ForwardSheet from '@/components/chat/ForwardSheet';
import ReportDialog from '@/components/social/ReportDialog';
import { useCall } from '@/components/chat/CallProvider';
import { useGroupCall } from '@/components/chat/GroupCallProvider';

const PAGE_SIZE = 30;
const ICON_MAX_BYTES = 5 * 1024 * 1024;
const ICON_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const DEFAULT_THEME: ChatTheme = {
  id: 'default',
  name: 'Default',
  background: '#FFF7F8',
  bubbleMine: '#2A211D',
  bubbleTheirs: '#FFFFFF',
  textMine: '#FFF7F8',
  textTheirs: '#111111',
  accent: '#E5798F',
  bubbleStyle: 'rounded',
};

function themeFromRow(row: ChatThemeRow | null): ChatTheme {
  if (!row) return DEFAULT_THEME;
  const preset = CHAT_THEMES.find((t) => t.accent === row.accent_color && t.bubbleMine === row.bubble_color_mine);
  if (preset && !row.background_color) return preset;
  return {
    id: 'custom',
    name: 'Custom',
    background: row.background_color || DEFAULT_THEME.background,
    bubbleMine: row.bubble_color_mine || DEFAULT_THEME.bubbleMine,
    bubbleTheirs: row.bubble_color_theirs || DEFAULT_THEME.bubbleTheirs,
    textMine: row.text_color_mine || DEFAULT_THEME.textMine,
    textTheirs: row.text_color_theirs || DEFAULT_THEME.textTheirs,
    accent: row.accent_color || DEFAULT_THEME.accent,
    bubbleStyle: (row.bubble_style as ChatTheme['bubbleStyle']) || 'rounded',
    fontFamily: row.font_family || undefined,
  };
}

interface MemberRow {
  user_id: string;
  role: string;
  profile: Pick<Profile, 'id' | 'full_text_name' | 'username' | 'avatar_url'> | null;
}

export default function ChatPage() {
  return (
    <Suspense fallback={<main className="flex h-[100dvh] items-center justify-center bg-[#FFF7F8] text-[#9B9B9B]">Loading chat…</main>}>
      <ChatRoom />
    </Suspense>
  );
}

function ChatRoom() {
  const params = useParams();
  const router = useRouter();
  const search = useSearchParams();
  const conversationId = params?.id as string;

  const { startCall } = useCall();
  const { startGroupCall } = useGroupCall();

  const [me, setMe] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showGroupCall, setShowGroupCall] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [showMedia, setShowMedia] = useState(false);
  const [forwarding, setForwarding] = useState<Message | null>(null);
  const [forwardedNotice, setForwardedNotice] = useState<string | null>(null);

  /* the header menu floats over the chat — any tap outside closes it */
  useEffect(() => {
    if (!showMenu) return;
    const close = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [showMenu]);
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [themeRow, setThemeRow] = useState<ChatThemeRow | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [blockedByMe, setBlockedByMe] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ type: 'user' | 'message'; id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* one-shot handoff notice from /messages/new (e.g. "group created but the
     icon upload failed") — read once from the query string, then stripped
     from the URL so refresh/back doesn't replay it */
  const [handoffNotice, setHandoffNotice] = useState<string | null>(null);
  useEffect(() => {
    const notice = search.get('iconNotice');
    if (notice) {
      setHandoffNotice(notice);
      /* strip it from the URL (read-only store → rebuild the query string)
         so refresh/back can't replay the banner */
      const rest = new URLSearchParams(search.toString());
      rest.delete('iconNotice');
      const qs = rest.toString();
      router.replace(`/messages/${conversationId}${qs ? `?${qs}` : ''}`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* group management state (creator / group admins only — see myRole) */
  const [showGroupEdit, setShowGroupEdit] = useState(false);
  const [groupMembers, setGroupMembers] = useState<MemberRow[]>([]);
  const [myRole, setMyRole] = useState<string>('member');
  const [editTitle, setEditTitle] = useState('');
  const [savingGroup, setSavingGroup] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [groupNotice, setGroupNotice] = useState<string | null>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const typingChannel = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastTypingSent = useRef(0);

  const theme = useMemo(() => themeFromRow(themeRow), [themeRow]);
  const otherMember = useMemo(() => conversation?.members?.[0] || null, [conversation]);
  const title = conversation
    ? conversation.is_group
      ? conversation.title || 'Group chat'
      : otherMember?.full_text_name || otherMember?.username || 'Conversation'
    : '…';

  /* creator + admins may rename / change icon / manage roles (DB enforces too) */
  const amGroupAdmin = conversation?.is_group === true && (conversation.created_by === me || myRole === 'admin' || myRole === 'moderator');

  /* ---------- initial load ---------- */

  const loadMembers = useCallback(async () => {
    const { data: rows } = await supabase
      .from('conversation_members')
      .select('user_id, role, profiles!conversation_members_user_id_fkey(id, full_text_name, username, avatar_url)')
      .eq('conversation_id', conversationId);

    const mapped: MemberRow[] = (rows || []).map((r: any) => ({
      user_id: r.user_id,
      role: r.role || 'member',
      profile: r.profiles || null,
    }));
    /* creator first, then admins, then join order */
    mapped.sort((a, b) => {
      const rank = (m: MemberRow) => (m.user_id === conversation?.created_by ? 0 : m.role === 'admin' || m.role === 'moderator' ? 1 : 2);
      return rank(a) - rank(b);
    });
    setGroupMembers(mapped);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const mine = mapped.find((m) => m.user_id === user.id);
      setMyRole(mine?.user_id === conversation?.created_by ? 'creator' : mine?.role || 'member');
    }
  }, [conversationId, conversation?.created_by]);

  useEffect(() => {
    if (conversation?.is_group) void loadMembers();
  }, [conversation?.is_group, loadMembers]);

  useEffect(() => {
    let active = true;

    (async () => {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        router.replace('/auth/sign-in');
        return;
      }
      if (active) setMe(user.id);

      const { data: membership } = await supabase
        .from('conversation_members')
        .select('conversation_id, role')
        .eq('conversation_id', conversationId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (!membership) {
        router.replace('/messages');
        return;
      }
      if (active) setMyRole((membership as any).role || 'member');

      const [{ data: conv }, { data: memberRows }, { data: theme }, { data: mySettings }] = await Promise.all([
        supabase.from('conversations').select('id, is_group, title, avatar_url, created_by, updated_at').eq('id', conversationId).maybeSingle(),
        supabase
          .from('conversation_members')
          .select('user_id, role, profiles!conversation_members_user_id_fkey(id, full_text_name, username, avatar_url)')
          .eq('conversation_id', conversationId)
          .neq('user_id', user.id),
        supabase.from('chat_themes').select('*').eq('conversation_id', conversationId).maybeSingle(),
        supabase.from('user_settings').select('read_receipts_enabled').eq('user_id', user.id).maybeSingle(),
      ]);

      if (!active) return;

      const members = (memberRows || []).map((row: any) => ({
        ...(row.profiles || {}),
        role: row.role || 'member',
      }));
      setConversation({ ...(conv as any), members });
      setThemeRow((theme as ChatThemeRow) || null);
      setReadReceipts((mySettings as any)?.read_receipts_enabled !== false);
      if ((conv as any)?.is_group) {
        setEditTitle((conv as any).title || '');
        void loadMembers();
      }

      /* block state for DMs */
      if (!(conv as any)?.is_group && members[0]) {
        const { data: blockRow } = await supabase
          .from('user_blocks')
          .select('blocker_id')
          .eq('blocker_id', user.id)
          .eq('blocked_id', members[0].id)
          .maybeSingle();
        setBlockedByMe(!!blockRow);
      }

      /* newest page of messages — excluding the ones this user chose to
         "delete for me" (their own hidden_messages rows, RLS-scoped) */
      const [{ data: msgs }, { data: hidden }] = await Promise.all([
        supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: false })
          .limit(PAGE_SIZE),
        supabase.from('hidden_messages').select('message_id'),
      ]);
      const hiddenIds = new Set((hidden || []).map((h: { message_id: string }) => h.message_id));

      const ordered = ((msgs || []) as Message[]).filter((m) => !hiddenIds.has(m.id)).slice().reverse();
      setMessages(ordered);
      setHasOlder(((msgs || []) as Message[]).length === PAGE_SIZE);
      setLoading(false);

      markRead();
    })();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, router]);

  /* Reconcile reaction ownership once auth resolves: the initial hydration
     runs before `me` is known, so every `mine` flag starts false and tapping
     your own chip would re-insert instead of removing it. */
  useEffect(() => {
    if (!me) return;
    void syncReactions(messages.map((m) => m.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  /* load sender profiles + reply targets for the first page */
  useEffect(() => {
    if (!messages.length) return;
    const senderIds = Array.from(new Set(messages.filter((m) => !m.sender).map((m) => m.sender_id)));
    const replyIds = messages.filter((m) => m.reply_to_id && !m.reply_to).map((m) => m.reply_to_id!) as string[];

    (async () => {
      if (senderIds.length) {
        const { data: senders } = await supabase.from('profiles').select('id, full_text_name, username, avatar_url').in('id', senderIds);
        const map = new Map(((senders || []) as Profile[]).map((p) => [p.id, p]));
        setMessages((list) => list.map((m) => ({ ...m, sender: m.sender || map.get(m.sender_id) })));
      }
      if (replyIds.length) {
        const { data: targets } = await supabase.from('messages').select('*').in('id', replyIds);
        const map = new Map(((targets || []) as Message[]).map((m) => [m.id, m]));
        setMessages((list) => list.map((m) => ({ ...m, reply_to: m.reply_to || map.get(m.reply_to_id!) || null })));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  const [readReceipts, setReadReceipts] = useState(true);

  const markRead = useCallback(async () => {
    if (!me) return;
    await supabase
      .from('conversation_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', me);

    /* Read receipts via the definer RPC: participants (not senders) mark
       peers' messages read. The old direct UPDATE could never pass the
       sender-scoped RLS policy — receipts were silently dead. The RPC
       itself enforces membership + non-own rows, so nothing is weakened. */
    await supabase.rpc('mark_conversation_read', { p_conversation: conversationId });
  }, [me, conversationId]);

  /* mark read when tab refocuses or messages change */
  useEffect(() => {
    if (!loading) markRead();
  }, [messages.length, loading, markRead]);

  /* ---------- realtime (channels removed on unmount/conv change) ---------- */

  useEffect(() => {
    if (!conversationId || !me) return;

    const channel = supabase
      .channel(`chat-${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const row = payload.new as Message;
          setMessages((list) => {
            /* reconcile optimistic/local duplicates */
            const withoutLocal = list.filter((m) => !(m.local && m.content === row.content && m.sender_id === row.sender_id));
            if (withoutLocal.some((m) => m.id === row.id)) return withoutLocal;
            return [...withoutLocal, { ...row, sender: row.sender_id === me ? undefined : row.sender }];
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const row = payload.new as Message;
          setMessages((list) => list.map((m) => (m.id === row.id ? { ...m, ...row } : m)));
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const old = payload.old as Message;
          setMessages((list) => list.map((m) => (m.id === old.id ? { ...m, deleted_at: new Date().toISOString() } : m)));
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_themes', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          /* shared theme changed — restyle this member's chat live */
          setThemeRow(('new' in payload && payload.new ? (payload.new as ChatThemeRow) : null));
        }
      )
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload.from === me) return;
        setTypingUsers((prev) => {
          const next = prev.filter((id) => id !== payload.from);
          if (payload.typing) next.push(payload.from);
          return next;
        });
        /* auto-clear typing after 4s */
        setTimeout(() => {
          setTypingUsers((prev) => prev.filter((id) => id !== payload.from));
        }, 4000);
      })
      .subscribe();

    typingChannel.current = channel;

    return () => {
      supabase.removeChannel(channel);
      typingChannel.current = null;
    };
  }, [conversationId, me]);

  /* message reactions realtime — single stable channel keyed by conversation,
     reading the current ids from a ref so it does not resubscribe every render */
  const messageIdsRef = useRef<string[]>([]);
  useEffect(() => {
    messageIdsRef.current = messages.map((m) => m.id);
  }, [messages]);

  /* Single owner of reaction→message reconciliation: fetch DB truth for a set
     of message ids and merge it into state. Shared by the initial load and
     pagination (which otherwise render no chips after a refresh) and by the
     realtime channel. Only messages in `ids` are touched — updating AND
     clearing, so removed last-reactions disappear instead of going stale. */
  const syncReactions = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      const { data } = await supabase.from('message_reactions').select('message_id, emoji, user_id').in('message_id', ids);
      const idSet = new Set(ids);
      const byMessage = new Map<string, NonNullable<Message['reactions']>>();
      for (const row of (data || []) as { message_id: string; emoji: string; user_id: string }[]) {
        const list = byMessage.get(row.message_id) || [];
        const existing = list.find((r) => r.emoji === row.emoji);
        if (existing) {
          existing.users.push(row.user_id);
          existing.count += 1;
        } else {
          list.push({ emoji: row.emoji, users: [row.user_id], count: 1, mine: row.user_id === me });
        }
        byMessage.set(row.message_id, list);
      }
      setMessages((list) =>
        list.map((m) => {
          if (!idSet.has(m.id)) return m;
          const next = byMessage.get(m.id);
          if (next) return m.reactions === next ? m : { ...m, reactions: next };
          return m.reactions ? { ...m, reactions: undefined } : m;
        })
      );
    },
    [me]
  );

  /* Hydrate + reconcile reactions whenever the loaded set or identity changes:
     fires after the first page lands (count 0→N), after each older page, and
     once auth resolves — so `mine` is always computed with the real user even
     when auth resolves mid-fetch. Realtime events bypass this and sync
     directly. */
  useEffect(() => {
    void syncReactions(messageIdsRef.current);
  }, [messages.length, me, syncReactions]);

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`msg-reactions-${conversationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, async () => {
        await syncReactions(messageIdsRef.current);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, me]);

  /* ---------- send / actions ---------- */

  const sendTyping = (typing: boolean) => {
    const now = Date.now();
    if (typing && now - lastTypingSent.current < 2000) return;
    if (typing) lastTypingSent.current = now;
    typingChannel.current?.send({ type: 'broadcast', event: 'typing', payload: { from: me, typing } });
  };

  const handleSend = useCallback(
    async (payload: ComposerPayload): Promise<void> => {
      if (!me) {
        setError('You are signed out — reload the page to continue.');
        return;
      }
      setError(null);

      /* optimistic message */
      const localId = `local-${Date.now()}`;
      setMessages((list) => [
        ...list,
        {
          id: localId,
          conversation_id: conversationId,
          sender_id: me,
          content: payload.content,
          message_type: payload.message_type,
          media_url: payload.media_url,
          media_type: payload.media_type,
          media_name: payload.media_name,
          reply_to_id: payload.reply_to_id,
          created_at: new Date().toISOString(),
          status: 'sending',
          local: true,
          reply_to: null,
        },
      ]);

      const { data, error: sendError } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: me,
          content: payload.content,
          message_type: payload.message_type,
          media_url: payload.media_url,
          media_type: payload.media_type,
          media_name: payload.media_name,
          reply_to_id: payload.reply_to_id,
          ...(payload.duration_seconds != null ? { duration_seconds: payload.duration_seconds } : {}),
        })
        .select('id')
        .maybeSingle();

      if (sendError || !data) {
        const msg = sendError?.message.includes('row-level security')
          ? 'You are no longer a member of this conversation.'
          : sendError?.message || 'Could not send the message.';
        setError(msg);
        setMessages((list) => list.filter((m) => m.id !== localId));
        throw new Error(msg); // composer keeps the draft so nothing is lost
      }

      setMessages((list) => list.map((m) => (m.id === localId ? { ...m, id: (data as any).id, status: 'sent', local: false } : m)));
    },
    [me, conversationId]
  );

  /* reply preview needs the message — resolve at send time from current state */
  const replyTargetRef = useRef<Message | null>(null);
  useEffect(() => {
    replyTargetRef.current = replyingTo;
  }, [replyingTo]);
  const handleSendWithReply = useCallback(
    async (payload: ComposerPayload) => {
      const enriched: ComposerPayload = replyTargetRef.current
        ? { ...payload, reply_to_id: replyTargetRef.current.id }
        : payload;
      await handleSend(enriched);
    },
    [handleSend]
  );

  const handleReact = useCallback(
    async (message: Message, emoji: string) => {
      if (!me) return;
      const existing = message.reactions?.find((r) => r.emoji === emoji);
      if (existing?.mine) {
        const { error: delError } = await supabase
          .from('message_reactions')
          .delete()
          .eq('message_id', message.id)
          .eq('user_id', me)
          .eq('emoji', emoji);
        if (delError) setError(`Could not remove the reaction — ${delError.message}`);
      } else {
        /* Upsert: the (message_id, user_id, emoji) primary key is the real
           duplicate guard. A rapid double-tap used to raise 409 (Conflict);
           ignoreDuplicates makes the second insert a no-op and the realtime
           refetch reconciles the UI to the database truth. */
        const { error: insError } = await supabase
          .from('message_reactions')
          .upsert(
            { message_id: message.id, user_id: me, emoji },
            { onConflict: 'message_id,user_id,emoji', ignoreDuplicates: true }
          );
        if (insError) setError(`Could not react — ${insError.message}`);
      }
    },
    [me]
  );

  const handleEdit = useCallback(
    async (message: Message, newContent: string) => {
      if (!newContent) return;
      const { error: editError } = await supabase
        .from('messages')
        .update({ content: newContent, edited_at: new Date().toISOString() })
        .eq('id', message.id);
      if (editError) {
        setError(`Could not edit the message — ${editError.message}`);
        return;
      }
      setMessages((list) => list.map((m) => (m.id === message.id ? { ...m, content: newContent, edited_at: new Date().toISOString() } : m)));
    },
    []
  );

  const handleDelete = useCallback(async (message: Message) => {
    const { error: delError } = await supabase
      .from('messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', message.id);
    if (delError) {
      setError(`Could not delete the message — ${delError.message}`);
      return;
    }
    setMessages((list) => list.map((m) => (m.id === message.id ? { ...m, deleted_at: new Date().toISOString() } : m)));
  }, []);

  /* delete for me: hides the message for THIS account only — the other
     member still sees it. Backed by the hidden_messages table (RLS-scoped
     to the current user), filtered out on load and immediately locally. */
  const handleDeleteForMe = useCallback(
    async (message: Message) => {
      if (!me) return;
      const { error: hideError } = await supabase
        .from('hidden_messages')
        .upsert({ message_id: message.id, hidden_for: me }, { onConflict: 'message_id,hidden_for' });
      if (hideError) {
        setError(`Could not delete for you — ${hideError.message}`);
        return;
      }
      setMessages((list) => list.filter((m) => m.id !== message.id));
    },
    [me]
  );

  /* media gallery for this conversation: every image/gif/video ever sent
     (from the messages already loaded), newest first */
  const mediaMessages = useMemo(
    () => messages.filter((m) => m.media_url && (m.message_type === 'image' || m.message_type === 'gif' || m.message_type === 'video')).slice().reverse(),
    [messages]
  );

  /* forward: open the destination sheet; the sheet owns the insert. */
  const handleForward = useCallback((message: Message) => {
    setForwarding(message);
  }, []);

  const loadOlder = useCallback(async () => {
    if (!messages.length || loadingOlder) return;
    setLoadingOlder(true);
    const oldest = messages[0];
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .lt('created_at', oldest.created_at)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);

    const older = ((data || []) as Message[]).slice().reverse();
    setMessages((list) => [...older, ...list]);
    setHasOlder(older.length === PAGE_SIZE);
    setLoadingOlder(false);
  }, [messages, conversationId, loadingOlder]);

  const toggleMute = useCallback(async () => {
    if (!me || !conversation) return;
    const next = !conversation.muted;
    setConversation({ ...conversation, muted: next });
    const { error: muteError } = await supabase
      .from('conversation_members')
      .update({ muted: next })
      .eq('conversation_id', conversationId)
      .eq('user_id', me);
    if (muteError) {
      setConversation({ ...conversation, muted: !next });
      setError(`Could not update notification settings — ${muteError.message}`);
    }
  }, [me, conversation, conversationId]);

  const toggleBlock = useCallback(async () => {
    if (!me || !otherMember) return;
    setShowMenu(false);
    if (blockedByMe) {
      const { error: unblockError } = await supabase.from('user_blocks').delete().eq('blocker_id', me).eq('blocked_id', otherMember.id);
      if (unblockError) return setError(`Could not unblock — ${unblockError.message}`);
      setBlockedByMe(false);
    } else {
      const { error: blockError } = await supabase.from('user_blocks').insert({ blocker_id: me, blocked_id: otherMember.id });
      if (blockError) return setError(`Could not block — ${blockError.message}`);
      setBlockedByMe(true);
    }
  }, [me, otherMember, blockedByMe]);

  const startVideoCall = () => {
    if (!otherMember) return;
    setShowMenu(false);
    startCall(otherMember.id, otherMember.full_text_name || otherMember.username || 'Writer', otherMember.avatar_url || null, conversationId, 'video');
  };

  const startAudioCall = () => {
    if (!otherMember) return;
    setShowMenu(false);
    startCall(otherMember.id, otherMember.full_text_name || otherMember.username || 'Writer', otherMember.avatar_url || null, conversationId, 'audio');
  };

  /* ---------- group admin actions (DB policies are the real gate) ---------- */

  const saveGroupEdits = async (newIcon: File | null, removeIcon: boolean) => {
    if (!amGroupAdmin || !conversation) return;
    setSavingGroup(true);
    setGroupError(null);
    setGroupNotice(null);
    try {
      let iconUrl = conversation.avatar_url || null;

      if (removeIcon && iconUrl) {
        /* best-effort storage cleanup from the URL path; the DB update is authoritative */
        try {
          const marker = '/object/public/avatars/';
          const idx = iconUrl.indexOf(marker);
          if (idx >= 0) {
            const path = decodeURIComponent(iconUrl.slice(idx + marker.length));
            await supabase.storage.from('avatars').remove([path]);
          }
        } catch { /* old/custom URLs may not parse — keep going */ }
        iconUrl = null;
      }

      if (newIcon) {
        const ext = (newIcon.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
        const path = `group-${conversationId}/${crypto.randomUUID()}.${ext}`;
        const { error: upError } = await supabase.storage
          .from('avatars')
          .upload(path, newIcon, { upsert: false, contentType: newIcon.type });
        if (upError) throw new Error(upError.message.includes('row-level') ? 'Only the group creator or admins can change the icon.' : upError.message);

        const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
        iconUrl = pub.publicUrl;

        /* replace: clean up the previous managed icon */
        const oldUrl = conversation.avatar_url;
        if (oldUrl) {
          try {
            const marker = '/object/public/avatars/';
            const idx = oldUrl.indexOf(marker);
            if (idx >= 0) {
              const oldPath = decodeURIComponent(oldUrl.slice(idx + marker.length));
              if (oldPath.startsWith(`group-${conversationId}/`)) {
                await supabase.storage.from('avatars').remove([oldPath]);
              }
            }
          } catch { /* non-fatal */ }
        }
      }

      const patch: Record<string, unknown> = {};
      const trimmed = editTitle.trim();
      if (trimmed && trimmed !== (conversation.title || '')) patch.title = trimmed.slice(0, 60);
      if (newIcon || removeIcon) patch.avatar_url = iconUrl;

      if (Object.keys(patch).length === 0) {
        setGroupNotice('Nothing to change.');
        return;
      }

      const { error: updError } = await supabase.from('conversations').update(patch).eq('id', conversationId);
      if (updError) {
        throw new Error(
          updError.message.includes('row-level security')
            ? 'Only the group creator or admins can edit this group.'
            : updError.message
        );
      }

      setConversation({ ...conversation, title: (patch.title as string) ?? conversation.title, avatar_url: iconUrl });
      setGroupNotice('Group updated.');
    } catch (e) {
      setGroupError(e instanceof Error ? e.message : 'Could not update the group.');
    } finally {
      setSavingGroup(false);
    }
  };

  const changeMemberRole = async (userId: string, role: 'member' | 'admin') => {
    if (!amGroupAdmin) return;
    setGroupError(null);
    const { error: roleError } = await supabase
      .from('conversation_members')
      .update({ role })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId);
    if (roleError) {
      setGroupError(
        roleError.message.includes('row-level security')
          ? 'Only the creator or admins can change roles.'
          : roleError.message
      );
      return;
    }
    setGroupMembers((list) => list.map((m) => (m.user_id === userId ? { ...m, role } : m)));
    setGroupNotice(role === 'admin' ? 'Promoted to admin.' : 'Changed to member.');
  };

  const removeMember = async (userId: string) => {
    if (!amGroupAdmin || userId === conversation?.created_by) return;
    setGroupError(null);
    const { error: rmError } = await supabase
      .from('conversation_members')
      .delete()
      .eq('conversation_id', conversationId)
      .eq('user_id', userId);
    if (rmError) {
      setGroupError(
        rmError.message.includes('row-level security')
          ? 'Only the creator or admins can remove members (and never the creator).'
          : rmError.message
      );
      return;
    }
    setGroupMembers((list) => list.filter((m) => m.user_id !== userId));
    setGroupNotice('Member removed.');
  };

  const leaveGroup = async () => {
    if (!me || !conversation?.is_group) return;
    setShowMenu(false);
    const { error: leaveError } = await supabase
      .from('conversation_members')
      .delete()
      .eq('conversation_id', conversationId)
      .eq('user_id', me);
    if (leaveError) {
      setError(`Could not leave the group — ${leaveError.message}`);
      return;
    }
    router.replace('/messages');
  };

  const onPickIcon = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!ICON_TYPES.includes(f.type)) return setGroupError('Icons must be JPEG, PNG, WebP or GIF.');
    if (f.size > ICON_MAX_BYTES) return setGroupError('Icon is too large — 5 MB maximum.');
    void saveGroupEdits(f, false);
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, typingUsers.length]);

  if (loading) {
    return (
      <main className="flex h-[100dvh] items-center justify-center bg-[#FFF7F8] text-[#9B9B9B]">Loading chat…</main>
    );
  }

  return (
    <main className="flex h-[100dvh] flex-col text-[#111111]" style={{ background: theme.background }}>
      {/* header */}
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-black/10 bg-white/90 px-3 py-2.5 backdrop-blur">
        <button
          onClick={() => router.push('/messages')}
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#E8E2E4]"
          aria-label="Back to chats"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        {conversation?.is_group ? (
          <button
            onClick={() => { setShowMembers(true); void loadMembers(); }}
            className="relative shrink-0"
            aria-label="View group members"
          >
            {conversation.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={conversation.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover ring-1 ring-black/10" />
            ) : (
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[#EDE4FF] to-[#D8C7FA] text-[#6D4AC2]">
                <Users className="h-5 w-5" />
              </span>
            )}
          </button>
        ) : (
          <Link href={otherMember?.username ? `/u/${otherMember.username}` : '#'}>
            <Avatar src={otherMember?.avatar_url} name={title} size={40} />
          </Link>
        )}

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-bold">{title}</h1>
          {typingUsers.length > 0 ? (
            <p className="text-xs font-medium" style={{ color: theme.accent }}>typing…</p>
          ) : conversation?.is_group ? (
            <button onClick={() => { setShowMembers(true); void loadMembers(); }} className="text-xs text-[#6B6B6B] underline-offset-2 hover:underline">
              {(groupMembers.length || (conversation.members?.length || 0) + 1)} members · view
            </button>
          ) : null}
        </div>

        {/* Call actions: DMs use the existing 1:1 call provider; groups use the
            in-app WebRTC group-call overlay. */}
        {!conversation?.is_group && otherMember && (
          <>
            <button onClick={startAudioCall} className="flex h-10 w-10 items-center justify-center rounded-full text-[#6B6B6B] transition hover:bg-gray-100" aria-label="Voice call">
              <PhoneCall className="h-5 w-5" />
            </button>
            <button onClick={startVideoCall} className="flex h-10 w-10 items-center justify-center rounded-full text-[#6B6B6B] transition hover:bg-gray-100" aria-label="Video call">
              <Video className="h-5 w-5" />
            </button>
          </>
        )}

        {conversation?.is_group && (
          <button
            onClick={() => {
              setShowGroupCall(true);
              void loadMembers();
            }}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#6B6B6B] transition hover:bg-gray-100"
            aria-label="Start group video call"
            title="Start group video call"
          >
            <Video className="h-5 w-5" />
          </button>
        )}

        {/* menu */}
        <div className="relative" ref={menuRef}>
          <button onClick={() => setShowMenu((v) => !v)} className="flex h-10 w-10 items-center justify-center rounded-full text-[#6B6B6B] transition hover:bg-gray-100" aria-label="Chat options" aria-expanded={showMenu}>
            {showMenu ? <X className="h-5 w-5" /> : <MoreVertical className="h-5 w-5" />}
          </button>
          {showMenu && (
            <div className="absolute right-0 top-11 z-40 w-56 overflow-hidden rounded-xl border border-[#E8E2E4] bg-white py-1 shadow-lg">
              <button onClick={() => { setShowMenu(false); setShowThemePicker(true); }} className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-semibold hover:bg-gray-50">
                <Palette className="h-4 w-4" /> Chat theme
              </button>
              <button
                onClick={() => { setShowMenu(false); setShowMedia(true); }}
                disabled={mediaMessages.length === 0}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <Images className="h-4 w-4" /> View media ({mediaMessages.length})
              </button>
              <button onClick={() => { setShowMenu(false); toggleMute(); }} className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-semibold hover:bg-gray-50">
                {conversation?.muted ? <BellRing className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
                {conversation?.muted ? 'Unmute chat' : 'Mute chat'}
              </button>
              {conversation?.is_group && amGroupAdmin && (
                <button onClick={() => { setShowMenu(false); setGroupError(null); setGroupNotice(null); setShowGroupEdit(true); }} className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-semibold hover:bg-gray-50">
                  <Shield className="h-4 w-4" /> Manage group
                </button>
              )}
              {conversation?.is_group && (
                <button onClick={leaveGroup} className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-semibold text-amber-600 hover:bg-amber-50">
                  <LogOut className="h-4 w-4" /> Leave group
                </button>
              )}
              {!conversation?.is_group && otherMember && (
                <>
                  <button onClick={toggleBlock} className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-semibold hover:bg-gray-50">
                    <Ban className="h-4 w-4" /> {blockedByMe ? 'Unblock' : 'Block'} user
                  </button>
                  <button onClick={() => { setShowMenu(false); setReportTarget({ type: 'user', id: otherMember.id }); }} className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-semibold text-red-500 hover:bg-red-50">
                    <Flag className="h-4 w-4" /> Report user
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </header>

      {/* messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4" style={{ background: theme.background }}>
        {hasOlder && (
          <div className="mb-3 flex justify-center">
            <button onClick={loadOlder} disabled={loadingOlder} className="rounded-full border border-black/10 bg-white/80 px-4 py-1.5 text-xs font-semibold shadow-sm disabled:opacity-50">
              {loadingOlder ? 'Loading…' : 'Load older messages'}
            </button>
          </div>
        )}

        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="text-4xl">💬</div>
            <p className="mt-3 text-sm text-[#6B6B6B]">
              {conversation?.is_group ? 'Start the conversation!' : 'Say hello ♡'}
            </p>
          </div>
        ) : (
          <ul className="mx-auto max-w-2xl space-y-2">
            {messages.map((msg, i) => {
              const prev = messages[i - 1];
              const showAvatar = !prev || prev.sender_id !== msg.sender_id;
              return (
                <MessageRow
                  key={msg.id}
                  message={msg}
                  previous={prev}
                  isGroup={!!conversation?.is_group}
                  myId={me || ''}
                  theme={theme}
                  readReceiptsEnabled={readReceipts}
                  showAvatar={showAvatar}
                  onReply={setReplyingTo}
                  onReact={handleReact}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onDeleteForMe={handleDeleteForMe}
                  onForward={handleForward}
                />
              );
            })}
          </ul>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p role="alert" className="bg-red-50 px-4 py-1.5 text-center text-xs text-red-600">{error}</p>
      )}

      {handoffNotice && (
        <div role="status" className="flex items-center gap-2 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <span className="flex-1">{handoffNotice}</span>
          <button onClick={() => setHandoffNotice(null)} className="shrink-0 font-bold underline" aria-label="Dismiss notice">
            dismiss
          </button>
        </div>
      )}

      <ChatComposer
        conversationId={conversationId}
        myId={me || ''}
        replyingTo={replyingTo ? { id: replyingTo.id, content: replyingTo.content || 'Attachment', author: replyingTo.sender?.full_text_name || replyingTo.sender?.username } : null}
        onCancelReply={() => setReplyingTo(null)}
        onSend={handleSendWithReply}
        onTyping={sendTyping}
      />

      {/* members sheet */}
      <GroupCallOverlay
        conversationId={conversationId}
        myId={me}
        members={groupMembers}
        enabled={conversation?.is_group === true}
        startWhenOpened={showGroupCall}
        onClose={() => setShowGroupCall(false)}
      />

      {showMembers && conversation?.is_group && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={() => setShowMembers(false)}>
          <div className="max-h-[75dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Group members">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-bold">Members ({groupMembers.length})</h3>
              <button onClick={() => setShowMembers(false)} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-gray-100" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <ul className="space-y-2">
              {groupMembers.map((member) => {
                const isCreator = member.user_id === conversation.created_by;
                const canManage = amGroupAdmin && !isCreator && member.user_id !== me;
                return (
                  <li key={member.user_id} className="flex items-center gap-3 rounded-xl p-2 hover:bg-gray-50">
                    <Avatar src={member.profile?.avatar_url} name={member.profile?.full_text_name || member.profile?.username} size={40} />
                    <Link href={member.profile?.username ? `/u/${member.profile.username}` : '#'} className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                        {member.profile?.full_text_name || member.profile?.username || 'Member'}
                        {isCreator && <Crown className="h-3.5 w-3.5 text-amber-500" aria-label="Group creator" />}
                        {!isCreator && (member.role === 'admin' || member.role === 'moderator') && <Shield className="h-3.5 w-3.5 text-[#1E90FF]" aria-label="Group admin" />}
                        {member.user_id === me && <span className="text-[10px] font-normal text-[#9B9B9B]">(you)</span>}
                      </p>
                      <p className="text-xs text-[#6B6B6B]">{member.profile?.username ? `@${member.profile.username}` : ''}</p>
                    </Link>
                    {canManage && (
                      <span className="flex shrink-0 gap-1">
                        <button
                          onClick={() => changeMemberRole(member.user_id, member.role === 'admin' || member.role === 'moderator' ? 'member' : 'admin')}
                          className="flex h-9 items-center gap-1 rounded-lg border border-[#E8E2E4] px-2 text-[11px] font-semibold text-[#6B6B6B] hover:bg-gray-50"
                          aria-label={(member.role === 'admin' || member.role === 'moderator') ? `Demote ${member.profile?.username || 'member'}` : `Promote ${member.profile?.username || 'member'} to admin`}
                        >
                          {(member.role === 'admin' || member.role === 'moderator') ? <UserMinus className="h-3.5 w-3.5" /> : <Shield className="h-3.5 w-3.5" />}
                          {(member.role === 'admin' || member.role === 'moderator') ? 'Demote' : 'Promote'}
                        </button>
                        <button
                          onClick={() => removeMember(member.user_id)}
                          className="flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 text-red-500 hover:bg-red-50"
                          aria-label={`Remove ${member.profile?.username || 'member'} from group`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {groupError && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-2.5 text-xs text-red-600">{groupError}</p>}
            {groupNotice && <p className="mt-3 rounded-lg bg-emerald-50 p-2.5 text-xs text-emerald-700">{groupNotice}</p>}
          </div>
        </div>
      )}

      {/* group edit sheet — creator/admins only (RLS enforces server-side) */}
      {showGroupEdit && conversation?.is_group && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={() => setShowGroupEdit(false)}>
          <div className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Manage group">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-bold">Manage group</h3>
              <button onClick={() => setShowGroupEdit(false)} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-gray-100" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex items-center gap-4">
              <div className="relative">
                {conversation.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={conversation.avatar_url} alt="Group icon" className="h-20 w-20 rounded-2xl object-cover ring-1 ring-[#E8E2E4]" />
                ) : (
                  <span className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-[#EDE4FF] to-[#D8C7FA] text-[#6D4AC2]">
                    <Users className="h-9 w-9" />
                  </span>
                )}
                {savingGroup && (
                  <span className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/40">
                    <Loader2 className="h-5 w-5 animate-spin text-white" />
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1.5 text-xs">
                <button
                  onClick={() => iconInputRef.current?.click()}
                  disabled={savingGroup}
                  className="flex items-center gap-1.5 rounded-lg border border-[#E8E2E4] px-3 py-2 font-semibold hover:bg-gray-50 disabled:opacity-50"
                >
                  <Camera className="h-3.5 w-3.5" /> {conversation.avatar_url ? 'Replace icon' : 'Upload icon'}
                </button>
                {conversation.avatar_url && (
                  <button
                    onClick={() => void saveGroupEdits(null, true)}
                    disabled={savingGroup}
                    className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove icon
                  </button>
                )}
                <span className="text-[10px] text-[#9B9B9B]">JPEG, PNG, WebP or GIF · max 5 MB</span>
              </div>
            </div>
            <input ref={iconInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={onPickIcon} className="hidden" aria-hidden="true" />

            <label className="mt-4 block">
              <span className="text-xs font-semibold text-[#6B6B6B]">Group name</span>
              <div className="mt-1 flex items-center gap-2">
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  maxLength={60}
                  className="min-w-0 flex-1 rounded-lg border border-[#E8E2E4] px-3 py-2.5 text-sm focus:border-[#1E90FF] focus:outline-none"
                  aria-label="Group name"
                />
                <button
                  onClick={() => void saveGroupEdits(null, false)}
                  disabled={savingGroup || !editTitle.trim() || editTitle.trim() === (conversation.title || '')}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-black text-[#FFB6C1] disabled:opacity-40"
                  aria-label="Save group name"
                >
                  {savingGroup ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                </button>
              </div>
            </label>

            <p className="mt-3 rounded-lg bg-[#FFF7F8] p-2.5 text-[11px] text-[#6B6B6B]">
              <Pencil className="mr-1 inline h-3 w-3" />
              You are {myRole === 'creator' ? 'the group creator' : 'a group admin'} — members can be managed from the members list.
            </p>

            {groupError && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-2.5 text-xs text-red-600">{groupError}</p>}
            {groupNotice && <p className="mt-3 rounded-lg bg-emerald-50 p-2.5 text-xs text-emerald-700">{groupNotice}</p>}
          </div>
        </div>
      )}

      {showThemePicker && (
        <ChatThemePicker
          conversationId={conversationId}
          myId={me || ''}
          current={themeRow}
          onClose={() => setShowThemePicker(false)}
          onSaved={setThemeRow}
        />
      )}

      {showMedia && <MediaGallery media={mediaMessages} onClose={() => setShowMedia(false)} />}

      {forwarding && (
        <ForwardSheet
          message={forwarding}
          onClose={(forwarded) => {
            if (forwarded) setForwardedNotice('Message forwarded.');
            setForwarding(null);
          }}
        />
      )}

      {forwardedNotice && (
        <div role="status" className="bg-emerald-50 px-4 py-2 text-center text-xs font-semibold text-emerald-700">
          {forwardedNotice}
        </div>
      )}

      <ReportDialog
        open={reportTarget !== null}
        onClose={() => setReportTarget(null)}
        targetType={reportTarget?.type === 'message' ? 'message' : 'user'}
        targetId={reportTarget?.id || ''}
      />

    </main>
  );
}
