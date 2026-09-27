'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Lock, Pin, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import type { NoteRow } from '@/app/notes/page';

/**
 * NotesAside — the desktop Notes rail shown beside wide-screen content
 * (feed etc.), hidden below `xl`. Mobile keeps the dedicated /notes page;
 * this aside is a convenience surface, not a second database path: every
 * write goes through the same `notes` table (RLS: user_id = auth.uid()).
 */

function excerpt(content: string, len = 90): string {
  if (!content) return '';

  // Note content is rich text and can be stored either as real HTML
  // (<h2>...</h2>) or as HTML-escaped text (&lt;h2&gt;...).
  // Decode once, then read only the visible text for the sidebar.
  let source = String(content);
  if (typeof document !== 'undefined') {
    const decoder = document.createElement('textarea');
    decoder.innerHTML = source;
    source = decoder.value;

    const container = document.createElement('div');
    container.innerHTML = source;
    source = container.textContent || container.innerText || '';
  } else {
    source = source
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&')
      .replace(/<[^>]*>/g, ' ');
  }

  const flat = source.replace(/\s+/g, ' ').trim();
  return flat.length > len ? `${flat.slice(0, len)}…` : flat;
}
