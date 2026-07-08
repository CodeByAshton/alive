// End-to-end verification of the vertical slice using two REAL clients:
// a desktop surface and a phone surface in separate browser contexts
// (separate storage = separate devices), plus the node harness (a third
// device class that contributes exec capability).
// Run with: VAULT_ENABLE_MOCK=1 VAULT_FETCH_ALLOW=localhost server + vite
// running, then `node scripts/e2e.mjs` (the fetch check reads a localhost
// URL, which the SSRF guard would otherwise refuse).

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const results = [];
let failed = false;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// --- Reset: make reruns deterministic --------------------------------------
// The suite mutates the vault (notes, chats, connectors, modes, the kill
// switch). Sweep its leavings from any previous run so back-to-back runs
// against the same dev server pass identically.
async function resetVault() {
  const { default: RawWS } = await import('ws');
  const ws = new RawWS('ws://localhost:8787/ws?key=vault-dev-key&deviceId=e2e-reset&deviceType=desktop');
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  const paths = await new Promise((resolve) => {
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'records') resolve(msg.records.filter((r) => !r.deleted).map((r) => r.path));
    });
    ws.send(JSON.stringify({ type: 'sync', since: 0 }));
  });
  const leftover = (p) =>
    /^chats\/.+/.test(p) ||
    /^notes\/(Sync Test|Device Probe|Conflict)/.test(p) ||
    p.startsWith('.vault/connectors/') ||
    p.startsWith('.vault/automations/') ||
    p.startsWith('.vault/memory/') ||
    p === '.vault/notifications.md';
  for (const p of paths.filter(leftover)) {
    ws.send(JSON.stringify({ type: 'delete', path: p, mtime: Date.now() }));
  }
  ws.send(JSON.stringify({ type: 'set_paused', paused: false }));
  ws.send(JSON.stringify({ type: 'set_mode', mode: 'ask' }));
  await new Promise((r) => setTimeout(r, 500));
  ws.close();
}
await resetVault();

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

// --- Device 1: desktop ---
const desktopCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const desktop = await desktopCtx.newPage();
desktop.on('pageerror', (e) => console.log('desktop pageerror:', e.message));
await desktop.goto(`${BASE}/?surface=desktop`);
await desktop.waitForSelector('.sidebar', { timeout: 15000 });

// 1. Vault tree with seeded notes
await desktop.waitForSelector('.tree-row', { timeout: 10000 });
const treeText = await desktop.locator('.tree').innerText();
check('desktop sees seeded vault tree', treeText.includes('Welcome') && treeText.includes('notes'));

// 2. Graph is a full-screen view reachable from the sidebar menu
await desktop.locator('.nav-item[title="Graph"]').click();
await desktop.waitForTimeout(1500);
const graphCanvas = await desktop.locator('.graph-view canvas').count();
check('graph view renders', graphCanvas > 0);

// 3. Create a note with a wikilink from the desktop (Files panel action)
await desktop.locator('button[title="New note"]').click();
await desktop.locator('[data-testid="name-dialog"] input').fill('Sync Test');
await desktop.locator('[data-testid="name-dialog"] input').press('Enter');
await desktop.waitForSelector('.editor-cm .cm-content', { timeout: 5000 });
await desktop.locator('.editor-cm .cm-content').click();
await desktop.keyboard.press('Control+End');
await desktop.keyboard.type('\nThis links to [[Ideas]].');
await desktop.waitForTimeout(900); // debounce save
check('note created on desktop', (await desktop.locator('.tree').innerText()).includes('Sync Test'));

