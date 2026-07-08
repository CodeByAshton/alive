// Token-optimization routing tests, fully offline: the effort classifier,
// the conversation cache-breakpoint builder, utility-model resolution for
// machine jobs, and effort provenance flowing through a real turn (mock
// engine). Run: node scripts/test-routing.mjs

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyEffort } from '../server/harness.mjs';
import { withCacheBreakpoint } from '../server/engines/anthropic.mjs';
import { utilityModelFor } from '../server/engines/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8901;
const KEY = 'vault-dev-key';

const results = [];
let failed = false;
function check(name, ok, detail = '') {
  results.push({ name, ok });
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── unit: effort classifier ────────────────────────────────────────────── */

{
  check('small talk runs low',
    classifyEffort('hi') === 'low' &&
    classifyEffort('thanks!') === 'low' &&
    classifyEffort('what time is my thing tomorrow?') === 'low');
  check('action verbs run high',
    classifyEffort('create a note about the meeting') === 'high' &&
    classifyEffort('remind me to stretch at 3') === 'high' &&
    classifyEffort('can you organize my notes folder') === 'high');
  check('references, code, and multiline run high',
    classifyEffort('what does [[Ideas]] say') === 'high' &&
    classifyEffort('why does this fail\n```js\nx()\n```') === 'high' &&
    classifyEffort('check @notes/Ideas.md') === 'high');
  check('long messages run high', classifyEffort('a'.repeat(200)) === 'high');
  check('skill turns always run high', classifyEffort('hi', { skill: { name: 'Journal' } }) === 'high');
}

/* ── unit: conversation cache breakpoint ────────────────────────────────── */

{
  const msgs = [
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'reply' },
    { role: 'user', content: 'second' },
  ];
  const marked = withCacheBreakpoint(msgs);
  const lastBlocks = marked[2].content;
  check('marks only the last block of the last user message',
    Array.isArray(lastBlocks) &&
    lastBlocks[0].cache_control?.type === 'ephemeral' &&
    typeof marked[0].content === 'string' &&
    typeof marked[1].content === 'string');
  check('source messages are not mutated', typeof msgs[2].content === 'string');

  const toolTurn = [
    { role: 'user', content: 'go' },
    { role: 'assistant', content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 't1', name: 'x', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'done' }] },
  ];
  const markedTool = withCacheBreakpoint(toolTurn);
  check('tool-result turns get the marker on the result block',
    markedTool[2].content[0].cache_control?.type === 'ephemeral' &&
    toolTurn[2].content[0].cache_control === undefined);

  const pausedTurn = [
    { role: 'user', content: 'go' },
    { role: 'assistant', content: [{ type: 'thinking', thinking: '' }] },
  ];
  check('assistant-last (pause_turn resume) is left unmarked',
    withCacheBreakpoint(pausedTurn) === pausedTurn);
  check('empty message list is a no-op', withCacheBreakpoint([]).length === 0);
}

/* ── unit: utility-model resolution for machine jobs ────────────────────── */

{
  check('anthropic machine jobs run on the cheap tier',
    utilityModelFor('anthropic', 'claude-opus-4-8') === (process.env.VAULT_UTILITY_MODEL || 'claude-haiku-4-5'));
  check('other providers keep the requested model',
    utilityModelFor('mock', 'mock-1') === 'mock-1' &&
    utilityModelFor('openai', 'gpt-5') === 'gpt-5');
}

/* ── server: effort provenance on real turns (mock engine) ──────────────── */

const dataDir = path.join(__dirname, '..', 'server', 'data-test-routing');
const vault = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.mjs')], {
  env: {
    ...process.env,
    PORT: String(PORT),
    VAULT_KEY: KEY,
    VAULT_DATA: path.join(dataDir, 'vault.json'),
    VAULT_ENABLE_MOCK: '1',
    SUPABASE_URL: '',
    SUPABASE_SERVICE_KEY: '',
  },
  stdio: 'pipe',
});
vault.stderr.on('data', (d) => process.stderr.write(d));
await wait(1200);

try {
  const { default: WebSocket } = await import('ws');
  const ws = new WebSocket(`ws://localhost:${PORT}/ws?key=${KEY}&deviceId=test&deviceType=desktop`);
  const inbox = [];
  const records = new Map();
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    inbox.push(m);
    if (m.type === 'records' || m.type === 'change') for (const r of m.records ?? []) records.set(r.path, r);
  });
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'sync', since: 0 }));
  const send = (op) => ws.send(JSON.stringify(op));
  const waitFor = async (pred, ms = 8000) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const hit = inbox.find(pred);
      if (hit) return hit;
      await wait(50);
    }
    return null;
  };
  const turn = async (text) => {
    inbox.length = 0;
    send({ type: 'turn', chatPath: 'chats/test', text, provider: 'mock', model: 'mock-1' });
    await waitFor((m) => m.type === 'turn_done');
    await wait(200);
    const reply = [...records.values()]
      .filter((r) => /chats\/test\/\d{4}-assistant\.md$/.test(r.path))
      .sort((a, b) => (a.path < b.path ? -1 : 1))
      .pop();
    return reply?.content ?? '';
  };

  send({ type: 'put', record: { path: 'chats/test/index.md', type: 'file', content: '---\ntitle: Test\n---\n', mtime: Date.now() } });
  await wait(200);

  check('conversational turn is stamped effort: low', /effort: low/.test(await turn('hello there')));
  check('working turn is stamped effort: high', /effort: high/.test(await turn('create a note called Routing Probe')));

  ws.close();
} finally {
  vault.kill();
  const { rmSync } = await import('node:fs');
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} routing checks passed`);
process.exit(failed ? 1 : 0);
