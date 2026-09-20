'use client';

import React, { useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/update-password`,
    });

    if (error) {
      console.error('Password-reset error:', error.message);
      setError(
        /rate.?limit/i.test(error.message)
          ? 'Too many recovery emails have been sent in the last hour. Please try again in a little while.'
          : error.message
      );
    } else {
      setMessage('Check your email for the password reset link.');
    }
    setLoading(false);
  };

  return (
    <main className="min-h-screen bg-[#FFF7F8] flex items-center justify-center p-6 text-[#111111]">
      <div className="bg-white w-full max-w-md p-8 rounded-[20px] shadow-xl border border-[#E8E2E4] space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reset password ♡</h1>
          <p className="text-sm text-[#6B6B6B] mt-1">We will send you a recovery link.</p>
        </div>

        {error && <div className="p-3 bg-red-50 text-red-600 text-sm rounded">{error}</div>}
        {message && <div className="p-3 bg-green-50 text-green-600 text-sm rounded">{message}</div>}

        <form onSubmit={handlePasswordReset} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#6B6B6B] mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-2 border border-[#E8E2E4] rounded focus:outline-none focus:border-[#1E90FF]"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-black text-[#FFB6C1] py-3 rounded-lg font-medium shadow hover:opacity-90 disabled:opacity-50 transition"
          >
            {loading ? 'Sending link...' : 'Send Reset Link'}
          </button>
        </form>

        <p className="text-center text-sm text-[#6B6B6B]">
          Remember your password?{' '}
          <Link href="/auth/sign-in" className="text-[#1E90FF] font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}