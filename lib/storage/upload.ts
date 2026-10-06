'use client';

import { supabase } from '@/lib/supabase/client';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB (per file)
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // source clips may be big

export type UploadContext = 'avatars' | 'post-media' | 'chat-media' | 'journal-media' | 'story-media' | 'studio-media';

const ALLOWED: Record<UploadContext, string[]> = {
  'avatars': ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  'post-media': ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime'],
  'chat-media': ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'application/pdf', 'audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/wav'],
  'journal-media': ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime', 'audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/wav'],
  'story-media': ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'],
  'studio-media': [
    'video/mp4', 'video/webm', 'video/quicktime',
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/wav', 'audio/aac', 'audio/ogg', 'audio/flac', 'audio/x-m4a', 'audio/x-wav',
  ],
};

export interface UploadResult {
  url: string;
  path: string;
  bucket: UploadContext;
  isPrivate: boolean;
}

/**
 * Compare a file's MIME type against an allow-list entry, ignoring codec
 * parameters. Browsers/encoders emit types like "video/webm;codecs=vp9,opus"
 * or "video/mp4;codecs=avc1" — a bare === against "video/webm" wrongly
 * rejects perfectly valid files (this is why exports/photos "couldn't upload").
 */
function typeAllowed(fileType: string, allowed: string[]): boolean {
  const bare = fileType.split(';')[0].trim().toLowerCase();
  if (allowed.includes(bare)) return true;
  /* The video editor accepts browser/phone audio formats beyond the small
     canonical list (for example audio/aac, audio/ogg and audio/x-m4a).
     Keep the broader audio acceptance scoped to studio-media so the editor
     can import real-world audio files without weakening other upload flows. */
  if (allowed.some((type) => type.startsWith('audio/')) && bare.startsWith('audio/')) return true;
  /* images sometimes arrive as image/jpg instead of image/jpeg */
  if (bare === 'image/jpg' && allowed.includes('image/jpeg')) return true;
  return false;
}

function fail(msg: string): never {
  throw new Error(msg);
}

/**
 * Upload a file to the right bucket with a user-scoped path
 * (`{userId}/{uuid}.{ext}` — matches the storage RLS owner-folder model).
 *
 * Private buckets (journal-media, chat-media) return a signed URL that
 * expires; public buckets return the public URL.
 */
export async function uploadFile(
  file: File,
  context: UploadContext,
  userId: string
): Promise<UploadResult> {
  if (!file) fail('No file provided.');
  const limit = context === 'studio-media' ? MAX_VIDEO_BYTES : MAX_UPLOAD_BYTES;
  if (file.size > limit) {
    fail(`File is too large — ${Math.round(limit / (1024 * 1024))} MB maximum.`);
  }
  if (!typeAllowed(file.type, ALLOWED[context])) {
    fail(`Unsupported file type "${file.type || 'unknown'}" for ${context}.`);
  }

  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from(context)
    .upload(path, file, { upsert: false, contentType: file.type });
  if (error) fail(error.message);

  const isPrivate = context === 'journal-media' || context === 'chat-media';
  if (isPrivate) {
    const { data, error: signError } = await supabase.storage.from(context).createSignedUrl(path, 60 * 60 * 24 * 7);
    if (signError || !data) fail(signError?.message || 'Could not create file URL.');
    return { url: data.signedUrl, path, bucket: context, isPrivate };
  }

  const { data } = supabase.storage.from(context).getPublicUrl(path);
  return { url: data.publicUrl, path, bucket: context, isPrivate };
}

/**
 * Upload WITH real byte-level progress. supabase-js has no progress API, so
 * this performs the same request via XMLHttpRequest against the storage
 * endpoint — the session token, path rules and RLS are identical.
 */
