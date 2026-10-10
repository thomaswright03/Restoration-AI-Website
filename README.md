# Room Designer 3D

A 3D bathroom designer and estimator that remodeling and restoration businesses sign up for and pay for. The business designs a customer's bathroom in 3D, gets a rough estimate at its own labor prices, and saves it as a project.

A product of Wright AI Solutions, LLC. The designer itself started as the one built for a client site and was made multi-business here: every business name, phone, email and price comes from the subscriber's account.

## How it works

- **Landing page** (`index.html`): what it is, pricing, FAQ, sign-up.
- **Live demo** (`designer.html`): the full designer, speaking for a sample business.
- **Sign-up / log in** (`signup.html`) and **account** (`account.html`): pick a plan (Stripe Checkout; a promo code makes the first week free), set the business details and labor prices, read requests homeowners sent before the designer became owner-only, and delete the account. After logging in, people land on My projects, or on the page `?next=` names (a path on this site; the pages that send someone to log in add it), or on the account page when the link carries a plan or promo code. Signed in, the header shows My projects, Account and Log out in place of Pricing and Get started.
- **My projects** (`projects.html`): a subscriber's saved designs, with the client and address, to search, open, rename or delete, and what their plan allows. In the designer, a signed-in subscriber gets a bar above the studio to save the design as a project; the first save asks for the client's details.
- **A project's page** (`project.html?id=`): the 3D model, the info (client, phone, email, address with unit/apt, job type, status, start date, notes) and the materials list worked out when the design was last saved, printable.
- **Plans and limits** (`api/_plans.js`): Free can use the designer but can't save projects. Starter 10 new projects a month and 50 kept at once, Pro 25 and 100, Max 100 and 1000. Deleting a project frees a slot under the total but not the month's allowance (calendar month, UTC). The server enforces both (`api/projects.js` and the `create_project()` database function).
- **A business's designer**: `designer.html?b=<their-slug>`. It opens only for the business's own signed-in owner (from My projects), on every plan; while the plan isn't active it's a preview with a banner. Anyone else gets a "not available" notice. It can't be framed by other sites. (The old "Put it on your website" add-on is retired; `subscriptions.website` is left in the schema, unused.)
- **Delete account** (`api/account.js`): on the account page, confirmed by typing the sign-in email. Cancels the Stripe subscription, then deletes the auth user; the database cascades that to the business, its requests, the subscription row and every project. Stripe keeps the customer and invoices.

Everything is in English, Spanish and Brazilian Portuguese (`es/`, `pt/`).

## Stack

- Static pages (plain HTML/CSS/JS, Three.js for the 3D room), hosted on Vercel. No framework, no build step at deploy time.
- Vercel functions in `api/` (Node 20, no npm packages; they call Stripe and Supabase over REST):
  - `config.js`: tells the browser whether accounts and payments are on, the public Supabase keys, and which switches are off (see "Pausing the product"); `?fresh=1` reads the switches past their 15-second cache, which the sign-up page uses to explain a refused sign-up
  - `business.js`: a business's public profile, loaded by the designer page as a script
  - `checkout.js` / `portal.js`: Stripe Checkout (a plan named as `starter`, `pro` or `max`, with an optional promo code; any other plan is refused with `400 {error:"plan"}`) and the Stripe billing portal
  - `account.js`: deletes the signed-in user's account
  - `projects.js`: a subscriber's projects (list, open, save, rename, delete), within their plan's limits
  - `stripe-webhook.js`: records subscription status and which plan, in Supabase (an event for an account that was deleted is acknowledged and logged, not retried)
  - `_switches.js`: the kill switch (below); `_subscriptions.js`: reading and recording a subscription, which statuses count as running, and which business a designer link opens; `_plans.js`: plans, limits and the `STRIPE_PRICE_*` mapping (the plan follows the subscription's current price whenever that price maps to one, else the stored `plan`); `_lib.js`: shared helpers (timeouts, retries, JSON answers, Stripe and Supabase calls)
  - Every call to Supabase or Stripe has an 8-second timeout, and every answer is JSON: `401 {error:"signin"}` (no sign-in), `503 {error:"unavailable"}` (Supabase Auth didn't answer), `503 {error:"paused"}` (switched off), `502 {error:"server"}` or `{error:"stripe"}` (an upstream failed). Stripe calls are pinned to one API version (`STRIPE_API_VERSION` in `api/_lib.js`, overridable by the env var of the same name) and session creation carries idempotency keys. Reads, and creates sent with an idempotency key (Checkout and portal sessions), are tried once more after a dropped connection, a 5xx or a 429 (Retry-After honoured, within the function's budget); plain writes and timeouts never are. Before starting a checkout, the server asks Stripe whether the account already has a subscription that's running or still confirming its first payment (`active`, `trialing`, `past_due`, `unpaid`, `paused` or `incomplete`; by customer, or by email when the first webhook hasn't landed yet) and refuses a second one with `409 {error:"already-subscribed"}`.
