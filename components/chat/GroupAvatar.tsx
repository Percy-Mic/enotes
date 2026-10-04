'use client';

import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';

interface GroupAvatarProps {
  src?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
}

/** One authoritative group-chat image renderer used by both inbox and chat header. */
export default function GroupAvatar({ src, name, size = 48, className = '' }: GroupAvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const usableSrc = src?.trim() || null;
  const showImage = !!usableSrc && failedSrc !== usableSrc;

  useEffect(() => {
    if (!usableSrc) setFailedSrc(null);
    else if (failedSrc && failedSrc !== usableSrc) setFailedSrc(null);
  }, [usableSrc, failedSrc]);

  return (
    <span
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[#EDE4FF] to-[#D8C7FA] text-[#6D4AC2] ring-1 ring-black/10 ${className}`}
      style={{ width: size, height: size }}
      aria-label={name ? `${name} group photo` : 'Group photo'}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={usableSrc}
          src={usableSrc!}
          alt={name ? `${name} group photo` : 'Group photo'}
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          onError={() => setFailedSrc(usableSrc)}
        />
      ) : (
        <Users className="h-[45%] w-[45%]" aria-hidden="true" />
      )}
    </span>
  );
}
