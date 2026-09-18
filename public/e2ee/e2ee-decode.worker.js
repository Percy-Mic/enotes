/* Dedicated worker for the RECEIVER side of insertable-streams frame decryption.
   Key material arrives after the ECDH exchange. Frames are never dropped or
   held here — the receiver pipeline deadlocks unless every read frame is
   written back (pre-key frames pass through; see worker-codec.js). */
/* eslint-disable no-restricted-globals */
importScripts('/e2ee/worker-codec.js');

let key = null;

self.onmessage = async (event) => {
  const { type } = event.data;
  if (type === 'key') {
    key = await self.e2eeTransforms.importKey(new Uint8Array(event.data.bytes));
    return;
  }
  const { readable, writable } = event.data;
  const reader = readable.getReader();
  const writer = writable.getWriter();

  (async () => {
    while (true) {
      const { value: frame, done } = await reader.read();
      if (done) break;
      await self.e2eeTransforms.decrypt(key, frame, writer);
    }
  })().catch((err) => {
    /* stream torn down with the call — but surface anything else in dev */
    if (!/releaseLock|stream (is|has) (closed|abort)/i.test(String(err))) console.error('[e2ee-decode] pipe failed:', err);
  });
};
