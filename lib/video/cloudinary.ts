import crypto from 'node:crypto';

export type CloudinaryMediaType = 'image' | 'video' | 'audio';
export type CloudinaryProcessMode = 'optimize' | 'vertical' | 'square' | 'landscape';

function credentials() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) return null;
  return { cloudName, apiKey, apiSecret };
}

function sign(params: Record<string, string>, apiSecret: string) {
  const serialized = Object.entries(params)
    .filter(([, value]) => value !== '' && value != null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return crypto.createHash('sha1').update(serialized + apiSecret).digest('hex');
}

function transformationFor(mediaType: CloudinaryMediaType, mode: CloudinaryProcessMode) {
  if (mediaType === 'audio') return 'q_auto,f_auto';
  if (mode === 'vertical') return 'c_limit,w_1080,h_1920,q_auto,f_auto';
  if (mode === 'square') return 'c_limit,w_1080,h_1080,q_auto,f_auto';
  if (mode === 'landscape') return 'c_limit,w_1920,h_1080,q_auto,f_auto';
  return 'q_auto,f_auto';
}

export async function cloudinaryProcessUrl(input: {
  url: string;
  userId: string;
  mediaType: CloudinaryMediaType;
  mode?: CloudinaryProcessMode;
}) {
  const config = credentials();
  if (!config) return null;
  if (!/^https?:\/\//i.test(input.url)) throw new Error('Cloudinary needs an accessible source URL.');

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const resourceType = input.mediaType === 'image' ? 'image' : 'video';
  const folder = `enotes/studio/${input.userId}`;
  const transformation = transformationFor(input.mediaType, input.mode || 'optimize');
  const params: Record<string, string> = {
    folder,
    timestamp,
    transformation,
  };

  const form = new FormData();
  form.append('file', input.url);
  form.append('api_key', config.apiKey);
  form.append('timestamp', timestamp);
  form.append('folder', folder);
  form.append('transformation', transformation);
  form.append('signature', sign(params, config.apiSecret));

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/${resourceType}/upload`,
    { method: 'POST', body: form, cache: 'no-store' },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `Cloudinary upload failed (${response.status}).`);
  }

  const eager = Array.isArray(data?.eager) && data.eager[0]?.secure_url ? data.eager[0].secure_url : null;
  return {
    provider: 'cloudinary',
    publicId: data?.public_id || null,
    originalUrl: data?.secure_url || null,
    url: eager || data?.secure_url || null,
    resourceType,
    transformation,
    bytes: Number(data?.bytes) || null,
    width: Number(data?.width) || null,
    height: Number(data?.height) || null,
    duration: Number(data?.duration) || null,
    format: data?.format || null,
  };
}

export function cloudinaryConfigured() {
  return Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}
