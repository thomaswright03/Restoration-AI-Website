"use strict";

// The account page, signed in, with Supabase and the api/ functions stood
// in for by page.route: no designer link, embed code or website add-on
// anywhere, old customer requests show only when there are some, and Delete
// account asks for the sign-in email, calls /api/account and signs out.

const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

const SUPABASE = "https://fakeproject.supabase.co";

async function signedIn(page, { plan = "starter", payments = false, status = "active", leads = [] } = {}) {
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
      },
    }),
  );
  await page.route(SUPABASE + "/**", (route) => route.fulfill({ json: {} }));
  await page.route(SUPABASE + "/rest/v1/subscriptions**", (route) =>
    route.fulfill({
      json: { owner_id: "u1", status, plan, current_period_end: "2026-11-01T00:00:00Z" },
    }),
  );
  await page.route(SUPABASE + "/rest/v1/businesses**", (route) =>
    route.fulfill({
      json: { id: "b1", owner_id: "u1", slug: "smith-bath", name: "Smith Bath", phone: "", email: "", prices: {} },
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
  await expect(page.locator("body")).not.toContainText(/Put it on your website|embed/i);
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
