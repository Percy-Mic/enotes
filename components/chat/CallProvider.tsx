'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { supabase } from '@/lib/supabase/client';

type CallMedia = 'audio' | 'video';

type CallStatus =
  | 'calling'
  | 'ringing'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'declined'
  | 'missed'
  | 'ended'
  | 'failed';

type CallDirection = 'incoming' | 'outgoing';

export interface ActiveCall {
  callId: string;
  conversationId: string | null;
  peerId: string;
  peerName: string;
  peerAvatar: string | null;
  media: CallMedia;
  direction: CallDirection;
}

interface CallProviderProps {
  children: React.ReactNode;
  myId?: string | null;
}

interface CallContextValue {
  call: ActiveCall | null;
  status: CallStatus | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  micEnabled: boolean;
  cameraEnabled: boolean;
  facingMode: 'user' | 'environment';
  error: string | null;

  startCall: (
    peerId: string,
    peerName: string,
    peerAvatar: string | null,
    conversationId: string | null,
    media: CallMedia,
  ) => Promise<void>;

  acceptCall: () => Promise<void>;
  declineCall: () => Promise<void>;
  endCall: () => Promise<void>;

  toggleMic: () => void;
  toggleCamera: () => void;
  switchCamera: () => Promise<void>;
}

const CallContext = createContext<CallContextValue | null>(null);

const RING_TIMEOUT = 30_000;

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
      ],
    },
  ],
};

function errorMessage(error: unknown) {
  if (error instanceof DOMException) {
    if (
      error.name === 'NotAllowedError' ||
      error.name === 'PermissionDeniedError'
    ) {
      return 'Camera/microphone permission was denied. Please allow access in your browser settings.';
    }

    if (error.name === 'NotFoundError') {
      return 'No camera or microphone was found.';
    }

    if (error.name === 'NotReadableError') {
      return 'Your camera or microphone is already being used by another application.';
    }

    if (error.name === 'SecurityError') {
      return 'Camera and microphone access requires HTTPS.';
    }

    return error.message || 'Could not access your camera or microphone.';
  }

  return error instanceof Error
    ? error.message
    : 'Something went wrong with the call.';
}

