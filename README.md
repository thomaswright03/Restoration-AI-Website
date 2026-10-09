# Room Designer 3D

A 3D bathroom designer and estimator that remodeling and restoration businesses sign up for and pay for. The business designs a customer's bathroom in 3D, gets a rough estimate at its own labor prices, and saves it as a project.

A product of Wright AI Solutions, LLC. The designer itself started as the one built for a client site and was made multi-business here: every business name, phone, email and price comes from the subscriber's account.

## How it works

- **Landing page** (`index.html`): what it is, pricing, FAQ, sign-up.
- **Live demo** (`designer.html`): the full designer, speaking for a sample business.
- **Sign-up / log in** (`signup.html`) and **account** (`account.html`): pick a plan (Stripe Checkout; a promo code makes the first week free), set the business details and labor prices, read requests homeowners sent before the designer became owner-only, and delete the account.
- **My projects** (`projects.html`): a subscriber's saved designs, with the client and address, to search, open, rename or delete, and what their plan allows. In the designer, a signed-in subscriber gets a bar above the studio to save the design as a project; the first save asks for the client's details .
- **A project's page** (`project.html?id=`): the 3D model, the info (client, phone, email, address with unit/apt, job type, status, start date, notes) and the materials list worked out when the design was last saved, printable.
- **Plans and limits** (`api/_plans.js`): Free can use the designer but can't save projects. Starter 10 new projects a month and 50 kept at once, Pro 25 and 100, Max 100 and 1000. Deleting a project frees a slot under the total but not the month's allowance (calendar month, UTC). The server enforces both (`api/projects.js` and the `create_project()` database function).
- **A business's designer**: `designer.html?b=<their-slug>`. It opens only for the business's own signed-in owner (from My projects), on every plan; while the plan isn't active it's a preview with a banner. Anyone else gets a "not available" notice. It has no request form (only the public demo does) and can't be framed by other sites. (The old "Put it on your website" add-on is retired; `subscriptions.website` is left in the schema, unused.)
- **Delete account** (`api/account.js`): on the account page, confirmed by typing the sign-in email. Cancels the Stripe subscription, then deletes the auth user; the database cascades that to the business, its requests, the subscription row and every project. Stripe keeps the customer and invoices.

Everything is in English, Spanish and Brazilian Portuguese (`es/`, `pt/`).

## Stack

