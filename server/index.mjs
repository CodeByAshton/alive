// Vault cloud backend: canonical vault records, realtime sync, the device
// presence registry, and the harness. This is the "cloud" seam — the
// VaultStore + WS protocol here could be swapped for Supabase (Postgres +
// Realtime + Presence) without touching the client's SyncProvider interface.

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { VaultStore } from './store.mjs';
import { PresenceRegistry } from './presence.mjs';
import { runTurn } from './harness.mjs';
import { listProviders } from './engines/index.mjs';
import { migrateVault, seedVault } from './seed.mjs';
import { connectorStatus } from './connectors.mjs';
import { buildZip } from './zip.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);

// Lightweight auth: a shared vault key attaches real devices to the same
// vault (single-user prototype).
// TODO: trust boundary — replace with real auth + device attestation, scoped
// per-device permissions, and a kill switch before this touches the internet.
const VAULT_KEY = process.env.VAULT_KEY || 'vault-dev-key';

// Storage backend: Supabase Postgres when configured (state survives
// redeploys), otherwise the local JSON file. Same interface either way.
let store;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  const { SupabaseVaultStore } = await import('./store-supabase.mjs');
  store = await new SupabaseVaultStore({
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_KEY,
    vaultKey: VAULT_KEY,
  }).init();
  console.log('vault store: supabase postgres');
} else {
  store = new VaultStore(process.env.VAULT_DATA || path.join(__dirname, 'data', 'vault.json'));
}
seedVault(store);
migrateVault(store);
const presence = new PresenceRegistry();

const app = express();
// Native shells (the iOS app) call the API cross-origin. The vault key is the
// gate; CORS just lets the request through. Lock it down for a deployment by
// listing origins: VAULT_ALLOWED_ORIGINS=https://vault.example,capacitor://localhost
const ALLOWED_ORIGINS = (process.env.VAULT_ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim());
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes('*')) res.set('Access-Control-Allow-Origin', '*');
  else if (origin && ALLOWED_ORIGINS.includes(origin)) res.set('Access-Control-Allow-Origin', origin);
  res.set('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/models', async (req, res) => {
  if (req.query.key !== VAULT_KEY) return res.status(401).json({ error: 'bad vault key' });
  res.json({ providers: await listProviders() });
});
app.get('/api/connectors', async (req, res) => {
  if (req.query.key !== VAULT_KEY) return res.status(401).json({ error: 'bad vault key' });
  res.json({ connectors: await connectorStatus(store) });
});
// Export: the whole vault as a zip of plain Markdown — the "your data is just
// files" guarantee, downloadable. Chats and .vault system files included.
app.get('/api/export', (req, res) => {
  if (req.query.key !== VAULT_KEY) return res.status(401).json({ error: 'bad vault key' });
  const files = store
    .list()
    .filter((r) => r.type === 'file')
    .map((r) => ({ path: r.path, content: r.content, mtime: r.mtime }));
  const stamp = new Date().toISOString().slice(0, 10);
  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', `attachment; filename="vault-export-${stamp}.zip"`);
  res.send(buildZip(files));
});

const dist = path.join(__dirname, '..', 'dist');
app.use(express.static(dist));
app.get(/^\/(?!api|ws).*/, (_req, res, next) => {
  res.sendFile(path.join(dist, 'index.html'), (err) => err && next());
});

const server = http.createServer(app);
// maxPayload caps a single WS frame (a put with a very large note still fits;
// anything bigger is dropped by ws before it reaches the handler).
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2 * 1024 * 1024 });

// Per-connection rate limit: a lazy token bucket. Generous enough for an
// offline outbox flushing on reconnect, tight enough to stop a runaway or
// hostile client from flooding the vault.
const RATE_CAPACITY = 150; // burst
const RATE_REFILL = 40; // sustained msgs/sec
function makeRateLimiter() {
  let tokens = RATE_CAPACITY;
  let last = Date.now();
  let warned = 0;
  return () => {
    const now = Date.now();
    tokens = Math.min(RATE_CAPACITY, tokens + ((now - last) / 1000) * RATE_REFILL);
    last = now;
    if (tokens < 1) {
      const warn = now - warned > 1000; // don't flood the flooder either
      warned = warn ? now : warned;
      return { ok: false, warn };
    }
    tokens -= 1;
    return { ok: true };
  };
}

// Input size caps (payload cap above is the hard ceiling).
const MAX_TURN_TEXT = 32_000;
const MAX_CONTENT = 1_500_000;

const sockets = new Set();
function broadcast(message) {
  const payload = JSON.stringify(message);
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}

