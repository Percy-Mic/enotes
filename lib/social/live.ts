/* ============================================================
   Live streaming — host → N viewers over WebRTC.

   Same free-tier approach as 1:1 calls (CallProvider): media flows
   peer-to-peer; Supabase Realtime broadcast channels carry only
   SDP/ICE signaling. The HOST answers every viewer separately
   (viewer-side offers), so there is no SFU and no media server.

   Signaling rules (mirrors the call provider's state machine):
   • each viewer gets its own RTCPeerConnection + a channel-scoped
     message namespace (`v:<viewerId>`);
   • an ANSWER is only applied while signalingState ===
     'have-local-offer' — stale/duplicate answers are dropped;
   • ICE candidates arriving before the remote description are
     QUEUED and flushed after setRemoteDescription — never dropped;
   • every setRemoteDescription/setLocalDescription is guarded so a
     race degrades to a logged warning instead of an exception.

   Presence: viewers heartbeat into live_viewers every 20s; a DB
   trigger upserts last_seen and prunes rows stale > 45s, and
   maintains live_streams.viewer_count. Leaving deletes the row.

   Practical limits (stated honestly in the UI): the host relays a
   copy of its track to every viewer from its own uplink — fine for
   ~5–10 viewers on home internet, not a Twitch replacement.
   ============================================================ */

import { supabase } from '@/lib/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { LiveStream } from '@/types/social';

export const HEARTBEAT_MS = 20_000;

/* ---------- discovery ---------- */

export async function fetchLiveStreams(limit = 20): Promise<LiveStream[]> {
  const { data, error } = await supabase
    .from('live_streams')
    .select(
      `id, host_id, title, status, viewer_count, started_at, ended_at, created_at,
       host:profiles!live_streams_host_id_fkey(id, full_text_name, username, avatar_url)`,
    )
    .eq('status', 'live')
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[live] fetchLiveStreams failed:', error.message);
    return [];
  }
  return (data || []) as unknown as LiveStream[];
}

export async function fetchMyLiveStream(meId: string): Promise<LiveStream | null> {
  const { data } = await supabase
    .from('live_streams')
    .select('*')
    .eq('host_id', meId)
    .eq('status', 'live')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as LiveStream) || null;
}

/* ---------- lifecycle ---------- */

export async function createLiveStream(meId: string, title: string): Promise<LiveStream | null> {
  const { data, error } = await supabase
    .from('live_streams')
    .insert({ host_id: meId, title: title.slice(0, 120) || 'Live', status: 'live' })
    .select('*')
    .single();
  if (error) {
    console.error('[live] create failed:', error.message);
    return null;
  }
  return data as LiveStream;
}

export async function endLiveStream(streamId: string): Promise<void> {
  const { error } = await supabase.rpc('end_own_live_stream', { p_stream: streamId });
  if (error) {
    /* RPC missing → migration not run yet; fall back to a direct update */
    await supabase
      .from('live_streams')
      .update({ status: 'ended', ended_at: new Date().toISOString() })
      .eq('id', streamId)
      .eq('status', 'live');
  }
}

/* ---------- viewer presence ---------- */

export async function joinAsViewer(streamId: string, meId: string): Promise<void> {
  await heartbeatViewer(streamId, meId);
}

export async function heartbeatViewer(streamId: string, meId: string): Promise<void> {
  /* Upsert so join + steady-state beats share one idempotent call. The DB
     prunes stale rows (>45s) and refreshes viewer_count after each write. */
  await supabase
    .from('live_viewers')
    .upsert(
      { stream_id: streamId, user_id: meId, last_seen_at: new Date().toISOString() },
      { onConflict: 'stream_id,user_id' },
    );
}

export async function leaveAsViewer(streamId: string, meId: string): Promise<void> {
  /* Best-effort: the 45s prune covers tab-kill / lost connections. */
  try {
    await supabase.from('live_viewers').delete().eq('stream_id', streamId).eq('user_id', meId);
  } catch {
    /* ignore */
  }
}/* ============================================================
   Channel plumbing
   ============================================================ */

