'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { CallStatus } from '@/types/social';

/* ============================================================
   Video/audio calling over WebRTC with Supabase Realtime as the
   signaling transport (broadcast channels per call). No paid
   service needed for 1:1 calls — media flows directly between
   peers; Supabase only relays SDP/ICE (free tier).

   SIGNALING STATE MACHINE (the part that fixes the crashes):

   The old implementation fed every broadcast answer into
   setRemoteDescription() unconditionally — a duplicate or stale
   answer arriving while the peer connection was back in `stable`
   threw the documented InvalidStateError ("Called in wrong
   state: stable") and could kill a working call. The rules now
   enforced here:

   • an ANSWER is only applied while signalingState === 'have-local-offer'
     (i.e. this side created an offer and is waiting for it);
     duplicates/stale answers are dropped, never applied blindly.
   • an OFFER is only applied while there is no peer connection yet or
     it is 'stable'; a fresh offer otherwise closes the old connection
     and starts clean (caller renegotiated from scratch).
   • ICE candidates that arrive before the remote description are
     QUEUED and flushed after setRemoteDescription — never dropped.
   • every setRemoteDescription/setLocalDescription is guarded, so a
     race degrades to a logged warning instead of an exception.

   Limitations (by design, free-tier friendly):
   - 1:1 calls only. Group calls need a TURN-heavy SFU (LiveKit Cloud,
     Daily, 100ms — all paid beyond small free tiers) or self-hosted
     LiveKit. The UI for group calls is intentionally not faked.
   - Public STUN usually connects peers on ordinary home/mobile
     networks. Symmetric-NAT corporate networks need TURN: configure
     NEXT_PUBLIC_TURN_URL/USERNAME/CREDENTIAL (e.g. metered.ca free
     tier, 50 GB/mo) — without it those specific networks fail with
     "Connection failed", which is reported honestly in the UI.
   ============================================================ */

export interface ActiveCall {
  callId: string;
  conversationId: string | null;
  peerId: string;
  peerName: string;
  peerAvatar?: string | null;
  media: 'video' | 'audio';
  direction: 'outgoing' | 'incoming';
}

interface CallContextValue {
  call: ActiveCall | null;
  status: CallStatus | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  micEnabled: boolean;
  cameraEnabled: boolean;
  facingMode: 'user' | 'environment';
  error: string | null;
  startCall: (peerId: string, peerName: string, peerAvatar: string | null, conversationId: string | null, media: 'video' | 'audio') => Promise<void>;
  acceptCall: () => Promise<void>;
  declineCall: () => Promise<void>;
  endCall: () => void;
  toggleMic: () => void;
  toggleCamera: () => void;
  switchCamera: () => Promise<void>;
}

const CallContext = createContext<CallContextValue | null>(null);

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall must be used inside <CallProvider>');
  return ctx;
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  ...(process.env.NEXT_PUBLIC_TURN_URL
    ? [{
        urls: process.env.NEXT_PUBLIC_TURN_URL,
        username: process.env.NEXT_PUBLIC_TURN_USERNAME,
        credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
      }]
    : []),
];

const RING_TIMEOUT = 45_000; // unanswered after 45s → missed

