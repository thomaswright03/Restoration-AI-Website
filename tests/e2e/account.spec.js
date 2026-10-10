"use strict";

// The account page, signed in, with Supabase and the api/ functions stood
// in for by page.route: no designer link, embed code or website add-on
// anywhere, old customer requests show only when there are some, and Delete
// account asks for the sign-in email, calls /api/account and signs out.

const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

const SUPABASE = "https://fakeproject.supabase.co";
const DAY_LEAD = "2026-10-02T00:00:00Z";

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
  await page.route("**/api/config*", (route) =>
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
  await page.route("**/api/config*", (route) =>
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

const SESSION_JSON = {
  access_token: "token",
  refresh_token: "refresh",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: "u1", email: "owner@example.com", aud: "authenticated", user_metadata: {} },
};

// The sign-up page with nobody signed in: /api/config says what it's told,
// and Supabase Auth answers each call as the test decides.
async function signupPage(page, config, auth) {
  await page.route("**/api/config*", (route) =>
    route.fulfill({
      json: Object.assign(
        {
          accounts: true,
          payments: false,
          supabaseUrl: SUPABASE,
          supabaseAnonKey: "anon",
          plans: {},
          switches: { signups: true, checkout: true, saving: true },
          notice: "",
        },
        typeof config === "function" ? config() : config,
      ),
    }),
  );
  await page.route(SUPABASE + "/**", (route) => route.fulfill({ json: {} }));
  await page.route(SUPABASE + "/auth/v1/**", (route) => auth(route));
}

test("kill switch flipped after the page loaded: a refused checkout says it's paused, not that the server is down", async ({
  page,
}) => {
  await signedIn(page, { status: "none", payments: true });
  await page.route("**/api/checkout", (route) =>
    route.fulfill({ status: 503, json: { error: "paused", switch: "checkout", notice: "Back on Monday." } }),
  );
  await page.goto("/account.html");
  await expect(page.locator("#plan-buy")).toBeVisible();
  await page.locator('[data-plan="pro"]').click();
  await expect(page.locator("#plan-message")).toContainText("Buying a plan is paused right now");
  await expect(page.locator("#plan-message")).not.toContainText(/reach the server|went wrong/);
  // The page now knows: the buttons go and the plan line says so too.
  await expect(page.locator("#plan-buy")).toBeHidden();
  await expect(page.locator("#plan-status")).toContainText("Buying a plan is paused right now");
});

test("a Stripe failure says the payment page couldn't be opened, not that the server couldn't be reached", async ({
  page,
}) => {
  await signedIn(page, { status: "none", payments: true });
  await page.route("**/api/checkout", (route) =>
    route.fulfill({ status: 502, json: { error: "stripe", requestId: "iad1::abc" } }),
  );
  await page.goto("/account.html");
  await page.locator('[data-plan="starter"]').click();
  await expect(page.locator("#plan-message")).toContainText("The payment page couldn't be opened just now");
  await expect(page.locator("#plan-message")).toContainText("Nothing was charged");
  await expect(page.locator("#plan-message")).not.toContainText(/reach the server/);
  // The buttons stay: trying again is the advice.
  await expect(page.locator('[data-plan="starter"]')).toBeEnabled();

  // The billing page, the same way.
  await signedIn(page, { status: "active", payments: true });
  await page.route(SUPABASE + "/rest/v1/subscriptions**", (route) =>
    route.fulfill({ json: { owner_id: "u1", status: "active", plan: "pro", stripe_customer_id: "cus_1" } }),
  );
  await page.route("**/api/portal", (route) => route.fulfill({ status: 502, json: { error: "stripe" } }));
  await page.goto("/es/account.html");
  await page.locator("#manage-billing").click();
  await expect(page.locator("#plan-message")).toContainText("No se pudo abrir la página de facturación");
});

test("sign-ups switched off after the sign-up page loaded: the refused sign-up says sign-ups are paused", async ({
  page,
}) => {
  // The switch is on when the page loads and off by the time the form is sent.
  let signups = true;
  await signupPage(
    page,
    () => ({ switches: { signups, checkout: true, saving: true }, notice: "Back on Monday." }),
    (route) => {
      if (/\/auth\/v1\/signup/.test(route.request().url())) {
        // What Supabase Auth says when the refuse_signup_when_paused trigger fires.
        return route.fulfill({
          status: 500,
          json: { code: 500, error_code: "unexpected_failure", msg: "Database error saving new user" },
        });
      }
      return route.fulfill({ json: {} });
    },
  );
  await page.goto("/signup.html");
  await expect(page.locator("#auth-card")).toBeVisible();
  await expect(page.locator("#signups-paused")).toBeHidden();
  signups = false;
  await page.getByLabel("Email").fill("new@example.com");
  await page.getByLabel("Password").fill("longenough1");
  await page.locator("#auth-submit").click();
  await expect(page.locator("#auth-status")).toContainText("New sign-ups are paused right now");
  await expect(page.locator("#auth-status")).not.toContainText(/went wrong/);
  await expect(page.locator("#signups-paused")).toBeVisible();
  await expect(page.locator("#site-notice")).toContainText("Back on Monday.");
  await expect(page.locator('[data-mode="signup"]')).toBeHidden();
  await expect(page.locator('[data-mode="login"]')).toHaveAttribute("aria-pressed", "true");
});

test("a sign-up the auth service itself fails is explained as a service problem, in Portuguese too", async ({
  page,
}) => {
  await signupPage(page, {}, (route) =>
    route.fulfill({ status: 500, json: { code: 500, error_code: "unexpected_failure", msg: "Database error" } }),
  );
  await page.goto("/pt/signup.html");
  await page.getByLabel("E-mail").fill("new@example.com");
  await page.getByLabel("Senha").fill("longenough1");
  await page.locator("#auth-submit").click();
  await expect(page.locator("#auth-status")).toContainText("O serviço de login teve um problema");
  // Sign-ups aren't paused: the form stays as it was.
  await expect(page.locator("#signups-paused")).toBeHidden();
  await expect(page.locator('[data-mode="signup"]')).toBeVisible();
});

test("after logging in: My projects, or the page ?next= names on this site, or the account page for a plan link", async ({
  page,
}) => {
  const logIn = async (path) => {
    await signupPage(page, {}, (route) => {
      if (/grant_type=password/.test(route.request().url())) return route.fulfill({ json: SESSION_JSON });
      return route.fulfill({ json: {} });
    });
    await page.goto(path);
    await expect(page.locator("#auth-card")).toBeVisible();
    await page.getByLabel("Email").fill("owner@example.com");
    await page.getByLabel("Password").fill("longenough1");
    await page.locator("#auth-submit").click();
  };
  await logIn("/signup.html?mode=login");
  await page.waitForURL(/\/projects\.html$/);
  await page.evaluate(() => localStorage.clear());

  await logIn("/signup.html?mode=login&next=" + encodeURIComponent("/es/project.html?id=a1#info"));
  await page.waitForURL(/\/es\/project\.html\?id=a1#info$/);
  await page.evaluate(() => localStorage.clear());

  // Another site is never a destination.
  await logIn("/signup.html?mode=login&next=" + encodeURIComponent("//evil.example/x"));
  await page.waitForURL(/\/projects\.html$/);
  await page.evaluate(() => localStorage.clear());

  await logIn("/signup.html?mode=login&plan=pro&promo=FREEWEEK");
  await page.waitForURL(/\/account\.html\?plan=pro&promo=FREEWEEK$/);
});

test("signed in, the header offers My projects and Account instead of Pricing and Get started", async ({ page }) => {
  await page.goto("/index.html");
  const nav = page.locator("#nav-links");
  await expect(nav.getByRole("link", { name: "Pricing" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Get started" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "My projects" })).toBeHidden();
  await expect(nav.getByRole("link", { name: "Account" })).toBeHidden();

  await page.evaluate(() => localStorage.setItem("sb-fakeproject-auth-token", "{}"));
  await page.goto("/es/index.html");
  const navEs = page.locator("#nav-links");
  await expect(navEs.getByRole("link", { name: "Mis proyectos" })).toBeVisible();
  await expect(navEs.getByRole("link", { name: "Cuenta" })).toBeVisible();
  await expect(navEs.getByRole("link", { name: "Cerrar sesión" })).toBeVisible();
  await expect(navEs.getByRole("link", { name: "Precios" })).toBeHidden();
  await expect(navEs.getByRole("link", { name: "Empezar" })).toBeHidden();
  await expect(navEs.getByRole("link", { name: "Mis proyectos" })).toHaveAttribute("href", /\/es\/projects\.html$/);
  await page.evaluate(() => localStorage.clear());
});

test("the business and labor-prices Save buttons wait, say Saving…, then report what happened", async ({ page }) => {
  await signedIn(page);
  let fail = false;
  await page.route(SUPABASE + "/rest/v1/businesses**", async (route) => {
    const method = route.request().method();
    if (method === "PATCH") await new Promise((r) => setTimeout(r, 600));
    if (method === "PATCH" && fail === "taken") {
      return route.fulfill({ status: 409, json: { code: "23505", message: "duplicate key value" } });
    }
    if (method === "PATCH" && fail) return route.fulfill({ status: 500, json: { message: "boom" } });
    const sent = method === "PATCH" ? route.request().postDataJSON() : {};
    return route.fulfill({
      json: Object.assign(
        { id: "b1", owner_id: "u1", slug: "smith-bath", name: "Smith Bath", phone: "", email: "", prices: {} },
        sent,
      ),
    });
  });
  await page.goto("/account.html");
  const save = page.locator("#business-save");
  await expect(save).toHaveText("Save");
  await page.locator("#biz-phone").fill("801-555-0100");
  await save.click();
  await expect(save).toHaveText("Saving…");
  await expect(save).toBeDisabled();
  await expect(page.locator("#business-status")).toHaveText("Saved.");
  await expect(save).toHaveText("Save");
  await expect(save).toBeEnabled();

  // A missing name is pointed out at the field, and nothing is sent.
  await page.locator("#biz-name").fill("");
  await save.click();
  await expect(page.locator("#biz-name-error")).toBeVisible();
  await expect(page.locator("#biz-name")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#biz-name")).toBeFocused();
  await expect(page.locator("#business-status")).toContainText("Couldn't save.");
  await page.locator("#biz-name").fill("Smith Bath");

  // A web address another business has is pointed out at its field.
  fail = "taken";
  await save.click();
  await expect(page.locator("#biz-slug-error")).toHaveText("That web address is taken. Try another.");
  await expect(page.locator("#biz-name-error")).toBeHidden();
  await expect(page.locator("#business-status")).toContainText("Couldn't save.");
  await expect(save).toBeEnabled();

  // The labor prices, the same way; a server failure says so.
  fail = false;
  const pricesSave = page.locator("#prices-save");
  await page.locator('[data-price-key="Shower_Price"]').fill("1200");
  await pricesSave.click();
  await expect(pricesSave).toHaveText("Saving…");
  await expect(pricesSave).toBeDisabled();
  await expect(page.locator("#prices-reset")).toBeDisabled();
  await expect(page.locator("#prices-status")).toHaveText("Saved.");
  await expect(pricesSave).toBeEnabled();
  fail = true;
  await pricesSave.click();
  await expect(page.locator("#prices-status")).toContainText("Couldn't save.");
  await expect(page.locator("#prices-status")).toContainText("Something went wrong on our side");
  await expect(pricesSave).toHaveText("Save");
  await expect(pricesSave).toBeEnabled();
});

test("when the projects can't be counted the account page says so, with the reason", async ({ page }) => {
  await signedIn(page);
  await page.route("**/api/projects**", (route) => route.fulfill({ status: 502, json: { error: "server" } }));
  await page.goto("/account.html");
  await expect(page.locator("#projects-card")).toBeVisible();
  await expect(page.locator("#projects-summary")).toContainText("Your projects couldn't be counted right now.");
  await expect(page.locator("#projects-summary")).toContainText("Something went wrong on our side");
  await expect(page.locator("#projects-summary")).not.toContainText(/connection/i);
});

test("Escape closes the delete-account form; deleting a customer request asks in a dialog and reports the result", async ({
  page,
}) => {
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
      { id: "l2", name: "Bo", phone: "", email: "bo@example.com", service: "", message: "", created_at: DAY_LEAD },
    ],
  });
  let deletes = 0;
  await page.route(SUPABASE + "/rest/v1/leads**", (route) => {
    if (route.request().method() === "DELETE") {
      deletes++;
      return route.fulfill({ status: 204, body: "" });
    }
    return route.fallback();
  });
  await page.goto("/account.html");
  await page.getByRole("button", { name: "Delete my account…" }).click();
  await expect(page.locator("#delete-form")).toBeVisible();
  await page.locator("#delete-confirm").press("Escape");
  await expect(page.locator("#delete-form")).toBeHidden();
  await expect(page.getByRole("button", { name: "Delete my account…" })).toBeFocused();

  const dialog = page.locator("#lead-delete-dialog");
  const askAna = page.getByRole("button", { name: "Delete the request from Ana" });
  await page.locator("#leads-card summary").click();
  await askAna.click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Delete the request from Ana?");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await expect(askAna).toBeFocused();
  await askAna.click();
  await page.mouse.click(4, 4); // the backdrop
  await expect(dialog).toBeHidden();
  await askAna.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(deletes).toBe(0);

  await askAna.click();
  await dialog.getByRole("button", { name: "Delete request" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#leads-status")).toHaveText("Request deleted.");
  await expect(page.locator("#leads-list")).not.toContainText("Ana");
  await expect(page.locator("#leads-list")).toContainText("Bo");
  expect(deletes).toBe(1);
  await expect(page.locator("#leads-card")).toBeVisible();

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});

// The account page when its own database reads fail or hang: it says so,
// offers Try again, and shows nothing that could be acted on wrongly (no
// "free plan", no Buy buttons, no empty business form to re-type into).
const HANG = () => new Promise(() => {});
const DOWN = (route) => route.fulfill({ status: 500, json: { code: "PGRST000", message: "connection refused" } });

for (const [how, answer] of [
  ["fails", DOWN],
  ["hangs", HANG],
]) {
  test(`when the subscription read ${how}, the plan card says so with Try again, never the free plan or Buy buttons`, async ({
    page,
  }) => {
    const calls = await signedIn(page, { plan: "starter", status: "active", payments: true });
    let down = true;
    await page.route(SUPABASE + "/rest/v1/subscriptions**", (route) => {
      if (down) return answer(route);
      return route.fulfill({
        json: { owner_id: "u1", status: "active", plan: "starter", stripe_customer_id: "cus_1" },
      });
    });
    await page.goto("/account.html");
    const status = page.locator("#plan-status");
    await expect(status).toContainText("Your plan details couldn't be loaded", { timeout: 15000 });
    await expect(status).not.toContainText(/free plan|Pick a plan/i);
    await expect(page.locator("#plan-buy")).toBeHidden();
    await expect(page.locator("#plan-manage")).toBeHidden();
    await expect(page.locator("#plan-retry")).toBeVisible();
    // The rest of the page still works: the business details loaded.
    await expect(page.locator("#business-form")).toBeVisible();
    await expect(page.locator("#biz-name")).toHaveValue("Smith Bath");
    expect(calls).toEqual([]);

    down = false;
    await page.locator("#plan-retry").click();
    await expect(status).toContainText("Active.");
    await expect(page.locator("#plan-retry")).toBeHidden();
    await expect(page.locator("#plan-manage")).toBeVisible();
    await expect(page.locator("#plan-buy")).toBeHidden();
  });

  test(`when the business read ${how}, the form stays away and Try again brings the saved details back`, async ({
    page,
  }) => {
    await signedIn(page, { plan: "starter", status: "active", payments: true, prices: { Toilet_Price: 250 } });
    let down = true;
    let posts = 0;
    await page.route(SUPABASE + "/rest/v1/businesses**", (route) => {
      if (route.request().method() !== "GET") posts++;
      if (down) return answer(route);
      return route.fulfill({
        json: {
          id: "b1",
          owner_id: "u1",
          slug: "smith-bath",
          name: "Smith Bath",
          phone: "",
          email: "",
          prices: { Toilet_Price: 250 },
        },
      });
    });
    await page.goto("/account.html");
    const failed = page.locator("#business-failed");
    await expect(failed).toContainText("Your business details couldn't be loaded", { timeout: 15000 });
    await expect(failed).toContainText("what you saved is still there");
    // No empty form to re-type into, no prices card with defaults, no old-requests card.
    await expect(page.locator("#business-form")).toBeHidden();
    await expect(page.locator("#biz-name")).toBeHidden();
    await expect(page.locator("#prices-card")).toBeHidden();
    await expect(page.locator("#leads-card")).toBeHidden();
    // The plan card is unaffected.
    await expect(page.locator("#plan-status")).toContainText("Active.");
    expect(posts).toBe(0);

    down = false;
    await page.locator("#business-retry").click();
    await expect(page.locator("#business-form")).toBeVisible();
    await expect(failed).toBeHidden();
    await expect(page.locator("#biz-name")).toHaveValue("Smith Bath");
    await expect(page.locator("#prices-card")).toBeVisible();
    await expect(page.locator('[data-price-key="Toilet_Price"]')).toHaveValue("250");
    expect(posts).toBe(0);
  });
}

test("the business form waits for the read instead of starting empty; a first save is an upsert on the owner", async ({
  page,
}) => {
  await signedIn(page);
  const requests = [];
  await page.route(SUPABASE + "/rest/v1/businesses**", async (route) => {
    const req = route.request();
    if (req.method() === "GET") {
      await new Promise((r) => setTimeout(r, 400));
      return route.fulfill({ status: 200, contentType: "application/json", body: "null" });
    }
    requests.push({ method: req.method(), prefer: req.headers()["prefer"] || "", body: req.postDataJSON() });
    return route.fulfill({
      json: Object.assign({ id: "b9", owner_id: "u1", prices: {} }, req.postDataJSON()),
    });
  });
  await page.goto("/account.html");
  await expect(page.locator("#business-loading")).toBeVisible();
  await expect(page.locator("#business-form")).toBeHidden();
  await expect(page.locator("#business-form")).toBeVisible();
  await expect(page.locator("#business-loading")).toBeHidden();
  await page.locator("#biz-name").fill("New Co");
  await expect(page.locator("#biz-slug")).toHaveValue("new-co");
  await page.locator("#business-save").click();
  await expect(page.locator("#business-status")).toHaveText("Saved.");
  expect(requests).toHaveLength(1);
  expect(requests[0].method).toBe("POST");
  expect(requests[0].prefer).toMatch(/resolution=merge-duplicates/);
  expect(requests[0].body).toEqual(expect.objectContaining({ owner_id: "u1", slug: "new-co", name: "New Co" }));
  await expect(page.locator("#prices-card")).toBeVisible();
});

test("labor prices: each box says whether it's the default or the owner's, a line counts them, and a bad price is marked on its field", async ({
  page,
}) => {
  await signedIn(page, { prices: { Toilet_Price: 250, Shower_Price: 1000, Sink_Price: 180 } });
  await page.goto("/account.html");
  await expect(page.locator("#prices-summary")).toHaveText(
    "3 of 18 prices set; the other lines use the defaults shown in grey.",
  );
  await expect(page.locator("#price-Toilet_Price-mark")).toHaveText("Your price");
  await expect(page.locator("#price-Demo_Price_Per_SqFt-mark")).toHaveText("Default");
  await expect(page.locator('[data-price-key="Demo_Price_Per_SqFt"]')).toHaveAttribute(
    "aria-describedby",
    "price-Demo_Price_Per_SqFt-mark",
  );
  // The marks follow what's typed.
  await page.locator('[data-price-key="Demo_Price_Per_SqFt"]').fill("40");
  await expect(page.locator("#price-Demo_Price_Per_SqFt-mark")).toHaveText("Your price");
  await expect(page.locator("#prices-summary")).toContainText("4 of 18");
  await page.locator('[data-price-key="Toilet_Price"]').fill("");
  await expect(page.locator("#price-Toilet_Price-mark")).toHaveText("Default");
  await expect(page.locator("#prices-summary")).toContainText("3 of 18");

  // A price out of range is pointed out at its box, which gets the focus; nothing is sent.
  let patches = 0;
  await page.route(SUPABASE + "/rest/v1/businesses**", (route) => {
    if (route.request().method() === "PATCH") patches++;
    return route.fallback();
  });
  await page.locator('[data-price-key="Sink_Price"]').fill("-5");
  await page.locator("#prices-save").click();
  await expect(page.locator('[data-price-key="Sink_Price"]')).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator('[data-price-key="Sink_Price"]')).toBeFocused();
  await expect(page.locator('[data-price-key="Shower_Price"]')).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#prices-status")).toContainText("Prices must be numbers from 0 to 100,000.");
  expect(patches).toBe(0);
  await page.locator('[data-price-key="Sink_Price"]').fill("200");
  await expect(page.locator('[data-price-key="Sink_Price"]')).not.toHaveAttribute("aria-invalid", "true");

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);

  // No prices and all prices, in Spanish and Portuguese.
  await signedIn(page, { prices: {} });
  await page.goto("/es/account.html");
  await expect(page.locator("#prices-summary")).toContainText("Aún no fijó precios");
  await expect(page.locator("#price-Toilet_Price-mark")).toHaveText("Predeterminado");
  const all = {};
  for (const key of await page.locator("[data-price-key]").evaluateAll((els) => els.map((e) => e.dataset.priceKey))) {
    all[key] = 100;
  }
  await signedIn(page, { prices: all });
  await page.goto("/pt/account.html");
  await expect(page.locator("#prices-summary")).toHaveText(
    "Todos os 18 preços definidos: cada linha da estimativa está no seu preço.",
  );
  await expect(page.locator("#price-Toilet_Price-mark")).toHaveText("Seu preço");
});

test("an ended plan with buying off or paused says plans can't be bought right now, not 'pick a plan below'", async ({
  page,
}) => {
  await signedIn(page, { status: "canceled", payments: false });
  await page.goto("/account.html");
  await expect(page.locator("#plan-status")).toContainText("Paid plans aren't available right now");
  await expect(page.locator("#plan-status")).not.toContainText(/start a new plan to save again|pick a plan below/i);
  await expect(page.locator("#plan-buy")).toBeHidden();

  await signedIn(page, {
    status: "canceled",
    payments: true,
    switches: { signups: true, checkout: false, saving: true },
  });
  await page.goto("/account.html");
  await expect(page.locator("#plan-status")).toContainText("Buying a plan is paused right now");
  await expect(page.locator("#plan-buy")).toBeHidden();

  await signedIn(page, { status: "incomplete_expired", payments: false });
  await page.goto("/es/account.html");
  await expect(page.locator("#plan-status")).toContainText("no se cobró nada");
  await expect(page.locator("#plan-status")).toContainText("Los planes de pago no están disponibles por ahora");
  await expect(page.locator("#plan-status")).not.toContainText(/Elija un plan abajo/);

  await signedIn(page, {
    status: "incomplete_expired",
    payments: true,
    switches: { signups: true, checkout: false, saving: true },
  });
  await page.goto("/pt/account.html");
  await expect(page.locator("#plan-status")).toContainText("A compra de planos está pausada no momento");
  await expect(page.locator("#plan-status")).not.toContainText(/Escolha um plano abaixo/);
  await expect(page.locator("#plan-buy")).toBeHidden();

  // With buying possible, the ended plan still offers the buttons.
  await signedIn(page, { status: "canceled", payments: true });
  await page.goto("/account.html");
  await expect(page.locator("#plan-status")).toContainText("start a new plan to save again");
  await expect(page.locator("#plan-buy")).toBeVisible();
});

test("old homeowner requests sit folded under a heading that says what they are, and open to read", async ({
  page,
}) => {
  await signedIn(page, {
    leads: [{ id: "l1", name: "Ana", phone: "555", email: "", service: "", message: "Hi", created_at: DAY_LEAD }],
  });
  await page.goto("/account.html");
  const card = page.locator("#leads-card");
  await expect(card).toBeVisible();
  await expect(card.locator("summary")).toContainText(
    "Old homeowner requests (from before the designer became owner-only)",
  );
  await expect(card.locator("details")).not.toHaveAttribute("open", "");
  await expect(page.locator("#leads-list")).toBeHidden();
  await card.locator("summary").click();
  await expect(page.locator("#leads-list")).toBeVisible();
  await expect(page.locator("#leads-list")).toContainText("Ana");
  await expect(card).toContainText("Nothing new arrives here");
  await expect(page.locator("body")).not.toContainText(/Customer requests/);
});

test("signed out, the account page goes to the sign-in that lands on My projects; a plan link comes back here", async ({
  page,
}) => {
  await page.route("**/api/config*", (route) =>
    route.fulfill({
      json: { accounts: true, payments: true, supabaseUrl: SUPABASE, supabaseAnonKey: "anon", plans: {}, switches: {} },
    }),
  );
  await page.route(SUPABASE + "/**", (route) => route.fulfill({ json: {} }));
  // The header's Log in link points at the account page.
  await page.goto("/index.html");
  await expect(page.locator("[data-auth-link]")).toHaveAttribute("href", /account\.html$/);
  await page.locator("[data-auth-link]").click();
  await page.waitForURL(/\/signup\.html\?mode=login$/);
  await expect(page.locator('[data-mode="login"]')).toHaveAttribute("aria-pressed", "true");
  await page.goto("/es/account.html");
  await page.waitForURL(/\/es\/signup\.html\?mode=login$/);
  await page.goto("/account.html?plan=pro&promo=FREEWEEK");
  await page.waitForURL(/\/signup\.html\?mode=login&next=%2Faccount\.html%3Fplan%3Dpro%26promo%3DFREEWEEK$/);
});

test("a sign-up refused within the switch cache window asks the server for a fresh reading", async ({ page }) => {
  // The first /api/config says sign-ups are on; only a ?fresh=1 read says off,
  // the way the server answers when the switch flipped seconds ago.
  const configUrls = [];
  await signupPage(
    page,
    () => ({ switches: { signups: true, checkout: true, saving: true } }),
    (route) => {
      if (/\/auth\/v1\/signup/.test(route.request().url())) {
        return route.fulfill({
          status: 500,
          json: { code: 500, error_code: "unexpected_failure", msg: "Database error saving new user" },
        });
      }
      return route.fulfill({ json: {} });
    },
  );
  await page.route("**/api/config**", (route) => {
    const url = new URL(route.request().url());
    configUrls.push(url.search);
    const fresh = url.searchParams.get("fresh") === "1";
    return route.fulfill({
      json: {
        accounts: true,
        payments: false,
        supabaseUrl: SUPABASE,
        supabaseAnonKey: "anon",
        plans: {},
        switches: { signups: !fresh, checkout: true, saving: true },
        notice: "",
      },
    });
  });
  await page.goto("/signup.html");
  await expect(page.locator("#auth-card")).toBeVisible();
  await page.getByLabel("Email").fill("new@example.com");
  await page.getByLabel("Password").fill("longenough1");
  await page.locator("#auth-submit").click();
  await expect(page.locator("#auth-status")).toContainText("New sign-ups are paused right now");
  await expect(page.locator("#auth-status")).not.toContainText(/service had a problem|went wrong/);
  expect(configUrls).toContain("?fresh=1");
});

// Every failure on the account page names its real cause: a server that
// answered 5xx is a fault on our side (never "check your connection"), no
// connection is "you're offline", a request that never comes back is "taking
// too long".
test("a server failure, being offline and a hung request each get their own words, on the account page", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  await signedIn(page, { payments: true });
  // The server failed: the API's 5xx and Supabase's 5xx both say "our side".
  await page.route("**/api/projects**", (route) => route.fulfill({ status: 500, json: { error: "server" } }));
  await page.route(SUPABASE + "/rest/v1/businesses**", (route) =>
    route.fulfill({ status: 503, json: { code: "PGRST001", message: "could not connect to the database" } }),
  );
  await page.goto("/account.html");
  await expect(page.locator("#projects-summary")).toContainText("Something went wrong on our side");
  // (The Supabase client tries a 503 three times over ~8 s before giving up.)
  await expect(page.locator("#business-failed-text")).toContainText("Something went wrong on our side", {
    timeout: 20000,
  });
  await expect(page.locator("#business-failed-text")).not.toContainText(/connection/i);

  // The checkout answered by the server, but the browser is offline: offline.
  await page.unroute(SUPABASE + "/rest/v1/businesses**");
  await page.route(SUPABASE + "/rest/v1/businesses**", (route) =>
    route.fulfill({ json: { id: "b1", owner_id: "u1", slug: "smith-bath", name: "Smith Bath", prices: {} } }),
  );
  await page.locator("#business-retry").click();
  await expect(page.locator("#business-form")).toBeVisible();
  await context.setOffline(true);
  await page.locator("#business-save").click();
  await expect(page.locator("#business-status")).toContainText("You're offline. Check your connection");
  await expect(page.locator("#business-status")).not.toContainText(/our side/);
  await page.locator('[data-plan="starter"]').click();
  await expect(page.locator("#plan-message")).toContainText("You're offline");
  await context.setOffline(false);
});

test("a hung database read says it took too long, in the page's language", async ({ page }) => {
  await signedIn(page);
  await page.route(SUPABASE + "/rest/v1/businesses**", () => new Promise(() => {}));
  await page.goto("/es/account.html");
  await expect(page.locator("#business-failed-text")).toContainText("tardando demasiado", { timeout: 15000 });
  await expect(page.locator("#business-failed-text")).not.toContainText(/conexión/i);
});

test("signing up or logging in offline says you're offline, not that the password is wrong or the service failed", async ({
  page,
  context,
}) => {
  await signupPage(page, {}, (route) => route.abort("internetdisconnected"));
  await page.goto("/signup.html?mode=login");
  await expect(page.locator("#auth-card")).toBeVisible();
  await context.setOffline(true);
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("longenough1");
  await page.locator("#auth-submit").click();
  await expect(page.locator("#auth-status")).toContainText("You're offline");
  await expect(page.locator("#auth-status")).not.toContainText(/don't match|service had a problem/);
  await page.locator('[data-mode="signup"]').click();
  await page.getByLabel("Password").fill("longenough1");
  await page.locator("#auth-submit").click();
  await expect(page.locator("#auth-status")).toContainText("You're offline");
  await context.setOffline(false);
});

test("when /api/config fails the notice says why: the server, or the connection", async ({ page }) => {
  await page.route("**/api/config*", (route) => route.fulfill({ status: 503, body: "upstream error" }));
  await page.goto("/account.html");
  await expect(page.locator("#server-down")).toBeVisible();
  await expect(page.locator("#server-down")).toContainText("Something went wrong on our side");
  await expect(page.locator("#server-down")).not.toContainText(/internet connection/);
  await page.route("**/api/config*", (route) => route.abort("connectionrefused"));
  await page.goto("/es/signup.html");
  await expect(page.locator("#server-down")).toContainText("No se pudo conectar con el servidor");
});

// The account page shows the owner's full designer address, not only its
// last part, with Copy and Open once it's the saved one.
test("the account page shows the full designer address with Copy and Open; a changed slug waits for Save", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signedIn(page);
  await page.goto("/account.html");
  const url = page.locator("#biz-url");
  await expect(url).toHaveText(/^http:\/\/localhost:\d+\/designer\.html\?b=smith-bath$/);
  await expect(page.locator("#biz-url-row")).toContainText("Your designer opens at");
  const open = page.locator("#biz-url-open");
  await expect(open).toHaveAttribute("href", /designer\.html\?b=smith-bath$/);
  await expect(open).toHaveAttribute("target", "_blank");
  await expect(open).toHaveAttribute("aria-disabled", "false");
  await expect(page.locator("#biz-url-unsaved")).toBeHidden();
  await page.locator("#biz-url-copy").click();
  await expect(page.locator("#biz-url-status")).toHaveText("Address copied.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/designer\.html\?b=smith-bath$/);

  // A new slug shows the address it would have, but it isn't live until saved.
  await page.locator("#biz-slug").fill("smith-remodeling");
  await expect(url).toHaveText(/\?b=smith-remodeling$/);
  await expect(page.locator("#biz-url-unsaved")).toContainText("Save your business details");
  await expect(page.locator("#biz-url-copy")).toBeDisabled();
  await expect(open).toHaveAttribute("aria-disabled", "true");

  // Spanish: the address is the Spanish designer's.
  await page.goto("/es/account.html");
  await expect(url).toHaveText(/\/es\/designer\.html\?b=smith-bath$/);
  await expect(page.locator("#biz-url-copy")).toHaveText("Copiar dirección");
});
