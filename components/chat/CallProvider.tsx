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
import {
  CALL_RING_TIMEOUT_MS,
  ICE_SERVERS,
} from '@/lib/calls/config';

type CallMedia = 'audio' | 'video';

type CallStatus =
  | 'calling'
  | 'ringing'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'declined'
  | 'missed'
  | 'busy'
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

const CallContext =
  createContext<CallContextValue | null>(null);

interface CallProviderProps {
  children: React.ReactNode;
  myId?: string | null;
}

interface CallRow {
  id: string;
  conversation_id: string | null;
  caller_id: string;
  callee_id: string;
  media: CallMedia;
  status: string;
}

interface ProfileRow {
  id: string;
  full_text_name: string | null;
  username: string | null;
  avatar_url: string | null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        return 'Camera or microphone permission was denied. Please allow access in your browser settings.';

      case 'NotFoundError':
        return 'No camera or microphone was found on this device.';

      case 'NotReadableError':
        return 'Your camera or microphone is already being used by another application.';

      case 'OverconstrainedError':
        return 'The selected camera or microphone could not satisfy the requested settings.';

      case 'SecurityError':
        return 'Camera and microphone access requires HTTPS or localhost.';

      default:
        return error.message || 'Could not access your camera or microphone.';
    }
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
  const [myId, setMyId] = useState<string | null>(
    suppliedMyId ?? null,
  );

  const [call, setCall] =
    useState<ActiveCall | null>(null);

  const [status, setStatus] =
    useState<CallStatus | null>(null);

  const [localStream, setLocalStream] =
    useState<MediaStream | null>(null);

  const [remoteStream, setRemoteStream] =
    useState<MediaStream | null>(null);

  const [micEnabled, setMicEnabled] =
    useState(true);

  const [cameraEnabled, setCameraEnabled] =
    useState(true);

  const [facingMode, setFacingMode] =
    useState<'user' | 'environment'>('user');

  const [error, setError] =
    useState<string | null>(null);

  const callRef =
    useRef<ActiveCall | null>(null);

  const statusRef =
    useRef<CallStatus | null>(null);

  const peerRef =
    useRef<RTCPeerConnection | null>(null);

  const channelRef =
    useRef<ReturnType<typeof supabase.channel> | null>(
      null,
    );

  const incomingChannelRef =
    useRef<ReturnType<typeof supabase.channel> | null>(
      null,
    );

  const localStreamRef =
    useRef<MediaStream | null>(null);

  const remoteStreamRef =
    useRef<MediaStream | null>(null);

  const pendingIceRef =
    useRef<RTCIceCandidateInit[]>([]);

  const ringTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );

  const mountedRef =
    useRef(true);

  const endingRef =
    useRef(false);

  const creatingOfferRef =
    useRef(false);

  const applyingAnswerRef =
    useRef(false);

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

      return () => {
        mountedRef.current = false;
      };
    }

    let cancelled = false;

    void supabase.auth.getUser().then(({ data }) => {
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

  const stopStream = useCallback(
    (stream: MediaStream | null) => {
      stream?.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignore already-stopped tracks.
        }
      });
    },
    [],
  );

  const stopLocalMedia = useCallback(() => {
    stopStream(localStreamRef.current);

    localStreamRef.current = null;

    if (mountedRef.current) {
      setLocalStream(null);
    }
  }, [stopStream]);

  const clearRemoteMedia = useCallback(() => {
    stopStream(remoteStreamRef.current);

    remoteStreamRef.current = null;

    if (mountedRef.current) {
      setRemoteStream(null);
    }
  }, [stopStream]);

  const closePeer = useCallback(() => {
    const peer = peerRef.current;

    if (!peer) {
      return;
    }

    peer.onicecandidate = null;
    peer.ontrack = null;
    peer.onconnectionstatechange = null;
    peer.oniceconnectionstatechange = null;
    peer.onsignalingstatechange = null;

    try {
      peer.close();
    } catch {
      // Ignore already closed connections.
    }

    peerRef.current = null;
  }, []);

  const removeCallChannel = useCallback(async () => {
    const channel = channelRef.current;

    channelRef.current = null;

    if (channel) {
      try {
        await supabase.removeChannel(channel);
      } catch {
        // Ignore cleanup errors.
      }
    }
  }, []);

  const removeIncomingChannel = useCallback(async () => {
    const channel = incomingChannelRef.current;

    incomingChannelRef.current = null;

    if (channel) {
      try {
        await supabase.removeChannel(channel);
      } catch {
        // Ignore cleanup errors.
      }
    }
  }, []);

  const updateCallStatus = useCallback(
    async (
      callId: string,
      nextStatus: string,
      extra: Record<string, unknown> = {},
    ) => {
      const { error: updateError } =
        await supabase
          .from('calls')
          .update({
            status: nextStatus,
            ...extra,
          })
          .eq('id', callId);

      if (updateError) {
        console.warn(
          '[enotes calls]',
          updateError.message,
        );
      }
    },
    [],
  );

  const getMedia = useCallback(
    async (
      media: CallMedia,
      mode: 'user' | 'environment' = 'user',
    ) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          'Camera and microphone access is not available in this browser or page context.',
        );
      }

      return navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },

        video:
          media === 'video'
            ? {
                facingMode: {
                  ideal: mode,
                },
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
      });
    },
    [],
  );

  const attachLocalStream = useCallback(
    (
      stream: MediaStream,
      media: CallMedia,
    ) => {
      stopStream(localStreamRef.current);

      localStreamRef.current = stream;

      if (!mountedRef.current) {
        return;
      }

      setLocalStream(stream);

      setMicEnabled(
        stream
          .getAudioTracks()
          .some((track) => track.enabled),
      );

      setCameraEnabled(
        media === 'video' &&
          stream
            .getVideoTracks()
            .some((track) => track.enabled),
      );
    },
    [stopStream],
  );

  const flushPendingIce = useCallback(
    async () => {
      const peer = peerRef.current;

      if (!peer?.remoteDescription) {
        return;
      }

      const candidates =
        pendingIceRef.current.splice(0);

      for (const candidate of candidates) {
        try {
          await peer.addIceCandidate(candidate);
        } catch (error) {
          console.warn(
            '[enotes calls] queued ICE candidate failed',
            error,
          );
        }
      }
    },
    [],
  );

  const sendSignal = useCallback(
    async (payload: Record<string, unknown>) => {
      const channel = channelRef.current;

      if (!channel || !myId) {
        return;
      }

      const result = await channel.send({
        type: 'broadcast',
        event: 'signal',
        payload: {
          ...payload,
          from: myId,
        },
      });

      if (result !== 'ok') {
        console.warn(
          '[enotes calls] signal broadcast result:',
          result,
        );
      }
    },
    [myId],
  );

  const sendControl = useCallback(
    async (payload: Record<string, unknown>) => {
      const channel = channelRef.current;

      if (!channel || !myId) {
        return;
      }

      const result = await channel.send({
        type: 'broadcast',
        event: 'control',
        payload: {
          ...payload,
          from: myId,
        },
      });

      if (result !== 'ok') {
        console.warn(
          '[enotes calls] control broadcast result:',
          result,
        );
      }
    },
    [myId],
  );

  const createPeer = useCallback(
    (callData: ActiveCall) => {
      if (peerRef.current) {
        return peerRef.current;
      }

      const peer =
        new RTCPeerConnection(ICE_SERVERS);

      peerRef.current = peer;

      const local = localStreamRef.current;

      if (local) {
        local.getTracks().forEach((track) => {
          try {
            peer.addTrack(track, local);
          } catch (error) {
            console.warn(
              '[enotes calls] addTrack failed',
              error,
            );
          }
        });
      }

      peer.onicecandidate = (event) => {
        if (!event.candidate) {
          return;
        }

        void sendSignal({
          type: 'ice-candidate',
          candidate: event.candidate.toJSON(),
        });
      };

      peer.ontrack = (event) => {
        const incomingStream =
          event.streams[0];

        if (incomingStream) {
          remoteStreamRef.current =
            incomingStream;

          if (mountedRef.current) {
            setRemoteStream(incomingStream);
          }

          return;
        }

        let fallback =
          remoteStreamRef.current;

        if (!fallback) {
          fallback = new MediaStream();

          remoteStreamRef.current =
            fallback;

          if (mountedRef.current) {
            setRemoteStream(fallback);
          }
        }

        if (
          !fallback
            .getTracks()
            .some(
              (track) =>
                track.id === event.track.id,
            )
        ) {
          fallback.addTrack(event.track);
        }
      };

      peer.onconnectionstatechange = () => {
        switch (peer.connectionState) {
          case 'connecting':
            setCurrentStatus('connecting');
            break;

          case 'connected':
            setCurrentStatus('connected');

            void updateCallStatus(
              callData.callId,
              'connected',
              {
                connected_at:
                  new Date().toISOString(),
              },
            );
            break;

          case 'disconnected':
            setCurrentStatus('reconnecting');
            break;

          case 'failed':
            setCurrentStatus('reconnecting');
            break;

          case 'closed':
            break;
        }
      };

      peer.oniceconnectionstatechange = () => {
        if (
          peer.iceConnectionState ===
            'failed' &&
          mountedRef.current
        ) {
          setCurrentStatus('reconnecting');
        }
      };

      return peer;
    },
    [
      sendSignal,
      setCurrentStatus,
      updateCallStatus,
    ],
  );

  const cleanup = useCallback(
    async () => {
      clearRingTimer();

      pendingIceRef.current = [];

      creatingOfferRef.current = false;
      applyingAnswerRef.current = false;
      endingRef.current = false;

      closePeer();
      stopLocalMedia();
      clearRemoteMedia();

      await removeCallChannel();

      setCurrentCall(null);
      setCurrentStatus(null);

      if (mountedRef.current) {
        setError(null);
        setMicEnabled(true);
        setCameraEnabled(true);
        setFacingMode('user');
      }
    },
    [
      clearRingTimer,
      closePeer,
      stopLocalMedia,
      clearRemoteMedia,
      removeCallChannel,
      setCurrentCall,
      setCurrentStatus,
    ],
  );

  const handleSignal = useCallback(
    async (payload: any) => {
      const current = callRef.current;
      const peer = peerRef.current;

      if (!current || !peer) {
        return;
      }

      if (!payload || payload.from === myId) {
        return;
      }

      if (payload.type === 'offer') {
        if (
          current.direction !==
          'incoming'
        ) {
          return;
        }

        if (
          peer.signalingState !==
          'stable'
        ) {
          return;
        }

        if (!payload.sdp) {
          return;
        }

        try {
          await peer.setRemoteDescription({
            type: 'offer',
            sdp: payload.sdp,
          });

          await flushPendingIce();

          if (
            peer.signalingState !==
            'have-remote-offer'
          ) {
            return;
          }

          const answer =
            await peer.createAnswer();

          await peer.setLocalDescription(
            answer,
          );

          await sendSignal({
            type: 'answer',
            sdp:
              peer.localDescription?.sdp ??
              answer.sdp,
          });
        } catch (error) {
          console.error(
            '[enotes calls] offer handling failed',
            error,
          );

          if (mountedRef.current) {
            setError(
              getErrorMessage(error),
            );
          }
        }

        return;
      }

      if (payload.type === 'answer') {
        if (
          current.direction !==
          'outgoing'
        ) {
          return;
        }

        if (
          peer.signalingState !==
          'have-local-offer'
        ) {
          return;
        }

        if (applyingAnswerRef.current) {
          return;
        }

        if (!payload.sdp) {
          return;
        }

        applyingAnswerRef.current = true;

        try {
          await peer.setRemoteDescription({
            type: 'answer',
            sdp: payload.sdp,
          });

          await flushPendingIce();
        } catch (error) {
          console.warn(
            '[enotes calls] answer handling failed',
            error,
          );
        } finally {
          applyingAnswerRef.current =
            false;
        }

        return;
      }

      if (
        payload.type ===
        'ice-candidate'
      ) {
        const candidate =
          payload.candidate as
            | RTCIceCandidateInit
            | undefined;

        if (!candidate) {
          return;
        }

        if (!peer.remoteDescription) {
          pendingIceRef.current.push(
            candidate,
          );

          return;
        }

        try {
          await peer.addIceCandidate(
            candidate,
          );
        } catch (error) {
          console.warn(
            '[enotes calls] ICE candidate failed',
            error,
          );
        }
      }
    },
    [
      flushPendingIce,
      myId,
      sendSignal,
    ],
  );

  const handleControl = useCallback(
    async (payload: any) => {
      const current =
        callRef.current;

      if (
        !current ||
        !payload ||
        payload.from === myId
      ) {
        return;
      }

      if (payload.type === 'ready') {
        if (
          current.direction !==
            'outgoing' ||
          statusRef.current !==
            'calling'
        ) {
          return;
        }

        const peer =
          peerRef.current;

        if (!peer) {
          return;
        }

        if (
          creatingOfferRef.current
        ) {
          return;
        }

        if (
          peer.signalingState !==
          'stable'
        ) {
          return;
        }

        creatingOfferRef.current =
          true;

        try {
          setCurrentStatus(
            'connecting',
          );

          await updateCallStatus(
            current.callId,
            'connecting',
          );

          const offer =
            await peer.createOffer();

          await peer.setLocalDescription(
            offer,
          );

          await sendSignal({
            type: 'offer',
            sdp:
              peer.localDescription?.sdp ??
              offer.sdp,
          });
        } catch (error) {
          console.error(
            '[enotes calls] offer creation failed',
            error,
          );

          if (mountedRef.current) {
            setError(
              getErrorMessage(error),
            );
          }
        } finally {
          creatingOfferRef.current =
            false;
        }

        return;
      }

      if (
        payload.type === 'decline'
      ) {
        clearRingTimer();

        await updateCallStatus(
          current.callId,
          'declined',
          {
            ended_at:
              new Date().toISOString(),
          },
        );

        setCurrentStatus(
          'declined',
        );

        window.setTimeout(() => {
          void cleanup();
        }, 900);

        return;
      }

      if (
        payload.type === 'busy'
      ) {
        clearRingTimer();

        await updateCallStatus(
          current.callId,
          'busy',
          {
            ended_at:
              new Date().toISOString(),
          },
        );

        setCurrentStatus('busy');

        window.setTimeout(() => {
          void cleanup();
        }, 900);

        return;
      }

      if (payload.type === 'bye') {
        clearRingTimer();

        await updateCallStatus(
          current.callId,
          'ended',
          {
            ended_at:
              new Date().toISOString(),
          },
        );

        setCurrentStatus('ended');

        window.setTimeout(() => {
          void cleanup();
        }, 600);
      }
    },
    [
      myId,
      clearRingTimer,
      cleanup,
      sendSignal,
      setCurrentStatus,
      updateCallStatus,
    ],
  );

  const subscribeToCallChannel =
    useCallback(
      async (
        callId: string,
      ) => {
        if (
          channelRef.current
        ) {
          return channelRef.current;
        }

        const channel =
          supabase.channel(
            `call:${callId}`,
            {
              config: {
                private: true,

                broadcast: {
                  self: false,
                  ack: true,
                },
              },
            },
          );

        channel
          .on(
            'broadcast',
            {
              event: 'signal',
            },
            ({ payload }) => {
              void handleSignal(
                payload,
              );
            },
          )
          .on(
            'broadcast',
            {
              event: 'control',
            },
            ({ payload }) => {
              void handleControl(
                payload,
              );
            },
          );

        channelRef.current =
          channel;

        await new Promise<void>(
          (
            resolve,
            reject,
          ) => {
            let settled =
              false;

            const timeout =
              window.setTimeout(
                () => {
                  if (
                    settled
                  ) {
                    return;
                  }

                  settled = true;

                  reject(
                    new Error(
                      'The call signaling channel timed out.',
                    ),
                  );
                },
                10_000,
              );

            channel.subscribe(
              (
                state,
                subscribeError,
              ) => {
                if (
                  state ===
                  'SUBSCRIBED'
                ) {
                  window.clearTimeout(
                    timeout,
                  );

                  if (
                    !settled
                  ) {
                    settled =
                      true;
                    resolve();
                  }

                  return;
                }

                if (
                  state ===
                    'CHANNEL_ERROR' ||
                  state ===
                    'TIMED_OUT'
                ) {
                  window.clearTimeout(
                    timeout,
                  );

                  if (
                    !settled
                  ) {
                    settled =
                      true;

                    reject(
                      subscribeError ||
                        new Error(
                          'The call signaling channel could not be opened.',
                        ),
                    );
                  }
                }
              },
            );
          },
        );

        return channel;
      },
      [
        handleSignal,
        handleControl,
      ],
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
        setError(
          'You must be signed in to make a call.',
        );
        return;
      }

      if (callRef.current) {
        setError(
          'You are already in a call.',
        );
        return;
      }

      if (peerId === myId) {
        setError(
          'You cannot call yourself.',
        );
        return;
      }

      setError(null);

      try {
        const stream =
          await getMedia(
            media,
            media === 'video'
              ? facingMode
              : 'user',
          );

        attachLocalStream(
          stream,
          media,
        );

        const {
          data: callRow,
          error: insertError,
        } = await supabase
          .from('calls')
          .insert({
            conversation_id:
              conversationId,
            caller_id: myId,
            callee_id: peerId,
            media,
            status: 'ringing',
          })
          .select(
            'id, conversation_id, caller_id, callee_id, media, status',
          )
          .single();

        if (
          insertError ||
          !callRow
        ) {
          throw (
            insertError ??
            new Error(
              'Could not create the call.',
            )
          );
        }

        const activeCall:
          ActiveCall = {
          callId: callRow.id,
          conversationId:
            callRow.conversation_id,
          peerId,
          peerName,
          peerAvatar,
          media,
          direction: 'outgoing',
        };

        setCurrentCall(
          activeCall,
        );

        setCurrentStatus(
          'calling',
        );

        createPeer(
          activeCall,
        );

        await subscribeToCallChannel(
          callRow.id,
        );

        clearRingTimer();

        ringTimerRef.current =
          setTimeout(() => {
            void (async () => {
              const current =
                callRef.current;

              if (
                !current
              ) {
                return;
              }

              if (
                statusRef.current !==
                  'calling' &&
                statusRef.current !==
                  'ringing'
              ) {
                return;
              }

              await updateCallStatus(
                current.callId,
                'missed',
                {
                  ended_at:
                    new Date().toISOString(),
                },
              );

              setCurrentStatus(
                'missed',
              );

              window.setTimeout(
                () => {
                  void cleanup();
                },
                1200,
              );
            })();
          }, CALL_RING_TIMEOUT_MS);
      } catch (error) {
        console.error(
          '[enotes calls] startCall failed',
          error,
        );

        if (mountedRef.current) {
          setError(
            getErrorMessage(error),
          );
        }

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

  const acceptCall =
    useCallback(async () => {
      const current =
        callRef.current;

      if (
        !current ||
        current.direction !==
          'incoming' ||
        statusRef.current !==
          'ringing'
      ) {
        return;
      }

      clearRingTimer();
      setError(null);

      try {
        const stream =
          await getMedia(
            current.media,
            current.media ===
              'video'
              ? facingMode
              : 'user',
          );

        attachLocalStream(
          stream,
          current.media,
        );

        createPeer(current);

        setCurrentStatus(
          'connecting',
        );

        await updateCallStatus(
          current.callId,
          'connecting',
        );

        await subscribeToCallChannel(
          current.callId,
        );

        await sendControl({
          type: 'ready',
        });
      } catch (error) {
        console.error(
          '[enotes calls] acceptCall failed',
          error,
        );

        if (mountedRef.current) {
          setError(
            getErrorMessage(error),
          );
        }

        await updateCallStatus(
          current.callId,
          'failed',
          {
            ended_at:
              new Date().toISOString(),
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
      sendControl,
      cleanup,
    ]);

  const declineCall =
    useCallback(async () => {
      const current =
        callRef.current;

      if (!current) {
        return;
      }

      clearRingTimer();

      try {
        await sendControl({
          type: 'decline',
        });
      } catch {
        // The database status below remains authoritative.
      }

      await updateCallStatus(
        current.callId,
        'declined',
        {
          ended_at:
            new Date().toISOString(),
        },
      );

      setCurrentStatus(
        'declined',
      );

      window.setTimeout(() => {
        void cleanup();
      }, 900);
    }, [
      clearRingTimer,
      sendControl,
      updateCallStatus,
      setCurrentStatus,
      cleanup,
    ]);

  const endCall = useCallback(
    async () => {
      const current =
        callRef.current;

      if (
        !current ||
        endingRef.current
      ) {
        return;
      }

      endingRef.current = true;

      clearRingTimer();

      try {
        await sendControl({
          type: 'bye',
        });
      } catch {
        // Continue with database cleanup.
      }

      await updateCallStatus(
        current.callId,
        'ended',
        {
          ended_at:
            new Date().toISOString(),
        },
      );

      setCurrentStatus(
        'ended',
      );

      window.setTimeout(() => {
        void cleanup();
      }, 500);
    },
    [
      clearRingTimer,
      sendControl,
      updateCallStatus,
      setCurrentStatus,
      cleanup,
    ],
  );

  const toggleMic =
    useCallback(() => {
      const stream =
        localStreamRef.current;

      if (!stream) {
        return;
      }

      const tracks =
        stream.getAudioTracks();

      if (!tracks.length) {
        return;
      }

      const next =
        !tracks.every(
          (track) =>
            track.enabled,
        );

      tracks.forEach(
        (track) => {
          track.enabled =
            next;
        },
      );

      setMicEnabled(next);
    }, []);

  const toggleCamera =
    useCallback(() => {
      const stream =
        localStreamRef.current;

      if (!stream) {
        return;
      }

      const tracks =
        stream.getVideoTracks();

      if (!tracks.length) {
        return;
      }

      const next =
        !tracks.every(
          (track) =>
            track.enabled,
        );

      tracks.forEach(
        (track) => {
          track.enabled =
            next;
        },
      );

      setCameraEnabled(next);
    }, []);

  const switchCamera =
    useCallback(async () => {
      const current =
        callRef.current;

      if (
        !current ||
        current.media !==
          'video'
      ) {
        return;
      }

      const currentStream =
        localStreamRef.current;

      if (!currentStream) {
        return;
      }

      try {
        const nextMode =
          facingMode === 'user'
            ? 'environment'
            : 'user';

        const replacement =
          await getMedia(
            'video',
            nextMode,
          );

        const nextTrack =
          replacement.getVideoTracks()[0];

        if (!nextTrack) {
          stopStream(
            replacement,
          );
          return;
        }

        const sender =
          peerRef.current
            ?.getSenders()
            .find(
              (item) =>
                item.track
                  ?.kind ===
                'video',
            );

        if (sender) {
          await sender.replaceTrack(
            nextTrack,
          );
        }

        const audioTracks =
          currentStream.getAudioTracks();

        currentStream
          .getVideoTracks()
          .forEach(
            (track) => {
              try {
                track.stop();
              } catch {}
            },
          );

        const nextStream =
          new MediaStream([
            ...audioTracks,
            nextTrack,
          ]);

        localStreamRef.current =
          nextStream;

        if (mountedRef.current) {
          setLocalStream(
            nextStream,
          );
          setFacingMode(
            nextMode,
          );
          setCameraEnabled(
            true,
          );
        }
      } catch (error) {
        console.warn(
          '[enotes calls] camera switch failed',
          error,
        );
      }
    }, [
      facingMode,
      getMedia,
      stopStream,
    ]);

  /*
   * Global incoming-call listener.
   *
   * The calls table must be enabled for Realtime/Postgres Changes.
   */
  useEffect(() => {
    if (!myId) {
      return;
    }

    let cancelled = false;

    const channel =
      supabase.channel(
        `incoming-calls:${myId}`,
        {
          config: {
            private: true,
          },
        },
      );

    incomingChannelRef.current =
      channel;

    channel.on(
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

        const row =
          payload.new as CallRow;

        if (
          row.callee_id !==
            myId ||
          row.status !==
            'ringing'
        ) {
          return;
        }

        if (
          callRef.current
        ) {
          /*
           * Tell the new caller that this account is already
           * handling another call.
           */
          const busyChannel =
            supabase.channel(
              `call:${row.id}`,
              {
                config: {
                  private: true,
                  broadcast: {
                    self: false,
                    ack: true,
                  },
                },
              },
            );

          busyChannel.on(
            'broadcast',
            {
              event:
                'control',
            },
            () => {},
          );

          try {
            await new Promise<void>(
              (
                resolve,
              ) => {
                let done =
                  false;

                const timeout =
                  window.setTimeout(
                    () => {
                      if (!done) {
                        done =
                          true;
                        resolve();
                      }
                    },
                    2500,
                  );

                busyChannel.subscribe(
                  async (
                    state,
                  ) => {
                    if (
                      state ===
                      'SUBSCRIBED'
                    ) {
                      await busyChannel.send(
                        {
                          type:
                            'broadcast',
                          event:
                            'control',
                          payload:
                            {
                              type:
                                'busy',
                              from:
                                myId,
                            },
                        },
                      );

                      window.clearTimeout(
                        timeout,
                      );

                      if (
                        !done
                      ) {
                        done =
                          true;
                        resolve();
                      }
                    }
                  },
                );
              },
            );
          } catch {
            // Ignore busy signaling failure.
          } finally {
            await supabase.removeChannel(
              busyChannel,
            );
          }

          return;
        }

        const {
          data: caller,
        } = await supabase
          .from('profiles')
          .select(
            'id, full_text_name, username, avatar_url',
          )
          .eq(
            'id',
            row.caller_id,
          )
          .maybeSingle();

        if (cancelled) {
          return;
        }

        const profile =
          caller as
            | ProfileRow
            | null;

        const activeCall:
          ActiveCall = {
          callId: row.id,
          conversationId:
            row.conversation_id,
          peerId:
            row.caller_id,
          peerName:
            profile?.full_text_name ||
            profile?.username ||
            'Unknown user',
          peerAvatar:
            profile?.avatar_url ??
            null,
          media:
            row.media ===
            'audio'
              ? 'audio'
              : 'video',
          direction:
            'incoming',
        };

        setCurrentCall(
          activeCall,
        );

        setCurrentStatus(
          'ringing',
        );

        setError(null);

        try {
          /*
           * Subscribe immediately so an offer cannot arrive
           * before the callee has a signaling channel.
           */
          await subscribeToCallChannel(
            row.id,
          );
        } catch (error) {
          console.error(
            '[enotes calls] incoming signaling subscription failed',
            error,
          );

          if (mountedRef.current) {
            setError(
              getErrorMessage(
                error,
              ),
            );
          }
        }

        clearRingTimer();

        ringTimerRef.current =
          setTimeout(() => {
            void (async () => {
              const current =
                callRef.current;

              if (
                !current ||
                current.callId !==
                  row.id ||
                statusRef.current !==
                  'ringing'
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

              setCurrentStatus(
                'missed',
              );

              window.setTimeout(
                () => {
                  void cleanup();
                },
                1200,
              );
            })();
          }, CALL_RING_TIMEOUT_MS);
      },
    );

    channel.subscribe(
      (state, error) => {
        if (
          state ===
            'CHANNEL_ERROR' ||
          state ===
            'TIMED_OUT'
        ) {
          console.warn(
            '[enotes calls] incoming call listener error',
            error,
          );
        }
      },
    );

    return () => {
      cancelled = true;

      if (
        incomingChannelRef.current ===
        channel
      ) {
        incomingChannelRef.current =
          null;
      }

      void supabase.removeChannel(
        channel,
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
   * Clean up calls if the browser hides/closes the page.
   */
  useEffect(() => {
    const onPageHide = () => {
      const current =
        callRef.current;

      if (!current) {
        return;
      }

      try {
        navigator.sendBeacon(
          `/calls/${current.callId}/end`,
          new Blob(
            [
              JSON.stringify({
                status:
                  'ended',
              }),
            ],
            {
              type:
                'application/json',
            },
          ),
        );
      } catch {
        // Best-effort only.
      }
    };

    window.addEventListener(
      'pagehide',
      onPageHide,
    );

    return () => {
      window.removeEventListener(
        'pagehide',
        onPageHide,
      );
    };
  }, []);

  /*
   * Final component cleanup.
   */
  useEffect(() => {
    return () => {
      mountedRef.current = false;

      clearRingTimer();
      closePeer();
      stopLocalMedia();
      clearRemoteMedia();

      const channel =
        channelRef.current;

      channelRef.current =
        null;

      if (channel) {
        void supabase.removeChannel(
          channel,
        );
      }

      const incoming =
        incomingChannelRef.current;

      incomingChannelRef.current =
        null;

      if (incoming) {
        void supabase.removeChannel(
          incoming,
        );
      }
    };
  }, [
    clearRingTimer,
    closePeer,
    stopLocalMedia,
    clearRemoteMedia,
  ]);

  const value =
    useMemo<CallContextValue>(
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
  const context =
    useContext(CallContext);

  if (!context) {
    throw new Error(
      'useCall must be used inside CallProvider.',
    );
  }

  return context;
}