/** Signaling-tolerant setRemoteDescription: enforces the expected state. */
async function safeSetRemote(
  pc: RTCPeerConnection,
  desc: RTCSessionDescriptionInit,
  kind: 'offer' | 'answer'
): Promise<boolean> {
  const expected = kind === 'offer' ? ['stable', 'have-local-offer'] : ['have-local-offer'];
  if (!expected.includes(pc.signalingState)) {
    // Stale/duplicate signaling message — the state machine decides, not luck.
    if (process.env.NODE_ENV !== 'production') {
      console.info(`[call] ignored stale ${kind} in state ${pc.signalingState}`);
    }
    return false;
  }
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(desc));
    return true;
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[call] setRemoteDescription(${kind}) failed`, err);
    }
    return false;
  }
}

export function CallProvider({ children, myId }: { children: React.ReactNode; myId: string | null }) {
  const [call, setCall] = useState<ActiveCall | null>(null);
  const [status, setStatus] = useState<CallStatus | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [error, setError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const ringTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** ICE candidates that arrived before the remote description existed. */
  const iceQueue = useRef<RTCIceCandidateInit[]>([]);
  const remoteUserRef = useRef<{ id: string; name: string; avatar: string | null } | null>(null);

  const flushIce = useCallback(async (pc: RTCPeerConnection) => {
    const queued = iceQueue.current;
    iceQueue.current = [];
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        /* a candidate may still be unapplyable after a renegotiation — harmless */
      }
    }
  }, []);

  /* ---------- channel plumbing ---------- */

  const teardown = useCallback(() => {
    if (ringTimer.current) clearTimeout(ringTimer.current);
    ringTimer.current = null;
    iceQueue.current = [];
    pcRef.current?.close();
    pcRef.current = null;
    localStream?.getTracks().forEach((t) => t.stop());
    setLocalStream(null);
    setRemoteStream(null);
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    channelRef.current = null;
  }, [localStream]);

  const finishCall = useCallback(
    async (finalStatus: CallStatus) => {
      const current = call;
      setStatus(finalStatus);
      teardown();
      setCall(null);

      /* persist final state (missed/declined show in history) */
      if (current) {
        await supabase
          .from('calls')
          .update({ status: finalStatus, ended_at: new Date().toISOString() })
          .eq('id', current.callId);
        if (finalStatus === 'missed') {
          await supabase.from('notifications').insert({
            user_id: current.direction === 'outgoing' ? current.peerId : myId,
            actor_id: current.direction === 'outgoing' ? myId : current.peerId,
            type: 'call_missed',
            entity_type: 'call',
            entity_id: current.callId,
            message: `Missed ${current.media} call`,
          });
        }
      }
      setTimeout(() => setStatus(null), 1200);
    },
    [call, myId, teardown]
  );

  const createPeer = useCallback((channel: ReturnType<typeof supabase.channel>, initiator: boolean) => {
    /* replace (never stack) an existing connection on renegotiation */
    if (pcRef.current) {
      try { pcRef.current.close(); } catch { /* already closed */ }
    }
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    localStream?.getTracks().forEach((track) => pc.addTrack(track, localStream));

    pc.ontrack = (event) => {
      setRemoteStream(event.streams[0] || null);
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        channel.send({
          type: 'broadcast',
          event: 'ice',
          payload: { from: myId, candidate: event.candidate.toJSON() },
        });
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setStatus('connected');
      if (pc.connectionState === 'disconnected') setStatus('reconnecting' as CallStatus);
      if (pc.connectionState === 'failed') {
        setError('Connection failed — check your network.' + (process.env.NEXT_PUBLIC_TURN_URL ? '' : ' (Some strict networks need a TURN server.)'));
        finishCall('failed');
      }
    };

    pcRef.current = pc;
    void initiator;
    return pc;
  }, [localStream, myId, finishCall]);

  const openChannel = useCallback(
    (callId: string, initiator: boolean) => {
      const channel = supabase.channel(`call:${callId}`, { config: { broadcast: { self: false } } });

      channel
        .on('broadcast', { event: 'offer' }, async ({ payload }) => {
          if (payload.from === myId) return;
          try {
            let pc = pcRef.current;
            /* Offer in 'have-remote-offer' = duplicate broadcast — drop.
               Offer while we hold a local offer (rare glare) = as callee we
               always yield: close and rebuild from the caller's offer. */
            if (pc && pc.signalingState === 'have-remote-offer') return;
            if (pc) {
              const fresh = createPeer(channel, false);
              pc = fresh;
            } else {
              pc = createPeer(channel, false);
            }
            const applied = await safeSetRemote(pc, payload.offer, 'offer');
            if (!applied) return;
            await flushIce(pc);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            channel.send({ type: 'broadcast', event: 'answer', payload: { from: myId, answer: { type: answer.type, sdp: answer.sdp } } });
            setStatus('connecting');
          } catch (err) {
            if (process.env.NODE_ENV !== 'production') console.warn('[call] offer handling failed', err);
            setError('Could not answer the call — the connection was interrupted.');
          }
        })
        .on('broadcast', { event: 'answer' }, async ({ payload }) => {
          if (payload.from === myId) return;
          const pc = pcRef.current;
          if (!pc) return; /* answer before our offer exists — impossible; ignore */
          /* THE FIX: only accept an answer while waiting for one. A second
             answer (replayed/stale broadcast) previously hit
             setRemoteDescription in 'stable' → InvalidStateError. */
          const applied = await safeSetRemote(pc, payload.answer, 'answer');
          if (!applied) return;
          await flushIce(pc);
          setStatus('connecting');
        })
        .on('broadcast', { event: 'ice' }, async ({ payload }) => {
          if (payload.from === myId) return;
          const pc = pcRef.current;
          if (!pc || !pc.remoteDescription) {
            /* candidate raced ahead of the SDP — queue, never drop */
            iceQueue.current.push(payload.candidate as RTCIceCandidateInit);
            return;
          }
          try {
            await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
          } catch {
            /* stale candidate after renegotiation — harmless */
          }
        })
        .on('broadcast', { event: 'accept' }, async ({ payload }) => {
          if (payload.from === myId || !initiator) return;
          try {
            const pc = createPeer(channel, true);
            setStatus('connecting');
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            channel.send({ type: 'broadcast', event: 'offer', payload: { from: myId, offer: { type: offer.type, sdp: offer.sdp } } });
          } catch (err) {
            if (process.env.NODE_ENV !== 'production') console.warn('[call] could not create offer', err);
            setError('Could not start the call connection.');
            finishCall('failed');
          }
        })
        .on('broadcast', { event: 'decline' }, async ({ payload }) => {
          if (payload.from === myId) return;
          finishCall('declined');
        })
        .on('broadcast', { event: 'bye' }, async ({ payload }) => {
          if (payload.from === myId) return;
          finishCall('ended');
        })
        .subscribe((sendStatus) => {
          if (sendStatus === 'SUBSCRIBED' && initiator) {
            /* tell the callee we're live so their ring UI shows */
            channel.send({ type: 'broadcast', event: 'ring', payload: { from: myId } });
          }
          if (sendStatus === 'CHANNEL_ERROR' || sendStatus === 'TIMED_OUT') {
            setError('Call signaling connection lost.');
            finishCall('failed');
          }
        });

      channelRef.current = channel;
      return channel;
    },
    [myId, createPeer, finishCall, flushIce]
  );

  const getMedia = useCallback(async (media: 'video' | 'audio', facing: 'user' | 'environment' = 'user') => {
    const constraints: MediaStreamConstraints = {
      audio: { echoCancellation: true, noiseSuppression: true },
      video: media === 'video' ? { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    setLocalStream(stream);
    setMicEnabled(true);
    setCameraEnabled(media === 'video');
    return stream;
  }, []);

  /* ---------- public API ---------- */

  const startCall = useCallback(
    async (peerId: string, peerName: string, peerAvatar: string | null, conversationId: string | null, media: 'video' | 'audio') => {
      if (!myId || call) return;
      setError(null);
      try {
        const stream = await getMedia(media);
        remoteUserRef.current = { id: peerId, name: peerName, avatar: peerAvatar };

        const { data: row, error: insertError } = await supabase
          .from('calls')
          .insert({ conversation_id: conversationId, caller_id: myId, callee_id: peerId, media, status: 'ringing' })
          .select('id')
          .maybeSingle();
        if (insertError || !row) throw insertError || new Error('Could not register the call.');

        const callId = (row as { id: string }).id;
        setCall({ callId, conversationId, peerId, peerName, peerAvatar, media, direction: 'outgoing' });
        setStatus('calling');

        createPeer(openChannel(callId, true), true);

        ringTimer.current = setTimeout(() => finishCall('missed'), RING_TIMEOUT);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Could not start the call.';
        setError(message.includes('Permission') ? 'Camera/microphone permission denied.' : message);
        teardown();
        setCall(null);
        setStatus(null);
      }
    },
    [myId, call, getMedia, createPeer, openChannel, finishCall, teardown]
  );

  const acceptCall = useCallback(async () => {
    if (!call) return;
    try {
      if (ringTimer.current) clearTimeout(ringTimer.current);
      await getMedia(call.media, facingMode);
      setStatus('connecting');
      openChannel(call.callId, false);
      channelRef.current?.send({ type: 'broadcast', event: 'accept', payload: { from: myId } });
      await supabase.from('calls').update({ status: 'connecting' }).eq('id', call.callId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not answer the call.';
      setError(message.includes('Permission') ? 'Camera/microphone permission denied.' : message);
      finishCall('failed');
    }
  }, [call, getMedia, facingMode, openChannel, myId, finishCall]);

  const declineCall = useCallback(async () => {
    if (!call) return;
    channelRef.current?.send({ type: 'broadcast', event: 'decline', payload: { from: myId } });
    await finishCall('declined');
  }, [call, myId, finishCall]);

  const endCall = useCallback(() => {
    channelRef.current?.send({ type: 'broadcast', event: 'bye', payload: { from: myId } });
    finishCall('ended');
  }, [myId, finishCall]);

  const toggleMic = useCallback(() => {
    const track = localStream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicEnabled(track.enabled);
  }, [localStream]);

  const toggleCamera = useCallback(() => {
    const track = localStream?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCameraEnabled(track.enabled);
  }, [localStream]);

  const switchCamera = useCallback(async () => {
    const next = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(next);
    if (!call) return;
    try {
      const stream = await getMedia(call.media, next);
      const track = stream.getVideoTracks()[0];
      const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === 'video');
      await sender?.replaceTrack(track);
    } catch {
      /* device may not have a second camera */
    }
  }, [facingMode, call, getMedia]);

  /* ---------- listen for incoming calls ---------- */

  useEffect(() => {
    if (!myId) return;

    const channel = supabase
      .channel(`incoming-calls:${myId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'calls', filter: `callee_id=eq.${myId}` },
        async (payload) => {
          const row = payload.new as {
            id: string; conversation_id: string | null; caller_id: string;
            media: 'video' | 'audio'; status: string;
          };
          if (row.status !== 'ringing' || call) return;

          /* caller profile for the ring UI */
          const { data: caller } = await supabase
            .from('profiles')
            .select('id, full_text_name, username, avatar_url')
            .eq('id', row.caller_id)
            .maybeSingle();

          const profile = caller as { full_text_name?: string | null; username?: string | null; avatar_url?: string | null } | null;

          remoteUserRef.current = {
            id: row.caller_id,
            name: profile?.full_text_name || profile?.username || 'Unknown',
            avatar: profile?.avatar_url || null,
          };

          setCall({
            callId: row.id,
            conversationId: row.conversation_id,
            peerId: row.caller_id,
            peerName: remoteUserRef.current.name,
            peerAvatar: remoteUserRef.current.avatar,
            media: row.media,
            direction: 'incoming',
          });
          setStatus('ringing');

          /* open the channel early so accept/decline get through */
          openChannel(row.id, false);

          /* auto-miss if unanswered */
          ringTimer.current = setTimeout(() => {
            finishCall('missed');
          }, RING_TIMEOUT);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId, call]);

  /* browser closed / tab hidden mid-call → mark ended */
  useEffect(() => {
    if (!call) return;
    const onUnload = () => {
      navigator.sendBeacon?.(
        `${window.location.origin}/calls/${call.callId}/end`,
        new Blob([JSON.stringify({ status: 'ended' })], { type: 'application/json' })
      );
    };
    window.addEventListener('pagehide', onUnload);
    return () => window.removeEventListener('pagehide', onUnload);
  }, [call]);

  const value: CallContextValue = {
    call,
    status,
    localStream,
    remoteStream,
    micEnabled,
    cameraEnabled,
    facingMode,
    error,
    startCall,
    acceptCall,
    declineCall,
    endCall,
    toggleMic,
    toggleCamera,
    switchCamera,
  };

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}
