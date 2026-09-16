'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { Profile, UserSettings, PresenceStatus } from '@/types/social';

/* ============================================================
   useMe — the authenticated user + profile, everywhere.
   Never hardcode user info; always use this.
   ============================================================ */

export function useMe() {
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setUserId(null);
      setProfile(null);
      setLoading(false);
      return;
    }
    setUserId(user.id);
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();
    setProfile((data as Profile) || null);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
    const { data: sub } = supabase.auth.onAuthStateChange(() => reload());
    return () => sub.subscription.unsubscribe();
  }, [reload]);

  return { userId, profile, loading, reload };
}

/* ============================================================
   useUserSettings — reads + persists user_settings (RLS
   guarantees a user can only ever read/write their own row).
   ============================================================ */

export function useUserSettings(userId: string | null) {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      const { data } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      setSettings((data as UserSettings) || null);
      setLoading(false);
    })();
  }, [userId]);

  const update = useCallback(
    async (changes: Partial<UserSettings>) => {
      if (!userId) return false;
      setSaving(true);
      const { data, error } = await supabase
        .from('user_settings')
        .upsert({ user_id: userId, ...changes }, { onConflict: 'user_id' })
        .select()
        .maybeSingle();
      setSaving(false);
      if (!error && data) setSettings(data as UserSettings);
      return !error;
    },
    [userId]
  );

  return { settings, loading, saving, update };
}

/* ============================================================
   usePresence — publishes my presence via a Realtime presence
   channel (no DB polling) and tracks everyone else's.
   Falls back to a throttled user_presence row (60s) so the
   status survives across devices, gated by the user's
   show_active_status setting.
   ============================================================ */

export function usePresence(myId: string | null) {
  const [statuses, setStatuses] = useState<Record<string, PresenceStatus>>({});
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastDbPing = useRef(0);

  useEffect(() => {
    if (!myId) return;

    const channel = supabase.channel('online-users', { config: { presence: { key: myId } } });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<{ online_at: string }>();
        const next: Record<string, PresenceStatus> = {};
        for (const [userId, metas] of Object.entries(state)) {
          if (!metas?.length) continue;
          const onlineAt = metas[0]?.online_at ? new Date(metas[0].online_at).getTime() : Date.now();
          const away = Date.now() - onlineAt > 5 * 60 * 1000; // 5 min idle → away
          next[userId] = away ? 'away' : 'online';
        }
        setStatuses(next);
      })
      .subscribe(async (status) => {
        if (status !== 'SUBSCRIBED') return;
        await channel.track({ online_at: new Date().toISOString() });
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    };
  }, [myId]);

  /* Database heartbeat, throttled to 1/minute (presence row also drives
     "recently active" for users who disabled realtime or use another device). */
  const pingDb = useCallback(async () => {
    if (!myId) return;
    const now = Date.now();
    if (now - lastDbPing.current < 60_000) return;
    lastDbPing.current = now;
    supabase
      .from('user_presence')
      .upsert({ user_id: myId, status: 'online', last_seen_at: new Date().toISOString() }, { onConflict: 'user_id' })
      .then(() => undefined);
  }, [myId]);

  useEffect(() => {
    pingDb();
    const t = setInterval(pingDb, 60_000);
    return () => clearInterval(t);
  }, [pingDb]);

  const statusOf = useCallback(
    (userId: string): PresenceStatus => statuses[userId] || 'offline',
    [statuses]
  );

  return { statuses, statusOf };
}

/* ============================================================
   useDebounce — debounced values for search inputs etc.
   ============================================================ */

export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
