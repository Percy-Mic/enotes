'use client';

import React, { useState } from 'react';
import { Check, Loader2, Palette, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { CHAT_THEMES } from '@/lib/assets';
import type { ChatThemeRow } from '@/types/social';

interface ChatThemePickerProps {
  conversationId: string;
  myId: string;
  current: ChatThemeRow | null;
  onClose: () => void;
  onSaved: (theme: ChatThemeRow | null) => void;
}

export default function ChatThemePicker({ conversationId, myId, current, onClose, onSaved }: ChatThemePickerProps) {
  const [saving, setSaving] = useState(false);
  const [custom, setCustom] = useState({
    background_color: current?.background_color || '',
    bubble_color_mine: current?.bubble_color_mine || '',
    bubble_color_theirs: current?.bubble_color_theirs || '',
    accent_color: current?.accent_color || '',
    bubble_style: current?.bubble_style || 'rounded',
  });

  const save = async (theme: Partial<ChatThemeRow> | null, presetName?: string) => {
    setSaving(true);
    const payload = theme
      ? {
          conversation_id: conversationId,
          user_id: myId,
          background_color: theme.background_color ?? null,
          bubble_color_mine: theme.bubble_color_mine ?? null,
          bubble_color_theirs: theme.bubble_color_theirs ?? null,
          text_color_mine: theme.text_color_mine ?? null,
          text_color_theirs: theme.text_color_theirs ?? null,
          accent_color: theme.accent_color ?? null,
          bubble_style: theme.bubble_style ?? 'rounded',
        }
      : null; // null → reset to default

    const { data, error } = payload
      ? await supabase
          .from('chat_themes')
          .upsert(payload, { onConflict: 'conversation_id,user_id' })
          .select()
          .maybeSingle()
      : await supabase
          .from('chat_themes')
          .delete()
          .eq('conversation_id', conversationId)
          .eq('user_id', myId)
          .then(() => ({ data: null, error: null }));

    setSaving(false);
    if (!error) {
      onSaved(data ? (data as ChatThemeRow) : null);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Chat theme">
      <div className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-bold">
            <Palette className="h-4 w-4 text-[#E5798F]" /> Chat theme
          </h2>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-gray-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mb-3 text-xs text-[#6B6B6B]">
          Themes are personal — each person in the chat picks their own look.
        </p>

        {/* presets */}
        <div className="grid grid-cols-2 gap-2">
          {CHAT_THEMES.map((t) => {
            const selected =
              (current?.background_color || '') === (t.background.startsWith('linear') ? '' : t.background) &&
              current?.accent_color === t.accent;
            return (
              <button
                key={t.id}
                onClick={() => save({
                  background_color: t.background.startsWith('linear') ? null : t.background,
                  background_url: undefined,
                  bubble_color_mine: t.bubbleMine,
                  bubble_color_theirs: t.bubbleTheirs,
                  text_color_mine: t.textMine,
                  text_color_theirs: t.textTheirs,
                  accent_color: t.accent,
                  bubble_style: t.bubbleStyle,
                })}
                disabled={saving}
                className="relative overflow-hidden rounded-xl border-2 p-3 text-left transition disabled:opacity-50"
                style={{ borderColor: selected ? t.accent : '#E8E2E4' }}
              >
                <div className="mb-2 h-12 rounded-lg" style={{ background: t.background }} />
                <p className="flex items-center justify-between text-xs font-bold">
                  {t.name}
                  {selected && <Check className="h-3.5 w-3.5 text-emerald-500" />}
                </p>
                <div className="mt-1.5 flex gap-1">
                  <span className="h-3 w-6 rounded-full" style={{ background: t.bubbleMine }} />
                  <span className="h-3 w-6 rounded-full border border-gray-200" style={{ background: t.bubbleTheirs }} />
                  <span className="h-3 w-3 rounded-full" style={{ background: t.accent }} />
                </div>
              </button>
            );
          })}
        </div>

        {/* custom */}
        <div className="mt-4 border-t border-[#F0EAEC] pt-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-[#6B6B6B]">Custom</h3>
          <div className="grid grid-cols-2 gap-2 text-xs font-semibold">
            <label className="space-y-1">
              Background
              <input type="color" value={custom.background_color || '#FFF7F8'} onChange={(e) => setCustom({ ...custom, background_color: e.target.value })} className="h-9 w-full rounded border p-0.5" />
            </label>
            <label className="space-y-1">
              My bubble
              <input type="color" value={custom.bubble_color_mine || '#2A211D'} onChange={(e) => setCustom({ ...custom, bubble_color_mine: e.target.value })} className="h-9 w-full rounded border p-0.5" />
            </label>
            <label className="space-y-1">
              Their bubble
              <input type="color" value={custom.bubble_color_theirs || '#FFFFFF'} onChange={(e) => setCustom({ ...custom, bubble_color_theirs: e.target.value })} className="h-9 w-full rounded border p-0.5" />
            </label>
            <label className="space-y-1">
              Accent
              <input type="color" value={custom.accent_color || '#E5798F'} onChange={(e) => setCustom({ ...custom, accent_color: e.target.value })} className="h-9 w-full rounded border p-0.5" />
            </label>
          </div>
          <button
            onClick={() => save(custom)}
            disabled={saving}
            className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-black py-2.5 text-sm font-bold text-[#FFB6C1] disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Apply custom theme
          </button>
        </div>

        {/* reset */}
        <button
          onClick={() => save(null)}
          className="mt-3 min-h-[44px] w-full rounded-xl border border-[#E8E2E4] py-2.5 text-sm font-semibold transition hover:bg-gray-50"
        >
          Reset to default
        </button>
      </div>
    </div>
  );
}
