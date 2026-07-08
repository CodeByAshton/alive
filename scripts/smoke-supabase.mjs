// Smoke-test the Supabase persistence path against the real project.
// Run wherever the network can reach *.supabase.co:
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_KEY=... \
//   node scripts/smoke-supabase.mjs
//
// Uses a throwaway vault key so it never touches your real vault, and
// deletes the test vault when done (cascade removes its records).

import { SupabaseVaultStore } from '../server/store-supabase.mjs';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;
if (!url || !serviceKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY first.');
  process.exit(1);
}

const vaultKey = `smoke-${Date.now()}`;
let failed = false;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed = true;
};

// 1. Boot a store, write through, wait for the flush.
const a = await new SupabaseVaultStore({ url, serviceKey, vaultKey, name: 'Smoke' }).init();
check('vault row created on first boot', Boolean(a.vaultId), a.vaultId);

a.put({ path: 'notes/Smoke.md', type: 'file', content: '# smoke' });
a.put({ path: 'notes/Smoke.md', type: 'file', content: '# smoke v2' });
a.delete('notes/Never.md'); // no-op delete shouldn't break anything
await new Promise((r) => setTimeout(r, 1500)); // debounce (250ms) + round trip

// 2. A second store instance (fresh process, same key) hydrates the state.
const b = await new SupabaseVaultStore({ url, serviceKey, vaultKey, name: 'Smoke' }).init();
check('second boot joins the same vault', b.vaultId === a.vaultId);
check('records hydrate from postgres', b.get('notes/Smoke.md')?.content === '# smoke v2');
check('rev cursor survives reboot', b.rev === a.rev, `rev=${b.rev}`);
check('parent folders persisted too', Boolean(b.get('notes')));

// 3. Tombstones round-trip (sync cursors depend on them).
a.delete('notes/Smoke.md');
await new Promise((r) => setTimeout(r, 1500));
const c = await new SupabaseVaultStore({ url, serviceKey, vaultKey, name: 'Smoke' }).init();
check('tombstoned delete hydrates as deleted', !c.get('notes/Smoke.md') && c.since(0).some((r) => r.path === 'notes/Smoke.md' && r.deleted));

// 4. Clean up the throwaway vault (cascade removes its records).
const { error } = await a.client.from('vaults').delete().eq('id', a.vaultId);
check('cleanup: throwaway vault removed', !error, error?.message ?? '');

process.exit(failed ? 1 : 0);
