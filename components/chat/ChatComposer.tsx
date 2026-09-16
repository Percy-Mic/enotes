'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, Mic, Pause, Play, Plus, Send, Smile, Sticker, Trash2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import EmojiPicker, { rememberEmoji } from '@/components/pickers/EmojiPicker';
import GifPicker, { type GifItem } from '@/components/pickers/GifPicker';
import StickerPicker from '@/components/pickers/StickerPicker';
import { uploadFile } from '@/lib/storage/upload';
import { useVoiceRecorder, recorderErrorMessage } from '@/lib/voice-recorder';
import type { MessageType } from '@/types/social';

export interface ComposerPayload {
  content: string;
  message_type: MessageType;
  media_url: string | null;
  media_type: string | null;
  media_name: string | null;
  reply_to_id: string | null;
  /** voice notes only — persisted on messages.duration_seconds */
  duration_seconds?: number;
}

interface ChatComposerProps {
  conversationId: string;
  myId: string;
  replyingTo: { id: string; content: string; author?: string } | null;
  onCancelReply: () => void;
  onSend: (payload: ComposerPayload) => Promise<void>;
  /** fires on keystrokes — powers the typing indicator (throttled by the parent) */
  onTyping?: (typing: boolean) => void;
}

/**
 * Chat composer: + · 😊 · GIF · Sticker · [input] · Send
 *
 * Behavior contract:
 * • Enter sends · Shift+Enter inserts a newline (desktop)
 * • Mobile virtual keyboards keep their native newline key — sends by button
 * • Textarea auto-grows to 5 lines max, then scrolls internally
 * • Draft + attachment are PRESERVED when a send fails (nothing is lost)
 * • Duplicate submissions impossible (sending flag + disabled button)
 * • Safe-area aware so mobile browsers never hide it behind a toolbar
 */