- Static pages (plain HTML/CSS/JS, Three.js for the 3D room), hosted on Vercel. No framework, no build step at deploy time.
- Vercel functions in `api/` (Node 20, no npm packages; they call Stripe and Supabase over REST):
  - `config.js`: tells the browser whether accounts and payments are on, the public Supabase keys, and which switches are off (see "Pausing the product")
  - `business.js`: a business's public profile, loaded by the designer page as a script
  - `leads.js`: answers the public demo's request form (nothing is kept); refuses requests for any business
  - `checkout.js` / `portal.js`: Stripe Checkout (a plan, with an optional promo code) and the Stripe billing portal
  - `account.js`: deletes the signed-in user's account
  - `projects.js`: a subscriber's projects (list, open, save, rename, delete), within their plan's limits
  - `stripe-webhook.js`: records subscription status and which plan, in Supabase (an event for an account that was deleted is acknowledged and logged, not retried)
  - `_switches.js`: the kill switch (below); `_subscriptions.js`: recording a subscription; `_plans.js`: plans and limits; `_lib.js`: shared helpers
  - Every call to Supabase or Stripe has an 8-second timeout, and every answer is JSON: `401 {error:"signin"}` (no sign-in), `503 {error:"unavailable"}` (Supabase Auth didn't answer), `503 {error:"paused"}` (switched off), `502 {error:"server"}` or `{error:"stripe"}` (an upstream failed). Stripe calls are pinned to one API version (`STRIPE_API_VERSION` in `api/_lib.js`, overridable by the env var of the same name) and session creation carries idempotency keys. Before starting a checkout, the server asks Stripe whether the account already has a subscription that's running (by customer, or by email when the first webhook hasn't landed yet) and refuses a second one with `409 {error:"already-subscribed"}`.
- Supabase for accounts (Supabase Auth) and the database (`supabase/schema.sql`: businesses, subscriptions, leads, projects, with row-level security).
- With no keys set, the site runs in demo mode: the demo designer works, and sign-up says accounts aren't switched on yet.

## Going live (one-time setup)

1. **Supabase**: create a project. In SQL Editor, run `supabase/schema.sql` (and run it again whenever it changes; it's safe to re-run). In Authentication > URL Configuration, set the Site URL to your domain and add `https://<domain>/account.html`, `/es/account.html` and `/pt/account.html` as redirect URLs.
2. **Stripe**: create three monthly recurring prices, one per plan (Starter, Pro, Max), with lookup keys `starter`, `pro` and `max`. Put their IDs in `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO` and `STRIPE_PRICE_MAX`. Add a webhook to `https://<domain>/api/stripe-webhook` for `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`. Turn on the customer portal (Settings > Billing > Customer portal).
   Promo codes: `PROMO_CODES` (default `FREEWEEK`) lists the codes people type on the account page; a valid one makes the first `plans.promoFreeDays` days (7) of an account's first plan free, as a Stripe trial (card taken at checkout, first charge when it ends). Add a code with its own length as `CODE:days`, e.g. `FREEWEEK,LAUNCH30:30`, or set `none` to turn codes off. Changing the variable needs a redeploy in Vercel.
3. **Vercel**: import this repo as a project (no build settings needed) and set the environment variables in `.env.example`.
4. Keep the prices shown on the site equal to Stripe: edit `plans` in `site-config.json` (prices, and the project limits the server enforces), run `npm run pages`, commit.

Start with Stripe test keys; switch to live keys once a test sign-up, checkout and request all work.

## Pausing the product (kill switch)

Sign-ups, buying a plan and saving projects can each be stopped without a deploy, from the Supabase dashboard:

1. Table Editor > `site_switches`. It has one row (`id` 1).
2. Set `signups`, `checkout` or `saving` to **false** to stop that part; set it back to **true** to resume. Optionally type a short message in `notice`; it's shown as written at the top of the account and sign-up pages while it isn't empty.
3. Save the row. Within 15 seconds (the API caches it that long) every function refuses the switched-off action with `503 {"error":"paused"}`, and the pages explain it in the visitor's language:
   - `signups` off: the sign-up page shows "New sign-ups are paused" and offers only Log in; a trigger on `auth.users` refuses a new account even for a request made outside the page. Existing users can still log in.
   - `checkout` off: the account page's plan card says buying a plan is paused and shows no buy buttons; `/api/checkout` refuses. Existing subscriptions keep running, and Manage billing still works.
   - `saving` off: `/api/projects` refuses saving a design (new or again); reading, renaming, editing details and deleting still work.

If the table doesn't exist yet (re-run `supabase/schema.sql`), or the database can't be reached, every switch counts as on: the switch is for stopping the product on purpose, not for an outage. Unit tests: `tests/unit/switches-robustness.test.js`.

## Editing pages and text

Pages are built from templates so the three languages can't drift apart:

- `pages/layout.html`: shared head, header and footer
- `pages/<page>.html`: each page's content
- `pages/strings/*.json`: every text as `"key": ["English", "Español", "Português"]`

After editing, run `npm run pages` and commit the rebuilt `*.html`, `es/*.html` and `pt/*.html`. CI fails if a built page is stale or a text is missing a translation. Text shown by JavaScript (the design studio, estimate, forms, account page messages) lives in `js/i18n.js`, also in all three languages.

## The designer code

The designer is a six-step studio: **Room** (a common bathroom to start from, measurements in feet and inches, the wall the plumbing stack is in, doors), **Layout** (add fixtures and move them in 3D or on the floor plan), **Electrical** (outlets, switches, lights and the fan, suggested from the layout and movable along their walls), **Products** (Kohler models, shown at their real size), **Finishes** (demolition, floor, walls, ceiling) and **Estimate** (the price, a PDF with a picture and the floor plan, a link to the design, and the request form). Every move is checked as it happens: a fixture that overlaps, blocks the door, lacks the clearance it needs or sits too far from the plumbing to drain turns red and says why in plain words, and "Show me layouts that fit" rearranges the whole room.

Riley (`js/riley.js`) talks the person through it: what each step is for, and, when something won't work, what she can do instead, with a button that does it. She speaks out loud with the browser's own speech in the page's language, and can be muted. The wave button on her bubble (or `designer.html?voices`) lists the voices this device has for the language, plays a sample in each, and remembers the pick in this browser; `riley.voice` in `site-config.json` sets a default voice name per language. The voices come from each visitor's device and browser, so she sounds different on a Mac, Windows, Android or iPhone.

- `js/business.js`: which business the page is for (`?b=`), applies its name, phone and prices
- `js/room-plan.js`: the room engine, with no drawing (walls, fixture sizes, clearance rules, the plumbing stack and how far a drain can run from it, suggesting the electrical, finding spots, arranging the room, snapping a dragged fixture, share links). Also runs in Node for the unit tests.
- `js/studio.js`: the studio: steps, panel, floor plan, dragging, undo/redo, estimate, PDF, saving the design in the browser
- `js/bathroom-room-3d.js`: draws the room in 3D (Three.js) and reports what was clicked or dragged; `js/bathroom-room-layout.js` and `js/surface-finishes.js` feed it
- `js/bathroom-pricing.js`: the estimate math and default labor prices. The studio prices every line at the business's own rates (set on the account page): demolition, surfaces, each fixture (the bathtub at its own price, or 70% of the shower price when left empty), plumbing per point (one per toilet, sink, vanity, shower and bathtub), electrical per point and any new drain line per foot. The flat surcharges (no stack, bad valve) and tax exist in the model but aren't charged by the studio.
- `js/materials-pricing.js`: the materials catalog (catalog prices, may be out of date)
- `js/estimate-pdf.js`: the PDF
- `js/riley.js`: Riley's bubble and her voice (the browser's own speech; no network, no key)
- `js/script.js`: menu, language, FAQ and the request form
- `models/`: GLB fixture and product models
- `js/account.js`: sign-up and account pages
- `js/projects.js`: the My projects page and the designer's save bar

## Checks

```
npm ci
npm run check      # lint, formatting, pages in sync, unit tests
npm run test:e2e   # browser tests (Playwright)
npm run serve      # local server at http://localhost:8000, runs api/ like Vercel
npm test           # all of the above in one go
```

`vercel.json` sets the security headers (no page may be framed by other sites). `robots.txt` and `sitemap.xml` are built by `npm run pages`. The last full audit and what's still open: `AUDIT_REPORT.md`.
