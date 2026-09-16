'use client';

import React, { useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function CreateJournalPage() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleCreateJournal = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // 1. Get the current authenticated user session
      const { data: { user }, error: userError } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error('You must be logged in to create a journal.');
      }

      // 2. Insert into Supabase mapping correctly to `owner_id`
      const { error: insertError } = await supabase.from('journals').insert([
        {
          title: title.trim(),
          description: description.trim(),
          owner_id: user.id, // Matches your database schema column name
          visibility: visibility,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]);

      if (insertError) {
        throw new Error(insertError.message);
      }

      // 3. Clear form and redirect to your journals/dashboard list
      setTitle('');
      setDescription('');
      router.push('/journals'); // <-- This redirects you right after success!
      router.refresh();
      
    } catch (err: any) {
      console.error('Error creating journal:', err);
      setError(err.message || 'An unexpected error occurred.');
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#FFF7F8] flex items-center justify-center p-6 pb-28 text-[#111111] md:pb-6">
      <div className="bg-white w-full max-w-md p-8 rounded-[20px] shadow-xl border border-[#E8E2E4] space-y-6 relative">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Create a new journal ♡</h1>
            <p className="text-sm text-[#6B6B6B] mt-1">Capture your thoughts securely.</p>
          </div>
          <Link 
            href="/dashboard"
            className="text-gray-400 hover:text-gray-600 transition p-1 rounded-full hover:bg-gray-100 text-sm font-semibold"
          >
            ✕
          </Link>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-200">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleCreateJournal} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#6B6B6B] mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
              required
              placeholder="e.g., Daily Reflections"
              className="w-full px-4 py-2 border border-[#E8E2E4] rounded-lg focus:outline-none focus:border-[#1E90FF] text-sm"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#6B6B6B]">Description</label>
              <span className="text-[10px] text-gray-400">{description.length}/500</span>
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={4}
              required
              placeholder="What's on your mind today?"
              className="w-full px-4 py-2 border border-[#E8E2E4] rounded-lg focus:outline-none focus:border-[#1E90FF] text-sm resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#6B6B6B] mb-1">Visibility</label>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
              className="w-full px-4 py-2 border border-[#E8E2E4] rounded-lg focus:outline-none focus:border-[#1E90FF] text-sm bg-white"
            >
              <option value="private">🔒 Private (Only you)</option>
              <option value="public">🌍 Public (Anyone with link)</option>
            </select>
          </div>

          <div className="flex gap-3 pt-2">
            <Link
              href="/dashboard"
              className="flex-1 text-center bg-gray-100 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-200 transition text-sm flex items-center justify-center"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-black text-[#FFB6C1] py-3 rounded-lg font-medium shadow hover:opacity-90 disabled:opacity-50 transition text-sm flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-[#FFB6C1]" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Creating...
                </>
              ) : (
                'Create Journal'
              )}
            </button>
          </div>
        </form>
      </div>

    </main>
  );
}