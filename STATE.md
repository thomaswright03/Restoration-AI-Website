# Room Designer 3D: STATE

3D bathroom designer for remodel/restoration businesses: layout, fixtures and finishes, estimate at the business's own prices, saved client projects, Stripe plans (Starter/Pro/Max). Static HTML + Vercel functions + Supabase + Stripe; EN/ES/PT-BR. See README.md. Live in production (live Stripe keys).

## Status (2026-10-20, grade 74 at c6b475c; fixes merged in 6eef5ef)

- /admin status page and /admin/status.json are live (env vars set 2026-10-20; 401 without credentials). Rows: Stripe webhook deliveries (endpoint enabled, no events undelivered >30 min), Deployed version (commit + real go-live time from GitHub deployment status), database, backups, kill switches.
- WebKit iPhone CI job passed on main (run 39502061990); recorded in docs/live-check.md.
- Alerts: sendAlert emails server errors via Resend (throttled); test route /api/alert-test.
- Backups: daily encrypted dump, restored into empty Postgres 17 and table counts checked every run; heartbeat fails if last good backup >36 h. 24 h recovery point accepted (Free plan).
- Branch protection on main enforced; required check is the gate job that needs all 4 e2e shards.
- Free week for new accounts; one free trial per email (used_trials hash); past_due keeps the plan.
- Phone designer: first screen shows Riley's question and the size question at 390x844 (tests/e2e/simple.spec.js).
- Checks: `npm run check` (lint, prettier, both tsc, page sync, 309 unit tests). After editing STATE.md run `npx prettier --write STATE.md`.

## Open

- js/studio.js is ~6.7k lines in one closure, strictNullChecks off: split deferred by owner until the next big designer change (full browser suite after each step).
- Vercel rollback rehearsal not logged in docs/live-check.md; Supabase-restore drill impossible on the Free plan (project limit).
- site-config.json company.timeZone is blank, so /admin shows times in the viewer's zone: needs the owner's zone.
- Browser suite is slow (15-26 min unsharded); profile slowest specs.
- Legacy leads card/table kept (removal drops live data; owner OK needed).
- Legal items are Thomas's: DPAs, consent checkbox, sub-processor list, blank owner/privacy fields in site-config.json.

## Round 3 (grade fix)

- Latest update card rewritten for the PR #20 round (en/es/pt; source pages/account.html + pages/strings/account.json).
- Deployed version row is Warning when the deploy time isn't found (tested); 20-type webhook limit commented.
- Still open (owner): Vercel rollback rehearsal log, company.timeZone, one live bearer-token /admin/status.json read, studio.js split.
