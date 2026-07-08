// Plugin framework. Plugins are built-in features behind a toggle — the
// classic Obsidian set, re-imagined for this vault. The enabled set lives in
// the synced settings record, so flipping a switch applies on every device.
// Feature code asks `usePlugin('backlinks')` and renders (or not).

import { useMemo } from 'react';
import { parseFrontmatter } from '../../shared/frontmatter.mjs';
import { getSettings, updateSettings } from './settings';
import { putRecord } from './sync';
import { useVault } from './store';
import { basename, extractLinks, resolveLink } from './wikilinks';
import type { VaultRecord } from './types';

export interface PluginDef {
  id: string;
  name: string;
  description: string;
}

export const PLUGINS: PluginDef[] = [
  {
    id: 'backlinks',
    name: 'Backlinks',
    description: 'Linked mentions — every note that links to the one you are reading, listed at the bottom of the page.',
  },
  {
    id: 'outline',
    name: 'Outline',
    description: 'A table of contents beside the open note. Click a heading to jump straight to it.',
  },
  {
    id: 'word-count',
    name: 'Word count',
    description: 'Live words, characters, and reading time for the open note, right in the header.',
  },
  {
    id: 'daily-notes',
    name: 'Daily notes',
    description: 'One note per day under journal/daily/ — jump to (or create) today’s from the sidebar.',
  },
  {
    id: 'templates',
    name: 'Templates',
    description:
      'Stamp out new notes from boilerplates kept in templates/. Supports {{title}}, {{date}} and {{time}}.',
  },
];

// All plugins ship enabled; the settings record stores the enabled set once
// the user makes an explicit choice.
export function enabledPlugins(records: Map<string, VaultRecord>): Set<string> {
  const settings = getSettings(records);
  return new Set(settings.plugins ?? PLUGINS.map((p) => p.id));
}

export async function setPluginEnabled(
  records: Map<string, VaultRecord>,
  id: string,
  on: boolean
): Promise<void> {
  const enabled = enabledPlugins(records);
  if (on) enabled.add(id);
  else enabled.delete(id);
  await updateSettings(records, { plugins: PLUGINS.map((p) => p.id).filter((p) => enabled.has(p)) });
}

export function usePlugin(id: string): boolean {
  const records = useVault((s) => s.records);
  return useMemo(() => enabledPlugins(records).has(id), [records, id]);
}

/* ── daily notes ──────────────────────────────────────────────────────── */

function localDateStamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dailyNotePath(d = new Date()): string {
  return `journal/daily/${localDateStamp(d)}.md`;
}

export async function openDailyNote(records: Map<string, VaultRecord>): Promise<void> {
  const path = dailyNotePath();
  const exists = records.has(path);
  if (!exists) {
    const pretty = new Date().toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    await putRecord(path, 'file', `# ${pretty}\n\n`);
  }
  useVault.getState().openFile(path, exists ? 'read' : 'edit');
}

/* ── templates ────────────────────────────────────────────────────────── */

export interface Template {
  path: string;
  name: string;
}

export function listTemplates(records: Map<string, VaultRecord>): Template[] {
  return [...records.values()]
    .filter((r) => r.type === 'file' && r.path.endsWith('.md') && r.path.startsWith('templates/'))
    .map((r) => ({ path: r.path, name: basename(r.path) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createFromTemplate(
  records: Map<string, VaultRecord>,
  templatePath: string,
  destFolder: string,
  title: string
): Promise<string> {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const content = (records.get(templatePath)?.content ?? '')
    .replaceAll('{{title}}', title)
    .replaceAll('{{date}}', localDateStamp(now))
    .replaceAll('{{time}}', `${pad(now.getHours())}:${pad(now.getMinutes())}`);
  const path = `${destFolder ? destFolder + '/' : ''}${title.replace(/\.md$/, '')}.md`;
  await putRecord(path, 'file', content || `# ${title}\n`);
  return path;
}

/* ── backlinks ────────────────────────────────────────────────────────── */

export interface Backlink {
  path: string;
  title: string;
  snippet: string;
}

export function findBacklinks(records: Map<string, VaultRecord>, path: string): Backlink[] {
  const out: Backlink[] = [];
  for (const rec of records.values()) {
    if (rec.type !== 'file' || !rec.path.endsWith('.md')) continue;
    if (rec.path === path || rec.path.startsWith('.') || rec.path.startsWith('chats/')) continue;
    const { body } = parseFrontmatter(rec.content);
    for (const link of extractLinks(body)) {
      if (resolveLink(records, link) !== path) continue;
      const line = body.split('\n').find((l) => l.includes(`[[${link}`)) ?? '';
      out.push({
        path: rec.path,
        title: basename(rec.path),
        snippet: line.trim().replace(/^#+\s*/, '').slice(0, 140),
      });
      break;
    }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

/* ── outline ──────────────────────────────────────────────────────────── */

export interface OutlineHeading {
  level: number;
  text: string;
}

export function extractOutline(body: string): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  let inFence = false;
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = line.match(/^(#{1,3})\s+(.+)$/);
    if (m) headings.push({ level: m[1].length, text: m[2].replace(/\[\[([^\]|]+)(\|[^\]]*)?\]\]/g, '$1').trim() });
  }
  return headings;
}

/* ── word count ───────────────────────────────────────────────────────── */

export function wordStats(body: string): { words: number; chars: number; minutes: number } {
  const text = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`[\]()-]/g, ' ')
    .trim();
  const words = text ? text.split(/\s+/).length : 0;
  return { words, chars: body.length, minutes: Math.max(1, Math.round(words / 220)) };
}
