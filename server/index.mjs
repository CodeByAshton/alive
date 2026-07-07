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
import { seedVault } from './seed.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);

// Lightweight auth: a shared vault key attaches real devices to the same
// vault (single-user prototype).
// TODO: trust boundary — replace with real auth + device attestation, scoped
// per-device permissions, and a kill switch before this touches the internet.
const VAULT_KEY = process.env.VAULT_KEY || 'vault-dev-key';

const store = new VaultStore(process.env.VAULT_DATA || path.join(__dirname, 'data', 'vault.json'));
seedVault(store);
const presence = new PresenceRegistry();

const app = express();
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/models', async (req, res) => {
  if (req.query.key !== VAULT_KEY) return res.status(401).json({ error: 'bad vault key' });
  res.json({ providers: await listProviders() });
});

const dist = path.join(__dirname, '..', 'dist');
app.use(express.static(dist));
app.get(/^\/(?!api|ws).*/, (_req, res, next) => {
  res.sendFile(path.join(dist, 'index.html'), (err) => err && next());
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

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
  const descriptor = {
    deviceId: params.get('deviceId') || connId,
    deviceType: params.get('deviceType') || 'desktop',
    capabilities: (params.get('caps') || 'read').split(',').filter(Boolean),
  };

  sockets.add(ws);
  conns.set(connId, { ws, descriptor });
  presence.join(connId, descriptor);
  ws.send(JSON.stringify({ type: 'hello', presence: presence.snapshot(), rev: store.rev }));

  ws.on('message', async (raw) => {
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
        case 'put':
          store.put(msg.record);
          break;
        case 'delete':
          store.delete(msg.path, msg.mtime);
          break;
        case 'move':
          store.move(msg.from, msg.to);
          break;
        case 'presence_state':
          presence.setState(connId, msg.state === 'background' ? 'background' : 'active');
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
              text: String(msg.text ?? ''),
              deviceType: descriptor.deviceType,
              provider: msg.provider || 'anthropic',
              model: msg.model || 'claude-opus-4-8',
              broadcast,
              execRemote,
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
