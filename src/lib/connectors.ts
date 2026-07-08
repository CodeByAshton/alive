// Connectors: MCP servers declared as records under .vault/connectors/.
// Enabled connectors contribute their tools to the assistant automatically.

import { parseFrontmatter, serializeFrontmatter } from '../../shared/frontmatter.mjs';
import { putRecord } from './sync';
import { getServerConfig } from './config';
import { authQuery } from './auth';
import type { VaultRecord } from './types';

export interface Connector {
  path: string;
  name: string;
  url: string;
  token: string;
  enabled: boolean;
  // 'ask' confirms every tool call on-screen; 'auto' marks the connector trusted.
  policy: 'ask' | 'auto';
}

export interface ConnectorStatus {
  path: string;
  name: string;
  enabled: boolean;
  ok: boolean;
  tools: string[];
  error: string | null;
  authed: boolean; // an OAuth authorization is stored server-side
  needsAuth: boolean; // the server answered 401 — connect (again)
}

export function listConnectors(records: Map<string, VaultRecord>): Connector[] {
  const out: Connector[] = [];
  for (const rec of records.values()) {
    if (rec.type !== 'file' || !rec.path.startsWith('.vault/connectors/') || !rec.path.endsWith('.md')) continue;
    const { data } = parseFrontmatter(rec.content);
    out.push({
      path: rec.path,
      name: String(data.name || 'Connector'),
      url: String(data.url || ''),
      token: data.token ? String(data.token) : '',
      enabled: data.enabled !== false,
      policy: data.policy === 'auto' ? 'auto' : 'ask',
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveConnector(connector: Connector): Promise<void> {
  await putRecord(
    connector.path,
    'file',
    serializeFrontmatter(
      {
        name: connector.name,
        url: connector.url,
        ...(connector.token ? { token: connector.token } : {}),
        enabled: connector.enabled,
        policy: connector.policy,
      },
      ''
    )
  );
}

export function newConnectorPath(records: Map<string, VaultRecord>): string {
  let n = 1;
  while (records.has(`.vault/connectors/connector-${n}.md`)) n++;
  return `.vault/connectors/connector-${n}.md`;
}

export async function fetchConnectorStatus(): Promise<ConnectorStatus[]> {
  const server = getServerConfig();
  if (!server) return [];
  const res = await fetch(`${server.httpBase}/api/connectors?${await authQuery()}`);
  if (!res.ok) throw new Error(`status ${res.status}`);
  return (await res.json()).connectors ?? [];
}

// One-click OAuth: ask the server to set up the flow, open the provider's
// consent screen in a popup. The popup lands back on our /callback page and
// closes itself; the caller re-polls status to see the connection go green.
export async function startConnectorAuth(path: string): Promise<string | null> {
  const server = getServerConfig();
  if (!server) return 'Not connected to a server.';
  const res = await fetch(`${server.httpBase}/api/oauth/start?path=${encodeURIComponent(path)}&${await authQuery()}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return json.error ?? `HTTP ${res.status}`;
  window.open(json.url, 'vault-connector-auth', 'width=560,height=720');
  return null;
}

export async function disconnectConnectorAuth(path: string): Promise<void> {
  const server = getServerConfig();
  if (!server) return;
  await fetch(`${server.httpBase}/api/oauth/disconnect?path=${encodeURIComponent(path)}&${await authQuery()}`);
}
