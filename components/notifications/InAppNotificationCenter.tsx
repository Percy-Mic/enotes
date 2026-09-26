'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell,
  Check,
  Heart,
  MessageCircle,
  Phone,
  Reply,
  Sparkles,
  X,
} from 'lucide-react';
import Avatar from '@/components/social/Avatar';
import { supabase } from '@/lib/supabase/client';

type PushData = {
  title?: string;
  body?: string;
  type?: string;
  url?: string;
  tag?: string;
  icon?: string;
  notificationId?: string | null;
  conversationId?: string | null;
  senderId?: string | null;
  senderName?: string | null;
  callId?: string | null;
};

type InAppNotification = {
  id: string;
  title: string;
  body: string;
  type: 'message' | 'call' | 'default';
  url: string;
  icon?: string | null;
  senderName?: string | null;
  senderId?: string | null;
  conversationId?: string | null;
  callId?: string | null;
};

type DbNotification = {
  id: string;
  user_id: string;
  actor_id: string | null;
  type: string;
  entity_id: string | null;
  message: string | null;
  actor?: {
    id: string;
    full_text_name: string | null;
    username: string | null;
    avatar_url: string | null;
  } | null;
};

const MAX_VISIBLE = 3;
const MESSAGE_DURATION = 8500;

function makeId(prefix = 'in-app') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function notificationFromPush(data: PushData): InAppNotification {
  const type: InAppNotification['type'] =
    data.type === 'message'
      ? 'message'
      : data.type === 'call'
        ? 'call'
        : 'default';

  return {
    id: data.notificationId || makeId('push'),
    title:
      data.title ||
      (type === 'message'
        ? data.senderName || 'New message'
        : type === 'call'
          ? 'Incoming call'
          : 'enotes'),
    body:
      data.body ||
      (type === 'message'
        ? 'Sent you a message'
        : type === 'call'
          ? 'Someone is calling you'
          : 'You have a new notification'),
    type,
    url:
      data.url ||
      (data.conversationId
        ? `/messages/${data.conversationId}`
        : '/notifications'),
    icon: data.icon || null,
    senderName: data.senderName || data.title || null,
    senderId: data.senderId || null,
    conversationId: data.conversationId || null,
    callId: data.callId || null,
  };
}

function notificationFromRow(row: DbNotification): InAppNotification {
  const isMessage = row.type === 'message';
  const isCall = row.type === 'call';

  const senderName =
    row.actor?.full_text_name ||
    row.actor?.username ||
    'Someone';

  return {
    id: row.id,
    title: isMessage ? senderName : senderName,
    body:
      row.message ||
      (isMessage ? 'Sent you a message' : 'You have a new notification'),
    type: isCall ? 'call' : isMessage ? 'message' : 'default',
    url:
      row.entity_id && isMessage
        ? `/messages/${row.entity_id}`
        : '/notifications',
    icon: row.actor?.avatar_url || null,
    senderName,
    senderId: row.actor_id,
    conversationId: isMessage ? row.entity_id : null,
  };
}

function iconFor(type: InAppNotification['type']) {
  if (type === 'message') {
    return <MessageCircle className="h-4 w-4" />;
  }

  if (type === 'call') {
    return <Phone className="h-4 w-4" />;
  }

  return <Bell className="h-4 w-4" />;
}

function accentFor(type: InAppNotification['type']) {
  if (type === 'message') return 'bg-[#5B8DEF]';
  if (type === 'call') return 'bg-[#E5798F]';
  return 'bg-[#8B5CF6]';
}

