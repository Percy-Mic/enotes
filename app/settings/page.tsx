'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Ban, Bell, Download, Globe, Lock, LogOut, Mail, Palette, Save,
  Shield, Trash2, User, UserRound,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useMe, useUserSettings } from '@/lib/hooks';
import Avatar from '@/components/social/Avatar';

type Section = 'account' | 'privacy' | 'notifications' | 'appearance' | 'media' | 'security' | 'data';

const SECTIONS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: 'account', label: 'Account', icon: <User className="h-4 w-4" /> },
  { id: 'privacy', label: 'Privacy', icon: <Lock className="h-4 w-4" /> },
  { id: 'notifications', label: 'Notifications', icon: <Bell className="h-4 w-4" /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette className="h-4 w-4" /> },
  { id: 'media', label: 'Media', icon: <Globe className="h-4 w-4" /> },
  { id: 'security', label: 'Security', icon: <Shield className="h-4 w-4" /> },
  { id: 'data', label: 'Your data', icon: <Download className="h-4 w-4" /> },
];

/* ---------- reusable controls ---------- */

function Toggle({ label, description, checked, onChange, disabled }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-center justify-between gap-4 rounded-xl border border-[#E8E2E4] bg-white p-3.5 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-[#6B6B6B]">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${checked ? 'bg-emerald-500' : 'bg-gray-300'}`}
      >
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-6' : 'left-1'}`} />
      </button>
    </label>
  );
}

