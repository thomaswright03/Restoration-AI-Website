"use strict";

// My projects and the designer's save bar, signed in. Supabase and
// /api/projects are stood in for with page.route: a stored session makes
// supabase-js think someone is signed in, and a small in-memory list plays
// the API (its plan limits are api/_plans.js's to enforce; the unit tests
// cover that).

const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const { openStudio } = require("./helpers.js");

const SUPABASE = "https://fakeproject.supabase.co";

async function signedIn(page, { plan = "starter", projects = [], used, limits } = {}) {
  const state = {
    plan,
    limits: limits || (plan === "free" ? { monthly: 0, total: 0 } : { monthly: 10, total: 50 }),
    used: used || { month: projects.length, total: projects.length },
    projects: projects.slice(),
    calls: [],
  };
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: { accounts: true, payments: false, supabaseUrl: SUPABASE, supabaseAnonKey: "anon", plans: {} },
    }),
  );
  // Later routes win: anything else Supabase is asked gets an empty answer.
  await page.route(SUPABASE + "/**", (route) => route.fulfill({ json: {} }));
  await page.route(SUPABASE + "/rest/v1/businesses**", (route) => route.fulfill({ json: { slug: "smith-bath" } }));
  // The business's designer profile, as api/business.js would send it.
  await page.route("**/api/business?b=smith-bath*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: 'window.DesignerBusiness.load({"slug":"smith-bath","name":"Smith Bath Co.","prices":{}});',
    }),
  );
  await page.route("**/api/projects**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    state.calls.push({ method: req.method(), id: url.searchParams.get("id"), body });
    const find = (id) => state.projects.find((p) => p.id === id);
    if (req.method() === "GET" && url.searchParams.get("id")) {
      const p = find(url.searchParams.get("id"));
      return p ? route.fulfill({ json: { project: p } }) : route.fulfill({ status: 404, json: { error: "not-found" } });
    }
    if (req.method() === "GET") return route.fulfill({ json: state });
    if (req.method() === "POST") {
      if (state.plan === "free") return route.fulfill({ status: 403, json: { error: "plan" } });
      if (state.used.month >= state.limits.monthly) {
        return route.fulfill({ status: 403, json: { error: "monthly-limit", limits: state.limits, used: state.used } });
      }
      const p = {
        id: "p" + (state.projects.length + 1),
        name: body.name,
        design: body.design,
        info: body.info || {},
        summary: body.summary || null,
        updated_at: new Date().toISOString(),
      };
      state.projects.unshift(p);
      state.used = { month: state.used.month + 1, total: state.used.total + 1 };
      return route.fulfill({
        status: 201,
        json: { project: p, plan: state.plan, limits: state.limits, used: state.used },
      });
    }
    if (req.method() === "PATCH") {
      const p = find(body.id);
      Object.assign(
        p,
        body.name ? { name: body.name } : {},
        body.info ? { info: body.info } : {},
        body.design ? { design: body.design, summary: body.summary } : {},
      );
      return route.fulfill({ json: { project: p } });
    }
    if (req.method() === "DELETE") {
      state.projects = state.projects.filter((p) => p.id !== url.searchParams.get("id"));
      state.used.total -= 1;
      return route.fulfill({ json: { deleted: url.searchParams.get("id") } });
    }
    return route.fulfill({ status: 405, json: {} });
  });
  await page.addInitScript(() => {
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
  return state;
}

const DAY = "2026-10-01T12:00:00Z";

test("My projects lists, renames and deletes, and shows the plan's limits", async ({ page }) => {
  const state = await signedIn(page, {
    projects: [
      { id: "a1", name: "Smith main bath", design: "", updated_at: DAY },
      { id: "a2", name: "Lee guest bath", design: "", updated_at: DAY },
    ],
    used: { month: 3, total: 2 },
  });
  page.on("dialog", (d) => d.accept());
  await page.goto("/projects.html");
  await expect(page.locator("#projects-plan")).toHaveText("Plan: Starter");
  await expect(page.locator("#usage-month")).toContainText("3 of 10");
  await expect(page.locator("#usage-total")).toContainText("2 of 50");
  await expect(page.locator(".project-item")).toHaveCount(2);
  await expect(page.locator(".project-name").first()).toHaveAttribute("href", /project\.html\?id=a1$/);

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);

  await page.getByRole("button", { name: "Rename Lee guest bath" }).click();
  await page.getByLabel("Project name").fill("Lee upstairs bath");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.locator(".project-name").nth(1)).toHaveText("Lee upstairs bath");

  await page.getByRole("button", { name: "Delete Smith main bath" }).click();
  await expect(page.locator(".project-item")).toHaveCount(1);
  await expect(page.locator("#usage-total")).toContainText("1 of 50");
  // The monthly count doesn't go back down.
  await expect(page.locator("#usage-month")).toContainText("3 of 10");
  expect(state.calls.map((c) => c.method)).toEqual(["GET", "PATCH", "DELETE"]);
});

