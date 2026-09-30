# Video AI + media provider setup

The video editor is designed to work without paid AI providers.

## Recommended free-tier providers

### Hugging Face Inference Providers

Use Hugging Face for AI operations such as background removal and image enhancement.

```env
HUGGINGFACE_API_KEY=
# HF_TOKEN=  # alias accepted

# Optional model overrides
HF_BACKGROUND_MODEL=briaai/RMBG-2.0
HF_ENHANCE_MODEL=caidas/swin2SR-classical-sr-x2-64
HF_VIDEO_MODEL=facebook/detr-resnet-50
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
- You do **not** need `FAL_KEY` or `REPLICATE_API_TOKEN` for the free-tier implementation above.
- Cloudinary's free plan and Hugging Face's free allowance have usage limits; this implementation does not assume unlimited usage.
- Supabase storage/RLS remains the source of truth for user-owned Studio uploads.
