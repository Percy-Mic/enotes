/**
 * enotes free WebRTC configuration.
 *
 * No Twilio.
 * No Cloudflare.
 * No paid video API.
 *
 * Media:
 *   Browser <-> Browser through native WebRTC.
 *
 * Signaling:
 *   Supabase Realtime Broadcast.
 *
 * STUN:
 *   Used to help peers discover viable network paths.
 *
 * Important:
 *   STUN-only WebRTC will not work on every network.
 *   A TURN server can be added later without changing
 *   the calling architecture.
 */

export const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
      ],
    },
  ],

  iceCandidatePoolSize: 10,
};

export const CALL_RING_TIMEOUT_MS = 30_000;

export const CALL_SIGNAL_TIMEOUT_MS = 15_000;
