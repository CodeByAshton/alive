// Automations live under the hidden .vault/automations/ namespace — managed
// through the Automations view (Customize → Automations). Each one is a
// Markdown file: frontmatter, a plain-language explanation, and a fenced js
// script that a non-model scheduler runs on the server.

import { parseFrontmatter, serializeFrontmatter } from '../../shared/frontmatter.mjs';
import { putRecord } from './sync';
import type { VaultRecord } from './types';

export const AUTOMATIONS_DIR = '.vault/automations';
export const MEMORY_FILE = '.vault/memory/observations.md';

export interface Automation {
  path: string;
  name: string;
  description: string;
  schedule: string;
  enabled: boolean;
  status: 'active' | 'proposed' | 'done';
  createdBy: string;
  lastRun: string | null;
  lastResult: string | null;
  about: string;
  script: string;
}

export function parseAutomationRecord(rec: VaultRecord): Automation {
  const { data, body } = parseFrontmatter(rec.content);
  const scriptMatch = body.match(/```(?:js|javascript)\n([\s\S]*?)```/);
  return {
    path: rec.path,
    name: String(data.name || rec.path.split('/').pop()!.replace(/\.md$/, '')),
    description: String(data.description || ''),
    schedule: String(data.schedule || ''),
    enabled: data.enabled !== false,
    status: data.status === 'proposed' ? 'proposed' : data.status === 'done' ? 'done' : 'active',
    createdBy: String(data.created_by || 'user'),
    lastRun: data.last_run ? String(data.last_run) : null,
    lastResult: data.last_result ? String(data.last_result) : null,
    about: body.replace(/```(?:js|javascript)\n[\s\S]*?```/, '').trim(),
    script: scriptMatch ? scriptMatch[1].trim() : '',
  };
}

export function listAutomations(records: Map<string, VaultRecord>): Automation[] {
  const out: Automation[] = [];
  for (const rec of records.values()) {
    if (rec.type !== 'file' || !rec.path.endsWith('.md') || !rec.path.startsWith(AUTOMATIONS_DIR + '/')) continue;
    out.push(parseAutomationRecord(rec));
  }
  // Suggestions first — they're waiting on the user — then alphabetical.
  return out.sort((a, b) =>
    a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'proposed' ? -1 : 1
  );
}

export async function saveAutomation(a: Automation): Promise<void> {
  await putRecord(
    a.path,
    'file',
    serializeFrontmatter(
      {
        name: a.name,
        description: a.description,
        schedule: a.schedule,
        enabled: a.enabled,
        status: a.status,
        created_by: a.createdBy,
        ...(a.lastRun ? { last_run: a.lastRun } : {}),
        ...(a.lastResult ? { last_result: a.lastResult } : {}),
      },
      `${a.about.trim()}\n\n\`\`\`js\n${a.script.trim()}\n\`\`\`\n`
    )
  );
}

// Approving a suggested automation turns it on; the reflection process wrote
// it disabled with status: proposed.
export async function approveProposal(a: Automation): Promise<void> {
  await saveAutomation({ ...a, enabled: true, status: 'active' });
}

export async function setAutomationEnabled(a: Automation, enabled: boolean): Promise<void> {
  await saveAutomation({ ...a, enabled, ...(a.status === 'done' && enabled ? { status: 'active' as const } : {}) });
}

export function humanSchedule(schedule: string): string {
  const s = schedule.trim();
  let m;
  if ((m = s.match(/^daily (?:at )?(\d{1,2}:\d{2})$/i))) return `Every day at ${m[1]}`;
  if ((m = s.match(/^weekdays (?:at )?(\d{1,2}:\d{2})$/i))) return `Weekdays at ${m[1]}`;
  if ((m = s.match(/^weekly (\w+) (?:at )?(\d{1,2}:\d{2})$/i)))
    return `Every ${m[1].charAt(0).toUpperCase() + m[1].slice(1)} at ${m[2]}`;
  if ((m = s.match(/^every (\d+) (minutes?|hours?)$/i))) return `Every ${m[1]} ${m[2]}`;
  if ((m = s.match(/^once (.+)$/i))) return `Once, on ${m[1]}`;
  return s || 'No schedule';
}

export function timeAgoShort(iso: string): string {
  const s = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
