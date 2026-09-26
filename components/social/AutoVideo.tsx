'use client';

import React, { useCallback, useEffect, useRef } from 'react';

/**
 * AutoVideo — post/story video playback with frame-first autoplay.
 *
 * Some browsers can make the audio track audible as soon as play() starts
 * while the first decoded video frame is still being presented. That is very
 * noticeable in a social feed because the soundtrack appears to lead the
 * picture. We wait for the first video frame before starting playback.
 */
export default function AutoVideo({
  src,
  className,
  controls = true,
  loop = true,
  muted = false,
  preload = 'auto',
  onClick,
}: {
  src: string;
  className?: string;
  controls?: boolean;
  loop?: boolean;
  muted?: boolean;
  preload?: 'auto' | 'metadata' | 'none';
  onClick?: (e: React.MouseEvent<HTMLVideoElement>) => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const playRequestRef = useRef(0);

  const playFrameFirst = useCallback(() => {
    const el = ref.current;
    if (!el) return;

    const requestId = ++playRequestRef.current;
    const startPlayback = () => {
      if (requestId !== playRequestRef.current || !ref.current) return;
      ref.current.play().catch(() => {
        /* Autoplay with sound may be blocked until a user gesture. */
      });
    };

    // HAVE_CURRENT_DATA means the current video frame is available.
    if (el.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

    // Prefer the browser's decoded-frame callback so playback cannot expose
    // the audio track before a real video frame has reached the compositor.
    if ('requestVideoFrameCallback' in el) {
      const video = el as HTMLVideoElement & {
        requestVideoFrameCallback?: (callback: () => void) => number;
      };
      video.requestVideoFrameCallback?.(() => startPlayback());
    } else {
      // Safari/older browsers: one animation frame gives the decoded frame
      // an opportunity to be presented before media playback begins.
      requestAnimationFrame(startPlayback);
    }
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || !src) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.intersectionRatio >= 0.6) {
            playFrameFirst();
          } else {
            playRequestRef.current += 1;
            el.pause();
            el.currentTime = 0;
          }
        }
      },
      { threshold: [0, 0.6] },
    );

    const onLoadedData = () => {
      if (el.getBoundingClientRect().height > 0) playFrameFirst();
    };

    el.addEventListener('loadeddata', onLoadedData);
    observer.observe(el);

    return () => {
      playRequestRef.current += 1;
      el.removeEventListener('loadeddata', onLoadedData);
      observer.disconnect();
    };
  }, [src, playFrameFirst]);

  return (
    <video
      ref={ref}
      src={src}
      className={className}
      controls={controls}
      loop={loop}
      muted={muted}
      playsInline
      preload={preload}
      onClick={onClick}
    />
  );
}
