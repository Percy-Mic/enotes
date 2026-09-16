'use client';

import React, { useEffect, useRef } from 'react';
import { Camera, CameraOff, Loader2, Mic, MicOff, Phone, PhoneOff, RefreshCw, Volume2 } from 'lucide-react';
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
    call, status, localStream, remoteStream,
    micEnabled, cameraEnabled, error,
    acceptCall, declineCall, endCall, toggleMic, toggleCamera, switchCamera,
  } = useCall();

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    if (status === 'connected') {
      /* hook the audio element for remote audio in audio-only calls */
      const audio = document.getElementById('remote-audio') as HTMLAudioElement | null;
      if (audio && remoteStream) audio.srcObject = remoteStream;
    }
  }, [status, remoteStream]);

  if (!call || !status) return null;

  const isIncomingRing = call.direction === 'incoming' && status === 'ringing';
  const isOutgoingRing = call.direction === 'outgoing' && (status === 'calling' || status === 'ringing');
  const showVideo = call.media === 'video';

  return (
    <div className="fixed inset-0 z-[140] flex flex-col bg-gradient-to-b from-[#1B1418] to-[#0D0A0C] text-white" role="dialog" aria-modal="true" aria-label={`${call.media} call ${status}`}>
      {/* remote video / avatar */}
      <div className="relative flex-1 overflow-hidden">
        {showVideo && remoteStream ? (
          <video ref={remoteVideoRef} autoPlay playsInline className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <div className={`relative ${status === 'connected' ? '' : 'animate-pulse'}`}>
              <Avatar src={call.peerAvatar} name={call.peerName} size={120} className="!h-28 !w-28 !text-4xl" />
            </div>
            <p className="text-xl font-semibold">{call.peerName}</p>
            <p className="flex items-center gap-2 text-sm text-white/70">
              {(status === 'calling' || status === 'connecting' || status === 'reconnecting') && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              {STATUS_TEXT[status] || status}
            </p>
          </div>
        )}

        {showVideo && remoteStream && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0">
            <video ref={remoteVideoRef} autoPlay playsInline />
          </div>
        )}
        {showVideo && !remoteStream && status !== 'ringing' && (
          <div className="absolute inset-x-0 bottom-8 text-center text-sm text-white/60">{STATUS_TEXT[status]}</div>
        )}

        {/* self preview */}
        {showVideo && localStream && (
          <div className="absolute right-4 top-4 h-40 w-28 overflow-hidden rounded-2xl border border-white/20 bg-black shadow-xl sm:h-48 sm:w-36">
            <video ref={localVideoRef} autoPlay playsInline muted className={`h-full w-full object-cover ${cameraEnabled ? '' : 'opacity-0'}`} />
            {!cameraEnabled && (
              <div className="absolute inset-0 flex items-center justify-center">
                <CameraOff className="h-6 w-6 text-white/70" />
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="absolute inset-x-4 top-4 rounded-xl bg-red-500/90 px-4 py-2 text-center text-sm font-semibold">
            {error}
          </div>
        )}
      </div>

      {/* audio-only remote sound */}
      {!showVideo && remoteStream && <audio id="remote-audio" autoPlay className="hidden" />}

      {/* controls */}
      <div className="border-t border-white/10 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
        {isIncomingRing ? (
          <div className="mx-auto flex max-w-sm items-center justify-center gap-6">
            <button
              onClick={declineCall}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 shadow-lg transition active:scale-95"
              aria-label="Decline call"
            >
              <PhoneOff className="h-7 w-7" />
            </button>
            <button
              onClick={acceptCall}
              className="flex h-16 w-16 animate-bounce items-center justify-center rounded-full bg-emerald-500 shadow-lg transition active:scale-95"
              aria-label="Accept call"
            >
              <Phone className="h-7 w-7" />
            </button>
          </div>
        ) : (
          <div className="mx-auto flex max-w-md items-center justify-center gap-3">
            {/* mute */}
            <button
              onClick={toggleMic}
              className={`flex h-13 w-13 min-h-[52px] min-w-[52px] items-center justify-center rounded-full transition ${micEnabled ? 'bg-white/15 hover:bg-white/25' : 'bg-white text-black'}`}
              aria-label={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
              aria-pressed={!micEnabled}
            >
              {micEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
            </button>

            {/* camera */}
            {showVideo && (
              <button
                onClick={toggleCamera}
                className={`flex min-h-[52px] min-w-[52px] items-center justify-center rounded-full transition ${cameraEnabled ? 'bg-white/15 hover:bg-white/25' : 'bg-white text-black'}`}
                aria-label={cameraEnabled ? 'Turn camera off' : 'Turn camera on'}
                aria-pressed={!cameraEnabled}
              >
                {cameraEnabled ? <Camera className="h-5 w-5" /> : <CameraOff className="h-5 w-5" />}
              </button>
            )}

            {/* flip camera (mobile) */}
            {showVideo && (
              <button
                onClick={switchCamera}
                className="flex min-h-[52px] min-w-[52px] items-center justify-center rounded-full bg-white/15 transition hover:bg-white/25"
                aria-label="Switch camera"
              >
                <RefreshCw className="h-5 w-5" />
              </button>
            )}

            {/* speaker hint (audio calls) */}
            {!showVideo && (
              <span className="flex min-h-[52px] min-w-[52px] items-center justify-center rounded-full bg-white/10" aria-hidden="true">
                <Volume2 className="h-5 w-5 text-white/60" />
              </span>
            )}

            {/* end */}
            <button
              onClick={endCall}
              className="flex min-h-[60px] min-w-[60px] items-center justify-center rounded-full bg-red-500 shadow-lg transition hover:bg-red-600 active:scale-95"
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
