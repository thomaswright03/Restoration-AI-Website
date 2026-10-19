# Database backups

Supabase's Free plan keeps no backups you can restore, so `.github/workflows/backup.yml` makes one every day (09:17 UTC): the `public` tables (businesses, projects, subscriptions, leads, switches, used trials, with their schema and policies) and the sign-in accounts (`auth.users` and `auth.identities` rows), compressed and encrypted with a passphrase, kept as a workflow artifact for 90 days (about 90 copies). The repo is public, so the copy is never stored unencrypted. A failed run emails the owner (GitHub's default for scheduled workflows).

## Setup (once)

In GitHub, **Settings > Secrets and variables > Actions > New repository secret**:

- `SUPABASE_DB_URL`: in Supabase, **Connect** (top bar) > **Session pooler** connection string (`postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`), with the database password filled in. Use the session pooler, not the direct connection: GitHub's runners have no IPv6, and the direct host on the Free plan is IPv6 only.
- `BACKUP_PASSPHRASE`: a long random password. Keep it in your password manager too: without it no backup can be opened.

Then **Actions > Database backup > Run workflow** once to check it works.

GitHub turns scheduled workflows off after 60 days with no commits to the repo; it emails first, and one click re-enables it.

## Restoring

1. **Actions > Database backup**, open a run, download the artifact and unzip it to get `db-backup-<date>.tar.gz.gpg`.
2. Decrypt: `gpg --decrypt db-backup-<date>.tar.gz.gpg | tar -xzf -` (asks for the passphrase) gives `dump/public.dump` and `dump/auth.dump`.
3. Into a new, empty Supabase project (or the same one after a wipe), with `pg_restore` 17 and its session pooler URL as `$DB`:
   1. Run `supabase/schema.sql` in its SQL editor, so the tables, policies and the `auth.users` triggers exist.
   2. The triggers on `auth.users` must not fire during the restore (`grant_free_week` would give every user a fresh free week and a new `used_trials` row, and the real rows would then clash). Run the restore with triggers off for the session, and empty the one row `schema.sql` seeded:
      ```
      psql "$DB" -c "truncate public.site_switches"
      export PGOPTIONS='-c session_replication_role=replica'
      pg_restore --dbname "$DB" --data-only --exit-on-error dump/auth.dump
      pg_restore --dbname "$DB" --data-only --exit-on-error dump/public.dump
      unset PGOPTIONS
      ```
      Accounts go first, because the app's tables point at `auth.users`. If the pooler refuses `session_replication_role`, run `alter table auth.users disable trigger grant_free_week, disable trigger remember_used_trial, disable trigger refuse_signup_when_paused;` in the SQL editor first and `enable` them again after.
   3. Check: `select count(*) from auth.users;` and `select count(*), status, plan from subscriptions group by 2,3;` match what the backup was taken from.
   4. If it's a new project, point Vercel's `SUPABASE_*` variables at it and redeploy.

`public.dump` also holds the schema as it was on the day, so `pg_restore --schema-only dump/public.dump -f schema.sql` shows it when `supabase/schema.sql` has changed since. To restore one table, add `--table=<name>` to the second command.

## Recovery point and time

- **Recovery point: up to 24 hours** of saved work can be lost (daily backup; the Free plan has no point-in-time recovery). The owner accepts this until the project moves to a paid Supabase plan.
- **Recovery time: about 1 to 2 hours** (decrypt, new project, the steps above, point Vercel at it, redeploy).
- **One project deleted by mistake:** restore into a scratch project as above, then `select * from projects where id = '<id>'` there and re-insert the row in production. To pull only that table out of the dump: `pg_restore --data-only --table=projects dump/public.dump -f projects.sql`.

## Status

The restore steps have not yet been rehearsed into a scratch project; record the date and the row counts in `docs/live-check.md` when they are.