store.on('change', (records) => broadcast({ type: 'change', records }));
presence.on('update', (devices) => broadcast({ type: 'presence', devices }));

const chatLocks = new Set();
let connSeq = 0;

// Remote tool execution: dispatch a tool call to a connected device that can
// run it (the companion node harness), await its reply over the same socket.
const conns = new Map(); // connId -> { ws, descriptor }
const pendingExec = new Map(); // execId -> { resolve, reject, timer }
let execSeq = 0;

// Kill switch: any authed surface can pause the assistant entirely.
let assistantPaused = false;

// Permission modes, Claude-style. 'ask' confirms every command on-screen
// before it runs, 'auto' runs commands unattended, 'readonly' refuses them
// outright. The default is a vault setting (.vault/settings.json) so every
// device — and every future session — agrees on it.
const SETTINGS_PATH = '.vault/settings.json';
const MODES = ['ask', 'auto', 'readonly'];

function readSettings() {
  try {
    return JSON.parse(store.get(SETTINGS_PATH)?.content ?? '{}') || {};
  } catch {
    return {};
  }
}

let assistantMode = MODES.includes(readSettings().mode) ? readSettings().mode : 'ask';

function setAssistantMode(mode) {
  if (!MODES.includes(mode)) return;
  assistantMode = mode;
  store.put({ path: SETTINGS_PATH, type: 'file', content: JSON.stringify({ ...readSettings(), mode }) });
  broadcast({ type: 'mode', mode });
}

// Per-command approval — voice-initiated, screen-confirmed. Before a
// run_command executes, every active surface gets an approval card; the
// command runs only after a human approves it. Deny or 60s of silence
// rejects the tool call (the model is told, and adapts).
const pendingApprovals = new Map(); // approvalId -> { resolve, timer }
let approvalSeq = 0;

function requestApproval({ chatPath, command, cwd, kind = 'command' }) {
  return new Promise((resolve) => {
    const id = `appr-${++approvalSeq}`;
    const timer = setTimeout(() => {
      pendingApprovals.delete(id);
      broadcast({ type: 'approval_resolved', id, approved: false });
      resolve(false);
    }, 60_000);
    pendingApprovals.set(id, { resolve, timer });
    broadcast({ type: 'approval_request', id, chatPath, command, cwd: cwd ?? null, kind });
  });
}

function resolveApproval(id, approved) {
  const pending = pendingApprovals.get(id);
  if (!pending) return;
  pendingApprovals.delete(id);
  clearTimeout(pending.timer);
  broadcast({ type: 'approval_resolved', id, approved: Boolean(approved) });
  pending.resolve(Boolean(approved));
}

function execRemote(name, input) {
  const target = [...conns.entries()].find(([connId, c]) => {
    const live = presence.devices.get(connId);
    return live?.state === 'active' && (c.descriptor.capabilities || []).includes('exec') && c.ws.readyState === c.ws.OPEN;
  });
  if (!target) return Promise.reject(new Error('No machine is connected to run commands right now.'));
  const [, conn] = target;
  return new Promise((resolve, reject) => {
    const id = `exec-${++execSeq}`;
    const timer = setTimeout(() => {
      pendingExec.delete(id);
      reject(new Error('Command timed out (no response from the machine).'));
    }, 90_000);
    pendingExec.set(id, { resolve, reject, timer });
    conn.ws.send(JSON.stringify({ type: 'tool_exec', id, name, input }));
  });
}

