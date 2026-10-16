# Room Designer 3D: STATE

3D bathroom designer for remodel/restoration businesses: layout, fixtures and finishes, estimate at the business's own prices, saved client projects, Stripe plans (Starter/Pro/Max). Static HTML + Vercel functions + Supabase + Stripe; EN/ES/PT-BR. See README.md.

## Status (2026-10-15, Excellence fix round 1; last grade 76/100)

Done this round:

- past_due now keeps the plan (grace window while Stripe retries); unpaid/canceled still drop to Free. Account notice reworded in 3 languages; unit + e2e tests updated (api/_plans.js ACTIVE_STATUSES).
- js/studio.js and js/business.js are now in jsconfig.json checkJs (globals added to types/globals.d.ts). js/bathroom-room-3d.js is still unchecked.
- README now documents the Home Depot photo requests (images.thdstatic.com).
- Playwright: local workers default 3 (E2E_WORKERS overrides); added `npm run test:e2e:smoke` (3 small specs).
- `npm run check`: lint, prettier, both tsc, pages, 271 unit tests all pass.

## Not verified / still open

- Full e2e (168 tests) passed in 14.0 min on a 4-core sandbox with `CI=1 E2E_WORKERS=2` (2026-10-16). On GitHub's 2-core runner (1 worker) it took 26.5 min in run 96, close to the 30 min job limit.
- 2026-10-16: main CI was red for runs 96-98 (Prettier on STATE.md; walk-in e2e test past 30 s on the runner, now 60 s like its 3D siblings). Fixed and pushed; CI result recorded below once it finishes.
- Branch protection: main is NOT protected as of 2026-10-16. Thomas to add a rule requiring the CI check (Settings > Branches).
- Live Stripe/Supabase/kill-switch test-mode run needs Thomas's credentials; log in docs/live-check.md.
- studio.js (~5.2k lines) split not done; no visual QA at 375/1440 px light/dark.
- Free-trial rule resets on account delete + re-signup (api/checkout.js:119): Thomas to decide.
- Legal items (DPAs, consent checkbox, sub-processor list, contact fields in site-config.json) are Thomas's.
