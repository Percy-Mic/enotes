'use client';

import React, { Suspense } from 'react';
import VideoStudioRebuild from '@/components/studio/VideoStudioRebuild';

function StudioLoading() {
  return (
    <main className="flex h-[100dvh] items-center justify-center bg-[#0d0d0d] text-white">
      <div className="text-sm text-white/50">Loading editor…</div>
    </main>
  );
}

export default function VideoStudioPage() {
  return (
    <Suspense fallback={<StudioLoading />}>
      <VideoStudioRebuild />
    </Suspense>
  );
}
