# Room Designer 3D: STATE

3D bathroom designer for remodel/restoration businesses: layout, fixtures and finishes, estimate at the business's own prices, saved client projects, Stripe plans (Starter/Pro/Max). Static HTML + Vercel functions + Supabase + Stripe; EN/ES/PT-BR. See README.md.

## Status (2026-10-15, Excellence fix round 1; last grade 76/100)

Done this round:

- past_due now keeps the plan (grace window while Stripe retries); unpaid/canceled still drop to Free. Account notice reworded in 3 languages; unit + e2e tests updated (api/_plans.js ACTIVE_STATUSES).
- js/studio.js and js/business.js are now in jsconfig.json checkJs (globals added to types/globals.d.ts). js/bathroom-room-3d.js is still unchecked.
- README now documents the Home Depot photo requests (images.thdstatic.com).
- Playwright: local workers default 3 (E2E_WORKERS overrides); added `npm run test:e2e:smoke` (3 small specs).
- `npm run check`: lint, prettier, both tsc, pages, 271 unit tests all pass.

- 2026-10-16: room shapes and windows (Thomas's ask). room.shape = L / T / U (notch) cut from the w x l box (js/room-plan.js "Room shapes"); shaped rooms' walls are w1..wN, lettered A.. clockwise; rectangles keep N/E/S/W. Windows live in design.windows (wall, offset, width, height, sill); they come off the wall area but have no install price.

## Not verified / still open

- Full e2e (168 tests) passed in 14.0 min on a 4-core sandbox with `CI=1 E2E_WORKERS=2` (2026-10-16). On GitHub's 2-core runner (1 worker) it took 26.5 min in run 96, close to the 30 min job limit.
- 2026-10-16: main CI was red for runs 96-98 (Prettier on STATE.md; walk-in e2e test past 30 s on the runner, now 60 s like its 3D siblings). Fixed in ab1328f; CI run 99 on main is GREEN (2026-10-16, 17.5 min).
- Branch protection: 2026-10-16 Thomas created a rule for main requiring the CI check "Lint, format, pages in sync, unit and browser tests". GitHub shows it NOT ENFORCED: private repo on a free personal account. It enforces only with GitHub Pro (or Team) or if the repo goes public. Thomas decided 2026-10-16 to leave it unenforced (no upgrade); CI still runs on every push.
- Live Stripe/Supabase/kill-switch test-mode run DONE 2026-10-16/17 (Thomas): all run steps passed; log in docs/live-check.md. Not run live: FREEWEEK succeeding on a first plan (unit + e2e cover it).
- studio.js (~5.2k lines) split not done; no visual QA at 375/1440 px light/dark.
- Free-trial rule DECIDED 2026-10-16 (Thomas): one free trial per email. Deleting an account that had a Stripe subscription keeps a SHA-256 of its email in used_trials (auth.users trigger, supabase/schema.sql); api/checkout.js refuses promo/TRIAL_DAYS days for that email. Privacy text updated (en/es/pt). Thomas re-ran supabase/schema.sql 2026-10-16 21:38 UTC, so it's live.
- Legal items (DPAs, consent checkbox, sub-processor list, contact fields in site-config.json) are Thomas's.
