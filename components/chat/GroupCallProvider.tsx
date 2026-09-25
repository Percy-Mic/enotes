'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { supabase } from '@/lib/supabase/client';
import GroupCallOverlay, {
  type GroupCallMember,
  type GroupCallInvite,
} from '@/components/chat/GroupCallOverlay';

interface GroupCallContextValue {
  startGroupCall: (conversationId: string) => void;
  activeConversationId: string | null;
}

const GroupCallContext = createContext<GroupCallContextValue | null>(null);

interface GroupCallProviderProps {
  children: React.ReactNode;
  myId?: string | null;
}

interface PendingRow {
  call_id: string;
  conversation_id: string;
  caller_id: string;
  media: 'audio' | 'video';
  started_at: string;
  group_title: string;
  caller_name: string;
  caller_avatar: string | null;
  members: Array<{
    user_id: string;
    full_text_name?: string | null;
    username?: string | null;
    avatar_url?: string | null;
  }>;
}

export function GroupCallProvider({
  children,
  myId: suppliedMyId,
}: GroupCallProviderProps) {
  const [myId, setMyId] = useState<string | null>(suppliedMyId ?? null);
  const [pending, setPending] = useState<PendingRow | null>(null);
  const [outgoingConversationId, setOutgoingConversationId] = useState<string | null>(null);
  // A restored call is not a new call. Keep it separate from explicit
  // user-started calls so opening the app can never trigger create_group_call.
  const [restoredConversationId, setRestoredConversationId] = useState<string | null>(null);
  const loadInFlightRef = useRef(false);
  const restoredActiveRef = useRef(false);
  // Prevent a missing optional recovery RPC from being called every 2.5s.
  // The repair migration adds it back; a full page reload re-checks it.
  const activeRecoveryRpcAvailableRef = useRef(true);

  useEffect(() => {
    if (suppliedMyId !== undefined) {
      setMyId(suppliedMyId ?? null);
      return;
    }

    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setMyId(data.user?.id ?? null);
    });

    return () => {
      cancelled = true;
    };
  }, [suppliedMyId]);

  const loadPending = useCallback(async () => {
    if (!myId || loadInFlightRef.current) return;
    loadInFlightRef.current = true;

    try {
      let activeRows: unknown = null;

      if (activeRecoveryRpcAvailableRef.current) {
        const { data, error: activeError } = await supabase.rpc(
          'get_my_active_group_calls',
        );

        if (activeError) {
          // PostgREST 404 means the recovery migration has not reached this
          // Supabase project yet. Do not hammer the RPC on every poll.
          if (activeError.code === 'PGRST202' || activeError.message?.includes('404')) {
            activeRecoveryRpcAvailableRef.current = false;
            console.warn(
              '[enotes group call] active-session recovery RPC is unavailable. Apply the latest group-call migration to Supabase.',
            );
          }
        } else {
          activeRows = data;
        }
      }

      if (Array.isArray(activeRows) && activeRows.length > 0) {
        const active = activeRows[0] as {
          call_id: string;
          conversation_id: string;
          host_id: string;
          media: 'audio' | 'video';
          status: string;
          role: string;
        };

        if (!outgoingConversationId) {
          restoredActiveRef.current = true;
          setPending(null);
          setRestoredConversationId(active.conversation_id);
          return;
        }
      }

      const { data, error } = await supabase.rpc('get_pending_group_calls');
      if (error) {
        console.warn('[enotes group call] pending-call lookup failed:', error.message);
        return;
      }

      const rows = (Array.isArray(data) ? data : []) as PendingRow[];
      const next = rows[0] ?? null;

      if (outgoingConversationId) return;

      setPending((current) => {
        if (!next) return null;
        if (current?.call_id === next.call_id) return current;
        return next;
      });
    } finally {
      loadInFlightRef.current = false;
    }
  }, [myId, outgoingConversationId]);

  useEffect(() => {
    if (!myId) {
      setPending(null);
      return;
    }

    void loadPending();

    const interval = window.setInterval(() => {
      void loadPending();
    }, 2500);

    const channel = supabase
      .channel(`group-call-state:${myId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'call_participants',
          filter: `user_id=eq.${myId}`,
        },
        () => {
          void loadPending();
        },
      )
      .subscribe();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void loadPending();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      void supabase.removeChannel(channel);
    };
  }, [loadPending, myId]);

  const startGroupCall = useCallback((conversationId: string) => {
    setPending(null);
    setRestoredConversationId(null);
    restoredActiveRef.current = false;
    setOutgoingConversationId(conversationId);
  }, []);

  const activeConversationId =
    outgoingConversationId ?? restoredConversationId ?? pending?.conversation_id ?? null;

  const incomingInvite = useMemo<GroupCallInvite | null>(() => {
    if (!pending) return null;

    return {
      callId: pending.call_id,
      from: pending.caller_id,
      conversationId: pending.conversation_id,
      media: pending.media,
      callerName: pending.caller_name,
      callerAvatar: pending.caller_avatar,
    };
  }, [pending]);

  const members = useMemo<GroupCallMember[]>(() => {
    if (!pending) return [];
    return pending.members.map((member) => ({
      user_id: member.user_id,
      profile: {
        id: member.user_id,
        full_text_name: member.full_text_name ?? null,
        username: member.username ?? null,
        avatar_url: member.avatar_url ?? null,
      },
    }));
  }, [pending]);

  const closeOverlay = useCallback(() => {
    setOutgoingConversationId(null);
    setRestoredConversationId(null);
    void loadPending();
  }, [loadPending]);

  const enabled = Boolean(myId && activeConversationId);

  return (
    <GroupCallContext.Provider
      value={{
        startGroupCall,
        activeConversationId,
      }}
    >
      {children}

      {enabled && activeConversationId && myId && (
        <GroupCallOverlay
          conversationId={activeConversationId}
          myId={myId}
          members={members}
          enabled
          // Only an explicit Start button sets outgoingConversationId.
          // Restored calls must mount without calling startCall().
          startWhenOpened={Boolean(outgoingConversationId)}
          initialIncoming={
            pending?.conversation_id === activeConversationId
              ? incomingInvite
              : null
          }
          onClose={closeOverlay}
        />
      )}
    </GroupCallContext.Provider>
  );
}

export function useGroupCall() {
  const value = useContext(GroupCallContext);
  if (!value) {
    throw new Error('useGroupCall must be used inside GroupCallProvider');
  }
  return value;
}
