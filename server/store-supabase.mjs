// SupabaseVaultStore — the same VaultStore, persisted in Supabase Postgres
// instead of a JSON file. The vault server stays the single writer: it holds
// the authoritative in-memory state (so every read and the LWW merge logic
// stay synchronous and identical to the file store) and mirrors each change
// batch into Postgres with the service role. Boot hydrates from Postgres, so
// state survives redeploys and moves between machines.
//
// Enable by setting SUPABASE_URL + SUPABASE_SERVICE_KEY on the server.
// A vault row is found either by sha256(vault key) — shared-key deployments,
// the key itself never leaves the server — or by owner_id (a Supabase Auth
// user) in accounts mode.

import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { VaultStore } from './store.mjs';

const PAGE = 1000; // PostgREST's default max rows per request
const UPSERT_CHUNK = 200;

export class SupabaseVaultStore extends VaultStore {
  constructor({ url, serviceKey, vaultKey, ownerId, name = 'Vault' }) {
    super(null); // no data file; _load() falls through to a fresh vault
    this.client = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.ownerId = ownerId || null;
    this.keyHash = ownerId ? null : crypto.createHash('sha256').update(vaultKey).digest('hex');
    this.vaultName = name;
    this.vaultId = null;
    this._dirty = new Map(); // path -> latest changed record awaiting write-through
    this._flushTimer = null;
    this._flushing = false;
    this._retryDelay = 0;
  }

  async init() {
    const identity = this.ownerId ? { owner_id: this.ownerId } : { key_hash: this.keyHash };
    const [[column, value]] = Object.entries(identity);
    const { data: found, error } = await this.client
      .from('vaults')
      .select('id, rev')
      .eq(column, value)
      .maybeSingle();
    if (error) throw new Error(`Supabase (vault lookup): ${error.message}`);

    let vault = found;
    if (!vault) {
      const { data, error: insErr } = await this.client
        .from('vaults')
        .insert({ ...identity, name: this.vaultName })
        .select('id, rev')
        .single();
      if (insErr) throw new Error(`Supabase (vault create): ${insErr.message}`);
      vault = data;
    }
    this.vaultId = vault.id;

    // Hydrate everything, tombstones included — sync cursors depend on them.
    for (let from = 0; ; from += PAGE) {
      const { data: rows, error: selErr } = await this.client
        .from('vault_records')
        .select('path, type, content, ctime, mtime, deleted, rev')
        .eq('vault_id', this.vaultId)
        .order('rev', { ascending: true })
        .range(from, from + PAGE - 1);
      if (selErr) throw new Error(`Supabase (hydrate): ${selErr.message}`);
      for (const row of rows) this.records.set(row.path, { ...row });
      if (rows.length < PAGE) break;
    }
    this.rev = Math.max(vault.rev ?? 0, 0, ...[...this.records.values()].map((r) => r.rev));

    // Compact expired tombstones here too — and actually remove the rows,
    // or the next hydrate would resurrect them.
    const dropped = this._compactTombstones();
    for (let i = 0; i < dropped.length; i += 100) {
      await this.client
        .from('vault_records')
        .delete()
        .eq('vault_id', this.vaultId)
        .in('path', dropped.slice(i, i + 100));
    }

    // Write-through: every mutation the base class makes emits 'change';
    // mirror those records into Postgres, batched and retried.
    this.on('change', (records) => {
      for (const rec of records) this._dirty.set(rec.path, rec);
      this._scheduleFlush();
    });
    return this;
  }

  _scheduleSave() {
    /* no JSON file — persistence is the write-through flush */
  }

  _scheduleFlush(delay = 250) {
    clearTimeout(this._flushTimer);
    this._flushTimer = setTimeout(() => this._flush(), delay);
  }

  async _flush() {
    if (this._flushing || !this._dirty.size) return;
    this._flushing = true;
    const batch = [...this._dirty.values()];
    this._dirty.clear();
    let ok = true;
    try {
      for (let i = 0; i < batch.length; i += UPSERT_CHUNK) {
        const rows = batch.slice(i, i + UPSERT_CHUNK).map((r) => ({
          vault_id: this.vaultId,
          path: r.path,
          type: r.type,
          content: r.content,
          ctime: r.ctime,
          mtime: r.mtime,
          deleted: r.deleted,
          rev: r.rev,
        }));
        const { error } = await this.client
          .from('vault_records')
          .upsert(rows, { onConflict: 'vault_id,path' });
        if (error) throw new Error(error.message);
      }
      const { error: revErr } = await this.client
        .from('vaults')
        .update({ rev: this.rev })
        .eq('id', this.vaultId);
      if (revErr) throw new Error(revErr.message);
    } catch (err) {
      ok = false;
      // Requeue the batch; anything rewritten locally in the meantime wins.
      for (const rec of batch) if (!this._dirty.has(rec.path)) this._dirty.set(rec.path, rec);
      console.error(`supabase write-through failed (retrying): ${err.message}`);
    }
    this._flushing = false;
    if (!ok) {
      this._retryDelay = Math.min(Math.max(this._retryDelay * 2, 1000), 30_000);
      this._scheduleFlush(this._retryDelay);
    } else {
      this._retryDelay = 0;
      if (this._dirty.size) this._scheduleFlush();
    }
  }
}
