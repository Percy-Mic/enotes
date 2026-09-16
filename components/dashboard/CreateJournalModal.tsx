'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

interface CreateJournalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export const CreateJournalModal: React.FC<CreateJournalModalProps> = ({ isOpen, onClose, onCreated }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      setError('You must be signed in to create a journal.');
      setLoading(false);
      return;
    }

    const { error: insertError } = await supabase.from('journals').insert({
      title,
      description,
      owner_id: user.id,
      visibility: 'private',
    });

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
    } else {
      setTitle('');
      setDescription('');
      onCreated();
      onClose();
      router.push('/journals');
      router.refresh();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Create a new journal"
    >
      <div
        className="max-h-[calc(100dvh-2rem)] w-full max-w-md space-y-6 overflow-y-auto rounded-[20px] border border-[#E8E2E4] bg-white p-6 shadow-2xl sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-[#111111] sm:text-xl">Create a new journal ♡</h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#6B6B6B] transition hover:bg-gray-100 hover:text-black"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div>
        )}

        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label htmlFor="journal-title" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#6B6B6B]">
              Title
            </label>
            <input
              id="journal-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={100}
              autoCapitalize="sentences"
              placeholder="e.g. Summer Memories"
              className="w-full rounded border border-[#E8E2E4] px-4 py-2.5 text-base focus:border-[#1E90FF] focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="journal-description" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#6B6B6B]">
              Description
            </label>
            <textarea
              id="journal-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What kind of memories will live here?"
              className="h-24 w-full resize-none rounded border border-[#E8E2E4] px-4 py-2.5 text-base focus:border-[#1E90FF] focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-3 pt-2 sm:flex-row">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 rounded border border-[#E8E2E4] px-4 py-3 font-medium transition hover:bg-black/5 sm:py-2"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 rounded bg-black px-4 py-3 font-medium text-[#FFB6C1] shadow transition hover:opacity-90 disabled:opacity-50 sm:py-2"
            >
              {loading ? 'Creating…' : 'Create journal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
