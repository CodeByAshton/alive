-- Vault cloud schema. The vault server is the single writer: it holds the
-- authoritative in-memory state and mirrors every change here with the
-- service role (bypasses RLS). Clients never talk to Postgres directly, so
-- RLS is enabled with no anon/authenticated policies — the Data API exposes
-- nothing. When real per-user auth lands, policies go here.
--
-- Applied to the hosted project as migration `create_vault_schema`; this
-- copy keeps the schema in the repo.

create table public.vaults (
  id uuid primary key default gen_random_uuid(),
  key_hash text not null unique,   -- sha256 of the vault key; the key itself is never stored
  name text not null default 'Vault',
  rev bigint not null default 0,   -- high-water mark of the record rev counter
  created_at timestamptz not null default now()
);

create table public.vault_records (
  vault_id uuid not null references public.vaults (id) on delete cascade,
  path text not null,
  type text not null check (type in ('file', 'folder')),
  content text not null default '',
  ctime bigint not null,
  mtime bigint not null,
  deleted boolean not null default false,  -- tombstones, same LWW semantics as the file store
  rev bigint not null,
  primary key (vault_id, path)
);

-- Incremental sync reads are "records since rev N".
create index vault_records_rev_idx on public.vault_records (vault_id, rev);

alter table public.vaults enable row level security;
alter table public.vault_records enable row level security;
