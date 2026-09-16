// Supabase Edge Function: send-push
//
// Sends Web Push notifications (browser-native, no paid provider) to all of a
// user's registered push subscriptions. Called by server-side flows — e.g. a
// Database Web Hook on `notifications` INSERT, or another Edge Function — so a
// completely closed browser still receives alerts via the OS.
//
// REQUIRED SECRETS (supabase secrets set):
//   VAPID_PRIVATE_KEY   — the VAPID private key (base64url, no padding)
//   VAPID_PUBLIC_KEY    — the matching public key
//   VAPID_SUBJECT       — mailto:https://enotes-amber.vercel.app
// Optional hardening:
//   SEND_PUSH_SECRET    — shared secret the caller must send as
//                         `x-send-push-secret` (prevents open use of the fn)
//
// Payload: { userId, title, body, url?, tag? }
//
// Recommended wiring (free, no code): Database Web Hook on notifications
// INSERT → POST https://<project>.supabase.co/functions/v1/send-push with
// headers { Content-Type, Authorization: SERVICE_ROLE_KEY, x-send-push-secret }
// and body built from the row: { "userId": "NEW.user_id", "title": "enotes",
// "body": "NEW.message", "url": "/notifications", "tag": "NEW.id" }.
//
// NOTE ON RESPECTING PREFERENCES: the function checks user_settings.notify_*
// only in a coarse way (all-or-nothing) because mapping every notification
// type to its preference column lives in app logic. Fine-grained suppression
// should ALSO happen at notification-creation time (app code), which is the
// authoritative gate for in-app notifications.

/* PAYLOAD ENCRYPTION (RFC 8291 "aes128gcm"):
   The push service rejects unencrypted bodies, so the payload is encrypted
   with the subscription's p256dh/auth keys using WebCrypto only:
   • ECDH: our ephemeral P-256 key × the subscription's p256dh public key
     → shared secret; HKDF-SHA256 mixes it with the auth secret
     (info = "WebPush: info" || receiver-pub || sender-pub) → IKM
   • HKDF again with info "Content-Encoding: aes128gcm" → CEK + NONCE
   • 31-byte salt prefix + record = ciphertext || 17-byte tag, with the
     0x02 padding delimiter appended to the plaintext.
   VAPID (RFC 8292) stays the same ES256 JWT.
   (The `web-push` npm package can't run in Deno; this is its RFC 8291
   core implemented against Deno's standard WebCrypto.) */

// @ts-nocheck — Edge Functions run their own Deno tooling, outside this Next.js tsconfig
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:https://enotes-amber.vercel.app';
const SEND_PUSH_SECRET = Deno.env.get('SEND_PUSH_SECRET') ?? '';

const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';

function base64urlToBytes(input: string): Uint8Array {
  const pad = '='.repeat((4 - (input.length % 4)) % 4);
  const b64 = (input + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const encoder = new TextEncoder();

/* ---------- RFC 8291 payload encryption (aes128gcm) ---------- */

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

async function hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
    key,
    length * 8
  );
  return new Uint8Array(bits);
}

async function encryptAes128Gcm(
  plaintext: Uint8Array,
  subscriptionP256dh: string,
  subscriptionAuth: string
): Promise<{ headers: Record<string, string>; body: Uint8Array }> {
  /* 1. ephemeral sender key pair */
  const senderKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const senderPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', (senderKeys as CryptoKeyPair).publicKey));

  /* 2. receiver public key + auth secret from the subscription */
  const receiverPubRaw = base64urlToBytes(subscriptionP256dh);
  const receiverPub = await crypto.subtle.importKey('raw', receiverPubRaw as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const authSecret = base64urlToBytes(subscriptionAuth);

  /* 3. ECDH shared secret → IKM via HKDF (info = "WebPush: info" ‖ pub_ua ‖ pub_as) */
  const shared = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: receiverPub },
    (senderKeys as CryptoKeyPair).privateKey,
    256
  ));
  const ikm = await hkdfSha256(
    shared,
    authSecret,
    concatBytes(encoder.encode('WebPush: info'), receiverPubRaw, senderPubRaw),
    32
  );

  /* 4. content encryption key + nonce */
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cekNonce = await hkdfSha256(ikm, salt, encoder.encode('Content-Encoding: aes128gcm'), 32);
  const cek = cekNonce.slice(0, 16);
  const nonce = cekNonce.slice(16, 32);

  /* 5. one record with the 0x02 padding delimiter (rs = 4096 default) */
  const padded = concatBytes(plaintext, new Uint8Array([0x02]));
  const encKey = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource, tagLength: 128 },
    encKey,
    padded as BufferSource
  ));

  /* 6. aes128gcm header block: salt(16) rs(4) idlen(1) sender-pub(65) */
  const header = new Uint8Array(16 + 4 + 1 + senderPubRaw.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = senderPubRaw.length;
  header.set(senderPubRaw, 21);

  return { headers: { 'Content-Encoding': 'aes128gcm' }, body: concatBytes(header, cipher) };
}