export interface LiveChannelHooks {
  onViewerJoined?: (viewerId: string) => void;
  onViewerLeft?: (viewerId: string) => void;
  /** Host: a viewer offered; answerViewer responds with host tracks. */
  onOffer?: (viewerId: string, sdp: RTCSessionDescriptionInit) => void;
  /** Viewer: the host answered our offer. */
  onAnswer?: (sdp: RTCSessionDescriptionInit) => void;
  /** Either side: remote ICE candidate. */
  onIce?: (fromId: string, candidate: RTCIceCandidateInit) => void;
  /** Viewer: the host announced itself (offer now, or re-offer later). */
  onHello?: () => void;
  onHostEnded?: () => void;
  onError?: (message: string) => void;
}

/* supabase.channel() returns a CACHED instance for a given topic. If a
   previous session's removeChannel is still in flight (it's async), the
   next session gets the old, already-subscribed channel back — and
   adding handlers to a subscribed channel throws
   "cannot add … callbacks after subscribe()". Evict any stale instance
   with the same topic first so every session starts clean. */
export function freshLiveChannel(
  name: string,
  config?: Parameters<typeof supabase.channel>[1],
): RealtimeChannel {
  const topic = `realtime:${name}`;
  const stale = supabase.getChannels().find((c) => c.topic === topic);
  if (stale) void supabase.removeChannel(stale);
  return supabase.channel(name, config);
}

export function subscribeToLiveChannel(
  streamId: string,
  meId: string,
  isHost: boolean,
  hooks: LiveChannelHooks,
): RealtimeChannel {
  const channel = freshLiveChannel(`live-stream:${streamId}`, {
    config: { broadcast: { self: false } },
  });

  channel
    .on('broadcast', { event: 'offer' }, ({ payload }) => {
      if (payload.to !== meId || !payload.sdp) return;
      hooks.onOffer?.(payload.from as string, payload.sdp as RTCSessionDescriptionInit);
    })
    .on('broadcast', { event: 'answer' }, ({ payload }) => {
      if (payload.to !== meId || !payload.sdp) return;
      hooks.onAnswer?.(payload.sdp as RTCSessionDescriptionInit);
    })
    .on('broadcast', { event: 'ice' }, ({ payload }) => {
      if (payload.to !== meId || !payload.candidate) return;
      hooks.onIce?.(payload.from as string, payload.candidate as RTCIceCandidateInit);
    })
    .on('broadcast', { event: 'hello' }, ({ payload }) => {
      if (payload.from === meId) return;
      if (isHost) return;
      hooks.onHello?.();
    })
    .on('broadcast', { event: 'bye' }, ({ payload }) => {
      if (payload.from === meId) return;
      if (isHost) hooks.onViewerLeft?.(payload.from as string);
      else hooks.onHostEnded?.();
    })
    .on('broadcast', { event: 'ended' }, () => {
      /* host explicitly closed the stream; postgres_changes (below)
         covers crash-close via the status flip */
      if (!isHost) hooks.onHostEnded?.();
    });

  if (!isHost) {
    channel.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'live_streams', filter: `id=eq.${streamId}` },
      (payload) => {
        const row = payload.new as { status?: string };
        if (row?.status === 'ended') hooks.onHostEnded?.();
      },
    );
  }

  return channel;
}

export async function sendLiveSignal(
  channel: RealtimeChannel,
  event: 'offer' | 'answer' | 'ice' | 'bye' | 'hello' | 'ended',
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await channel.send({ type: 'broadcast', event, payload });
  } catch (err) {
    console.warn(`[live] send ${event} failed:`, err);
  }
}

/* ============================================================
   HOST — one peer connection PER viewer (we answer each viewer's
   offer with the same camera track attached).
   ============================================================ */

export interface HostSession {
  streamId: string;
  channel: RealtimeChannel;
  peers: Map<string, RTCPeerConnection>;
  iceQueues: Map<string, RTCIceCandidateInit[]>;
  remoteReady: Map<string, boolean>;
  cleanup: () => void;
}

const HELLO_INTERVAL_MS = 5_000;