- Supabase for accounts (Supabase Auth) and the database (`supabase/schema.sql`: businesses, subscriptions, leads, projects, with row-level security).
- With no keys set, the site runs in demo mode: the demo designer works, and sign-up says accounts aren't switched on yet.

## Architecture

**Request flow.** Every page is a static file Vercel serves from the repo as committed (`npm run pages` is run by hand and the result committed; nothing is built at deploy). The browser then talks to two kinds of things:

1. `api/*` Vercel functions, same origin. `GET /api/config` says whether accounts and payments are on and hands out the public Supabase URL and anon key; the pages sign in with Supabase Auth directly from the browser (`js/vendor/supabase/supabase.js`, loaded only on signed-in pages) and send the access token as a bearer to `/api/projects`, `/api/account`, `/api/checkout` and `/api/portal`, which check it with Supabase (`api/_lib.js currentUser()`) and then read or write with the service-role key. `GET /api/business?b=<slug>` is public and is what `designer.html?b=` loads. `POST /api/stripe-webhook` is called by Stripe, verified by signature, and is the only writer of `subscriptions`.
2. Static data the designer fetches itself: `site-config.json` (settings, below), `models/**/*.glb` (3D fixtures and products) and the vendored libraries in `js/vendor/`. No third-party request is made from a page except Stripe Checkout and the billing portal, which are redirects.

**Data stores.**

- Supabase Postgres (`supabase/schema.sql`): `businesses` (one per account: slug, name, phone, email, legal name, labor prices), `subscriptions` (one per account, written by the Stripe webhook: status, plan, price id, period end), `leads` (requests from before the designer became owner-only), `projects` (a saved design: the design string, the client info and the estimate summary as JSON) and `project_creations` (one row per save, for the monthly allowance). Row-level security lets the anon key read nothing; the functions use the service-role key and check ownership themselves.
- Supabase Auth: the users. Deleting a user cascades through every table above.
- Stripe: customers, subscriptions and invoices. Supabase keeps only the mirror the webhook writes.
- The browser's localStorage: the designer's working draft (`rd3d_design_<slug>`), the language, the theme and Riley's voice. Nothing there is needed by the server.

**Caching.** `vercel.json` caches by whether a path's name changes with its content. Only the versioned Three.js folder (`js/vendor/three-r186/`, listed file by file so a missing path is never frozen) is `immutable` for a year; upgrading Three.js means a new folder (`js/vendor/three-r187/`), updating the import map in `pages/layout.html`, `npm run pages`, and the new file list in `vercel.json` (the unit test says which). `models/**/*.glb`, `fonts/**`, `images/**` and the unversioned libraries (`js/vendor/jspdf.umd.min.js`, `js/vendor/supabase/`) are edited in place under the same name, so they get `max-age=86400, stale-while-revalidate=604800`: a repeat visit within a day asks for nothing, and a changed file reaches returning browsers within a day. Pages and `site-config.json` keep Vercel's revalidate-every-time default; first-party `js/*.js`, `js/i18n/*.js` and `css/*.css` are `max-age=0, must-revalidate` with no `stale-while-revalidate` (a cached copy is checked against the server on every load, a 304 when unchanged), so a deploy is live for everyone on the next page load and a new page is never run with the previous deploy's script. `tests/unit/vercel-config.test.js` pins all of this.

