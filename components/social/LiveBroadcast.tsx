'use client';

/* ============================================================
   LiveBroadcast — the host side of "Go live" on /videos.

   1. Get camera+mic permission (before creating the DB row — no
      phantom "live" streams from permission denials).
   2. Create live_streams row → notify_live_started() informs
      followers; a LIVE badge appears in their /videos rail.
   3. startHostSession() answers each viewer's offer with this
      camera's tracks (P2P, no media server).
   4. Viewer count comes from the DB (RLS-safe); teardown deletes
      the live_viewers rows and marks the stream ended.
   ============================================================ */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Mic, MicOff, Video, VideoOff, Radio, Users, AlertTriangle, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  createLiveStream,
  endLiveStream,
  startHostSession,
  freshLiveChannel,
  type HostSession,
} from '@/lib/social/live';

interface Props {
  meId: string;
  onClose: () => void;
}

type Phase = 'preparing' | 'live' | 'ending';

interface ChatLine {
  id: string;
  name: string;
  text: string;
  mine: boolean;
}

export default function LiveBroadcast({ meId, onClose }: Props) {
  const [title, setTitle] = useState('Live');
  const [phase, setPhase] = useState<Phase>('preparing');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [dbViewerCount, setDbViewerCount] = useState(0);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [chatDraft, setChatDraft] = useState('');

  const sessionRef = useRef<HostSession | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const streamIdRef = useRef<string | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const endedRef = useRef(false);
  const chatChannelRef = useRef<RealtimeChannel | null>(null);

  /* camera preview while preparing */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        if (cancelled) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = media;
        setLocalStream(media);
      } catch {
        if (!cancelled) {
          setError(
            'Camera/microphone permission denied — you need both to go live.',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
      /* closing the "preparing" screen without going live must release the
         camera — otherwise the device stays captured (browser tab shows
         the recording indicator) with no way to stop it */
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  /* wire preview element once the stream exists */
  useEffect(() => {
    if (previewRef.current && localStream) {
      previewRef.current.srcObject = localStream;
    }
  }, [localStream]);

  /* on-air timer */
  useEffect(() => {
    if (phase !== 'live') return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  /* finish is hoisted via a ref so goLive's onEnded callback can call it
     regardless of which was defined first */
  const finishRef = useRef<() => void>(() => {});

  const goLive = useCallback(async () => {
    if (!streamRef.current) return;
    setError(null);
    const row = await createLiveStream(meId, title);
    if (!row) {
      setError('Could not start the broadcast. Try again.');
      return;
    }
    streamIdRef.current = row.id;

    sessionRef.current = startHostSession(row.id, meId, streamRef.current, {
      onViewerCount: (n) => setViewerCount(n),
      onError: (msg) => setError(msg),
      onEnded: () => finishRef.current(),
    });
    setPhase('live');
  }, [meId, title]);

  const finish = useCallback(async () => {
    if (endedRef.current) return;
    endedRef.current = true;

    const id = streamIdRef.current;
    if (id) await endLiveStream(id).catch(() => undefined);

    sessionRef.current?.cleanup();
    sessionRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    setPhase('ending');
    onClose();
  }, [onClose]);

  /* keep the ref pointing at the latest finish */
  useEffect(() => {
    finishRef.current = () => {
      void finish();
    };
  }, [finish]);

  /* beacon cleanup if the tab dies mid-broadcast */
  useEffect(() => {
    const onUnload = () => {
      if (streamIdRef.current) {
        const body = JSON.stringify({ streamId: streamIdRef.current });
        navigator.sendBeacon?.('/api/live/end', new Blob([body], { type: 'application/json' }));
      }
    };
    window.addEventListener('pagehide', onUnload);
    return () => window.removeEventListener('pagehide', onUnload);
  }, []);

  /* DB viewer count (live_viewers presence) — realtime updates. Shown
     alongside the peer count (max of the two) since both lag by design. */
  useEffect(() => {
    const streamId = streamIdRef.current;
    if (phase !== 'live' || !streamId) return;

    const channel = freshLiveChannel(`live-viewers-count:${streamId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'live_streams', filter: `id=eq.${streamId}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as { viewer_count?: number } | null;
          if (row && typeof row.viewer_count === 'number') {
            setDbViewerCount(row.viewer_count);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [phase]);

  /* ephemeral chat on the same channel viewers use — the host reads and
     replies in-stream */
  useEffect(() => {
    const streamId = streamIdRef.current;
    if (phase !== 'live' || !streamId) return;

    const chatChannel = freshLiveChannel(`live-chat:${streamId}`, {
      config: { broadcast: { self: false } },
    })
      .on('broadcast', { event: 'chat' }, ({ payload }) => {
        setChat((prev) => {
          if (prev.some((l) => l.id === payload.id)) return prev;
          return [...prev.slice(-80), {
            id: String(payload.id),
            name: String(payload.name || 'Viewer'),
            text: String(payload.text || '').slice(0, 300),
            mine: false,
          }];
        });
      })
      .subscribe();
    chatChannelRef.current = chatChannel;

    return () => {
      supabase.removeChannel(chatChannel);
      chatChannelRef.current = null;
    };
  }, [phase]);

  const toggleMic = () => {
    const track = streamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
  };

  const toggleCam = () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCamOn(track.enabled);
  };

  const sendChat = () => {
    const text = chatDraft.trim();
    if (!text) return;
    const channel = chatChannelRef.current;
    if (!channel) return;
    const id = `${meId}-host-${Date.now()}`;
    void channel.send({
      type: 'broadcast',
      event: 'chat',
      payload: { id, from: meId, name: 'Host', text: text.slice(0, 300) },
    });
    /* self:false → no echo; append locally */
    setChat((prev) => [...prev.slice(-80), { id, name: 'Host', text, mine: true }]);
    setChatDraft('');
  };

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95 text-white">
      <header className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          {phase === 'live' ? (
            <span className="flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1 text-xs font-bold uppercase tracking-wide">
              <Radio className="h-3.5 w-3.5 animate-pulse" /> Live · {mm}:{ss}
            </span>
          ) : (
            <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">Ready</span>
          )}
          <span className="text-sm text-white/70">{title}</span>
        </div>
        <button
          onClick={() => (phase === 'live' ? finish() : onClose())}
          aria-label={phase === 'live' ? 'End stream' : 'Cancel'}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        <video
          ref={previewRef}
          autoPlay
          muted
          playsInline
          className={`h-full w-full object-contain ${camOn ? '' : 'opacity-0'}`}
        />
        {!localStream && !error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-white/60">Requesting camera & microphone…</p>
          </div>
        )}
        {camOn === false && localStream && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80">
            <VideoOff className="h-10 w-10 text-white/60" />
            <p className="text-sm text-white/70">Camera off — viewers see black</p>
          </div>
        )}
      </div>

      {error && (
        <div className="mx-4 mb-2 flex items-start gap-2 rounded-xl bg-red-500/15 px-3 py-2 text-sm text-red-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {phase === 'live' && (
        <div className="flex h-52 shrink-0 flex-col border-t border-white/10">
          <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
            {chat.length === 0 && (
              <p className="text-xs text-white/40">Chat from your viewers shows up here.</p>
            )}
            {chat.map((line) => (
              <p key={line.id} className="text-sm leading-snug">
                <span className={`font-semibold ${line.mine ? 'text-[#E5798F]' : 'text-white/70'}`}>
                  {line.mine ? 'You' : line.name}:{' '}
                </span>
                <span className="text-white/90">{line.text}</span>
              </p>
            ))}
          </div>
          <div className="flex items-center gap-2 px-3 pb-3">
            <input
              value={chatDraft}
              onChange={(e) => setChatDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendChat()}
              maxLength={300}
              placeholder="Reply to your viewers…"
              className="min-w-0 flex-1 rounded-full bg-white/10 px-4 py-2.5 text-sm placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-[#E5798F]"
            />
            <button
              onClick={sendChat}
              aria-label="Send chat message"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#E5798F] transition hover:opacity-90"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {phase === 'preparing' ? (
        <footer className="space-y-3 px-4 pb-6">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder="Stream title"
            className="w-full rounded-xl bg-white/10 px-4 py-3 text-sm placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-[#E5798F]"
          />
          <button
            onClick={goLive}
            disabled={!localStream}
            className="w-full rounded-xl bg-red-600 py-3 text-sm font-bold transition hover:bg-red-500 disabled:opacity-40"
          >
            <span className="inline-flex items-center gap-2">
              <Radio className="h-4 w-4" /> Go live now
            </span>
          </button>
          <p className="text-center text-[11px] leading-relaxed text-white/40">
            Streams are peer-to-peer — great for small audiences, heavy on your
            upload. Your followers get a notification.
          </p>
        </footer>
      ) : (
        <footer className="flex items-center justify-center gap-4 px-4 pb-6">
          <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-sm">
            <Users className="h-4 w-4 text-white/70" /> {Math.max(viewerCount, dbViewerCount)}
          </span>
          <button
            onClick={toggleMic}
            aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
            className={`flex h-12 w-12 items-center justify-center rounded-full transition ${
              micOn ? 'bg-white/15 hover:bg-white/25' : 'bg-red-600'
            }`}
          >
            {micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
          </button>
          <button
            onClick={toggleCam}
            aria-label={camOn ? 'Turn camera off' : 'Turn camera on'}
            className={`flex h-12 w-12 items-center justify-center rounded-full transition ${
              camOn ? 'bg-white/15 hover:bg-white/25' : 'bg-red-600'
            }`}
          >
            {camOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
          </button>
          <button
            onClick={finish}
            className="rounded-full bg-red-600 px-5 py-2.5 text-sm font-bold transition hover:bg-red-500"
          >
            End
          </button>
        </footer>
      )}
    </div>
  );
}
