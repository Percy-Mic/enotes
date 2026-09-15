'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Check, CheckCheck, Copy, CornerUpLeft, Loader2, MoreHorizontal, Pencil, Smile, Trash2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import type { Message } from '@/types/social';
import Avatar from '@/components/social/Avatar';
import type { ChatTheme } from '@/lib/assets';

const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '👏'];

interface MessageRowProps {
  message: Message;
  previous?: Message;
  isGroup: boolean;
  myId: string;
  theme: ChatTheme;
  readReceiptsEnabled: boolean;
  onReply: (message: Message) => void;
  onReact: (message: Message, emoji: string) => Promise<void>;
  onEdit: (message: Message, newContent: string) => Promise<void>;
  onDelete: (message: Message) => Promise<void>;
  onForward: (message: Message) => void;
  showAvatar: boolean;
}

export default function MessageRow({
  message,
  previous,
  isGroup,
  myId,
  theme,
  readReceiptsEnabled,
  onReply,
  onReact,
  onEdit,
  onDelete,
  onForward,
  showAvatar,
}: MessageRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(message.content);
  const [copied, setCopied] = useState(false);

  const mine = message.sender_id === myId;
  const isDeleted = !!message.deleted_at;
  const rounded = theme.bubbleStyle === 'pill' ? 'rounded-full px-4' : theme.bubbleStyle === 'square' ? 'rounded-none' : 'rounded-2xl';

  const bubbleColor = mine ? theme.bubbleMine : theme.bubbleTheirs;
  const textColor = mine ? theme.textMine : theme.textTheirs;
  const borderRadius = mine
    ? theme.bubbleStyle === 'square'
      ? '4px'
      : undefined
    : theme.bubbleStyle === 'square'
      ? '4px'
      : undefined;

  const copyText = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setMenuOpen(false);
    setTimeout(() => setCopied(false), 1400);
  };

  const time = new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  /* Read receipt icon for my messages */
  const receipt = () => {
    if (!mine || !readReceiptsEnabled) return null;
    if (message.status === 'sending' || message.local) return <Loader2 className="h-3 w-3 animate-spin" />;
    if (message.read_at) return <CheckCheck className="h-3 w-3 text-sky-300" />;
    if (message.delivered_at) return <CheckCheck className="h-3 w-3" />;
    return <Check className="h-3 w-3" />;
  };

  return (
    <li className={`flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'}`}>
      {!mine && isGroup && (
        <div className="w-8 shrink-0">
          {showAvatar && <Avatar src={message.sender?.avatar_url} name={message.sender?.full_text_name || message.sender?.username} size={32} />}
        </div>
      )}

      <div className={`group relative max-w-[80%] max-sm:max-w-[85%] ${mine ? 'items-end' : 'items-start'}`}>
        {isGroup && !mine && showAvatar && (
          <p className="mb-0.5 text-[10px] font-bold" style={{ color: theme.accent }}>
            <Link href={message.sender?.username ? `/u/${message.sender.username}` : '#'}>
              {message.sender?.full_text_name || message.sender?.username || 'Member'}
            </Link>
          </p>
        )}

        {/* Reply context */}
        {message.reply_to && (
          <div className="mb-1 rounded-lg border-l-2 px-2 py-1 text-[11px]" style={{ borderColor: theme.accent, background: 'rgba(0,0,0,0.04)', color: textColor === '#FFF7F8' ? '#ddd' : '#555' }}>
            <b>{message.reply_to.sender?.full_text_name || message.reply_to.sender?.username || 'Message'}</b>
            <p className="truncate">{message.reply_to.content || 'Attachment'}</p>
          </div>
        )}

        <div
          className={`inline-block max-w-full shadow-sm ${rounded} ${mine ? 'rounded-br-md' : 'rounded-bl-md'}`}
          style={{ background: isDeleted ? 'rgba(0,0,0,0.05)' : bubbleColor, color: isDeleted ? '#888' : textColor, borderRadius, fontFamily: theme.fontFamily || undefined }}
        >
          {/* message content */}
          {isDeleted ? (
            <p className="px-3.5 py-2.5 text-sm italic opacity-70">Message deleted</p>
          ) : (
            <>
              {message.media_url && (message.message_type === 'image' || message.message_type === 'gif') && (
                <a href={message.media_url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={message.media_url} alt={message.media_name || 'Photo'} loading="lazy" className={`max-h-72 w-full object-cover ${message.message_type === 'gif' ? '' : 'rounded-xl'}`} />
                </a>
              )}
              {message.media_url && message.message_type === 'video' && (
                <video src={message.media_url} controls playsInline preload="metadata" className="max-h-72 w-full rounded-xl bg-black" />
              )}
              {message.media_url && message.message_type === 'audio' && (
                <audio src={message.media_url} controls className="max-w-xs" />
              )}
              {message.media_url && message.message_type === 'file' && (
                <a href={message.media_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-3.5 py-2.5 underline">
                  📄 {message.media_name || 'File'}
                </a>
              )}
              {message.message_type === 'sticker' ? (
                <p className="select-none px-2 py-1 text-6xl leading-none">{message.content}</p>
              ) : (
                message.content && message.message_type !== 'gif' && (
                  <p className="whitespace-pre-wrap break-words px-3.5 py-2.5 text-sm">{message.content}</p>
                )
              )}
            </>
          )}

          {/* reactions under bubble */}
          {message.reactions && message.reactions.length > 0 && (
            <div className="mt-0.5 flex flex-wrap gap-1">
              {message.reactions.map((r) => (
                <button
                  key={r.emoji}
                  onClick={() => onReact(message, r.emoji)}
                  className={`flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] ${r.mine ? 'border-current bg-black/10' : 'border-black/10 bg-white/60'}`}
                  style={{ color: textColor }}
                  aria-label={`${r.emoji} ${r.count}`}
                >
                  {r.emoji} {r.count}
                </button>
              ))}
            </div>
          )}

          <p className={`px-3.5 pb-1.5 text-right text-[9px] ${mine ? 'opacity-60' : 'opacity-50'}`} style={{ color: textColor }}>
            {time} {receipt()}
          </p>
        </div>

        {/* hover/long-press toolbar — also always visible (dimmed) on touch:
            coarse pointers have no hover, so group-hover alone made reacting
            impossible on phones */}
        {!isDeleted && (
          <div className={`absolute top-0 ${mine ? '-left-14' : '-right-14'} hidden h-8 items-center gap-0.5 opacity-0 transition-opacity group-hover:flex group-hover:opacity-100 [@media(pointer:coarse)]:flex [@media(pointer:coarse)]:opacity-60`}>
            <button onClick={() => setShowReactions((v) => !v)} className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow" aria-label="React" aria-expanded={showReactions}>
              <Smile className="h-4 w-4 text-[#6B6B6B]" />
            </button>
            <button onClick={() => onReply(message)} className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow" aria-label="Reply">
              <CornerUpLeft className="h-4 w-4 text-[#6B6B6B]" />
            </button>
            <div className="relative">
              <button onClick={() => setMenuOpen((v) => !v)} className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow" aria-label="More" aria-expanded={menuOpen}>
                <MoreHorizontal className="h-4 w-4 text-[#6B6B6B]" />
              </button>
              {menuOpen && (
                <div className={`absolute z-30 mt-1 w-40 overflow-hidden rounded-xl border border-[#E8E2E4] bg-white py-1 shadow-lg ${mine ? 'right-0' : 'left-0'}`}>
                  <button onClick={copyText} className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-gray-50">
                    <Copy className="h-3.5 w-3.5" /> {copied ? 'Copied!' : 'Copy text'}
                  </button>
                  <button onClick={() => { setMenuOpen(false); onForward(message); }} className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-gray-50">
                    <CornerUpLeft className="h-3.5 w-3.5 rotate-180" /> Forward
                  </button>
                  {mine && message.message_type === 'text' && (
                    <button onClick={() => { setMenuOpen(false); setEditing(true); }} className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-gray-50">
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                  )}
                  {mine && (
                    <button onClick={() => { setMenuOpen(false); onDelete(message); }} className="flex w-full items-center gap-2 px-3 py-2 text-xs text-red-500 hover:bg-red-50">
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* reaction picker popover */}
        {showReactions && (
          <div className={`absolute z-30 mt-1 flex gap-1 rounded-2xl border border-[#E8E2E4] bg-white p-1.5 shadow-xl ${mine ? 'right-0' : 'left-0'}`}>
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => {
                  onReact(message, emoji);
                  setShowReactions(false);
                }}
                className="rounded-lg p-1 text-lg transition hover:scale-125"
                aria-label={`React ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        {/* inline edit */}
        {editing && (
          <div className="mt-1 flex items-center gap-1.5">
            <input
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              autoFocus
              className="w-56 rounded-full border border-[#E8E2E4] px-3 py-1.5 text-xs focus:border-[#1E90FF] focus:outline-none"
            />
            <button
              onClick={async () => {
                await onEdit(message, editDraft.trim());
                setEditing(false);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-black text-[#FFB6C1]"
              aria-label="Save edit"
            >
              <Check className="h-4 w-4" />
            </button>
            <button onClick={() => setEditing(false)} className="flex h-8 w-8 items-center justify-center rounded-full border" aria-label="Cancel edit">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
