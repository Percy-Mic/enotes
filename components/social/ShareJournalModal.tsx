'use client';

import React, { useEffect, useState } from 'react';
import { Check, Copy, Link2, Lock, Send, Sparkles, UserPlus, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

interface ShareJournalModalProps {
  isOpen: boolean;
  onClose: () => void;
  journalId: string;
  journalTitle: string;
  /** Page to offer locking (current page of the book) */
  pageId?: string | null;
  pageNumber?: number | null;
  onShared?: () => void;
}

type Tab = 'link' | 'feed' | 'user' | 'lock';

export default function ShareJournalModal({
  isOpen,
  onClose,
  journalId,
  journalTitle,
  pageId,
  pageNumber,
  onShared,
}: ShareJournalModalProps) {
  const [tab, setTab] = useState<Tab>('link');
  const [visibility, setVisibility] = useState<string>('private');
  const [copied, setCopied] = useState(false);
  const [postContent, setPostContent] = useState('');
  const [posting, setPosting] = useState(false);
  const [username, setUsername] = useState('');
  const [canEdit, setCanEdit] = useState(false);
  const [userStatus, setUserStatus] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [pin, setPin] = useState('');
  const [lockStatus, setLockStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      const { data } = await supabase
        .from('journals')
        .select('visibility')
        .eq('id', journalId)
        .maybeSingle();
      setVisibility(data?.visibility || 'private');

      if (pageId) {
        const { data: rpcData } = await supabase.rpc('get_page_lock', { p_page_id: pageId });
        setLocked(!!(rpcData && rpcData.length > 0 && (rpcData[0] as any).locked));
      }
    })();
  }, [isOpen, journalId, pageId]);

  if (!isOpen) return null;

  const shareUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/journals/${journalId}` : '';

  const copyLink = async () => {
    const next = visibility === 'private' ? 'link' : visibility;
    if (visibility === 'private') {
      const { error } = await supabase.from('journals').update({ visibility: 'link' }).eq('id', journalId);
      if (!error) setVisibility('link');
      void next;
    }
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareToFeed = async (e: React.FormEvent) => {
    e.preventDefault();
    setPosting(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setPosting(false);
      return;
    }

    let pageIdToPost = pageId || null;

    /* Without a specific page, share the first page as the preview target */
    if (!pageIdToPost) {
      const { data: firstPage } = await supabase
        .from('journal_pages')
        .select('id')
        .eq('journal_id', journalId)
        .order('page_number', { ascending: true })
        .limit(1)
        .maybeSingle();
      pageIdToPost = firstPage?.id || null;
    }

    /* Feed posts of private journals flip the journal to link-visible */
    if (visibility === 'private') {
      await supabase.from('journals').update({ visibility: 'link' }).eq('id', journalId);
      setVisibility('link');
    }

    const { error } = await supabase.from('posts').insert({
      author_id: user.id,
      journal_id: journalId,
      page_id: pageIdToPost,
      content: postContent.trim(),
      visibility: 'public',
    });

    setPosting(false);

    if (error) {
      setUserStatus(`Could not post: ${error.message}`);
      return;
    }

    setUserStatus(null);
    setPostContent('');
    onShared?.();
    onClose();
  };

  const shareWithUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserStatus(null);

    const handle = username.trim().replace(/^@/, '');
    if (!handle) return;

    const { data: target } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', handle)
      .maybeSingle();

    if (!target) {
      setUserStatus(`No user found with the username “${handle}”.`);
      return;
    }

    /* Upsert the share row (one row per journal + recipient) */
    const { error } = await supabase.from('journal_shares').upsert(
      {
        journal_id: journalId,
        shared_with: target.id,
        can_edit: canEdit,
      },
      { onConflict: 'journal_id,shared_with' },
    );

    if (error) {
      setUserStatus(`Could not share: ${error.message}`);
      return;
    }

    /* Notify the recipient */
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('notifications').insert({
        user_id: target.id,
        actor_id: user.id,
        type: 'share',
        entity_type: 'journal',
        entity_id: journalId,
        message: `shared the journal “${journalTitle}” with you`,
      });
    }

    setUserStatus(`Shared with @${handle} ✓`);
    setUsername('');
    onShared?.();
  };

  const toggleLock = async (next: boolean) => {
    setLockStatus(null);

    if (!pageId) {
      setLockStatus('Open a page in the book first, then lock it here.');
      return;
    }

    const { error } = await supabase.rpc('set_page_lock', {
      p_page_id: pageId,
      p_locked: next,
      p_pin: pin.trim() || null,
    });

    if (error) {
      setLockStatus(`Could not update lock: ${error.message}`);
      return;
    }

    setLocked(next);
    setPin('');
    setLockStatus(next ? `Page ${pageNumber ?? ''} locked 🔒` : 'Page unlocked');
  };

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'link', label: 'Link', icon: <Link2 className="h-4 w-4" /> },
    { id: 'feed', label: 'Feed', icon: <Sparkles className="h-4 w-4" /> },
    { id: 'user', label: 'User', icon: <UserPlus className="h-4 w-4" /> },
    { id: 'lock', label: 'Lock', icon: <Lock className="h-4 w-4" /> },
  ];

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-[20px] border border-[#E8E2E4] bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#F0EAEC] p-4">
          <h2 className="font-bold">Share “{journalTitle}”</h2>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-gray-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-[#F0EAEC] px-3 pt-3">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-t-lg px-2 text-xs font-bold transition ${
                tab === t.id ? 'border-b-2 border-[#E5798F] bg-[#FFF7F8] text-[#111111]' : 'text-[#6B6B6B] hover:bg-gray-50'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        <div className="space-y-4 p-4">
          {/* LINK */}
          {tab === 'link' && (
            <>
              <p className="text-sm text-[#6B6B6B]">
                Anyone with this link can open your journal in view-only mode.
              </p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={shareUrl}
                  className="min-w-0 flex-1 truncate rounded-lg border border-[#E8E2E4] bg-gray-50 px-3 py-2.5 text-xs text-[#6B6B6B]"
                />
                <button
                  onClick={copyLink}
                  className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-[#FFB6C1] transition hover:opacity-90"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="text-xs text-[#9B9B9B]">
                {visibility === 'private'
                  ? 'Copying will switch this journal from Private to “Anyone with the link”.'
                  : `Current visibility: ${visibility === 'link' ? 'Anyone with the link' : visibility}.`}
              </p>
            </>
          )}

          {/* FEED */}
          {tab === 'feed' && (
            <form onSubmit={shareToFeed} className="space-y-3">
              <p className="text-sm text-[#6B6B6B]">
                Post this journal to your profile and the feed. Readers can open the linked page.
              </p>
              <textarea
                value={postContent}
                onChange={(e) => setPostContent(e.target.value)}
                placeholder="Tell everyone about this journal…"
                className="h-24 w-full resize-none rounded-lg border border-[#E8E2E4] px-3 py-2.5 text-sm focus:border-[#1E90FF] focus:outline-none"
              />
              <button
                type="submit"
                disabled={posting}
                className="w-full rounded-xl bg-black py-3 text-sm font-semibold text-[#FFB6C1] shadow transition hover:opacity-90 disabled:opacity-50"
              >
                {posting ? 'Posting…' : 'Share to feed'}
              </button>
            </form>
          )}

          {/* USER */}
          {tab === 'user' && (
            <form onSubmit={shareWithUser} className="space-y-3">
              <p className="text-sm text-[#6B6B6B]">
                Share privately with one person. They&apos;ll get a notification.
              </p>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="their username, e.g. alex"
                autoCapitalize="none"
                className="w-full rounded-lg border border-[#E8E2E4] px-3 py-2.5 text-sm focus:border-[#1E90FF] focus:outline-none"
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={canEdit}
                  onChange={(e) => setCanEdit(e.target.checked)}
                  className="h-4 w-4"
                />
                Also let them edit pages
              </label>
              <button
                type="submit"
                className="w-full rounded-xl bg-black py-3 text-sm font-semibold text-[#FFB6C1] shadow transition hover:opacity-90"
              >
                <Send className="mr-1.5 inline h-4 w-4" />
                Share with user
              </button>
              {userStatus && <p className="text-xs font-semibold text-[#6B6B6B]">{userStatus}</p>}
            </form>
          )}

          {/* LOCK */}
          {tab === 'lock' && (
            <div className="space-y-3">
              <p className="text-sm text-[#6B6B6B]">
                {pageId
                  ? `Lock page ${pageNumber ?? ''} behind a PIN. Readers must enter it once to view.`
                  : 'Open the book on the page you want to lock, then come back here.'}
              </p>
              <input
                type="text"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="PIN (optional, e.g. 4 digits)"
                maxLength={12}
                className="w-full rounded-lg border border-[#E8E2E4] px-3 py-2.5 text-sm focus:border-[#1E90FF] focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => toggleLock(true)}
                  disabled={!pageId}
                  className="flex-1 rounded-xl bg-black py-3 text-sm font-semibold text-[#FFB6C1] shadow transition hover:opacity-90 disabled:opacity-40"
                >
                  <Lock className="mr-1.5 inline h-4 w-4" />
                  {locked ? 'Update lock' : 'Lock page'}
                </button>
                {locked && (
                  <button
                    onClick={() => toggleLock(false)}
                    className="flex-1 rounded-xl border border-[#E8E2E4] py-3 text-sm font-semibold transition hover:bg-gray-50"
                  >
                    Remove lock
                  </button>
                )}
              </div>
              {lockStatus && <p className="text-xs font-semibold text-[#6B6B6B]">{lockStatus}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
