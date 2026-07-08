// Custom-learning integration test, fully offline (mock engine): schedule
// parsing, the script sandbox, the non-model scheduler, the prompt-window
// edit flow, approval-gated save_automation, save_memory + memory-in-context,
// and the reflection pass proposing automations from repeated asks.
// Run: node scripts/test-automations.mjs

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isDue,
  nextOccurrence,
  nextOccurrences,
  parseSchedule,
  runScript,
  validateAutomation,
} from '../server/automations.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8899;
const KEY = 'vault-dev-key';

const results = [];
let failed = false;
function check(name, ok, detail = '') {
  results.push({ name, ok });
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── unit: schedule grammar ─────────────────────────────────────────────── */

{
  check('parses the schedule grammar',
    parseSchedule('daily 09:00')?.kind === 'daily' &&
    parseSchedule('weekdays 8:30')?.kind === 'weekdays' &&
    parseSchedule('weekly mon 18:00')?.day === 1 &&
    parseSchedule('every 15 minutes')?.n === 15 &&
    parseSchedule('every 2 hours')?.kind === 'hours' &&
    parseSchedule('once 2026-07-09 14:00')?.kind === 'once' &&
    parseSchedule('whenever') === null);

  // 2026-07-08 08:59 UTC -> 09:01 UTC crosses daily 09:00 (UTC).
  const t = Date.UTC(2026, 6, 8, 9, 0, 30);
  check('daily schedule fires when the minute is crossed',
    isDue(parseSchedule('daily 09:00'), t - 90_000, t, 'UTC') === true &&
    isDue(parseSchedule('daily 09:00'), t + 60_000, t + 120_000, 'UTC') === false);
  check('every-N-minutes fires on the boundary',
    isDue(parseSchedule('every 5 minutes'), t - 5 * 60_000, t, 'UTC') === true);
  check('once fires exactly once at its minute',
    isDue(parseSchedule('once 2026-07-08 09:00'), t - 120_000, t, 'UTC') === true &&
    isDue(parseSchedule('once 2026-07-08 09:00'), Date.UTC(2026, 6, 9, 8, 0), Date.UTC(2026, 6, 9, 10, 0), 'UTC') === false);
  check('a long outage collapses into one late firing',
    isDue(parseSchedule('daily 09:00'), t - 3 * 24 * 60 * 60 * 1000, t, 'UTC') === true);
  check('validateAutomation rejects bad schedules',
    validateAutomation({ name: 'x', schedule: 'sometimes', script: 'notify("hi")' }) !== null &&
    validateAutomation({ name: 'x', schedule: 'daily 09:00', script: 'notify("hi")' }) === null);

  // nextOccurrence(s) — what the phone uses to mirror reminders into local
  // notifications. 2026-07-08 is a Wednesday.
  check('nextOccurrence: daily rolls to tomorrow after today’s time',
    nextOccurrence(parseSchedule('daily 09:00'), Date.UTC(2026, 6, 8, 9, 0, 30), 'UTC') === Date.UTC(2026, 6, 9, 9, 0));
  check('nextOccurrence: weekly lands on the right weekday',
    nextOccurrence(parseSchedule('weekly mon 18:00'), Date.UTC(2026, 6, 8, 12, 0), 'UTC') === Date.UTC(2026, 6, 13, 18, 0));
  check('nextOccurrence: weekdays skips the weekend',
    nextOccurrence(parseSchedule('weekdays 09:00'), Date.UTC(2026, 6, 10, 10, 0), 'UTC') === Date.UTC(2026, 6, 13, 9, 0));
  check('nextOccurrence: past once returns null',
    nextOccurrence(parseSchedule('once 2026-07-08 09:00'), Date.UTC(2026, 6, 9, 0, 0), 'UTC') === null &&
    nextOccurrence(parseSchedule('once 2026-07-08 09:00'), Date.UTC(2026, 6, 1, 0, 0), 'UTC') === Date.UTC(2026, 6, 8, 9, 0));
  check('nextOccurrences: consecutive interval runs',
    JSON.stringify(nextOccurrences(parseSchedule('every 5 minutes'), Date.UTC(2026, 6, 8, 9, 1), 3, 'UTC')) ===
    JSON.stringify([Date.UTC(2026, 6, 8, 9, 5), Date.UTC(2026, 6, 8, 9, 10), Date.UTC(2026, 6, 8, 9, 15)]));
  check('nextOccurrence: timezone-aware fixed times',
    nextOccurrence(parseSchedule('daily 09:00'), Date.UTC(2026, 6, 8, 12, 0), 'America/Chicago') === Date.UTC(2026, 6, 8, 14, 0));
}

/* ── unit: script sandbox ───────────────────────────────────────────────── */

{
  const sent = [];
  const notes = new Map();
  const api = {
    notify: (m) => sent.push(m),
    fetchUrl: async () => 'page text',
    read: (p) => notes.get(p) ?? null,
    list: () => [...notes.keys()],
    write: (p, c) => notes.set(p, c),
    append: (p, c) => notes.set(p, (notes.get(p) ?? '') + c),
  };
  const r1 = await runScript(`notify('hello'); vault.append('Tasks.md', '- [ ] hydrate\\n'); log('done');`, api);
  check('sandboxed script can notify and touch the vault',
    r1.ok && sent[0] === 'hello' && notes.get('Tasks.md')?.includes('hydrate') && r1.logs.includes('done'),
    JSON.stringify(r1));
  const r2 = await runScript(`await new Promise(r => setTimeout(r, 500));`, api, { timeoutMs: 60 });
  check('runaway scripts hit the timeout', !r2.ok && /timed out/.test(r2.error ?? ''), r2.error);
  const r3 = await runScript(`throw new Error('boom');`, api);
  check('script errors surface as results, not crashes', !r3.ok && /boom/.test(r3.error ?? ''), r3.error);
}

/* ── server: scheduler, edit flow, approvals, memory, reflection ────────── */

const dataDir = path.join(__dirname, '..', 'server', 'data-test-automations');
const vault = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.mjs')], {
  env: {
    ...process.env,
    PORT: String(PORT),
    VAULT_KEY: KEY,
    VAULT_DATA: path.join(dataDir, 'vault.json'),
    VAULT_ENABLE_MOCK: '1',
    VAULT_AUTOMATION_TICK_MS: '300',
    VAULT_TIMEZONE: 'UTC',
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_AUTH_TOKEN: '',
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
  const waitFor = async (pred, ms = 6000) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const hit = inbox.find(pred);
      if (hit) return hit;
      await wait(50);
    }
    return null;
  };

  // 1. Prompt-window flow: plain language in, valid automation file out.
  send({ type: 'automation_edit', requestId: 'e1', path: null, instruction: 'remind me to drink water at 09:00', provider: 'mock', model: 'mock-1' });
  const edited = await waitFor((m) => m.type === 'automation_edited' && m.requestId === 'e1');
  check('prompt-window edit creates an automation file', edited?.ok === true && String(edited.path).startsWith('.vault/automations/'), JSON.stringify(edited));
  await wait(200);
  const file = records.get(edited?.path)?.content ?? '';
  check('created file has schedule, prose, and a script', /schedule: "?daily 09:00"?/.test(file) && file.includes('```js') && /drink water/i.test(file), file.slice(0, 120));

  // 2. Editing it again through the prompt window updates in place.
  send({ type: 'automation_edit', requestId: 'e2', path: edited.path, instruction: 'remind me to drink water at 21:30', provider: 'mock', model: 'mock-1' });
  const edited2 = await waitFor((m) => m.type === 'automation_edited' && m.requestId === 'e2');
  await wait(200);
  check('prompt-window edit updates the same file', edited2?.ok === true && edited2.path === edited.path && /21:30/.test(records.get(edited.path)?.content ?? ''));

  // 3. Scheduler: a due automation fires with no model — notification lands
  // live and in the synced note, and run bookkeeping is written back.
  const duePath = '.vault/automations/ping.md';
  send({
    type: 'put',
    record: {
      path: duePath,
      type: 'file',
      content: `---\nname: Ping\ndescription: test\nschedule: every 1 minutes\nenabled: true\nstatus: active\nlast_run: "${new Date(Date.now() - 3 * 60_000).toISOString()}"\n---\n\nPings.\n\n\`\`\`js\nnotify('ping!');\n\`\`\`\n`,
      mtime: Date.now() - 3 * 60_000,
    },
  });
  const notice = await waitFor((m) => m.type === 'notify' && m.message === 'ping!', 90_000);
  check('scheduler fires a due automation (no model involved)', Boolean(notice), JSON.stringify(notice));
  await wait(400);
  check('notification persists to .vault/notifications.md', (records.get('.vault/notifications.md')?.content ?? '').includes('ping!'));
  check('run bookkeeping written back to the file', /last_run/.test(records.get(duePath)?.content ?? '') && /last_result: ok/.test(records.get(duePath)?.content ?? ''));

  // Turns are matched against a fresh inbox each time — turn_done from an
  // earlier turn must not satisfy a later wait.
  const turn = (text) => {
    inbox.length = 0;
    send({ type: 'turn', chatPath: 'chats/test', text, provider: 'mock', model: 'mock-1' });
  };

  // 4. Chat flow: the model proposes an automation -> approval card -> file.
  send({ type: 'put', record: { path: 'chats/test/index.md', type: 'file', content: '---\ntitle: Test\n---\n', mtime: Date.now() } });
  await wait(100);
  turn('automate: stretch at 15:00');
  const approval = await waitFor((m) => m.type === 'approval_request' && m.kind === 'automation');
  check('save_automation raises an automation approval card', Boolean(approval), JSON.stringify(approval));
  send({ type: 'approval_response', id: approval?.id, approved: true });
  await waitFor((m) => m.type === 'turn_done');
  await wait(200);
  const stretch = [...records.values()].find((r) => r.path.startsWith('.vault/automations/') && /stretch/i.test(r.content));
  check('approved automation is written', Boolean(stretch) && /daily 15:00/.test(stretch?.content ?? ''));

  // 4b. Denial keeps the vault clean.
  turn('automate: buy milk at 10:00');
  const denial = await waitFor((m) => m.type === 'approval_request' && m.kind === 'automation' && /milk/i.test(m.command));
  send({ type: 'approval_response', id: denial?.id, approved: false });
  await waitFor((m) => m.type === 'turn_done', 8000);
  await wait(200);
  check('denied automation is not written', ![...records.values()].some((r) => r.path.startsWith('.vault/automations/') && /milk/i.test(r.content)));

  // 5. Memory: save_memory persists and shows up in the next turn's context.
  turn('remember: I prefer metric units');
  await waitFor((m) => m.type === 'turn_done', 8000);
  await wait(200);
  check('save_memory appends to the memory note', (records.get('.vault/memory/observations.md')?.content ?? '').includes('metric units'));
  turn('diagnostic: memory');
  await waitFor((m) => m.type === 'turn_done', 8000);
  await wait(200);
  const diag = [...records.values()].filter((r) => /chats\/test\/\d{4}-assistant\.md/.test(r.path)).sort((a, b) => (a.path < b.path ? -1 : 1)).pop();
  check('memory is loaded into the system context each turn', /memory: .*(metric units)/.test(diag?.content ?? ''), (diag?.content ?? '').slice(-120));

  // 6. Reflection: repeated "remind me to X" asks become a proposed
  // automation (disabled, awaiting approval) plus an observation.
  turn('please remind me to take my meds');
  await waitFor((m) => m.type === 'turn_done', 8000);
  turn('hey, remind me to take my meds');
  await waitFor((m) => m.type === 'turn_done', 8000);
  inbox.length = 0;
  send({ type: 'reflect_now' });
  const reflected = await waitFor((m) => m.type === 'reflect_done', 10_000);
  await wait(300);
  const proposal = [...records.values()].find((r) => r.path.startsWith('.vault/automations/') && r.content.includes('status: proposed'));
  check('reflection proposes an automation from repeated asks', Boolean(proposal) && /take my meds/i.test(proposal?.content ?? ''), JSON.stringify(reflected));
  check('proposals are created disabled', /enabled: false/.test(proposal?.content ?? ''));
  check('reflection writes an observation to memory', /repeatedly asks .*take my meds/i.test(records.get('.vault/memory/observations.md')?.content ?? ''));

  ws.close();
} finally {
  vault.kill();
  const { rmSync } = await import('node:fs');
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} automation checks passed`);
process.exit(failed ? 1 : 0);
