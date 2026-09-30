# Video AI provider setup

The video editor works without these keys. Add them later in Vercel Project Settings -> Environment Variables.

## Optional providers

```env
# Existing AI editor
GEMINI_API_KEY=

# AI vision / background / enhancement
HUGGINGFACE_API_KEY=
# HF_TOKEN=  # alias accepted

# Generative image / voice / music
FAL_KEY=

# Reserved for future provider adapters
REPLICATE_API_TOKEN=

# Media pipeline (Cloudinary is optional and is not required for local editing)
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# Optional model overrides
HF_BACKGROUND_MODEL=briaai/RMBG-2.0
HF_ENHANCE_MODEL=caidas/swin2SR-classical-sr-x2-64
FAL_IMAGE_MODEL=fal-ai/flux/schnell
FAL_VOICE_MODEL=fal-ai/elevenlabs/tts/turbo-v2.5
FAL_MUSIC_MODEL=fal-ai/stable-audio
```

## Important

- Never use `NEXT_PUBLIC_` for secret API keys.
- The browser calls `/api/video/ai`; provider keys stay server-side.
- If a provider key is absent, the existing enotes AI/local implementation remains the fallback.
- Adding keys does not require changing the video editor UI.
- Some generative providers are usage-billed; the provider layer only activates when its key is configured.
- Keep Supabase storage/RLS as the source of truth for user media.
