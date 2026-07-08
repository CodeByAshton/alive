// Automations: learned behaviors handed off to a non-model executor.
// Each automation is a Markdown file under .vault/automations/ — frontmatter
// (name, schedule, enabled, status), a plain-language explanation of what it
// does, and a fenced ```js script. A deterministic scheduler fires due
// automations with zero model involvement; the model's only jobs are writing
// the files (behind an approval card) and rewriting them when the user asks
// in the Automations view's prompt window.

import vm from 'node:vm';
import { parseFrontmatter, serializeFrontmatter } from '../shared/frontmatter.mjs';
import { isDue, parseSchedule } from '../shared/schedule.mjs';
import { getEngine } from './engines/index.mjs';
import { fetchUrl } from './web.mjs';

// The schedule grammar lives in shared/schedule.mjs (the phone uses it too,
// to mirror reminders into local notifications); re-export for callers/tests.
export { isDue, nextOccurrence, nextOccurrences, parseSchedule } from '../shared/schedule.mjs';

export const AUTOMATIONS_DIR = '.vault/automations';
export const NOTIFICATIONS_FILE = '.vault/notifications.md';

const TICK_MS = Number(process.env.VAULT_AUTOMATION_TICK_MS || 30_000);
const SCRIPT_TIMEOUT_MS = 10_000;
const MAX_SCRIPT_OPS = 100;
const MAX_NOTIFICATION_LINES = 200;

/* ── automation records ─────────────────────────────────────────────────── */

export function parseAutomation(rec) {
  const { data, body } = parseFrontmatter(rec.content);
  const scriptMatch = body.match(/```(?:js|javascript)\n([\s\S]*?)```/);
  return {
    path: rec.path,
    name: String(data.name || rec.path.split('/').pop().replace(/\.md$/, '')),
    description: String(data.description || ''),
    schedule: String(data.schedule || ''),
    enabled: data.enabled !== false,
    status: data.status === 'proposed' ? 'proposed' : data.status === 'done' ? 'done' : 'active',
    createdBy: String(data.created_by || 'user'),
    lastRun: data.last_run ? String(data.last_run) : null,
    lastResult: data.last_result ? String(data.last_result) : null,
    about: body.replace(/```(?:js|javascript)\n[\s\S]*?```/, '').trim(),
    script: scriptMatch ? scriptMatch[1].trim() : '',
    mtime: rec.mtime,
  };
}

export function serializeAutomation(a) {
  return serializeFrontmatter(
    {
      name: a.name,
      description: a.description,
      schedule: a.schedule,
      enabled: a.enabled !== false,
      status: a.status || 'active',
      created_by: a.createdBy || 'user',
      ...(a.lastRun ? { last_run: a.lastRun } : {}),
      ...(a.lastResult ? { last_result: String(a.lastResult).slice(0, 300) } : {}),
    },
    `${(a.about || a.description || '').trim()}\n\n\`\`\`js\n${(a.script || '').trim()}\n\`\`\`\n`
  );
}

export function listAutomations(store) {
  return store
    .list(AUTOMATIONS_DIR)
    .filter((r) => r.type === 'file' && r.path.endsWith('.md'))
    .map(parseAutomation);
}

export function automationPathFor(store, name) {
  const slug = String(name || 'automation')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'automation';
  let path = `${AUTOMATIONS_DIR}/${slug}.md`;
  for (let n = 2; store.get(path); n++) path = `${AUTOMATIONS_DIR}/${slug}-${n}.md`;
  return path;
}

// Validate the pieces of an automation before anything is written. Returns an
// error string or null; shared by the tool, the editor flow, and reflection.
export function validateAutomation({ name, schedule, script }) {
  if (!String(name || '').trim()) return 'automation needs a name';
  if (!parseSchedule(schedule)) {
    return `unrecognized schedule "${schedule}" — use one of: daily HH:MM, weekdays HH:MM, weekly <mon..sun> HH:MM, every N minutes, every N hours, once YYYY-MM-DD HH:MM`;
  }
  if (!String(script || '').trim()) return 'automation needs a script';
  if (String(script).length > 20_000) return 'script too long (20k char cap)';
  return null;
}

/* ── notifications ───────────────────────────────────────────────────────
   The non-model delivery channel: broadcast live to every connected surface
   and append to a synced note so offline devices catch up. */

