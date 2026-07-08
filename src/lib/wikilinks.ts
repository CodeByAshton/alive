import type { VaultRecord } from './types';
import { parseFrontmatter } from '../../shared/frontmatter.mjs';

const LINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;

export function extractLinks(content: string): string[] {
  const links: string[] = [];
  for (const match of content.matchAll(LINK_RE)) {
    links.push(match[1].trim());
  }
  return links;
}

export function basename(path: string): string {
  return path.split('/').pop()!.replace(/\.md$/, '');
}

export function resolveLink(records: Map<string, VaultRecord>, name: string): string | null {
  const target = name.toLowerCase().replace(/\.md$/, '');
  for (const rec of records.values()) {
    if (rec.type !== 'file') continue;
    if (rec.path.toLowerCase().replace(/\.md$/, '') === target) return rec.path;
  }
  for (const rec of records.values()) {
    if (rec.type !== 'file') continue;
    if (basename(rec.path).toLowerCase() === target) return rec.path;
  }
  return null;
}

export interface GraphData {
  nodes: { id: string; label: string; kind: 'note' | 'chat' | 'skill' }[];
  links: { source: string; target: string }[];
}

// Nodes are notes (and chat folders); edges are wikilinks. Links found inside
// chat message files attach to the chat folder node.
export function buildGraph(records: Map<string, VaultRecord>): GraphData {
  const nodes = new Map<string, GraphData['nodes'][0]>();
  const links: GraphData['links'] = [];

  for (const rec of records.values()) {
    if (rec.path.startsWith('.')) continue;
    if (rec.type === 'file' && rec.path.endsWith('.md') && !rec.path.startsWith('chats/')) {
      nodes.set(rec.path, { id: rec.path, label: basename(rec.path), kind: 'note' });
    }
    if (rec.type === 'folder' && /^chats\/[^/]+$/.test(rec.path)) {
      nodes.set(rec.path, { id: rec.path, label: rec.path.slice(6), kind: 'chat' });
    }
  }

  const seen = new Set<string>();
  for (const rec of records.values()) {
    if (rec.type !== 'file' || !rec.path.endsWith('.md')) continue;
    const inChat = rec.path.startsWith('chats/');
    const sourceId = inChat ? rec.path.split('/').slice(0, 2).join('/') : rec.path;
    if (!nodes.has(sourceId)) continue;
    const { body } = parseFrontmatter(rec.content);
    for (const name of extractLinks(body)) {
      const target = resolveLink(records, name);
      if (!target || !nodes.has(target) || target === sourceId) continue;
      const key = `${sourceId}->${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ source: sourceId, target });
    }
  }

  return { nodes: [...nodes.values()], links };
}
