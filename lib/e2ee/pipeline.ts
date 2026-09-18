/**
 * Main-thread E2EE pipeline orchestration for 1:1 calls.
 *
 * Flow on both peers (identical code, roles differ only in timing):
 *   1. generate an ephemeral ECDH P-256 keypair
 *   'key' broadcast  → 2. receive peer's public half, stash it
 *   on accept/connect → 3. ECDH → HKDF → 32-byte AES frame key
 *                     → 4. install worker transforms on senders/receivers
 *                     → 5. broadcast own public half (if not already sent)
 *
 * Media never touches any server as plaintext: signaling sees only public
 * keys and SDP; DTLS-SRTP hop encryption stays underneath. Nothing derived
 * is persisted anywhere — keys die with the call.
 *
 * Frame discipline lives in the workers (public/e2ee/): frames pass through
 * unchanged until the key exists (protected by DTLS-SRTP like any WebRTC
 * call), then AES-GCM engages — no dropped or held frames, so the encoder/
 * decoder pipeline never stalls and no keyframe recovery is needed.
 */

import { deriveSharedSecret, generateEphemeralKeyPair } from '@/lib/e2ee/keys';

export interface E2eePipeline {
  /** Feed every "key" broadcast payload from the peer here. */
  onPeerKeyB64: (b64: string) => Promise<void>;
  /** Own public half — broadcast it once the signaling channel is open. */
  getOwnKeyB64: () => string | 'pending';
  /** True once both sides' keys are derived (badge may show). */
  isReady: () => boolean;
  /** Install transforms on this outbound track's sender. */
  attachSender: (sender: RTCRtpSender) => void;
  /** Install transforms on this inbound track's receiver. */
  attachReceiver: (receiver: RTCRtpReceiver) => void;
  /** Start ENCRYPTING outgoing frames (after the peer confirmed its
      receivers are decrypting) — never engage earlier or the peer sees
      undecryptable garbage during the transition. */
  engageSender: () => void;
  /** Terminate workers and drop key material — call in finishCall(). */
  dispose: () => void;
}

const HKDF_INFO = new TextEncoder().encode('enotes-call-e2ee-v1');

export function supportsE2ee(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof RTCRtpSender !== 'undefined' &&
    'createEncodedStreams' in RTCRtpSender.prototype
  );
}

export function createE2eePipeline(onOwnKeyReady?: () => void, onReady?: () => void): E2eePipeline | null {
  if (!supportsE2ee()) return null;

  let disposed = false;
  const workers: Worker[] = [];
  let ownKeyB64: string | 'pending' = 'pending';
  let ownPrivateKey: CryptoKey | null = null;
  let peerKeyB64: string | null = null;
  let frameKeyBytes: Uint8Array | null = null;
  /** sender encryption stays off until the peer confirms it can decrypt. */
  let senderEngaged = false;
  const encodeWorkers: Worker[] = [];
  /** createEncodedStreams is one-shot per sender/receiver — never wire twice. */
  const wiredReceivers = new WeakSet<RTCRtpReceiver>();
  const wiredSenders = new WeakSet<RTCRtpSender>();

  const transformWith = (kind: 'encode' | 'decode', senderOrReceiver: RTCRtpSender | RTCRtpReceiver): void => {
    /* unified: both prototypes expose createEncodedStreams the same way */
    const streams = (
      senderOrReceiver as unknown as {
        createEncodedStreams: () => { readable: ReadableStream; writable: WritableStream };
      }
    ).createEncodedStreams();
    const worker = new Worker(`/e2ee/e2ee-${kind}.worker.js`);
    /* Surface worker failures in dev — a silent worker death looks exactly
       like "connected but black video" and is otherwise undiscoverable. */
    if (process.env.NODE_ENV === 'development') {
      worker.onerror = (e) => console.error(`[e2ee] ${kind} worker error:`, e.message || e);
    }
    workers.push(worker);
    if (kind === 'encode') encodeWorkers.push(worker);
    if (frameKeyBytes) {
      worker.postMessage({ type: 'key', bytes: frameKeyBytes.buffer.slice(0) as ArrayBuffer });
    }
    if (kind === 'encode' && senderEngaged) {
      worker.postMessage({ type: 'engage' });
    }
    worker.postMessage(streams, [streams.readable, streams.writable]);
  };

  const deriveAndInstall = async (): Promise<void> => {
    if (disposed || !ownPrivateKey || !peerKeyB64 || frameKeyBytes) return;

    const shared = await deriveSharedSecret(ownPrivateKey, peerKeyB64);
    const base = await crypto.subtle.importKey('raw', shared as unknown as BufferSource, 'HKDF', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: HKDF_INFO },
      base,
      256
    );
    frameKeyBytes = new Uint8Array(bits);

    const payload = frameKeyBytes.buffer.slice(0) as ArrayBuffer;
    for (const w of workers) w.postMessage({ type: 'key', bytes: payload });

    onReady?.();
  };

  const pipelineObj: E2eePipeline = {
    onPeerKeyB64: async (b64) => {
      if (disposed) return;
      peerKeyB64 = b64;
      await deriveAndInstall();
    },
    getOwnKeyB64: () => ownKeyB64,
    isReady: () => !!(frameKeyBytes && peerKeyB64 && ownKeyB64 !== 'pending'),
    attachSender: (sender) => {
      if (disposed || wiredSenders.has(sender)) return;
      wiredSenders.add(sender);
      transformWith('encode', sender);
    },
    attachReceiver: (receiver) => {
      if (disposed || wiredReceivers.has(receiver)) return;
      wiredReceivers.add(receiver);
      transformWith('decode', receiver);
    },
    engageSender: () => {
      if (disposed || senderEngaged || !frameKeyBytes) return;
      senderEngaged = true;
      for (const w of encodeWorkers) w.postMessage({ type: 'engage' });
    },
    dispose: () => {
      disposed = true;
      for (const w of workers.splice(0)) w.terminate();
      ownPrivateKey = null;
      peerKeyB64 = null;
      frameKeyBytes = null;
    },
  };

  void (async () => {
    const pair = await generateEphemeralKeyPair();
    if (disposed) return;
    ownKeyB64 = pair.publicKeyB64;
    ownPrivateKey = pair.privateKey;
    onOwnKeyReady?.();
    if (peerKeyB64) await deriveAndInstall();
  })();

  return pipelineObj;
}
