-- Real user accounts: a vault can now belong to a Supabase Auth user.
-- key_hash vaults remain for shared-key/dev deployments; account vaults are
-- looked up by owner_id. Exactly one identity per vault row.
--
-- Applied to the hosted project as migration `vault_owner_accounts`; this
-- copy keeps the schema in the repo.

alter table public.vaults alter column key_hash drop not null;
alter table public.vaults add column owner_id uuid unique references auth.users (id) on delete cascade;
alter table public.vaults add constraint vaults_identity_check
  check (key_hash is not null or owner_id is not null);
