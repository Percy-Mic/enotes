'use client';

import React, { useEffect, useRef } from 'react';

import {
  Camera,
  CameraOff,
  Loader2,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  RefreshCw,
  Volume2,
} from 'lucide-react';

import { useCall } from '@/components/chat/CallProvider';
import Avatar from '@/components/social/Avatar';

const STATUS_TEXT: Record<string, string> = {
  calling: 'Calling…',
  ringing: 'Incoming call',
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  declined: 'Call declined',
  missed: 'Missed call',
  ended: 'Call ended',
  failed: 'Call failed',
};

export default function CallOverlay() {
  const {
    call,
    status,
    localStream,
    remoteStream,
    micEnabled,
    cameraEnabled,
    error,
    acceptCall,
    declineCall,
    endCall,
    toggleMic,
    toggleCamera,
    switchCamera,
  } = useCall();

  const localVideoRef =
    useRef<HTMLVideoElement | null>(null);

  const remoteVideoRef =
    useRef<HTMLVideoElement | null>(null);

  const remoteAudioRef =
    useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const video = localVideoRef.current;

    if (!video) {
      return;
    }

    video.srcObject = localStream ?? null;

    if (localStream) {
      void video.play().catch(() => {});
    }
  }, [localStream]);

  useEffect(() => {
    const video = remoteVideoRef.current;
    const audio = remoteAudioRef.current;

    if (video) {
      video.srcObject = remoteStream ?? null;

      if (remoteStream) {
        void video.play().catch(() => {});
      }
    }

    if (audio) {
      audio.srcObject = remoteStream ?? null;

      if (remoteStream) {
        void audio.play().catch(() => {});
      }
    }
  }, [remoteStream]);

  if (!call || !status) {
    return null;
  }

  const showVideo = call.media === 'video';

  const incoming =
    call.direction === 'incoming' &&
    status === 'ringing';

  const waiting =
    status === 'calling' ||
    status === 'ringing' ||
    status === 'connecting' ||
    status === 'reconnecting';

  const ended =
    status === 'declined' ||
    status === 'missed' ||
    status === 'ended' ||
    status === 'failed';

  return (
    <div
      className="fixed inset-0 z-[140] flex min-h-[100dvh] flex-col overflow-hidden bg-[#0D0A0C] text-white"
      role="dialog"
      aria-modal="true"
      aria-label={`${call.media} call`}
    >
      {/* Remote area */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {showVideo && remoteStream ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-[#24191D] via-[#120D0F] to-[#080607]">
            <div
              className={
                waiting
                  ? 'animate-pulse'
                  : ''
              }
            >
              <Avatar
                src={call.peerAvatar}
                name={call.peerName}
                size={128}
                className="!h-28 !w-28 !text-4xl sm:!h-32 sm:!w-32 sm:!text-5xl"
              />
            </div>

            <h2 className="mt-5 px-5 text-center text-xl font-semibold sm:text-2xl">
              {call.peerName}
            </h2>

            <p className="mt-2 flex items-center gap-2 text-sm text-white/65">
              {waiting && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}

              {STATUS_TEXT[status] || status}
            </p>
          </div>
        )}

        {/* Top information */}
        <div className="absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/65 to-transparent px-4 pb-16 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="truncate text-base font-semibold sm:text-lg">
                {call.peerName}
              </p>

              <p className="flex items-center gap-2 text-xs text-white/65 sm:text-sm">
                {waiting && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}

                {STATUS_TEXT[status] || status}
              </p>
            </div>

            <div className="rounded-full bg-black/30 px-3 py-1.5 text-xs uppercase tracking-wide text-white/70 backdrop-blur">
              {call.media}
            </div>
          </div>
        </div>

        {/* Local preview */}
        {showVideo && localStream && (
          <div className="absolute right-3 top-[max(5rem,env(safe-area-inset-top)+3.5rem)] z-20 h-36 w-24 overflow-hidden rounded-2xl border border-white/20 bg-black shadow-2xl sm:right-5 sm:top-24 sm:h-48 sm:w-36">
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className={`h-full w-full object-cover ${
                cameraEnabled
                  ? ''
                  : 'opacity-0'
              }`}
            />

            {!cameraEnabled && (
              <div className="absolute inset-0 flex items-center justify-center bg-[#171114]">
                <CameraOff className="h-6 w-6 text-white/60" />
              </div>
            )}

            <div className="absolute bottom-2 left-2 rounded-full bg-black/50 px-2 py-1 text-[10px] font-semibold backdrop-blur">
              You
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-x-4 top-20 z-30 mx-auto max-w-lg rounded-2xl border border-red-300/20 bg-red-500/90 px-4 py-3 text-center text-sm font-medium shadow-xl">
            {error}
          </div>
        )}
      </div>

      {/* Remote audio for audio-only calls */}
      <audio
        ref={remoteAudioRef}
        autoPlay
        playsInline
        className="hidden"
      />

      {/* Bottom controls */}
      <div className="shrink-0 border-t border-white/10 bg-[#0D0A0C]/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur-xl sm:px-6 sm:pt-5">
        {incoming ? (
          <div className="mx-auto flex max-w-sm items-center justify-center gap-6">
            <button
              type="button"
              onClick={() => {
                void declineCall();
              }}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 shadow-lg transition hover:bg-red-600 active:scale-95"
              aria-label="Decline call"
            >
              <PhoneOff className="h-7 w-7" />
            </button>

            <button
              type="button"
              onClick={() => {
                void acceptCall();
              }}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 shadow-lg transition hover:bg-emerald-600 active:scale-95"
              aria-label="Accept call"
            >
              <Phone className="h-7 w-7" />
            </button>
          </div>
        ) : ended ? (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => {
                void endCall();
              }}
              className="flex min-h-12 items-center gap-2 rounded-full bg-white/10 px-6 text-sm font-semibold transition hover:bg-white/15"
            >
              <PhoneOff className="h-4 w-4" />
              Close
            </button>
          </div>
        ) : (
          <div className="mx-auto flex max-w-xl items-center justify-center gap-3">
            <button
              type="button"
              onClick={toggleMic}
              className={`flex h-12 w-12 items-center justify-center rounded-full transition sm:h-14 sm:w-14 ${
                micEnabled
                  ? 'bg-white/15 hover:bg-white/25'
                  : 'bg-red-500 hover:bg-red-600'
              }`}
              aria-label={
                micEnabled
                  ? 'Mute microphone'
                  : 'Unmute microphone'
              }
              aria-pressed={!micEnabled}
            >
              {micEnabled ? (
                <Mic className="h-5 w-5" />
              ) : (
                <MicOff className="h-5 w-5" />
              )}
            </button>

            {showVideo && (
              <>
                <button
                  type="button"
                  onClick={toggleCamera}
                  className={`flex h-12 w-12 items-center justify-center rounded-full transition sm:h-14 sm:w-14 ${
                    cameraEnabled
                      ? 'bg-white/15 hover:bg-white/25'
                      : 'bg-red-500 hover:bg-red-600'
                  }`}
                  aria-label={
                    cameraEnabled
                      ? 'Turn camera off'
                      : 'Turn camera on'
                  }
                  aria-pressed={!cameraEnabled}
                >
                  {cameraEnabled ? (
                    <Camera className="h-5 w-5" />
                  ) : (
                    <CameraOff className="h-5 w-5" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    void switchCamera();
                  }}
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 transition hover:bg-white/25 sm:h-14 sm:w-14"
                  aria-label="Switch camera"
                >
                  <RefreshCw className="h-5 w-5" />
                </button>
              </>
            )}

            {!showVideo && (
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 sm:h-14 sm:w-14">
                <Volume2 className="h-5 w-5 text-white/80" />
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                void endCall();
              }}
              className="ml-2 flex h-14 w-14 items-center justify-center rounded-full bg-red-500 shadow-lg transition hover:bg-red-600 active:scale-95 sm:h-16 sm:w-16"
              aria-label="End call"
            >
              <PhoneOff className="h-6 w-6" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
