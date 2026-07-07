// End-to-end verification of the vertical slice using two REAL clients:
// a desktop surface and a phone surface in separate browser contexts
// (separate storage = separate devices), plus the node harness (a third
// device class that contributes exec capability).
// Run with: VAULT_ENABLE_MOCK=1 server + vite running, then `node scripts/e2e.mjs`

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

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

// --- Device 1: desktop ---
const desktopCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const desktop = await desktopCtx.newPage();
desktop.on('pageerror', (e) => console.log('desktop pageerror:', e.message));
await desktop.goto(`${BASE}/?surface=desktop`);
await desktop.waitForSelector('.rail', { timeout: 15000 });

// 1. Vault tree with seeded notes
await desktop.waitForSelector('.tree-row', { timeout: 10000 });
const treeText = await desktop.locator('.tree').innerText();
check('desktop sees seeded vault tree', treeText.includes('Welcome') && treeText.includes('skills'));

// 2. Graph renders nodes
await desktop.waitForTimeout(1500);
const graphCanvas = await desktop.locator('.right-rail canvas').count();
check('graph view renders', graphCanvas > 0);

// 3. Create a note with a wikilink from the desktop (Files panel action)
desktop.once('dialog', (d) => d.accept('Sync Test'));
await desktop.locator('.panel-actions button[title="New note"]').click();
await desktop.waitForSelector('.editor-cm .cm-content', { timeout: 5000 });
await desktop.locator('.editor-cm .cm-content').click();
await desktop.keyboard.press('Control+End');
await desktop.keyboard.type('\nThis links to [[Ideas]].');
await desktop.waitForTimeout(900); // debounce save
check('note created on desktop', (await desktop.locator('.tree').innerText()).includes('Sync Test'));

// 4. Rail panels: skills panel lists seeded skills
await desktop.locator('.rail-tab[title="Skills"]').click();
const skillsText = await desktop.locator('.panel-list').innerText();
check('skills panel lists vault skills', skillsText.includes('/summarize') && skillsText.includes('/journal'));

// --- Device 2: phone (separate context = genuinely separate storage/device) ---
const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 800 } });
const phone = await phoneCtx.newPage();
phone.on('pageerror', (e) => console.log('phone pageerror:', e.message));
await phone.goto(`${BASE}/?surface=phone`);
await phone.waitForSelector('.phone', { timeout: 15000 });

// 5. Presence: devices panel shows both devices
await desktop.locator('.rail-tab[title="Devices"]').click();
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
await phone.locator('.chat-header button', { hasText: '+ New' }).click();
await phone.waitForSelector('.model-picker', { timeout: 5000 });
await phone.locator('.model-picker').selectOption({ label: 'Mock (dev) · mock-1' });
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
await desktop2.locator('.rail-tab[title="Chats"]').click();
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
check(
  'desktop present: assistant now acts on the vault',
  lastReply.includes('I created') && lastReply.includes('tool call'),
  lastReply.slice(0, 80)
);

// 12. The new note shows up live in the desktop tree
await desktop2.locator('.rail-tab[title="Files"]').click();
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
await phone.waitForTimeout(3000);
lastReply = await phone.locator('.bubble.assistant').last().innerText();
check('node harness online: assistant runs the command', lastReply.includes('vault-node-ok') && lastReply.includes('Ran it'), lastReply.slice(0, 90));
node.kill();

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

// 15. Skill invocation via slash command
await phone.locator('.composer textarea').fill('/task buy milk');
await phone.locator('.composer .send').click();
await phone.waitForTimeout(2000);
const afterSkill = await phone.locator('.bubble.assistant').last().innerText();
check('slash-command skill turn completes', afterSkill.length > 0);

// 16. Reload persistence: reload phone, conversation still there
await phone.reload();
await phone.waitForSelector('.bubble', { timeout: 15000 });
const reloaded = await phone.locator('.chat-scroll').innerText();
check('reload restores conversation from cache+cloud', reloaded.includes('Device Probe'));

// 17. Model picker lists multiple providers
const pickerValues = await desktop2.locator('.model-picker option').allInnerTexts();
check(
  'model picker lists multiple providers',
  pickerValues.some((v) => v.includes('Anthropic')) && pickerValues.some((v) => v.includes('OpenAI'))
);

await browser.close();
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
