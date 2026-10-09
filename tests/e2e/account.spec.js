"use strict";

// The account page, signed in, with Supabase and the api/ functions stood
// in for by page.route: no designer link, embed code or website add-on
// anywhere, old customer requests show only when there are some, and Delete
// account asks for the sign-in email, calls /api/account and signs out.

const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

const SUPABASE = "https://fakeproject.supabase.co";

async function signedIn(
  page,
  {
    plan = "starter",
    payments = false,
    status = "active",
    leads = [],
    switches = { signups: true, checkout: true, saving: true },
    notice = "",
    periodEnd = "2026-11-01T00:00:00Z",
    prices = {},
  } = {},
) {
  const calls = [];
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: {
        accounts: true,
        payments,
        supabaseUrl: SUPABASE,
        supabaseAnonKey: "anon",
        plans: { starter: payments, pro: payments, max: payments },
        trialDays: 0,
        promo: payments,
        switches,
        notice,
      },
    }),
  );
  await page.route(SUPABASE + "/**", (route) => route.fulfill({ json: {} }));
  await page.route(SUPABASE + "/rest/v1/subscriptions**", (route) =>
    route.fulfill({
      json: { owner_id: "u1", status, plan, current_period_end: periodEnd },
    }),
  );
  await page.route(SUPABASE + "/rest/v1/businesses**", (route) =>
    route.fulfill({
      json: { id: "b1", owner_id: "u1", slug: "smith-bath", name: "Smith Bath", phone: "", email: "", prices },
    }),
  );
  await page.route(SUPABASE + "/rest/v1/leads**", (route) => route.fulfill({ json: leads }));
  await page.route("**/api/projects**", (route) =>
    route.fulfill({
      json: { plan, limits: { monthly: 10, total: 50 }, used: { month: 0, total: 0 }, projects: [] },
    }),
  );
  await page.route("**/api/checkout", async (route) => {
    calls.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/account", async (route) => {
    calls.push(route.request().postDataJSON());
    return route.fulfill({ json: { deleted: true } });
  });
  await page.addInitScript(() => {
    // Not after Delete account has sent the page to signup.html: the sign-in
    // is gone by then.
    if (location.search.includes("deleted=1")) return;
    const session = {
      access_token: "token",
      refresh_token: "refresh",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "u1", email: "owner@example.com", aud: "authenticated", user_metadata: {} },
    };
    localStorage.setItem("sb-fakeproject-auth-token", JSON.stringify(session));
  });
  return calls;
}

test("no designer link, embed code or website add-on; the plan checkout sends only the plan", async ({ page }) => {
  const calls = await signedIn(page, { plan: "pro", status: "none", payments: true });
  await page.goto("/account.html");
  await expect(page.locator("#prices-card")).toBeVisible();
  await expect(page.locator("#plan-buy")).toBeVisible();
  await expect(page.locator("#share-card, #embed-code, #plan-website")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(
    /Put it on your website|embed|designer is live|to your customers/i,
  );
  // No old requests: the card stays out of the way.
  await expect(page.locator("#leads-card")).toBeHidden();

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);

  await page.locator('[data-plan="pro"]').click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0]).toEqual({ plan: "pro", promo: "", lang: "" });
});

test("requests homeowners sent earlier can still be read", async ({ page }) => {
  await signedIn(page, {
    leads: [
      {
        id: "l1",
        name: "Ana",
        phone: "555",
        email: "",
        service: "",
        message: "Hi",
        created_at: "2026-10-01T00:00:00Z",
      },
    ],
  });
  await page.goto("/account.html");
  await expect(page.locator("#leads-card")).toBeVisible();
  await expect(page.locator("#leads-list")).toContainText("Ana");
});