export function recordNotification(ctx, { title, message }) {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const line = `- **${stamp}** — ${title ? `[${title}] ` : ''}${String(message).replace(/\n/g, ' ').slice(0, 500)}`;
  const existing = ctx.store.get(NOTIFICATIONS_FILE);
  const lines = (existing?.content || '# Notifications\n\nReminders and automation output land here (newest first).\n')
    .split('\n');
  const headerEnd = lines.findIndex((l) => l.startsWith('- ')) === -1 ? lines.length : lines.findIndex((l) => l.startsWith('- '));
  const bullets = lines.slice(headerEnd).filter((l) => l.startsWith('- ')).slice(0, MAX_NOTIFICATION_LINES - 1);
  const content = [...lines.slice(0, headerEnd), line, ...bullets].join('\n');
  ctx.store.put({ path: NOTIFICATIONS_FILE, type: 'file', content });
  ctx.broadcast({ type: 'notify', title: title || 'Automation', message: String(message).slice(0, 500) });
}

/* ── script sandbox ──────────────────────────────────────────────────────
   Deliberately tiny API. Not a hard security boundary (same trust level as
   the model editing the vault — it's the user's own server-side automation);
   the caps exist to stop runaway scripts, not adversaries.
   TODO: trust boundary — a hosted multi-tenant deployment should run these
   in an isolated worker with resource limits. */

export async function runScript(script, api, { timeoutMs = SCRIPT_TIMEOUT_MS } = {}) {
  const logs = [];
  let ops = 0;
  const guard = () => {
    if (++ops > MAX_SCRIPT_OPS) throw new Error(`script exceeded ${MAX_SCRIPT_OPS} operations`);
  };
  const sandbox = {
    JSON, Math, Date,
    log: (...args) => { guard(); logs.push(args.map(String).join(' ')); },
    console: { log: (...args) => { guard(); logs.push(args.map(String).join(' ')); } },
    notify: (message) => { guard(); api.notify(String(message)); },
    fetchUrl: async (url) => { guard(); return api.fetchUrl(String(url)); },
    vault: {
      read: (path) => { guard(); return api.read(String(path)); },
      list: (prefix) => { guard(); return api.list(prefix ? String(prefix) : ''); },
      write: (path, content) => { guard(); api.write(String(path), String(content)); },
      append: (path, content) => { guard(); api.append(String(path), String(content)); },
    },
    setTimeout: (fn, ms) => setTimeout(fn, Number(ms) || 0),
  };
  try {
    const context = vm.createContext(sandbox);
    const compiled = new vm.Script(`(async () => {\n${script}\n})()`, { filename: 'automation.js' });
    const result = Promise.resolve(compiled.runInContext(context, { timeout: timeoutMs }));
    result.catch(() => {}); // a rejection after losing the timeout race must not crash the process
    await Promise.race([
      result,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`script timed out after ${timeoutMs}ms`)), timeoutMs).unref?.()),
    ]);
    return { ok: true, logs };
  } catch (err) {
    return { ok: false, logs, error: err.message };
  }
}

function scriptApi(ctx, automation) {
  const safe = (p) => {
    const clean = String(p).replace(/^\/+/, '');
    if (clean.split('/').some((seg) => seg === '..' || seg === '.')) throw new Error(`invalid path: ${p}`);
    if (clean.startsWith(AUTOMATIONS_DIR)) throw new Error('automations cannot rewrite automations');
    return clean;
  };
  return {
    notify: (message) => recordNotification(ctx, { title: automation.name, message }),
    fetchUrl,
    read: (p) => ctx.store.get(safe(p))?.content ?? null,
    list: (prefix) => ctx.store.list(prefix ? safe(prefix) : '').map((r) => r.path),
    write: (p, content) => ctx.store.put({ path: safe(p), type: 'file', content: content.slice(0, 200_000) }),
    append: (p, content) => {
      const path = safe(p);
      const existing = ctx.store.get(path);
      const next = existing ? existing.content.replace(/\n?$/, '\n') + content : content;
      ctx.store.put({ path, type: 'file', content: next.slice(0, 200_000) });
    },
  };
}

/* ── scheduler ───────────────────────────────────────────────────────────── */

function vaultTimezone(store) {
  try {
    const settings = JSON.parse(store.get('.vault/settings.json')?.content ?? '{}');
    if (settings.timezone) return String(settings.timezone);
  } catch { /* fall through */ }
  return process.env.VAULT_TIMEZONE || undefined;
}

export async function runAutomation(ctx, path, { manual = false } = {}) {
  const rec = ctx.store.get(path);
  if (!rec) throw new Error(`No automation at ${path}`);
  const automation = parseAutomation(rec);
  const result = await runScript(automation.script, scriptApi(ctx, automation));
  const finished = parseAutomation(ctx.store.get(path) ?? rec); // script can't edit it, but a user might have
  finished.lastRun = new Date().toISOString();
  finished.lastResult = result.ok ? 'ok' : `error: ${result.error}`;
  if (!manual && parseSchedule(finished.schedule)?.kind === 'once') {
    finished.enabled = false;
    finished.status = 'done';
  }
  ctx.store.put({ path, type: 'file', content: serializeAutomation(finished) });
  ctx.broadcast({ type: 'automation_ran', path, ok: result.ok, error: result.error ?? null, logs: result.logs });
  return result;
}

