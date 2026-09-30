import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { cloudinaryConfigured, cloudinaryProcessUrl, type CloudinaryMediaType, type CloudinaryProcessMode } from '@/lib/video/cloudinary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    if (!cloudinaryConfigured()) {
      return NextResponse.json({ configured: false, error: 'Cloudinary is not configured.' }, { status: 503 });
    }

    const db = await createClient();
    const { data: auth } = await db.auth.getUser();
    if (!auth.user) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 });

    const body = (await request.json()) as {
      url?: unknown;
      mediaType?: unknown;
      mode?: unknown;
    };
    const url = String(body.url || '').trim();
    const mediaType = String(body.mediaType || 'video') as CloudinaryMediaType;
    const mode = String(body.mode || 'optimize') as CloudinaryProcessMode;
    if (!/^https?:\/\//i.test(url)) return NextResponse.json({ error: 'A valid source URL is required.' }, { status: 400 });
    if (!['image', 'video', 'audio'].includes(mediaType)) return NextResponse.json({ error: 'Unsupported media type.' }, { status: 400 });
    if (!['optimize', 'vertical', 'square', 'landscape'].includes(mode)) return NextResponse.json({ error: 'Unsupported processing mode.' }, { status: 400 });

    const result = await cloudinaryProcessUrl({ url, userId: auth.user.id, mediaType, mode });
    return NextResponse.json({ configured: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Cloudinary processing failed.' }, { status: 502 });
  }
}
