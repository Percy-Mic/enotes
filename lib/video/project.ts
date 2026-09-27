      license: track.license ? String(track.license) : undefined,
      creator: track.creator ? String(track.creator) : undefined,
      start: Math.max(0, Number(track.start) || 0), trimStart: Math.max(0, Number(track.trimStart) || 0),
      trimEnd: Math.max(0.1, Number(track.trimEnd) || 0.1), volume: Math.max(0, Math.min(1, Number(track.volume) || 0)),
      fadeIn: Math.max(0, Number(track.fadeIn) || 0), fadeOut: Math.max(0, Number(track.fadeOut) || 0),
      kind: track.kind === 'voiceover' ? 'voiceover' : 'music',
    };
  }) : [];

  const tracks: TimelineTrack[] = Array.isArray(raw.tracks)
    ? (raw.tracks as unknown[]).map((value, index) => {
        const t = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
        return {
          id: String(t.id || makeVideoId('track')),
          name: String(t.name || `Track ${index + 1}`),
          kind: t.kind === 'audio' || t.kind === 'overlay' ? t.kind : 'video',
          order: Number.isFinite(Number(t.order)) ? Number(t.order) : index,
          muted: Boolean(t.muted),
          locked: Boolean(t.locked),
          solo: Boolean(t.solo),
        } as TimelineTrack;
      })
    : [];

  const safeTracks: TimelineTrack[] = tracks.length
    ? [...tracks].sort((a, b) => a.order - b.order)
    : [