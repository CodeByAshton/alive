// Accounts-mode integration test, fully offline: starts the server with
// VAULT_AUTH=accounts and a local JWT secret, mints Supabase-shaped access
// tokens, and proves (1) valid tokens connect, (2) tampered/expired tokens
// are rejected, (3) each user gets an isolated vault, (4) the HTTP API
// honours tokens too. Run: node scripts/test-auth.mjs

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8899;
const SECRET = 'test-jwt-secret';

const results = [];
let failed = false;
function check(name, ok, detail = '') {
  results.push({ name, ok });
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function mintToken({ sub, exp = Math.floor(Date.now() / 1000) + 3600, secret = SECRET }) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub, email: `${sub}@test.local`, role: 'authenticated', aud: 'authenticated', exp }));
  const sig = b64url(crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

function wsConnect(query) {
  return new Promise((resolve) => {
    const state = { ws: null, msgs: [], closed: null };
    const ws = new WebSocket(`ws://localhost:${PORT}/ws?${query}`);
    // The upgrade succeeds before auth runs server-side, so a rejected
    // connection looks like open -> close(4001). Resolve with a live state
    // object and let the close handler mutate it.
    ws.on('message', (raw) => state.msgs.push(JSON.parse(raw.toString())));
    ws.on('open', () => {
      state.ws = ws;
      resolve(state);
    });
    ws.on('close', (code) => {
      state.closed = code;
      state.ws = null;
      resolve(state);
    });
    ws.on('error', () => {});
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Boot the server in accounts mode with a scratch data dir.
const dataDir = path.join(__dirname, '..', 'server', 'data-test-auth');
const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.mjs')], {
  env: {
    ...process.env,
    PORT: String(PORT),
    VAULT_AUTH: 'accounts',
    SUPABASE_JWT_SECRET: SECRET,
    VAULT_DATA: path.join(dataDir, 'unused.json'),
    SUPABASE_URL: '',
    SUPABASE_SERVICE_KEY: '',
    VAULT_ENABLE_MOCK: '1',
  },
  stdio: 'pipe',
});
server.stderr.on('data', (d) => process.stderr.write(d));
await wait(1200);

try {
  // 1. Valid token connects and gets a hello.
  const alice = await wsConnect(`token=${mintToken({ sub: 'alice' })}&deviceId=alice-phone&deviceType=phone`);
  await wait(400);
  check('valid token connects', alice.ws !== null && alice.msgs.some((m) => m.type === 'hello'));

  // 2. Tampered token is rejected.
  const forged = await wsConnect(`token=${mintToken({ sub: 'mallory', secret: 'wrong-secret' })}&deviceType=phone`);
  await wait(200);
  check('forged token rejected (4001)', forged.closed === 4001);

  // 3. Expired token is rejected.
  const expired = await wsConnect(`token=${mintToken({ sub: 'alice', exp: Math.floor(Date.now() / 1000) - 10 })}&deviceType=phone`);
  await wait(200);
  check('expired token rejected (4001)', expired.closed === 4001);

  // 4. No token at all is rejected; the old shared key doesn't work either.
  const keyed = await wsConnect(`key=vault-dev-key&deviceType=desktop`);
  await wait(200);
  check('shared key refused in accounts mode', keyed.closed === 4001);

  // 5. Vault isolation: alice writes, bob syncs — bob must not see it.
  alice.ws.send(JSON.stringify({ type: 'put', record: { path: 'notes/Secret.md', type: 'file', content: 'alice only', mtime: Date.now() } }));
  await wait(400);

  const bob = await wsConnect(`token=${mintToken({ sub: 'bob' })}&deviceId=bob-desktop&deviceType=desktop`);
  bob.ws.send(JSON.stringify({ type: 'sync', since: 0 }));
  await wait(500);
  const bobRecords = bob.msgs.filter((m) => m.type === 'records').flatMap((m) => m.records ?? []);
  check('bob has his own seeded vault', bobRecords.some((r) => r.path.includes('Welcome')));
  check('bob cannot see alice\'s notes', !bobRecords.some((r) => r.path === 'notes/Secret.md'));

  const alice2 = await wsConnect(`token=${mintToken({ sub: 'alice' })}&deviceId=alice-laptop&deviceType=desktop`);
  alice2.ws.send(JSON.stringify({ type: 'sync', since: 0 }));
  await wait(500);
  const aliceRecords = alice2.msgs.filter((m) => m.type === 'records').flatMap((m) => m.records ?? []);
  check('alice sees her note from a second device', aliceRecords.some((r) => r.path === 'notes/Secret.md'));

  // 6. Presence is per-vault: alice's two devices see each other, not bob.
  const aliceHello = alice2.msgs.find((m) => m.type === 'hello');
  const alicePeers = (aliceHello?.presence ?? []).map((d) => d.deviceId);
  check('presence is scoped to the vault', alicePeers.includes('alice-phone') && !alicePeers.includes('bob-desktop'));

  // 7. HTTP API honours tokens (and rejects garbage).
  const okRes = await fetch(`http://localhost:${PORT}/api/export?token=${mintToken({ sub: 'alice' })}`);
  const badRes = await fetch(`http://localhost:${PORT}/api/export?token=garbage`);
  const zipHead = Buffer.from(await okRes.arrayBuffer()).subarray(0, 2).toString();
  check('export works with a valid token', okRes.status === 200 && zipHead === 'PK');
  check('export rejects a bad token', badRes.status === 401);

  // 8. /api/config advertises accounts mode to the client.
  const cfg = await (await fetch(`http://localhost:${PORT}/api/config`)).json();
  check('config advertises accounts mode', cfg.auth === 'accounts');

  alice.ws?.close();
  alice2.ws?.close();
  bob.ws?.close();
} finally {
  server.kill();
  const { rmSync } = await import('node:fs');
  rmSync(dataDir, { recursive: true, force: true });
  // scratch per-user vault files live under server/data as vault-user-*.json
  const { readdirSync } = await import('node:fs');
  const dd = path.join(__dirname, '..', 'server', 'data');
  try {
    for (const f of readdirSync(dd)) {
      if (/^vault-user-(alice|bob)\.json$/.test(f)) rmSync(path.join(dd, f), { force: true });
    }
  } catch {
    /* no data dir */
  }
}

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} auth checks passed`);
process.exit(failed ? 1 : 0);