## Settings (`site-config.json`)

The one place for the owner's settings; edit, commit and push. `plans` (the prices the pages show and the project limits the server enforces; run `npm run pages` after changing them), `company.supportEmail` (the footer and the legal pages), `priceEstimator.enabled` (the estimate step prices the work at the business's labor rates; off shows the design only), `materialsEstimator.enabled` (the finishes step offers materials from the catalog in `js/materials-pricing.js`, added to the estimate), `owner` and `privacy` (the legal pages), and `riley.voice` (a default voice name per language). `js/site-config.js` reads it and applies the defaults when it can't be loaded.

## Going live (one-time setup)

1. **Supabase**: create a project. In SQL Editor, run `supabase/schema.sql` (and run it again whenever it changes; it's safe to re-run). In Authentication > URL Configuration, set the Site URL to your domain and add `https://<domain>/account.html`, `/es/account.html` and `/pt/account.html` as redirect URLs.
2. **Stripe**: create three monthly recurring prices, one per plan (Starter, Pro, Max), with lookup keys `starter`, `pro` and `max`. Put their IDs in `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO` and `STRIPE_PRICE_MAX`. Add a webhook to `https://<domain>/api/stripe-webhook` for `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`. Turn on the customer portal (Settings > Billing > Customer portal).
   Promo codes: `PROMO_CODES` (default `FREEWEEK`) lists the codes people type on the account page; a valid one makes the first `plans.promoFreeDays` days (7) of an account's first plan free, as a Stripe trial (card taken at checkout, first charge when it ends). Add a code with its own length as `CODE:days`, e.g. `FREEWEEK,LAUNCH30:30`, or set `none` to turn codes off. Changing the variable needs a redeploy in Vercel.
3. **Vercel**: import this repo as a project (no build settings needed) and set the environment variables in `.env.example`.
4. Keep the prices shown on the site equal to Stripe: edit `plans` in `site-config.json` (prices, and the project limits the server enforces), run `npm run pages`, commit.

Start with Stripe test keys; switch to live keys once a test sign-up, checkout and saved project all work.

## Deploying, rolling back and changing the schema

**Deploy.** Every push to `main` deploys (Vercel's Git integration); pull requests get a preview URL. CI (`.github/workflows/ci.yml`) runs lint, formatting, the type check, the pages check, unit and browser tests on every push and PR, so merge only green branches. There is no build, so a deploy is exactly the committed files plus the functions in `api/`.

**Roll back.** Vercel keeps every deployment. In the Vercel project, open **Deployments**, find the last good one, and choose **Promote to Production** (or **Instant Rollback** on the current production deployment, which promotes the previous one). That takes effect within seconds and needs no commit; the environment variables stay as they are. Then fix `main` (revert the merge commit with `git revert -m 1 <merge sha>`, or push a fix) so the next deploy doesn't bring the problem back. A rollback does not touch Supabase or Stripe: if the bad release also changed the schema, see below.

**Schema changes.** The whole schema lives in `supabase/schema.sql` and is applied by hand: paste it into the Supabase SQL Editor and run it. There are no migration files, so every statement in it must be safe to run on a database that already has the previous version (`create table if not exists`, `alter table ... add column if not exists`, `create or replace function`, `drop policy if exists` before `create policy`). To change the schema:

1. Edit `supabase/schema.sql` additively (new columns with defaults, new tables, replaced functions). Never rename or drop in the same change that the code starts relying on something new.
2. Run the file in the SQL Editor **before** merging code that needs the change, so the old code and the new both work against the database (the functions answer `{ "error": "setup" }` with a 503 when a table they need is missing).
3. Merge the code. If it has to be rolled back, the schema can stay as it is: additive changes are harmless to older code.
4. To undo a schema change, write the reverse as its own statements (`alter table ... drop column if exists ...`), run them once in the SQL Editor, and remove the forward statements from `schema.sql` in the same commit, so a fresh database and an existing one end up the same. Take a backup first (Supabase > Database > Backups) when a drop loses data.

The retired `subscriptions.website` column and the `leads` table are kept this way: nothing writes them, and dropping them is a one-line reverse step once the old requests have been dealt with.

## Pausing the product (kill switch)

Sign-ups, buying a plan and saving projects can each be stopped without a deploy, from the Supabase dashboard:

1. Table Editor > `site_switches`. It has one row (`id` 1).
2. Set `signups`, `checkout` or `saving` to **false** to stop that part; set it back to **true** to resume. Optionally type a short message in `notice`; it's shown as written at the top of the account and sign-up pages while it isn't empty.
3. Save the row. Within 15 seconds (the API caches it that long) every function refuses the switched-off action with `503 {"error":"paused"}`, and the pages explain it in the visitor's language:
   - `signups` off: the sign-up page shows "New sign-ups are paused" and offers only Log in; a trigger on `auth.users` refuses a new account even for a request made outside the page. Existing users can still log in.
   - `checkout` off: the account page's plan card says buying a plan is paused and shows no buy buttons; `/api/checkout` refuses. Existing subscriptions keep running, and Manage billing still works.
   - `saving` off: `/api/projects` refuses saving a design (new or again); reading, renaming, editing details and deleting still work. The designer's save bar and My projects read the switch from `/api/config` on load and say saving is paused (with the notice) before anyone fills in the save dialog.

If the table doesn't exist yet (re-run `supabase/schema.sql`), every switch counts as on. The row is read with a 1.5 s limit so `/api/config` stays fast when the database is slow; if the read fails, the switches stay as they were last read (all on if they never were): the switch is for stopping the product on purpose, not for an outage. Every API error is logged as one JSON line with the route, a request id (also returned to the browser as `requestId`), the user id and the error word. Unit tests: `tests/unit/switches-robustness.test.js`.

## Editing pages and text

Pages are built from templates so the three languages can't drift apart:

- `pages/layout.html`: shared head, header and footer
- `pages/<page>.html`: each page's content
- `pages/strings/*.json`: every text as `"key": ["English", "Español", "Português"]`

After editing, run `npm run pages` and commit the rebuilt `*.html`, `es/*.html` and `pt/*.html`. CI fails if a built page is stale or a text is missing a translation. Text shown by JavaScript (the design studio, estimate, forms, account page messages) lives in `js/i18n.js`, also in all three languages. The pages don't load that file: `npm run pages` also generates `js/i18n/en.js`, `js/i18n/es.js` and `js/i18n/pt.js` from it (`scripts/build-i18n.mjs`), one language each and a third of the size, and each page loads only its own (`pages/layout.html`). Commit them with the pages; `npm run check:pages` fails when they're out of date. Node and the unit tests keep loading the full `js/i18n.js`.

## The designer code

The designer is a six-step studio: **Room** (a common bathroom to start from, measurements in feet and inches, the wall the plumbing stack is in, doors), **Layout** (add fixtures and move them in 3D or on the floor plan), **Electrical** (outlets, switches, lights and the fan, suggested from the layout and movable along their walls), **Products** (Kohler models, shown at their real size), **Finishes** (demolition, floor, walls, ceiling) and **Estimate** (the price at the business's labor rates, a PDF with a picture and the floor plan, a link to the design and, for the signed-in owner, Save project; the public demo ends with what a business gets and a link to sign up). The Kohler and Sterling products in the room are listed with their model numbers but not priced: there is no store price feed. Every move is checked as it happens: a fixture that overlaps, blocks the door, lacks the clearance it needs or sits too far from the plumbing to drain turns red and says why in plain words, and "Show me layouts that fit" rearranges the whole room.

Riley (`js/riley.js`) talks the person through it: what each step is for, and, when something won't work, what she can do instead, with a button that does it. She speaks out loud with the browser's own speech in the page's language, and can be muted. The wave button on her bubble (or `designer.html?voices`) lists the voices this device has for the language, plays a sample in each, and remembers the pick in this browser; `riley.voice` in `site-config.json` sets a default voice name per language. The voices come from each visitor's device and browser, so she sounds different on a Mac, Windows, Android or iPhone.

- `js/business.js`: which business the page is for (`?b=`), applies its name, phone and prices
- `js/room-plan.js`: the room engine, with no drawing (walls, fixture sizes, clearance rules, the plumbing stack and how far a drain can run from it, suggesting the electrical, finding spots, arranging the room, snapping a dragged fixture, share links). Also runs in Node for the unit tests.
- `js/studio.js`: the studio: steps, panel, floor plan, dragging, undo/redo, estimate, PDF, saving the design in the browser
- `js/bathroom-room-3d.js`: draws the room in 3D (Three.js) and reports what was clicked or dragged; `js/bathroom-room-layout.js` and `js/surface-finishes.js` feed it
- `js/bathroom-pricing.js`: the estimate math and default labor prices. The studio prices every line at the business's own rates (set on the account page): demolition, surfaces, each fixture (the bathtub at its own price, or 70% of the shower price when left empty), plumbing per point (one per toilet, sink, vanity, shower and bathtub), electrical per point and any new drain line per foot. The model can also add the flat surcharges (no stack, bad valve), but the studio never sets the surcharge flags, so they don't reach an estimate today. No tax is added: the estimate says taxes aren't included.
- `js/materials-pricing.js`: the materials catalog the finishes step offers. Prices were copied by hand from Home Depot listings and go stale, so the estimate and the PDF say "catalog prices as of <month>" from the file's `PRICES_AS_OF` date (set it when you refresh them; the unit tests warn once it's six months old); the file's header says how to refresh or add one (there is no generator script)
- `js/estimate-pdf.js`: the PDF
- `js/riley.js`: Riley's bubble and her voice (the browser's own speech; no network, no key)
- `js/script.js`: the header menu, the language menu, the offline notice, scroll reveal and the FAQ
- `js/net.js`: the one way the signed-in pages call `/api/*`: a JSON fetch with a time limit that tells offline, timed out, a server failure and an HTTP error apart (also runs in Node for the unit tests)
- `js/site-config.js`: loads `site-config.json` and applies it to the page (`data-fill`, `data-show-if`), with defaults when it can't be loaded
- `js/theme.js`: the Light / Dark / System switch
- `js/product-photos.js`: generated by `tools/photos/build-product-photos.mjs`, the products' listing photos; don't edit by hand
- `models/`: GLB fixture and product models; `tools/models/` converts OBJ sources to GLB and `models/products/*/manifest.json` records each model's source and conversion arguments (the OBJ sources themselves are not in the repo)
- `js/vendor/`: Three.js r186 in `three-r186/` (the minified `three.module.js`/`three.core.js` build and the addons used), jsPDF and the Supabase client, self-hosted so no page loads a third-party script
- `js/account.js`: sign-up and account pages
- `js/projects.js`: the My projects page and the designer's save bar

## Checks

```
npm ci
npm run check      # lint, formatting, type check, pages in sync, unit tests
npx playwright install chromium   # once per machine, before the browser tests
npm run test:e2e   # browser tests (Playwright; E2E_PORT=4400 to pick the port)
npm run serve      # local server at http://localhost:8000, runs api/ like Vercel
npm test           # check and test:e2e in one go
```

**Type check.** `npm run typecheck` runs TypeScript's `checkJs` (no build, nothing is emitted) over `api/**`, the pure modules that also run in Node (`js/room-plan.js`, `js/surface-finishes.js`, `js/net.js`, `js/i18n.js`, `js/bathroom-pricing.js`, `js/materials-pricing.js`) and `js/estimate-pdf.js` (`jsconfig.json` lists them; `types/globals.d.ts` declares the window globals and the tags put on Error objects). It's not strict, and the page scripts (`js/studio.js`, `js/projects.js`, `js/account.js`, ...) aren't covered yet: add a file to `include` once it passes.

**Running locally with keys.** `npm run serve` reads `.env.local` in the repo root when it exists (copy `.env.example`; a variable already set in the shell wins), so the functions talk to your Supabase and Stripe test projects. Without it, demo mode. The browser tests never read it.

`vercel.json` sets the security headers (no page may be framed by other sites) and the caching rules above. `robots.txt` and `sitemap.xml` are built by `npm run pages`. Review findings and what's still open live with the reviews in the project files, not in the repo.