// 3b. Notion-style properties editor writes YAML frontmatter
await desktop.locator('.editor-modes [role="tab"]', { hasText: 'Read' }).click();
await desktop.locator('.add-property').click();
await desktop.locator('[data-testid="properties"] input[placeholder="name"]').last().fill('status');
await desktop.locator('[data-testid="properties"] input[placeholder="Empty"]').last().fill('draft');
await desktop.waitForTimeout(1000); // debounce save
const propContent = await desktop.evaluate(async () => {
  const { db } = await import('/src/lib/db.ts');
  const rec = await db.records.get('notes/Sync Test.md');
  return rec?.content ?? '';
});
check('properties editor writes YAML frontmatter', propContent.startsWith('---') && propContent.includes('status: draft'), propContent.split('\n').slice(0, 4).join(' | '));

// 4. Customize (hover dropdown) -> Skills opens the full-screen skills manager
await desktop.locator('.nav-item[title="Customize"]').hover();
await desktop.locator('.customize-menu [role="menuitem"]', { hasText: 'Skills' }).click();
await desktop.waitForSelector('.skills-view', { timeout: 5000 });
const skillsText = await desktop.locator('.skills-view').innerText();
check('skills manager lists vault skills', skillsText.includes('/summarize') && skillsText.includes('/journal'));
check('skills folder hidden from file tree', !(await desktop.locator('.tree').innerText()).includes('skills'));

// --- Device 2: phone (separate context = genuinely separate storage/device) ---
const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 800 } });
await phoneCtx.addInitScript(() => {
  // Stub STT/TTS so the voice pipeline runs headless: the mic yields a fixed
  // transcript; spoken replies are recorded on window.__spoken.
  window.__spoken = [];
  // window.speechSynthesis is a read-only getter — patch its methods instead.
  const ss = window.speechSynthesis;
  ss.cancel = () => {};
  ss.speak = (u) => { window.__spoken.push(u.text); };
  window.SpeechRecognition = window.webkitSpeechRecognition = class {
    start() {
      setTimeout(() => {
        const result = [{ transcript: 'run command echo voice-pipeline-ok' }];
        result.isFinal = true;
        if (this.onresult) this.onresult({ results: [result] });
        if (this.onend) this.onend();
      }, 250);
    }
    stop() { if (this.onend) this.onend(); }
  };
});
const phone = await phoneCtx.newPage();
phone.on('pageerror', (e) => console.log('phone pageerror:', e.message));
await phone.goto(`${BASE}/?surface=phone`);
await phone.waitForSelector('.phone', { timeout: 15000 });

// 5. Presence: devices panel shows both devices
await desktop.locator('.nav-item[title="Devices"]').click();
await desktop.waitForTimeout(1000);
const presenceText = await desktop.locator('.presence-panel').innerText();
check('presence registry shows both devices', presenceText.includes('desktop-') && presenceText.includes('phone-'));

// 6. Phone has its own IndexedDB cache
const phoneHasNote = await phone.evaluate(async () => {
  const dbs = await indexedDB.databases();
  return dbs.some((d) => d.name === 'vault');
});
check('phone has local IndexedDB cache', phoneHasNote);

// 7. Start a chat on the phone, select mock model
await phone.locator('.chat-header button[title="New chat"]').click();
await phone.waitForSelector('.model-picker', { timeout: 5000 });
await phone.locator('.model-picker').click();
await phone.locator('[role="option"]', { hasText: 'mock-1' }).click();
await phone.waitForTimeout(400);

// 8. DEVICE-AWARENESS PART 1: close the desktop so only the phone is present.
await desktopCtx.close();
await phone.waitForTimeout(800);

await phone.locator('.composer textarea').fill('Please create a note called Device Probe');
await phone.locator('.composer .send').click();
await phone.waitForSelector('.bubble.assistant', { timeout: 15000 });
await phone.waitForTimeout(1000);
let lastReply = await phone.locator('.bubble.assistant').last().innerText();
check(
  'phone-only: assistant stays conversational (no file op)',
  !lastReply.includes('I created') && !/your (phone|desktop|laptop)|on (the|your) (phone|desktop|laptop)/i.test(lastReply),
  lastReply.slice(0, 80)
);

