import type { AIJobInput, AIResult, VideoAIOperation } from '@/lib/video/ai';

type Provider = 'huggingface' | 'fal' | 'replicate' | 'cloudinary';

type AIDefaultProvider = 'free' | 'auto' | Provider;

function defaultProvider(): AIDefaultProvider {
  const value = String(process.env.AI_DEFAULT_PROVIDER || 'auto').trim().toLowerCase();
  if (value === 'free' || value === 'auto' || value === 'huggingface' || value === 'fal' || value === 'replicate' || value === 'cloudinary') {
    return value;
  }
  return 'auto';
}

function providerFor(operation: VideoAIOperation): Provider | null {
  const preferred = defaultProvider();

  /* "free" is a real execution mode: the API route sends these operations
     through ENOTES' built-in/local/Gemini/HF-capable path instead of trying
     to silently use a paid cloud media provider. */
  if (preferred === 'free') return null;

  if (preferred === 'fal') {
    return operation === 'remove-object' ||
      operation === 'track-object' ||
      operation === 'generate-image' ||
      operation === 'generate-video' ||
      operation === 'generate-voice' ||
      operation === 'clone-voice' ||
      operation === 'convert-voice' ||
      operation === 'style-transfer' ||
      operation === 'relight' ||
      operation === 'generate-music' ||
      operation === 'remove-background'
      ? 'fal'
      : null;
  }

  if (preferred === 'huggingface') {
    return operation === 'enhance' || operation === 'remove-background'
      ? 'huggingface'
      : null;
  }

  if (preferred === 'auto') {
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

    if (operation === 'enhance') return 'huggingface';
  }

  return null;
}

