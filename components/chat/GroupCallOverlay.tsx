'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Maximize2, Mic, MicOff, Minimize2, PhoneOff, RefreshCw, Video, VideoOff, Volume2, VolumeX, Users, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { ICE_SERVERS } from '@/lib/calls/config';

export interface GroupCallMember {
  user_id: string;
  profile?: {
    id?: string;
    full_text_name?: string | null;
    username?: string | null;
    avatar_url?: string | null;
  } | null;
}

export interface GroupCallInvite {
  callId: string;
  from: string;
  conversationId: string;
  media: 'audio' | 'video';
  callerName: string;
  callerAvatar: string | null;
}

interface GroupCallOverlayProps {
  conversationId: string;
  myId: string | null;
  members: GroupCallMember[];
  enabled: boolean;
  initialIncoming?: GroupCallInvite | null;
  startWhenOpened?: boolean;
  onClose?: () => void;
  onAccepted?: (conversationId: string) => void;
  resumeCall?: { callId: string; hostId: string } | null;
}

type Signal = {
  type: 'invite' | 'accept' | 'offer' | 'answer' | 'ice' | 'leave' | 'end' | 'restart-request';
  callId: string;
  from: string;
  to?: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

function nameFor(member: GroupCallMember | undefined) {
  return member?.profile?.full_text_name || member?.profile?.username || 'Member';
}

function VideoTile({
  stream,
  label,
  muted,
  className = '',
  audioEnabled = true,
}: {
  stream: MediaStream | null;
  label: string;
  muted?: boolean;
  className?: string;
  audioEnabled?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);

  return (
    <div className={`relative overflow-hidden rounded-2xl bg-black/70 ring-1 ring-white/10 ${className}`}>
      <video ref={ref} autoPlay playsInline muted={muted || !audioEnabled} className="h-full w-full object-cover" />
      {!stream && (
        <div className="absolute inset-0 flex items-center justify-center text-3xl text-white/40">●</div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-8 text-xs font-semibold text-white">
        {label}
      </div>
    </div>
  );
}

export default function GroupCallOverlay({
  conversationId,
  myId,
  members,
  enabled,
  startWhenOpened = false,
  initialIncoming = null,
  onClose,
  onAccepted,
  resumeCall = null,
}: GroupCallOverlayProps) {
  const [active, setActive] = useState<{ callId: string; hostId: string } | null>(null);
  const [incoming, setIncoming] = useState<Signal | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [minimized, setMinimized] = useState(false);
  const [speakerEnabled, setSpeakerEnabled] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitingUserId, setInvitingUserId] = useState<string | null>(null);
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>('user');
  const [switchingCamera, setSwitchingCamera] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [callMembers, setCallMembers] = useState<GroupCallMember[]>(members);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const localRef = useRef<MediaStream | null>(null);
  const activeRef = useRef<typeof active>(null);
  const endingRef = useRef(false);
  const startingRef = useRef(false);
  const channelReadyRef = useRef<Promise<void> | null>(null);
  const pendingIceRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const restartingPeersRef = useRef(new Set<string>());
  const autoStartKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setCallMembers(members);
  }, [members]);

  useEffect(() => {
    if (!enabled || !conversationId || callMembers.length > 0) return;

    let cancelled = false;
    void supabase
      .from('conversation_members')
      .select('user_id, profiles!conversation_members_user_id_fkey(id, full_text_name, username, avatar_url)')
      .eq('conversation_id', conversationId)
      .then(({ data, error: memberError }) => {
        if (cancelled || memberError) return;
        const next = ((data || []) as any[]).map((row) => ({
          user_id: row.user_id,
          profile: row.profiles || null,
        })) as GroupCallMember[];
        setCallMembers(next);
      });

    return () => {
      cancelled = true;
    };
  }, [callMembers.length, conversationId, enabled]);

  useEffect(() => {
    if (!initialIncoming) return;
    setIncoming({
      type: 'invite',
      callId: initialIncoming.callId,
      from: initialIncoming.from,
      to: myId ?? undefined,
    });
  }, [initialIncoming, myId]);

  const memberMap = useMemo(
    () => new Map(callMembers.map((member) => [member.user_id, member])),
    [callMembers],
  );

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // Keep the durable host session alive while the browser is actually
  // connected. If the tab crashes/closes, the database stops receiving
  // heartbeats and create_group_call can recover the stale session.
  useEffect(() => {
    if (!active || active.hostId !== myId) return;

    const heartbeat = () => {
      void supabase.rpc('touch_group_call', {
        p_call_id: active.callId,
      });
    };

    heartbeat();
    const timer = window.setInterval(heartbeat, 20_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [active, myId]);

  const send = useCallback(async (payload: Omit<Signal, 'from'>) => {
    if (!myId || !channelRef.current) return;

    if (channelReadyRef.current) {
      try {
        await channelReadyRef.current;
      } catch {
        return;
      }
    }

    const channel = channelRef.current;
    if (!channel) return;

    await channel.send({
      type: 'broadcast',
      event: 'group-call',
      payload: { ...payload, from: myId },
    });
  }, [myId]);

  const closePeer = useCallback((remoteId: string) => {
    const peer = peersRef.current.get(remoteId);
    if (!peer) return;
    peer.onicecandidate = null;
    peer.ontrack = null;
    try { peer.close(); } catch {}
    peersRef.current.delete(remoteId);
    pendingIceRef.current.delete(remoteId);
    setRemoteStreams((current) => {
      if (!current[remoteId]) return current;
      const next = { ...current };
      delete next[remoteId];
      return next;
    });
  }, []);

  const createPeer = useCallback((remoteId: string) => {
    const existing = peersRef.current.get(remoteId);
    if (existing) return existing;

    const peer = new RTCPeerConnection(ICE_SERVERS);
    peersRef.current.set(remoteId, peer);

    const local = localRef.current;
    local?.getTracks().forEach((track) => {
      try { peer.addTrack(track, local); } catch {}
    });

    peer.onicecandidate = (event) => {
      if (event.candidate && activeRef.current) {
        void send({
          type: 'ice',
          callId: activeRef.current.callId,
          to: remoteId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    peer.ontrack = (event) => {
      const stream = event.streams[0];
      if (stream) setRemoteStreams((current) => ({ ...current, [remoteId]: stream }));
    };

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed') {
        const current = activeRef.current;

        if (current && current.hostId === myId && !restartingPeersRef.current.has(remoteId)) {
          restartingPeersRef.current.add(remoteId);

          void (async () => {
            try {
              if (peer.signalingState !== 'stable') return;

              peer.restartIce();
              const offer = await peer.createOffer({ iceRestart: true });
              await peer.setLocalDescription(offer);

              await send({
                type: 'offer',
                callId: current.callId,
                to: remoteId,
                sdp: offer,
              });
            } catch (restartError) {
              console.warn('[enotes group call] ICE restart failed:', restartError);
            } finally {
              restartingPeersRef.current.delete(remoteId);
            }
          })();
        } else if (current && current.hostId !== myId) {
          void send({
            type: 'restart-request',
            callId: current.callId,
            to: current.hostId,
          });
        }
      }

      if (peer.connectionState === 'closed') {
        closePeer(remoteId);
      }
    };

    return peer;
  }, [closePeer, myId, send]);

  const stopLocal = useCallback(() => {
    localRef.current?.getTracks().forEach((track) => {
      try { track.stop(); } catch {}
    });
    localRef.current = null;
    setLocalStream(null);
  }, []);

  const cleanup = useCallback((broadcastEnd = false) => {
    if (broadcastEnd && activeRef.current && myId) {
      void send({
        type: 'end',
        callId: activeRef.current.callId,
      });
    }

    peersRef.current.forEach((peer) => {
      try { peer.close(); } catch {}
    });
    peersRef.current.clear();
    pendingIceRef.current.clear();
    stopLocal();
    setRemoteStreams({});
    setActive(null);
    setIncoming(null);
    setError(null);
    endingRef.current = false;
  }, [myId, send, stopLocal]);

  const getMedia = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera and microphone access is not available in this browser.');
    }

    let stream: MediaStream;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: {
          facingMode: { ideal: 'user' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
      });
    } catch {
      // Some mobile browsers reject the preferred resolution even though the
      // camera itself is available. Retry with a minimal camera constraint.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: { facingMode: 'user' },
      });
    }

    localRef.current = stream;
    setLocalStream(stream);
    setMicEnabled(stream.getAudioTracks().some((track) => track.enabled));
    setCameraEnabled(stream.getVideoTracks().some((track) => track.enabled));
    const facing = stream.getVideoTracks()[0]?.getSettings().facingMode;
    if (facing === 'environment' || facing === 'user') setCameraFacing(facing);
    return stream;
  }, []);

  const startCall = useCallback(async () => {
    if (!myId || activeRef.current || startingRef.current) return;

    startingRef.current = true;

    try {
      setError(null);

      let membersForCall = callMembers;

      // On the first render of an outgoing call, the provider may not have
      // loaded the group members yet. Fetch them here before deciding that
      // there is nobody to call. This prevents the video button from opening
      // a "no other members" state simply because the async member query has
      // not finished.
      if (membersForCall.length === 0) {
        const { data: memberRows, error: memberError } = await supabase
          .from('conversation_members')
          .select(
            'user_id, profiles!conversation_members_user_id_fkey(id, full_text_name, username, avatar_url)',
          )
          .eq('conversation_id', conversationId);

        if (memberError) throw memberError;

        membersForCall = ((memberRows || []) as any[]).map((row) => ({
          user_id: row.user_id,
          profile: row.profiles || null,
        })) as GroupCallMember[];

        setCallMembers(membersForCall);
      }

      const targets = membersForCall.filter((member) => member.user_id !== myId);

      if (targets.length === 0) {
        setError('This group has no other members to call.');
        return;
      }

      await getMedia();

      let { data: callId, error: createError } = await supabase.rpc('create_group_call', {
        p_conversation_id: conversationId,
        p_media: 'video',
      });

      /*
       * A browser can disappear without running cleanup (mobile OS
       * suspension, tab crash, force-close). In that case the durable
       * calls row can survive even though there is no live WebRTC session.
       *
       * Recover only calls older than 90 seconds, then retry once. A
       * genuinely active call remains protected and still reports the
       * original error.
       */
      if (createError?.code === 'P0001' || createError?.code === 'PT409') {
        /*
         * The durable call may still be genuinely active while this page was
         * refreshed/navigated away from the overlay. Reattach to that call
         * before attempting stale-session recovery.
         */
        const { data: existingRows, error: existingError } = await supabase.rpc(
          'get_my_active_group_call',
          { p_conversation_id: conversationId },
        );

        const existing = Array.isArray(existingRows) ? existingRows[0] : existingRows;

        if (!existingError && existing?.call_id) {
          const activeCall = {
            callId: String(existing.call_id),
            hostId: String(existing.host_id || myId),
          };

          setActive(activeCall);
          activeRef.current = activeCall;
          setError(null);

          await send({ type: 'invite', callId: activeCall.callId });
          return;
        }

        /*
         * If there is no reconnectable call in this conversation, recover a
         * host session that has been abandoned for more than 90 seconds and
         * retry creating the call once.
         */
        const { data: recovered, error: recoveryError } = await supabase.rpc(
          'recover_stale_group_call',
          { p_conversation_id: conversationId },
        );

        if (!recoveryError && recovered === true) {
          ({ data: callId, error: createError } = await supabase.rpc('create_group_call', {
            p_conversation_id: conversationId,
            p_media: 'video',
          }));
        }
      }

      if (createError || !callId) {
        if (createError) {
          console.error('[enotes group call] create_group_call failed', {
            code: createError.code,
            message: createError.message,
            details: createError.details,
            hint: createError.hint,
          });
        }
        const diagnostic = createError
          ? [createError.message, createError.hint, createError.details]
              .filter(Boolean)
              .join(' — ')
          : 'The database did not return a call id.';
        throw new Error(diagnostic || 'Could not create the group video call.');
      }

      const activeCall = { callId: String(callId), hostId: myId };
      setActive(activeCall);
      activeRef.current = activeCall;

      if (channelReadyRef.current) {
        await channelReadyRef.current;
      }

      await send({ type: 'invite', callId: String(callId) });

      const { error: messageError } = await supabase.from('messages').insert({
        conversation_id: conversationId,
        sender_id: myId,
        content: JSON.stringify({
          callId: String(callId),
          conversationId,
          hostId: myId,
          title: 'Group video call',
        }),
        message_type: 'call_invite',
      });
      if (messageError) {
        console.warn('[enotes group call] could not post call card:', messageError.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the group video call.');
    } finally {
      startingRef.current = false;
    }
  }, [callMembers, conversationId, getMedia, myId, send]);

  const joinExistingCall = useCallback(async () => {
    if (!resumeCall || !myId || startingRef.current || activeRef.current) return;

    startingRef.current = true;
    try {
      setError(null);
      await getMedia();

      const { error: responseError } = await supabase.rpc('respond_group_call', {
        p_call_id: resumeCall.callId,
        p_action: 'join',
      });
      if (responseError) throw responseError;

      const nextActive = { callId: resumeCall.callId, hostId: resumeCall.hostId };
      setActive(nextActive);
      activeRef.current = nextActive;

      if (channelReadyRef.current) await channelReadyRef.current;
      await send({ type: 'accept', callId: resumeCall.callId, to: resumeCall.hostId });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not return to the group video call.');
    } finally {
      startingRef.current = false;
    }
  }, [getMedia, myId, resumeCall, send]);

  useEffect(() => {
    if (!resumeCall || activeRef.current) return;
    void joinExistingCall();
  }, [joinExistingCall, resumeCall]);

  const acceptIncoming = useCallback(async () => {
    const call = incoming;
    if (!call || !myId || startingRef.current) return;

    startingRef.current = true;

    try {
      setError(null);
      await getMedia();

      const { error: responseError } = await supabase.rpc('respond_group_call', {
        p_call_id: call.callId,
        p_action: 'join',
      });

      if (responseError) throw responseError;

      setActive({ callId: call.callId, hostId: call.from });
      activeRef.current = { callId: call.callId, hostId: call.from };
      setIncoming(null);
      onAccepted?.(conversationId);

      if (channelReadyRef.current) {
        await channelReadyRef.current;
      }

      await send({ type: 'accept', callId: call.callId, to: call.from });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join the group video call.');
    } finally {
      startingRef.current = false;
    }
  }, [conversationId, getMedia, incoming, myId, onAccepted, send]);

  const declineIncoming = useCallback(async () => {
    if (!incoming) return;

    try {
      await supabase.rpc('respond_group_call', {
        p_call_id: incoming.callId,
        p_action: 'decline',
      });
    } catch {}

    await send({ type: 'leave', callId: incoming.callId, to: incoming.from });
    setIncoming(null);
  }, [incoming, send]);

  const makeOffer = useCallback(async (remoteId: string, callId: string) => {
    const peer = createPeer(remoteId);
    const offer = await peer.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await peer.setLocalDescription(offer);
    await send({ type: 'offer', callId, to: remoteId, sdp: offer });
  }, [createPeer, send]);

  useEffect(() => {
    if (!enabled || !conversationId || !myId) return;

    const channel = supabase.channel(`group-call-${conversationId}`, {
      config: {
        private: true,
        broadcast: {
          self: false,
          ack: true,
        },
      },
    });
    channel
      .on('broadcast', { event: 'group-call' }, async ({ payload }) => {
        const signal = payload as Signal;
        if (!signal || signal.from === myId || (signal.to && signal.to !== myId)) return;

        try {
          if (signal.type === 'invite') {
            if (!activeRef.current && !incoming) setIncoming(signal);
            return;
          }

          if (signal.type === 'accept') {
            if (!activeRef.current || activeRef.current.hostId !== myId) return;
            await makeOffer(signal.from, signal.callId);
            return;
          }

          if (signal.type === 'offer') {
            if (!activeRef.current || activeRef.current.callId !== signal.callId || !signal.sdp) return;
            const peer = createPeer(signal.from);
            await peer.setRemoteDescription(signal.sdp);

            // ICE candidates can arrive before the SDP offer. Flush any
            // candidates that were queued while the peer had no remote
            // description yet.
            const queued = pendingIceRef.current.get(signal.from) || [];
            pendingIceRef.current.delete(signal.from);
            for (const candidate of queued) {
              try {
                await peer.addIceCandidate(candidate);
              } catch {}
            }

            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            await send({ type: 'answer', callId: signal.callId, to: signal.from, sdp: answer });
            return;
          }

          if (signal.type === 'answer') {
            const peer = peersRef.current.get(signal.from);
            if (peer && signal.sdp && !peer.currentRemoteDescription) {
              await peer.setRemoteDescription(signal.sdp);
            }
            return;
          }

          if (signal.type === 'restart-request') {
            if (activeRef.current?.hostId !== myId) return;

            const peer = peersRef.current.get(signal.from);
            const current = activeRef.current;
            if (!peer || !current || peer.signalingState !== 'stable') return;
            if (restartingPeersRef.current.has(signal.from)) return;

            restartingPeersRef.current.add(signal.from);
            try {
              peer.restartIce();
              const offer = await peer.createOffer({ iceRestart: true });
              await peer.setLocalDescription(offer);
              await send({
                type: 'offer',
                callId: current.callId,
                to: signal.from,
                sdp: offer,
              });
            } catch (restartError) {
              console.warn('[enotes group call] requested ICE restart failed:', restartError);
            } finally {
              restartingPeersRef.current.delete(signal.from);
            }
            return;
          }

          if (signal.type === 'ice') {
            if (!activeRef.current || activeRef.current.callId !== signal.callId || !signal.candidate) return;

            const peer = peersRef.current.get(signal.from);
            if (!peer) {
              const queued = pendingIceRef.current.get(signal.from) || [];
              queued.push(signal.candidate);
              pendingIceRef.current.set(signal.from, queued);
              return;
            }

            if (!peer.remoteDescription) {
              const queued = pendingIceRef.current.get(signal.from) || [];
              queued.push(signal.candidate);
              pendingIceRef.current.set(signal.from, queued);
              return;
            }

            try {
              await peer.addIceCandidate(signal.candidate);
            } catch {}
            return;
          }

          if (signal.type === 'leave') {
            closePeer(signal.from);
            return;
          }

          if (signal.type === 'end') {
            cleanup(false);
          }
        } catch (e) {
          console.warn('[enotes group call] signaling error', e);
        }
      });

    channelRef.current = channel;

    // Subscribe exactly once. The previous implementation called
    // channel.subscribe() twice, which can leave Realtime in a race where
    // send() falls back to REST and signaling messages are not delivered
    // through the intended Broadcast channel.
    channelReadyRef.current = new Promise<void>((resolve, reject) => {
      let settled = false;

      channel.subscribe((status, subscribeError) => {
        if (status === 'SUBSCRIBED') {
          if (!settled) {
            settled = true;
            resolve();
          }
          return;
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          if (!settled) {
            settled = true;
            reject(
              subscribeError instanceof Error
                ? subscribeError
                : new Error('The group call signaling channel could not be opened.'),
            );
          }
        }
      });
    });

    return () => {
      const current = activeRef.current;

      if (current && !endingRef.current) {
        endingRef.current = true;

        if (current.hostId === myId) {
          void supabase.rpc('end_group_call', {
            p_call_id: current.callId,
          });
          void send({ type: 'end', callId: current.callId });
        } else {
          void supabase.rpc('respond_group_call', {
            p_call_id: current.callId,
            p_action: 'leave',
          });
          void send({ type: 'leave', callId: current.callId });
        }
      }

      supabase.removeChannel(channel);
      channelRef.current = null;
      channelReadyRef.current = null;
      cleanup(false);
    };
  }, [cleanup, closePeer, conversationId, createPeer, enabled, makeOffer, myId, send]);

  const leave = useCallback(() => {
    if (!activeRef.current) {
      onClose?.();
      return;
    }
    endingRef.current = true;

    const current = activeRef.current;
    if (current.hostId === myId) {
      void supabase.rpc('end_group_call', { p_call_id: current.callId });
      void send({ type: 'end', callId: current.callId });
    } else {
      void supabase.rpc('respond_group_call', {
        p_call_id: current.callId,
        p_action: 'leave',
      });
      void send({ type: 'leave', callId: current.callId });
    }

    cleanup(false);
    onClose?.();
  }, [cleanup, onClose, send]);

  useEffect(() => {
    if (!startWhenOpened) {
      autoStartKeyRef.current = null;
      return;
    }

    if (!enabled || !myId || activeRef.current) return;

    // The provider can re-render while the member list and Realtime channel
    // are loading. Start exactly once for this explicit Video Call action;
    // never create a second database call just because state changed.
    const key = `${conversationId}:outgoing`;
    if (autoStartKeyRef.current === key) return;
    autoStartKeyRef.current = key;

    void startCall();
  }, [conversationId, enabled, myId, startCall, startWhenOpened]);

  const toggleMic = () => {
    const next = !micEnabled;
    localRef.current?.getAudioTracks().forEach((track) => { track.enabled = next; });
    setMicEnabled(next);
  };

  const toggleCamera = () => {
    const next = !cameraEnabled;
    localRef.current?.getVideoTracks().forEach((track) => { track.enabled = next; });
    setCameraEnabled(next);
  };

  const switchCamera = useCallback(async () => {
    if (switchingCamera || !localRef.current) return;

    const currentVideoTrack = localRef.current.getVideoTracks()[0];
    if (!currentVideoTrack) {
      setError('No camera track is available to switch.');
      return;
    }

    const nextFacing: 'user' | 'environment' =
      cameraFacing === 'user' ? 'environment' : 'user';

    setSwitchingCamera(true);
    setError(null);

    try {
      let cameraStream: MediaStream;

      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { exact: nextFacing },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 },
          },
        });
      } catch {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: nextFacing,
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 },
          },
        });
      }

      const nextVideoTrack = cameraStream.getVideoTracks()[0];
      if (!nextVideoTrack) {
        cameraStream.getTracks().forEach((track) => track.stop());
        throw new Error('The selected camera could not be opened.');
      }

      nextVideoTrack.enabled = cameraEnabled;

      for (const peer of Array.from(peersRef.current.values())) {
        const sender = peer.getSenders().find(
          (item) => item.track?.kind === 'video',
        );

        if (sender) {
          await sender.replaceTrack(nextVideoTrack);
        } else {
          peer.addTrack(nextVideoTrack, localRef.current);
        }
      }

      const audioTracks = localRef.current.getAudioTracks();
      const nextLocalStream = new MediaStream([
        ...audioTracks,
        nextVideoTrack,
      ]);

      localRef.current = nextLocalStream;
      setLocalStream(nextLocalStream);

      try { currentVideoTrack.stop(); } catch {}

      const actualFacing = nextVideoTrack.getSettings().facingMode;
      setCameraFacing(
        actualFacing === 'environment' || actualFacing === 'user'
          ? actualFacing
          : nextFacing,
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not switch to the other camera.',
      );
    } finally {
      setSwitchingCamera(false);
    }
  }, [cameraEnabled, cameraFacing, switchingCamera]);

  if (!enabled || !myId) return null;

  const remoteEntries = Object.entries(remoteStreams);
  const inviteableMembers = callMembers.filter((member) => member.user_id !== myId);

  const inviteMember = useCallback(async (userId: string) => {
    if (!activeRef.current || !myId || activeRef.current.hostId !== myId || invitingUserId) return;

    setInvitingUserId(userId);
    setError(null);

    try {
      const { error: inviteError } = await supabase.rpc('invite_group_call_participant', {
        p_call_id: activeRef.current.callId,
        p_user_id: userId,
      });

      if (inviteError) throw inviteError;

      if (channelReadyRef.current) await channelReadyRef.current;

      await send({
        type: 'invite',
        callId: activeRef.current.callId,
        to: userId,
      });

      setInviteOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not invite that member.');
    } finally {
      setInvitingUserId(null);
    }
  }, [invitingUserId, myId, send]);


  return (
    <>
      {incoming && !active && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl bg-[#17231d] p-6 text-white shadow-2xl ring-1 ring-white/10">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#3F6238]">
              <Video className="h-7 w-7" />
            </div>
            <h2 className="mt-4 text-center text-xl font-bold">
              {nameFor(memberMap.get(incoming.from))} started a group video call
            </h2>
            <p className="mt-1 text-center text-sm text-white/60">Join the conversation live.</p>
            {error && <p className="mt-3 rounded-xl bg-red-500/15 p-2 text-xs text-red-200">{error}</p>}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button onClick={() => void declineIncoming()} className="rounded-2xl border border-white/15 px-4 py-3 font-semibold">
                Decline
              </button>
              <button onClick={() => void acceptIncoming()} className="rounded-2xl bg-[#3F6238] px-4 py-3 font-semibold">
                Join call
              </button>
            </div>
          </div>
        </div>
      )}

      {active && inviteOpen && (
        <div className="fixed inset-0 z-[250] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="w-full max-h-[75vh] overflow-hidden rounded-t-3xl bg-[#17231d] text-white shadow-2xl ring-1 ring-white/10 sm:max-w-md sm:rounded-3xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-4">
              <div>
                <p className="font-bold">Invite to this call</p>
                <p className="text-xs text-white/50">Re-invite someone without creating another call.</p>
              </div>
              <button onClick={() => setInviteOpen(false)} className="rounded-full p-2 hover:bg-white/10" aria-label="Close invite list">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[calc(75vh-82px)] overflow-y-auto p-3">
              {inviteableMembers.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-white/50">There are no other group members to invite.</p>
              ) : (
                <div className="space-y-1">
                  {inviteableMembers.map((member) => {
                    const isConnected = Boolean(remoteStreams[member.user_id]);
                    const busy = invitingUserId === member.user_id;
                    return (
                      <button
                        key={member.user_id}
                        onClick={() => void inviteMember(member.user_id)}
                        disabled={busy || isConnected}
                        className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left hover:bg-white/10 disabled:cursor-default disabled:opacity-50"
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10">
                          {member.profile?.avatar_url ? (
                            <img src={member.profile.avatar_url} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <span className="text-sm font-bold">{nameFor(member).slice(0, 1).toUpperCase()}</span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{nameFor(member)}</p>
                          <p className="text-xs text-white/45">{isConnected ? 'Already connected' : busy ? 'Sending invitation…' : 'Invite to call'}</p>
                        </div>
                        {!isConnected && <Users className="h-5 w-5 shrink-0 text-white/50" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {active && minimized && (
        <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-3 z-[230] w-[calc(100vw-1.5rem)] max-w-[380px] overflow-hidden rounded-2xl bg-[#17231d] text-white shadow-2xl ring-1 ring-white/10">
          <div className="flex items-center gap-3 p-3">
            <div className="h-14 w-20 shrink-0 overflow-hidden rounded-xl bg-black sm:h-16 sm:w-24">
              <VideoTile stream={localStream} muted label="You" className="h-full w-full rounded-xl ring-0" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">Group video call</p>
              <p className="text-[11px] text-white/50">{remoteEntries.length + 1} connected</p>
            </div>
            <button onClick={() => setSpeakerEnabled((value) => !value)} className="rounded-full p-2 text-white/80 hover:bg-white/10" aria-label={speakerEnabled ? 'Mute call audio' : 'Unmute call audio'} title={speakerEnabled ? 'Mute call audio' : 'Unmute call audio'}>
              {speakerEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
            </button>
            <button onClick={() => setMinimized(false)} className="rounded-full p-2 text-white/80 hover:bg-white/10" aria-label="Return to call" title="Return to call">
              <Maximize2 className="h-5 w-5" />
            </button>
            <button onClick={leave} className="rounded-full p-2 text-red-300 hover:bg-red-500/15" aria-label="Leave call" title="Leave call">
              <PhoneOff className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {active && !minimized && (
        <div className="fixed inset-0 z-[210] flex flex-col bg-[#07110d] text-white">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-3 py-3 sm:px-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">Group video call</p>
              <p className="text-[11px] text-white/50">{remoteEntries.length + 1} connected</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {active.hostId === myId && (
                <button
                  onClick={() => setInviteOpen(true)}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/15 sm:w-auto sm:gap-2 sm:px-3"
                  aria-label="Invite someone"
                  title="Invite someone"
                >
                  <Users className="h-5 w-5" />
                  <span className="hidden text-sm font-semibold sm:inline">Invite</span>
                </button>
              )}
              <button
                onClick={() => setMinimized(true)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/15"
                aria-label="Minimize call"
                title="Minimize call"
              >
                <Minimize2 className="h-5 w-5" />
              </button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-auto p-3">
            <div className={`grid min-h-full gap-2 ${remoteEntries.length + 1 === 1 ? 'grid-cols-1' : remoteEntries.length + 1 <= 4 ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-3'}`}>
              <VideoTile stream={localStream} muted label="You" className="aspect-video" />
              {remoteEntries.map(([userId, stream]) => (
                <VideoTile
                  key={userId}
                  stream={stream}
                  label={nameFor(memberMap.get(userId))}
                  audioEnabled={speakerEnabled}
                  className="aspect-video"
                />
              ))}
            </div>
          </div>

          {error && <p className="mx-auto max-w-lg px-4 pb-2 text-center text-xs text-red-300">{error}</p>}

          <footer className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-t border-white/10 bg-black/20 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:gap-3 sm:px-4 sm:py-4">            {active.hostId === myId && (
              <button
                onClick={() => setInviteOpen(true)}
                className="flex h-12 min-w-12 items-center justify-center gap-2 rounded-full bg-white/10 px-3 text-white/90"
                aria-label="Invite someone to the call"
                title="Invite someone to the call"
              >
                <Users className="h-5 w-5" />
                <span className="hidden text-xs font-semibold min-[380px]:inline">Invite</span>
              </button>
            )}

            <button onClick={toggleMic} className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10" aria-label={micEnabled ? 'Mute microphone' : 'Unmute microphone'}>
              {micEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
            </button>
            <button onClick={toggleCamera} className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10" aria-label={cameraEnabled ? 'Turn camera off' : 'Turn camera on'}>
              {cameraEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
            </button>
            <button
              onClick={() => setSpeakerEnabled((value) => !value)}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10"
              aria-label={speakerEnabled ? 'Mute call audio' : 'Unmute call audio'}
              title={speakerEnabled ? 'Mute call audio' : 'Unmute call audio'}
            >
              {speakerEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
            </button>
            <button
              onClick={() => void switchCamera()}
              disabled={switchingCamera}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 disabled:cursor-wait disabled:opacity-50"
              aria-label={switchingCamera ? 'Switching camera' : 'Switch camera'}
              title={switchingCamera ? 'Switching camera…' : 'Switch camera'}
            >
              {switchingCamera ? (
                <RefreshCw className="h-5 w-5 animate-spin" />
              ) : (
                <Camera className="h-5 w-5" />
              )}
            </button>
            <button onClick={leave} className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600" aria-label="Leave call">
              <PhoneOff className="h-6 w-6" />
            </button>
          </footer>
        </div>
      )}
    </>
  );
}
