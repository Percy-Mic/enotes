import type { AIJobInput, AIResult, VideoAIOperation } from '@/lib/video/ai';

type Provider = 'huggingface' | 'fal' | 'replicate' | 'cloudinary';

function providerFor(operation: VideoAIOperation): Provider | null {
  if (operation === 'remove-background') return 'huggingface';
  if (operation === 'remove-object' || operation === 'track-object' || operation === 'enhance') return 'huggingface';
  if (operation === 'generate-image' || operation === 'generate-voice' || operation === 'generate-music') return 'fal';
  return null;
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
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await response.json().catch(() => ({}));
    return { operation: input.operation, provider: 'huggingface', output: data };
  }
  const bytes = await response.arrayBuffer();
  return {
    operation: input.operation,
    provider: 'huggingface',
    output: {
      bytesBase64: Buffer.from(bytes).toString('base64'),
      contentType,
      model,
    },
  };
}

async function fal(input: AIJobInput): Promise<AIResult> {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error(`fal.ai is not configured. Add ${requiredKey('fal')} to Vercel.`);

  const endpoint =
    input.operation === 'generate-image'
      ? (process.env.FAL_IMAGE_MODEL || 'fal-ai/flux/schnell')
      : input.operation === 'generate-voice'
        ? (process.env.FAL_VOICE_MODEL || 'fal-ai/elevenlabs/tts/turbo-v2.5')
        : (process.env.FAL_MUSIC_MODEL || 'fal-ai/stable-audio');

  const output = await jsonFetch(`https://queue.fal.run/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: input.prompt || 'Create a professional creative asset for a video edit.',
      image_url: input.mediaType === 'image' ? input.mediaUrl || undefined : undefined,
    }),
  });

  return { operation: input.operation, provider: 'fal', output: { ...output, model: endpoint } };
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
