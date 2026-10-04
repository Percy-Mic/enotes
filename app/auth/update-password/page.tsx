'use client';

import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function UpdatePasswordPage() {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      setMessage('Password updated successfully! Redirecting to sign in...');
      setTimeout(() => {
        router.push('/auth/sign-in');
      }, 2000);
    }
  };

  return (
    <main className="min-h-screen bg-[#FFF7F8] flex items-center justify-center p-6 text-[#111111]">
      <div className="bg-white w-full max-w-md p-8 rounded-[20px] shadow-xl border border-[#E8E2E4] space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Update password ♡</h1>
          <p className="text-sm text-[#6B6B6B] mt-1">Enter your new password below.</p>
        </div>

        {error && <div className="p-3 bg-red-50 text-red-600 text-sm rounded">{error}</div>}
        {message && <div className="p-3 bg-green-50 text-green-600 text-sm rounded">{message}</div>}

        <form onSubmit={handleUpdatePassword} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#6B6B6B] mb-1">New Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-4 py-2 pr-10 border border-[#E8E2E4] rounded focus:outline-none focus:border-[#1E90FF]"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 focus:outline-none"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  // EyeOff SVG
                  <EyeOff className="h-5 w-5" aria-hidden="true" />
                ) : (
                  // Eye SVG
                  <Eye className="h-5 w-5" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-black text-[#FFB6C1] py-3 rounded-lg font-medium shadow hover:opacity-90 disabled:opacity-50 transition"
          >
            {loading ? 'Updating...' : 'Update Password'}
          </button>
        </form>

        <p className="text-center text-sm text-[#6B6B6B]">
          Remembered your password?{' '}
          <Link href="/auth/sign-in" className="text-[#1E90FF] font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}