#!/usr/bin/env bash
# Rehearses a restore of one backup (docs/backups.md) into an empty scratch
# Postgres, then checks every table came back with the row count the live
# database had when the backup was taken (dump/counts.txt). Run by
# .github/workflows/backup.yml after each backup, on the decrypted copy.
#
# The scratch database gets the parts of Supabase the dumps lean on (the
# roles, auth.uid(), pgcrypto in the extensions schema), then: the
# auth.users/identities tables, the app's tables and functions, all the rows
# with triggers and foreign-key checks off (as in the documented restore), and
# last the keys, indexes, policies and triggers, which also proves the rows
# satisfy them.
#
# Usage: scripts/restore-check.sh <dump-dir> <scratch-postgres-url>
# (PG_BIN: where psql and pg_restore are). Prints only table names and
# "match"/"MISMATCH", never the counts: the repo and its logs are public.
set -euo pipefail
dir="$1"
db="$2"
bin="${PG_BIN:+$PG_BIN/}"

"${bin}psql" "$db" -X -q -v ON_ERROR_STOP=1 <<'SQL'
-- The dump creates the public schema itself.
drop schema if exists public cascade;
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role; end if;
  if not exists (select from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin; end if;
end $$;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $f$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$f$;
SQL
# Supabase resolves digest() and friends through the extensions schema.
export PGOPTIONS="-c search_path=public,extensions"

restore() { "${bin}pg_restore" --dbname "$db" --no-owner --no-privileges --exit-on-error "$@"; }
restore --section=pre-data "$dir/auth-schema.dump"
restore --section=pre-data "$dir/public.dump"
PGOPTIONS="$PGOPTIONS -c session_replication_role=replica" restore --data-only "$dir/auth.dump"
PGOPTIONS="$PGOPTIONS -c session_replication_role=replica" restore --section=data "$dir/public.dump"
restore --section=post-data "$dir/auth-schema.dump"
restore --section=post-data "$dir/public.dump"

PG_BIN="${PG_BIN:-}" "$(dirname "$0")/db-counts.sh" "$db" > "$dir/restored-counts.txt"
bad=0
while read -r table want; do
  got=$(awk -v t="$table" '$1 == t { print $2 }' "$dir/restored-counts.txt")
  if [ "$got" = "$want" ]; then echo "match    $table"; else echo "MISMATCH $table"; bad=1; fi
done < "$dir/counts.txt"
[ "$bad" = 0 ] || { echo "::error::Restore check failed: a table came back with a different row count."; exit 1; }
echo "Restore check passed: $(wc -l < "$dir/counts.txt") tables restored with the same row counts."
