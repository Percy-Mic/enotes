'use client';

import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import type { Message } from '@/types/social';

/**
 * Conversation media gallery: grid of every image/GIF/video in the chat
 * (newest first) with a full-screen lightbox. Keyboard + touch friendly
 * (large tap targets, arrow keys, Escape to close).
 */
export default function MediaGallery({
  media,
  onClose,
}: {
  media: Message[];
  onClose: () => void;
}) {
  const [index, setIndex] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (index !== null) setIndex(null);
        else onClose();
      }
      if (index !== null && e.key === 'ArrowLeft') setIndex((i) => (i === null ? null : Math.max(0, i - 1)));
      if (index !== null && e.key === 'ArrowRight') setIndex((i) => (i === null ? null : Math.min(media.length - 1, i + 1)));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, media.length, onClose]);

  const current = index !== null ? media[index] : null;

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-black/95 backdrop-blur-sm" role="dialog" aria-label="Shared media">
      {/* header */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <p className="text-sm font-bold text-white">Shared media</p>
          <p className="text-[11px] text-white/60">{media.length} item{media.length === 1 ? '' : 's'} in this chat</p>
        </div>
        <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full text-white transition hover:bg-white/10" aria-label="Close media gallery">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* grid */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="mx-auto grid max-w-3xl grid-cols-3 gap-1.5 sm:grid-cols-4">
          {media.map((m, i) => (
            <button
              key={m.id}
              onClick={() => setIndex(i)}
              className="relative aspect-square overflow-hidden rounded-lg bg-white/5 transition hover:ring-2 hover:ring-[#E5798F]"
              aria-label={`Open ${m.message_type === 'video' ? 'video' : 'image'} ${i + 1}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={m.message_type === 'video' ? m.media_url! : m.media_url!}
                alt={m.media_name || 'Media'}
                loading="lazy"
                className="h-full w-full object-cover"
              />
              {m.message_type === 'video' && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white">▶</span>
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* lightbox */}
      {current && (
        <div className="fixed inset-0 z-[95] flex flex-col bg-black" role="dialog" aria-label="Media viewer">
          <div className="flex items-center justify-between px-3 py-2.5">
            <p className="text-xs text-white/70">
              {new Date(current.created_at).toLocaleString()} · {current.sender?.full_text_name || current.sender?.username || ''}
            </p>
            <div className="flex items-center gap-1">
              <a
                href={current.media_url!}
                target="_blank"
                rel="noreferrer"
                download
                className="flex h-10 w-10 items-center justify-center rounded-full text-white transition hover:bg-white/10"
                aria-label="Open or download"
              >
                <Download className="h-5 w-5" />
              </a>
              <button onClick={() => setIndex(null)} className="flex h-10 w-10 items-center justify-center rounded-full text-white transition hover:bg-white/10" aria-label="Back to grid">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          <div className="relative flex flex-1 items-center justify-center px-2 pb-4">
            {index !== null && index > 0 && (
              <button
                onClick={() => setIndex(index - 1)}
                className="absolute left-2 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                aria-label="Previous media"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
            )}
            {current.message_type === 'video' ? (
              <video src={current.media_url!} controls autoPlay playsInline className="max-h-full max-w-full rounded-lg" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={current.media_url!} alt={current.media_name || 'Media'} className="max-h-full max-w-full rounded-lg object-contain" />
            )}
            {index !== null && index < media.length - 1 && (
              <button
                onClick={() => setIndex(index + 1)}
                className="absolute right-2 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                aria-label="Next media"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