test("My projects on the free plan says saving needs a paid plan, in Spanish too", async ({ page }) => {
  await signedIn(page, { plan: "free" });
  await page.goto("/es/projects.html?lang=es");
  await expect(page.locator("#projects-free")).toBeVisible();
  await expect(page.locator("#projects-free")).toContainText("plan de pago");
  await expect(page.locator("#projects-usage")).toBeHidden();
  await expect(page.locator("#projects-empty")).toBeVisible();
});

test("the designer saves a new project with the client's details, then saves changes", async ({ page }) => {
  const state = await signedIn(page);
  await openStudio(page, "/designer.html?b=smith-bath");
  const bar = page.locator("#project-bar");
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("isn't saved to your projects yet");
  await page.locator("#project-save").click();
  const dialog = page.locator("#project-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Client name").fill("Maria Garcia");
  await dialog.getByLabel("Street address").fill("12 Elm St");
  await dialog.getByLabel("Unit / Apt # (optional)").fill("Apt 4B");
  await dialog.getByLabel("City").fill("Provo");
  await dialog.getByLabel("State").fill("UT");
  await dialog.getByLabel("ZIP code").fill("84601");
  await dialog.getByLabel("Status").selectOption("lead");
  await dialog.getByRole("button", { name: "Save project" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#project-status")).toContainText("1 of 10 new projects used this month");
  await expect(bar).toContainText("Project: Maria Garcia, 12 Elm St");
  await expect(bar).toContainText("12 Elm St, Apt 4B, Provo, UT 84601");
  expect(page.url()).toContain("project=p1");
  const created = state.calls.find((c) => c.method === "POST");
  expect(created.body.design).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(created.body.info).toEqual({
    client: "Maria Garcia",
    street: "12 Elm St",
    unit: "Apt 4B",
    city: "Provo",
    state: "UT",
    zip: "84601",
    status: "lead",
  });
  expect(created.body.summary.room.w).toBe(8);
  expect(created.body.summary.grandTotal).toBeGreaterThan(0);

  await expect(page.locator("#project-save")).toHaveText("Save changes");
  await page.locator("#project-save").click();
  await expect(page.locator("#project-status")).toContainText("Saved “Maria Garcia, 12 Elm St”.");
  const patch = state.calls.find((c) => c.method === "PATCH");
  expect(patch.body.summary.room.l).toBe(5);
});

test("the designer opens a saved project from its link", async ({ page }) => {
  // A saved design: the sample room resized to 10 ft wide.
  await page.goto("/designer.html");
  const design = await page.evaluate(() => {
    const d = window.RoomPlan.fromTemplate("full5x8", null);
    return window.RoomPlan.encode(window.RoomPlan.resize(d, { w: 10, l: d.room.l, h: d.room.h }));
  });
  await signedIn(page, { projects: [{ id: "a1", name: "Wide bath", design, updated_at: DAY }] });
  await openStudio(page, "/designer.html?b=smith-bath&project=a1");
  await expect(page.locator("#project-bar")).toContainText("Project: Wide bath");
  await expect.poll(() => page.evaluate(() => window.RoomPlan.decode(window.StudioDesign.encoded()).room.w)).toBe(10);
});

test("on the free plan the designer works but has no save button", async ({ page }) => {
  await signedIn(page, { plan: "free" });
  await openStudio(page, "/designer.html");
  await expect(page.locator("#project-bar")).toContainText("Saving projects needs a paid plan");
  await expect(page.locator("#project-save")).toBeHidden();
});

test("the save bar says what's left, and at the monthly cap says so before asking for the client's details", async ({
  page,
}) => {
  await signedIn(page, { used: { month: 10, total: 12 } });
  await openStudio(page, "/designer.html?b=smith-bath");
  await expect(page.locator("#project-bar")).toContainText(
    "0 of 10 new projects left this month, room for 38 more saved.",
  );
  await page.locator("#project-save").click();
  await expect(page.locator("#project-status")).toContainText("Deleting a project doesn't give one back");
  await expect(page.locator("#project-dialog")).toBeHidden();
});

test("when the plan can't be loaded, the designer says so instead of calling a paid account free", async ({ page }) => {
  await signedIn(page);
  await page.route("**/api/projects**", (route) => route.abort("internetdisconnected"));
  await openStudio(page, "/es/designer.html?b=smith-bath");
  await expect(page.locator("#project-bar")).toContainText("No se pudo cargar su plan");
  await expect(page.locator("#project-bar")).not.toContainText("Plan gratis");
});

test("homeowners (nobody signed in) never see the save bar", async ({ page }) => {
  await openStudio(page, "/designer.html");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#project-bar")).toBeHidden();
});

test("a project's page shows its 3D model, edits its info, and lists its materials", async ({ page }) => {
  await page.goto("/designer.html");
  const design = await page.evaluate(() => window.RoomPlan.encode(window.RoomPlan.fromTemplate("full5x8", null)));
  const summary = {
    v: 1,
    room: { w: 8, l: 5, h: 8 },
    fixtures: [{ label: "Toilet", qty: 1 }],
    labor: [{ label: "Tile floor", detail: "40 sq ft", cost: 600 }],
    laborSubtotal: 600,
    materials: [
      {
        label: "Floor tile",
        product: "Porcelain tile",
        store: "Home Depot",
        url: "https://example.com/tile",
        quantity: "44 sq ft",
        cost: 132,
      },
    ],
    products: [{ label: "Toilet: Cimarron", models: ["K-3609-0"], qty: 1, url: "https://example.com/k", cost: null }],
    materialsTotal: 132,
    grandTotal: 732,
    notes: [],
  };
  const state = await signedIn(page, {
    projects: [
      {
        id: "a1",
        name: "Garcia bath",
        design,
        info: { client: "Maria Garcia", street: "12 Elm St", city: "Provo", state: "UT" },
        summary,
        updated_at: DAY,
      },
    ],
  });
  await page.goto("/projects.html");
  await expect(page.locator(".project-client")).toHaveText("Maria Garcia · 12 Elm St, Provo, UT");
  await page.getByRole("link", { name: "Open Garcia bath" }).click();
  await expect(page).toHaveURL(/project\.html\?id=a1/);
  await expect(page.locator("#project-title")).toHaveText("Garcia bath");
  await expect(page.locator("#project-sub")).toHaveText("Maria Garcia · 12 Elm St, Provo, UT");
  await expect(page.locator("#project-edit")).toHaveAttribute("href", /designer\.html\?b=smith-bath&project=a1$/);
  await expect(page.locator("#project-model-frame")).toHaveAttribute("src", /project=a1&embed=1$/);

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).exclude("#project-model-frame").analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);

  await page.getByRole("tab", { name: "Info" }).click();
  await expect(page.locator("#panel-info")).toBeVisible();
  await page.locator("#panel-info").getByLabel("Unit / Apt # (optional)").fill("Unit 2");
  await page.locator("#panel-info").getByLabel("Phone").fill("801-555-0100");
  await page.getByRole("button", { name: "Save info" }).click();
  await expect(page.locator("#project-info-status")).toHaveText("Info saved.");
  await expect(page.locator("#project-sub")).toHaveText("Maria Garcia · 12 Elm St, Unit 2, Provo, UT");
  const patch = state.calls.find((c) => c.method === "PATCH");
  expect(patch.body.info.phone).toBe("801-555-0100");
  expect(patch.body.name).toBe("Garcia bath");

  await page.getByRole("tab", { name: "Materials" }).click();
  await expect(page.locator("#project-materials")).toContainText("Porcelain tile (Home Depot)");
  await expect(page.locator("#project-materials")).toContainText("44 sq ft");
  await expect(page.locator("#project-materials")).toContainText("Not priced");
  await expect(page.locator(".materials-totals")).toContainText("$732");
  const axe2 = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).exclude("#project-model-frame").analyze();
  expect(axe2.violations.map((v) => v.id)).toEqual([]);
});

test("a project's 3D model follows the page when the theme is switched", async ({ page }) => {
  await page.goto("/designer.html");
  const design = await page.evaluate(() => window.RoomPlan.encode(window.RoomPlan.fromTemplate("full5x8", null)));
  await signedIn(page, { projects: [{ id: "a1", name: "Garcia bath", design, info: {}, updated_at: DAY }] });
  await page.goto("/project.html?id=a1");
  await page.locator("[data-theme-choice='dark']").click();
  await expect(page.locator("#project-model-frame")).toHaveAttribute("src", /embed=1$/);
  const model = page.frameLocator("#project-model-frame").locator("html");
  await expect(model).toHaveAttribute("data-theme", "dark");
  await page.locator("[data-theme-choice='light']").click();
  await expect(model).toHaveAttribute("data-theme", "light");
  await page.locator("[data-theme-choice='system']").click();
  await expect(model).not.toHaveAttribute("data-theme", /./);
});
