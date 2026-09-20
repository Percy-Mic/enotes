'use client';

/* ============================================================
   LiveViewer — watch a live stream from /videos.

   Join flow: insert a live_viewers row (RLS-checked), subscribe
   to the stream channel, offer our recvonly transceivers, render
   the host's track when it arrives. Presence heartbeats every
   20s; leaving deletes the row (and the 45s DB prune catches
   tab-kills). Chat is ephemeral via broadcast — not persisted,
   like the rest of the free-tier design.
   ============================================================ */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Users, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  joinAsViewer,
  heartbeatViewer,
  leaveAsViewer,
  startViewerSession,
  freshLiveChannel,
  HEARTBEAT_MS,
  type ViewerSession,
} from '@/lib/social/live';
import type { LiveStream } from '@/types/social';
import Avatar from '@/components/social/Avatar';

interface Props {
  stream: LiveStream;
  meId: string;
  onClose: () => void;
}

interface ChatLine {
  id: string;
  from: string;
  name: string;
  text: string;
  mine: boolean;
}

export default function LiveViewer({ stream, meId, onClose }: Props) {
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [chatDraft, setChatDraft] = useState('');
  const [hostEnded, setHostEnded] = useState(false);
  /* the prop is a snapshot from the rail; the DB count moves as viewers
     come and go, so track it live instead of showing a stale number */
  const [viewerCount, setViewerCount] = useState(stream.viewer_count ?? 0);

  const sessionRef = useRef<ViewerSession | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const leftRef = useRef(false);
  const chatChannelRef = useRef<RealtimeChannel | null>(null);
  const myNameRef = useRef('Viewer');

  const leave = useCallback(async () => {
    if (leftRef.current) return;
    leftRef.current = true;
    sessionRef.current?.cleanup();
    sessionRef.current = null;
    await leaveAsViewer(stream.id, meId);
    onClose();
  }, [meId, onClose, stream.id]);

  /* join + watch */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      /* chat display name (broadcast to other viewers with each message) */
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_text_name, username')
        .eq('id', meId)
        .maybeSingle();
      myNameRef.current =
        (profile?.full_text_name as string) || (profile?.username as string) || 'Viewer';

      await joinAsViewer(stream.id, meId).catch(() => undefined);

      sessionRef.current = startViewerSession(stream.id, meId, stream.host_id, {
        onRemoteStream: (s) => {
          if (!cancelled) setRemoteStream(s);
        },
        onHostEnded: () => {
          setHostEnded(true);
        },
        onError: (msg) => {
          if (!cancelled) setError(msg);
        },
      });
    })();

    const hb = setInterval(() => {
      if (!leftRef.current) void heartbeatViewer(stream.id, meId);
    }, HEARTBEAT_MS);

    /* ephemeral chat via broadcast — not persisted (free-tier design) */
    const chatChannel = freshLiveChannel(`live-chat:${stream.id}`, {
      config: { broadcast: { self: false } },
    })
      .on('broadcast', { event: 'chat' }, ({ payload }) => {
        setChat((prev) => {
          if (prev.some((l) => l.id === payload.id)) return prev;
          return [...prev.slice(-80), {
            id: String(payload.id),
            from: String(payload.from),
            name: String(payload.name || 'Viewer'),
            text: String(payload.text || '').slice(0, 300),
            mine: payload.from === meId,
          }];
        });
      })
      .subscribe();
    chatChannelRef.current = chatChannel;

    return () => {
      cancelled = true;
      clearInterval(hb);
      supabase.removeChannel(chatChannel);
      chatChannelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.id, meId]);

  /* live viewer count (postgres_changes on the stream row) */
  useEffect(() => {
    const channel = freshLiveChannel(`live-viewer-count:${stream.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'live_streams', filter: `id=eq.${stream.id}` },
        (payload) => {
          const row = payload.new as { viewer_count?: number };
          if (typeof row?.viewer_count === 'number') setViewerCount(row.viewer_count);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [stream.id]);

  /* attach remote stream to the video element */
  useEffect(() => {
    if (videoRef.current && remoteStream) {
      videoRef.current.srcObject = remoteStream;
      videoRef.current.play().catch(() => { /* autoplay guard */ });
    }
  }, [remoteStream]);

  const sendChat = () => {
    const text = chatDraft.trim();
    if (!text) return;
    const channel = chatChannelRef.current;
    if (!channel) return;
    const id = `${meId}-${Date.now()}`;
    void channel.send({
      type: 'broadcast',
      event: 'chat',
      payload: { id, from: meId, name: myNameRef.current, text: text.slice(0, 300) },
    });
    /* self:false → the channel never echoes our own broadcast back,
       so append the line locally (the id keeps dedupe honest if a
       self-echo ever does arrive) */
    setChat((prev) => [...prev.slice(-80), { id, from: meId, name: myNameRef.current, text, mine: true }]);
    setChatDraft('');
  };

  const hostName = stream.host?.full_text_name || stream.host?.username || 'Host';

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-red-600 px-3 py-1 text-xs font-bold uppercase tracking-wide">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> Live
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{stream.title}</p>
            <p className="truncate text-xs text-white/60">
              {hostName} · <Users className="mb-0.5 inline h-3 w-3" /> {viewerCount}
            </p>
          </div>
        </div>
        <button
          onClick={leave}
          aria-label="Leave stream"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      <div className="relative flex-1 overflow-hidden bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={false}
          className="h-full w-full object-contain"
        />

        {!remoteStream && !error && !hostEnded && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="animate-pulse text-sm text-white/60">Connecting to the stream…</p>
          </div>
        )}

        {hostEnded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 px-6 text-center">
            <p className="text-lg font-bold">Stream ended</p>
            <p className="text-sm text-white/60">{hostName} closed the broadcast.</p>
            <button
              onClick={leave}
              className="mt-2 rounded-xl bg-white px-6 py-2.5 text-sm font-bold text-black"
            >
              Back to videos
            </button>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 px-6 text-center">
            <p className="text-sm text-red-300">{error}</p>
            <button
              onClick={leave}
              className="rounded-xl bg-white px-6 py-2.5 text-sm font-bold text-black"
            >
              Back to videos
            </button>
          </div>
        )}
      </div>

      {/* live chat */}
      <div className="flex h-52 shrink-0 flex-col border-t border-white/10">
        <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
          {chat.length === 0 && (
            <p className="text-xs text-white/40">Say something nice — chat is visible to everyone here.</p>
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
            placeholder="Say something…"
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
    </div>
  );
}
