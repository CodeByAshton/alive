// VaultStore — the canonical cloud copy of the vault.
// Records: { path, type: 'file'|'folder', content, mtime, ctime, deleted, rev }
// Persistence is a JSON file; the interface is the seam where a Postgres/Supabase
// implementation would slot in (same method surface, same change events).

import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

export class VaultStore extends EventEmitter {
  constructor(dataFile) {
    super();
    this.dataFile = dataFile;
    this.records = new Map(); // path -> record
    this.rev = 0;
    this._saveTimer = null;
    this._load();
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
      this.rev = raw.rev || 0;
      for (const rec of raw.records || []) this.records.set(rec.path, rec);
    } catch {
      /* fresh vault */
    }
  }

  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      const payload = JSON.stringify({ rev: this.rev, records: [...this.records.values()] });
      fs.mkdirSync(path.dirname(this.dataFile), { recursive: true });
      fs.writeFileSync(this.dataFile, payload);
    }, 250);
  }

  get(p) {
    const rec = this.records.get(p);
    return rec && !rec.deleted ? rec : null;
  }

  list(prefix = '') {
    return [...this.records.values()].filter(
      (r) => !r.deleted && (prefix === '' || r.path === prefix || r.path.startsWith(prefix.endsWith('/') ? prefix : prefix + '/'))
    );
  }

  since(rev) {
    return [...this.records.values()].filter((r) => r.rev > rev);
  }

  // Last-write-wins at the record level: an incoming write only lands if its
  // mtime is >= the stored one. Good enough for the prototype (no CRDT merge).
  put({ path: p, type, content = '', mtime }) {
    const now = Date.now();
    const m = mtime ?? now;
    const existing = this.records.get(p);
    if (existing && !existing.deleted && existing.mtime > m) return existing;
    const rec = {
      path: p,
      type,
      content: type === 'folder' ? '' : content,
      ctime: existing?.ctime ?? m,
      mtime: m,
      deleted: false,
      rev: ++this.rev,
    };
    this.records.set(p, rec);
    this._ensureParents(p, m);
    this._scheduleSave();
    this.emit('change', [rec, ...this._pendingParents.splice(0)]);
    return rec;
  }

  _pendingParents = [];
  _ensureParents(p, mtime) {
    let dir = p.split('/').slice(0, -1).join('/');
    while (dir) {
      const existing = this.records.get(dir);
      if (!existing || existing.deleted) {
        const rec = { path: dir, type: 'folder', content: '', ctime: mtime, mtime, deleted: false, rev: ++this.rev };
        this.records.set(dir, rec);
        this._pendingParents.push(rec);
      }
      dir = dir.split('/').slice(0, -1).join('/');
    }
  }

  delete(p, mtime) {
    const m = mtime ?? Date.now();
    const changed = [];
    for (const rec of this.records.values()) {
      if (rec.deleted) continue;
      if (rec.path === p || rec.path.startsWith(p + '/')) {
        if (rec.mtime > m) continue;
        const tomb = { ...rec, deleted: true, mtime: m, rev: ++this.rev };
        this.records.set(rec.path, tomb);
        changed.push(tomb);
      }
    }
    if (changed.length) {
      this._scheduleSave();
      this.emit('change', changed);
    }
    return changed;
  }

  move(from, to) {
    const now = Date.now();
    const changed = [];
    const moving = [...this.records.values()].filter(
      (r) => !r.deleted && (r.path === from || r.path.startsWith(from + '/'))
    );
    for (const rec of moving) {
      const newPath = to + rec.path.slice(from.length);
      const tomb = { ...rec, deleted: true, mtime: now, rev: ++this.rev };
      this.records.set(rec.path, tomb);
      changed.push(tomb);
      const moved = { ...rec, path: newPath, mtime: now, rev: ++this.rev, deleted: false };
      this.records.set(newPath, moved);
      changed.push(moved);
    }
    if (changed.length) {
      this._ensureParents(to + '/x', now);
      changed.push(...this._pendingParents.splice(0));
      this._scheduleSave();
      this.emit('change', changed);
    }
    return changed;
  }
}