// 9. Phone-only: no exec tool either
await phone.locator('.composer textarea').fill('run command echo should-not-run');
await phone.locator('.composer .send').click();
await phone.waitForTimeout(2000);
lastReply = await phone.locator('.bubble.assistant').last().innerText();
check('phone-only: no command execution', !lastReply.includes('Ran it'), lastReply.slice(0, 60));

// 10. DEVICE-AWARENESS PART 2: bring a desktop back online — same thread continues,
// tools appear purely from presence.
const desktopCtx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const desktop2 = await desktopCtx2.newPage();
await desktop2.goto(`${BASE}/?surface=desktop`);
await desktop2.waitForSelector('.tree-row', { timeout: 15000 });

// 11. Continuity: the chat started on the phone is visible on the new desktop
await desktop2.locator('.nav-item[title="Chats"]').click();
const chatRows = await desktop2.locator('.panel-list .panel-row').count();
check('chat started on phone visible in desktop chats panel', chatRows > 0);
await desktop2.locator('.panel-list .panel-row').first().click();
await desktop2.waitForTimeout(500);
const desktopChatText = await desktop2.locator('.chat-scroll').innerText();
check('conversation rehydrated on desktop from records', desktopChatText.includes('Device Probe'));

await phone.waitForTimeout(800);
await phone.locator('.composer textarea').fill('create a note called Device Probe');
await phone.locator('.composer .send').click();
await phone.waitForTimeout(2500);
lastReply = await phone.locator('.bubble.assistant').last().innerText();
const attachmentCards = await phone.locator('.bubble.assistant .attachment-card').count();
check(
  'desktop present: assistant now acts on the vault',
  lastReply.includes('I created') && attachmentCards > 0,
  lastReply.slice(0, 80)
);

// 12. The new note shows up live in the desktop tree
await desktop2.locator('.nav-item[title="Files"]').click();
await desktop2.waitForTimeout(1200);
const tree2 = await desktop2.locator('.tree').innerText();
check('assistant-created note appears live in desktop tree', tree2.includes('Device Probe'));

// 13. NODE HARNESS: connect a machine; exec capability appears for the same thread.
const node = spawn(process.execPath, ['agent/vault-node.mjs', '--server', 'ws://localhost:8787', '--workspace', process.cwd(), '--name', 'e2e'], {
  stdio: 'pipe',
});
node.stdout.on('data', () => {});
await phone.waitForTimeout(1500);

await phone.locator('.composer textarea').fill('run command echo vault-node-ok');
await phone.locator('.composer .send').click();

// 13a. TRUST BOUNDARY: the command doesn't run until a human approves it
// on a screen (voice-initiated, screen-confirmed).
const sawApprovalCard = await phone
  .waitForSelector('.approval-card', { timeout: 8000 })
  .then(() => true)
  .catch(() => false);
check('command waits for on-screen approval', sawApprovalCard);
await phone.locator('.approval-card .approve').click();
await phone.waitForTimeout(3000);
lastReply = await phone.locator('.bubble.assistant').last().innerText();
check('node harness online: approved command runs', lastReply.includes('vault-node-ok') && lastReply.includes('Ran it'), lastReply.slice(0, 90));

// 13b. Denying the approval blocks the command; the model is told and adapts.
await phone.locator('.composer textarea').fill('run command echo should-be-denied');
await phone.locator('.composer .send').click();
await phone.waitForSelector('.approval-card', { timeout: 8000 });
await phone.locator('.approval-card .deny').click();
await phone.waitForTimeout(2500);
lastReply = await phone.locator('.bubble.assistant').last().innerText();
check('denied command never runs', lastReply.includes('declined') && !lastReply.includes('Ran it'), lastReply.slice(0, 90));