const HOST_ICE: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  ...(process.env.NEXT_PUBLIC_TURN_URL
    ? [{
        urls: process.env.NEXT_PUBLIC_TURN_URL,
        username: process.env.NEXT_PUBLIC_TURN_USERNAME,
        credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
      }]
    : []),
];

async function guardedSetRemote(pc: RTCPeerConnection, desc: RTCSessionDescriptionInit): Promise<boolean> {
  if (pc.signalingState !== 'have-local-offer') return false; // stale/duplicate answer
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(desc));
    return true;
  } catch (err) {
    console.warn('[live] setRemoteDescription failed:', err);
    return false;
  }
}

export function startHostSession(
  streamId: string,
  meId: string,
  stream: MediaStream,
  hooks: { onViewerCount?: (n: number) => void; onEnded?: () => void; onError?: (msg: string) => void },
): HostSession {
  const session: HostSession = {
    streamId,
    channel: null as unknown as RealtimeChannel,
    peers: new Map(),
    iceQueues: new Map(),
    remoteReady: new Map(),
    cleanup: () => {},
  };
  let helloTimer: ReturnType<typeof setInterval> | null = null;

  async function flushIce(viewerId: string, pc: RTCPeerConnection) {
    const queue = session.iceQueues.get(viewerId) || [];
    session.iceQueues.set(viewerId, []);
    for (const c of queue) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (err) {
        console.warn('[live] host addIceCandidate failed:', err);
      }
    }
  }

  function teardownViewer(viewerId: string) {
    const pc = session.peers.get(viewerId);
    if (pc) {
      try { pc.close(); } catch { /* already closed */ }
      session.peers.delete(viewerId);
    }
    session.iceQueues.delete(viewerId);
    session.remoteReady.delete(viewerId);
    hooks.onViewerCount?.(session.peers.size);
  }

  async function answerViewer(viewerId: string, sdp: RTCSessionDescriptionInit) {
    let pc = session.peers.get(viewerId);

    if (!pc) {
      pc = new RTCPeerConnection({ iceServers: HOST_ICE });
      session.peers.set(viewerId, pc);
      session.iceQueues.set(viewerId, []);
      session.remoteReady.set(viewerId, false);
      hooks.onViewerCount?.(session.peers.size);

      /* attach every host track (camera + mic) */
      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream);
      }
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          void sendLiveSignal(session.channel, 'ice', { from: meId, to: viewerId, candidate: e.candidate.toJSON() });
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc && (pc.connectionState === 'failed' || pc.connectionState === 'closed')) {
          teardownViewer(viewerId);
        }
      };
    }

    if (pc.signalingState !== 'stable' && pc.signalingState !== 'have-remote-offer') {
      console.warn(`[live] ignoring offer in state ${pc.signalingState}`);
      return;
    }

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      session.remoteReady.set(viewerId, true);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendLiveSignal(session.channel, 'answer', { from: meId, to: viewerId, sdp: pc.localDescription?.toJSON() });
      await flushIce(viewerId, pc);
    } catch (err) {
      console.warn('[live] answerViewer failed:', err);
      teardownViewer(viewerId);
    }
  }

  const channel = subscribeToLiveChannel(streamId, meId, true, {
    onOffer: (viewerId, sdp) => void answerViewer(viewerId, sdp),
    onIce: (viewerId, candidate) => {
      const pc = session.peers.get(viewerId);
      if (!pc) return;
      if (session.remoteReady.get(viewerId)) {
        void pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);
      } else {
        session.iceQueues.get(viewerId)?.push(candidate);
      }
    },
    onViewerLeft: (viewerId) => teardownViewer(viewerId),
  });

  session.channel = channel;
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      /* announce presence so viewers subscribed before the host hear
         the hello and can send their offer — and re-announce
         periodically so viewers arriving mid-stream learn the host is
         reachable (they offer on receiving this). */
      void sendLiveSignal(channel, 'hello', { from: meId });
      helloTimer = setInterval(() => {
        void sendLiveSignal(channel, 'hello', { from: meId });
      }, HELLO_INTERVAL_MS);
    }
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      hooks.onError?.('Live connection lost.');
      hooks.onEnded?.();
    }
  });

  session.cleanup = () => {
    if (helloTimer) clearInterval(helloTimer);
    /* tell every connected viewer we're gone (normal close path; the DB
       status flip covers viewers that miss the broadcast) */
    void sendLiveSignal(channel, 'ended', { from: meId });
    session.peers.forEach((pc) => {
      try { pc.close(); } catch { /* already closed */ }
    });
    session.peers.clear();
    try { supabase.removeChannel(channel); } catch { /* not subscribed */ }
  };

  return session;
}

