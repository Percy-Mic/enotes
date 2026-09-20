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

import { createE2eePipeline, supportsE2ee, type E2eePipeline } from '@/lib/e2ee/pipeline';

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
  /** True once both peers' E2EE frame keys are installed (null = E2EE unsupported). */
  e2eeActive: boolean | null;
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
  /** Always-fresh mirror of localStream for callbacks created before state flushes. */
  const pcLocalStreamRef = useRef<MediaStream | null>(null);
  /** Always-fresh mirror of the active call — timers/finalizers must see it
      even when they were created before setCall() flushed (verified: the
      45s ring timeout otherwise finalizes against a null call and the
      calls row stays 'ringing' forever). */
  const activeCallRef = useRef<ActiveCall | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const ringTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** ICE candidates that arrived before the remote description existed. */
  const iceQueue = useRef<RTCIceCandidateInit[]>([]);
  const remoteUserRef = useRef<{ id: string; name: string; avatar: string | null } | null>(null);
  /** E2EE pipeline for the active call — null on unsupported browsers. */
  const e2eeRef = useRef<E2eePipeline | null>(null);
  /** Peer's public key that arrived before our pipeline existed (pre-accept). */
  const pendingPeerKeyRef = useRef<string | null>(null);
  const [e2eeActive, setE2eeActive] = useState<boolean | null>(null);

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

  /** Publish my E2EE public half on the call channel (idempotent; no-op if
      the channel or the key isn't ready yet — the other trigger retries). */
  const sendOwnKey = useCallback(() => {
    const key = e2eeRef.current?.getOwnKeyB64();
    if (typeof key === 'string') {
      channelRef.current?.send({ type: 'broadcast', event: 'key', payload: { from: myId, key } });
    }
  }, [myId]);

  const teardown = useCallback(() => {
    if (ringTimer.current) clearTimeout(ringTimer.current);
    ringTimer.current = null;
    iceQueue.current = [];
    e2eeRef.current?.dispose();
    e2eeRef.current = null;
    pendingPeerKeyRef.current = null;
    setE2eeActive(null);
    pcRef.current?.close();
    pcRef.current = null;
    pcLocalStreamRef.current?.getTracks().forEach((t) => t.stop());
    pcLocalStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    channelRef.current = null;
  }, [localStream]);

  const finishCall = useCallback(
    async (finalStatus: CallStatus) => {
      const current = activeCallRef.current;
      activeCallRef.current = null;
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
    [myId, teardown]
  );

  const createPeer = useCallback((channel: ReturnType<typeof supabase.channel>, initiator: boolean, stream?: MediaStream) => {
    /* replace (never stack) an existing connection on renegotiation */
    if (pcRef.current) {
      try { pcRef.current.close(); } catch { /* already closed */ }
    }
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    /* The caller creates the peer connection synchronously after
       getUserMedia, before the localStream state flushes — the state
       read here was always null (verified: SDP offer with zero m= lines).
       Use the freshest stream available. */
    const active = stream ?? pcLocalStreamRef.current ?? localStream;
    active?.getTracks().forEach((track) => pc.addTrack(track, active));

    /* E2EE: wire every outbound track's sender (encryption engages only
       after the peer confirms readiness — see the 'ready' broadcast). */
    if (e2eeRef.current && active) {
      for (const sender of pc.getSenders()) {
        if (sender.track) e2eeRef.current.attachSender(sender);
      }
    }

    pc.ontrack = (event) => {
      /* E2EE: decrypt incoming frames end-to-end (receiver-side worker).
         Guarded — an E2EE failure must never cost us the media path. */
      try {
        if (e2eeRef.current && event.receiver) e2eeRef.current.attachReceiver(event.receiver);
      } catch {
        /* call continues under DTLS-SRTP without frame encryption */
      }
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
        .on('broadcast', { event: 'key' }, async ({ payload }) => {
          /* E2EE key exchange — public halves only, never persisted. */
          if (payload.from === myId) return;
          if (payload.key && typeof payload.key === 'string') {
            if (e2eeRef.current) {
              await e2eeRef.current.onPeerKeyB64(payload.key);
              if (e2eeRef.current.isReady()) {
                setE2eeActive(true);
                /* our decode workers are wired — the peer may now start
                   encrypting (its key was already derived from our key) */
                channel.send({ type: 'broadcast', event: 'ready', payload: { from: myId } });
              }
            } else {
              /* key raced ahead of our accept — feed it to the pipeline
                 the moment acceptCall creates it */
              pendingPeerKeyRef.current = payload.key;
            }
          }
        })
        .on('broadcast', { event: 'ready' }, ({ payload }) => {
          /* peer's receivers are decrypting — engage our sender encryption */
          if (payload.from === myId) return;
          e2eeRef.current?.engageSender();
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
          /* the callee picked up — the caller's unanswered-ring timer must
             die now, or it fires into a connected call 45s in and kills it
             (observed: every call dropped ~45s after connect) */
          if (ringTimer.current) {
            clearTimeout(ringTimer.current);
            ringTimer.current = null;
          }
          try {
            const pc = createPeer(channel, true);
            setStatus('connecting');
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            channel.send({ type: 'broadcast', event: 'offer', payload: { from: myId, offer: { type: offer.type, sdp: offer.sdp } } });
            /* E2EE: publish our public key (recipient may already have sent theirs). */
            const ownKey = e2eeRef.current?.getOwnKeyB64();
            if (typeof ownKey === 'string') {
              channel.send({ type: 'broadcast', event: 'key', payload: { from: myId, key: ownKey } });
            }
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
          if (sendStatus === 'SUBSCRIBED') {
            if (initiator) {
              /* tell the callee we're live so their ring UI shows */
              channel.send({ type: 'broadcast', event: 'ring', payload: { from: myId } });
            }
            /* both sides publish their E2EE public key as soon as the channel
               is live — covers the case where the key was generated first */
            sendOwnKey();
          }
          if (sendStatus === 'CHANNEL_ERROR' || sendStatus === 'TIMED_OUT') {
            setError('Call signaling connection lost.');
            finishCall('failed');
          }
        });

      channelRef.current = channel;
      return channel;
    },
    [myId, createPeer, finishCall, flushIce, sendOwnKey]
  );

  const getMedia = useCallback(async (media: 'video' | 'audio', facing: 'user' | 'environment' = 'user') => {
    const constraints: MediaStreamConstraints = {
      audio: { echoCancellation: true, noiseSuppression: true },
      video: media === 'video' ? { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    pcLocalStreamRef.current = stream;
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
        activeCallRef.current = { callId, conversationId, peerId, peerName, peerAvatar, media, direction: 'outgoing' };
        setStatus('calling');
        setE2eeActive(supportsE2ee() ? false : null);

        /* E2EE: pipeline must exist before createPeer wires senders; when the
           keypair finishes generating, publish it (the channel may already
           be subscribed — the ready-callback covers that order). onReady
           flips the badge whichever side completes the handshake first. */
        e2eeRef.current = createE2eePipeline(sendOwnKey, () => {
          if (e2eeRef.current?.isReady()) setE2eeActive(true);
        });

        const channel = openChannel(callId, true);
        createPeer(channel, true, stream);

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
      /* Compare-and-set: another tab/device may have accepted first. */
      const { data: claimed } = await supabase
        .from('calls')
        .update({ status: 'connecting' })
        .eq('id', call.callId)
        .eq('status', 'ringing')
        .select('id')
        .maybeSingle();
      if (!claimed) {
        await finishCall('ended');
        return;
      }
      await getMedia(call.media, facingMode);
      setStatus('connecting');
      setE2eeActive(supportsE2ee() ? false : null);
      /* E2EE pipeline ready before we accept — the caller's offer (and key)
         can arrive the moment the accept broadcast lands. */
      e2eeRef.current = createE2eePipeline(sendOwnKey, () => {
        if (e2eeRef.current?.isReady()) setE2eeActive(true);
      });
      if (pendingPeerKeyRef.current) {
        await e2eeRef.current.onPeerKeyB64(pendingPeerKeyRef.current);
        pendingPeerKeyRef.current = null;
        if (e2eeRef.current.isReady()) setE2eeActive(true);
      }
      openChannel(call.callId, false);
      channelRef.current?.send({ type: 'broadcast', event: 'accept', payload: { from: myId } });
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
      /* Acquire ONLY a new video track — re-running getMedia would also grab
         a fresh mic track that never reaches the peer connection, silently
         breaking mute state after the flip. The old video track is stopped
         so the camera indicator light follows the switch. */
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: next, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      const newTrack = newStream.getVideoTracks()[0];
      const oldTrack = localStream?.getVideoTracks()[0];
      if (localStream && oldTrack) {
        localStream.removeTrack(oldTrack);
        localStream.addTrack(newTrack);
        oldTrack.stop();
      }
      const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === 'video');
      await sender?.replaceTrack(newTrack);
      setLocalStream(localStream ? new MediaStream(localStream.getTracks()) : newStream);
    } catch {
      /* device may not have a second camera */
    }
  }, [facingMode, call, localStream]);

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
          if (row.status !== 'ringing' || call || activeCallRef.current) return;
          /* Claim synchronously: duplicate subscriptions (dev StrictMode,
             second browser tab) each run this handler — only one may own
             the ring timer, or an orphaned timer kills the connected call
             45s later (observed live). */
          activeCallRef.current = {
            callId: row.id,
            conversationId: row.conversation_id,
            peerId: row.caller_id,
            peerName: '…',
            peerAvatar: null,
            media: row.media,
            direction: 'incoming',
          };

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
          activeCallRef.current = {
            callId: row.id,
            conversationId: row.conversation_id,
            peerId: row.caller_id,
            peerName: remoteUserRef.current.name,
            peerAvatar: remoteUserRef.current.avatar,
            media: row.media,
            direction: 'incoming',
          };
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
    e2eeActive,
  };

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}
