// Vault cloud backend: canonical vault records, realtime sync, the device
// presence registry, and the harness. Multi-tenant: every vault gets its own
// context (store + presence + approvals + mode + kill switch), and broadcasts
// never cross vaults.
//
// Auth modes:
//   VAULT_AUTH=key (default)  — one shared-key vault, the self-host/dev setup
//   VAULT_AUTH=accounts       — real user accounts via Supabase Auth: clients
//     sign in (email+password), present their access token, and the server
//     verifies it (locally with SUPABASE_JWT_SECRET when provided, otherwise
//     against GoTrue) and gives each user their own isolated vault.

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { VaultStore } from './store.mjs';
import { PresenceRegistry } from './presence.mjs';
import { runTurn } from './harness.mjs';
import { listProviders, utilityModelFor } from './engines/index.mjs';
import { migrateVault, seedVault } from './seed.mjs';
import { connectorStatus } from './connectors.mjs';
import { buildZip } from './zip.mjs';
import { verifySupabaseToken } from './auth.mjs';
import { completeFlow, disconnect, startFlow } from './oauth.mjs';
import { editAutomationWithModel, runAutomation, startAutomationScheduler } from './automations.mjs';
import { maybeReflect, recordDismissal, runReflection } from './reflection.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);

const VAULT_KEY = process.env.VAULT_KEY || 'vault-dev-key';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

const AUTH_MODE = process.env.VAULT_AUTH === 'accounts' ? 'accounts' : 'key';
if (AUTH_MODE === 'accounts' && !SUPABASE_JWT_SECRET && !SUPABASE_URL) {
  throw new Error('VAULT_AUTH=accounts needs SUPABASE_JWT_SECRET (offline verify) or SUPABASE_URL (+ anon key) to verify tokens.');
}

const MODES = ['ask', 'auto', 'readonly'];
const SETTINGS_PATH = '.vault/settings.json';

/* ── per-vault contexts ─────────────────────────────────────────────────── */

const contexts = new Map(); // vaultId -> Promise<ctx>
let connSeq = 0;
let execSeq = 0;
let approvalSeq = 0;

async function createStore(vaultId, ownerId) {
  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    const { SupabaseVaultStore } = await import('./store-supabase.mjs');
    return new SupabaseVaultStore({
      url: SUPABASE_URL,
      serviceKey: SUPABASE_SERVICE_KEY,
      vaultKey: VAULT_KEY,
      ownerId,
    }).init();
  }
  const file =
    vaultId === 'default'
      ? process.env.VAULT_DATA || path.join(__dirname, 'data', 'vault.json')
      : path.join(__dirname, 'data', `vault-${vaultId.replace(/[^\w-]/g, '_')}.json`);
  return new VaultStore(file);
}

function readSettings(store) {
  try {
    return JSON.parse(store.get(SETTINGS_PATH)?.content ?? '{}') || {};
  } catch {
    return {};
  }
}

function getContext(vaultId, ownerId = null) {
  if (!contexts.has(vaultId)) {
    contexts.set(
      vaultId,
      (async () => {
        const store = await createStore(vaultId, ownerId);
        seedVault(store);
        migrateVault(store);
        const settingsMode = readSettings(store).mode;
        const ctx = {
          id: vaultId,
          store,
          presence: new PresenceRegistry(),
          sockets: new Set(),
          conns: new Map(), // connId -> { ws, descriptor }
          chatLocks: new Set(),
          pendingApprovals: new Map(), // approvalId -> { resolve, timer }
          pendingExec: new Map(), // execId -> { resolve, reject, timer }
          paused: false, // kill switch: any authed surface can pause the assistant
          mode: MODES.includes(settingsMode) ? settingsMode : 'ask',
          broadcast(message) {
            const payload = JSON.stringify(message);
            for (const s of ctx.sockets) if (s.readyState === s.OPEN) s.send(payload);
          },
        };
        store.on('change', (records) => ctx.broadcast({ type: 'change', records }));
        ctx.presence.on('update', (devices) => ctx.broadcast({ type: 'presence', devices }));
        // The non-model executor: fires due automations, and once a day gives
        // the reflection pass a chance to learn from recent chats.
        startAutomationScheduler(ctx, { onTick: () => maybeReflect(ctx) });
        return ctx;
      })()
    );
  }
  return contexts.get(vaultId);
}

