// Connectors: MCP servers declared as records under .vault/connectors/.
// Enabled connectors contribute their tools to the assistant automatically.

import { parseFrontmatter, serializeFrontmatter } from '../../shared/frontmatter.mjs';
import { putRecord } from './sync';
import { getServerConfig } from './config';
import { getVaultKey } from './device';
import type { VaultRecord } from './types';

export interface Connector {
  path: string;
  name: string;
  url: string;
  token: string;
  enabled: boolean;
}

export interface ConnectorStatus {
  path: string;
  name: string;
  enabled: boolean;
  ok: boolean;
  tools: string[];
  error: string | null;
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
  const res = await fetch(`${server.httpBase}/api/connectors?key=${encodeURIComponent(getVaultKey())}`);
  if (!res.ok) throw new Error(`status ${res.status}`);
  return (await res.json()).connectors ?? [];
}