// One scheduler per vault context. Ticks are cheap: parse the folder, fire
// what's due. `paused` (the kill switch) stops automations too — pausing the
// assistant should stop everything it set in motion.
export function startAutomationScheduler(ctx, { onTick } = {}) {
  if (ctx.automationTimer) return;
  let running = false;
  const tick = async () => {
    if (running || ctx.paused) return;
    running = true;
    try {
      const timeZone = vaultTimezone(ctx.store);
      const now = Date.now();
      for (const automation of listAutomations(ctx.store)) {
        if (!automation.enabled || automation.status !== 'active') continue;
        const spec = parseSchedule(automation.schedule);
        if (!spec) continue;
        // Occurrences count from the last run, or from the file's own
        // creation/edit time — a newly written "daily 09:00" never back-fires
        // for this morning's 09:00.
        const since = automation.lastRun ? Date.parse(automation.lastRun) : automation.mtime;
        if (Number.isFinite(since) && isDue(spec, since, now, timeZone)) {
          await runAutomation(ctx, automation.path).catch(() => {});
        }
      }
      await onTick?.();
    } finally {
      running = false;
    }
  };
  ctx.automationTimer = setInterval(tick, TICK_MS);
  ctx.automationTimer.unref?.();
}

/* ── model-assisted editing (the Automations view's prompt window) ─────────
   The user never hand-edits scripts: they describe the automation (or the
   change) in plain language and one focused model call rewrites the file.
   This is a user-initiated explicit edit, so no approval card. */

export const AUTOMATION_DOC = `An automation file is Markdown with YAML frontmatter:

---
name: Morning meds
description: One-line summary shown in lists.
schedule: daily 09:00
enabled: true
status: active
---

One short paragraph in plain language explaining what this automation does and when — this is what the user reads.

\`\`\`js
notify('Take your medication');
\`\`\`

Schedules (interpreted in the user's timezone): "daily HH:MM", "weekdays HH:MM", "weekly mon HH:MM" (mon..sun), "every N minutes", "every N hours", "once YYYY-MM-DD HH:MM".

The script runs on a schedule with NO model involved. Available API (top-level await allowed):
- notify(message) — send the user a notification on all their devices
- vault.read(path) -> string|null, vault.list(prefix) -> paths, vault.write(path, content), vault.append(path, text) — the user's notes
- fetchUrl(url) -> readable text of a public web page
- log(message) — debug output shown in the run result
Keep scripts short and deterministic. For a plain reminder, one notify() call is the whole script.`;

export async function editAutomationWithModel({ ctx, path, instruction, provider, model }) {
  const existing = path ? ctx.store.get(path) : null;
  const system = `You are the automation editor for Vault. You output a complete automation file and nothing else — no commentary, no surrounding code fence.

${AUTOMATION_DOC}

${existing ? `The user is editing this existing automation:\n\n${existing.content}\n\nApply their instruction to it, preserving anything they didn't ask to change (keep last_run/last_result fields out of your output — the scheduler owns those).` : 'The user is creating a new automation. Set status: active, enabled: true.'}
Add "created_by: user" to the frontmatter.`;

  const engine = getEngine(provider);
  const result = await engine.run({
    model,
    system,
    messages: [{ role: 'user', content: String(instruction) }],
    tools: [],
    executeTool: async () => 'ok',
    onEvent: () => {},
  });

  // Tolerate a fenced reply; then insist the content is a valid automation.
  let content = result.text.trim();
  const fenced = content.match(/^```(?:markdown|md)?\n([\s\S]*?)```$/);
  if (fenced) content = fenced[1].trim();
  if (!content.startsWith('---')) throw new Error("The model didn't return a valid automation file. Try rephrasing.");
  const parsed = parseAutomation({ path: path || 'new.md', content, mtime: Date.now() });
  const invalid = validateAutomation(parsed);
  if (invalid) throw new Error(invalid);

  const target = path || automationPathFor(ctx.store, parsed.name);
  // The scheduler owns run bookkeeping; carry it over instead of trusting the model with it.
  if (existing) {
    const prev = parseAutomation(existing);
    parsed.lastRun = prev.lastRun;
    parsed.lastResult = prev.lastResult;
  }
  ctx.store.put({ path: target, type: 'file', content: serializeAutomation(parsed) });
  return { path: target };
}
