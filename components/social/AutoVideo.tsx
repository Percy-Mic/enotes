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

  useEffect(() => {
    const el = ref.current;
    if (!el || !src) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.intersectionRatio >= 0.6) {
            el.play().catch(() => {
              /* autoplay blocked until first user gesture — tap plays */
            });
          } else {
            el.pause();
            el.currentTime = 0;
          }
        }
      },
      { threshold: [0, 0.6] },
    );
    observer.observe(el);
    return () => observer.disconnect();
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