export function CallProvider({
  children,
  myId: suppliedMyId,
}: CallProviderProps) {
  const [myId, setMyId] = useState<string | null>(
    suppliedMyId ?? null,
  );

  const [call, setCall] = useState<ActiveCall | null>(null);
  const [status, setStatus] = useState<CallStatus | null>(null);

  const [localStream, setLocalStream] =
    useState<MediaStream | null>(null);

  const [remoteStream, setRemoteStream] =
    useState<MediaStream | null>(null);

  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);

  const [facingMode, setFacingMode] =
    useState<'user' | 'environment'>('user');

  const [error, setError] = useState<string | null>(null);

  const callRef = useRef<ActiveCall | null>(null);
  const statusRef = useRef<CallStatus | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);

  const channelRef =
    useRef<ReturnType<typeof supabase.channel> | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);

  const ringTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const pendingIceCandidatesRef =
    useRef<RTCIceCandidateInit[]>([]);

  const makingOfferRef = useRef(false);
  const applyingAnswerRef = useRef(false);

  const mountedRef = useRef(true);
  const endingRef = useRef(false);

  const setCurrentCall = useCallback(
    (value: ActiveCall | null) => {
      callRef.current = value;

      if (mountedRef.current) {
        setCall(value);
      }
    },
    [],
  );

  const setCurrentStatus = useCallback(
    (value: CallStatus | null) => {
      statusRef.current = value;

      if (mountedRef.current) {
        setStatus(value);
      }
    },
    [],
  );

  useEffect(() => {
    mountedRef.current = true;

    if (suppliedMyId) {
      setMyId(suppliedMyId);
      return;
    }

    let cancelled = false;

    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) {
        setMyId(data.user?.id ?? null);
      }
    });

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [suppliedMyId]);

  useEffect(() => {
    callRef.current = call;
  }, [call]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  useEffect(() => {
    remoteStreamRef.current = remoteStream;
  }, [remoteStream]);

  const clearRingTimer = useCallback(() => {
    if (ringTimerRef.current) {
      clearTimeout(ringTimerRef.current);
      ringTimerRef.current = null;
    }
  }, []);

  const getMedia = useCallback(
    async (
      media: CallMedia,
      facing: 'user' | 'environment' = 'user',
    ) => {
      return navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video:
          media === 'video'
            ? {
                facingMode: facing,
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30, max: 30 },
              }
            : false,
      });
    },
    [],
  );

  const attachLocalStream = useCallback(
    (stream: MediaStream, media: CallMedia) => {
      localStreamRef.current?.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });

      localStreamRef.current = stream;

      if (!mountedRef.current) {
        return;
      }

      setLocalStream(stream);

      setMicEnabled(
        stream.getAudioTracks().some((track) => track.enabled),
      );

      setCameraEnabled(
        media === 'video' &&
          stream.getVideoTracks().some((track) => track.enabled),
      );
    },
    [],
  );

  const closePeer = useCallback(() => {
    const pc = pcRef.current;

    if (!pc) {
      return;
    }

    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.oniceconnectionstatechange = null;
    pc.onsignalingstatechange = null;

    try {
      pc.close();
    } catch {}

    pcRef.current = null;
  }, []);

  const stopLocalMedia = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {}
    });

    localStreamRef.current = null;

    if (mountedRef.current) {
      setLocalStream(null);
    }
  }, []);

  const clearRemoteMedia = useCallback(() => {
    remoteStreamRef.current?.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {}
    });

    remoteStreamRef.current = null;

    if (mountedRef.current) {
      setRemoteStream(null);
    }
  }, []);

  const removeChannel = useCallback(async () => {
    const channel = channelRef.current;

    channelRef.current = null;

    if (channel) {
      try {
        await supabase.removeChannel(channel);
      } catch {}
    }
  }, []);

  const updateCallStatus = useCallback(
    async (
      callId: string,
      nextStatus: string,
      extra: Record<string, unknown> = {},
    ) => {
      const { error: updateError } = await supabase
        .from('calls')
        .update({
          status: nextStatus,
          ...extra,
        })
        .eq('id', callId);

      if (updateError) {
        console.warn(
          '[calls]',
          updateError.message,
        );
      }
    },
    [],
  );

  const cleanup = useCallback(async () => {
    clearRingTimer();

    pendingIceCandidatesRef.current = [];

    makingOfferRef.current = false;
    applyingAnswerRef.current = false;
    endingRef.current = false;

    closePeer();
    stopLocalMedia();
    clearRemoteMedia();

    await removeChannel();

    setCurrentCall(null);
    setCurrentStatus(null);

    if (mountedRef.current) {
      setError(null);
    }
  }, [
    clearRingTimer,
    closePeer,
    stopLocalMedia,
    clearRemoteMedia,
    removeChannel,
    setCurrentCall,
    setCurrentStatus,
  ]);

  const flushIce = useCallback(async () => {
    const pc = pcRef.current;

    if (!pc?.remoteDescription) {
      return;
    }

    const candidates =
      pendingIceCandidatesRef.current.splice(0);

    for (const candidate of candidates) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        console.warn(
          '[calls] queued ICE candidate failed',
          err,
        );
      }
    }
  }, []);

  const createPeer = useCallback(
    (callData: ActiveCall) => {
      if (pcRef.current) {
        return pcRef.current;
      }

      const pc = new RTCPeerConnection(ICE_SERVERS);

      pcRef.current = pc;

      const stream = localStreamRef.current;

      if (stream) {
        stream.getTracks().forEach((track) => {
          try {
            pc.addTrack(track, stream);
          } catch (err) {
            console.warn('[calls] addTrack failed', err);
          }
        });
      }

      pc.onicecandidate = (event) => {
        if (!event.candidate) {
          return;
        }

        void channelRef.current?.send({
          type: 'broadcast',
          event: 'signal',
          payload: {
            type: 'ice-candidate',
            from: myId,
            candidate: event.candidate.toJSON(),
          },
        });
      };

      pc.ontrack = (event) => {
        const stream = event.streams[0];

        if (stream) {
          remoteStreamRef.current = stream;

          if (mountedRef.current) {
            setRemoteStream(stream);
          }

          return;
        }

        let fallback = remoteStreamRef.current;

        if (!fallback) {
          fallback = new MediaStream();
          remoteStreamRef.current = fallback;

          if (mountedRef.current) {
            setRemoteStream(fallback);
          }
        }

        if (
          !fallback
            .getTracks()
            .some((track) => track.id === event.track.id)
        ) {
          fallback.addTrack(event.track);
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          setCurrentStatus('connected');

          void updateCallStatus(
            callData.callId,
            'connected',
            {
              connected_at: new Date().toISOString(),
            },
          );

          return;
        }

        if (pc.connectionState === 'connecting') {
          setCurrentStatus('connecting');
          return;
        }

        if (pc.connectionState === 'disconnected') {
          setCurrentStatus('reconnecting');
          return;
        }

        if (pc.connectionState === 'failed') {
          setCurrentStatus('reconnecting');
        }
      };

      return pc;
    },
    [
      myId,
      setCurrentStatus,
      updateCallStatus,
    ],
  );

  const handleSignal = useCallback(
    async (payload: any) => {
      const currentCall = callRef.current;
      const pc = pcRef.current;

      if (!currentCall || !pc) {
        return;
      }

      if (payload?.from === myId) {
        return;
      }

      /* OFFER */

      if (payload?.type === 'offer') {
        if (!payload.sdp) {
          return;
        }

        /*
         * Incoming side only.
         *
         * Never overwrite an existing non-stable negotiation.
         */
        if (currentCall.direction !== 'incoming') {
          if (pc.signalingState !== 'stable') {
            return;
          }
        }

        if (
          currentCall.direction === 'incoming' &&
          pc.signalingState !== 'stable'
        ) {
          return;
        }

        try {
          await pc.setRemoteDescription({
            type: 'offer',
            sdp: payload.sdp,
          });

          await flushIce();

          if (currentCall.direction !== 'incoming') {
            return;
          }

          /*
           * CRITICAL:
           *
           * createAnswer is only valid after an offer has been
           * successfully installed and signalingState is
           * "have-remote-offer".
           */
          if (pc.signalingState !== 'have-remote-offer') {
            return;
          }

          const answer = await pc.createAnswer();

          if (pc.signalingState !== 'have-remote-offer') {
            return;
          }

          await pc.setLocalDescription(answer);

          await channelRef.current?.send({
            type: 'broadcast',
            event: 'signal',
            payload: {
              type: 'answer',
              from: myId,
              sdp: pc.localDescription?.sdp,
            },
          });
        } catch (err) {
          console.error(
            '[calls] offer handling failed',
            err,
          );

          if (mountedRef.current) {
            setError(errorMessage(err));
          }
        }

        return;
      }

      /* ANSWER */

      if (payload?.type === 'answer') {
        /*
         * Only the caller accepts an answer.
         */
        if (currentCall.direction !== 'outgoing') {
          return;
        }

        /*
         * THIS IS THE IMPORTANT FIX.
         *
         * A remote answer is legal only when our peer has a
         * local offer waiting for that answer.
         *
         * If signalingState is "stable", this answer is duplicate
         * or stale and must be ignored.
         */
        if (pc.signalingState !== 'have-local-offer') {
          return;
        }

        if (applyingAnswerRef.current) {
          return;
        }

        applyingAnswerRef.current = true;

        try {
          await pc.setRemoteDescription({
            type: 'answer',
            sdp: payload.sdp,
          });

          await flushIce();
        } catch (err) {
          console.warn(
            '[calls] duplicate/stale answer ignored',
            err,
          );
        } finally {
          applyingAnswerRef.current = false;
        }

        return;
      }

      /* ICE */

      if (payload?.type === 'ice-candidate') {
        const candidate =
          payload.candidate as RTCIceCandidateInit | undefined;

        if (!candidate) {
          return;
        }

        if (!pc.remoteDescription) {
          pendingIceCandidatesRef.current.push(candidate);
          return;
        }

        try {
          await pc.addIceCandidate(candidate);
        } catch (err) {
          console.warn(
            '[calls] ICE candidate failed',
            err,
          );
        }
      }
    },
    [flushIce, myId],
  );

  const handleControl = useCallback(
    async (payload: any) => {
      const currentCall = callRef.current;

      if (!currentCall || payload?.from === myId) {
        return;
      }

      /* CALLEE READY */

      if (payload?.type === 'ready') {
        if (currentCall.direction !== 'outgoing') {
          return;
        }

        if (statusRef.current !== 'calling') {
          return;
        }

        const pc = pcRef.current;

        if (!pc) {
          return;
        }

        if (makingOfferRef.current) {
          return;
        }

        if (pc.signalingState !== 'stable') {
          return;
        }

        makingOfferRef.current = true;

        try {
          setCurrentStatus('connecting');

          await updateCallStatus(
            currentCall.callId,
            'connecting',
          );

          const offer = await pc.createOffer();

          if (pc.signalingState !== 'stable') {
            return;
          }

          await pc.setLocalDescription(offer);

          await channelRef.current?.send({
            type: 'broadcast',
            event: 'signal',
            payload: {
              type: 'offer',
              from: myId,
              sdp: pc.localDescription?.sdp,
            },
          });
        } catch (err) {
          console.error(
            '[calls] offer creation failed',
            err,
          );

          if (mountedRef.current) {
            setError(errorMessage(err));
          }
        } finally {
          makingOfferRef.current = false;
        }

        return;
      }

      /* DECLINED */

      if (payload?.type === 'decline') {
        clearRingTimer();

        setCurrentStatus('declined');

        await updateCallStatus(
          currentCall.callId,
          'declined',
          {
            ended_at: new Date().toISOString(),
          },
        );

        window.setTimeout(() => {
          void cleanup();
        }, 1000);

        return;
      }

      /* BUSY */

      if (payload?.type === 'busy') {
        clearRingTimer();

        setCurrentStatus('ended');

        await updateCallStatus(
          currentCall.callId,
          'busy',
          {
            ended_at: new Date().toISOString(),
          },
        );

        window.setTimeout(() => {
          void cleanup();
        }, 1000);

        return;
      }

      /* BYE */

      if (payload?.type === 'bye') {
        clearRingTimer();

        setCurrentStatus('ended');

        await updateCallStatus(
          currentCall.callId,
          'ended',
          {
            ended_at: new Date().toISOString(),
          },
        );

        window.setTimeout(() => {
          void cleanup();
        }, 500);
      }
    },
    [
      myId,
      clearRingTimer,
      cleanup,
      setCurrentStatus,
      updateCallStatus,
    ],
  );

  const subscribeToCallChannel = useCallback(
    async (
      callId: string,
      callData: ActiveCall,
    ) => {
      if (channelRef.current) {
        return channelRef.current;
      }

      const channel = supabase.channel(`call:${callId}`, {
        config: {
          broadcast: {
            self: false,
          },
        },
      });

      channel
        .on(
          'broadcast',
          { event: 'signal' },
          ({ payload }) => {
            void handleSignal(payload);
          },
        )
        .on(
          'broadcast',
          { event: 'control' },
          ({ payload }) => {
            void handleControl(payload);
          },
        );

      channelRef.current = channel;

      await new Promise<void>((resolve, reject) => {
        let finished = false;

        const timeout = window.setTimeout(() => {
          if (finished) {
            return;
          }

          finished = true;

          reject(
            new Error(
              'Could not connect to the call signaling server.',
            ),
          );
        }, 10_000);

        channel.subscribe((state) => {
          if (state === 'SUBSCRIBED') {
            window.clearTimeout(timeout);

            if (!finished) {
              finished = true;
              resolve();
            }

            return;
          }

          if (
            state === 'CHANNEL_ERROR' ||
            state === 'TIMED_OUT'
          ) {
            window.clearTimeout(timeout);

            if (!finished) {
              finished = true;
              reject(
                new Error(
                  'Call signaling connection failed.',
                ),
              );
            }
          }
        });
      });

      /*
       * Incoming call:
       * the channel is subscribed before the user accepts.
       *
       * Do not send READY here because media/peer connection
       * are not ready yet.
       */

      if (
        callData.direction === 'incoming' &&
        statusRef.current !== 'ringing'
      ) {
        await channel.send({
          type: 'broadcast',
          event: 'control',
          payload: {
            type: 'ready',
            from: myId,
          },
        });
      }

      return channel;
    },
    [handleSignal, handleControl],
  );

  const startCall = useCallback(
    async (
      peerId: string,
      peerName: string,
      peerAvatar: string | null,
      conversationId: string | null,
      media: CallMedia,
    ) => {
      if (!myId) {
        setError('You must be signed in to make a call.');
        return;
      }

      if (callRef.current) {
        return;
      }

      if (peerId === myId) {
        setError('You cannot call yourself.');
        return;
      }

      setError(null);

      try {
        /*
         * Ask for media first.
         */
        const stream = await getMedia(
          media,
          media === 'video' ? facingMode : 'user',
        );

        attachLocalStream(stream, media);

        /*
         * Register persistent call.
         */
        const { data, error: insertError } =
          await supabase
            .from('calls')
            .insert({
              conversation_id: conversationId,
              caller_id: myId,
              callee_id: peerId,
              media,
              status: 'ringing',
            })
            .select('id')
            .maybeSingle();

        if (insertError || !data) {
          throw (
            insertError ||
            new Error('Could not register the call.')
          );
        }

        const activeCall: ActiveCall = {
          callId: data.id,
          conversationId,
          peerId,
          peerName,
          peerAvatar,
          media,
          direction: 'outgoing',
        };

        setCurrentCall(activeCall);
        setCurrentStatus('calling');

        /*
         * Peer connection exists, but NO OFFER is created yet.
         *
         * We wait for the callee to accept and send READY.
         */
        createPeer(activeCall);

        await subscribeToCallChannel(
          data.id,
          activeCall,
        );

        clearRingTimer();

        ringTimerRef.current = setTimeout(() => {
          void (async () => {
            const current = callRef.current;

            if (!current) {
              return;
            }

            if (
              statusRef.current !== 'calling' &&
              statusRef.current !== 'ringing'
            ) {
              return;
            }

            await updateCallStatus(
              current.callId,
              'missed',
              {
                ended_at: new Date().toISOString(),
              },
            );

            setCurrentStatus('missed');

            window.setTimeout(() => {
              void cleanup();
            }, 1200);
          })();
        }, RING_TIMEOUT);
      } catch (err) {
        console.error(
          '[calls] startCall failed',
          err,
        );

        setError(errorMessage(err));

        await cleanup();
      }
    },
    [
      myId,
      facingMode,
      getMedia,
      attachLocalStream,
      setCurrentCall,
      setCurrentStatus,
      createPeer,
      subscribeToCallChannel,
      clearRingTimer,
      updateCallStatus,
      cleanup,
    ],
  );

  const acceptCall = useCallback(async () => {
    const current = callRef.current;

    if (!current || current.direction !== 'incoming') {
      return;
    }

    if (statusRef.current !== 'ringing') {
      return;
    }

    clearRingTimer();
    setError(null);

    try {
      /*
       * Get media before READY.
       */
      const stream = await getMedia(
        current.media,
        current.media === 'video'
          ? facingMode
          : 'user',
      );

      attachLocalStream(stream, current.media);

      /*
       * Now create the peer connection with our tracks.
       */
      createPeer(current);

      setCurrentStatus('connecting');

      await updateCallStatus(
        current.callId,
        'connecting',
      );

      /*
       * Channel was already subscribed from the
       * incoming-call listener.
       *
       * If for any reason it disappeared, reconnect.
       */
      await subscribeToCallChannel(
        current.callId,
        current,
      );

      /*
       * Tell caller:
       *
       * "I accepted. My channel is ready. Send offer."
       */
      await channelRef.current?.send({
        type: 'broadcast',
        event: 'control',
        payload: {
          type: 'ready',
          from: myId,
        },
      });
    } catch (err) {
      console.error(
        '[calls] acceptCall failed',
        err,
      );

      setError(errorMessage(err));

      await updateCallStatus(
        current.callId,
        'failed',
        {
          ended_at: new Date().toISOString(),
        },
      );

      await cleanup();
    }
  }, [
    clearRingTimer,
    getMedia,
    facingMode,
    attachLocalStream,
    createPeer,
    setCurrentStatus,
    updateCallStatus,
    subscribeToCallChannel,
    myId,
    cleanup,
  ]);

  const declineCall = useCallback(async () => {
    const current = callRef.current;

    if (!current) {
      return;
    }

    clearRingTimer();

    try {
      await channelRef.current?.send({
        type: 'broadcast',
        event: 'control',
        payload: {
          type: 'decline',
          from: myId,
        },
      });
    } catch {}

    await updateCallStatus(
      current.callId,
      'declined',
      {
        ended_at: new Date().toISOString(),
      },
    );

    setCurrentStatus('declined');

    window.setTimeout(() => {
      void cleanup();
    }, 900);
  }, [
    clearRingTimer,
    myId,
    updateCallStatus,
    setCurrentStatus,
    cleanup,
  ]);

  const endCall = useCallback(async () => {
    const current = callRef.current;

    if (!current || endingRef.current) {
      return;
    }

    endingRef.current = true;

    clearRingTimer();

    try {
      await channelRef.current?.send({
        type: 'broadcast',
        event: 'control',
        payload: {
          type: 'bye',
          from: myId,
        },
      });
    } catch {}

    await updateCallStatus(
      current.callId,
      'ended',
      {
        ended_at: new Date().toISOString(),
      },
    );

    setCurrentStatus('ended');

    window.setTimeout(() => {
      void cleanup();
    }, 500);
  }, [
    clearRingTimer,
    myId,
    updateCallStatus,
    setCurrentStatus,
    cleanup,
  ]);

  const toggleMic = useCallback(() => {
    const stream = localStreamRef.current;

    if (!stream) {
      return;
    }

    const tracks = stream.getAudioTracks();

    if (!tracks.length) {
      return;
    }

    const enabled = !tracks[0].enabled;

    tracks.forEach((track) => {
      track.enabled = enabled;
    });

    setMicEnabled(enabled);
  }, []);

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;

    if (!stream) {
      return;
    }

    const tracks = stream.getVideoTracks();

    if (!tracks.length) {
      return;
    }

    const enabled = !tracks[0].enabled;

    tracks.forEach((track) => {
      track.enabled = enabled;
    });

    setCameraEnabled(enabled);
  }, []);

  const switchCamera = useCallback(async () => {
    const current = callRef.current;

    if (!current || current.media !== 'video') {
      return;
    }

    const stream = localStreamRef.current;

    if (!stream) {
      return;
    }

    try {
      const nextMode =
        facingMode === 'user'
          ? 'environment'
          : 'user';

      const nextStream = await getMedia(
        'video',
        nextMode,
      );

      const nextTrack =
        nextStream.getVideoTracks()[0];

      if (!nextTrack) {
        return;
      }

      const sender = pcRef.current
        ?.getSenders()
        .find(
          (item) =>
            item.track?.kind === 'video',
        );

      if (sender) {
        await sender.replaceTrack(nextTrack);
      }

      stream.getVideoTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });

      const replacement = new MediaStream([
        ...stream.getAudioTracks(),
        nextTrack,
      ]);

      localStreamRef.current = replacement;
      setLocalStream(replacement);

      setFacingMode(nextMode);
      setCameraEnabled(true);
    } catch (err) {
      console.warn(
        '[calls] switch camera failed',
        err,
      );
    }
  }, [facingMode, getMedia]);

  /*
   * Incoming-call listener.
   */
  useEffect(() => {
    if (!myId) {
      return;
    }

    let cancelled = false;

    const incomingChannel = supabase
      .channel(`incoming-calls:${myId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'calls',
          filter: `callee_id=eq.${myId}`,
        },
        async (payload) => {
          if (cancelled) {
            return;
          }

          const row = payload.new as {
            id: string;
            conversation_id: string | null;
            caller_id: string;
            callee_id: string;
            media: CallMedia;
            status: string;
          };

          if (
            row.callee_id !== myId ||
            row.status !== 'ringing'
          ) {
            return;
          }

          /*
           * Already on another call.
           */
          if (callRef.current) {
            return;
          }

          const { data: caller } =
            await supabase
              .from('profiles')
              .select(
                'id, full_text_name, username, avatar_url',
              )
              .eq('id', row.caller_id)
              .maybeSingle();

          if (cancelled) {
            return;
          }

          const name =
            caller?.full_text_name ||
            caller?.username ||
            'Unknown user';

          const activeCall: ActiveCall = {
            callId: row.id,
            conversationId: row.conversation_id,
            peerId: row.caller_id,
            peerName: name,
            peerAvatar: caller?.avatar_url ?? null,
            media: row.media,
            direction: 'incoming',
          };

          setCurrentCall(activeCall);
          setCurrentStatus('ringing');
          setError(null);

          /*
           * Subscribe immediately.
           *
           * We intentionally do not create the RTCPeerConnection
           * until Accept is pressed.
           */
          try {
            await subscribeToCallChannel(
              row.id,
              activeCall,
            );
          } catch (err) {
            console.error(
              '[calls] incoming channel failed',
              err,
            );
          }

          clearRingTimer();

          ringTimerRef.current = setTimeout(() => {
            void (async () => {
              if (
                callRef.current?.callId !== row.id ||
                statusRef.current !== 'ringing'
              ) {
                return;
              }

              await updateCallStatus(
                row.id,
                'missed',
                {
                  ended_at:
                    new Date().toISOString(),
                },
              );

              setCurrentStatus('missed');

              window.setTimeout(() => {
                void cleanup();
              }, 1200);
            })();
          }, RING_TIMEOUT);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(
        incomingChannel,
      );
    };
  }, [
    myId,
    subscribeToCallChannel,
    clearRingTimer,
    updateCallStatus,
    setCurrentCall,
    setCurrentStatus,
    cleanup,
  ]);

  /*
   * Browser/tab close.
   */
  useEffect(() => {
    const handlePageHide = () => {
      const current = callRef.current;

      if (!current) {
        return;
      }

      try {
        navigator.sendBeacon?.(
          `/calls/${current.callId}/end`,
          new Blob(
            [
              JSON.stringify({
                status: 'ended',
              }),
            ],
            {
              type: 'application/json',
            },
          ),
        );
      } catch {}
    };

    window.addEventListener(
      'pagehide',
      handlePageHide,
    );

    return () => {
      window.removeEventListener(
        'pagehide',
        handlePageHide,
      );
    };
  }, []);

  /*
   * Unmount.
   */
  useEffect(() => {
    return () => {
      mountedRef.current = false;

      clearRingTimer();
      closePeer();
      stopLocalMedia();
      clearRemoteMedia();

      const channel = channelRef.current;

      channelRef.current = null;

      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [
    clearRingTimer,
    closePeer,
    stopLocalMedia,
    clearRemoteMedia,
  ]);

  const value = useMemo<CallContextValue>(
    () => ({
      call,
      status,
      localStream,
      remoteStream,
      micEnabled,
      cameraEnabled,
      facingMode,
      error,
      startCall,
      acceptCall,
      declineCall,
      endCall,
      toggleMic,
      toggleCamera,
      switchCamera,
    }),
    [
      call,
      status,
      localStream,
      remoteStream,
      micEnabled,
      cameraEnabled,
      facingMode,
      error,
      startCall,
      acceptCall,
      declineCall,
      endCall,
      toggleMic,
      toggleCamera,
      switchCamera,
    ],
  );

  return (
    <CallContext.Provider value={value}>
      {children}
    </CallContext.Provider>
  );
}

export function useCall() {
  const context = useContext(CallContext);

  if (!context) {
    throw new Error(
      'useCall must be used inside CallProvider.',
    );
  }

  return context;
}
