/**
 * E2EE key agreement for 1:1 calls.
 *
 * Each peer generates a throwaway ECDH P-256 keypair per call and publishes
 * only the public half over the signaling channel. Both sides derive the same
 * shared secret with ECDH; symmetric frame keys are expanded from it with
 * HKDF (see crypto-utils.ts). Private keys are non-extractable, never leave
 * the browser, and are dropped with the call — nothing about the key material
 * is persisted server-side or in the database.
 */

export interface EphemeralKeyPair {
  /** base64 of the raw public key — safe to broadcast over signaling. */
  publicKeyB64: string;
  privateKey: CryptoKey;
}

const ECDH_PARAMS: EcKeyGenParams = { name: 'ECDH', namedCurve: 'P-256' };

function b64encode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64decode(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function generateEphemeralKeyPair(): Promise<EphemeralKeyPair> {
  const pair = await crypto.subtle.generateKey(ECDH_PARAMS, false, ['deriveBits']);
  const raw = await crypto.subtle.exportKey('raw', pair.publicKey);
  return { publicKeyB64: b64encode(new Uint8Array(raw)), privateKey: pair.privateKey };
}

/** ECDH: combine my private key with the peer's public half. */
export async function deriveSharedSecret(privateKey: CryptoKey, peerPublicB64: string): Promise<Uint8Array> {
  const peerPublic = await crypto.subtle.importKey(
    'raw',
    b64decode(peerPublicB64) as unknown as BufferSource,
    ECDH_PARAMS,
    false,
    []
  );
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: peerPublic }, privateKey, 256);
  return new Uint8Array(bits);
}