/* ============================================================
   VIEWER — one peer connection to the host.
   ============================================================ */

export interface ViewerSession {
  streamId: string;
  channel: RealtimeChannel;
  pc: RTCPeerConnection | null;
  iceQueue: RTCIceCandidateInit[];
  remoteReady: boolean;
  cleanup: () => void;
}

export function startViewerSession(
  streamId: string,
  meId: string,
  hostId: string,
  hooks: { onRemoteStream?: (s: MediaStream) => void; onHostEnded?: () => void; onError?: (msg: string) => void },
): ViewerSession {
  const session: ViewerSession = {
    streamId,
    channel: null as unknown as RealtimeChannel,
    pc: null,
    iceQueue: [],
    remoteReady: false,
    cleanup: () => {},
  };

  if (!hostId) {
    throw new Error('startViewerSession: hostId is required');
  }

  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  async function connect() {
    if (session.pc && session.pc.signalingState !== 'closed') return;

    const pc = new RTCPeerConnection({ iceServers: HOST_ICE });
    session.pc = pc;
    session.remoteReady = false;

    /* receive-only: add both recvonly transceivers so the answer's media
       section matches the host's audio+video without us sending anything */
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });

    const inbound = new MediaStream();
    pc.ontrack = (e) => {
      inbound.addTrack(e.track);
      hooks.onRemoteStream?.(inbound);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        hooks.onError?.('Stream connection failed.');
      }
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        void sendLiveSignal(session.channel, 'ice', { from: meId, to: hostId, candidate: e.candidate.toJSON() });
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await sendLiveSignal(session.channel, 'offer', { from: meId, to: hostId, sdp: pc.localDescription?.toJSON() });
  }

  const channel = subscribeToLiveChannel(streamId, meId, false, {
    onAnswer: async (sdp) => {
      const pc = session.pc;
      if (!pc) return;
      const ok = await guardedSetRemote(pc, sdp);
      if (ok) {
        session.remoteReady = true;
        for (const c of session.iceQueue.splice(0)) {
          try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* stale */ }
        }
      }
    },
    onIce: (_from, candidate) => {
      const pc = session.pc;
      if (!pc) return;
      if (session.remoteReady) {
        void pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);
      } else {
        session.iceQueue.push(candidate);
      }
    },
    onHostEnded: () => hooks.onHostEnded?.(),
    onHello: () => {
      /* host announced itself — connect now if we haven't (also fires on
         the periodic re-announce, where connect() is a no-op while the
         existing connection is healthy) */
      if (!session.pc || session.pc.signalingState === 'closed') void connect();
    },
  });

  session.channel = channel;
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      void connect();
      /* retry once — the host may not be subscribed yet; its periodic
         'hello' (every 5s) re-triggers connect() after that */
      reconnectTimer = setTimeout(() => {
        if (!session.pc || session.pc.connectionState === 'new') {
          void connect();
        }
      }, 4_000);
    }
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      hooks.onError?.('Lost the live connection.');
    }
  });

  session.cleanup = () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    /* goodbye so the host tears the peer connection down immediately
       (the DB prune is the backstop for tab-kill / lost connections) */
    void sendLiveSignal(channel, 'bye', { from: meId });
    if (session.pc) {
      try { session.pc.close(); } catch { /* already closed */ }
      session.pc = null;
    }
    try { supabase.removeChannel(channel); } catch { /* not subscribed */ }
  };

  return session;
}


