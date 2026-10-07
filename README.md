# Room Designer 3D

A 3D bathroom designer and estimator that remodeling and restoration businesses sign up for, pay for, and put on their own website. Homeowners design their bathroom in 3D, get a rough estimate at the business's own labor prices, and send the request to the business.

A product of Wright AI Solutions, LLC. The designer itself started as the one built for a client site and was made multi-business here: every business name, phone, email and price comes from the subscriber's account.

## How it works

- **Landing page** (`index.html`): what it is, pricing, FAQ, sign-up.
- **Live demo** (`designer.html`): the full designer, speaking for a sample business.
- **Sign-up / log in** (`signup.html`) and **account** (`account.html`): pick a plan (Stripe Checkout, free trial), set the business details and labor prices, copy the designer link or embed code, and read the requests homeowners send.
- **A business's designer**: `designer.html?b=<their-slug>`, or `...&embed=1` inside an iframe on their own site (no product header/footer). It only runs while their subscription is active or trialing.

Everything is in English, Spanish and Brazilian Portuguese (`es/`, `pt/`).

## Stack

- Static pages (plain HTML/CSS/JS, Three.js for the 3D room), hosted on Vercel. No framework, no build step at deploy time.
- Vercel functions in `api/` (Node 20, no npm packages; they call Stripe and Supabase over REST):
  - `config.js`: tells the browser whether accounts and payments are on, and the public Supabase keys
  - `business.js`: a business's public profile, loaded by the designer page as a script
  - `leads.js`: saves a homeowner request for that business (and emails it, if Resend is set up)
  - `checkout.js` / `portal.js`: Stripe Checkout and the Stripe billing portal
  - `stripe-webhook.js`: records subscription status in Supabase
- Supabase for accounts (Supabase Auth) and the database (`supabase/schema.sql`: businesses, subscriptions, leads, with row-level security).
- With no keys set, the site runs in demo mode: the demo designer works, and sign-up says accounts aren't switched on yet.

## Going live (one-time setup)

1. **Supabase**: create a project. In SQL Editor, run `supabase/schema.sql`. In Authentication > URL Configuration, set the Site URL to your domain and add `https://<domain>/account.html`, `/es/account.html` and `/pt/account.html` as redirect URLs.
2. **Stripe**: create one product with a monthly and a yearly recurring price. Add a webhook to `https://<domain>/api/stripe-webhook` for `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`. Turn on the customer portal (Settings > Billing > Customer portal).
3. **Vercel**: import this repo as a project (no build settings needed) and set the environment variables in `.env.example`.
4. Keep the prices shown on the site equal to Stripe: edit `plans` in `site-config.json`, run `npm run pages`, commit.

Start with Stripe test keys; switch to live keys once a test sign-up, checkout and request all work.

## Editing pages and text

Pages are built from templates so the three languages can't drift apart:

- `pages/layout.html`: shared head, header and footer
- `pages/<page>.html`: each page's content
- `pages/strings/*.json`: every text as `"key": ["English", "Español", "Português"]`

After editing, run `npm run pages` and commit the rebuilt `*.html`, `es/*.html` and `pt/*.html`. CI fails if a built page is stale or a text is missing a translation. Text shown by JavaScript (the design studio, estimate, forms, account page messages) lives in `js/i18n.js`, also in all three languages.

## The designer code

The designer is a five-step studio: **Room** (a common bathroom to start from, measurements in feet and inches, doors), **Layout** (add fixtures and move them in 3D or on the floor plan), **Products** (Kohler models, shown at their real size), **Finishes** (demolition, floor, walls, ceiling) and **Estimate** (the price, a PDF with a picture and the floor plan, a link to the design, and the request form). Every move is checked as it happens: a fixture that overlaps, blocks the door or lacks the clearance it needs turns red and says why in plain words, and "Show me layouts that fit" rearranges the whole room.

- `js/business.js`: which business the page is for (`?b=`), applies its name, phone and prices
- `js/room-plan.js`: the room engine, with no drawing (walls, fixture sizes, clearance rules, finding spots, arranging the room, snapping a dragged fixture, share links). Also runs in Node for the unit tests.
- `js/studio.js`: the studio: steps, panel, floor plan, dragging, undo/redo, estimate, PDF, saving the design in the browser
- `js/bathroom-room-3d.js`: draws the room in 3D (Three.js) and reports what was clicked or dragged; `js/bathroom-room-layout.js` and `js/surface-finishes.js` feed it
- `js/bathroom-pricing.js`: the estimate math and default labor prices
- `js/materials-pricing.js`: the materials catalog (catalog prices, may be out of date)
- `js/estimate-pdf.js`: the PDF
- `js/script.js`: menu, language, FAQ and the request form
- `models/`: GLB fixture and product models
- `js/account.js`: sign-up and account pages

## Checks

```
npm ci
npm run check      # lint, formatting, pages in sync, unit tests
npm run test:e2e   # browser tests (Playwright)
npm run serve      # local server at http://localhost:8000, runs api/ like Vercel
```
