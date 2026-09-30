import type { AIJobInput, AIResult, VideoAIOperation } from '@/lib/video/ai';

type Provider = 'huggingface' | 'fal' | 'replicate' | 'cloudinary';

function providerFor(operation: VideoAIOperation): Provider | null {
  if (operation === 'remove-background') return 'huggingface';
  if (operation === 'remove-background' || operation === 'enhance') return 'huggingface';
  if (
    operation === 'remove-object' ||
    operation === 'track-object' ||
    operation === 'generate-image' ||
    operation === 'generate-video' ||
    operation === 'generate-voice' ||
    operation === 'clone-voice' ||
    operation === 'convert-voice' ||
    operation === 'style-transfer' ||
    operation === 'relight' ||
    operation === 'generate-music'
  ) return 'fal';
  return null;
}

function falModelFor(operation: VideoAIOperation) {
  const models: Partial<Record<VideoAIOperation, string | undefined>> = {
    'generate-image': process.env.FAL_IMAGE_MODEL || 'fal-ai/flux/schnell',
    'generate-video': process.env.FAL_VIDEO_MODEL,
    'generate-voice': process.env.FAL_VOICE_MODEL || 'fal-ai/elevenlabs/tts/turbo-v2.5',
    'clone-voice': process.env.FAL_VOICE_CLONE_MODEL,
    'convert-voice': process.env.FAL_VOICE_CONVERT_MODEL,
    'generate-music': process.env.FAL_MUSIC_MODEL || 'fal-ai/stable-audio',
    'remove-object': process.env.FAL_OBJECT_REMOVE_MODEL,
    'track-object': process.env.FAL_OBJECT_TRACK_MODEL,
    'style-transfer': process.env.FAL_STYLE_MODEL,
    'relight': process.env.FAL_RELIGHT_MODEL,
  };
  return models[operation];
}

function hasKey(provider: Provider) {
  return provider === 'huggingface'
    ? Boolean(process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN)
    : provider === 'fal'
      ? Boolean(process.env.FAL_KEY)
      : provider === 'replicate'
        ? Boolean(process.env.REPLICATE_API_TOKEN)
        : Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}

function requiredKey(provider: Provider) {
  if (provider === 'huggingface') return 'HUGGINGFACE_API_KEY (or HF_TOKEN)';
  if (provider === 'fal') return 'FAL_KEY';
  if (provider === 'replicate') return 'REPLICATE_API_TOKEN';
  return 'CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET';
}

async function jsonFetch(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.detail || data?.message || `AI provider request failed (${response.status}).`);
  }
  return data;
}

async function huggingFace(input: AIJobInput): Promise<AIResult> {
  const key = process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN;
  if (!key) throw new Error(`Hugging Face is not configured. Add ${requiredKey('huggingface')} to Vercel.`);
  if (!input.mediaUrl) throw new Error('Select or import media before using this AI tool.');

  const model =
    input.operation === 'remove-background'
      ? (process.env.HF_BACKGROUND_MODEL || 'briaai/RMBG-2.0')
      : input.operation === 'enhance'
        ? (process.env.HF_ENHANCE_MODEL || 'caidas/swin2SR-classical-sr-x2-64')
        : (process.env.HF_VIDEO_MODEL || 'facebook/detr-resnet-50');

  const source = await fetch(input.mediaUrl, { cache: 'no-store' });
  if (!source.ok) throw new Error(`Could not read source media (${source.status}).`);
  const mediaBytes = await source.arrayBuffer();
  const contentType = source.headers.get('content-type') || 'application/octet-stream';

  const response = await fetch(`https://router.huggingface.co/hf-inference/models/${encodeURIComponent(model)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': contentType },
    body: mediaBytes,
    cache: 'no-store',
  });
  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(message || `Hugging Face request failed (${response.status}).`);
  }
  const responseContentType = response.headers.get('content-type') || '';
  if (responseContentType.includes('application/json')) {
    const data = await response.json().catch(() => ({}));
    return { operation: input.operation, provider: 'huggingface', output: data };
  }
  const bytes = await response.arrayBuffer();
  return {
    operation: input.operation,
    provider: 'huggingface',
    output: {
      bytesBase64: Buffer.from(bytes).toString('base64'),
      contentType: responseContentType,
      model,
    },
  };
}

async function fal(input: AIJobInput): Promise<AIResult> {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error(`fal.ai is not configured. Add ${requiredKey('fal')} to Vercel.`);

  const endpoint = falModelFor(input.operation);
  if (!endpoint) {
    throw new Error(`No fal.ai model is configured for "${input.operation}". Add the matching FAL_*_MODEL environment variable in Vercel.`);
  }

  const payload: Record<string, unknown> = {
    prompt: input.prompt || 'Create a professional creative asset for a video edit.',
  };
  if (input.mediaUrl) {
    if (input.mediaType === 'image') payload.image_url = input.mediaUrl;
    else if (input.mediaType === 'video') payload.video_url = input.mediaUrl;
    else if (input.mediaType === 'audio') payload.audio_url = input.mediaUrl;
  }
  if (input.mediaUrls?.length) payload.media_urls = input.mediaUrls;

  const output = await jsonFetch(`https://queue.fal.run/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const requestId = String(output?.request_id || output?.requestId || '');
  if (!requestId) return { operation: input.operation, provider: 'fal', output: { ...output, model: endpoint } };

  const statusUrl = `https://queue.fal.run/${endpoint}/requests/${encodeURIComponent(requestId)}/status`;
  const resultUrl = `https://queue.fal.run/${endpoint}/requests/${encodeURIComponent(requestId)}`;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(3000, 700 + attempt * 40)));
    const status = await jsonFetch(statusUrl, { method: 'GET', headers: { Authorization: `Key ${key}` } });
    const state = String(status?.status || status?.state || '').toUpperCase();
    if (state === 'COMPLETED' || state === 'SUCCEEDED') {
      const result = await jsonFetch(resultUrl, { method: 'GET', headers: { Authorization: `Key ${key}` } });
      return { operation: input.operation, provider: 'fal', output: { ...result, model: endpoint, requestId } };
    }
    if (state === 'FAILED' || state === 'ERROR' || state === 'CANCELLED') {
      throw new Error(String(status?.error || status?.message || `fal.ai job ${state.toLowerCase()}.`));
    }
  }
  throw new Error('The AI operation is still processing. Please try again shortly.');
}

export async function runExternalVideoAI(input: AIJobInput): Promise<AIResult | null> {
  const provider = providerFor(input.operation);
  if (!provider || !hasKey(provider)) return null;

  if (provider === 'huggingface') return huggingFace(input);
  if (provider === 'fal') return fal(input);
  return null;
}

export function configuredExternalProviders() {
  return {
    huggingface: hasKey('huggingface'),
    fal: hasKey('fal'),
    replicate: hasKey('replicate'),
    cloudinary: hasKey('cloudinary'),
  };
}
