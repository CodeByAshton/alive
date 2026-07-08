// Connectors: external MCP servers declared as records under
// .vault/connectors/. Enabled connectors contribute their tools to the
// assistant's per-turn toolset (namespaced), executed via the MCP client.
// Each connector carries a permission policy: 'ask' (default) confirms every
// tool call on-screen before it runs; 'auto' marks the connector trusted.
// The vault's global Auto mode also bypasses asks, consistent with commands.
// TODO: trust boundary — tokens are stored in vault records; encrypt at rest.

import { parseFrontmatter } from '../shared/frontmatter.mjs';
import { callTool, listTools } from './mcp.mjs';
import { readTokens, refreshTokens } from './oauth.mjs';

const TOOL_PREFIX = 'c_';
const toolCache = new Map(); // url -> { tools, at }
const CACHE_TTL = 60_000;

export function readConnectors(store) {
  return store
    .list('.vault/connectors')
    .filter((r) => r.type === 'file' && r.path.endsWith('.md'))
    .map((rec) => {
      const { data } = parseFrontmatter(rec.content);
      return {
        path: rec.path,
        slug: rec.path.split('/').pop().replace(/\.md$/, ''),
        name: String(data.name || 'Connector'),
        url: String(data.url || ''),
        token: data.token ? String(data.token) : '',
        oauth: data.oauth ? String(data.oauth) : '', // encrypted token set
        enabled: data.enabled !== false,
        policy: data.policy === 'auto' ? 'auto' : 'ask',
      };
    })
    .filter((c) => c.url);
}

// The bearer credential for a connector call: a live OAuth access token
// (refreshed just-in-time) when the connector is authorized, else the
// user-pasted static token.
async function resolveBearer(store, connector) {
  let tokens = readTokens(connector.oauth);
  if (!tokens) return connector.token;
  if (tokens.expires_at && tokens.expires_at - Date.now() < 60_000) {
    try {
      tokens = (await refreshTokens(store, connector.path, tokens)) ?? tokens;
    } catch {
      /* fall through with the stale token; a 401 will surface as needs-auth */
    }
  }
  return tokens.access_token;
}

// Run an MCP operation with auth: on a 401, try one refresh-and-retry before
// giving up (expired access token with a still-good refresh token).
async function withAuth(store, connector, op) {
  const bearer = await resolveBearer(store, connector);
  try {
    return await op(bearer);
  } catch (err) {
    if (err.status === 401 && connector.oauth) {
      const tokens = readTokens(connector.oauth);
      const refreshed = tokens ? await refreshTokens(store, connector.path, tokens).catch(() => null) : null;
      if (refreshed) return op(refreshed.access_token);
    }
    throw err;
  }
}

async function toolsFor(store, connector) {
  const cached = toolCache.get(connector.url);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.tools;
  const tools = await withAuth(store, connector, (bearer) => listTools(connector.url, bearer));
  toolCache.set(connector.url, { tools, at: Date.now() });
  return tools;
}

function namespaced(connector, toolName) {
  return `${TOOL_PREFIX}${connector.slug}__${toolName}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

// Tool defs for every enabled, reachable connector. Unreachable connectors
// are skipped for the turn rather than failing it.
export async function connectorToolDefs(store) {
  const defs = [];
  for (const connector of readConnectors(store)) {
    if (!connector.enabled) continue;
    try {
      const tools = await toolsFor(store, connector);
      for (const tool of tools) {
        defs.push({
          name: namespaced(connector, tool.name),
          description: `[${connector.name}] ${tool.description}`.slice(0, 1024),
          input_schema: tool.inputSchema,
        });
      }
    } catch {
      /* connector offline — skip this turn */
    }
  }
  return defs;
}

export function isConnectorTool(name) {
  return name.startsWith(TOOL_PREFIX) && name.includes('__');
}

export async function executeConnectorTool(store, name, input, approve) {
  const [slug, ...rest] = name.slice(TOOL_PREFIX.length).split('__');
  const toolName = rest.join('__');
  const connector = readConnectors(store).find((c) => c.slug === slug && c.enabled);
  if (!connector) throw new Error(`No enabled connector for ${name}`);
  if (connector.policy === 'ask' && approve) {
    const ok = await approve({ connectorName: connector.name, toolName, input });
    if (!ok) throw new Error(`The user declined the ${connector.name} action.`);
  }
  return withAuth(store, connector, (bearer) => callTool(connector.url, bearer, toolName, input));
}

// Discovery status for the Connectors UI.
export async function connectorStatus(store) {
  const out = [];
  for (const connector of readConnectors(store)) {
    const entry = {
      path: connector.path,
      name: connector.name,
      enabled: connector.enabled,
      ok: false,
      tools: [],
      error: null,
      authed: Boolean(connector.oauth), // an OAuth authorization is stored
      needsAuth: false, // the server answered 401 — Connect (again)
    };
    if (connector.enabled) {
      try {
        toolCache.delete(connector.url); // status check = fresh look
        entry.tools = (await toolsFor(store, connector)).map((t) => t.name);
        entry.ok = true;
      } catch (err) {
        entry.error = err.message;
        entry.needsAuth = err.status === 401;
      }
    }
    out.push(entry);
  }
  return out;
}
