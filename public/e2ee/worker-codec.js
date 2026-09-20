/**
 * Frame codec for the dedicated E2EE workers (e2ee-encode.worker.js /
 * e2ee-decode.worker.js). Kept as a separate module so both workers import
 * the identical implementation — a one-character mismatch would silently
 * black-screen the call.
 *
 * Wire format per frame (mirrors the W3C insertable-streams sample):
 *   [1 byte version=1][12 byte IV][AES-GCM ciphertext][16 byte GCM tag]
 *
 * Pre-key semantics: until the key arrives a worker forwards every frame
 * UNCHANGED. This is required — a sender that drops or holds frames
 * deadlocks the encoded-frame pipeline — and it is honest: those frames
 * are protected by DTLS-SRTP like every WebRTC call; frame-level E2EE
 * engages from the key onward. The writer parameter is the
 * WritableStreamDefaultWriter of the encoded-frame sink (manual
 * reader/writer loop — TransformStream backpressure stalls these streams).
 */
/* eslint-disable no-restricted-globals */

const VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = 1 + IV_LEN;

async function importKey(rawKeyBytes) {
  return crypto.subtle.importKey('raw', rawKeyBytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Sender transform. Before the key: passthrough. After: AES-GCM. */
async function encryptFrame(key, frame, writer) {
  if (key === null) {
    writer.write(frame); // DTLS-SRTP still protects the hop
    return;
  }
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new Uint8Array([VERSION]) },
    key,
    frame.data
  );
  /* frame.data must be an exact-size ArrayBuffer in Chromium */
  const out = new Uint8Array(new ArrayBuffer(HEADER_LEN + ciphertext.byteLength));
  out[0] = VERSION;
  out.set(iv, 1);
  out.set(new Uint8Array(ciphertext), HEADER_LEN);
  frame.data = out.buffer;
  writer.write(frame);
}

/** Receiver transform. Before the key: passthrough. Wrong key/corrupt: drop. */
async function decryptFrame(key, frame, writer) {
  if (key === null) {
    writer.write(frame);
    return;
  }
  const data = new Uint8Array(frame.data);
  if (data.byteLength < HEADER_LEN + TAG_LEN || data[0] !== VERSION) {
    writer.write(frame); // not ours (e.g. sender pre-key frame) — pass through
    return;
  }
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: data.slice(1, HEADER_LEN), additionalData: new Uint8Array([VERSION]) },
      key,
      data.slice(HEADER_LEN)
    );
    frame.data = plain;
    writer.write(frame);
  } catch {
    /* wrong key or corrupted frame — render the last good frame */
  }
}

self.e2eeTransforms = {
  importKey,
  encrypt: encryptFrame,
  decrypt: decryptFrame,
};
