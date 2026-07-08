// Account auth: verify Supabase Auth access tokens (JWTs) presented by
// clients. Two verification paths:
//   - SUPABASE_JWT_SECRET set  -> verify HS256 locally (no network per turn)
//   - otherwise                -> ask GoTrue (/auth/v1/user) and cache briefly
// Either way the result is { userId, email } or an exception.

import crypto from 'node:crypto';

const cache = new Map(); // token -> { user, at }
const CACHE_TTL = 60_000;

function b64urlToBuf(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function verifyHs256(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const [headB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(b64urlToBuf(headB64).toString('utf8'));
  if (header.alg !== 'HS256') throw new Error(`unsupported alg ${header.alg}`);
  const expected = crypto.createHmac('sha256', secret).update(`${headB64}.${payloadB64}`).digest();
  const actual = b64urlToBuf(sigB64);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new Error('bad signature');
  }
  const payload = JSON.parse(b64urlToBuf(payloadB64).toString('utf8'));
  if (payload.exp && payload.exp * 1000 < Date.now()) throw new Error('token expired');
  if (!payload.sub) throw new Error('token has no subject');
  return { userId: payload.sub, email: payload.email || '' };
}

async function verifyRemote(token, supabaseUrl, apiKey) {
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { authorization: `Bearer ${token}`, apikey: apiKey },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`auth rejected (${res.status})`);
  const user = await res.json();
  if (!user?.id) throw new Error('auth rejected');
  return { userId: user.id, email: user.email || '' };
}

export async function verifySupabaseToken(token, { jwtSecret, supabaseUrl, apiKey }) {
  if (!token) throw new Error('no token');
  const hit = cache.get(token);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.user;

  const user = jwtSecret
    ? verifyHs256(token, jwtSecret)
    : await verifyRemote(token, supabaseUrl, apiKey);

  cache.set(token, { user, at: Date.now() });
  if (cache.size > 500) {
    // drop the oldest half; tokens rotate hourly anyway
    for (const key of [...cache.keys()].slice(0, 250)) cache.delete(key);
  }
  return user;
}
