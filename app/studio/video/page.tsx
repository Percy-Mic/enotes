      fadeOut: 1,
      kind,
    };
    updateProject((p) => {
      const end = track.start + Math.max(0.1, track.trimEnd - track.trimStart);
      const audioTracks = p.tracks.filter((t) => t.kind === 'audio').sort((x, y) => x.order - y.order);
      /* Never place newly-added audio onto a muted lane. Audio clips are
         independent sources: adding one must never silence an existing clip
         or inherit a lane that is intentionally muted. If every usable lane
         is occupied, a fresh unmuted lane is created. */
      let target = audioTracks.find((lane) => !lane.locked && !lane.muted && p.audio.every((a) => {
        if ((a.track_id || audioTracks[0]?.id) !== lane.id) return true;
        const aEnd = a.start + Math.max(0.1, a.trimEnd - a.trimStart);
        return end <= a.start || track.start >= aEnd;
      }));

      let tracks = p.tracks;
      if (!target) {
        const nextNumber = audioTracks.length + 1;
        target = {
          id: makeVideoId('track'),
          name: `A${nextNumber}`,
          kind: 'audio' as const,
          order: p.tracks.length,
          muted: false,
          locked: false,
          solo: false,
        };
        tracks = [...p.tracks, target];
      }