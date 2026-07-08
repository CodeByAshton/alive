// Connector OAuth integration test, fully offline: vault server (key mode) +
// mock OAuth-protected MCP server. Exercises discovery, dynamic client
// registration, PKCE code exchange, encrypted token storage, authed tool
// listing, and refresh-on-401. Run: node scripts/test-oauth.mjs

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8898;
const MCP_PORT = 8976;
const KEY = 'vault-dev-key';
const API = `http://localhost:${PORT}/api`;

const results = [];
let failed = false;
function check(name, ok, detail = '') {
  results.push({ name, ok });
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const dataDir = path.join(__dirname, '..', 'server', 'data-test-oauth');
const vault = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.mjs')], {
  env: {
    ...process.env,
    PORT: String(PORT),
    VAULT_KEY: KEY,
    VAULT_DATA: path.join(dataDir, 'vault.json'),
    VAULT_ENABLE_MOCK: '1',
    SUPABASE_URL: '',
    SUPABASE_SERVICE_KEY: '',
  },
  stdio: 'pipe',
});
vault.stderr.on('data', (d) => process.stderr.write(d));
const mcp = spawn(process.execPath, [path.join(__dirname, 'mock-oauth-mcp.mjs')], {
  env: { ...process.env, PORT: String(MCP_PORT) },
  stdio: 'pipe',
});
await wait(1500);

try {
  // Create a connector pointing at the OAuth-protected MCP server.
  const connectorPath = '.vault/connectors/mock-oauth.md';
  const { default: WebSocket } = await import('ws');
  const ws = new WebSocket(`ws://localhost:${PORT}/ws?key=${KEY}&deviceId=test&deviceType=desktop`);
  await new Promise((r) => ws.on('open', r));
  ws.send(
    JSON.stringify({
      type: 'put',
      record: {
        path: connectorPath,
        type: 'file',
        content: `---\nname: MockOAuth\nurl: http://localhost:${MCP_PORT}/mcp\nenabled: true\npolicy: auto\n---\n`,
        mtime: Date.now(),
      },
    })
  );
  await wait(500);

  // 1. Before auth: the connector reports needs-auth (401 from the server).
  let status = (await (await fetch(`${API}/connectors?key=${KEY}`)).json()).connectors.find((c) => c.path === connectorPath);
  check('unauthenticated connector reports needsAuth', status?.needsAuth === true && !status.ok, JSON.stringify(status));

  // 2. Start the flow: discovery + registration + authorize URL.
  const start = await (await fetch(`${API}/oauth/start?path=${encodeURIComponent(connectorPath)}&key=${KEY}`)).json();
  check('oauth start returns an authorize URL', typeof start.url === 'string' && start.url.includes('/authorize'), start.error ?? '');

  // 3. "User approves": follow the authorize redirect to our callback.
  const authorizeRes = await fetch(start.url, { redirect: 'manual' });
  const location = authorizeRes.headers.get('location');
  check('provider redirects back with a code', Boolean(location?.includes('code=')));
  const callbackRes = await fetch(location);
  check('callback completes the exchange', callbackRes.ok, String(callbackRes.status));

  // 4. Authed: tools list, status green, tokens never in plaintext.
  status = (await (await fetch(`${API}/connectors?key=${KEY}`)).json()).connectors.find((c) => c.path === connectorPath);
  check('connector is connected with tools', status?.ok === true && status.authed === true && status.tools.includes('whoami'), JSON.stringify(status));

  const syncWs = new WebSocket(`ws://localhost:${PORT}/ws?key=${KEY}&deviceId=test2&deviceType=desktop`);
  const records = [];
  syncWs.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === 'records') records.push(...(m.records ?? []));
  });
  await new Promise((r) => syncWs.on('open', r));
  syncWs.send(JSON.stringify({ type: 'sync', since: 0 }));
  await wait(500);
  const stored = records.find((r) => r.path === connectorPath)?.content ?? '';
  check('stored tokens are encrypted at rest', stored.includes('enc:v1:') && !stored.includes('at-'), stored.split('\n').find((l) => l.startsWith('oauth'))?.slice(0, 60) ?? '');

  // 5. Refresh-on-401: rotate the provider's access token, call again.
  await fetch(`http://localhost:${MCP_PORT}/rotate`);
  status = (await (await fetch(`${API}/connectors?key=${KEY}`)).json()).connectors.find((c) => c.path === connectorPath);
  check('expired token refreshes transparently', status?.ok === true && status.tools.includes('whoami'), status?.error ?? '');

  // 6. Disconnect revokes the stored authorization.
  await fetch(`${API}/oauth/disconnect?path=${encodeURIComponent(connectorPath)}&key=${KEY}`);
  status = (await (await fetch(`${API}/connectors?key=${KEY}`)).json()).connectors.find((c) => c.path === connectorPath);
  check('disconnect returns the connector to needs-auth', status?.needsAuth === true && status.authed === false, JSON.stringify(status));

  ws.close();
  syncWs.close();
} finally {
  vault.kill();
  mcp.kill();
  const { rmSync } = await import('node:fs');
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} oauth checks passed`);
process.exit(failed ? 1 : 0);
