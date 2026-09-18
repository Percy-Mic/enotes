'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Upload } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import Avatar from '@/components/social/Avatar';

export default function EditProfilePage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [userId, setUserId] = useState('');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        router.replace('/auth/sign-in');
        return;
      }

      setUserId(user.id);

      const { data: profile } = await supabase
        .from('profiles')
        .select('full_text_name, username, avatar_url, bio')
        .eq('id', user.id)
        .maybeSingle();

      if (profile) {
        setFullName(profile.full_text_name || '');
        setUsername(profile.username || '');
        setBio((profile as any).bio || '');
        setAvatarUrl((profile as any).avatar_url || null);
      }

      setLoading(false);
    })();
  }, [router]);

  const pickAvatar = () => fileRef.current?.click();

  const handleAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !userId) return;

    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `${userId}/avatar-${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      const url = `${data.publicUrl}?v=${Date.now()}`; /* cache-bust */

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: url })
        .eq('id', userId);

      if (updateError) throw updateError;

      setAvatarUrl(url);
      setMessage('Avatar updated!');
    } catch (err: any) {
      setError(err.message || 'Avatar upload failed. Did you run the migration (avatars bucket)?');
    } finally {
      setUploading(false);
    }
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    const handle = username.trim().replace(/^@/, '');

    if (handle && !/^[a-zA-Z0-9_]{3,24}$/.test(handle)) {
      setError('Username must be 3–24 characters: letters, numbers, underscores.');
      setSaving(false);
      return;
    }

    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        full_text_name: fullName.trim() || null,
        username: handle || null,
        bio: bio.trim(),
      })
      .eq('id', userId);

    setSaving(false);

    if (updateError) {
      if (updateError.message.includes('profiles_username_key')) {
        setError('That username is taken. Try another.');
      } else {
        setError(updateError.message);
      }
      return;
    }

    setMessage('Profile saved ✓');
    setTimeout(() => router.push(username ? `/u/${handle}` : '/feed'), 800);
  };

  const deleteAccount = async () => {
    if (!userId || deleting) return;
    setDeleting(true);
    setError(null);

    /* Remove owned content first; the RPC then deletes the profile + auth user. */
    await supabase.from('journals').delete().eq('owner_id', userId);
    await supabase.from('posts').delete().eq('author_id', userId);
    await supabase.from('stories').delete().eq('author_id', userId);
    await supabase.from('comments').delete().eq('author_id', userId);
    await supabase.from('messages').delete().eq('sender_id', userId);
    await supabase.from('conversations').delete().eq('created_by', userId);

    const { error: rpcError } = await supabase.rpc('delete_my_account');
    if (rpcError) {
      setError(`Could not finish deleting your account (${rpcError.message}). Email us and we will complete it manually.`);
      setDeleting(false);
      return;
    }

    await supabase.auth.signOut();
    router.replace('/');
    router.refresh();
  };

  if (loading) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-[#FFF7F8] text-[#6B6B6B]">
        Loading…
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-[#FFF7F8] px-3 pb-24 pt-5 text-[#111111] sm:px-6 md:pb-10">
      <div className="mx-auto w-full max-w-xl">
        <header className="mb-5 flex items-center gap-3">
          <Link
            href="/feed"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#E8E2E4] bg-white shadow-sm"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Edit profile</h1>
        </header>

        <form onSubmit={saveProfile} className="space-y-5 rounded-2xl border border-[#E8E2E4] bg-white p-5 shadow-sm sm:p-6">
          {/* Avatar */}
          <div className="flex items-center gap-4">
            <Avatar src={avatarUrl} name={fullName || username} size={48} className="!h-20 !w-20 !text-2xl" />
            <div>
              <button
                type="button"
                onClick={pickAvatar}
                disabled={uploading}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#E8E2E4] bg-white px-4 py-2 text-sm font-semibold transition hover:bg-gray-50 disabled:opacity-50"
              >
                <Upload className="h-4 w-4" />
                {uploading ? 'Uploading…' : 'Change photo'}
              </button>
              <p className="mt-1 text-xs text-[#9B9B9B]">Square images look best.</p>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatar} />
            </div>
          </div>

          {message && (
            <p className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">{message}</p>
          )}
          {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</p>}

          <div>
            <label htmlFor="fullName" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#6B6B6B]">
              Display name
            </label>
            <input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              maxLength={60}
              className="w-full rounded-lg border border-[#E8E2E4] px-4 py-2.5 text-base focus:border-[#1E90FF] focus:outline-none"
              placeholder="Alex Rivera"
            />
          </div>

          <div>
            <label htmlFor="username" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#6B6B6B]">
              Username
            </label>
            <div className="flex items-center rounded-lg border border-[#E8E2E4] focus-within:border-[#1E90FF]">
              <span className="pl-3 text-[#9B9B9B]">@</span>
              <input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                maxLength={24}
                autoCapitalize="none"
                className="w-full bg-transparent px-2 py-2.5 text-base focus:outline-none"
                placeholder="alex"
              />
            </div>
            <p className="mt-1 text-xs text-[#9B9B9B]">Letters, numbers and underscores. This is how people find you.</p>
          </div>

          <div>
            <label htmlFor="bio" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#6B6B6B]">
              Bio
            </label>
            <textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={200}
              rows={3}
              className="w-full resize-none rounded-lg border border-[#E8E2E4] px-4 py-2.5 text-base focus:border-[#1E90FF] focus:outline-none"
              placeholder="A line about your journaling life…"
            />
            <p className="mt-1 text-right text-xs text-[#9B9B9B]">{bio.length}/200</p>
          </div>

          <button
            type="submit"
            disabled={saving || uploading}
            className="min-h-[48px] w-full rounded-xl bg-black py-3 text-sm font-semibold text-[#FFB6C1] shadow transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        </form>

        {/* Danger zone */}
        <section className="mt-8 rounded-2xl border border-red-200 bg-red-50/60 p-5">
          <h2 className="text-sm font-bold text-red-700">Danger zone</h2>
          <p className="mt-1 text-xs leading-relaxed text-red-600/90">
            Deleting your account permanently removes your profile, journals, pages, posts, stories,
            comments, and messages. This cannot be undone.
          </p>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="mt-3 min-h-[44px] w-full rounded-xl border border-red-300 bg-white py-2.5 text-sm font-bold text-red-600 transition hover:bg-red-50"
            >
              Delete my account…
            </button>
          ) : (
            <div className="mt-3 space-y-2">
              <p className="text-xs font-semibold text-red-700">
                Are you absolutely sure? This wipes everything immediately.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleting}
                  className="min-h-[44px] flex-1 rounded-xl border border-[#E8E2E4] bg-white py-2.5 text-sm font-semibold disabled:opacity-50"
                >
                  Keep my account
                </button>
                <button
                  onClick={deleteAccount}
                  disabled={deleting}
                  className="min-h-[44px] flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white transition hover:bg-red-700 disabled:opacity-50"
                >
                  {deleting ? 'Deleting…' : 'Yes, delete everything'}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

    </main>
  );
}
