/**
 * enotes WebRTC transport configuration.
 *
 * Signaling is handled by Supabase Realtime Broadcast.
 * Media is handled by browser-native WebRTC.
 *
 * STUN is always available for direct connectivity. Optional TURN
 * configuration can be supplied at build time for networks where direct
 * peer-to-peer ICE fails (corporate Wi-Fi, symmetric NAT, restrictive
 * mobile networks, etc.).
 *
 * NEXT_PUBLIC_TURN_URLS:
 *   comma-separated TURN URLs, for example:
 *   turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp
 *
 * NEXT_PUBLIC_TURN_USERNAME / NEXT_PUBLIC_TURN_CREDENTIAL:
 *   TURN credentials. Prefer short-lived/ephemeral credentials generated
 *   by your TURN service rather than a permanent credential.
 */

const turnUrls = (process.env.NEXT_PUBLIC_TURN_URLS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const turnUsername = process.env.NEXT_PUBLIC_TURN_USERNAME?.trim();
const turnCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL?.trim();

const optionalTurnServer =
  turnUrls.length > 0 && turnUsername && turnCredential
    ? [
        {
          urls: turnUrls,
          username: turnUsername,
          credential: turnCredential,
        },
      ]
    : [];

export const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
      ],
    },
    ...optionalTurnServer,
  ],
  iceCandidatePoolSize: 10,
};

export const CALL_RING_TIMEOUT_MS = 60_000;
export const CALL_SIGNAL_TIMEOUT_MS = 15_000;
export const CALL_RECONNECT_GRACE_MS = 20_000;
