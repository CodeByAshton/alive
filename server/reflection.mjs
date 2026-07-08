// Reflection: the learning loop. Once a day (or on demand), one focused model
// call reads the user's recent chat turns, distills durable observations into
// .vault/memory/observations.md, and — when it spots a repeated intent that a
// script could handle — writes a *proposed* automation (disabled, status:
// proposed) for the user to approve in the Automations view. Nothing here
// acts silently: memory is a visible, editable file, and proposals wait for
// an explicit approve.

import { parseFrontmatter } from '../shared/frontmatter.mjs';
import { getEngine } from './engines/index.mjs';
import {
  AUTOMATION_DOC,
  automationPathFor,
  listAutomations,
  recordNotification,
  serializeAutomation,
  validateAutomation,
} from './automations.mjs';

export const MEMORY_FILE = '.vault/memory/observations.md';
const STATE_FILE = '.vault/memory/reflection.json';
const REFLECT_EVERY_MS = 24 * 60 * 60 * 1000;
const MAX_TRANSCRIPT_CHARS = 30_000;
const MAX_MEMORY_CHARS = 24_000;

function readState(store) {
  try {
    return JSON.parse(store.get(STATE_FILE)?.content ?? '{}') || {};
  } catch {
    return {};
  }
}

function writeState(store, state) {
  store.put({ path: STATE_FILE, type: 'file', content: JSON.stringify(state) });
}

export function recordDismissal(store, name) {
  const state = readState(store);
  state.dismissed = [...new Set([...(state.dismissed || []), String(name)])].slice(-50);
  writeState(store, state);
}

export function appendMemory(store, note) {
  const stamp = new Date().toISOString().slice(0, 10);
  const existing = store.get(MEMORY_FILE);
  const header = '# Observations\n\nWhat the assistant has learned about you — durable preferences, repeated asks, context. It reads this every turn. Edit or delete anything freely.\n';
  let content = (existing?.content || header).replace(/\n?$/, '\n') + `- (${stamp}) ${String(note).replace(/\n/g, ' ').trim()}\n`;
  if (content.length > MAX_MEMORY_CHARS) {
    // Trim oldest bullets, never the header.
    const lines = content.split('\n');
    const firstBullet = lines.findIndex((l) => l.startsWith('- '));
    while (content.length > MAX_MEMORY_CHARS && lines.length > firstBullet + 1) {
      lines.splice(firstBullet, 1);
      content = lines.join('\n');
    }
  }
  store.put({ path: MEMORY_FILE, type: 'file', content });
}

// Which engine reflects: Anthropic when a key is present (cheap model by
// default), the mock engine when it's enabled (tests/demos), else skip.
function pickReflectionEngine() {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
    return { provider: 'anthropic', model: process.env.VAULT_REFLECTION_MODEL || 'claude-haiku-4-5' };
  }
  if (process.env.VAULT_ENABLE_MOCK === '1') return { provider: 'mock', model: 'mock-1' };
  return null;
}

// Recent user turns across all chats, newest last, char-capped. User turns
// are where repeated intents live; assistant replies are mostly noise here.
function recentUserTurns(store, sinceMs) {
  const turns = store
    .list('chats')
    .filter((r) => r.type === 'file' && /\/\d{4}-user\.md$/.test(r.path) && r.mtime > sinceMs)
    .sort((a, b) => a.mtime - b.mtime)
    .map((r) => {
      const { data, body } = parseFrontmatter(r.content);
      return { at: String(data.timestamp || new Date(r.mtime).toISOString()), text: body.trim() };
    })
    .filter((t) => t.text);
  let total = 0;
  const kept = [];
  for (const t of turns.reverse()) {
    total += t.text.length;
    if (total > MAX_TRANSCRIPT_CHARS) break;
    kept.unshift(t);
  }
  return kept;
}

