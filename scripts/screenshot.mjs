import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const OUT = process.env.OUT_DIR || '.';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

const desktop = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark' })).newPage();
await desktop.goto(`${BASE}/?surface=desktop`);
await desktop.waitForSelector('.tree-row', { timeout: 15000 });
await desktop.locator('.tree-row', { hasText: 'Welcome' }).first().click();
await desktop.locator('.editor-modes button', { hasText: 'Preview' }).click();
await desktop.waitForTimeout(2500);
await desktop.screenshot({ path: `${OUT}/desktop.png` });

const phone = await (await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, colorScheme: 'dark' })).newPage();
await phone.goto(`${BASE}/?surface=phone`);
await phone.waitForSelector('.phone', { timeout: 15000 });
await phone.waitForTimeout(1500);
await phone.screenshot({ path: `${OUT}/phone.png` });

await browser.close();
console.log('screenshots written');
