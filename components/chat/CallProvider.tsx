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

interface RemoteUser {
  id: string;
  name: string;
  avatar: string | null;
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

    /*
     * IMPORTANT:
     *
     * Add your TURN server here for production.
     *
     * Example:
     *
     * {
     *   urls: 'turn:your-turn-server.example.com:3478',
     *   username: 'temporary-user',
     *   credential: 'temporary-password',
     * }
     *
     * Do not put permanent TURN credentials in NEXT_PUBLIC_* variables.
     */
  ],
};

function getErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (
      error.name === 'NotAllowedError' ||
      error.name === 'PermissionDeniedError'
    ) {
      return 'Camera/microphone permission was denied. Please allow access in your browser settings.';
    }

    if (error.name === 'NotFoundError') {
      return 'No camera or microphone was found on this device.';
    }

    if (error.name === 'NotReadableError') {
      return 'Your camera or microphone is already being used by another application.';
    }

    if (error.name === 'SecurityError') {
      return 'Camera and microphone access requires a secure connection.';
    }

    return error.message || 'Could not access your camera or microphone.';
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Something went wrong with the call.';
}

export function CallProvider({
  children,
  myId: suppliedMyId,
}: CallProviderProps) {
  const [myId, setMyId] = useState<string | null>(suppliedMyId ?? null);

  const [call, setCall] = useState<ActiveCall | null>(null);
  const [status, setStatus] = useState<CallStatus | null>(null);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>(
    'user',
  );

  const [error, setError] = useState<string | null>(null);

  const callRef = useRef<ActiveCall | null>(null);
  const statusRef = useRef<CallStatus | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);

  const remoteUserRef = useRef<RemoteUser | null>(null);

  const ringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  const makingOfferRef = useRef(false);
  const acceptingAnswerRef = useRef(false);
  const callEndingRef = useRef(false);
  const channelReadyRef = useRef(false);

  const mountedRef = useRef(true);

  const setCurrentStatus = useCallback((next: CallStatus | null) => {
    statusRef.current = next;
    if (mountedRef.current) {
      setStatus(next);
    }
  }, []);

  const setCurrentCall = useCallback((next: ActiveCall | null) => {
    callRef.current = next;
    if (mountedRef.current) {
      setCall(next);
    }
  }, []);

  /* ------------------------------------------------------------
   * Get authenticated user
   * ---------------------------------------------------------- */

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

  /* ------------------------------------------------------------
   * Keep local refs synchronized
   * ---------------------------------------------------------- */

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

  /* ------------------------------------------------------------
   * Clear ringing timer
   * ---------------------------------------------------------- */

  const clearRingTimer = useCallback(() => {
    if (ringTimerRef.current) {
      clearTimeout(ringTimerRef.current);
      ringTimerRef.current = null;
    }
  }, []);

  /* ------------------------------------------------------------
   * Media
   * ---------------------------------------------------------- */

  const getMedia = useCallback(
    async (
      media: CallMedia,
      facing: 'user' | 'environment' = 'user',
    ): Promise<MediaStream> => {
      const constraints: MediaStreamConstraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video:
          media === 'video'
            ? {
                facingMode: facing,
                width: {
                  ideal: 1280,
                },
                height: {
                  ideal: 720,
                },
                frameRate: {
                  ideal: 30,
                  max: 30,
                },
              }
            : false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      return stream;
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

      if (mountedRef.current) {
        setLocalStream(stream);
        setMicEnabled(stream.getAudioTracks().some((track) => track.enabled));
        setCameraEnabled(
          media === 'video' &&
            stream.getVideoTracks().some((track) => track.enabled),
        );
      }
    },
    [],
  );

  /* ------------------------------------------------------------
   * Cleanup peer connection
   * ---------------------------------------------------------- */

  const closePeerConnection = useCallback(() => {
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

  /* ------------------------------------------------------------
   * Cleanup media
   * ---------------------------------------------------------- */

  const stopLocalMedia = useCallback(() => {
    const stream = localStreamRef.current;

    if (stream) {
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
    }

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

  /* ------------------------------------------------------------
   * Remove Realtime channel
   * ---------------------------------------------------------- */

  const removeCallChannel = useCallback(async () => {
    const channel = channelRef.current;

    channelRef.current = null;
    channelReadyRef.current = false;

    if (channel) {
      try {
        await supabase.removeChannel(channel);
      } catch {}
    }
  }, []);

  /* ------------------------------------------------------------
   * Finish call locally
   * ---------------------------------------------------------- */

  const cleanupCall = useCallback(async () => {
    clearRingTimer();

    pendingIceCandidatesRef.current = [];

    makingOfferRef.current = false;
    acceptingAnswerRef.current = false;

    closePeerConnection();
    stopLocalMedia();
    clearRemoteMedia();

    await removeCallChannel();

    remoteUserRef.current = null;

    callEndingRef.current = false;

    setCurrentCall(null);
    setCurrentStatus(null);
    setError(null);
  }, [
    clearRingTimer,
    closePeerConnection,
    stopLocalMedia,
    clearRemoteMedia,
    removeCallChannel,
    setCurrentCall,
    setCurrentStatus,
  ]);

  /* ------------------------------------------------------------
   * Update DB call status
   * ---------------------------------------------------------- */

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
          '[CallProvider] Could not update call status:',
          updateError.message,
        );
      }
    },
    [],
  );

  /* ------------------------------------------------------------
   * Create peer connection
   * ---------------------------------------------------------- */

  const createPeerConnection = useCallback(
    (callData: ActiveCall) => {
      const existing = pcRef.current;

      if (existing) {
        return existing;
      }

      const pc = new RTCPeerConnection(ICE_SERVERS);

      pcRef.current = pc;

      const currentLocalStream = localStreamRef.current;

      if (currentLocalStream) {
        currentLocalStream.getTracks().forEach((track) => {
          try {
            pc.addTrack(track, currentLocalStream);
          } catch (err) {
            console.warn('[CallProvider] addTrack failed:', err);
          }
        });
      }

      pc.onicecandidate = (event) => {
        if (!event.candidate) {
          return;
        }

        const channel = channelRef.current;

        if (!channel || !channelReadyRef.current) {
          return;
        }

        void channel.send({
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
        const [stream] = event.streams;

        if (stream) {
          remoteStreamRef.current = stream;

          if (mountedRef.current) {
            setRemoteStream(stream);
          }

          return;
        }

        let target = remoteStreamRef.current;

        if (!target) {
          target = new MediaStream();
          remoteStreamRef.current = target;

          if (mountedRef.current) {
            setRemoteStream(target);
          }
        }

        if (!target.getTracks().some((track) => track.id === event.track.id)) {
          target.addTrack(event.track);
        }
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;

        if (state === 'connected') {
          setCurrentStatus('connected');

          void updateCallStatus(callData.callId, 'connected', {
            connected_at: new Date().toISOString(),
          });

          return;
        }

        if (state === 'connecting') {
          if (
            statusRef.current !== 'connected' &&
            statusRef.current !== 'reconnecting'
          ) {
            setCurrentStatus('connecting');
          }

          return;
        }

        if (state === 'disconnected') {
          setCurrentStatus('reconnecting');
          return;
        }

        if (state === 'failed') {
          setCurrentStatus('reconnecting');

          /*
           * ICE restart is safer than immediately destroying the call.
           */
          if (
            pc.signalingState === 'stable' &&
            !makingOfferRef.current &&
            callData.direction === 'outgoing'
          ) {
            void (async () => {
              try {
                makingOfferRef.current = true;

                const offer = await pc.createOffer({
                  iceRestart: true,
                });

                if (pc.signalingState !== 'stable') {
                  makingOfferRef.current = false;
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
                console.warn('[CallProvider] ICE restart failed:', err);
              } finally {
                makingOfferRef.current = false;
              }
            })();
          }

          return;
        }

        if (state === 'closed') {
          return;
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (
          pc.iceConnectionState === 'failed' &&
          pc.signalingState === 'stable' &&
          callData.direction === 'outgoing' &&
          !makingOfferRef.current
        ) {
          void (async () => {
            try {
              makingOfferRef.current = true;

              const offer = await pc.createOffer({
                iceRestart: true,
              });

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
              console.warn('[CallProvider] ICE restart failed:', err);
            } finally {
              makingOfferRef.current = false;
            }
          })();
        }
      };

      pc.onsignalingstatechange = () => {
        console.debug(
          '[CallProvider] signaling state:',
          pc.signalingState,
        );
      };

      return pc;
    },
    [myId, setCurrentStatus, updateCallStatus],
  );

  /* ------------------------------------------------------------
   * Flush queued ICE candidates
   * ---------------------------------------------------------- */

  const flushPendingIceCandidates = useCallback(async () => {
    const pc = pcRef.current;

    if (!pc || !pc.remoteDescription) {
      return;
    }

    const pending = pendingIceCandidatesRef.current.splice(0);

    for (const candidate of pending) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        console.warn(
          '[CallProvider] Could not add queued ICE candidate:',
          err,
        );
      }
    }
  }, []);

  /* ------------------------------------------------------------
   * Signal handler
   * ---------------------------------------------------------- */

  const handleSignal = useCallback(
    async (payload: any) => {
      const currentCall = callRef.current;

      if (!currentCall) {
        return;
      }

      if (payload?.from === myId) {
        return;
      }

      const pc = pcRef.current;

      if (!pc) {
        return;
      }

      /* ---------------- OFFER ---------------- */

      if (payload?.type === 'offer') {
        if (!payload.sdp) {
          return;
        }

        /*
         * The callee accepts offers.
         *
         * Most importantly:
         * NEVER call setRemoteDescription(offer) while an
         * answer is already being processed.
         */
        if (currentCall.direction !== 'incoming') {
          /*
           * An outgoing caller may receive an offer only during
           * ICE restart. In that case the signaling state must
           * be stable.
           */
          if (pc.signalingState !== 'stable') {
            return;
          }
        }

        if (
          currentCall.direction === 'incoming' &&
          statusRef.current !== 'connecting' &&
          statusRef.current !== 'connected' &&
          statusRef.current !== 'reconnecting'
        ) {
          return;
        }

        try {
          if (
            currentCall.direction === 'incoming' &&
            pc.signalingState !== 'stable'
          ) {
            return;
          }

          await pc.setRemoteDescription(
            new RTCSessionDescription({
              type: 'offer',
              sdp: payload.sdp,
            }),
          );

          await flushPendingIceCandidates();

          /*
           * Only the callee creates an answer.
           */
          if (currentCall.direction === 'incoming') {
            if (pc.signalingState !== 'have-remote-offer') {
              return;
            }

            const answer = await pc.createAnswer();

            /*
             * This check prevents the classic:
             * "Called in wrong state: stable"
             */
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
          }
        } catch (err) {
          console.error('[CallProvider] Offer handling failed:', err);
          setError(getErrorMessage(err));
        }

        return;
      }

      /* ---------------- ANSWER ---------------- */

      if (payload?.type === 'answer') {
        if (!payload.sdp) {
          return;
        }

        /*
         * Only the caller processes answers.
         */
        if (currentCall.direction !== 'outgoing') {
          return;
        }

        /*
         * This is the critical protection against:
         *
         * Failed to set remote answer SDP:
         * Called in wrong state: stable
         *
         * An answer is valid only when we currently have
         * a local offer waiting for an answer.
         */
        if (pc.signalingState !== 'have-local-offer') {
          return;
        }

        /*
         * Ignore duplicate answers while one is already being
         * applied.
         */
        if (acceptingAnswerRef.current) {
          return;
        }

        acceptingAnswerRef.current = true;

        try {
          await pc.setRemoteDescription(
            new RTCSessionDescription({
              type: 'answer',
              sdp: payload.sdp,
            }),
          );

          await flushPendingIceCandidates();
        } catch (err) {
          console.warn('[CallProvider] Answer ignored:', err);
        } finally {
          acceptingAnswerRef.current = false;
        }

        return;
      }

      /* ---------------- ICE ---------------- */

      if (payload?.type === 'ice-candidate') {
        const candidate = payload.candidate as RTCIceCandidateInit | undefined;

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
          console.warn('[CallProvider] ICE candidate failed:', err);
        }

        return;
      }
    },
    [flushPendingIceCandidates, myId],
  );

  /* ------------------------------------------------------------
   * Open call channel
   * ---------------------------------------------------------- */

  const openChannel = useCallback(
    async (
      callId: string,
      callData: ActiveCall,
    ): Promise<ReturnType<typeof supabase.channel>> => {
      const existing = channelRef.current;

      if (existing) {
        return existing;
      }

      const channel = supabase.channel(`call:${callId}`, {
        config: {
          broadcast: {
            self: false,
          },
        },
      });

      channel
        .on('broadcast', { event: 'signal' }, ({ payload }) => {
          void handleSignal(payload);
        })
        .on('broadcast', { event: 'control' }, ({ payload }) => {
          void handleControlSignal(payload);
        });

      channelRef.current = channel;

      await new Promise<void>((resolve, reject) => {
        let settled = false;

        const timeout = window.setTimeout(() => {
          if (settled) {
            return;
          }

          settled = true;
          reject(new Error('Could not connect to the call signaling server.'));
        }, 10_000);

        channel.subscribe((subscriptionStatus) => {
          if (subscriptionStatus === 'SUBSCRIBED') {
            window.clearTimeout(timeout);

            if (!settled) {
              settled = true;
              channelReadyRef.current = true;
              resolve();
            }

            return;
          }

          if (
            subscriptionStatus === 'CHANNEL_ERROR' ||
            subscriptionStatus === 'TIMED_OUT'
          ) {
            window.clearTimeout(timeout);

            if (!settled) {
              settled = true;
              reject(
                new Error(
                  'Could not connect to the call signaling server.',
                ),
              );
            }
          }
        });
      });

      /*
       * Once the callee accepts, it announces readiness.
       * The caller waits for this before creating the offer.
       *
       * This prevents the offer from being broadcast before
       * the other browser has actually subscribed.
       */
      if (callData.direction === 'incoming') {
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
    [handleSignal, myId],
  );

  /* ------------------------------------------------------------
   * Control signal handler
   * ---------------------------------------------------------- */

  async function handleControlSignal(payload: any) {
    const currentCall = callRef.current;

    if (!currentCall || payload?.from === myId) {
      return;
    }

    if (payload?.type === 'ready') {
      /*
       * Caller only.
       */
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

        await updateCallStatus(currentCall.callId, 'connecting');

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
        console.error('[CallProvider] Offer creation failed:', err);
        setError(getErrorMessage(err));
      } finally {
        makingOfferRef.current = false;
      }

      return;
    }

    if (payload?.type === 'decline') {
      clearRingTimer();

      setCurrentStatus('declined');

      await updateCallStatus(currentCall.callId, 'declined');

      window.setTimeout(() => {
        void cleanupCall();
      }, 1200);

      return;
    }

    if (payload?.type === 'bye') {
      clearRingTimer();

      setCurrentStatus('ended');

      await updateCallStatus(currentCall.callId, 'ended', {
        ended_at: new Date().toISOString(),
      });

      window.setTimeout(() => {
        void cleanupCall();
      }, 500);

      return;
    }

    if (payload?.type === 'busy') {
      clearRingTimer();

      setCurrentStatus('ended');

      await updateCallStatus(currentCall.callId, 'busy', {
        ended_at: new Date().toISOString(),
      });

      window.setTimeout(() => {
        void cleanupCall();
      }, 1000);
    }
  }

  /* ------------------------------------------------------------
   * Start outgoing call
   * ---------------------------------------------------------- */

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
      callEndingRef.current = false;

      try {
        /*
         * Check whether the other person is already in an active call.
         */
        const { data: activeCalls } = await supabase
          .from('calls')
          .select('id, caller_id, callee_id, status')
          .or(`caller_id.eq.${peerId},callee_id.eq.${peerId}`)
          .in('status', ['ringing', 'connecting', 'connected', 'reconnecting'])
          .limit(1);

        if (activeCalls && activeCalls.length > 0) {
          setError('This person is currently on another call.');
          return;
        }

        const stream = await getMedia(media, facingMode);

        attachLocalStream(stream, media);

        const { data: row, error: insertError } = await supabase
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

        if (insertError || !row) {
          throw insertError || new Error('Could not register the call.');
        }

        const activeCall: ActiveCall = {
          callId: row.id,
          conversationId,
          peerId,
          peerName,
          peerAvatar,
          media,
          direction: 'outgoing',
        };

        remoteUserRef.current = {
          id: peerId,
          name: peerName,
          avatar: peerAvatar,
        };

        setCurrentCall(activeCall);
        setCurrentStatus('calling');

        /*
         * Create peer connection now so tracks are ready,
         * but DO NOT create the SDP offer yet.
         *
         * The offer is created after the callee sends "ready".
         */
        const pc = createPeerConnection(activeCall);

        if (!pc) {
          throw new Error('Could not initialize the call.');
        }

        await openChannel(row.id, activeCall);

        ringTimerRef.current = setTimeout(() => {
          void (async () => {
            if (!callRef.current) {
              return;
            }

            await updateCallStatus(row.id, 'missed', {
              ended_at: new Date().toISOString(),
            });

            setCurrentStatus('missed');

            window.setTimeout(() => {
              void cleanupCall();
            }, 1200);
          })();
        }, RING_TIMEOUT);
      } catch (err) {
        console.error('[CallProvider] startCall failed:', err);

        setError(getErrorMessage(err));

        const current = callRef.current;

        if (current) {
          await updateCallStatus(current.callId, 'failed', {
            ended_at: new Date().toISOString(),
          });
        }

        await cleanupCall();
      }
    },
    [
      myId,
      facingMode,
      getMedia,
      attachLocalStream,
      createPeerConnection,
      openChannel,
      updateCallStatus,
      cleanupCall,
      setCurrentCall,
      setCurrentStatus,
    ],
  );

  /* ------------------------------------------------------------
   * Accept incoming call
   * ---------------------------------------------------------- */

  const acceptCall = useCallback(async () => {
    const currentCall = callRef.current;

    if (!currentCall) {
      return;
    }

    if (currentCall.direction !== 'incoming') {
      return;
    }

    if (statusRef.current !== 'ringing') {
      return;
    }

    clearRingTimer();
    setError(null);

    try {
      /*
       * Get microphone/camera BEFORE sending ready.
       * This guarantees the caller won't send an offer before
       * our tracks are attached.
       */
      const stream = await getMedia(
        currentCall.media,
        currentCall.media === 'video' ? facingMode : 'user',
      );

      attachLocalStream(stream, currentCall.media);

      setCurrentStatus('connecting');

      await updateCallStatus(currentCall.callId, 'connecting');

      const pc = createPeerConnection(currentCall);

      if (!pc) {
        throw new Error('Could not initialize the call.');
      }

      await openChannel(currentCall.callId, currentCall);

      /*
       * This tells the caller:
       *
       * "I accepted and I am subscribed. Send the offer."
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
      console.error('[CallProvider] acceptCall failed:', err);

      setError(getErrorMessage(err));

      await updateCallStatus(currentCall.callId, 'failed', {
        ended_at: new Date().toISOString(),
      });

      await cleanupCall();
    }
  }, [
    clearRingTimer,
    getMedia,
    facingMode,
    attachLocalStream,
    createPeerConnection,
    openChannel,
    myId,
    updateCallStatus,
    cleanupCall,
    setCurrentStatus,
  ]);

  /* ------------------------------------------------------------
   * Decline
   * ---------------------------------------------------------- */

  const declineCall = useCallback(async () => {
    const currentCall = callRef.current;

    if (!currentCall) {
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

    await updateCallStatus(currentCall.callId, 'declined', {
      ended_at: new Date().toISOString(),
    });

    setCurrentStatus('declined');

    window.setTimeout(() => {
      void cleanupCall();
    }, 900);
  }, [
    clearRingTimer,
    myId,
    updateCallStatus,
    cleanupCall,
    setCurrentStatus,
  ]);

  /* ------------------------------------------------------------
   * End call
   * ---------------------------------------------------------- */

  const endCall = useCallback(async () => {
    const currentCall = callRef.current;

    if (!currentCall || callEndingRef.current) {
      return;
    }

    callEndingRef.current = true;

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

    await updateCallStatus(currentCall.callId, 'ended', {
      ended_at: new Date().toISOString(),
    });

    setCurrentStatus('ended');

    window.setTimeout(() => {
      void cleanupCall();
    }, 500);
  }, [
    clearRingTimer,
    myId,
    updateCallStatus,
    cleanupCall,
    setCurrentStatus,
  ]);

  /* ------------------------------------------------------------
   * Mic
   * ---------------------------------------------------------- */

  const toggleMic = useCallback(() => {
    const stream = localStreamRef.current;

    if (!stream) {
      return;
    }

    const tracks = stream.getAudioTracks();

    if (!tracks.length) {
      return;
    }

    const nextEnabled = !tracks[0].enabled;

    tracks.forEach((track) => {
      track.enabled = nextEnabled;
    });

    setMicEnabled(nextEnabled);
  }, []);

  /* ------------------------------------------------------------
   * Camera
   * ---------------------------------------------------------- */

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;

    if (!stream) {
      return;
    }

    const tracks = stream.getVideoTracks();

    if (!tracks.length) {
      return;
    }

    const nextEnabled = !tracks[0].enabled;

    tracks.forEach((track) => {
      track.enabled = nextEnabled;
    });

    setCameraEnabled(nextEnabled);
  }, []);

  /* ------------------------------------------------------------
   * Switch front/back camera
   * ---------------------------------------------------------- */

  const switchCamera = useCallback(async () => {
    const currentCall = callRef.current;

    if (!currentCall || currentCall.media !== 'video') {
      return;
    }

    const stream = localStreamRef.current;

    if (!stream) {
      return;
    }

    const videoTrack = stream.getVideoTracks()[0];

    if (!videoTrack) {
      return;
    }

    const nextFacingMode =
      facingMode === 'user' ? 'environment' : 'user';

    try {
      const nextStream = await getMedia(
        'video',
        nextFacingMode,
      );

      const nextTrack = nextStream.getVideoTracks()[0];

      if (!nextTrack) {
        return;
      }

      const pc = pcRef.current;

      const sender = pc
        ?.getSenders()
        .find((item) => item.track?.kind === 'video');

      if (sender) {
        await sender.replaceTrack(nextTrack);
      }

      videoTrack.stop();

      const audioTracks = stream.getAudioTracks();

      const replacementStream = new MediaStream([
        ...audioTracks,
        nextTrack,
      ]);

      localStreamRef.current = replacementStream;

      setLocalStream(replacementStream);
      setFacingMode(nextFacingMode);
      setCameraEnabled(true);
    } catch (err) {
      console.warn('[CallProvider] Could not switch camera:', err);
    }
  }, [facingMode, getMedia]);

  /* ------------------------------------------------------------
   * Incoming calls
   * ---------------------------------------------------------- */

  useEffect(() => {
    if (!myId) {
      return;
    }

    let cancelled = false;

    const channel = supabase
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

          if (row.callee_id !== myId) {
            return;
          }

          if (row.status !== 'ringing') {
            return;
          }

          /*
           * If we are already handling a call, reject the new one.
           */
          if (callRef.current) {
            const busyChannel = supabase.channel(`call:${row.id}`);

            busyChannel.subscribe(async (subscriptionStatus) => {
              if (subscriptionStatus === 'SUBSCRIBED') {
                await busyChannel.send({
                  type: 'broadcast',
                  event: 'control',
                  payload: {
                    type: 'busy',
                    from: myId,
                  },
                });

                await supabase.removeChannel(busyChannel);
              }
            });

            return;
          }

          const { data: caller } = await supabase
            .from('profiles')
            .select('id, full_text_name, username, avatar_url')
            .eq('id', row.caller_id)
            .maybeSingle();

          if (cancelled) {
            return;
          }

          const callerName =
            caller?.full_text_name ||
            caller?.username ||
            'Unknown user';

          const activeCall: ActiveCall = {
            callId: row.id,
            conversationId: row.conversation_id,
            peerId: row.caller_id,
            peerName: callerName,
            peerAvatar: caller?.avatar_url ?? null,
            media: row.media,
            direction: 'incoming',
          };

          remoteUserRef.current = {
            id: row.caller_id,
            name: callerName,
            avatar: caller?.avatar_url ?? null,
          };

          setCurrentCall(activeCall);
          setCurrentStatus('ringing');
          setError(null);

          /*
           * Subscribe immediately so the caller can safely
           * receive our ready/decline/bye signals.
           *
           * We DO NOT create a peer connection yet because
           * we don't have local media until the user accepts.
           */
          try {
            await openIncomingChannelOnly(row.id);
          } catch (err) {
            console.error(
              '[CallProvider] Incoming channel failed:',
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

              await updateCallStatus(row.id, 'missed', {
                ended_at: new Date().toISOString(),
              });

              setCurrentStatus('missed');

              window.setTimeout(() => {
                void cleanupCall();
              }, 1200);
            })();
          }, RING_TIMEOUT);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;

      void supabase.removeChannel(channel);
    };
  }, [
    myId,
    clearRingTimer,
    updateCallStatus,
    cleanupCall,
    setCurrentCall,
    setCurrentStatus,
  ]);

  /*
   * Incoming channel-only helper.
   *
   * This exists separately from openChannel because the incoming
   * ringing UI must subscribe before the call is accepted.
   */
  const openIncomingChannelOnly = useCallback(
    async (callId: string) => {
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
        .on('broadcast', { event: 'signal' }, ({ payload }) => {
          void handleSignal(payload);
        })
        .on('broadcast', { event: 'control' }, ({ payload }) => {
          void handleControlSignal(payload);
        });

      channelRef.current = channel;

      await new Promise<void>((resolve, reject) => {
        let settled = false;

        const timeout = window.setTimeout(() => {
          if (settled) {
            return;
          }

          settled = true;
          reject(new Error('Call signaling timed out.'));
        }, 10_000);

        channel.subscribe((subscriptionStatus) => {
          if (subscriptionStatus === 'SUBSCRIBED') {
            window.clearTimeout(timeout);

            if (!settled) {
              settled = true;
              channelReadyRef.current = true;
              resolve();
            }

            return;
          }

          if (
            subscriptionStatus === 'CHANNEL_ERROR' ||
            subscriptionStatus === 'TIMED_OUT'
          ) {
            window.clearTimeout(timeout);

            if (!settled) {
              settled = true;
              reject(new Error('Call signaling failed.'));
            }
          }
        });
      });

      return channel;
    },
    [handleSignal, myId],
  );

  /* ------------------------------------------------------------
   * Browser/tab cleanup
   * ---------------------------------------------------------- */

  useEffect(() => {
    const handlePageHide = () => {
      const currentCall = callRef.current;

      if (!currentCall) {
        return;
      }

      /*
       * Best effort.
       *
       * The normal endCall path handles the normal case.
       */
      try {
        const body = JSON.stringify({
          status: 'ended',
        });

        navigator.sendBeacon?.(
          `/calls/${currentCall.callId}/end`,
          new Blob([body], {
            type: 'application/json',
          }),
        );
      } catch {}
    };

    window.addEventListener('pagehide', handlePageHide);

    return () => {
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, []);

  /* ------------------------------------------------------------
   * Final unmount cleanup
   * ---------------------------------------------------------- */

  useEffect(() => {
    return () => {
      mountedRef.current = false;

      clearRingTimer();
      closePeerConnection();
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
    closePeerConnection,
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

export function useCall(): CallContextValue {
  const context = useContext(CallContext);

  if (!context) {
    throw new Error(
      'useCall must be used inside <CallProvider>.',
    );
  }

  return context;
}