test("Delete account asks for the sign-in email, then deletes and signs out", async ({ page }) => {
  const calls = await signedIn(page);
  await page.goto("/account.html");
  await expect(page.locator("#delete-form")).toBeHidden();
  await page.getByRole("button", { name: "Delete my account…" }).click();
  await expect(page.locator("#delete-form")).toBeVisible();

  await page.getByLabel("Type your sign-in email to confirm").fill("someone@example.com");
  await page.getByRole("button", { name: "Delete everything" }).click();
  await expect(page.locator("#delete-status")).toContainText("doesn't match");
  expect(calls).toEqual([]);

  await page.getByRole("button", { name: "Keep my account" }).click();
  await expect(page.locator("#delete-form")).toBeHidden();
  await page.getByRole("button", { name: "Delete my account…" }).click();
  await page.getByLabel("Type your sign-in email to confirm").fill("Owner@Example.com");
  await page.getByRole("button", { name: "Delete everything" }).click();
  await page.waitForURL(/signup\.html\?deleted=1/);
  expect(calls).toEqual([{ action: "delete", confirm: "owner@example.com" }]);
  await expect(page.locator("#auth-status")).toContainText("deleted");
  expect(await page.evaluate(() => localStorage.getItem("sb-fakeproject-auth-token"))).toBeNull();
});

test("signed in, the nav's Log in reads Log out in each language and signs out", async ({ page }) => {
  await page.goto("/index.html?lang=en");
  const link = page.locator("[data-auth-link]");
  await expect(link).toHaveText("Log in");
  await page.evaluate(() => localStorage.setItem("sb-fakeproject-auth-token", "{}"));
  await page.reload();
  await expect(link).toHaveText("Log out");
  await expect(link).toHaveAttribute("href", /account\.html\?logout=1$/);
  await page.goto("/es/designer.html?lang=es");
  await expect(page.locator("[data-auth-link]")).toHaveText("Cerrar sesión");
  await page.goto("/pt/project.html?lang=pt");
  await expect(page.locator("[data-auth-link]")).toHaveText("Sair");

  await page.goto("/index.html?lang=en");
  await page.locator("[data-auth-link]").click();
  await page.waitForURL(/\/index\.html$/);
  expect(await page.evaluate(() => localStorage.getItem("sb-fakeproject-auth-token"))).toBeNull();
  await expect(page.locator("[data-auth-link]")).toHaveText("Log in");
});

test("a promo code from the link fills the plan card's box and goes to checkout; a wrong one says so", async ({
  page,
}) => {
  const calls = await signedIn(page, { status: "canceled", payments: true });
  await page.route("**/api/checkout", async (route) => {
    calls.push(route.request().postDataJSON());
    return route.fulfill({ status: 400, json: { error: "promo" } });
  });
  await page.goto("/account.html?promo=FREEWEEK");
  await expect(page.locator("#plan-promo")).toHaveValue("FREEWEEK");
  await expect(page.locator("#plan-trial-note")).toBeVisible();
  await page.locator('[data-plan="pro"]').click();
  await expect(page.locator("#plan-message")).toContainText("promo code isn't valid");
  expect(calls).toContainEqual(expect.objectContaining({ plan: "pro", promo: "FREEWEEK" }));

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});

test("Spanish account page: the promo box and its error are in Spanish", async ({ page }) => {
  await signedIn(page, { status: "canceled", payments: true });
  await page.route("**/api/checkout", (route) => route.fulfill({ status: 409, json: { error: "promo-used" } }));
  await page.goto("/es/account.html");
  await expect(page.locator('label[for="plan-promo"]')).toHaveText("Código promocional (opcional)");
  await page.locator("#plan-promo").fill("freeweek");
  await page.locator('[data-plan="starter"]').click();
  await expect(page.locator("#plan-message")).toContainText("primer plan de una cuenta");
});

test("payments off: the plan card says paid plans aren't available yet, with no buttons to look for", async ({
  page,
}) => {
  await signedIn(page, { status: "none", payments: false });
  await page.goto("/account.html");
  await expect(page.locator("#plan-status")).toContainText("Paid plans aren't available yet");
  await expect(page.locator("#plan-status")).not.toContainText(/pick a plan below|website|live/i);
  await expect(page.locator("#plan-buy")).toBeHidden();
  await expect(page.locator("#prices-card")).toBeVisible();
});

test("kill switch: checkout paused hides the buy buttons and says so; a notice shows as written", async ({ page }) => {
  const calls = await signedIn(page, {
    status: "none",
    payments: true,
    switches: { signups: true, checkout: false, saving: true },
    notice: "Back on Monday.",
  });
  await page.goto("/account.html");
  await expect(page.locator("#plan-status")).toContainText("Buying a plan is paused right now");
  await expect(page.locator("#plan-buy")).toBeHidden();
  await expect(page.locator("#site-notice")).toContainText("Back on Monday.");
  expect(calls).toEqual([]);

  // Spanish and Portuguese say it in their own words.
  await page.goto("/es/account.html");
  await expect(page.locator("#plan-status")).toContainText("La compra de planes está pausada");
  await page.goto("/pt/account.html");
  await expect(page.locator("#plan-status")).toContainText("A compra de planos está pausada");
});

