// Connectors: external MCP servers declared as records under
// .vault/connectors/. Enabled connectors contribute their tools to the
// assistant's per-turn toolset (namespaced), executed via the MCP client.
// TODO: trust boundary — connector URLs and tokens are user-supplied; a real
// version needs scoped permissions per connector and an approval step before
// a connector tool can act.

import { parseFrontmatter } from '../shared/frontmatter.mjs';
import { callTool, listTools } from './mcp.mjs';

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
        enabled: data.enabled !== false,
      };
    })
    .filter((c) => c.url);
}

async function toolsFor(connector) {
  const cached = toolCache.get(connector.url);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.tools;
  const tools = await listTools(connector.url, connector.token);
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
      const tools = await toolsFor(connector);
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

export async function executeConnectorTool(store, name, input) {
  const [slug, ...rest] = name.slice(TOOL_PREFIX.length).split('__');
  const toolName = rest.join('__');
  const connector = readConnectors(store).find((c) => c.slug === slug && c.enabled);
  if (!connector) throw new Error(`No enabled connector for ${name}`);
  return callTool(connector.url, connector.token, toolName, input);
}

// Discovery status for the Connectors UI.
export async function connectorStatus(store) {
  const out = [];
  for (const connector of readConnectors(store)) {
    const entry = { path: connector.path, name: connector.name, enabled: connector.enabled, ok: false, tools: [], error: null };
    if (connector.enabled) {
      try {
        toolCache.delete(connector.url); // status check = fresh look
        entry.tools = (await toolsFor(connector)).map((t) => t.name);
        entry.ok = true;
      } catch (err) {
        entry.error = err.message;
      }
    }
    out.push(entry);
  }
  return out;
}