export function uploadFileWithProgress(
  file: File,
  context: UploadContext,
  userId: string,
  onProgress: (percent: number) => void
): Promise<UploadResult> {
  return new Promise<UploadResult>((resolve, reject) => {
    (async () => {
      try {
        if (!file) throw new Error('No file provided.');
        const limit = context === 'studio-media' ? MAX_VIDEO_BYTES : MAX_UPLOAD_BYTES;
        if (file.size > limit) throw new Error(`File is too large — ${Math.round(limit / (1024 * 1024))} MB maximum.`);
        if (!typeAllowed(file.type, ALLOWED[context])) {
          throw new Error(`Unsupported file type "${file.type || 'unknown'}".`);
        }

        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) throw new Error('Not signed in.');

        const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
        const path = `${userId}/${crypto.randomUUID()}.${ext}`;
        const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${context}/${path}`;

        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.setRequestHeader('x-upsert', 'false');
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(Math.max(3, Math.round((e.loaded / e.total) * 97)));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            onProgress(100);
            const isPrivate = context === 'journal-media' || context === 'chat-media';
            if (isPrivate) {
              supabase.storage.from(context).createSignedUrl(path, 60 * 60 * 24 * 7).then(({ data, error }) => {
                if (error || !data) reject(new Error('Could not create file URL.'));
                else resolve({ url: data.signedUrl, path, bucket: context, isPrivate });
              });
            } else {
              const { data } = supabase.storage.from(context).getPublicUrl(path);
              resolve({ url: data.publicUrl, path, bucket: context, isPrivate });
            }
          } else {
            let msg = `Upload failed (${xhr.status}).`;
            try {
              const body = JSON.parse(xhr.responseText);
              if (body.message) msg = body.message;
            } catch { /* keep default */ }
            reject(new Error(msg));
          }
        };
        xhr.onerror = () => {
          /* XHR uploads can fail on some mobile browsers because of CORS,
             network handoffs, or privacy filters even though the Supabase
             client itself can upload successfully. Retry through supabase-js
             with a fresh path so a partially-created object cannot collide. */
          const retryPath = userId + '/' + crypto.randomUUID() + '.' + ext;
          setTimeout(async () => {
            try {
              onProgress(8);
              const { error: retryError } = await supabase.storage
                .from(context)
                .upload(retryPath, file, { upsert: false, contentType: file.type });

              if (retryError) throw retryError;

              const isPrivate = context === 'journal-media' || context === 'chat-media';
              if (isPrivate) {
                const { data, error } = await supabase.storage
                  .from(context)
                  .createSignedUrl(retryPath, 60 * 60 * 24 * 7);
                if (error || !data) throw error || new Error('Could not create file URL.');
                onProgress(100);
                resolve({ url: data.signedUrl, path: retryPath, bucket: context, isPrivate });
              } else {
                const { data } = supabase.storage.from(context).getPublicUrl(retryPath);
                onProgress(100);
                resolve({ url: data.publicUrl, path: retryPath, bucket: context, isPrivate });
              }
            } catch (retryError) {
              reject(retryError instanceof Error ? retryError : new Error('Network error during upload.'));
            }
          }, 0);
        };
        xhr.send(file);
      } catch (e) {
        reject(e instanceof Error ? e : new Error('Upload failed.'));
      }
    })();
  });
}

/** Refresh a signed URL for private-bucket paths stored in the database. */
export async function getMediaUrl(bucket: UploadContext, path: string): Promise<string> {
  const isPrivate = bucket === 'journal-media' || bucket === 'chat-media';
  if (!isPrivate) {
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24);
  if (error || !data) return '';
  return data.signedUrl;
}

/** Recover the durable Supabase Storage object path from a signed URL. */
export function extractPrivateStoragePath(
  bucket: UploadContext,
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    const signed = `/storage/v1/object/sign/${bucket}/`;
    const publicObject = `/storage/v1/object/public/${bucket}/`;
    if (parsed.pathname.startsWith(signed)) {
      return decodeURIComponent(parsed.pathname.slice(signed.length)).replace(/^\/+/, '') || null;
    }
    if (parsed.pathname.startsWith(publicObject)) {
      return decodeURIComponent(parsed.pathname.slice(publicObject.length)).replace(/^\/+/, '') || null;
    }
  } catch {}
  return null;
}

/**
 * Rehydrate a stored private/public media URL into a fresh URL.
 * Database rows keep the durable Storage object path in media_path when
 * possible; older rows may only contain an expired signed URL, so we
 * recover the path from that URL before issuing a new signed URL.
 */
export async function refreshStoredMediaUrl(
  bucket: UploadContext,
  value: string | null | undefined,
  storedPath?: string | null,
): Promise<{ url: string; path: string | null }> {
  const path = storedPath || (bucket === 'journal-media' || bucket === 'chat-media'
    ? extractPrivateStoragePath(bucket, value)
    : null);

  if (path) {
    const url = await getMediaUrl(bucket, path);
    return { url: url || value || '', path };
  }

  return { url: value || '', path: null };
}
