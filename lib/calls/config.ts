/**
 * WebRTC ICE configuration.
 *
 * STUN helps peers discover their public network addresses.
 *
 * TURN is strongly recommended for production because some networks
 * cannot establish a direct peer-to-peer connection.
 *
 * The optional TURN values are read from environment variables so
 * credentials are not committed to Git.
 */

const turnUrl = process.env.NEXT_PUBLIC_TURN_URL;
const turnUsername = process.env.NEXT_PUBLIC_TURN_USERNAME;
const turnCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;

const turnServer =
  turnUrl && turnUsername && turnCredential
    ? {
        urls: turnUrl,
        username: turnUsername,
        credential: turnCredential,
      }
    : null;

export const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
      ],
    },

    ...(turnServer ? [turnServer] : []),
  ],
};

export const CALL_RING_TIMEOUT_MS = 30_000;

export const CALL_SIGNAL_TIMEOUT_MS = 15_000;