function falModelFor(operation: VideoAIOperation, mediaType?: AIJobInput['mediaType']) {
  const models: Partial<Record<VideoAIOperation, string | undefined>> = {
    'generate-image': process.env.FAL_IMAGE_MODEL || 'fal-ai/flux/schnell',
    'generate-video': process.env.FAL_VIDEO_MODEL || 'fal-ai/kling-video/v3/standard/text-to-video',
    'generate-voice': process.env.FAL_VOICE_MODEL || 'fal-ai/elevenlabs/tts/turbo-v2.5',
    'clone-voice': process.env.FAL_VOICE_CLONE_MODEL || 'fal-ai/minimax/voice-clone',
    'convert-voice': process.env.FAL_VOICE_CONVERT_MODEL || 'fal-ai/elevenlabs/voice-changer',
    'generate-music': process.env.FAL_MUSIC_MODEL || 'fal-ai/stable-audio',
    'remove-background':
      mediaType === 'video'
        ? process.env.FAL_BACKGROUND_VIDEO_MODEL || 'bria/video/background-removal/v3'
        : process.env.FAL_BACKGROUND_IMAGE_MODEL || process.env.FAL_BACKGROUND_MODEL || 'fal-ai/bria/background/remove',
    'remove-object': process.env.FAL_OBJECT_REMOVE_MODEL || 'fal-ai/object-removal',
    'track-object': process.env.FAL_OBJECT_TRACK_MODEL,
    'style-transfer': process.env.FAL_STYLE_MODEL || 'fal-ai/image-apps-v2/style-transfer',
    'relight': process.env.FAL_RELIGHT_MODEL || 'bria/fibo-edit/relight',
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

function falInputFor(input: AIJobInput): Record<string, unknown> {
  const prompt = String(input.prompt || '').trim() || 'Create a professional creative asset for a video edit.';

  switch (input.operation) {
    case 'generate-image':
      return { prompt };

    case 'generate-video': {
      const customVideoModel = Boolean(process.env.FAL_VIDEO_MODEL);
      return {
        prompt,
        ...(customVideoModel && input.mediaType === 'image' && input.mediaUrl
          ? { image_url: input.mediaUrl }
          : {}),
        ...(customVideoModel && input.mediaType === 'video' && input.mediaUrl
          ? { video_url: input.mediaUrl }
          : {}),
      };
    }

    case 'remove-background':
      if (!input.mediaUrl) throw new Error('Select an image or video before removing its background.');
      if (input.mediaType === 'video') {
        return {
          video_url: input.mediaUrl,
          background_color: 'Transparent',
          output_container_and_codec: 'webm_vp9',
          preserve_audio: true,
        };
      }
      return { image_url: input.mediaUrl };

    case 'remove-object':
      if (!input.mediaUrl || input.mediaType !== 'image') {
        throw new Error('Remove Object currently requires an image. Select an image first.');
      }
      return {
        image_url: input.mediaUrl,
        prompt: String(input.prompt || '').trim() || 'Remove the unwanted object from this image.',
      };

    case 'style-transfer':
      if (!input.mediaUrl || input.mediaType !== 'image') {
        throw new Error('Style Transfer currently works on images. Select an image first.');
      }
      return {
        image_url: input.mediaUrl,
        target_style: (() => { const requested = String(input.prompt || '').trim().toLowerCase().replace(/\s+/g, '_'); const allowed = new Set(['anime_character','cartoon_3d','hand_drawn_animation','cyberpunk_future','anime_game_style','comic_book_animation','animated_series','cartoon_animation','lofi_aesthetic','cottagecore','dark_academia','y2k','vaporwave','liminal_space','weirdcore','dreamcore','synthwave','outrun','photorealistic','hyperrealistic','digital_art','concept_art','impressionist','anime','pixel_art','claymation']); return allowed.has(requested) ? requested : 'impressionist'; })(),
      };

    case 'relight':
      if (!input.mediaUrl || input.mediaType !== 'image') {
        throw new Error('AI Relight currently works on images. Select an image first.');
      }
      return {
        image_url: input.mediaUrl,
        light_direction: 'front',
        light_type: (() => { const requested = String(input.prompt || '').trim().toLowerCase(); const allowed = ['soft overcast daylight lighting','warm sunset lighting','cool moonlight','studio lighting','dramatic side lighting','soft frontal lighting','golden hour lighting','neon lighting']; return allowed.includes(requested) ? requested : 'soft overcast daylight lighting'; })(),
      };

    case 'generate-voice':
      return { text: prompt };

    case 'clone-voice':
      if (!input.mediaUrl || input.mediaType === 'video') {
        throw new Error('Clone Voice needs an audio sample. Select an audio source first.');
      }
      return {
        audio_url: input.mediaUrl,
        text: String(input.prompt || '').trim() || 'Hello, this is a preview of the cloned voice.',
      };

    case 'convert-voice':
      if (!input.mediaUrl || input.mediaType === 'video') {
        throw new Error('Voice Convert needs an audio source. Select an audio clip first.');
      }
      return {
        audio_url: input.mediaUrl,
        voice: String(input.prompt || '').trim() || 'Aria',
        output_format: 'mp3_44100_128',
      };

    case 'generate-music':
      return { prompt };

    default:
      throw new Error('No fal.ai media adapter is implemented for "' + input.operation + '" yet.');
  }
}

async function fal(input: AIJobInput): Promise<AIResult> {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error('fal.ai is not configured. Add FAL_KEY to Vercel.');

  const endpoint = falModelFor(input.operation, input.mediaType);
  if (!endpoint) {
    throw new Error(
      'No fal.ai model is configured for "' + input.operation +
      '". Add the matching FAL_*_MODEL environment variable in Vercel.',
    );
  }

  const payload = falInputFor(input);

  const output = await jsonFetch('https://queue.fal.run/' + endpoint, {
    method: 'POST',
    headers: {
      Authorization: 'Key ' + key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const requestId = String(output?.request_id || output?.requestId || '');
  if (!requestId) {
    return { operation: input.operation, provider: 'fal', output: { ...output, model: endpoint } };
  }

  const statusUrl =
    'https://queue.fal.run/' + endpoint + '/requests/' + encodeURIComponent(requestId) + '/status';
  const resultUrl =
    'https://queue.fal.run/' + endpoint + '/requests/' + encodeURIComponent(requestId);

  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(3000, 700 + attempt * 40)));

    const status = await jsonFetch(statusUrl, {
      method: 'GET',
      headers: { Authorization: 'Key ' + key },
    });

    const state = String(status?.status || status?.state || '').toUpperCase();

    if (state === 'COMPLETED' || state === 'SUCCEEDED') {
      const result = await jsonFetch(resultUrl, {
        method: 'GET',
        headers: { Authorization: 'Key ' + key },
      });
      return {
        operation: input.operation,
        provider: 'fal',
        output: { ...result, model: endpoint, requestId },
      };
    }

    if (state === 'FAILED' || state === 'ERROR' || state === 'CANCELLED') {
      throw new Error(
        String(status?.error?.message || status?.error || status?.message || ('fal.ai job ' + state.toLowerCase() + '.')),
      );
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
    default: defaultProvider(),
    huggingface: hasKey('huggingface'),
    fal: hasKey('fal'),
    replicate: hasKey('replicate'),
    cloudinary: hasKey('cloudinary'),
  };
}
