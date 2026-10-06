             Web Audio graph if an effect is added later. */
          videoAudio.crossOrigin = 'anonymous';
          videoAudio.preload = 'auto';
          videoAudio.muted = false;
          videoAudio.defaultMuted = false;
          videoAudio.playsInline = true;
          videoAudio.setAttribute('playsinline', '');
          audio = videoAudio;
          audio.src = clip.src;
          previewAudioRef.current.set(clipId, audio);
        }

        const local = Math.max(0, time - clipStart);
        const playbackSpeed = Math.max(0.0625, clip.speed || 1);
        /*
         * The project duration can come from imported metadata and may be a
         * fraction longer than the browser's actual decoded media duration.
         * Never seek an audio element past its real duration: doing so can put
         * the decoder into an ended/stalled state and makes playback appear to
         * randomly stop.
         */
        const decodedDuration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Infinity;
        const safeTrimStart = Math.max(0, Math.min(clip.trimStart, Math.max(0, decodedDuration - 0.02)));
        const safeTrimEnd = Math.max(
          safeTrimStart + 0.01,
          Math.min(clip.trimEnd, decodedDuration),
        );
        const target = clip.reverse
          ? Math.max(
              safeTrimStart,
              Math.min(
                Math.max(safeTrimStart, safeTrimEnd - 0.01),
                safeTrimEnd - local * playbackSpeed
              )
            )
          : Math.max(
              safeTrimStart,
              Math.min(
                Math.max(safeTrimStart, safeTrimEnd - 0.01),
                safeTrimStart + local * playbackSpeed
              )
            );
        audio.playbackRate = Math.max(0.0625, Math.min(16, clip.speed || 1));
        /*
         * The canvas renderer uses a muted video element for pixels. This
         * separate element is the authoritative audible copy of the clip.
         * Keep native audio explicitly enabled; Web Audio is optional DSP,
         * never a prerequisite for hearing the original soundtrack.
         */
        audio.muted = false;
        audio.defaultMuted = false;
        const resolvedAudio = resolveClipValues(clip, local);
        audio.volume = resolvedAudio.volume;
        ensurePreviewAudioGraph(clipId, audio, clip.audioProcessing?.effects);
        /*
         * During continuous playback the media decoder is its own clock.
         * Re-seeking it every time the React/editor clock drifts by a small
         * amount causes audible clicks and intermittent stops. Only seek when
         * paused/not yet started, or when the drift is genuinely large.
         */
        const audioDrift = Math.abs(audio.currentTime - target);
        if (!shouldPlay || audio.paused) {
          if (audioDrift > 0.05) {
            try { audio.currentTime = target; } catch { /* wait for metadata */ }
          }
        } else if (audioDrift > 0.65) {
          try { audio.currentTime = target; } catch { /* ignore transient decoder state */ }
        }
        if (shouldPlay) {
          const requested = previewAudioPlayRequestedRef.current.has(clipId);
          if (audio.paused && !requested) {
            previewAudioPlayRequestedRef.current.add(clipId);
            void audio.play()
              .then(() => {
                previewAudioUnlockedRef.current = true;
                previewAudioPlayRequestedRef.current.delete(clipId);
              })
              .catch(() => {
                previewAudioPlayRequestedRef.current.delete(clipId);
              });
          }
        } else {
          previewAudioPlayRequestedRef.current.delete(clipId);
          if (!audio.paused) audio.pause();
        }
      }

      clipStart += clipProjectDuration;
    }

    /* Video overlays can also carry their own soundtrack. The canvas
       compositor keeps its video element muted, so this is the audible
       copy synchronized to the same project clock. */
    for (const el of p.elements) {
      if (el.kind !== 'video' || !el.src || isPlaceholder(el.src)) continue;
      const key = `element-audio:${el.id}`;
      const local = time - el.start;
      const duration = Math.max(0.05, el.end - el.start);
      const inRange = !p.masterMuted && !el.muted && (el.volume ?? 1) > 0 && local >= 0 && local < duration;
      if (!inRange) continue;
      activeIds.add(key);

      let audio = previewAudioRef.current.get(key);
      if (!audio || audio.src !== el.src) {
        audio?.pause();
        const videoAudio = document.createElement('video');
        /* TimelineElement has no audioProcessing field. Keep its native
           media audio path independent from optional DSP effects. CORS must
           be configured BEFORE src so a later Web Audio graph can attach. */
        videoAudio.crossOrigin = 'anonymous';
        videoAudio.preload = 'auto';
        videoAudio.playsInline = true;
        videoAudio.setAttribute('playsinline', '');
        audio = videoAudio;
        audio.src = el.src;
        previewAudioRef.current.set(key, audio);
      }

      const speed = Math.max(0.0625, Math.min(16, el.speed || 1));
      const trimStart = Math.max(0, el.trim_start || 0);
      const trimEnd = Math.max(trimStart + 0.05, el.trim_end || el.source_duration || duration);
      const decodedDuration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Infinity;
      const safeEnd = Math.min(trimEnd, decodedDuration);
      const safeStart = Math.min(trimStart, Math.max(0, safeEnd - 0.02));
      const target = el.reverse
        ? Math.max(safeStart, Math.min(safeEnd - 0.01, safeEnd - local * speed))
        : Math.max(safeStart, Math.min(safeEnd - 0.01, safeStart + local * speed));
      audio.playbackRate = speed;
      audio.volume = Math.max(0, Math.min(1, resolveElementValues(el, local).volume));
      const audioDrift = Math.abs(audio.currentTime - target);
      if (!shouldPlay || audio.paused) {
        if (audioDrift > 0.05) {
          try { audio.currentTime = target; } catch { /* wait for metadata */ }
        }
      } else if (audioDrift > 0.65) {
        try { audio.currentTime = target; } catch { /* ignore transient decoder state */ }
      }
      if (shouldPlay && audio.paused) {
        void audio.play()
          .then(() => { previewAudioUnlockedRef.current = true; })
          .catch(() => { /* retried on the next user-initiated synchronization pass */ });
      }
    }

    /* Separate music/voiceover lanes continue to play simultaneously. */
    for (const track of p.audio) {
      const lane = lanes.find((t) => t.id === track.track_id) || lanes[0];
      if (lane?.muted || (soloActive && !lane?.solo) || track.volume <= 0 || !track.src) continue;
      const key = `audio:${track.id}`;
      activeIds.add(key);

      let audio = previewAudioRef.current.get(key);
      if (!audio || audio.src !== track.src) {
        audio?.pause();
        audio = new Audio();
        /* Effects may be enabled after playback has begun, so CORS must be
           configured before src on the original media element. */
        audio.crossOrigin = 'anonymous';
        audio.preload = 'auto';
        audio.src = track.src;
        previewAudioRef.current.set(key, audio);
      }

      const local = time - track.start;
      const duration = Math.max(0.05, track.trimEnd - track.trimStart);
      const inRange = local >= 0 && local < duration;
      const decodedDuration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Infinity;
      const safeEnd = Math.min(track.trimEnd, decodedDuration);
      const safeStart = Math.min(track.trimStart, Math.max(0, safeEnd - 0.02));
      const target = Math.max(0, Math.min(safeEnd - 0.01, safeStart + Math.max(0, local)));
      const fadeIn = track.fadeIn > 0 ? Math.min(1, local / track.fadeIn) : 1;
      const fadeOut = track.fadeOut > 0 ? Math.min(1, (duration - local) / track.fadeOut) : 1;
      const volume = Math.max(0, Math.min(1, track.volume * Math.min(fadeIn, fadeOut)));
      ensurePreviewAudioGraph(key, audio, track.audioProcessing?.effects);
      audio.volume = volume;

      if (!inRange || !shouldPlay) {
        previewAudioPlayRequestedRef.current.delete(key);
        if (!audio.paused) audio.pause();
        if (!inRange) {
          try { audio.currentTime = target; } catch { /* media may not be ready */ }
        }
        continue;
      }

      const audioDrift = Math.abs(audio.currentTime - target);
      if (!shouldPlay) {
        if (audioDrift > 0.05) {
          try { audio.currentTime = target; } catch { /* wait for metadata */ }
        }
      } else if (audioDrift > 0.65) {
        try { audio.currentTime = target; } catch { /* ignore transient decoder state */ }
      }
      const requested = previewAudioPlayRequestedRef.current.has(key);
      if (audio.paused && !requested) {
        previewAudioPlayRequestedRef.current.add(key);
        if (track.provider === 'feed' && track.providerId && !feedPlayReportedRef.current.has(track.id)) {
          feedPlayReportedRef.current.add(track.id);
          void fetch('/api/studio/music/events', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ clipId: track.providerId, event: 'play' }),
          }).catch(() => {});
        }
        void audio.play()
          .then(() => {
            previewAudioUnlockedRef.current = true;
            previewAudioPlayRequestedRef.current.delete(key);
          })
          .catch(() => {
            previewAudioPlayRequestedRef.current.delete(key);
          });
      }
    }

    previewAudioRef.current.forEach((audio, id) => {