// 13c. MODES: switch the default mode to Auto in Settings (desktop) —
// commands now run unattended, with no approval card, on every device.
await desktop2.locator('button[title="Settings"]').click();
await desktop2.waitForSelector('.settings-dialog', { timeout: 5000 });
await desktop2.locator('.mode-select').click();
await desktop2.locator('[role="option"]', { hasText: 'Auto' }).click();
await desktop2.locator('.settings-dialog button', { hasText: 'Cancel' }).click();
await phone.waitForTimeout(600);
await phone.locator('.composer textarea').fill('run command echo auto-mode-ok');
await phone.locator('.composer .send').click();
await phone.waitForTimeout(3000);
lastReply = await phone.locator('.bubble.assistant').last().innerText();
const autoCards = await phone.locator('.approval-card').count();
check('auto mode runs commands without asking', lastReply.includes('auto-mode-ok') && autoCards === 0, lastReply.slice(0, 90));

// Back to Ask-first for the voice test below.
await desktop2.locator('button[title="Settings"]').click();
await desktop2.waitForSelector('.settings-dialog', { timeout: 5000 });
await desktop2.locator('.mode-select').click();
await desktop2.locator('[role="option"]', { hasText: 'Ask first' }).click();
await desktop2.locator('.settings-dialog button', { hasText: 'Cancel' }).click();
await phone.waitForTimeout(600);

// 13d. VOICE PIPELINE: speak on the phone -> approval card confirms on-screen
// -> command executes on the laptop node -> reply is spoken back (TTS).
// STT/TTS stubbed; everything between is real.
await phone.locator('.phone-voice .mic').click();
await phone.waitForSelector('.approval-card', { timeout: 8000 });
await phone.locator('.approval-card .approve').click();
await phone.waitForTimeout(3500);
lastReply = await phone.locator('.bubble.assistant').last().innerText();
const spoken = await phone.evaluate(() => window.__spoken);
check('voice: spoken request runs on the connected machine', lastReply.includes('voice-pipeline-ok'), lastReply.slice(0, 70));
check('voice: assistant reply is spoken back (TTS)', Array.isArray(spoken) && spoken.some((t) => t.includes('Ran it')), (spoken || []).join(' | ').slice(0, 60));

// 13e. KILL SWITCH: pausing from the Devices panel stops the assistant
// everywhere; resuming brings it back.
await desktop2.locator('.nav-item[title="Devices"]').click();
await desktop2.waitForSelector('.pause-row', { timeout: 5000 });
await desktop2.locator('.pause-row [role="switch"]').click();
await phone.waitForTimeout(600);
const pausedOnPhone = await phone.locator('.composer textarea').isDisabled();
check('kill switch: pausing on desktop disables the phone composer', pausedOnPhone);
await desktop2.locator('.pause-row [role="switch"]').click();
await phone.waitForTimeout(600);
const resumedOnPhone = await phone.locator('.composer textarea').isEnabled();
check('kill switch: resuming re-enables every surface', resumedOnPhone);
node.kill();

// 13b. CONNECTORS: an MCP server plugged in via Customize -> Connectors
const mcp = spawn(process.execPath, ['scripts/mock-mcp.mjs'], { stdio: 'pipe', env: { ...process.env, PORT: '8975' } });
await phone.waitForTimeout(800);
await desktop2.locator('.nav-item[title="Customize"]').hover();
await desktop2.locator('.customize-menu [role="menuitem"]', { hasText: 'Connectors' }).click();
await desktop2.waitForSelector('.connectors-view', { timeout: 5000 });
await desktop2.locator('.connectors-view header button', { hasText: 'New' }).click();
// The gallery opens Claude-style; pick "Custom" for the local mock server.
await desktop2.waitForSelector('.connector-gallery', { timeout: 3000 });
const galleryText = await desktop2.locator('.connector-gallery').innerText();
check('connector gallery lists known services', galleryText.includes('Notion') && galleryText.includes('Linear'));
await desktop2.locator('.gallery-custom').click();
await desktop2.waitForSelector('.connectors-view input', { timeout: 3000 });
await desktop2.locator('.connectors-view input').nth(1).fill('http://localhost:8975/mcp');
await desktop2.waitForTimeout(1200); // debounce save + status refresh
const connectorPanel = await desktop2.locator('.connectors-view').innerText();
check('connector discovers MCP tools', connectorPanel.includes('echo'), connectorPanel.slice(0, 120));