export async function runReflection(ctx) {
  const choice = pickReflectionEngine();
  if (!choice) return { skipped: 'no model available' };
  const { store } = ctx;
  const state = readState(store);
  const since = state.lastRun ? Date.parse(state.lastRun) : 0;
  const turns = recentUserTurns(store, Number.isFinite(since) ? since : 0);
  writeState(store, { ...state, lastRun: new Date().toISOString() });
  if (!turns.length) return { skipped: 'nothing new to reflect on' };

  const memory = store.get(MEMORY_FILE)?.content ?? '';
  const existingNames = listAutomations(store).map((a) => a.name);
  const dismissed = readState(store).dismissed || [];

  const system = `You are the reflection process of Vault, a personal assistant. You run in the background; the user never sees this conversation. Your job is to learn from the user's recent messages and hand repeated work off to non-model automations.

Return ONLY a JSON object, no other text:
{"observations": ["durable fact or preference worth remembering", ...],
 "automations": [{"name": "...", "description": "one line", "schedule": "daily HH:MM", "about": "one plain-language paragraph explaining what it does", "script": "notify('...');"}, ...]}

Observations: only durable, useful facts (preferences, recurring context, how the user phrases things). Never transient details. Empty array if nothing qualifies.
Automations: ONLY when the user has repeatedly (2+ times) asked for something a deterministic script could do on a schedule — most commonly reminders. These are proposals the user must approve, so be conservative: no duplicates of existing automations, nothing speculative.

${AUTOMATION_DOC}

Existing memory (do not repeat what's already here):
${memory.slice(0, 4000) || '(empty)'}

Existing automations (do not re-propose): ${existingNames.join(', ') || '(none)'}
Previously dismissed proposals (never re-propose): ${dismissed.join(', ') || '(none)'}`;

  const transcript = turns.map((t) => `[${t.at}] ${t.text}`).join('\n');
  const engine = getEngine(choice.provider);
  const result = await engine.run({
    model: choice.model,
    system,
    messages: [{ role: 'user', content: `Recent user messages:\n\n${transcript}` }],
    tools: [],
    effort: 'low', // background job on the cheap tier
    executeTool: async () => 'ok',
    onEvent: () => {},
  });

  let parsed;
  try {
    const raw = result.text.trim().replace(/^```(?:json)?\n?/, '').replace(/```$/, '');
    parsed = JSON.parse(raw);
  } catch {
    return { skipped: 'unparseable reflection output' };
  }

  const observations = (parsed.observations || []).filter((o) => typeof o === 'string' && o.trim()).slice(0, 10);
  for (const note of observations) appendMemory(store, note);

  const proposals = [];
  for (const a of (parsed.automations || []).slice(0, 3)) {
    if (!a || validateAutomation(a)) continue;
    if (existingNames.some((n) => n.toLowerCase() === String(a.name).toLowerCase())) continue;
    if (dismissed.some((n) => n.toLowerCase() === String(a.name).toLowerCase())) continue;
    const path = automationPathFor(store, a.name);
    store.put({
      path,
      type: 'file',
      content: serializeAutomation({
        name: a.name,
        description: a.description || '',
        schedule: a.schedule,
        about: a.about || a.description || '',
        script: a.script,
        enabled: false,
        status: 'proposed',
        createdBy: 'reflection',
      }),
    });
    proposals.push(path);
  }
  if (proposals.length) {
    recordNotification(ctx, {
      title: 'Suggestion',
      message: `I noticed a pattern and drafted ${proposals.length === 1 ? 'an automation' : `${proposals.length} automations`} — review it under Customize → Automations.`,
    });
  }
  return { observations: observations.length, proposals };
}

// Called from the scheduler tick — reflects at most once per day, and only
// when a model is actually available.
export async function maybeReflect(ctx) {
  if (!pickReflectionEngine()) return;
  const state = readState(ctx.store);
  const last = state.lastRun ? Date.parse(state.lastRun) : 0;
  if (Date.now() - last < REFLECT_EVERY_MS) return;
  await runReflection(ctx).catch(() => {});
}
