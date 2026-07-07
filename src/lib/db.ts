// Local IndexedDB cache (Dexie). Every device mirrors the synced vault
// records here for fast reads and offline continuity; writes go to the cache
// first, then to the cloud via the sync provider's outbox.

import Dexie, { type EntityTable } from 'dexie';
import type { VaultRecord } from './types';

interface OutboxOp {
  id?: number;
  op: Record<string, unknown>;
}

interface MetaRow {
  key: string;
  value: number;
}

export const db = new Dexie('vault') as Dexie & {
  records: EntityTable<VaultRecord, 'path'>;
  outbox: EntityTable<OutboxOp, 'id'>;
  meta: EntityTable<MetaRow, 'key'>;
};

db.version(1).stores({
  records: 'path, rev, mtime',
  outbox: '++id',
  meta: 'key',
});

export async function loadCachedRecords(): Promise<VaultRecord[]> {
  return db.records.toArray();
}

export async function getLastRev(): Promise<number> {
  const row = await db.meta.get('lastRev');
  return row?.value ?? 0;
}

export async function setLastRev(rev: number): Promise<void> {
  await db.meta.put({ key: 'lastRev', value: rev });
}