// New connectors default to the 'ask' policy: every tool call is
// screen-confirmed, same as commands.
await phone.locator('.composer textarea').fill('use the connector to say hello-world');
await phone.locator('.composer .send').click();
const connectorAsked = await phone
  .waitForSelector('.approval-card', { timeout: 8000 })
  .then(() => true)
  .catch(() => false);
check('connector call waits for approval (ask policy)', connectorAsked);
await phone.locator('.approval-card .approve').click();
await phone.waitForTimeout(3000);
lastReply = await phone.locator('.bubble.assistant').last().innerText();
check('assistant calls connector tool end-to-end', lastReply.includes('echo: hello-world'), lastReply.slice(0, 80));

// Mark the connector Trusted -> its tools run without asking.
await desktop2.locator('.connector-policy').click();
await desktop2.locator('[role="option"]', { hasText: 'Trusted' }).click();
await desktop2.waitForTimeout(1200); // debounce save
await phone.locator('.composer textarea').fill('use the connector to say trusted-run');
await phone.locator('.composer .send').click();
await phone.waitForTimeout(3000);
lastReply = await phone.locator('.bubble.assistant').last().innerText();
const trustedCards = await phone.locator('.approval-card').count();
check('trusted connector runs without asking', lastReply.includes('echo: trusted-run') && trustedCards === 0, lastReply.slice(0, 80));
mcp.kill();

// 13f. CMD-K: search palette finds notes and opens them full-screen.
await desktop2.keyboard.press('Control+k');
await desktop2.waitForSelector('.command-palette', { timeout: 5000 });
await desktop2.locator('.command-palette input').fill('Welcome');
await desktop2.waitForTimeout(400);
const paletteText = await desktop2.locator('.command-palette').innerText();
check('cmd-k palette finds the note', paletteText.includes('Welcome'));
await desktop2.locator('.command-palette input').press('Enter');
await desktop2.waitForSelector('.editor-modes', { timeout: 5000 });
check('cmd-k opens the note full-screen', (await desktop2.locator('.main-card').innerText()).includes('Welcome'));

// 13g. EXPORT: the whole vault downloads as a valid zip.
const exportHead = await desktop2.evaluate(async () => {
  const res = await fetch('/api/export?key=vault-dev-key');
  const buf = new Uint8Array(await res.arrayBuffer());
  return { status: res.status, magic: String.fromCharCode(buf[0], buf[1]), size: buf.length };
});
check('vault exports as a zip', exportHead.status === 200 && exportHead.magic === 'PK' && exportHead.size > 500, JSON.stringify(exportHead));

// 13h. CONFLICT COPIES: a write that loses last-write-wins is preserved as a
// conflicted copy instead of silently vanishing (raw WS = a stale device).
const { default: RawWS } = await import('ws');
const rawWs = new RawWS('ws://localhost:8787/ws?key=vault-dev-key&deviceId=e2e-stale&deviceType=desktop');
await new Promise((resolve) => rawWs.on('open', resolve));
const nowMs = Date.now();
rawWs.send(JSON.stringify({ type: 'put', record: { path: 'notes/Conflict.md', type: 'file', content: 'winning edit', mtime: nowMs } }));
await new Promise((r) => setTimeout(r, 300));
rawWs.send(JSON.stringify({ type: 'put', record: { path: 'notes/Conflict.md', type: 'file', content: 'stale offline edit', mtime: nowMs - 60_000 } }));
await new Promise((r) => setTimeout(r, 800));
rawWs.close();
await desktop2.locator('.nav-item[title="Files"]').click();
await desktop2.waitForTimeout(800);
const treeAfterConflict = await desktop2.locator('.tree').innerText();
check('losing write becomes a conflicted copy', treeAfterConflict.includes('conflicted copy'), treeAfterConflict.split('\n').find((l) => l.includes('conflicted')) ?? '');

