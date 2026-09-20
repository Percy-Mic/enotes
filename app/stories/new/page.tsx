'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Upload, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

export default function NewStoryPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [me, setMe] = useState<{ id: string } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setMe({ id: user.id });
    })();
  }, [router]);

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;

    if (!f.type.startsWith('image/') && !f.type.startsWith('video/')) {
      setError('Please choose an image or a video.');
      return;
    }
    if (f.size > MAX_BYTES) {
      setError('File is too large — keep it under 25 MB.');
      return;
    }
    setFile(f);
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(f);
    });
  };

  const clearFile = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!me || !file || uploading) return;

    setUploading(true);
    setError(null);

    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
      const path = `${me.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const mediaType = file.type.startsWith('video/') ? 'video' : 'image';

      const { error: uploadError } = await supabase.storage
        .from('story-media')
        .upload(path, file, { upsert: false, contentType: file.type });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('story-media').getPublicUrl(path);

      const { error: insertError } = await supabase.from('stories').insert({
        author_id: me.id,
        media_url: urlData.publicUrl,
        media_type: mediaType,
        caption: caption.trim() || null,
      });
      if (insertError) throw insertError;

      clearFile();
      router.push('/feed');
      router.refresh();
    } catch (err: any) {
      setError(err?.message || 'Upload failed — please try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <main className="min-h-[100dvh] bg-[#FFF7F8] px-3 pb-24 pt-5 text-[#111111] sm:px-6 md:pb-10">
      <div className="mx-auto w-full max-w-lg">
        <header className="mb-5 flex items-center gap-3">
          <button
            onClick={() => router.back()}
            aria-label="Go back"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#E8E2E4] bg-white shadow-sm transition hover:bg-gray-50"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Add a story</h1>
            <p className="text-sm text-[#6B6B6B]">Visible for 24 hours.</p>
          </div>
        </header>

        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-[#E8E2E4] bg-white p-4 shadow-sm">
          {error && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
          )}

          {!previewUrl ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-72 w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-[#E8E2E4] text-[#9B9B9B] transition hover:border-[#E5798F] hover:text-[#E5798F]"
            >
              <Upload className="h-8 w-8" />
              <span className="text-sm font-semibold">Choose a photo or video</span>
              <span className="text-xs">Up to 25 MB</span>
            </button>
          ) : (
            <div className="relative overflow-hidden rounded-xl bg-black">
              {file?.type.startsWith('video/') ? (
                <video src={previewUrl} controls playsInline className="max-h-72 w-full" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="Story preview" className="max-h-72 w-full object-contain" />
              )}
              <button
                type="button"
                onClick={clearFile}
                aria-label="Remove media"
                className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            onChange={pickFile}
            className="hidden"
          />

          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Add a caption (optional)"
            maxLength={200}
            className="min-h-[64px] w-full resize-none rounded-lg border border-[#E8E2E4] px-3 py-2.5 text-sm focus:border-[#1E90FF] focus:outline-none"
          />

          <button
            type="submit"
            disabled={!file || uploading}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-[#FFB6C1] shadow transition hover:opacity-90 disabled:opacity-40"
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Sharing your story…
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" /> Share story
              </>
            )}
          </button>
        </form>
      </div>
    </main>
  );
}