wss.on('connection', (ws, req) => {
  const params = new URL(req.url, 'http://x').searchParams;
  if (params.get('key') !== VAULT_KEY) {
    ws.close(4001, 'bad vault key');
    return;
  }
  const connId = `conn-${++connSeq}`;
  // Capabilities are assigned server-side from the device type — a client
  // cannot self-declare what it is allowed to do.
  // TODO: trust boundary — the device *type* is still client-declared; full
  // attestation means pairing/approving new devices before they get any caps.
  const CAPS_BY_TYPE = {
    phone: ['read', 'voice'],
    desktop: ['read', 'write'],
    node: ['read', 'write', 'exec'],
  };
  const deviceType = params.get('deviceType') || 'desktop';
  const descriptor = {
    deviceId: params.get('deviceId') || connId,
    deviceType,
    capabilities: CAPS_BY_TYPE[deviceType] ?? ['read'],
  };

  sockets.add(ws);
  conns.set(connId, { ws, descriptor });
  presence.join(connId, descriptor);
  const takeToken = makeRateLimiter();
  ws.send(JSON.stringify({ type: 'hello', presence: presence.snapshot(), rev: store.rev, paused: assistantPaused, mode: assistantMode }));

  ws.on('message', async (raw) => {
    const token = takeToken();
    if (!token.ok) {
      if (token.warn) ws.send(JSON.stringify({ type: 'error', error: 'rate limited — slow down' }));
      return;
    }
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    try {
      switch (msg.type) {
        case 'sync':
          ws.send(JSON.stringify({ type: 'records', records: store.since(msg.since ?? 0), rev: store.rev }));
          break;
        case 'put': {
          if (typeof msg.record?.content === 'string' && msg.record.content.length > MAX_CONTENT) {
            ws.send(JSON.stringify({ type: 'error', error: 'file too large to sync (1.5 MB cap)' }));
            break;
          }
          // Conflict copies, Obsidian-style: a write that loses last-write-wins
          // (offline edit on one device, newer edit on another) is saved next
          // to the winner instead of vanishing.
          const rec = msg.record;
          const existing = rec?.path ? store.get(rec.path) : null;
          if (
            existing &&
            existing.type === 'file' &&
            rec.type === 'file' &&
            typeof rec.mtime === 'number' &&
            existing.mtime > rec.mtime &&
            typeof rec.content === 'string' &&
            rec.content !== existing.content
          ) {
            const stamp = new Date(rec.mtime).toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '.');
            const conflictPath = rec.path.replace(/(\.md)?$/, (ext) => ` (conflicted copy ${stamp})${ext || ''}`);
            store.put({ path: conflictPath, type: 'file', content: rec.content });
            break;
          }
          store.put(rec);
          break;
        }
        case 'delete':
          store.delete(msg.path, msg.mtime);
          break;
        case 'move':
          store.move(msg.from, msg.to);
          break;
        case 'presence_state':
          presence.setState(connId, msg.state === 'background' ? 'background' : 'active');
          break;
        case 'approval_response':
          resolveApproval(String(msg.id), Boolean(msg.approved));
          break;
        case 'set_paused':
          assistantPaused = Boolean(msg.paused);
          broadcast({ type: 'paused', paused: assistantPaused });
          break;
        case 'set_mode':
          setAssistantMode(String(msg.mode));
          break;
        case 'tool_exec_result': {
          const pending = pendingExec.get(msg.id);
          if (pending) {
            pendingExec.delete(msg.id);
            clearTimeout(pending.timer);
            if (msg.ok) pending.resolve(String(msg.output ?? ''));
            else pending.reject(new Error(String(msg.output || 'command failed')));
          }
          break;
        }
        case 'turn': {
          if (assistantPaused) {
            ws.send(JSON.stringify({ type: 'turn_error', chatPath: msg.chatPath, error: 'The assistant is paused. Resume it from the Devices panel.' }));
            break;
          }
          if (chatLocks.has(msg.chatPath)) {
            ws.send(JSON.stringify({ type: 'turn_error', chatPath: msg.chatPath, error: 'A turn is already running in this chat.' }));
            break;
          }
          chatLocks.add(msg.chatPath);
          try {
            await runTurn({
              store,
              presence,
              chatPath: msg.chatPath,
              text: String(msg.text ?? '').slice(0, MAX_TURN_TEXT),
              deviceType: descriptor.deviceType,
              provider: msg.provider || 'anthropic',
              model: msg.model || 'claude-opus-4-8',
              broadcast,
              execRemote: async (name, input) => {
                if (assistantMode === 'readonly') {
                  throw new Error('Commands are off in Read-only mode. The user can change the mode in Settings.');
                }
                if (assistantMode !== 'auto') {
                  const approved = await requestApproval({
                    chatPath: msg.chatPath,
                    command: String(input?.command ?? ''),
                    cwd: input?.cwd,
                  });
                  if (!approved) throw new Error('The user declined to run that command.');
                }
                return execRemote(name, input);
              },
              // Per-connector 'ask' policy routes through the same approval
              // cards; the vault-wide Auto mode trusts everything.
              approveConnector: async ({ connectorName, toolName }) => {
                if (assistantMode === 'auto') return true;
                return requestApproval({
                  chatPath: msg.chatPath,
                  kind: 'connector',
                  command: `${connectorName}: ${toolName}`,
                });
              },
            });
          } finally {
            chatLocks.delete(msg.chatPath);
          }
          break;
        }
      }
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', error: err.message }));
    }
  });

  ws.on('close', () => {
    sockets.delete(ws);
    conns.delete(connId);
    presence.leave(connId);
  });
});

server.listen(PORT, () => {
  console.log(`vault server on :${PORT} (vault key: ${VAULT_KEY})`);
});
