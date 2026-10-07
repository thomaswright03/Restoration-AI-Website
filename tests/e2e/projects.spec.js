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
  await page.route("**/api/business?b=smith-bath", (route) =>
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
      Object.assign(p, body.name ? { name: body.name } : {}, body.design ? { design: body.design } : {});
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
  await expect(page.locator(".project-name").first()).toHaveAttribute(
    "href",
    /designer\.html\?b=smith-bath&project=a1$/,
  );

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

test("the designer saves a new project, then saves changes to it", async ({ page }) => {
  const state = await signedIn(page);
  await openStudio(page, "/designer.html?b=smith-bath");
  const bar = page.locator("#project-bar");
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("isn't saved to your projects yet");
  await page.locator("#project-name").fill("Garcia hall bath");
  await page.locator("#project-save").click();
  await expect(page.locator("#project-status")).toContainText("1 of 10 new projects used this month");
  await expect(bar).toContainText("Project: Garcia hall bath");
  expect(page.url()).toContain("project=p1");
  const created = state.calls.find((c) => c.method === "POST");
  expect(created.body.design).toMatch(/^[A-Za-z0-9_-]+$/);

  await expect(page.locator("#project-save")).toHaveText("Save changes");
  await page.locator("#project-save").click();
  await expect(page.locator("#project-status")).toContainText("Saved “Garcia hall bath”.");
  expect(state.calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
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

test("homeowners (nobody signed in) never see the save bar", async ({ page }) => {
  await openStudio(page, "/designer.html");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#project-bar")).toBeHidden();
});
