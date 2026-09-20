/* Dedicated worker for the SENDER side of insertable-streams frame encryption.
   Main thread transfers { readable, writable } (the encoded-frame streams),
   then sends { type: 'key', bytes } once the ECDH exchange completes, and
   { type: 'engage' } when the PEER CONFIRMS its receivers are decrypting.

   Frames are never dropped or held here — the sender pipeline deadlocks
   unless every read frame is written back. Before 'engage', frames pass
   through unchanged (protected by DTLS-SRTP like any WebRTC call); after
   it, every frame is AES-GCM encrypted. The one-way switch keeps the
   transition clean: the peer either gets plaintext or decryptable
   ciphertext, never garbage. */
/* eslint-disable no-restricted-globals */
importScripts('/e2ee/worker-codec.js');

let key = null;
let engaged = false;

self.onmessage = async (event) => {
  const { type } = event.data;
  if (type === 'key') {
    key = await self.e2eeTransforms.importKey(new Uint8Array(event.data.bytes));
    return;
  }
  if (type === 'engage') {
    engaged = true;
    return;
  }
  const { readable, writable } = event.data;
  const reader = readable.getReader();
  const writer = writable.getWriter();

  (async () => {
    while (true) {
      const { value: frame, done } = await reader.read();
      if (done) break;
      await self.e2eeTransforms.encrypt(engaged ? key : null, frame, writer);
    }
  })().catch((err) => {
    /* stream torn down with the call — but surface anything else in dev */
    if (!/releaseLock|stream (is|has) (closed|abort)/i.test(String(err))) console.error('[e2ee-encode] pipe failed:', err);
  });
};
