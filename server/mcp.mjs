// Minimal MCP (Model Context Protocol) client over streamable HTTP — enough
// to initialize a session, list tools, and call them. Connectors declared in
// the vault use this to plug external services into the assistant's toolset.

const sessions = new Map(); // url -> session id
let rpcId = 0;

async function post(url, token, body, sessionId) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`MCP ${res.status}: ${detail.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const newSession = res.headers.get('mcp-session-id');
  const contentType = res.headers.get('content-type') || '';
  let message = null;
  if (contentType.includes('text/event-stream')) {
    const text = await res.text();
    for (const line of text.split('\n')) {
      if (!line.startsWith('data:')) continue;
      try {
        const parsed = JSON.parse(line.slice(5).trim());
        if (parsed.id === body.id) message = parsed;
      } catch {
        /* skip */
      }
    }
  } else if (contentType.includes('application/json')) {
    message = await res.json();
  }
  if (message?.error) throw new Error(message.error.message || 'MCP error');
  return { result: message?.result, sessionId: newSession };
}

async function ensureSession(url, token) {
  if (sessions.has(url)) return sessions.get(url);
  const { result, sessionId } = await post(url, token, {
    jsonrpc: '2.0',
    id: ++rpcId,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'vault', version: '0.1.0' },
    },
  });
  if (!result) throw new Error('MCP initialize failed');
  const sid = sessionId || null;
  // best-effort initialized notification (spec requirement, some servers skip)
  post(url, token, { jsonrpc: '2.0', method: 'notifications/initialized' }, sid).catch(() => {});
  sessions.set(url, sid);
  return sid;
}

async function rpc(url, token, method, params) {
  const sid = await ensureSession(url, token);
  try {
    const { result } = await post(url, token, { jsonrpc: '2.0', id: ++rpcId, method, params }, sid);
    return result;
  } catch (err) {
    sessions.delete(url); // stale session — force re-init next time
    throw err;
  }
}

export async function listTools(url, token) {
  const result = await rpc(url, token, 'tools/list', {});
  return (result?.tools ?? []).map((t) => ({
    name: t.name,
    description: t.description || t.name,
    inputSchema: t.inputSchema || { type: 'object', properties: {} },
  }));
}

export async function callTool(url, token, name, args) {
  const result = await rpc(url, token, 'tools/call', { name, arguments: args ?? {} });
  if (result?.isError) {
    throw new Error(textOf(result) || 'connector tool failed');
  }
  return textOf(result) || JSON.stringify(result ?? {});
}

function textOf(result) {
  return (result?.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}
