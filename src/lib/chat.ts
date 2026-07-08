// Chats are folders. Every helper here just reads/writes vault records —
// there is no separate chat database to drift from the vault.

import { parseFrontmatter, serializeFrontmatter } from '../../shared/frontmatter.mjs';
import { putRecord } from './sync';
import type { ChatMessage, VaultRecord } from './types';

export interface ChatInfo {
  path: string;
  title: string;
  mtime: number;
}

export function listChats(records: Map<string, VaultRecord>): ChatInfo[] {
  const chats: ChatInfo[] = [];
  for (const rec of records.values()) {
    if (rec.type !== 'folder' || !/^chats\/[^/]+$/.test(rec.path)) continue;
    let title = rec.path.slice(6);
    let mtime = rec.mtime;
    const index = records.get(`${rec.path}/index.md`);
    if (index) {
      const { data } = parseFrontmatter(index.content);
      if (data.title) title = String(data.title);
    }
    for (const r of records.values()) {
      if (r.path.startsWith(rec.path + '/') && r.mtime > mtime) mtime = r.mtime;
    }
    chats.push({ path: rec.path, title, mtime });
  }
  return chats.sort((a, b) => b.mtime - a.mtime);
}

export function chatMessages(records: Map<string, VaultRecord>, chatPath: string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const rec of records.values()) {
    if (rec.type !== 'file') continue;
    if (!rec.path.startsWith(chatPath + '/')) continue;
    if (!/\/\d{4}-(user|assistant)\.md$/.test(rec.path)) continue;
    const { data, body } = parseFrontmatter(rec.content);
    messages.push({
      path: rec.path,
      role: data.role === 'assistant' ? 'assistant' : 'user',
      body: body.trim(),
      timestamp: data.timestamp,
      device: data.device,
      model: data.model,
      provider: data.provider,
      toolsUsed: Array.isArray(data.tools_used) ? data.tools_used : undefined,
      filesTouched: Array.isArray(data.files_touched) ? data.files_touched.map(String) : undefined,
    });
  }
  return messages.sort((a, b) => (a.path < b.path ? -1 : 1));
}

export interface ChatConfig {
  provider: string;
  model: string;
}

export function getChatConfig(records: Map<string, VaultRecord>, chatPath: string): ChatConfig {
  const index = records.get(`${chatPath}/index.md`);
  if (index) {
    const { data } = parseFrontmatter(index.content);
    if (data.provider && data.model) return { provider: String(data.provider), model: String(data.model) };
  }
  return { provider: 'anthropic', model: 'claude-opus-4-8' };
}

// The model choice is per-chat and synced: it lives in the chat folder's
// index.md, so switching on one device switches everywhere.
export async function setChatConfig(
  records: Map<string, VaultRecord>,
  chatPath: string,
  config: ChatConfig
): Promise<void> {
  const index = records.get(`${chatPath}/index.md`);
  const existing = index ? parseFrontmatter(index.content) : { data: {}, body: '' };
  await putRecord(
    `${chatPath}/index.md`,
    'file',
    serializeFrontmatter({ ...existing.data, provider: config.provider, model: config.model }, existing.body)
  );
}

// Chats are titled via frontmatter in index.md, not by their folder name —
// renaming rewrites the title everywhere without moving any records.
export async function renameChat(
  records: Map<string, VaultRecord>,
  chatPath: string,
  title: string
): Promise<void> {
  const index = records.get(`${chatPath}/index.md`);
  const existing = index ? parseFrontmatter(index.content) : { data: {}, body: '' };
  await putRecord(`${chatPath}/index.md`, 'file', serializeFrontmatter({ ...existing.data, title }, existing.body));
}

export async function createChat(defaults: ChatConfig): Promise<string> {
  const stamp = new Date();
  const title = `Chat ${stamp.toISOString().slice(0, 16).replace('T', ' ')}`;
  const path = `chats/${title.replace(/[:]/g, '-')}`;
  await putRecord(path, 'folder');
  await putRecord(
    `${path}/index.md`,
    'file',
    serializeFrontmatter({ title, provider: defaults.provider, model: defaults.model }, '')
  );
  return path;
}
