'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeftRight, Check, CheckCheck, Copy, CornerUpLeft, Crown, EyeOff, FileText, Image, Loader2, LogOut, MoreHorizontal, Pencil, Shield, Smile, Trash2, UserPlus, UserMinus, Video, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import type { Message } from '@/types/social';
import Avatar from '@/components/social/Avatar';
import VoiceMessageBubble from '@/components/chat/VoiceMessageBubble';
import type { ChatTheme } from '@/lib/assets';

const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '👏', '🔥', '🎉', '👍', '😍', '🥳', '🙏', '💯'];

/** Split message text into plain parts and http(s) links so URLs are
    tappable — chat is where people share links, and plain text made them
    dead ends. Same split style PostCard's RichText uses for posts. */
function Linkified({ text, textColor }: { text: string; textColor: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noreferrer noopener"
            className="break-all underline underline-offset-2"
            style={{ color: textColor, opacity: 0.95 }}
            onClick={(e) => e.stopPropagation()}
          >
            {part.length > 48 ? `${part.slice(0, 45)}…` : part}
          </a>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}

/* Icon for a system message, chosen from its text (server-free so it
   renders identically for every member and survives message edits). */
function systemIcon(content: string) {
  const t = content.toLowerCase();
  if (/\b(added|joined)\b/.test(t)) return UserPlus;
  if (/\bleft\b/.test(t)) return LogOut;
  if (/\bremoved\b/.test(t)) return UserMinus;
  if (/\b(ownership|owner)\b/.test(t)) return Crown;
  if (/\b(promoted|demoted|admin)\b/.test(t)) return Shield;
  if (/\b(group name|group photo|renamed)\b/.test(t)) return Image;
  if (/\b(transferred|handed)\b/.test(t)) return ArrowLeftRight;
  return Shield;
}

/* Username cache for resolving plain display names in system messages to
   profile links. Shared across all rows for the page's lifetime. */
const systemNameCache = new Map<string, string>();

function SystemMessageText({ content }: { content: string }) {
  const [resolved, setResolved] = React.useState(false);

  useEffect(() => {
    if (resolved) return;
    let cancelled = false;
    const names = (content.match(/\b([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z.]+){0,3})\b/g) || [])
      .filter((n) => !/^(Yesterday|Today|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|The|You|Someone|An|A)$/i.test(n));
    const wanted = names.filter((n) => n.length > 1 && !systemNameCache.has(n));
    if (wanted.length === 0) { setResolved(true); return; }
    (async () => {
      for (const name of wanted.slice(0, 3)) {
        const { data } = await supabase
          .from('profiles')
          .select('username')
          .ilike('full_text_name', name)
          .limit(1);
        if (cancelled) return;
        systemNameCache.set(name, (data && data[0]?.username) || '');
      }
      if (!cancelled) setResolved(true);
    })();
    return () => { cancelled = true; };
  }, [content, resolved]);

  /* Split on @username tokens (exact, written by the app) plus display
     names once their username is known. Everything else is plain text. */
  const parts: Array<{ kind: 'text' | 'user'; value: string; username?: string }> = [];
  const re = /@([A-Za-z0-9_]{3,24})|\b([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z.]+){0,3})\b/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) parts.push({ kind: 'text', value: content.slice(last, m.index) });
    if (m[1]) {
      parts.push({ kind: 'user', value: '@' + m[1], username: m[1] });
    } else {
      const uname = systemNameCache.get(m[2]);
      if (uname) parts.push({ kind: 'user', value: m[2], username: uname });
      else parts.push({ kind: 'text', value: m[2] });
    }
    last = m.index + m[0].length;
  }
  if (last < content.length) parts.push({ kind: 'text', value: content.slice(last) });

  return (
    <>
      {parts.map((p, i) =>
        p.kind === 'user' ? (
          <Link
            key={i}
            href={`/u/${p.username}`}
            className="font-semibold underline underline-offset-2 hover:opacity-80"
          >
            {p.value}
          </Link>
        ) : (
          <React.Fragment key={i}>{p.value}</React.Fragment>
        )
      )}
    </>
  );
}

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
  onDeleteForMe: (message: Message) => Promise<void>;
  onForward: (message: Message) => void;
  showAvatar: boolean;
  onJoinGroupCall?: (conversationId: string, callId: string, hostId: string) => void;
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
  onDeleteForMe,
  onForward,
  showAvatar,
  onJoinGroupCall,
}: MessageRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  /* Tap/click anywhere OUTSIDE the sheet closes it. The pointerdown on a
     sheet button itself must NOT close — closing on pointerdown unmounts
     the button before its click fires, so Copy/Forward/Delete/React taps
     silently did nothing on real devices (programmatic .click() in tests
     skips pointerdown, which is how this slipped through). */
  useEffect(() => {
    if (!menuOpen && !showReactions) return;
    const close = (e: PointerEvent) => {
      if (sheetRef.current?.contains(e.target as Node)) return;
      setMenuOpen(false);
      setShowReactions(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menuOpen, showReactions]);
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
    /* Keep the sheet open so the button itself can show "Copied!" — closing
       immediately unmounted the feedback before it could render, so a successful
       copy looked like nothing happened. A rejected write (blocked webviews)
       used to throw uncaught; fall back to execCommand quietly. */
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        setMenuOpen(false);
      }, 1200);
    } catch {
      const ta = document.createElement('textarea');
      try {
        ta.value = message.content;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => {
          setCopied(false);
          setMenuOpen(false);
        }, 1200);
      } catch {
        setMenuOpen(false);
      } finally {
        ta.remove();
      }
    }
  };

  /* Date-aware: bare time only for today's messages; older ones carry the
     day (Yesterday / weekday / date) so context survives scrolling back. */
  const time = (() => {
    const d = new Date(message.created_at);
    const now = new Date();
    const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    const clock = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (sameDay) return clock;
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    const isYesterday = d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate();
    if (isYesterday) return `Yesterday ${clock}`;
    const days = Math.round((now.setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
    if (days > 0 && days < 7) return `${d.toLocaleDateString([], { weekday: 'short' })} ${clock}`;
    const sameYear = d.getFullYear() === now.getFullYear();
    return `${d.toLocaleDateString([], sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })} ${clock}`;
  })();

  /* Read receipt icon for my messages */
  const receipt = () => {
    if (!mine || !readReceiptsEnabled) return null;
    if (message.status === 'sending' || message.local) return <Loader2 className="h-3 w-3 animate-spin" />;
    if (message.read_at) return <CheckCheck className="h-3 w-3 text-sky-300" />;
    if (message.delivered_at) return <CheckCheck className="h-3 w-3" />;
    return <Check className="h-3 w-3" />;
  };

  /* System messages (joins, departures, removals, group edits, ownership
     changes) render as a centered pill with a small icon indicating the
     kind of event. Member names inside the text become tappable profile
     links: real ones are rendered by the writers as @username, and plain
     names are resolved to usernames via a cached profile lookup. */
  if (message.message_type === 'system' && !isDeleted) {
    const Icon = systemIcon(message.content);
    return (
      <li className="flex justify-center py-1" data-system-message="true">
        <span
          className="inline-flex max-w-[85%] items-center gap-1.5 rounded-full bg-black/5 px-3 py-1 text-center text-[11px] font-medium text-[#6B6B6B]"
          style={{ fontFamily: theme.fontFamily || undefined }}
        >
          <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
          <SystemMessageText content={message.content} />
        </span>
      </li>
    );
  }

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
          ) : message.message_type === 'call_invite' ? (
            (() => {
              try {
                const call = JSON.parse(message.content || '{}') as { callId?: string; conversationId?: string; hostId?: string };
                if (!call.callId || !call.conversationId || !call.hostId) return <p className="px-3.5 py-2.5 text-sm">Group video call</p>;
                return (
                  <div className="min-w-[240px] max-w-[320px] p-3.5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white" style={{ background: theme.accent }}>
                        <Video className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold">Group video call</p>
                        <p className="text-xs opacity-70">The call is still available.</p>
                      </div>
                    </div>
                    {onJoinGroupCall && (
                      <button onClick={() => onJoinGroupCall(call.conversationId!, call.callId!, call.hostId!)} className="mt-3 w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110" style={{ background: theme.accent }}>
                        Return to call
                      </button>
                    )}
                  </div>
                );
              } catch {
                return <p className="px-3.5 py-2.5 text-sm">Group video call</p>;
              }
            })()
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
                <VoiceMessageBubble message={message} theme={theme} />
              )}
              {message.media_url && message.message_type === 'file' && (
                <a href={message.media_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-3.5 py-2.5 underline">
                  <FileText className="h-4 w-4 shrink-0" /> {message.media_name || 'File'}
                </a>
              )}
              {message.message_type === 'sticker' ? (
                <p className="select-none px-2 py-1 text-6xl leading-none">{message.content}</p>
              ) : (
                message.content && message.message_type !== 'gif' && (
                  <p className="whitespace-pre-wrap break-words px-3.5 py-2.5 text-sm">
                    <Linkified text={message.content} textColor={textColor} />
                  </p>
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
            <button onClick={() => setMenuOpen((v) => !v)} className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow" aria-label="More" aria-expanded={menuOpen}>
              <MoreHorizontal className="h-4 w-4 text-[#6B6B6B]" />
            </button>
          </div>
        )}

        {/* Reactions + message actions: a full-width bottom sheet on ALL
            pointers. Anchored popovers clipped off-screen on narrow phones
            when the bubble sat near an edge; a sheet at the viewport bottom
            is physically incapable of clipping. Dismiss: scrim tap. */}
        {(showReactions || menuOpen) && (
          <>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Close"
              onClick={() => { setShowReactions(false); setMenuOpen(false); }}
              className="fixed inset-0 z-30 cursor-default bg-black/30"
            />
            <div
              ref={sheetRef}
              role="menu"
              className="fixed inset-x-0 bottom-0 z-40 rounded-t-2xl border-t border-[#E8E2E4] bg-white pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shadow-2xl"
            >
              <span className="mx-auto mb-2 block h-1 w-10 rounded-full bg-gray-300" aria-hidden="true" />
              {showReactions && (
                <div className="flex flex-wrap items-center justify-center gap-1 px-4 pb-1">
                  {QUICK_REACTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => {
                        onReact(message, emoji);
                        setShowReactions(false);
                      }}
                      className="flex h-11 w-11 items-center justify-center rounded-full text-2xl transition active:scale-125 hover:bg-gray-100"
                      aria-label={`React ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
              {menuOpen && (
                <div className="mx-auto max-w-sm px-2">
                  <button onClick={copyText} className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium hover:bg-gray-50">
                    <Copy className="h-4 w-4" /> {copied ? 'Copied!' : 'Copy text'}
                  </button>
                  <button onClick={() => { setMenuOpen(false); onForward(message); }} className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium hover:bg-gray-50">
                    <CornerUpLeft className="h-4 w-4 rotate-180" /> Forward
                  </button>
                  {mine && message.message_type === 'text' && (
                    <button onClick={() => { setMenuOpen(false); setEditing(true); }} className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium hover:bg-gray-50">
                      <Pencil className="h-4 w-4" /> Edit
                    </button>
                  )}
                  {/* delete for me: available on ANY message — hides only for
                      this account; the other member keeps their copy */}
                  <button onClick={() => { setMenuOpen(false); void onDeleteForMe(message); }} className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-amber-600 hover:bg-amber-50">
                    <EyeOff className="h-4 w-4" /> Delete for me
                  </button>
                  {mine && (
                    <button onClick={() => { setMenuOpen(false); void onDelete(message); }} className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-red-500 hover:bg-red-50">
                      <Trash2 className="h-4 w-4" /> Delete for everyone
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
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
