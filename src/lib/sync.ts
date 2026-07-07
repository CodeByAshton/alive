// SyncProvider: connects this device to the cloud vault over WebSocket.
// - hydrates state from the IndexedDB cache immediately (offline-first)
// - reconciles with the cloud by rev cursor on (re)connect
// - writes go cache-first, then to the cloud via a durable outbox
// - relays presence and live turn events
// The wire protocol is the swappable seam: a Supabase implementation would
// replace this file (Realtime for changes, Presence for the registry).

import { db, getLastRev, loadCachedRecords, setLastRev } from './db';
import { useVault } from './store';
import type { VaultRecord } from './types';
import { getCapabilities, getDeviceId, getSurface, getVaultKey } from './device';

let ws: WebSocket | null = null;
let started = false;
let backoff = 500;

export const surface = getSurface();
const deviceId = getDeviceId(surface);
const vaultKey = getVaultKey();

export async function startSync(): Promise<void> {
  if (started) return;
  started = true;

  const cached = await loadCachedRecords();
  useVault.getState().applyRecords(cached.filter((r) => !r.deleted));
  useVault.getState().setHydrated();

  fetch(`/api/models?key=${encodeURIComponent(vaultKey)}`)
    .then((r) => r.json())
    .then((json) => useVault.getState().setProviders(json.providers ?? []))
    .catch(() => {});

  connect();

  document.addEventListener('visibilitychange', () => {
    send({ type: 'presence_state', state: document.hidden ? 'background' : 'active' });
  });
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const params = new URLSearchParams({
    key: vaultKey,
    deviceId,
    deviceType: surface,
    caps: getCapabilities(surface).join(','),
  });
  ws = new WebSocket(`${proto}://${location.host}/ws?${params}`);

  ws.onopen = async () => {
    backoff = 500;
    useVault.getState().setConnected(true);
    send({ type: 'sync', since: await getLastRev() });
    // Flush queued offline writes.
    const pending = await db.outbox.toArray();
    for (const item of pending) {
      send(item.op as never);
      await db.outbox.delete(item.id!);
    }
  };

  ws.onmessage = async (event) => {
    const msg = JSON.parse(event.data);
    const state = useVault.getState();
    switch (msg.type) {
      case 'hello':
        state.setPresence(msg.presence);
        break;
      case 'presence':
        state.setPresence(msg.devices);
        break;
      case 'records':
      case 'change': {
        const records: VaultRecord[] = msg.records ?? [];
        if (!records.length) break;
        state.applyRecords(records);
        await db.records.bulkPut(records);
        const maxRev = Math.max(...records.map((r) => r.rev), await getLastRev());
        await setLastRev(maxRev);
        break;
      }
      case 'turn_started':
        state.updateStream(msg.chatPath, () => ({ active: true, text: '', tools: [] }));
        break;
      case 'turn_delta':
        state.updateStream(msg.chatPath, (s) => ({ ...s, active: true, text: s.text + msg.text }));
        break;
      case 'turn_tool':
        state.updateStream(msg.chatPath, (s) => {
          const tools = [...s.tools];
          const idx = tools.findLastIndex((t) => t.name === msg.name && t.status === 'running');
          if (msg.status === 'running' || idx === -1) tools.push({ name: msg.name, status: msg.status });
          else tools[idx] = { name: msg.name, status: msg.status };
          return { ...s, tools };
        });
        break;
      case 'turn_done':
        state.clearStream(msg.chatPath);
        notifyTurnDone(msg.chatPath);
        break;
      case 'turn_error':
        state.updateStream(msg.chatPath, (s) => ({ ...s, active: false, error: msg.error }));
        break;
    }
  };

  ws.onclose = () => {
    useVault.getState().setConnected(false);
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 10_000);
  };
  ws.onerror = () => ws?.close();
}

function send(op: Record<string, unknown>) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(op));
    return true;
  }
  return false;
}

async function sendOrQueue(op: Record<string, unknown>) {
  if (!send(op)) await db.outbox.add({ op });
}

// ---- public write API (cache-first, then cloud) ----

export async function putRecord(path: string, type: 'file' | 'folder', content = ''): Promise<void> {
  const mtime = Date.now();
  const existing = useVault.getState().records.get(path);
  const rec: VaultRecord = {
    path,
    type,
    content,
    ctime: existing?.ctime ?? mtime,
    mtime,
    deleted: false,
    rev: 0, // optimistic; server echo assigns the real rev
  };
  useVault.getState().applyRecords([rec]);
  await db.records.put(rec);
  await sendOrQueue({ type: 'put', record: { path, type, content, mtime } });
}

export async function deletePath(path: string): Promise<void> {
  const mtime = Date.now();
  const state = useVault.getState();
  const doomed = [...state.records.values()].filter((r) => r.path === path || r.path.startsWith(path + '/'));
  state.applyRecords(doomed.map((r) => ({ ...r, deleted: true, mtime, rev: 0 })));
  await db.records.bulkDelete(doomed.map((r) => r.path));
  await sendOrQueue({ type: 'delete', path, mtime });
}

export async function movePath(from: string, to: string): Promise<void> {
  // Optimism is cheap here; the authoritative subtree move happens server-side
  // and the echoed change records reconcile the cache.
  await sendOrQueue({ type: 'move', from, to });
}

export function sendTurn(chatPath: string, text: string, provider: string, model: string): void {
  useVault.getState().updateStream(chatPath, () => ({ active: true, text: '', tools: [] }));
  send({ type: 'turn', chatPath, text, provider, model });
}

// Voice (TTS) hook — the phone surface subscribes to completed turns.
type TurnListener = (chatPath: string) => void;
const turnListeners = new Set<TurnListener>();
export function onTurnDone(fn: TurnListener): () => void {
  turnListeners.add(fn);
  return () => turnListeners.delete(fn);
}
function notifyTurnDone(chatPath: string) {
  for (const fn of turnListeners) fn(chatPath);
}
