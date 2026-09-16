'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, BellOff, BellRing, CheckCheck, Heart, Loader2, MessageCircle, PhoneMissed, Share2, Sparkles, UserPlus, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import type { Notification } from '@/types/social';
import Avatar from '@/components/social/Avatar';
import { disablePush, enablePush, getPushState, isStandalone, pushSupported, type PushPermissionState } from '@/lib/notifications/push';

const ICONS: Record<string, React.ReactNode> = {
  like: <Heart className="h-4 w-4 fill-current text-[#E5798F]" />,
  reaction: <Heart className="h-4 w-4 fill-current text-[#E5798F]" />,
  comment: <MessageCircle className="h-4 w-4 text-[#5B8DEF]" />,
  comment_reply: <MessageCircle className="h-4 w-4 text-[#5B8DEF]" />,
  mention: <Sparkles className="h-4 w-4 text-[#F59E0B]" />,
  follow: <UserPlus className="h-4 w-4 text-[#8B5CF6]" />,
  share: <Share2 className="h-4 w-4 text-[#10B981]" />,
  message: <MessageCircle className="h-4 w-4 text-[#F59E0B]" />,
  group_invite: <Users className="h-4 w-4 text-[#F59E0B]" />,
  journal_invite: <Share2 className="h-4 w-4 text-[#10B981]" />,
  journal_edit: <Share2 className="h-4 w-4 text-[#10B981]" />,
  call_missed: <PhoneMissed className="h-4 w-4 text-red-500" />,
  call_declined: <PhoneMissed className="h-4 w-4 text-[#9B9B9B]" />,
};

type Filter = 'all' | 'unread' | 'mentions';

function timeAgo(iso: string) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

/** Dynamic target per notification — entity ids come from the database, never hardcoded. */
function target(n: Notification): string {
  switch (n.type) {
    case 'follow':
      return n.actor?.username ? `/u/${n.actor.username}` : '/search';
    case 'share':
    case 'journal_invite':
      return n.entity_id ? `/journals/${n.entity_id}` : '/journals';
    case 'journal_edit':
      return n.entity_id ? `/journals/${n.entity_id}/edit` : '/journals';
    case 'comment':
    case 'comment_reply':
    case 'like':
    case 'reaction':
    case 'mention':
      return n.entity_id ? `/posts/${n.entity_id}` : '/feed';
    case 'call_missed':
    case 'call_declined':
      return '/messages';
    case 'message':
    case 'group_invite':
      return n.entity_id ? `/messages/${n.entity_id}` : '/messages';
    default:
      return '/feed';
  }
}

function defaultMessage(n: Notification) {
  return n.message || 'interacted with you';
}

