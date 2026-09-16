'use client';

import React, { useEffect, useState } from 'react';
import { AlertCircle, Flag, Loader2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import type { ReportReason, ReportTargetType } from '@/types/social';

interface ReportDialogProps {
  open: boolean;
  onClose: () => void;
  targetType: ReportTargetType;
  targetId: string;
}

const REASONS: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam or scam' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'inappropriate', label: 'Inappropriate content' },
  { value: 'violence', label: 'Violence or danger' },
  { value: 'other', label: 'Something else' },
];

export default function ReportDialog({ open, onClose, targetType, targetId }: ReportDialogProps) {
  const [reason, setReason] = useState<ReportReason>('spam');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDone(false);
      setError(null);
      setDetails('');
      setReason('spam');
    }
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError('Sign in to report content.');
      setSubmitting(false);
      return;
    }
    const { error: insertError } = await supabase.from('reports').insert({
      reporter_id: user.id,
      target_type: targetType,
      target_id: targetId,
      reason,
      details: details.trim() || null,
    });
    setSubmitting(false);
    if (insertError) {
      /* 23505 = one-open-report-per-target unique index: the user already
         reported this and it is still in the queue — success for them. */
      if (insertError.code === '23505') {
        setDone(true);
        setTimeout(onClose, 1600);
        return;
      }
      setError(insertError.message);
      return;
    }
    setDone(true);
    setTimeout(onClose, 1600);
  };

  return (
    <div
      className="fixed inset-0 z-[130] flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Report ${targetType}`}
    >
      <div
        className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-bold">
            <Flag className="h-4 w-4 text-red-500" />
            Report this {targetType}
          </h2>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-gray-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {done ? (
          <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-700">
            <AlertCircle className="h-4 w-4" />
            Thank you. Our moderators will review this {targetType}.
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              {REASONS.map((r) => (
                <label
                  key={r.value}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-xl border p-3 text-sm transition ${
                    reason === r.value ? 'border-[#E5798F] bg-[#FFF7F8]' : 'border-[#E8E2E4] hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="report-reason"
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                    className="h-4 w-4 accent-black"
                  />
                  {r.label}
                </label>
              ))}
            </div>

            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Add details (optional)…"
              rows={3}
              maxLength={500}
              className="mt-3 w-full resize-none rounded-lg border border-[#E8E2E4] px-3 py-2.5 text-sm focus:border-[#1E90FF] focus:outline-none"
            />

            {error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-600">{error}</p>}

            <div className="mt-4 flex gap-2">
              <button onClick={onClose} className="min-h-[44px] flex-1 rounded-xl border border-[#E8E2E4] text-sm font-semibold transition hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={submitting}
                className="min-h-[44px] flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {submitting ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Submit report'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
