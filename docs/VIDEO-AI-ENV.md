# Video AI + media provider setup

The video editor is designed to work without paid AI providers.

## Recommended free-tier providers

### Hugging Face Inference Providers

Use Hugging Face for AI operations such as background removal and image enhancement.

```env
HUGGINGFACE_API_KEY=
# HF_TOKEN=  # alias accepted

# Optional model overrides
HF_ENHANCE_MODEL=caidas/swin2SR-classical-sr-x2-64
```

Hugging Face's free allowance is limited and can change. It is not an unlimited free API.

### Cloudinary

Cloudinary is used as an optional media-processing/optimization layer for imported Studio media. Supabase remains the source of truth, so the editor still works if Cloudinary is not configured or its free quota is unavailable.

```env
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

The editor sends imported Studio media through:

`POST /api/video/cloudinary`

Supported processing modes:

- `optimize` — automatic quality/format optimization
- `vertical` — fit within 1080×1920
- `square` — fit within 1080×1080
- `landscape` — fit within 1920×1080

The source is first uploaded to Supabase. When Cloudinary is configured, the optimized Cloudinary URL is used by the editor; otherwise it automatically keeps the Supabase URL.

## Existing AI assistant

```env
GEMINI_API_KEY=
```

The existing enotes AI assistant remains separate from the media-processing providers.

## Important

- Never use `NEXT_PUBLIC_` for secret provider keys.
- Keep Cloudinary and Hugging Face secrets server-side.
- The editor's media-generation/removal features use fal.ai when `FAL_KEY` is configured.
- Cloudinary's free plan and Hugging Face's free allowance have usage limits; this implementation does not assume unlimited usage.
- Supabase storage/RLS remains the source of truth for user-owned Studio uploads.


### Pro AI effects and generation

The editor's AI provider layer also supports these optional operations:

- generate-video
- remove-object
- track-object
- style-transfer
- relight
- clone-voice
- convert-voice

These are deliberately model-configurable because different AI providers expose different input/output schemas.

Recommended Vercel environment variables:

FAL_VIDEO_MODEL=
FAL_OBJECT_REMOVE_MODEL=
FAL_OBJECT_TRACK_MODEL=
FAL_STYLE_MODEL=
FAL_RELIGHT_MODEL=
FAL_VOICE_CLONE_MODEL=
FAL_VOICE_CONVERT_MODEL=
FAL_BACKGROUND_IMAGE_MODEL=
FAL_BACKGROUND_VIDEO_MODEL=

Existing variables remain supported: FAL_KEY, FAL_IMAGE_MODEL, FAL_VOICE_MODEL and FAL_MUSIC_MODEL.

The AI layer also recognizes auto-edit and recommend-effects through the existing Gemini editing planner. generate-captions and transcribe continue using the existing speech providers.

AI model processing is optional: the local editor, timeline, effects, keyframes, audio processing and export continue to work without these providers.


### Built-in fal.ai defaults

When only `FAL_KEY` is configured, the editor now uses dedicated fal.ai endpoints instead of routing these operations through Hugging Face:

- Remove background — Bria RMBG 2.0 for images; Bria VRMBG 3.0 for video.
- Remove object — fal-ai/object-removal for images.
- Style transfer — fal-ai/image-apps-v2/style-transfer for images.
- AI relight — bria/fibo-edit/relight for images.
- Generate image — fal-ai/flux/schnell.
- Generate video — fal-ai/kling-video/v1/standard/text-to-video.
- Clone voice — fal-ai/minimax/voice-clone.
- Voice convert — fal-ai/elevenlabs/voice-changer.
- Generate voice — fal-ai/elevenlabs/tts/turbo-v2.5.
- Generate music — fal-ai/stable-audio.

Some operations intentionally require a matching media type. For example, object removal/style transfer/relight currently operate on images, while video background removal requires a video. The UI reports that requirement instead of sending an incompatible request.