test("kill switch: with sign-ups paused the sign-up page offers only log in", async ({ page }) => {
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: {
        accounts: true,
        payments: false,
        supabaseUrl: SUPABASE,
        supabaseAnonKey: "anon",
        plans: {},
        switches: { signups: false, checkout: true, saving: true },
        notice: "",
      },
    }),
  );
  await page.route(SUPABASE + "/**", (route) => route.fulfill({ json: {} }));
  await page.goto("/signup.html");
  await expect(page.locator("#signups-paused")).toContainText("New sign-ups are paused right now");
  await expect(page.locator('[data-mode="signup"]')).toBeHidden();
  await expect(page.locator('[data-mode="login"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#auth-card")).toBeVisible();
  await page.goto("/pt/signup.html");
  await expect(page.locator("#signups-paused")).toContainText("O cadastro de novas contas está pausado");
});

test("a hand-set plan with no renewal date reads naturally", async ({ page }) => {
  await signedIn(page, { status: "active", plan: "max", periodEnd: null });
  await page.goto("/account.html");
  await expect(page.locator("#plan-status")).toHaveText("Active. You can save projects within your plan's limits.");
});

test("Stripe statuses are explained in the page's language, not shown raw", async ({ page }) => {
  await signedIn(page, { status: "incomplete", payments: true });
  await page.goto("/es/account.html");
  await expect(page.locator("#plan-status")).toContainText("Su primer pago aún no se procesó");
  await expect(page.locator("#plan-status")).not.toContainText(/incomplete/);
  await expect(page.locator("#plan-buy")).toBeHidden();
});

test("a failed card says what actually happens: saving is paused, projects stay open", async ({ page }) => {
  await signedIn(page, { status: "past_due", payments: true });
  await page.goto("/account.html");
  await expect(page.locator("#plan-status")).toContainText("saving projects is paused");
  await expect(page.locator("#plan-status")).not.toContainText(/live/);
  await expect(page.locator("#plan-buy")).toBeHidden();
});

test("back from checkout, the page waits for Stripe's confirmation and never offers to buy again", async ({ page }) => {
  const calls = await signedIn(page, { status: "none", payments: true });
  await page.goto("/account.html?checkout=success");
  await expect(page.locator("#plan-message")).toContainText("Stripe is confirming your plan");
  await expect(page.locator("#plan-buy")).toBeHidden();
  await page.waitForTimeout(500);
  await expect(page.locator("#plan-buy")).toBeHidden();
  expect(calls).toEqual([]);

  // A second plan refused by the server (already-subscribed) is explained, not "something went wrong".
  await signedIn(page, { status: "canceled", payments: true });
  await page.route("**/api/checkout", (route) => route.fulfill({ status: 409, json: { error: "already-subscribed" } }));
  await page.goto("/account.html");
  await page.locator('[data-plan="starter"]').click();
  await expect(page.locator("#plan-message")).toContainText("already has a plan");
});

test("the labor prices include electrical, drain line, plumbing and the bathtub, which follows the shower price", async ({
  page,
}) => {
  await signedIn(page, { prices: { Shower_Price: 1000 } });
  await page.goto("/account.html");
  for (const key of [
    "Electrical_Price_Per_Point",
    "Drain_Run_Price_Per_Ft",
    "Plumbing_Price_Per_Point",
    "Bathtub_Price",
  ]) {
    await expect(page.locator(`[data-price-key="${key}"]`)).toBeVisible();
  }
  await expect(page.locator('[data-price-key="Electrical_Price_Per_Point"]')).toHaveAttribute("placeholder", "100");
  await expect(page.locator('[data-price-key="Drain_Run_Price_Per_Ft"]')).toHaveAttribute("placeholder", "95");
  await expect(page.locator('[data-price-key="Plumbing_Price_Per_Point"]')).toHaveAttribute("placeholder", "300");
  await expect(page.locator('[data-price-key="Bathtub_Price"]')).toHaveAttribute("placeholder", "700");
  await expect(page.locator("#prices-card")).not.toContainText(/customers/i);
});
