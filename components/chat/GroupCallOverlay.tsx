'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Mic, MicOff, PhoneOff, RefreshCw, Video, VideoOff, X } from 'lucide-react';
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

interface GroupCallOverlayProps {
  conversationId: string;
  myId: string | null;
  members: GroupCallMember[];
  enabled: boolean;
  startWhenOpened?: boolean;
  onClose?: () => void;
}

type Signal = {
  type: 'invite' | 'accept' | 'offer' | 'answer' | 'ice' | 'leave' | 'end';
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
}: {
  stream: MediaStream | null;
  label: string;
  muted?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);

  return (
    <div className={`relative overflow-hidden rounded-2xl bg-black/70 ring-1 ring-white/10 ${className}`}>
      <video ref={ref} autoPlay playsInline muted={muted} className="h-full w-full object-cover" />
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
  onClose,
}: GroupCallOverlayProps) {
  const [active, setActive] = useState<{ callId: string; hostId: string } | null>(null);
  const [incoming, setIncoming] = useState<Signal | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>('user');
  const [switchingCamera, setSwitchingCamera] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [callMembers, setCallMembers] = useState<GroupCallMember[]>(members);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const localRef = useRef<MediaStream | null>(null);
  const activeRef = useRef<typeof active>(null);
  const endingRef = useRef(false);

  useEffect(() => {
    setCallMembers(members);
  }, [members]);

  const memberMap = useMemo(
    () => new Map(callMembers.map((member) => [member.user_id, member])),
    [callMembers],
  );

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const send = useCallback(async (payload: Omit<Signal, 'from'>) => {
    if (!myId || !channelRef.current) return;
    await channelRef.current.send({
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
      if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
        closePeer(remoteId);
      }
    };

    return peer;
  }, [closePeer, send]);

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
    stopLocal();
    setRemoteStreams({});
    setActive(null);
    setIncoming(null);
    setError(null);
    endingRef.current = false;
  }, [myId, send, stopLocal]);

  const getMedia = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 },
      },
    });
    localRef.current = stream;
    setLocalStream(stream);
    setMicEnabled(stream.getAudioTracks().some((track) => track.enabled));
    setCameraEnabled(stream.getVideoTracks().some((track) => track.enabled));
    const facing = stream.getVideoTracks()[0]?.getSettings().facingMode;
    if (facing === 'environment' || facing === 'user') setCameraFacing(facing);
    return stream;
  }, []);

  const startCall = useCallback(async () => {
    if (!myId || activeRef.current) return;

    try {
      setError(null);

      let targets = callMembers.filter((member) => member.user_id !== myId);
      if (targets.length === 0) {
        const { data } = await supabase
          .from('conversation_members')
          .select('user_id, profiles!conversation_members_user_id_fkey(id, full_text_name, username, avatar_url)')
          .eq('conversation_id', conversationId);

        targets = ((data || []) as any[])
          .map((row) => ({
            user_id: row.user_id,
            profile: row.profiles || null,
          }))
          .filter((member) => member.user_id !== myId) as GroupCallMember[];

        setCallMembers(targets.concat([{ user_id: myId }]));
      }

      if (targets.length === 0) {
        setError('This group has no other members to call.');
        return;
      }

      await getMedia();
      const callId = crypto.randomUUID();
      setActive({ callId, hostId: myId });
      activeRef.current = { callId, hostId: myId };

      await send({ type: 'invite', callId });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the group video call.');
    }
  }, [callMembers, conversationId, getMedia, myId, send]);

  const acceptIncoming = useCallback(async () => {
    const call = incoming;
    if (!call || !myId) return;
    try {
      setError(null);
      await getMedia();
      setActive({ callId: call.callId, hostId: call.from });
      activeRef.current = { callId: call.callId, hostId: call.from };
      setIncoming(null);
      await send({ type: 'accept', callId: call.callId, to: call.from });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join the group video call.');
    }
  }, [getMedia, incoming, myId, send]);

  const declineIncoming = useCallback(async () => {
    if (!incoming) return;
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

    const channel = supabase.channel(`group-call-${conversationId}`);
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

          if (signal.type === 'ice') {
            const peer = peersRef.current.get(signal.from);
            if (peer && signal.candidate) {
              try { await peer.addIceCandidate(signal.candidate); } catch {}
            }
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
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (activeRef.current && !endingRef.current) {
        endingRef.current = true;
        void send({ type: 'leave', callId: activeRef.current.callId });
      }
      supabase.removeChannel(channel);
      channelRef.current = null;
      cleanup(false);
    };
  }, [cleanup, closePeer, conversationId, createPeer, enabled, makeOffer, myId, send]);

  const leave = useCallback(() => {
    if (!activeRef.current) {
      onClose?.();
      return;
    }
    endingRef.current = true;
    void send({ type: 'leave', callId: activeRef.current.callId });
    cleanup(false);
    onClose?.();
  }, [cleanup, onClose, send]);

  useEffect(() => {
    if (!startWhenOpened || !enabled || !myId || activeRef.current) return;
    void startCall();
  }, [enabled, myId, startCall, startWhenOpened]);

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

      {active && (
        <div className="fixed inset-0 z-[210] flex flex-col bg-[#07110d] text-white">
          <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
            <div>
              <p className="text-sm font-bold">Group video call</p>
              <p className="text-[11px] text-white/50">{remoteEntries.length + 1} connected</p>
            </div>
            <button onClick={leave} className="rounded-full p-2 text-white/60 hover:bg-white/10" aria-label="Close call">
              <X className="h-5 w-5" />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-auto p-3">
            <div className={`grid min-h-full gap-2 ${remoteEntries.length + 1 === 1 ? 'grid-cols-1' : remoteEntries.length + 1 <= 4 ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-3'}`}>
              <VideoTile stream={localStream} muted label="You" className="aspect-video" />
              {remoteEntries.map(([userId, stream]) => (
                <VideoTile
                  key={userId}
                  stream={stream}
                  label={nameFor(memberMap.get(userId))}
                  className="aspect-video"
                />
              ))}
            </div>
          </div>

          {error && <p className="mx-auto max-w-lg px-4 pb-2 text-center text-xs text-red-300">{error}</p>}

          <footer className="flex shrink-0 items-center justify-center gap-3 border-t border-white/10 bg-black/20 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <button onClick={toggleMic} className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10" aria-label={micEnabled ? 'Mute microphone' : 'Unmute microphone'}>
              {micEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
            </button>
            <button onClick={toggleCamera} className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10" aria-label={cameraEnabled ? 'Turn camera off' : 'Turn camera on'}>
              {cameraEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
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