// Resolve the vault context a request/connection is entitled to.
// key mode: the shared vault key -> the single 'default' vault.
// accounts mode: a Supabase Auth access token -> that user's own vault.
async function authenticate(params) {
  if (AUTH_MODE === 'accounts') {
    const user = await verifySupabaseToken(params.get('token'), {
      jwtSecret: SUPABASE_JWT_SECRET,
      supabaseUrl: SUPABASE_URL,
      apiKey: SUPABASE_ANON_KEY || SUPABASE_SERVICE_KEY,
    });
    return getContext(`user-${user.userId}`, user.userId);
  }
  if (params.get('key') !== VAULT_KEY) throw new Error('bad vault key');
  return getContext('default');
}

/* ── permission modes / approvals / remote exec (all per-context) ───────── */

function setAssistantMode(ctx, mode) {
  if (!MODES.includes(mode)) return;
  ctx.mode = mode;
  ctx.store.put({ path: SETTINGS_PATH, type: 'file', content: JSON.stringify({ ...readSettings(ctx.store), mode }) });
  ctx.broadcast({ type: 'mode', mode });
}

// Per-command approval — voice-initiated, screen-confirmed. Before a
// run_command (or an 'ask'-policy connector tool) executes, every active
// surface on this vault gets an approval card; the action runs only after a
// human approves. Deny or 60s of silence rejects it (the model is told).
function requestApproval(ctx, { chatPath, command, cwd, kind = 'command' }) {
  return new Promise((resolve) => {
    const id = `appr-${++approvalSeq}`;
    const timer = setTimeout(() => {
      ctx.pendingApprovals.delete(id);
      ctx.broadcast({ type: 'approval_resolved', id, approved: false });
      resolve(false);
    }, 60_000);
    ctx.pendingApprovals.set(id, { resolve, timer });
    ctx.broadcast({ type: 'approval_request', id, chatPath, command, cwd: cwd ?? null, kind });
  });
}

function resolveApproval(ctx, id, approved) {
  const pending = ctx.pendingApprovals.get(id);
  if (!pending) return;
  ctx.pendingApprovals.delete(id);
  clearTimeout(pending.timer);
  ctx.broadcast({ type: 'approval_resolved', id, approved: Boolean(approved) });
  pending.resolve(Boolean(approved));
}

// Remote tool execution: dispatch a tool call to a connected device that can
// run it (the companion node harness), await its reply over the same socket.
function execRemote(ctx, name, input) {
  const target = [...ctx.conns.entries()].find(([connId, c]) => {
    const live = ctx.presence.devices.get(connId);
    return live?.state === 'active' && (c.descriptor.capabilities || []).includes('exec') && c.ws.readyState === c.ws.OPEN;
  });
  if (!target) return Promise.reject(new Error('No machine is connected to run commands right now.'));
  const [, conn] = target;
  return new Promise((resolve, reject) => {
    const id = `exec-${++execSeq}`;
    const timer = setTimeout(() => {
      ctx.pendingExec.delete(id);
      reject(new Error('Command timed out (no response from the machine).'));
    }, 90_000);
    ctx.pendingExec.set(id, { resolve, reject, timer });
    conn.ws.send(JSON.stringify({ type: 'tool_exec', id, name, input }));
  });
}

/* ── HTTP API ───────────────────────────────────────────────────────────── */

const app = express();
// Native shells (the iOS app) call the API cross-origin. Auth is the gate;
// CORS just lets the request through. Lock it down for a deployment by
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