export default function NotificationsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 30;

  /* Web Push — receive alerts while the app is CLOSED (realtime covers open tabs) */
  const [pushState, setPushState] = useState<PushPermissionState>('unsupported');
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState<string | null>(null);

  useEffect(() => {
    void getPushState().then(setPushState);
  }, []);

  const togglePush = async () => {
    setPushBusy(true);
    setPushMsg(null);
    if (pushState === 'subscribed') {
      const err = await disablePush();
      setPushMsg(err || null);
    } else {
      const err = await enablePush();
      setPushMsg(err || null);
    }
    setPushState(await getPushState());
    setPushBusy(false);
  };

  const load = useCallback(
    async (pageNum: number) => {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        router.replace('/auth/sign-in');
        return;
      }

      const from = pageNum * PAGE_SIZE;
      const { data } = await supabase
        .from('notifications')
        .select(
          'id, user_id, actor_id, type, entity_type, entity_id, message, read, created_at, actor:profiles!notifications_actor_id_fkey(id, full_text_name, username, avatar_url)'
        )
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);

      setItems((prev) => (pageNum === 0 ? (data || []) as unknown as Notification[] : [...prev, ...((data || []) as unknown as Notification[])]));
      setLoading(false);
    },
    [router]
  );

  useEffect(() => {
    load(0);
  }, [load]);

  /* realtime: new notifications arrive without refresh */
  useEffect(() => {
    let myId: string | null = null;

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      myId = user?.id || null;
    })();

    const channel = supabase
      .channel('notifications-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (payload) => {
        const row = payload.new as Notification;
        if (row.user_id !== myId) return;
        supabase
          .from('notifications')
          .select(
            'id, user_id, actor_id, type, entity_type, entity_id, message, read, created_at, actor:profiles!notifications_actor_id_fkey(id, full_text_name, username, avatar_url)'
          )
          .eq('id', row.id)
          .maybeSingle()
          .then(({ data }) => {
            if (data) setItems((list) => [data as unknown as Notification, ...list]);
          });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const unreadCount = items.filter((n) => !n.read).length;

  const markAllRead = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setItems((list) => list.map((n) => ({ ...n, read: true })));
    await supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false);
  };

  const markRead = async (n: Notification) => {
    if (n.read) return;
    setItems((list) => list.map((item) => (item.id === n.id ? { ...item, read: true } : item)));
    await supabase.from('notifications').update({ read: true }).eq('id', n.id);
  };

  const visible = items.filter((n) => {
    if (filter === 'unread') return !n.read;
    if (filter === 'mentions') return n.type === 'mention' || n.type === 'comment_reply';
    return true;
  });

  return (
    <main className="min-h-[100dvh] bg-[#FFF7F8] px-3 pb-24 pt-5 text-[#111111] sm:px-6 md:pb-10">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Activity</h1>
            <p className="text-sm text-[#6B6B6B]">
              {unreadCount > 0 ? `${unreadCount} unread` : 'You’re all caught up ♡'}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {pushSupported() && (
              <button
                onClick={() => void togglePush()}
                disabled={pushBusy || pushState === 'denied' || (!isStandalone() && /iPhone|iPad/.test(navigator.userAgent))}
                title={pushState === 'subscribed' ? 'Turn off push notifications' : 'Get notified even when enotes is closed'}
                className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold shadow-sm transition disabled:opacity-50 ${
                  pushState === 'subscribed' ? 'border-[#E5798F]/40 bg-[#FFF7F8] text-[#E5798F]' : 'border-[#E8E2E4] bg-white hover:bg-gray-50'
                }`}
              >
                <BellRing className="h-4 w-4" />
                {pushState === 'subscribed' ? 'Push on' : pushState === 'denied' ? 'Push blocked' : 'Enable push'}
              </button>
            )}
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[#E8E2E4] bg-white px-3 text-xs font-semibold shadow-sm transition hover:bg-gray-50"
              >
                <CheckCheck className="h-4 w-4" /> Mark all read
              </button>
            )}
          </div>
        </header>

        {pushMsg && (
          <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800" role="status">{pushMsg}</p>
        )}
        {pushSupported() && pushState === 'denied' && (
          <p className="mb-3 rounded-xl border border-[#E8E2E4] bg-white p-3 text-xs text-[#6B6B6B]">
            Push notifications are blocked for this site — reset the permission in your browser's address-bar/website settings to enable them.
          </p>
        )}

        {/* filters */}
        <div className="mb-4 flex gap-1 rounded-xl bg-white p-1 shadow-sm">
          {(
            [
              ['all', 'All'],
              ['unread', 'Unread'],
              ['mentions', 'Mentions & replies'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`min-h-[38px] flex-1 rounded-lg text-xs font-semibold transition ${
                filter === key ? 'bg-black text-[#FFB6C1]' : 'text-[#6B6B6B] hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#9B9B9B]">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading activity…
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#E8E2E4] bg-white/60 px-6 py-14 text-center">
            {filter === 'all' ? <Bell className="mx-auto h-8 w-8 text-[#E8E2E4]" /> : <BellOff className="mx-auto h-8 w-8 text-[#E8E2E4]" />}
            <h2 className="mt-3 text-lg font-semibold">
              {filter === 'all' ? 'Nothing yet' : filter === 'unread' ? 'No unread notifications' : 'No mentions yet'}
            </h2>
            <p className="mt-1 text-sm text-[#6B6B6B]">
              {filter === 'all' ? 'When people interact with your journals and posts, it shows up here.' : 'Check back later.'}
            </p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {visible.map((n) => (
              <li key={n.id}>
                <Link
                  href={target(n)}
                  onClick={() => markRead(n)}
                  className={`flex items-center gap-3 rounded-2xl border p-3.5 shadow-sm transition hover:shadow ${
                    n.read ? 'border-[#E8E2E4] bg-white' : 'border-[#FFD9E1] bg-[#FFF7F8]'
                  }`}
                >
                  <div className="relative shrink-0">
                    <Avatar src={n.actor?.avatar_url} name={n.actor?.full_text_name || n.actor?.username} size={40} />
                    <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-white bg-white shadow">
                      {ICONS[n.type] || <Bell className="h-3 w-3 text-[#6B6B6B]" />}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug">
                      <span className="font-semibold">{n.actor?.full_text_name || n.actor?.username || 'Someone'}</span>{' '}
                      <span className="text-[#6B6B6B]">{defaultMessage(n)}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-[#9B9B9B]">{timeAgo(n.created_at)}</p>
                  </div>
                  {!n.read && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#E5798F]" />}
                </Link>
              </li>
            ))}
          </ul>
        )}

        {!loading && items.length >= PAGE_SIZE && (
          <button
            onClick={() => {
              const next = page + 1;
              setPage(next);
              load(next);
            }}
            className="mx-auto mt-4 flex items-center gap-1.5 rounded-xl border border-[#E8E2E4] bg-white px-4 py-2.5 text-xs font-semibold shadow-sm"
          >
            Load older
          </button>
        )}
      </div>

    </main>
  );
}
