'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Voice-note recorder built on MediaRecorder.
 *
 * - Requests the microphone only while recording (permission is askable again
 *   after denial via the browser UI — we surface the reason).
 * - Prefers audio/webm;codecs=opus (Chrome/Edge/Firefox), falls back to
 *   audio/mp4 (Safari), else the browser default. The recorded file's MIME
 *   type is returned so uploads carry the correct contentType.
 * - Live elapsed time via setInterval; final duration is measured from the
 *   blob (decodeAudioData) by the caller if exactness matters.
 * - stop() resolves { blob, durationSeconds, mimeType }; cancel() discards.
 */

export interface VoiceRecording {
  blob: Blob;
  durationSeconds: number;
  mimeType: string;
}

export type RecorderError = 'permission-denied' | 'no-microphone' | 'unsupported' | 'failed';

const MAX_SECONDS = 300; // 5 minutes cap — matches chat-media 25 MB budget with margin

export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<RecorderError | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const cancelledRef = useRef(false);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setRecording(false);
    setElapsed(0);
  }, []);

  /* stop everything if the page is hidden/unmounted mid-recording */
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      try { recorderRef.current?.stop(); } catch { /* already stopped */ }
      cleanup();
    };
  }, [cleanup]);

  const start = useCallback(async (): Promise<boolean> => {
    setError(null);
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('unsupported');
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
      const mimeType = candidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      cancelledRef.current = false;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start(250);

      startedAtRef.current = Date.now();
      setElapsed(0);
      setRecording(true);
      timerRef.current = setInterval(() => {
        const secs = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setElapsed(secs);
        if (secs >= MAX_SECONDS) {
          // hard cap: stop automatically rather than growing unbounded
          recorderRef.current?.stop();
        }
      }, 250);
      return true;
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') setError('permission-denied');
      else if (name === 'NotFoundError' || name === 'OverconstrainedError') setError('no-microphone');
      else setError('failed');
      cleanup();
      return false;
    }
  }, [cleanup]);

  const stop = useCallback((): Promise<VoiceRecording | null> => {
    return new Promise((resolve) => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        cleanup();
        resolve(null);
        return;
      }
      const duration = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mimeType });
        cleanup();
        if (cancelledRef.current || blob.size === 0) {
          resolve(null);
          return;
        }
        resolve({ blob, durationSeconds: duration, mimeType });
      };
      try { recorder.stop(); } catch {
        cleanup();
        resolve(null);
      }
    });
  }, [cleanup]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    try { recorderRef.current?.stop(); } catch { /* already stopped */ }
    cleanup();
  }, [cleanup]);

  return { recording, elapsed, error, start, stop, cancel, maxSeconds: MAX_SECONDS };
}

/** Friendly copy for recorder failures (the UI shows this verbatim). */
export function recorderErrorMessage(err: RecorderError | null): string | null {
  switch (err) {
    case 'permission-denied': return 'Microphone access was blocked — allow it in your browser settings to record voice notes.';
    case 'no-microphone': return 'No microphone was found on this device.';
    case 'unsupported': return 'Voice notes are not supported in this browser.';
    case 'failed': return 'Recording failed — try again.';
    default: return null;
  }
}
