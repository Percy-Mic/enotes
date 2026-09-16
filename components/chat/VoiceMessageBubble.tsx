'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Pause, Play } from 'lucide-react';
import type { Message } from '@/types/social';
import type { ChatTheme } from '@/lib/assets';

/**
 * Voice-message bubble: progress bar, play/pause, duration. Replaces the raw
 * <audio controls> element for message_type === 'audio' — native controls
 * don't match the chat design and expose no duration for WebM voice notes
 * (Chrome reports Infinity; we read durationSeconds persisted on the message
 * and fall back to the known blob duration the sender measured at record
 * time — see ChatComposer).
 */

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const BARS = 28;

export default function VoiceMessageBubble({ message, theme }: { message: Message; theme: ChatTheme }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState<number>(() => {
    const d = (message as unknown as { duration_seconds?: number | null }).duration_seconds;
    return Number.isFinite(Number(d)) && Number(d) > 0 ? Number(d) : 0;
  });

  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.src = message.media_url || '';
    audioRef.current = audio;

    const onLoaded = () => {
      // Chrome gives Infinity for recorded webm — only trust finite values.
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
      setLoading(false);
    };
    const onTime = () => setPosition(audio.currentTime);
    const onEnd = () => {
      setPlaying(false);
      setPosition(0);
    };
    const onError = () => setLoading(false);

    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnd);
    audio.addEventListener('error', onError);

    return () => {
      audio.pause();
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnd);
      audio.removeEventListener('error', onError);
      audioRef.current = null;
    };
  }, [message.media_url]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      setLoading(true);
      void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  };

  const seek = (fraction: number) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const t = Math.max(0, Math.min(1, fraction)) * duration;
    audio.currentTime = t;
    setPosition(t);
  };

  const progress = duration > 0 ? Math.min(1, position / duration) : 0;
  const textColor = message.sender_id === message.sender_id ? undefined : undefined; // theme handled below

  return (
    <div className="flex min-w-[220px] items-center gap-3 px-3 py-2.5" style={{ color: textColor }}>
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
        style={{ background: theme.accent, color: '#fff' }}
      >
        {loading && !playing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : playing ? (
          <Pause className="h-4 w-4 fill-current" />
        ) : (
          <Play className="h-4 w-4 fill-current" />
        )}
      </button>

      {/* fake-waveform progress: bar heights are deterministic per index */}
      <button
        type="button"
        aria-label="Seek within voice message"
        className="flex h-8 flex-1 items-center gap-[2px]"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          seek((e.clientX - rect.left) / rect.width);
        }}
      >
        {Array.from({ length: BARS }).map((_, i) => {
          const heights = [8, 14, 20, 12, 24, 16, 10, 22, 28, 18, 12, 20, 26, 14, 9, 17, 23, 13, 21, 15, 27, 19, 11, 16, 24, 12, 18, 10];
          const h = heights[i % heights.length];
          const active = i / BARS <= progress;
          return (
            <span
              key={i}
              className="w-[3px] rounded-full transition-colors"
              style={{ height: `${h}px`, background: active ? theme.accent : 'currentColor', opacity: active ? 1 : 0.28 }}
            />
          );
        })}
      </button>

      <span className="w-10 shrink-0 text-right text-[11px] font-semibold tabular-nums opacity-70">
        {fmt(playing || position > 0 ? position : duration)}
      </span>
    </div>
  );
}