function ChoiceRow({ label, description, value, onChange, options }: {
  label: string;
  description?: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="rounded-xl border border-[#E8E2E4] bg-white p-3.5">
      <p className="text-sm font-semibold">{label}</p>
      {description && <p className="mt-0.5 text-xs text-[#6B6B6B]">{description}</p>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`min-h-[38px] rounded-lg border px-3 text-xs font-semibold transition ${
              value === opt.value ? 'border-black bg-black text-[#FFB6C1]' : 'border-[#E8E2E4] hover:bg-gray-50'
            }`}
            aria-pressed={value === opt.value}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- page ---------- */

export default function SettingsPage() {
  const router = useRouter();
  const { userId, profile, loading: meLoading } = useMe();
  const { settings, loading: settingsLoading, update } = useUserSettings(userId);

  const [section, setSection] = useState<Section>('account');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* account fields */
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  /* security fields */
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [sessions, setSessions] = useState<number>(0);

  /* blocked users */
  const [blocked, setBlocked] = useState<{ blocked_id: string; username?: string; full_text_name?: string }[]>([]);

  /* data export */
  const [exporting, setExporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_text_name || '');
      setUsername(profile.username || '');
      setBio(profile.bio || '');
    }
  }, [profile]);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      const [{ data: blocks }, { data: sessionData }] = await Promise.all([
        supabase
          .from('user_blocks')
          .select('blocked_id')
          .eq('blocker_id', userId),
        supabase.auth.getSession(),
      ]);
      const ids = (blocks || []).map((b: any) => b.blocked_id);
      if (ids.length) {
        const { data: profiles } = await supabase.from('profiles').select('id, username, full_text_name').in('id', ids);
        setBlocked((profiles || []) as any);
      } else {
        setBlocked([]);
      }
      setSessions(sessionData?.session ? 1 : 0);
    })();
  }, [userId]);

  const flash = (msg: string) => {
    setMessage(msg);
    setError(null);
    setTimeout(() => setMessage(null), 2500);
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    setSavingProfile(true);
    const handle = username.trim().replace(/^@/, '');
    if (handle && !/^[a-zA-Z0-9_]{3,24}$/.test(handle)) {
      setError('Username must be 3–24 characters: letters, numbers, underscores.');
      setSavingProfile(false);
      return;
    }
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ full_text_name: fullName.trim() || null, username: handle || null, bio: bio.trim() })
      .eq('id', userId);
    setSavingProfile(false);
    if (updateError) {
      setError(updateError.message.includes('profiles_username_key') ? 'That username is taken.' : updateError.message);
      return;
    }
    flash('Profile saved ✓');
  };

  const changePassword = async () => {
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    const { error: pwError } = await supabase.auth.updateUser({ password: newPassword });
    if (pwError) {
      setError(pwError.message);
      return;
    }
    setNewPassword('');
    setConfirmPassword('');
    flash('Password updated ✓');
  };

  const changeEmail = async () => {
    if (!newEmail.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    const { error: emailError } = await supabase.auth.updateUser({ email: newEmail });
    if (emailError) {
      setError(emailError.message);
      return;
    }
    setNewEmail('');
    flash('Confirmation sent to your new email — click the link to finish.');
  };

  const signOutEverywhere = async () => {
    await supabase.auth.signOut({ scope: 'global' });
    router.replace('/auth/sign-in');
  };

  const unblock = async (targetId: string) => {
    if (!userId) return;
    await supabase.from('user_blocks').delete().eq('blocker_id', userId).eq('blocked_id', targetId);
    setBlocked((list) => list.filter((b) => b.blocked_id !== targetId));
    flash('User unblocked');
  };

  const exportData = async () => {
    if (!userId) return;
    setExporting(true);
    try {
      const [profileRes, journalsRes, postsRes, commentsRes, messagesRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', userId),
        supabase.from('journals').select('*').eq('owner_id', userId),
        supabase.from('posts').select('*').eq('author_id', userId),
        supabase.from('comments').select('*').eq('author_id', userId),
        supabase.from('messages').select('*').eq('sender_id', userId).limit(1000),
      ]);
      const bundle = {
        exported_at: new Date().toISOString(),
        profile: profileRes.data,
        journals: journalsRes.data,
        posts: postsRes.data,
        comments: commentsRes.data,
        messages: messagesRes.data,
      };
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `enotes-export-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      flash('Export downloaded ✓');
    } finally {
      setExporting(false);
    }
  };

  const deleteAccount = async () => {
    if (!userId || deleting) return;
    setDeleting(true);
    await supabase.from('journals').delete().eq('owner_id', userId);
    await supabase.from('posts').delete().eq('author_id', userId);
    await supabase.from('stories').delete().eq('author_id', userId);
    await supabase.from('comments').delete().eq('author_id', userId);
    await supabase.from('messages').delete().eq('sender_id', userId);
    await supabase.from('conversations').delete().eq('created_by', userId);
    const { error: rpcError } = await supabase.rpc('delete_my_account');
    if (rpcError) {
      setError(`Could not finish deleting your account (${rpcError.message}).`);
      setDeleting(false);
      return;
    }
    await supabase.auth.signOut();
    router.replace('/');
  };

  if (meLoading || settingsLoading) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-[#FFF7F8] text-[#6B6B6B]">
        Loading settings…
      </main>
    );
  }

  const set = (changes: Parameters<typeof update>[0]) => update(changes).then((ok) => ok && flash('Saved ✓'));

  return (
    <main className="min-h-[100dvh] bg-[#FFF7F8] px-3 pb-24 pt-5 text-[#111111] sm:px-6 md:pb-10">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-4 flex items-center gap-3">
          <Link href="/feed" className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#E8E2E4] bg-white shadow-sm" aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
            <p className="text-sm text-[#6B6B6B]">Make enotes yours.</p>
          </div>
        </header>

        {/* section tabs — horizontally scrollable on mobile */}
        <div className="no-scrollbar mb-5 flex gap-1 overflow-x-auto rounded-xl bg-white p-1 shadow-sm">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition ${
                section === s.id ? 'bg-black text-[#FFB6C1]' : 'text-[#6B6B6B] hover:bg-gray-50'
              }`}
              aria-pressed={section === s.id}
            >
              {s.icon} {s.label}
            </button>
          ))}
        </div>

        {message && <p className="mb-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">{message}</p>}
        {error && <p className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</p>}

        {/* ============ ACCOUNT ============ */}
        {section === 'account' && (
          <form onSubmit={saveProfile} className="space-y-4 rounded-2xl border border-[#E8E2E4] bg-white p-4 shadow-sm sm:p-5">
            <div className="flex items-center gap-4">
              <Avatar src={profile?.avatar_url} name={fullName || username} size={48} className="!h-20 !w-20 !text-2xl" />
              <Link href="/settings/profile" className="rounded-xl border border-[#E8E2E4] px-4 py-2 text-sm font-semibold transition hover:bg-gray-50">
                Change photo
              </Link>
            </div>
            <label className="block text-sm font-semibold">
              Display name
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={60} className="mt-1 w-full rounded-lg border border-[#E8E2E4] px-4 py-2.5 text-base font-normal focus:border-[#1E90FF] focus:outline-none" />
            </label>
            <label className="block text-sm font-semibold">
              Username
              <div className="mt-1 flex items-center rounded-lg border border-[#E8E2E4] focus-within:border-[#1E90FF]">
                <span className="pl-3 text-[#9B9B9B]">@</span>
                <input value={username} onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))} maxLength={24} autoCapitalize="none" className="w-full bg-transparent px-2 py-2.5 text-base font-normal focus:outline-none" />
              </div>
            </label>
            <label className="block text-sm font-semibold">
              Bio
              <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={200} rows={3} className="mt-1 w-full resize-none rounded-lg border border-[#E8E2E4] px-4 py-2.5 text-base font-normal focus:border-[#1E90FF] focus:outline-none" />
            </label>
            <label className="block text-sm font-semibold">
              Email
              <input value={profile ? (profile as any).email || 'Hidden' : ''} disabled className="mt-1 w-full rounded-lg border border-[#E8E2E4] bg-gray-50 px-4 py-2.5 text-base font-normal text-[#6B6B6B]" />
            </label>
            <button type="submit" disabled={savingProfile} className="min-h-[46px] w-full rounded-xl bg-black py-3 text-sm font-semibold text-[#FFB6C1] shadow transition hover:opacity-90 disabled:opacity-50">
              {savingProfile ? 'Saving…' : 'Save account'}
            </button>
          </form>
        )}

        {/* ============ PRIVACY ============ */}
        {section === 'privacy' && settings && (
          <div className="space-y-3">
            <Toggle label="Show active status" description="Others can see when you're online. Turn off to always appear offline." checked={settings.show_active_status} onChange={(v) => set({ show_active_status: v })} />
            <Toggle label="Send read receipts" description="Others can see when you've read their messages." checked={settings.read_receipts_enabled} onChange={(v) => set({ read_receipts_enabled: v })} />
            <ChoiceRow label="Who can message me" value={settings.allow_messages} onChange={(v) => set({ allow_messages: v as any })} options={[{ value: 'everyone', label: 'Everyone' }, { value: 'following', label: 'People I follow' }, { value: 'nobody', label: 'Nobody' }]} />
            <ChoiceRow label="Who can comment on my posts" value={settings.allow_comments} onChange={(v) => set({ allow_comments: v as any })} options={[{ value: 'everyone', label: 'Everyone' }, { value: 'following', label: 'People I follow' }, { value: 'nobody', label: 'Nobody' }]} />
            <ChoiceRow label="Default post visibility" value={settings.default_post_visibility} onChange={(v) => set({ default_post_visibility: v as any })} options={[{ value: 'public', label: 'Public' }, { value: 'followers', label: 'Followers only' }]} />

            {/* blocked users */}
            <div className="rounded-xl border border-[#E8E2E4] bg-white p-3.5">
              <p className="flex items-center gap-2 text-sm font-semibold"><Ban className="h-4 w-4" /> Blocked users ({blocked.length})</p>
              {blocked.length === 0 ? (
                <p className="mt-2 text-xs text-[#6B6B6B]">You haven't blocked anyone.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {blocked.map((b) => (
                    <li key={b.blocked_id} className="flex items-center justify-between gap-2 rounded-lg bg-[#F8F4F6] px-3 py-2 text-sm">
                      <span className="truncate">@{b.username || 'unknown'}</span>
                      <button onClick={() => unblock(b.blocked_id)} className="rounded-lg border px-2.5 py-1 text-xs font-semibold hover:bg-white">Unblock</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* ============ NOTIFICATIONS ============ */}
        {section === 'notifications' && settings && (
          <div className="space-y-3">
            <Toggle label="Messages" checked={settings.notify_messages} onChange={(v) => set({ notify_messages: v })} />
            <Toggle label="Comments & replies" checked={settings.notify_comments} onChange={(v) => set({ notify_comments: v })} />
            <Toggle label="Reactions & likes" checked={settings.notify_reactions} onChange={(v) => set({ notify_reactions: v })} />
            <Toggle label="Mentions" checked={settings.notify_mentions} onChange={(v) => set({ notify_mentions: v })} />
            <Toggle label="Calls" description="Missed-call alerts." checked={settings.notify_calls} onChange={(v) => set({ notify_calls: v })} />
            <Toggle label="Journal activity" description="Shares and collaboration on your journals." checked={settings.notify_journal_activity} onChange={(v) => set({ notify_journal_activity: v })} />
          </div>
        )}

        {/* ============ APPEARANCE ============ */}
        {section === 'appearance' && settings && (
          <div className="space-y-3">
            <ChoiceRow label="Theme" value={settings.theme} onChange={(v) => set({ theme: v as any })} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }]} />
            <div className="rounded-xl border border-[#E8E2E4] bg-white p-3.5">
              <p className="text-sm font-semibold">Accent color</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {['#E5798F', '#1E90FF', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#111111'].map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => set({ accent_color: color })}
                    className={`h-10 w-10 rounded-full border-2 transition ${settings.accent_color === color ? 'border-black ring-2 ring-black/20' : 'border-white shadow'}`}
                    style={{ background: color }}
                    aria-label={`Accent ${color}`}
                    aria-pressed={settings.accent_color === color}
                  />
                ))}
                <input type="color" value={settings.accent_color} onChange={(e) => set({ accent_color: e.target.value })} className="h-10 w-10 cursor-pointer rounded-full border p-0.5" aria-label="Custom accent color" />
              </div>
            </div>
            <p className="px-1 text-xs text-[#6B6B6B]">Per-chat themes live inside each conversation → menu → “Chat theme”.</p>
          </div>
        )}

        {/* ============ MEDIA ============ */}
        {section === 'media' && settings && (
          <div className="space-y-3">
            <Toggle label="Autoplay videos" description="Videos start playing automatically in the feed and chat." checked={settings.autoplay_media} onChange={(v) => set({ autoplay_media: v })} />
            <p className="rounded-xl border border-[#E8E2E4] bg-white p-3.5 text-xs leading-relaxed text-[#6B6B6B]">
              Upload limits: 25 MB per file. Photos, videos, GIFs, audio and PDFs are supported depending on context.
              Large files are stored in Supabase Storage — never inside the database.
            </p>
          </div>
        )}

        {/* ============ SECURITY ============ */}
        {section === 'security' && (
          <div className="space-y-3">
            <div className="rounded-xl border border-[#E8E2E4] bg-white p-3.5">
              <p className="text-sm font-semibold">Change password</p>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New password (min 6 characters)" autoComplete="new-password" className="mt-2 w-full rounded-lg border border-[#E8E2E4] px-4 py-2.5 text-sm focus:border-[#1E90FF] focus:outline-none" />
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Repeat new password" autoComplete="new-password" className="mt-2 w-full rounded-lg border border-[#E8E2E4] px-4 py-2.5 text-sm focus:border-[#1E90FF] focus:outline-none" />
              <button onClick={changePassword} className="mt-2 min-h-[42px] w-full rounded-xl bg-black py-2.5 text-sm font-semibold text-[#FFB6C1]">Update password</button>
            </div>

            <div className="rounded-xl border border-[#E8E2E4] bg-white p-3.5">
              <p className="text-sm font-semibold">Change email</p>
              <p className="mt-0.5 text-xs text-[#6B6B6B]">We'll send a confirmation link to the new address.</p>
              <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="new@email.com" autoComplete="email" className="mt-2 w-full rounded-lg border border-[#E8E2E4] px-4 py-2.5 text-sm focus:border-[#1E90FF] focus:outline-none" />
              <button onClick={changeEmail} className="mt-2 min-h-[42px] w-full rounded-xl border border-[#E8E2E4] py-2.5 text-sm font-semibold transition hover:bg-gray-50">Send confirmation</button>
            </div>

            <div className="rounded-xl border border-[#E8E2E4] bg-white p-3.5">
              <p className="text-sm font-semibold">Sessions</p>
              <p className="mt-0.5 text-xs text-[#6B6B6B]">Sign out of this and every other device.</p>
              <button onClick={signOutEverywhere} className="mt-2 flex min-h-[42px] w-full items-center justify-center gap-2 rounded-xl border border-red-200 py-2.5 text-sm font-bold text-red-600 transition hover:bg-red-50">
                <LogOut className="h-4 w-4" /> Sign out everywhere
              </button>
            </div>
          </div>
        )}

        {/* ============ DATA ============ */}
        {section === 'data' && (
          <div className="space-y-3">
            <div className="rounded-xl border border-[#E8E2E4] bg-white p-3.5">
              <p className="text-sm font-semibold">Export your data</p>
              <p className="mt-0.5 text-xs text-[#6B6B6B]">Download a JSON file with your profile, journals, posts, comments and messages.</p>
              <button onClick={exportData} disabled={exporting} className="mt-2 min-h-[42px] w-full rounded-xl bg-black py-2.5 text-sm font-semibold text-[#FFB6C1] disabled:opacity-50">
                {exporting ? 'Preparing…' : 'Download export'}
              </button>
            </div>

            <div className="rounded-2xl border border-red-200 bg-red-50/60 p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-red-700"><Trash2 className="h-4 w-4" /> Delete account</p>
              <p className="mt-1 text-xs leading-relaxed text-red-600/90">
                Permanently removes your profile, journals, pages, posts, stories, comments and messages. This cannot be undone.
              </p>
              {!confirmDelete ? (
                <button onClick={() => setConfirmDelete(true)} className="mt-3 min-h-[44px] w-full rounded-xl border border-red-300 bg-white py-2.5 text-sm font-bold text-red-600 transition hover:bg-red-50">
                  Delete my account…
                </button>
              ) : (
                <div className="mt-3 space-y-2">
                  <p className="text-xs font-semibold text-red-700">Are you absolutely sure?</p>
                  <div className="flex gap-2">
                    <button onClick={() => setConfirmDelete(false)} disabled={deleting} className="min-h-[44px] flex-1 rounded-xl border border-[#E8E2E4] bg-white py-2.5 text-sm font-semibold disabled:opacity-50">Keep my account</button>
                    <button onClick={deleteAccount} disabled={deleting} className="min-h-[44px] flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white transition hover:bg-red-700 disabled:opacity-50">
                      {deleting ? 'Deleting…' : 'Yes, delete everything'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

    </main>
  );
}