// 13i. WEB ACCESS: the assistant can read pages by URL (fetch_url), and the
// SSRF guard refuses private addresses so the server can't be used as a
// periscope into internal networks.
await phone.locator('.composer textarea').fill('fetch http://localhost:8787/api/health');
await phone.locator('.composer .send').click();
await phone.waitForTimeout(2500);
lastReply = await phone.locator('.bubble.assistant').last().innerText();
check('assistant reads a web page by URL', lastReply.includes('"ok"'), lastReply.slice(0, 80));

await phone.locator('.composer textarea').fill('fetch http://169.254.169.254/latest/meta-data');
await phone.locator('.composer .send').click();
await phone.waitForTimeout(2500);
lastReply = await phone.locator('.bubble.assistant').last().innerText();
check('SSRF guard refuses private addresses', lastReply.includes('private network'), lastReply.slice(0, 80));

// 14. Message files carry frontmatter with device + model provenance
const chatFolderCheck = await desktop2.evaluate(async () => {
  const { db } = await import('/src/lib/db.ts');
  const records = await db.records.toArray();
  const msg = records.find((r) => /chats\/.*\/000\d-assistant\.md$/.test(r.path));
  return msg?.content.slice(0, 300) ?? '';
});
check(
  'message files have role/device/model frontmatter',
  chatFolderCheck.includes('role: assistant') && chatFolderCheck.includes('model:'),
  chatFolderCheck.split('\n').slice(0, 6).join(' | ')
);

// 15. Skill awareness: the harness loads the right skill from .vault/skills
await phone.locator('.composer textarea').fill('/journal morning pages');
await phone.locator('.composer .send').click();
await phone.waitForTimeout(2000);
const afterSkill = await phone.locator('.bubble.assistant').last().innerText();
check('harness loads the invoked skill into the turn', afterSkill.includes('Skill loaded: Journal'), afterSkill.slice(0, 60));

await phone.locator('.composer textarea').fill('/nope not-a-skill');
await phone.locator('.composer .send').click();
await phone.waitForTimeout(2000);
const noSkill = await phone.locator('.bubble.assistant').last().innerText();
check('unknown slash command loads no skill', noSkill.includes('No skill matches'), noSkill.slice(0, 60));

// 15b. Standing instructions (.vault/AGENT.md) reach every turn
await phone.locator('.composer textarea').fill('diagnostic: agent-file');
await phone.locator('.composer .send').click();
await phone.waitForTimeout(2000);
const agentDiag = await phone.locator('.bubble.assistant').last().innerText();
check('AGENT.md standing instructions injected into turns', agentDiag.includes('agent-file: yes'), agentDiag.slice(0, 40));

// 16. Reload persistence: reload phone, conversation still there
await phone.reload();
await phone.waitForSelector('.bubble', { timeout: 15000 });
const reloaded = await phone.locator('.chat-scroll').innerText();
check('reload restores conversation from cache+cloud', reloaded.includes('Device Probe'));

// 17. Model picker lists multiple providers
await desktop2.locator('.nav-item[title="Chats"]').click();
await desktop2.waitForSelector('.model-picker', { timeout: 5000 });
await desktop2.locator('.model-picker').click();
await desktop2.waitForSelector('[role="listbox"]', { timeout: 5000 });
const pickerText = await desktop2.locator('[role="listbox"]').innerText();
await desktop2.keyboard.press('Escape');
check('model picker lists multiple providers', pickerText.includes('Anthropic') && pickerText.includes('OpenAI'));

await browser.close();
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
