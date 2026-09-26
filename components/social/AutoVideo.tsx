'use client';

import React, { useEffect, useRef } from 'react';

export default function AutoVideo({
  src,
  className,
  controls = true,
  loop = true,
  muted = false,
  preload = 'metadata',
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
  const pendingPlayRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !src) return;

    let visible = false;

    const startAfterFrame = () => {
      if (!visible || !pendingPlayRef.current) return;
      pendingPlayRef.current = false;

      // Let the browser paint the first available video frame first.
      requestAnimationFrame(() => {
        if (!visible) return;

        requestAnimationFrame(() => {
          if (!visible) return;
          el.play().catch(() => {
            /* Autoplay may wait for a user gesture. */
          });
        });
      });
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visible = entry.intersectionRatio >= 0.6;

          if (visible) {
            pendingPlayRef.current = true;

            if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
              startAfterFrame();
            }
          } else {
            pendingPlayRef.current = false;
            el.pause();
            el.currentTime = 0;
          }
        }
      },
      { threshold: [0, 0.6] },
    );

    const onLoadedData = () => {
      if (visible) {
        pendingPlayRef.current = true;
        startAfterFrame();
      }
    };

    el.addEventListener('loadeddata', onLoadedData);
    observer.observe(el);

    return () => {
      pendingPlayRef.current = false;
      el.pause();
      el.removeEventListener('loadeddata', onLoadedData);
      observer.disconnect();
    };
  }, [src]);

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
