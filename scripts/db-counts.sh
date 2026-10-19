#!/usr/bin/env bash
# Prints "<table> <rows>" for every table the backup holds (the public
# tables, auth.users and auth.identities), sorted, one per line. Used by
# .github/workflows/backup.yml on the live database before the dump and on
# the scratch database after the restore check (scripts/restore-check.sh).
# Usage: scripts/db-counts.sh <postgres-url>   (PG_BIN: where psql is)
set -euo pipefail
db="$1"
psql="${PG_BIN:+$PG_BIN/}psql"
tables=$("$psql" "$db" -X -At -v ON_ERROR_STOP=1 -c "
  select format('%I.%I', table_schema, table_name) from information_schema.tables
  where table_type = 'BASE TABLE'
    and (table_schema = 'public' or (table_schema = 'auth' and table_name in ('users', 'identities')))
  order by 1")
for t in $tables; do
  echo "$t $("$psql" "$db" -X -At -v ON_ERROR_STOP=1 -c "select count(*) from $t")"
done
