# Database backups

Supabase's Free plan keeps no backups you can restore, so `.github/workflows/backup.yml` makes one every Monday (09:17 UTC): the `public` tables (businesses, projects, subscriptions, leads, switches, used trials, with their schema and policies) and the sign-in accounts (`auth` rows), compressed and encrypted with a passphrase, kept as a workflow artifact for 90 days (about 13 copies). The repo is public, so the copy is never stored unencrypted. A failed run emails the owner (GitHub's default for scheduled workflows).

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
   1. Run `supabase/schema.sql` in its SQL editor, so the tables, policies and the `auth.users` trigger exist.
   2. Restore the accounts, then the app's rows (accounts first, because the app's tables point at `auth.users`):
      ```
      pg_restore --dbname "$DB" --data-only dump/auth.dump
      pg_restore --dbname "$DB" --data-only dump/public.dump
      ```
   3. If it's a new project, point Vercel's `SUPABASE_*` variables at it and redeploy.

`public.dump` also holds the schema as it was on the day, so `pg_restore --schema-only dump/public.dump -f schema.sql` shows it when `supabase/schema.sql` has changed since. To restore one table, add `--table=<name>` to the second command.