function httpContext(req) {
  const params = new URLSearchParams();
  if (req.query.key) params.set('key', String(req.query.key));
  if (req.query.token) params.set('token', String(req.query.token));
  return authenticate(params);
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));
// Public bootstrap config: tells the client how to sign in.
app.get('/api/config', (_req, res) =>
  res.json({
    auth: AUTH_MODE,
    supabaseUrl: AUTH_MODE === 'accounts' ? SUPABASE_URL || null : null,
    supabaseAnonKey: AUTH_MODE === 'accounts' ? SUPABASE_ANON_KEY || null : null,
  })
);
app.get('/api/models', async (req, res) => {
  try {
    await httpContext(req);
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }
  res.json({ providers: await listProviders() });
});
app.get('/api/connectors', async (req, res) => {
  let ctx;
  try {
    ctx = await httpContext(req);
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }
  res.json({ connectors: await connectorStatus(ctx.store) });
});
// Connector OAuth, Claude-style: /start discovers the provider's OAuth setup,
// registers Vault as a client, and returns the authorize URL to open; the
// provider redirects back to /callback, which stores the (encrypted) tokens.
app.get('/api/oauth/start', async (req, res) => {
  let ctx;
  try {
    ctx = await httpContext(req);
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  try {
    const url = await startFlow({
      store: ctx.store,
      connectorPath: String(req.query.path || ''),
      redirectUri: `${proto}://${host}/api/oauth/callback`,
    });
    res.json({ url });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.get('/api/oauth/callback', async (req, res) => {
  const page = (title, body) =>
    res.send(
      `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;color:#404040"><div style="text-align:center"><h2 style="font-weight:600">${title}</h2><p style="color:#a3a3a3">${body}</p></div><script>setTimeout(()=>window.close(),1200)</script>`
    );
  try {
    await completeFlow(String(req.query.state || ''), String(req.query.code || ''));
    page('Connected', 'You can close this window.');
  } catch (err) {
    res.status(400);
    page("That didn't work", err.message);
  }
});
app.get('/api/oauth/disconnect', async (req, res) => {
  let ctx;
  try {
    ctx = await httpContext(req);
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    disconnect(ctx.store, String(req.query.path || ''));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
// Export: the whole vault as a zip of plain Markdown — the "your data is just
// files" guarantee, downloadable. Chats and .vault system files included.
app.get('/api/export', async (req, res) => {
  let ctx;
  try {
    ctx = await httpContext(req);
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const files = ctx.store
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

/* ── WebSocket sync + turns ─────────────────────────────────────────────── */

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

wss.on('connection', async (ws, req) => {
  const params = new URL(req.url, 'http://x').searchParams;
  let ctx;
  try {
    ctx = await authenticate(params);
  } catch {
    ws.close(4001, 'unauthorized');
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

  ctx.sockets.add(ws);
  ctx.conns.set(connId, { ws, descriptor });
  ctx.presence.join(connId, descriptor);
  const takeToken = makeRateLimiter();
  ws.send(JSON.stringify({ type: 'hello', presence: ctx.presence.snapshot(), rev: ctx.store.rev, paused: ctx.paused, mode: ctx.mode }));

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
    const { store, presence } = ctx;
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
          resolveApproval(ctx, String(msg.id), Boolean(msg.approved));
          break;
        case 'set_paused':
          ctx.paused = Boolean(msg.paused);
          ctx.broadcast({ type: 'paused', paused: ctx.paused });
          break;
        case 'set_mode':
          setAssistantMode(ctx, String(msg.mode));
          break;
        // Automations view: prompt-window editing (a user-initiated model
        // call that rewrites one automation file), run-now, dismissal
        // bookkeeping, and manual reflection.
        case 'automation_edit': {
          const requestId = String(msg.requestId ?? '');
          try {
            const provider = msg.provider || 'anthropic';
            const { path } = await editAutomationWithModel({
              ctx,
              path: msg.path ? String(msg.path) : null,
              instruction: String(msg.instruction ?? '').slice(0, MAX_TURN_TEXT),
              provider,
              // A machine job with strict validation after it — the cheap
              // tier is indistinguishable here.
              model: utilityModelFor(provider, msg.model || 'claude-opus-4-8'),
            });
            ctx.broadcast({ type: 'automation_edited', requestId, ok: true, path });
          } catch (err) {
            ctx.broadcast({ type: 'automation_edited', requestId, ok: false, error: err.message });
          }
          break;
        }
        case 'automation_run':
          await runAutomation(ctx, String(msg.path ?? ''), { manual: true }).catch((err) =>
            ws.send(JSON.stringify({ type: 'error', error: err.message }))
          );
          break;
        case 'automation_dismiss':
          recordDismissal(store, String(msg.name ?? ''));
          break;
        case 'reflect_now': {
          const result = await runReflection(ctx).catch((err) => ({ skipped: err.message }));
          ctx.broadcast({ type: 'reflect_done', ...result });
          break;
        }
        case 'tool_exec_result': {
          const pending = ctx.pendingExec.get(msg.id);
          if (pending) {
            ctx.pendingExec.delete(msg.id);
            clearTimeout(pending.timer);
            if (msg.ok) pending.resolve(String(msg.output ?? ''));
            else pending.reject(new Error(String(msg.output || 'command failed')));
          }
          break;
        }
        case 'turn': {
          if (ctx.paused) {
            ws.send(JSON.stringify({ type: 'turn_error', chatPath: msg.chatPath, error: 'The assistant is paused. Resume it from the Devices panel.' }));
            break;
          }
          if (ctx.chatLocks.has(msg.chatPath)) {
            ws.send(JSON.stringify({ type: 'turn_error', chatPath: msg.chatPath, error: 'A turn is already running in this chat.' }));
            break;
          }
          ctx.chatLocks.add(msg.chatPath);
          try {
            await runTurn({
              store,
              presence,
              chatPath: msg.chatPath,
              text: String(msg.text ?? '').slice(0, MAX_TURN_TEXT),
              deviceType: descriptor.deviceType,
              provider: msg.provider || 'anthropic',
              model: msg.model || 'claude-opus-4-8',
              broadcast: ctx.broadcast,
              execRemote: async (name, input) => {
                if (ctx.mode === 'readonly') {
                  throw new Error('Commands are off in Read-only mode. The user can change the mode in Settings.');
                }
                if (ctx.mode !== 'auto') {
                  const approved = await requestApproval(ctx, {
                    chatPath: msg.chatPath,
                    command: String(input?.command ?? ''),
                    cwd: input?.cwd,
                  });
                  if (!approved) throw new Error('The user declined to run that command.');
                }
                return execRemote(ctx, name, input);
              },
              // Per-connector 'ask' policy routes through the same approval
              // cards; the vault-wide Auto mode trusts everything.
              approveConnector: async ({ connectorName, toolName }) => {
                if (ctx.mode === 'auto') return true;
                return requestApproval(ctx, {
                  chatPath: msg.chatPath,
                  kind: 'connector',
                  command: `${connectorName}: ${toolName}`,
                });
              },
              // Saving an automation is a standing change (it will keep
              // acting later, unattended) — always screen-confirmed unless
              // the vault-wide Auto mode trusts everything.
              approveAutomation: async ({ name, schedule }) => {
                if (ctx.mode === 'auto') return true;
                return requestApproval(ctx, {
                  chatPath: msg.chatPath,
                  kind: 'automation',
                  command: `${name} — ${schedule}`,
                });
              },
            });
          } finally {
            ctx.chatLocks.delete(msg.chatPath);
          }
          break;
        }
      }
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', error: err.message }));
    }
  });

  ws.on('close', () => {
    ctx.sockets.delete(ws);
    ctx.conns.delete(connId);
    ctx.presence.leave(connId);
  });
});

// In key mode, warm the single vault at boot (same behavior as before);
// account vaults spin up lazily on first sign-in.
if (AUTH_MODE === 'key') await getContext('default');

server.listen(PORT, () => {
  console.log(`vault server on :${PORT} (auth: ${AUTH_MODE}${AUTH_MODE === 'key' ? `, vault key: ${VAULT_KEY}` : ''})`);
});