export default function InAppNotificationCenter({
  userId,
}: {
  userId: string | null;
}) {
  const router = useRouter();
  const [items, setItems] = useState<InAppNotification[]>([]);
  const seenIds = useRef(new Set<string>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const remove = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));

    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const add = useCallback(
    (item: InAppNotification, persistent = false) => {
      if (seenIds.current.has(item.id)) return;
      seenIds.current.add(item.id);

      setItems((current) => {
        const withoutDuplicate = current.filter(
          (existing) =>
            existing.id !== item.id &&
            !(
              item.type === 'message' &&
              existing.type === 'message' &&
              item.conversationId &&
              existing.conversationId === item.conversationId &&
              existing.body === item.body
            ),
        );

        return [...withoutDuplicate, item].slice(-MAX_VISIBLE);
      });

      if (!persistent) {
        const timer = setTimeout(() => remove(item.id), MESSAGE_DURATION);
        timers.current.set(item.id, timer);
      }
    },
    [remove],
  );

  useEffect(() => {
    return () => {
      timers.current.forEach((timer) => clearTimeout(timer));
      timers.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!userId) {
      setItems([]);
      seenIds.current.clear();
      return;
    }

    const channel = supabase
      .channel(`enotes-in-app-notifications-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        async (payload) => {
          const row = payload.new as DbNotification;

          if (seenIds.current.has(row.id)) return;

          const { data } = await supabase
            .from('notifications')
            .select(
              'id, user_id, actor_id, type, entity_id, message, actor:profiles!notifications_actor_id_fkey(id, full_text_name, username, avatar_url)',
            )
            .eq('id', row.id)
            .maybeSingle();

          const complete = (data || row) as unknown as DbNotification;
          add(notificationFromRow(complete), complete.type === 'call');
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [add, userId]);

  useEffect(() => {
    if (!userId || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    const onMessage = (event: MessageEvent) => {
      const message = event.data;

      if (
        !message ||
        message.type !== 'ENOTES_PUSH_NOTIFICATION' ||
        !message.payload
      ) {
        return;
      }

      const data = message.payload as PushData;
      const item = notificationFromPush(data);

      /*
       * The service worker only forwards pushes to us when a visible enotes
       * window exists. That lets the custom UI replace the ordinary browser
       * toast without losing closed/background push delivery.
       */
      add(item, item.type === 'call');
    };

    navigator.serviceWorker.addEventListener('message', onMessage);

    return () => {
      navigator.serviceWorker.removeEventListener('message', onMessage);
    };
  }, [add, userId]);

  const openItem = (item: InAppNotification) => {
    remove(item.id);
    router.push(item.url);
  };

  if (!userId || items.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-3 top-3 z-[400] flex flex-col items-end gap-3 sm:left-auto sm:right-4 sm:max-w-[430px]"
    >
      {items.map((item) => (
        <article
          key={item.id}
          role="status"
          className="pointer-events-auto w-full overflow-hidden rounded-[24px] border border-white/70 bg-white/95 shadow-[0_20px_60px_rgba(20,12,16,0.18)] backdrop-blur-xl"
        >
          <div className="relative p-3.5">
            <div className="flex items-start gap-3">
              <div className="relative shrink-0">
                <Avatar
                  src={item.icon}
                  name={item.senderName || item.title}
                  size={48}
                />
                <span
                  className={`absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-white shadow-sm ${accentFor(item.type)}`}
                >
                  {iconFor(item.type)}
                </span>
              </div>

              <button
                type="button"
                onClick={() => remove(item.id)}
                aria-label="Dismiss notification"
                className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full text-[#9B9296] transition hover:bg-[#F7F1F3] hover:text-[#171315]"
              >
                <X className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() => openItem(item)}
                className="min-w-0 flex-1 pr-7 text-left"
              >
                <div className="flex items-center gap-2">
                  <p className="truncate text-[14px] font-bold text-[#171315]">
                    {item.title}
                  </p>
                  <span className="shrink-0 rounded-full bg-[#F7F1F3] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#8A8084]">
                    {item.type === 'message'
                      ? 'Message'
                      : item.type === 'call'
                        ? 'Call'
                        : 'Alert'}
                  </span>
                </div>

                <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-[#625A5E]">
                  {item.body}
                </p>

                <p className="mt-2 text-[10px] font-medium text-[#A39A9E]">
                  enotes · now
                </p>
              </button>
            </div>

            <div className="mt-3 flex gap-2">
              {item.type === 'message' ? (
                <>
                  <button
                    type="button"
                    onClick={() => openItem(item)}
                    className="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#171315] px-3 text-xs font-bold text-[#FFB6C1] transition hover:bg-[#282024]"
                  >
                    <Reply className="h-3.5 w-3.5" />
                    Open chat
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(item.id)}
                    className="flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-[#ECE5E7] bg-white px-3 text-xs font-semibold text-[#6B6266] transition hover:bg-[#FAF7F8]"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Dismiss
                  </button>
                </>
              ) : item.type === 'call' ? (
                <>
                  <button
                    type="button"
                    onClick={() => openItem(item)}
                    className="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#171315] px-3 text-xs font-bold text-[#FFB6C1] transition hover:bg-[#282024]"
                  >
                    <Phone className="h-3.5 w-3.5" />
                    Open call
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(item.id)}
                    className="flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-[#ECE5E7] bg-white px-3 text-xs font-semibold text-[#6B6266] transition hover:bg-[#FAF7F8]"
                  >
                    <X className="h-3.5 w-3.5" />
                    Dismiss
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => openItem(item)}
                  className="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#171315] px-3 text-xs font-bold text-[#FFB6C1] transition hover:bg-[#282024]"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  View notification
                </button>
              )}
            </div>

            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-[#F1EAEC]">
              <div
                className="h-full origin-left bg-[#E5798F]"
                style={{
                  animation:
                    item.type === 'call'
                      ? undefined
                      : `enotesNotificationProgress ${MESSAGE_DURATION}ms linear forwards`,
                }}
              />
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