async function vapidAuthorization(endpoint: string): Promise<string> {
  const endpointUrl = new URL(endpoint);
  const audience = `${endpointUrl.protocol}//${endpointUrl.host}`;
  const header = { typ: 'JWT', alg: 'ES256' };
  const claims = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: VAPID_SUBJECT,
  };
  const signingInput = `${b64url(encoder.encode(JSON.stringify(header)))}.${b64url(encoder.encode(JSON.stringify(claims)))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    base64urlToBytes(VAPID_PRIVATE_KEY),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    key,
    encoder.encode(signingInput)
  );
  return `vapid t=${signingInput}.${b64url(new Uint8Array(signature))}, k=${VAPID_PUBLIC_KEY}`;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-send-push-secret',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
  if (SEND_PUSH_SECRET && req.headers.get('x-send-push-secret') !== SEND_PUSH_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
  if (!VAPID_PRIVATE_KEY || !VAPID_PUBLIC_KEY) {
    return new Response(JSON.stringify({ error: 'VAPID keys are not configured on this deployment' }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  let body: { userId?: string; title?: string; body?: string; url?: string; tag?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  const userId = body.userId;
  if (!userId) {
    return new Response(JSON.stringify({ error: 'userId is required' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  /* coarse preference gate: if the user turned notifications off entirely */
  const { data: settings } = await admin
    .from('user_settings')
    .select('notify_messages, notify_comments, notify_reactions, notify_mentions, notify_calls, notify_journal_activity')
    .eq('user_id', userId)
    .maybeSingle();
  if (settings) {
    const allOff = Object.values(settings as Record<string, boolean>).every((v) => v === false);
    if (allOff) {
      return new Response(JSON.stringify({ delivered: 0, skipped: 'all notification preferences off' }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
  }

  const { data: subs, error } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth_key')
    .eq('user_id', userId);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
  if (!subs || subs.length === 0) {
    return new Response(JSON.stringify({ delivered: 0 }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  const payload = encoder.encode(JSON.stringify({
    title: body.title || 'enotes',
    body: body.body || '',
    url: body.url || '/notifications',
    tag: body.tag,
  }));

  let delivered = 0;
  const dead: string[] = [];

  for (const sub of subs) {
    try {
      const encrypted = await encryptAes128Gcm(payload, sub.p256dh, sub.auth_key);
      const auth = await vapidAuthorization(sub.endpoint);
      const res = await fetch(sub.endpoint, {
        method: 'POST',
        headers: {
          Authorization: auth,
          TTL: '86400',
          ...encrypted.headers,
        },
        body: encrypted.body as unknown as BodyInit,
      });
      if (res.ok) {
        delivered++;
      } else if (res.status === 404 || res.status === 410) {
        dead.push(sub.endpoint);
      }
    } catch {
      /* unreachable endpoint this round; not deleting on transient errors */
    }
  }

  /* housekeeping: push service says these subscriptions are gone */
  for (const endpoint of dead) {
    await admin.from('push_subscriptions').delete().eq('endpoint', endpoint);
  }

  return new Response(JSON.stringify({ delivered, removed: dead.length }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
});
