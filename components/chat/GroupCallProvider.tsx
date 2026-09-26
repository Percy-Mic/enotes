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
  joinExistingGroupCall: (conversationId: string, callId: string, hostId: string) => void;
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
  const [resumeCall, setResumeCall] = useState<{ conversationId: string; callId: string; hostId: string } | null>(null);
  const loadInFlightRef = useRef(false);

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
      // This lookup is intentionally invitation-only. It never restores,
      // joins, creates, or reopens an existing call.
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
    setResumeCall(null);
    setOutgoingConversationId(conversationId);
  }, []);

  const joinExistingGroupCall = useCallback((conversationId: string, callId: string, hostId: string) => {
    setPending(null);
    setOutgoingConversationId(null);
    setResumeCall({ conversationId, callId, hostId });
  }, []);

  // An overlay is opened automatically only to show an incoming invitation.
  // It can never use that invitation to start or join the call without the
  // recipient explicitly pressing "Join call".
  const activeConversationId =
    outgoingConversationId ?? resumeCall?.conversationId ?? pending?.conversation_id ?? null;

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

  const acceptGroupCall = useCallback((conversationId: string) => {
    // Once the recipient accepts, the invitation is no longer pending, but
    // the call itself must remain mounted. Keep the conversation as the
    // active call context until the participant explicitly leaves.
    setPending(null);
    setOutgoingConversationId(conversationId);
  }, []);

  const closeOverlay = useCallback(() => {
    setOutgoingConversationId(null);
    setResumeCall(null);
    setPending(null);
  }, []);

  const enabled = Boolean(myId && activeConversationId);

  return (
    <GroupCallContext.Provider
      value={{
        startGroupCall,
        joinExistingGroupCall,
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
          // Start only when the user explicitly clicked the group video
          // button. Incoming invitations never auto-join.
          startWhenOpened={Boolean(outgoingConversationId)}
          resumeCall={resumeCall}
          initialIncoming={
            pending?.conversation_id === activeConversationId
              ? incomingInvite
              : null
          }
          onClose={closeOverlay}
          onAccepted={acceptGroupCall}
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