export default function ChatComposer({ conversationId, myId, replyingTo, onCancelReply, onSend, onTyping }: ChatComposerProps) {
  const [draft, setDraft] = useState('');
  const [panel, setPanel] = useState<'none' | 'emoji' | 'gif' | 'sticker'>('none');
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendingRef = useRef(false);

  /* ---------- voice notes ---------- */
  const recorder = useVoiceRecorder();
  const [voiceBlob, setVoiceBlob] = useState<{ blob: Blob; durationSeconds: number; mimeType: string } | null>(null);
  const [voicePreviewing, setVoicePreviewing] = useState(false);
  const voicePreviewRef = useRef<HTMLAudioElement | null>(null);

  const startRecording = async () => {
    setError(null);
    const ok = await recorder.start();
    if (!ok) setError(recorderErrorMessage(recorder.error) || 'Could not start recording.');
  };

  const finishRecording = async () => {
    const result = await recorder.stop();
    if (result) setVoiceBlob(result);
  };

  const discardVoice = () => {
    voicePreviewRef.current?.pause();
    voicePreviewRef.current = null;
    setVoicePreviewing(false);
    setVoiceBlob(null);
  };

  const previewVoice = () => {
    if (!voiceBlob) return;
    if (voicePreviewing) {
      voicePreviewRef.current?.pause();
      setVoicePreviewing(false);
      return;
    }
    const audio = new Audio(URL.createObjectURL(voiceBlob.blob));
    voicePreviewRef.current = audio;
    audio.onended = () => {
      setVoicePreviewing(false);
      URL.revokeObjectURL(audio.src);
    };
    void audio.play();
    setVoicePreviewing(true);
  };

  const fmtElapsed = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  /* per-conversation drafts survive navigation */
  const draftKey = `enotes:draft:${conversationId}`;
  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(draftKey);
      if (saved) setDraft(saved);
    } catch { /* storage unavailable */ }
    return () => {
      try { window.sessionStorage.removeItem(draftKey); } catch { /* ignore */ }
    };
  }, [draftKey]);

  const persistDraft = (value: string) => {
    setDraft(value);
    try {
      if (value) window.sessionStorage.setItem(draftKey, value);
      else window.sessionStorage.removeItem(draftKey);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setPanel('none');
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => {
    return () => {
      if (filePreview) URL.revokeObjectURL(filePreview);
    };
  }, [filePreview]);

  /* auto-grow textarea up to 5 lines */
  const autosize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);
  useEffect(autosize, [draft, autosize]);

  const attach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) {
      setError('File is too large — 25 MB maximum.');
      return;
    }
    setError(null);
    setFile(f);
    setFilePreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return f.type.startsWith('video/') || f.type.startsWith('image/') ? URL.createObjectURL(f) : '';
    });
  };

  const clearFile = () => {
    if (filePreview) URL.revokeObjectURL(filePreview);
    setFile(null);
    setFilePreview('');
  };

  const doSend = async () => {
    if (sendingRef.current) return; // hard guard against rapid double-taps
    if (!draft.trim() && !file && !voiceBlob) return;
    if (recorder.recording) return; // finish or cancel the recording first

    sendingRef.current = true;
    setSending(true);
    setError(null);

    /* snapshot — restored if anything fails so the user never loses work */
    const draftSnapshot = draft;
    const fileSnapshot = file;
    const previewSnapshot = filePreview;
    const voiceSnapshot = voiceBlob;
    const replySnapshot = replyingTo;

    try {
      let payload: ComposerPayload = {
        content: draft.trim(),
        message_type: 'text',
        media_url: null,
        media_type: null,
        media_name: null,
        reply_to_id: replySnapshot?.id || null,
      };

      if (voiceSnapshot) {
        setUploadingFile(true);
        const ext = voiceSnapshot.mimeType.includes('mp4') ? 'm4a' : 'webm';
        const voiceFile = new File([voiceSnapshot.blob], `voice-note.${ext}`, { type: voiceSnapshot.mimeType.split(';')[0] });
        const upload = await uploadFile(voiceFile, 'chat-media', myId);
        setUploadingFile(false);
        payload = {
          ...payload,
          message_type: 'audio',
          media_url: upload.url,
          media_type: voiceFile.type,
          media_name: `Voice note (${fmtElapsed(voiceSnapshot.durationSeconds)})`,
          content: `Voice note · ${fmtElapsed(voiceSnapshot.durationSeconds)}`,
          duration_seconds: voiceSnapshot.durationSeconds,
        };
      } else if (fileSnapshot) {
        setUploadingFile(true);
        const kind: MessageType = fileSnapshot.type.startsWith('image/')
          ? 'image'
          : fileSnapshot.type.startsWith('video/')
            ? 'video'
            : fileSnapshot.type.startsWith('audio/')
              ? 'audio'
              : 'file';
        const upload = await uploadFile(fileSnapshot, 'chat-media', myId);
        setUploadingFile(false);
        payload = {
          ...payload,
          message_type: kind,
          media_url: upload.url,
          media_type: fileSnapshot.type,
          media_name: fileSnapshot.name,
          content: payload.content || fileSnapshot.name,
        };
      }

      await onSend(payload);

      /* success — clear everything */
      persistDraft('');
      if (previewSnapshot) URL.revokeObjectURL(previewSnapshot);
      setFile(null);
      setFilePreview('');
      discardVoice();
      onCancelReply();
      onTyping?.(false);
    } catch (err: unknown) {
      /* FAILURE — restore draft + attachment exactly as they were */
      setError(err instanceof Error ? err.message : 'Could not send — try again.');
      setUploadingFile(false);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  /* Enter sends, Shift+Enter makes a newline (desktop behavior;
     touch keyboards keep their native action + green send button) */
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      const coarse = window.matchMedia?.('(pointer: coarse)').matches;
      if (!coarse) {
        e.preventDefault();
        void doSend();
      }
    }
  };

  const sendSticker = async (value: string) => {
    setPanel('none');
    await onSend({
      content: value,
      message_type: 'sticker',
      media_url: null,
      media_type: null,
      media_name: null,
      reply_to_id: replyingTo?.id || null,
    });
  };

  const sendGif = async (gif: GifItem) => {
    setPanel('none');
    await onSend({
      content: gif.description || 'GIF',
      message_type: 'gif',
      media_url: gif.url,
      media_type: 'image/gif',
      media_name: null,
      reply_to_id: replyingTo?.id || null,
    });
  };

  const insertEmoji = (emoji: string) => {
    rememberEmoji(emoji);
    persistDraft(draft + emoji);
    textareaRef.current?.focus();
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); void doSend(); }}
      className="relative border-t border-[#E8E2E4] bg-white/95 px-3 pt-2.5 backdrop-blur"
      style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom))' }}
    >
      {/* Reply preview */}
      {replyingTo && (
        <div className="mx-auto mb-2 flex max-w-2xl items-center gap-2 rounded-xl border-l-4 border-[#E5798F] bg-[#FFF7F8] px-3 py-2">
          <p className="min-w-0 flex-1 truncate text-xs text-[#6B6B6B]">
            Replying to <b>{replyingTo.author || 'message'}</b>: {replyingTo.content}
          </p>
          <button type="button" onClick={onCancelReply} className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-gray-100" aria-label="Cancel reply">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Attachment preview */}
      {file && (
        <div className="mx-auto mb-2 flex max-w-2xl items-center gap-3 rounded-xl border border-[#E8E2E4] bg-white p-2">
          {file.type.startsWith('video/') ? (
            <video src={filePreview} className="h-14 w-14 rounded-lg object-cover" muted />
          ) : file.type.startsWith('image/') ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={filePreview} alt="Attachment" className="h-14 w-14 rounded-lg object-cover" />
          ) : (
            <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-gray-100 text-[10px] font-bold">{file.type.split('/')[1]?.slice(0, 4) || 'FILE'}</span>
          )}
          <p className="min-w-0 flex-1 truncate text-xs text-[#6B6B6B]">{file.name}</p>
          <button type="button" onClick={clearFile} aria-label="Remove attachment" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="mx-auto mb-2 max-w-2xl rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-600">
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-2 font-bold underline">dismiss</button>
        </p>
      )}

      {/* Mobile (< sm): everything that must stay reachable sits in a tight
          action row that can scroll horizontally if ever needed; the textarea
          lives on its own line and ALWAYS gets real width — at 320px it has
          the full row instead of being crushed by four 44px buttons. Desktop
          (≥ sm) keeps the classic one-row layout. */}
      <div className="mx-auto flex w-full max-w-2xl items-end gap-1.5 max-sm:flex-col-reverse max-sm:items-stretch max-sm:gap-1">
        {/* Left action cluster — desktop inline / mobile horizontal row */}
        <div className="flex min-w-0 max-sm:items-center max-sm:gap-1 max-sm:overflow-x-auto max-sm:py-0.5">
          {/* + button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#E8E2E4] text-[#6B6B6B] transition hover:bg-gray-50 disabled:opacity-40 max-sm:h-10 max-sm:w-10"
            aria-label="Attach photo, video or file"
          >
            <Plus className="h-5 w-5" />
          </button>

          <input ref={mediaInputRef} type="file" accept="image/*,video/*" onChange={attach} className="hidden" aria-hidden="true" />
          <input ref={fileInputRef} type="file" onChange={attach} className="hidden" aria-hidden="true" />

          {/* voice recorder — hidden while a recording is active */}
          {!recorder.recording && (
            <button
              type="button"
              onClick={() => void startRecording()}
              disabled={sending}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#6B6B6B] transition hover:bg-gray-50 disabled:opacity-40"
              aria-label="Record a voice note"
            >
              <Mic className="h-5 w-5" />
            </button>
          )}

          {/* emoji */}
          <button
            type="button"
            onClick={() => setPanel(panel === 'emoji' ? 'none' : 'emoji')}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#6B6B6B] transition hover:bg-gray-50"
            aria-label="Emoji"
            aria-expanded={panel === 'emoji'}
          >
            <Smile className="h-5 w-5" />
          </button>
          {panel === 'emoji' && (
            <div className="picker-sheet">
              <EmojiPicker onPick={insertEmoji} />
            </div>
          )}

          {/* gif */}
          <button
            type="button"
            onClick={() => setPanel(panel === 'gif' ? 'none' : 'gif')}
            className="flex h-10 shrink-0 items-center rounded-full px-2.5 text-xs font-extrabold tracking-wide text-[#6B6B6B] transition hover:bg-gray-50"
            aria-label="GIF"
            aria-expanded={panel === 'gif'}
          >
            GIF
          </button>
          {panel === 'gif' && (
            <div className="picker-sheet">
              <GifPicker onPick={sendGif} />
            </div>
          )}

          {/* sticker */}
          <button
            type="button"
            onClick={() => setPanel(panel === 'sticker' ? 'none' : 'sticker')}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#6B6B6B] transition hover:bg-gray-50"
            aria-label="Sticker"
            aria-expanded={panel === 'sticker'}
          >
            <Sticker className="h-5 w-5" />
          </button>
          {panel === 'sticker' && (
            <div className="picker-sheet">
              <StickerPicker onPick={sendSticker} />
            </div>
          )}
        </div>

        {/* text input — auto-growing; on mobile it owns the full width */}
        <textarea
          ref={textareaRef}
          value={draft}
          rows={1}
          onChange={(e) => {
            persistDraft(e.target.value);
            onTyping?.(e.target.value.length > 0);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => onTyping?.(false)}
          placeholder="Write a message…"
          className="max-h-[120px] w-full min-w-0 flex-1 resize-none rounded-2xl border border-[#E8E2E4] px-4 py-2.5 text-base leading-6 focus:border-[#1E90FF] focus:outline-none max-sm:order-first max-sm:w-full"
          aria-label="Message"
        />

        {/* voice note preview — recorded and ready */}
        {voiceBlob && !recorder.recording && (
          <div className="mx-auto mb-2 flex max-w-2xl items-center gap-3 rounded-xl border border-[#E8E2E4] bg-white p-2">
            <button
              type="button"
              onClick={previewVoice}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#E5798F] text-white"
              aria-label={voicePreviewing ? 'Stop preview' : 'Preview voice note'}
            >
              {voicePreviewing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
            </button>
            <p className="min-w-0 flex-1 truncate text-xs text-[#6B6B6B]">
              Voice note · {fmtElapsed(voiceBlob.durationSeconds)}
            </p>
            <button
              type="button"
              onClick={discardVoice}
              className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-gray-100"
              aria-label="Discard voice note"
            >
              <Trash2 className="h-4 w-4 text-red-500" />
            </button>
          </div>
        )}

        {/* live recording bar */}
        {recorder.recording && (
          <div className="mx-auto mb-2 flex max-w-2xl items-center gap-3 rounded-xl border border-[#E5798F] bg-[#FFF0F3] p-2">
            <span className="h-3 w-3 shrink-0 animate-pulse rounded-full bg-red-500" aria-hidden="true" />
            <p className="min-w-0 flex-1 text-xs font-semibold text-[#E5798F] tabular-nums">
              Recording {fmtElapsed(recorder.elapsed)}
            </p>
            <button
              type="button"
              onClick={recorder.cancel}
              className="flex h-9 items-center gap-1 rounded-full border border-[#E8E2E4] bg-white px-3 text-xs font-semibold text-[#6B6B6B]"
              aria-label="Cancel recording"
            >
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
            <button
              type="button"
              onClick={() => void finishRecording()}
              className="flex h-9 items-center gap-1 rounded-full bg-black px-3 text-xs font-semibold text-[#FFB6C1]"
              aria-label="Stop recording"
            >
              <Check className="h-3.5 w-3.5" /> Done
            </button>
          </div>
        )}

        {/* send */}
        <button
          type="submit"
          disabled={sending || uploadingFile || recorder.recording || (!draft.trim() && !file && !voiceBlob)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black text-[#FFB6C1] shadow transition hover:opacity-90 disabled:opacity-40 max-sm:absolute max-sm:right-3 max-sm:bottom-[4.6rem]"
          aria-label={sending ? 'Sending…' : 'Send message'}
        >
          {sending || uploadingFile ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
        </button>
      </div>

      {/* desktop hint */}
      <p className="mx-auto mt-1 hidden max-w-2xl text-right text-[10px] text-[#9B9B9B] sm:block">
        <kbd className="rounded border px-1">Enter</kbd> to send · <kbd className="rounded border px-1">Shift+Enter</kbd> for a new line
      </p>
    </form>
  );
}
