"use strict";

// My projects and the designer's save bar, signed in. Supabase and
// /api/projects are stood in for with page.route: a stored session makes
// supabase-js think someone is signed in, and a small in-memory list plays
// the API (its plan limits are api/_plans.js's to enforce; the unit tests
// cover that).

const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const { openStudio, answerAll, step } = require("./helpers.js");

const SUPABASE = "https://fakeproject.supabase.co";

async function signedIn(page, { plan = "starter", projects = [], used, limits, prices = {}, bizDelay = 0 } = {}) {
  const state = {
    plan,
    limits: limits || (plan === "free" ? { monthly: 0, total: 0 } : { monthly: 10, total: 50 }),
    used: used || { month: projects.length, total: projects.length },
    projects: projects.slice(),
    calls: [],
  };
  await page.route("**/api/config*", (route) =>
    route.fulfill({
      json: { accounts: true, payments: false, supabaseUrl: SUPABASE, supabaseAnonKey: "anon", plans: {} },
    }),
  );
  // Later routes win: anything else Supabase is asked gets an empty answer.
  await page.route(SUPABASE + "/**", (route) => route.fulfill({ json: {} }));
  await page.route(SUPABASE + "/rest/v1/businesses**", (route) => route.fulfill({ json: { slug: "smith-bath" } }));
  // The business's designer profile, as api/business.js would send it.
  await page.route("**/api/business?b=smith-bath*", async (route) => {
    if (bizDelay) await new Promise((resolve) => setTimeout(resolve, bizDelay));
    return route.fulfill({
      contentType: "application/javascript",
      body: `window.DesignerBusiness.load(${JSON.stringify({ slug: "smith-bath", name: "Smith Bath Co.", prices })});`,
    });
  });
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
      // Like api/projects.js: a save naming the version it loaded lands
      // only on that version.
      if (body.updated_at && body.updated_at !== p.updated_at) {
        return route.fulfill({ status: 409, json: { error: "conflict", project: p } });
      }
      Object.assign(
        p,
        body.name ? { name: body.name } : {},
        body.info ? { info: body.info } : {},
        body.design ? { design: body.design, summary: body.summary } : {},
        { updated_at: new Date().toISOString() },
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
  await page.goto("/projects.html");
  await expect(page.locator("#projects-plan")).toHaveText("Plan: Starter");
  await expect(page.locator("#usage-month")).toContainText("3 of 10");
  await expect(page.locator("#usage-total")).toContainText("2 of 50");
  await expect(page.locator(".project-item")).toHaveCount(2);
  await expect(page.locator(".project-name").first()).toHaveAttribute("href", /project\.html\?id=a1$/);

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);

  await page.getByRole("button", { name: "Rename Lee guest bath" }).click();
  // An empty name gets the page's own message in the row, not the browser's bubble.
  await page.getByLabel("Project name").fill("   ");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.locator(".project-rename .field-error")).toHaveText("Give the project a name.");
  await expect(page.getByLabel("Project name")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Project name")).toBeFocused();
  await page.getByLabel("Project name").fill("Lee upstairs bath");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.locator(".project-name").nth(1)).toHaveText("Lee upstairs bath");

  // Delete asks first, in a dialog that names the project, Cancel focused.
  await page.getByRole("button", { name: "Delete Smith main bath" }).click();
  const confirm = page.locator("#projects-delete-dialog");
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("Delete “Smith main bath”?");
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirm).toBeHidden();
  await expect(page.locator(".project-item")).toHaveCount(2);
  await page.getByRole("button", { name: "Delete Smith main bath" }).click();
  await confirm.getByRole("button", { name: "Delete project" }).click();
  await expect(confirm).toBeHidden();
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
  await expect(page.locator("#projects-empty").getByRole("link", { name: "Abrir el diseñador" })).toBeVisible();
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
  expect(created.body.summary.room.w).toBe(8.5);
  expect(created.body.summary.grandTotal).toBeGreaterThan(0);

  await expect(page.locator("#project-save")).toHaveText("Save changes");
  await page.locator("#project-save").click();
  await expect(page.locator("#project-status")).toContainText("Saved “Maria Garcia, 12 Elm St”.");
  const patch = state.calls.find((c) => c.method === "PATCH");
  expect(patch.body.summary.room.l).toBe(5);

  // A second project with no details at all is named by the date and time,
  // so two saves the same day don't look alike.
  await page.locator("#project-save-new").click();
  await dialog.getByLabel("Client name").fill("");
  await dialog.getByLabel("Street address").fill("");
  await dialog.getByRole("button", { name: "Save project" }).click();
  await expect(dialog).toBeHidden();
  const second = state.calls.filter((c) => c.method === "POST")[1];
  expect(second.body.name).toMatch(/^Bathroom, [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2}/);
});

test("the designer opens a saved project as that project: no link toast, its answers counted, nothing unsaved", async ({
  page,
}) => {
  // A saved design: the sample room resized to 10 ft wide, saved before any
  // question was answered (as older projects were).
  await page.goto("/designer.html");
  const design = await page.evaluate(() => {
    const d = window.RoomPlan.fromTemplate("full5x8", null);
    return window.RoomPlan.encode(window.RoomPlan.resize(d, { w: 10, l: d.room.l, h: d.room.h }));
  });
  await signedIn(page, { projects: [{ id: "a1", name: "Wide bath", design, updated_at: DAY }] });
  await openStudio(page, "/designer.html?b=smith-bath&project=a1");
  await expect(page.locator("#project-bar")).toContainText("Project: Wide bath");
  await expect.poll(() => page.evaluate(() => window.RoomPlan.decode(window.StudioDesign.encoded()).room.w)).toBe(10);
  // It was opened from My projects, not a link, and it says which project.
  await expect(page.locator("#studio-toast")).toContainText("Opened “Wide bath”.");
  await expect(page.locator("#studio-toast")).not.toContainText("from your link");
  // The saved project's questions count as answered: nothing to re-pick.
  await expect(page.locator("#studio-step-need")).toHaveCount(0);
  await expect(step(page, "layout")).not.toHaveAttribute("aria-disabled", "true");
  await expect(step(page, "estimate")).not.toHaveAttribute("aria-disabled", "true");
  // Nothing has changed yet, so nothing is unsaved.
  await page.waitForTimeout(700);
  await expect(page.locator("#project-status")).toBeHidden();
  await step(page, "finishes").click();
  await expect(page.locator(".studio-step.is-finishes")).toBeVisible();
  await expect(page.locator("#project-status")).toBeHidden();
  // The first real change is.
  await step(page, "room").click();
  await page.locator("#studio-size-w").fill("9");
  await page.locator("#studio-size-w").press("Enter");
  await expect(page.locator("#project-status")).toContainText("Unsaved changes");
});

test("a business profile that answers after the sign-in check still opens the saved project and shows the save bar", async ({
  page,
}) => {
  await page.goto("/designer.html");
  const design = await page.evaluate(() => window.RoomPlan.encode(window.RoomPlan.fromTemplate("full5x8", null)));
  await signedIn(page, { projects: [{ id: "a1", name: "Late bath", design, updated_at: DAY }], bizDelay: 1500 });
  await openStudio(page, "/designer.html?b=smith-bath&project=a1");
  await expect(page.locator("#project-bar")).toContainText("Project: Late bath");
  await expect(page.locator("#studio-loading")).toBeHidden();
  // The owner's designer with no project keeps its save bar too.
  await openStudio(page, "/designer.html?b=smith-bath");
  await expect(page.locator("#project-bar")).toBeVisible();
  await expect(page.locator("#project-save-form")).toBeVisible();
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
  // An older row, saved before the rates were recorded: nothing about them.
  await expect(page.locator("#project-materials")).not.toContainText(/sample rates/);
  const axe2 = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).exclude("#project-model-frame").analyze();
  expect(axe2.violations.map((v) => v.id)).toEqual([]);
});

// The materials list says how the labor was priced when the design was
// saved (summary.rates): at sample rates throughout, some named lines, or
// (the business's own prices) nothing.
test("a project's materials list says which labor lines were at sample rates when it was saved, in en/es/pt", async ({
  page,
}) => {
  const base = {
    v: 1,
    room: { w: 8, l: 5, h: 8 },
    fixtures: [],
    labor: [{ label: "Tile floor", detail: "40 sq ft", cost: 600 }],
    laborSubtotal: 600,
    materials: [],
    products: [],
    materialsTotal: 0,
    grandTotal: 600,
    notes: [],
  };
  await signedIn(page, {
    projects: [
      {
        id: "s1",
        name: "Sample",
        summary: Object.assign({}, base, { rates: { mode: "sample", sampleLines: ["Tile floor"] } }),
        updated_at: DAY,
      },
      {
        id: "p1",
        name: "Partial",
        summary: Object.assign({}, base, { rates: { mode: "partial", sampleLines: ["Tile floor", "Toilet"] } }),
        updated_at: DAY,
      },
      {
        id: "o1",
        name: "Own",
        summary: Object.assign({}, base, { rates: { mode: "own", sampleLines: [] } }),
        updated_at: DAY,
      },
    ],
  });
  const materials = page.locator("#project-materials");
  await page.goto("/project.html?id=s1#materials");
  await expect(materials).toContainText("Labor was at Room Designer 3D's sample rates when this was saved.");
  await page.goto("/project.html?id=p1#materials");
  await expect(materials).toContainText("At save time these lines were at sample rates: Tile floor, Toilet.");
  await expect(materials).not.toContainText("Labor was at");
  await page.goto("/project.html?id=o1#materials");
  await expect(materials).toContainText("$600");
  await expect(materials).not.toContainText(/sample rates/);
  await page.goto("/es/project.html?id=p1#materials");
  await expect(materials).toContainText("Al guardarse, estas líneas estaban a tarifas de ejemplo: Tile floor, Toilet.");
  await page.goto("/pt/project.html?id=s1#materials");
  await expect(materials).toContainText(
    "A mão de obra estava nos valores de exemplo do Room Designer 3D quando isto foi salvo.",
  );
});

test("a project's 3D model tab is a read-only viewer: no steps, no editing, no link toast, no second Open button", async ({
  page,
}) => {
  test.setTimeout(90000); // two visits to the designer, both drawing the 3D room
  await page.goto("/designer.html");
  const design = await page.evaluate(() => window.RoomPlan.encode(window.RoomPlan.fromTemplate("full5x8", null)));
  await signedIn(page, { projects: [{ id: "a1", name: "Garcia bath", design, info: {}, updated_at: DAY }] });
  await page.goto("/designer.html?b=smith-bath&project=a1&embed=1");
  await expect(page.locator(".studio-status")).toBeVisible({ timeout: 20000 });
  await expect.poll(() => page.evaluate(() => window.RoomStudio.design().room.w)).toBe(8);
  await expect(page.locator(".studio-step-btn")).toHaveCount(0);
  await expect(page.locator(".studio-action")).toHaveCount(0);
  await expect(page.locator(".studio-total-chip")).toHaveCount(0);
  await expect(page.locator("#studio-panel")).toBeHidden();
  await expect(page.locator("#studio-riley")).toBeHidden();
  await expect(page.locator("#project-bar")).toBeHidden();
  await expect(page.locator("#studio-toast")).toBeHidden();
  await expect(page.locator(".studio-view-btn[data-view]")).toHaveCount(3);
  await page.locator(".studio-view-btn[data-view='plan']").click();
  await expect(page.locator("#studio-plan")).toBeVisible();
  // Nothing on the plan can be picked up or moved.
  await expect(page.locator(".plan-item[tabindex]")).toHaveCount(0);
  // The project page's own "Open in the designer" button is the one way in.
  await expect(page.getByRole("link", { name: /Open in/ })).toHaveCount(0);
  await expect(page.locator(".studio-open-link")).toHaveCount(0);
});

test("a project's 3D model follows the page when the theme is switched", async ({ page }) => {
  await page.goto("/designer.html");
  const design = await page.evaluate(() => window.RoomPlan.encode(window.RoomPlan.fromTemplate("full5x8", null)));
  await signedIn(page, { projects: [{ id: "a1", name: "Garcia bath", design, info: {}, updated_at: DAY }] });
  await page.goto("/project.html?id=a1");
  await page.locator(".theme-switch [data-theme-choice='dark']").click();
  await expect(page.locator("#project-model-frame")).toHaveAttribute("src", /embed=1$/);
  const model = page.frameLocator("#project-model-frame").locator("html");
  await expect(model).toHaveAttribute("data-theme", "dark");
  await page.locator(".theme-switch [data-theme-choice='light']").click();
  await expect(model).toHaveAttribute("data-theme", "light");
  await page.locator(".theme-switch [data-theme-choice='system']").click();
  await expect(model).not.toHaveAttribute("data-theme", /./);
});

test("My projects sorts, filters by status, searches status words, and keeps the view in the address", async ({
  page,
}) => {
  await signedIn(page, {
    projects: [
      {
        id: "a1",
        name: "Smith main bath",
        info: { status: "progress", start: "2026-12-01" },
        updated_at: "2026-10-03T12:00:00Z",
      },
      { id: "a2", name: "Lee guest bath", info: { status: "lead" }, updated_at: "2026-10-02T12:00:00Z" },
      {
        id: "a3",
        name: "Alvarez powder room",
        info: { status: "progress", start: "2026-11-05" },
        updated_at: "2026-10-01T12:00:00Z",
      },
    ],
  });
  await page.goto("/projects.html");
  const names = page.locator(".project-name");
  await expect(names).toHaveText(["Smith main bath", "Lee guest bath", "Alvarez powder room"]);

  // Soonest start first; a project with no start date last.
  await page.getByLabel("Sort by").selectOption("start");
  await expect(names).toHaveText(["Alvarez powder room", "Smith main bath", "Lee guest bath"]);
  await expect(page).toHaveURL(/sort=start/);
  // In the order a job goes through (new lead first), newest updated within a status.
  await page.getByLabel("Sort by").selectOption("status");
  await expect(names).toHaveText(["Lee guest bath", "Smith main bath", "Alvarez powder room"]);
  await page.reload();
  await expect(page.getByLabel("Sort by")).toHaveValue("status");
  await expect(names).toHaveText(["Lee guest bath", "Smith main bath", "Alvarez powder room"]);

  await page.getByLabel("Sort by").selectOption("name");
  await expect(names).toHaveText(["Alvarez powder room", "Lee guest bath", "Smith main bath"]);
  await page.getByLabel("Status", { exact: true }).selectOption("progress");
  await expect(names).toHaveText(["Alvarez powder room", "Smith main bath"]);
  await expect(page).toHaveURL(/sort=name/);
  await expect(page).toHaveURL(/status=progress/);

  // A reload keeps the view.
  await page.reload();
  await expect(names).toHaveText(["Alvarez powder room", "Smith main bath"]);
  await expect(page.getByLabel("Status", { exact: true })).toHaveValue("progress");

  await page.getByLabel("Status", { exact: true }).selectOption("");
  await page.getByLabel(/^Search/).fill("new lead");
  await expect(names).toHaveText(["Lee guest bath"]);
  await expect(page).toHaveURL(/q=new\+lead/);
  await page.getByLabel(/^Search/).fill("zzz");
  await expect(page.locator("#projects-no-match")).toBeVisible();
  await expect(page.locator("#projects-empty")).toBeHidden();
});

test("when the list can't load, My projects says so with Try again, and never 'No projects yet'", async ({ page }) => {
  const state = await signedIn(page, { projects: [{ id: "a1", name: "Smith main bath", updated_at: DAY }] });
  let failing = true;
  await page.route("**/api/projects**", (route) => {
    if (!failing) return route.fallback();
    return route.fulfill({ status: 500, json: { error: "server" } });
  });
  await page.goto("/projects.html");
  const failed = page.locator("#projects-failed");
  await expect(failed).toBeVisible();
  await expect(failed).toContainText("Couldn't load your projects. Something went wrong on our side.");
  await expect(page.locator("#projects-empty")).toBeHidden();
  await expect(page.locator("#projects-app")).toBeHidden();
  await expect(page.locator("#projects-loading")).toBeHidden();

  failing = false;
  await failed.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".project-item")).toHaveCount(1);
  await expect(failed).toBeHidden();
  expect(state.calls.filter((c) => c.method === "GET").length).toBe(1);
});

test("a list request that never answers times out instead of loading forever", async ({ page }) => {
  test.setTimeout(60000);
  await signedIn(page);
  await page.route("**/api/projects**", () => new Promise(() => {}));
  await page.goto("/projects.html");
  await expect(page.locator("#projects-loading")).toBeVisible();
  await expect(page.locator("#projects-failed")).toBeVisible({ timeout: 25000 });
  await expect(page.locator("#projects-failed")).toContainText("taking too long to answer");
  await expect(page.locator("#projects-empty")).toBeHidden();
});

test("an ended sign-in on My projects shows only the way to log in again, in Portuguese too", async ({ page }) => {
  await signedIn(page);
  await page.route("**/api/projects**", (route) => route.fulfill({ status: 401, json: { error: "signin" } }));
  await page.goto("/pt/projects.html?lang=pt");
  const prompt = page.locator("#projects-signin");
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText("A sua sessão terminou");
  await expect(prompt.getByRole("link", { name: "Entrar" })).toHaveAttribute("href", /signup\.html\?mode=login/);
  await expect(page.locator("#projects-empty")).toBeHidden();
  await expect(page.locator("#projects-failed")).toBeHidden();
  await expect(page.locator("#projects-status")).toBeHidden();
});

test("viewing a saved project never overwrites the owner's unsaved design", async ({ page }) => {
  test.setTimeout(90000); // four visits to the designer, three of them drawing the 3D room
  await page.goto("/designer.html");
  const saved = await page.evaluate(() => window.RoomPlan.encode(window.RoomPlan.fromTemplate("full5x8", null)));
  const draft = await page.evaluate(() => {
    const d = window.RoomPlan.fromTemplate("full5x8", null);
    return window.RoomPlan.encode(window.RoomPlan.resize(d, { w: 10, l: d.room.l, h: d.room.h }));
  });
  await signedIn(page, { projects: [{ id: "a1", name: "Old job", design: saved, updated_at: DAY }] });

  // The owner's work in progress: a 10 ft wide room, kept in this browser.
  await openStudio(page, `/designer.html?b=smith-bath#design=${draft}`);
  await expect.poll(() => page.evaluate(() => window.RoomStudio.design().room.w)).toBe(10);
  const stored = () =>
    page.evaluate(() => {
      const raw = localStorage.getItem("rd3d_design_smith-bath");
      return raw ? JSON.parse(raw).design.room.w : null;
    });
  await expect.poll(stored).toBe(10);

  // They look at an old project (as its page does, and as "Open in the designer" does).
  await page.goto("/designer.html?b=smith-bath&project=a1&embed=1");
  await expect(page.locator(".studio-status")).toBeVisible({ timeout: 20000 });
  await expect.poll(() => page.evaluate(() => window.RoomStudio.design().room.w)).toBe(8);
  await page.waitForTimeout(600); // past the studio's save debounce
  expect(await stored()).toBe(10);

  await openStudio(page, "/designer.html?b=smith-bath&project=a1");
  await expect(page.locator("#project-bar")).toContainText("Project: Old job");
  await expect.poll(() => page.evaluate(() => window.RoomStudio.design().room.w)).toBe(8);
  await page.locator("#studio-size-w").fill("6");
  await page.locator("#studio-size-w").press("Enter");
  await page.waitForTimeout(600);
  expect(await stored()).toBe(10);

  // Back in their own designer, the work in progress is still there.
  await openStudio(page, "/designer.html?b=smith-bath");
  await expect.poll(() => page.evaluate(() => window.RoomStudio.design().room.w)).toBe(10);
});

test("the save bar shows unsaved changes after a save, warns before leaving, and handles a two-tab conflict", async ({
  page,
}) => {
  await page.goto("/designer.html");
  const design = await page.evaluate(() => window.RoomPlan.encode(window.RoomPlan.fromTemplate("full5x8", null)));
  const state = await signedIn(page, { projects: [{ id: "a1", name: "Wide bath", design, updated_at: DAY }] });
  await openStudio(page, "/designer.html?b=smith-bath&project=a1");
  await expect(page.locator("#project-bar")).toContainText("Project: Wide bath");
  await expect.poll(() => page.evaluate(() => window.RoomStudio.design().room.w)).toBe(8);
  const status = page.locator("#project-status");
  await expect(status).toBeHidden();
  const leaving = () =>
    page.evaluate(() => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
  expect(await leaving()).toBe(false);

  // An edit: the bar says so, and leaving asks first.
  await page.locator("#studio-size-w").fill("9");
  await page.locator("#studio-size-w").press("Enter");
  await expect(status).toContainText("Unsaved changes");
  expect(await leaving()).toBe(true);

  await page.locator("#project-save").click();
  await expect(status).toContainText("Saved “Wide bath”.");
  expect(await leaving()).toBe(false);
  const first = state.calls.filter((c) => c.method === "PATCH")[0];
  expect(first.body.updated_at).toBe(DAY);

  // "Saved" doesn't outlive the next edit.
  await page.locator("#studio-size-w").fill("10");
  await page.locator("#studio-size-w").press("Enter");
  await expect(status).toContainText("Unsaved changes");
  await expect(status).not.toContainText("Saved");

  // Another tab saved meanwhile: the save is refused, with the choice.
  state.projects[0].updated_at = "2026-10-05T09:00:00Z";
  await page.locator("#project-save").click();
  await expect(status).toContainText("changed in another tab or on another device");
  await expect(status.getByRole("button", { name: "Load the newer version" })).toBeVisible();
  await status.getByRole("button", { name: "Save mine anyway" }).click();
  await expect(status).toContainText("Saved “Wide bath”.");
  const patches = state.calls.filter((c) => c.method === "PATCH");
  expect(patches.length).toBe(3);
  expect(patches[2].body.updated_at).toBeUndefined();
  expect(await page.evaluate(() => window.RoomPlan.decode(window.StudioDesign.encoded()).room.w)).toBe(10);
});

test("the save dialog has a close X, keeps typed details when reopened, and puts a field's error next to it", async ({
  page,
}) => {
  await signedIn(page);
  await page.route("**/api/projects**", (route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.fallback();
    return route.fulfill({ status: 400, json: { error: "info", field: "client", reason: "long" } });
  });
  await openStudio(page, "/designer.html?b=smith-bath");
  await page.locator("#project-save").click();
  const dialog = page.locator("#project-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Client name").fill("Maria Garcia");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await page.locator("#project-save").click();
  await expect(dialog.getByLabel("Client name")).toHaveValue("Maria Garcia");

  // A bad email is caught here, at the field.
  await dialog.getByLabel("Email").fill("not-an-email");
  await dialog.getByRole("button", { name: "Save project" }).click();
  await expect(dialog.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByLabel("Email")).toBeFocused();
  await expect(dialog.locator("#new-email-error")).toHaveText("Enter a valid email address.");

  // A field the server refuses is marked the same way.
  await dialog.getByLabel("Email").fill("maria@example.com");
  await dialog.getByRole("button", { name: "Save project" }).click();
  await expect(dialog.getByLabel("Email")).not.toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByLabel("Client name")).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.locator("#new-client-error")).toHaveText("This is too long. Shorten it.");
  await expect(dialog.getByLabel("Client name")).toBeFocused();
});

test("saving a project while offline says so, and the design is kept", async ({ page, context }) => {
  await signedIn(page);
  await openStudio(page, "/es/designer.html?b=smith-bath&lang=es");
  await page.locator("#project-save").click();
  await context.setOffline(true);
  await page.route("**/api/projects**", (route) => route.abort("internetdisconnected"));
  await page.locator("#project-dialog").getByRole("button", { name: "Guardar proyecto" }).click();
  await expect(page.locator("#project-dialog-status")).toContainText(
    "No se pudo guardar el proyecto. Está sin conexión. Revise su conexión e inténtelo de nuevo.",
  );
  await context.setOffline(false);
});

test("an owner who hasn't set prices is told the estimate is at default rates, on screen and in the PDF text", async ({
  page,
}) => {
  test.setTimeout(60000);
  await signedIn(page);
  await openStudio(page, "/designer.html?b=smith-bath");
  await answerAll(page);
  await page.locator(".studio-step-btn[data-step='estimate']").click();
  const stepEl = page.locator(".studio-step.is-estimate");
  const intro = stepEl.locator(".studio-step-intro");
  await expect(intro).toContainText("you haven't set your own labor prices yet");
  await expect(intro).not.toContainText("at your prices");
  await expect(intro.getByRole("link", { name: "Set your prices on the account page." })).toHaveAttribute(
    "href",
    /account\.html$/,
  );
  await expect(page.locator(".riley-text")).toContainText("at default sample prices for now");
  // The card charges the plumbing and electrical points and says so; nothing calls them excluded.
  const card = page.getByTestId("estimate-card");
  await expect(card).toContainText("Plumbing points");
  await expect(card).toContainText("Plumbing and electrical are priced per point");
  await expect(card).toContainText("default sample rates");
  await expect(card).not.toContainText("excludes plumbing");
  await expect(card).not.toContainText("is not included. Toilets");
});

test("a project's info form asks before leaving with edits, and a stale save offers the newer version", async ({
  page,
}) => {
  const state = await signedIn(page, {
    projects: [{ id: "a1", name: "Garcia bath", design: "", info: { client: "Maria Garcia" }, updated_at: DAY }],
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/project.html?id=a1#info");
  await expect(page.locator("#panel-info")).toBeVisible();
  const leaving = () =>
    page.evaluate(() => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
  expect(await leaving()).toBe(false);
  await page.locator("#panel-info").getByLabel("Phone").fill("801-555-0100");
  expect(await leaving()).toBe(true);
  // The warning's text exists in every language (no "unknown key" error).
  expect(errors).toEqual([]);

  // Someone else saved the project meanwhile.
  state.projects[0].updated_at = "2026-10-05T09:00:00Z";
  state.projects[0].info = { client: "Maria Garcia", city: "Orem" };
  await page.getByRole("button", { name: "Save info" }).click();
  const out = page.locator("#project-info-status");
  await expect(out).toContainText("changed in another tab or on another device");
  await out.getByRole("button", { name: "Load the newer version" }).click();
  await expect(page.locator("#panel-info").getByLabel("City")).toHaveValue("Orem");
  await expect(page.locator("#panel-info").getByLabel("Phone")).toHaveValue("");
  expect(await leaving()).toBe(false);

  await page.locator("#panel-info").getByLabel("Phone").fill("801-555-0100");
  await page.getByRole("button", { name: "Save info" }).click();
  await expect(out).toHaveText("Info saved.");
  expect(await leaving()).toBe(false);
  const last = state.calls.filter((c) => c.method === "PATCH").pop();
  expect(last.body.info).toEqual({ client: "Maria Garcia", city: "Orem", phone: "801-555-0100" });
});

test("rename cancels on Escape", async ({ page }) => {
  await signedIn(page, { projects: [{ id: "a1", name: "Smith main bath", updated_at: DAY }] });
  await page.goto("/projects.html");
  await page.getByRole("button", { name: "Rename Smith main bath" }).click();
  const input = page.getByLabel("Project name");
  await input.fill("Something else");
  await input.press("Escape");
  await expect(page.locator(".project-rename")).toHaveCount(0);
  await expect(page.locator(".project-name")).toHaveText("Smith main bath");
  await expect(page.getByRole("button", { name: "Rename Smith main bath" })).toBeFocused();
});

test("in the owner's own designer the estimate step speaks to the business, not a homeowner", async ({ page }) => {
  test.setTimeout(60000);
  // Every labor price set: the estimate is at the owner's prices throughout.
  // (Some set, and none set, are covered in business-profile.spec.js.)
  const prices = {};
  for (const key of Object.keys(require("../../js/bathroom-pricing.js").DEFAULT_PRICES)) prices[key] = 100;
  prices.Labor_Tax_Rate_Percent = 0;
  await signedIn(page, { prices });
  await openStudio(page, "/designer.html?b=smith-bath");
  await answerAll(page);
  await page.locator(".studio-step-btn[data-step='estimate']").click();
  const intro = page.locator(".studio-step.is-estimate .studio-step-intro");
  await expect(intro).toContainText("A rough, non-binding estimate at your prices.");
  await expect(intro).not.toContainText("sample");
  await expect(intro).toContainText("Save it as a project, or download the PDF for your client.");
  await expect(page.locator(".riley-text")).toContainText("Save it as a project");
  await expect(page.locator(".studio-demo-end")).toHaveCount(0);
  // Save project sits with the end-of-design actions and presses the save bar's button.
  const save = page.locator(".studio-est-actions [data-key='save']");
  await expect(save).toHaveText("Save project");
  await save.click();
  await expect(page.locator("#project-dialog")).toBeVisible();
  await page.locator("#project-dialog-close").click();
  // (The public demo's ending is covered in studio.spec.js.)
});

test("My projects says 'No client yet' / 'No status yet' for empty fields, and Clear filters puts the list back", async ({
  page,
}) => {
  await signedIn(page, {
    projects: [
      { id: "a1", name: "Smith main bath", info: { client: "Pat Smith", status: "progress" }, updated_at: DAY },
      { id: "a2", name: "Lee guest bath", info: {}, updated_at: "2026-09-30T12:00:00Z" },
    ],
  });
  await page.goto("/projects.html");
  const rows = page.locator(".project-item");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator(".project-client")).toHaveText("Pat Smith");
  await expect(rows.nth(0).locator(".project-status")).toHaveText("In progress");
  // Empty fields are labelled, never a bare dash or an empty pill.
  await expect(rows.nth(1).locator(".project-client")).toHaveText("No client yet");
  await expect(rows.nth(1).locator(".project-status.is-none")).toHaveText("No status yet");
  await expect(rows.nth(1).locator(".project-start")).toHaveText("No start date yet");
  await expect(page.locator("#projects-list")).not.toContainText("—");
  await expect(page.locator("#projects-usage")).not.toContainText("UTC");

  const clear = page.getByRole("button", { name: "Clear filters" });
  await expect(clear).toBeHidden();
  await page.getByLabel("Status", { exact: true }).selectOption("progress");
  await expect(rows).toHaveCount(1);
  await expect(clear).toBeVisible();
  await page.getByLabel(/^Search/).fill("zzz");
  await expect(page.locator("#projects-no-match")).toBeVisible();
  await clear.click();
  await expect(rows).toHaveCount(2);
  await expect(clear).toBeHidden();
  await expect(page.getByLabel("Status", { exact: true })).toHaveValue("");
  await expect(page.getByLabel(/^Search/)).toHaveValue("");
  await expect(page).not.toHaveURL(/status=|q=/);

  // Portuguese says it in its own words.
  await page.goto("/pt/projects.html?status=lead");
  await expect(page.getByRole("button", { name: "Limpar filtros" })).toBeVisible();

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});

test("the delete-project dialog closes from its X and from a click on the backdrop, deleting nothing", async ({
  page,
}) => {
  const state = await signedIn(page, { projects: [{ id: "a1", name: "Smith main bath", updated_at: DAY }] });
  await page.goto("/projects.html");
  const dialog = page.locator("#projects-delete-dialog");
  const ask = page.getByRole("button", { name: "Delete Smith main bath" });
  await ask.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await expect(ask).toBeFocused();
  await ask.click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(4, 4); // the backdrop
  await expect(dialog).toBeHidden();
  // A click inside the dialog's body keeps it open.
  await ask.click();
  await dialog.locator("h2").click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(state.calls.filter((c) => c.method === "DELETE")).toEqual([]);
  await expect(page.locator(".project-item")).toHaveCount(1);
});

test("saving switched off after the designer loaded: the save says it's paused, with the owner's notice on its own line", async ({
  page,
}) => {
  await signedIn(page);
  await page.route("**/api/projects**", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    return route.fulfill({
      status: 503,
      json: { error: "paused", switch: "saving", notice: "Back Monday 9am." },
    });
  });
  await openStudio(page, "/designer.html?b=smith-bath");
  await page.locator("#project-save").click();
  const dialog = page.locator("#project-dialog");
  await dialog.getByLabel("Client name").fill("Maria Garcia");
  await dialog.getByRole("button", { name: "Save project" }).click();
  const out = page.locator("#project-dialog-status");
  await expect(out).toContainText("Saving projects is paused right now");
  await expect(out).toContainText("Notice: Back Monday 9am.");
  await expect(out).not.toContainText(/9am Saving|reach the server/);
  expect(await out.textContent()).toMatch(/while\.\nNotice: Back Monday 9am\.$/);
  // The design is still here to save later.
  await expect(dialog.getByLabel("Client name")).toHaveValue("Maria Garcia");
});

test("when the stored sign-in can't be checked, the save bar says so with Try again instead of hiding", async ({
  page,
}) => {
  await signedIn(page);
  // The sign-in library never arrives, so the session can't be read.
  await page.route("**/js/vendor/supabase/supabase.js", (route) => route.abort("failed"));
  await openStudio(page, "/designer.html?b=smith-bath");
  const bar = page.locator("#project-bar");
  // The bar comes after the 3D room has started, which is slow in CI.
  await expect(bar).toBeVisible({ timeout: 15000 });
  await expect(bar).toContainText("Your sign-in couldn't be checked, so saving to your projects isn't available");
  await expect(bar.getByRole("link", { name: "Try again" })).toBeVisible();
  await expect(page.locator("#project-save")).toBeHidden();
});

test("when the business can't be read, My projects and the project page say so with Try again, never the demo designer", async ({
  page,
}) => {
  await signedIn(page, {
    projects: [{ id: "a1", name: "Smith main bath", design: "", info: {}, updated_at: DAY }],
  });
  let failing = true;
  await page.route(SUPABASE + "/rest/v1/businesses**", (route) => {
    if (!failing) return route.fulfill({ json: { slug: "smith-bath" } });
    return route.fulfill({ status: 500, json: { message: "db down" } });
  });
  await page.goto("/projects.html");
  const failed = page.locator("#projects-failed");
  await expect(failed).toBeVisible();
  await expect(failed).toContainText("Your business profile couldn't be loaded");
  await expect(page.locator("#projects-app")).toBeHidden();
  // Nothing points at the demo designer.
  await expect(page.locator("#project-new")).toBeHidden();
  failing = false;
  await failed.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator("#projects-app")).toBeVisible();
  await expect(page.locator("#project-new")).toHaveAttribute("href", /designer\.html\?b=smith-bath$/);

  failing = true;
  await page.goto("/project.html?id=a1");
  const error = page.locator("#project-error");
  await expect(error).toBeVisible();
  await expect(error).toContainText("Your business profile couldn't be loaded");
  await expect(error.getByRole("link", { name: "Try again" })).toBeVisible();
  await expect(page.locator("#project-app")).toBeHidden();
});

test("saving paused (the kill switch): the designer's bar and My projects say so up front, with the owner's notice", async ({
  page,
}) => {
  await signedIn(page);
  await page.route("**/api/config*", (route) =>
    route.fulfill({
      json: {
        accounts: true,
        payments: false,
        supabaseUrl: SUPABASE,
        supabaseAnonKey: "anon",
        plans: {},
        switches: { signups: true, checkout: true, saving: false },
        notice: "Back Monday 9am.",
      },
    }),
  );
  await openStudio(page, "/designer.html?b=smith-bath");
  const bar = page.locator("#project-bar");
  await expect(bar).toBeVisible({ timeout: 15000 });
  await expect(bar).toContainText("Saving projects is paused right now.");
  await expect(bar).toContainText("Notice: Back Monday 9am.");
  await expect(bar).not.toContainText("new projects left");
  await expect(page.locator("#project-save")).toBeHidden();
  // The estimate step has no Save button either.
  await answerAll(page);
  await step(page, "estimate").click();
  await expect(page.getByTestId("estimate-card")).toBeVisible();
  await expect(page.locator('[data-key="save"]')).toHaveCount(0);

  await page.goto("/es/projects.html");
  const paused = page.locator("#projects-paused");
  await expect(paused).toBeVisible();
  await expect(paused).toContainText("Guardar proyectos está pausado por ahora.");
  await expect(paused).toContainText("Aviso: Back Monday 9am.");
});

test("at desktop width My projects can be a table, and the pick is kept in this browser", async ({ page }) => {
  await signedIn(page, {
    projects: [
      { id: "a1", name: "Smith main bath", info: { status: "progress", start: "2026-12-01" }, updated_at: DAY },
      { id: "a2", name: "Lee guest bath", info: {}, updated_at: DAY },
    ],
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/projects.html");
  const list = page.locator("#projects-list");
  await expect(page.locator(".project-item")).toHaveCount(2);
  await expect(list).not.toHaveClass(/is-table/);
  await expect(page.locator("#projects-table-head")).toBeHidden();
  await page.getByLabel("View").selectOption("table");
  await expect(list).toHaveClass(/is-table/);
  await expect(page.locator("#projects-table-head")).toBeVisible();
  // Each fact is a cell in its own column, left to right.
  const row = page.locator(".project-item").first();
  const columns = await row.evaluate((li) => {
    const lefts = [
      ".project-name",
      ".project-client",
      ".project-status",
      ".project-start",
      ".project-updated",
      ".project-actions",
    ].map((sel) => li.querySelector(sel).getBoundingClientRect().left);
    return lefts.every((x, i) => i === 0 || x > lefts[i - 1]);
  });
  expect(columns).toBe(true);
  await expect(row.locator(".project-start")).toHaveText("Starts Dec 1, 2026");
  await expect(page.locator(".project-item").nth(1).locator(".project-start")).toHaveText("No start date yet");
  // Each heading sits over its column (the same column template, with a
  // fixed-width actions column, so a row's buttons can't shift the others),
  // the heading row sticks while the list scrolls, and from 1280 px the page
  // uses the width a table needs rather than a ~760 px card.
  const aligned = await page.evaluate(() => {
    const heads = Array.from(document.querySelectorAll("#projects-table-head [role=columnheader]"));
    const cells = [
      ".project-name",
      ".project-client",
      ".project-status",
      ".project-start",
      ".project-updated",
      ".project-actions",
    ].map((sel) => document.querySelector(".project-item " + sel));
    return heads.map((h, i) => Math.abs(h.getBoundingClientRect().left - cells[i].getBoundingClientRect().left));
  });
  expect(aligned.length).toBe(6);
  for (const off of aligned) expect(off).toBeLessThanOrEqual(1);
  expect(await page.locator("#projects-table-head").evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
  expect(await page.locator(".app-wide").evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(1000);
  // A normal name stays on one or two lines.
  const nameLines = await row
    .locator(".project-name")
    .evaluate((a) => a.getBoundingClientRect().height / parseFloat(getComputedStyle(a).lineHeight));
  expect(nameLines).toBeLessThanOrEqual(2);
  // The headings sort: by name puts "Lee guest bath" first and marks the
  // heading; a second click reverses the order (said on the column header
  // and kept in the address); the Sort by control puts it forward again.
  const nameHead = page.getByRole("columnheader", { name: "Project" });
  const nameBtn = nameHead.getByRole("button");
  await expect(nameHead).toHaveAttribute("aria-sort", "none");
  await nameBtn.click();
  await expect(page.locator(".project-item").first().locator(".project-name")).toHaveText("Lee guest bath");
  await expect(page.getByLabel("Sort by")).toHaveValue("name");
  await expect(nameBtn).toHaveAttribute("aria-pressed", "true");
  await expect(nameHead).toHaveAttribute("aria-sort", "ascending");
  await expect(page).toHaveURL(/sort=name(?!-)/);
  await nameBtn.click();
  await expect(page.locator(".project-item").first().locator(".project-name")).toHaveText("Smith main bath");
  await expect(nameHead).toHaveAttribute("aria-sort", "descending");
  await expect(nameBtn).toHaveClass(/is-desc/);
  await expect(page).toHaveURL(/sort=name-desc/);
  await page.reload();
  await expect(list).toHaveClass(/is-table/);
  await expect(page.getByLabel("View")).toHaveValue("table");
  await expect(page.locator(".project-item").first().locator(".project-name")).toHaveText("Smith main bath");
  await expect(nameHead).toHaveAttribute("aria-sort", "descending");
  await page.getByLabel("Sort by").selectOption("name");
  await expect(page.locator(".project-item").first().locator(".project-name")).toHaveText("Lee guest bath");
  await expect(nameHead).toHaveAttribute("aria-sort", "ascending");
  await page.getByRole("columnheader", { name: "Updated" }).getByRole("button").click();
  await expect(page.getByLabel("Sort by")).toHaveValue("updated");
  await expect(page).not.toHaveURL(/sort=/);
  // Phones keep the cards whatever the pick, and don't offer it.
  await page.setViewportSize({ width: 375, height: 800 });
  await expect(page.getByLabel("View")).toBeHidden();
  await expect(page.locator("#projects-table-head")).toBeHidden();
  const stacked = await row.evaluate((li) => {
    const a = li.querySelector(".project-name").getBoundingClientRect().top;
    const b = li.querySelector(".project-updated").getBoundingClientRect().top;
    return b > a;
  });
  expect(stacked).toBe(true);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});

test("My projects sends an ended sign-in to log in with the way back", async ({ page }) => {
  await page.route("**/api/config*", (route) =>
    route.fulfill({
      json: { accounts: true, payments: false, supabaseUrl: SUPABASE, supabaseAnonKey: "anon", plans: {} },
    }),
  );
  await page.route(SUPABASE + "/**", (route) => route.fulfill({ json: {} }));
  await page.goto("/es/projects.html?status=lead");
  await page.waitForURL(/\/es\/signup\.html\?mode=login&next=/);
  const next = new URL(page.url()).searchParams.get("next");
  expect(next).toBe("/es/projects.html?status=lead");
});

// Opening a saved project: the designer never shows the sample room as the
// project, never says "isn't saved" or offers Save while the project is on its
// way, and the plan counts and the project load side by side.
test("while a saved project loads, the bar says so and offers nothing to save, and the studio waits for it", async ({
  page,
}) => {
  test.setTimeout(90000); // the 3D room starts only once the project is in, which is slow in CI
  await page.goto("/designer.html");
  const design = await page.evaluate(() => {
    const d = window.RoomPlan.fromTemplate("full5x8", null);
    return window.RoomPlan.encode(window.RoomPlan.resize(d, { w: 10, l: d.room.l, h: d.room.h }));
  });
  const state = await signedIn(page, { projects: [{ id: "a1", name: "Wide bath", design, updated_at: DAY }] });
  // The project itself takes 4 s; the counts answer at once.
  let release;
  const held = new Promise((r) => (release = r));
  const timing = [];
  await page.route("**/api/projects**", async (route) => {
    const url = new URL(route.request().url());
    timing.push({ id: url.searchParams.get("id"), counts: url.searchParams.get("counts"), at: Date.now() });
    if (route.request().method() === "GET" && url.searchParams.get("id")) await held;
    return route.fallback();
  });
  await page.goto("/designer.html?b=smith-bath&project=a1");
  const bar = page.locator("#project-bar");
  await expect(bar).toBeVisible({ timeout: 15000 });
  await expect(bar).toContainText("Opening your project…");
  // Both requests were sent, in parallel (the counts didn't wait for the project).
  await expect.poll(() => timing.length).toBe(2);
  expect(timing.some((t) => t.counts === "1")).toBe(true);
  expect(timing.some((t) => t.id === "a1")).toBe(true);
  // During the load: no "isn't saved", no Save, no studio to edit, the loading panel up.
  await page.waitForTimeout(1500);
  await expect(bar).toContainText("Opening your project…");
  await expect(bar).not.toContainText("isn't saved");
  await expect(bar).not.toContainText("new projects left");
  await expect(page.locator("#project-save")).toBeHidden();
  await expect(page.locator("#project-save-new")).toBeHidden();
  await expect(page.locator(".studio-step-btn")).toHaveCount(0);
  await expect(page.locator("#studio-loading")).toBeVisible();
  expect(await page.evaluate(() => (window.RoomStudio ? window.StudioDesign.encoded() : ""))).toBe("");
  // Pressing Enter in the bar's form can't start a new project.
  expect(state.calls.filter((c) => c.method === "POST").length).toBe(0);

  release();
  await expect(bar).toContainText("Project: Wide bath", { timeout: 30000 });
  await expect(page.locator(".studio-step-btn")).toHaveCount(6, { timeout: 30000 });
  await expect(page.locator("#studio-loading")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.RoomPlan.decode(window.StudioDesign.encoded()).room.w)).toBe(10);
  await expect(page.locator("#project-save")).toBeVisible();
  await expect(page.locator("#project-save")).toHaveText("Save changes");
  await expect(page.locator("#project-status")).toBeHidden();
  expect(state.calls.filter((c) => c.method === "POST").length).toBe(0);
});

test("a saved project that can't be opened says so with a way out: Try again for a server problem, Back to My projects when it's gone", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto("/designer.html");
  const design = await page.evaluate(() => window.RoomPlan.encode(window.RoomPlan.fromTemplate("full5x8", null)));
  await signedIn(page, { projects: [{ id: "a1", name: "Old job", design, updated_at: DAY }] });
  let failing = true;
  await page.route("**/api/projects**", (route) => {
    const url = new URL(route.request().url());
    if (!failing || !url.searchParams.get("id")) return route.fallback();
    return route.fulfill({ status: 500, json: { error: "server" } });
  });
  await page.goto("/designer.html?b=smith-bath&project=a1");
  const bar = page.locator("#project-bar");
  await expect(bar).toContainText("Couldn't open the project.", { timeout: 15000 });
  await expect(bar).not.toContainText("isn't saved");
  await expect(page.locator("#project-save")).toBeHidden();
  await expect(page.locator("#project-save-new")).toBeHidden();
  await expect(bar.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(bar.getByRole("link", { name: "Back to My projects" })).toHaveAttribute("href", /projects\.html$/);
  // The studio didn't start on the sample room: its loading panel says the same.
  await expect(page.locator(".studio-step-btn")).toHaveCount(0);
  const panel = page.locator("#studio-loading");
  await expect(panel).toContainText("Couldn't open the project.");
  await expect(panel.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(panel.locator(".studio-loading-slow")).toBeHidden();

  failing = false;
  await bar.getByRole("button", { name: "Try again" }).click();
  await expect(bar).toContainText("Project: Old job", { timeout: 30000 });
  await expect(page.locator(".studio-step-btn")).toHaveCount(6, { timeout: 30000 });
  await expect(page.locator("#project-save")).toBeVisible();

  // A project that isn't there: no Try again that can't help.
  await page.goto("/es/designer.html?b=smith-bath&project=gone");
  await expect(bar).toContainText("No se encontró ese proyecto.", { timeout: 15000 });
  await expect(bar.getByRole("button", { name: "Intentar de nuevo" })).toHaveCount(0);
  await expect(bar.getByRole("link", { name: "Volver a Mis proyectos" })).toHaveAttribute(
    "href",
    /es\/projects\.html$/,
  );
  await expect(page.locator(".studio-step-btn")).toHaveCount(0);

  // The project page says the same, with the same way out.
  await page.goto("/project.html?id=gone");
  const error = page.locator("#project-error");
  await expect(error).toContainText("That project wasn't found.");
  await expect(error.getByRole("link", { name: "Try again" })).toHaveCount(0);
  await expect(error.getByRole("link", { name: "Back to My projects" })).toHaveAttribute("href", /projects\.html$/);
});

test("a business read that never answers times out on My projects and the project page, and Try again isn't held behind it", async ({
  page,
}) => {
  test.setTimeout(90000);
  await signedIn(page, { projects: [{ id: "a1", name: "Smith main bath", design: "", info: {}, updated_at: DAY }] });
  let hanging = true;
  const seen = [];
  await page.route(SUPABASE + "/rest/v1/businesses**", (route) => {
    seen.push(Date.now());
    if (hanging) return new Promise(() => {});
    return route.fulfill({ json: { slug: "smith-bath" } });
  });
  await page.goto("/pt/projects.html");
  await expect(page.locator("#projects-loading")).toBeVisible();
  const failed = page.locator("#projects-failed");
  await expect(failed).toBeVisible({ timeout: 20000 });
  await expect(failed).toContainText("Não foi possível carregar o perfil da sua empresa");
  await expect(page.locator("#projects-app")).toBeHidden();
  // The hung request was aborted, so the retry is answered at once.
  hanging = false;
  const before = Date.now();
  await failed.getByRole("button", { name: "Tentar de novo" }).click();
  await expect(page.locator("#projects-app")).toBeVisible({ timeout: 5000 });
  expect(Date.now() - before).toBeLessThan(5000);
  expect(seen.length).toBe(2);

  hanging = true;
  await page.goto("/project.html?id=a1");
  const error = page.locator("#project-error");
  await expect(error).toBeVisible({ timeout: 20000 });
  await expect(error).toContainText("Your business profile couldn't be loaded");
  await expect(error.getByRole("link", { name: "Try again" })).toBeVisible();
});

test("a project's materials list is dated by when the design was saved, not by a later rename", async ({ page }) => {
  await page.goto("/designer.html");
  const design = await page.evaluate(() => window.RoomPlan.encode(window.RoomPlan.fromTemplate("full5x8", null)));
  const summary = {
    v: 1,
    savedAt: "2026-09-12T15:00:00Z",
    room: { w: 8, l: 5, h: 8 },
    fixtures: [],
    labor: [],
    laborSubtotal: 0,
    materials: [],
    products: [],
    materialsTotal: 0,
    grandTotal: 0,
    notes: [],
  };
  await signedIn(page, {
    projects: [
      { id: "a1", name: "Garcia bath", design, info: {}, summary, updated_at: DAY },
      // An older row, saved before the stamp: falls back to when it was last updated.
      {
        id: "a2",
        name: "Old row",
        design,
        info: {},
        summary: Object.assign({}, summary, { savedAt: undefined }),
        updated_at: DAY,
      },
    ],
  });
  await page.goto("/project.html?id=a1#materials");
  await expect(page.locator("#project-materials")).toContainText("last saved (Sep 12, 2026)");
  await expect(page.locator("#project-updated")).toHaveText("Updated Oct 1, 2026");
  await page.goto("/project.html?id=a2#materials");
  await expect(page.locator("#project-materials")).toContainText("last saved (Oct 1, 2026)");
});

test("a start date in an implausible year is refused at the field, in the browser and by the server's reason", async ({
  page,
}) => {
  await signedIn(page, {
    projects: [{ id: "a1", name: "Garcia bath", design: "", info: { client: "Maria Garcia" }, updated_at: DAY }],
  });
  await page.route("**/api/projects**", (route) => {
    const req = route.request();
    if (req.method() !== "PATCH") return route.fallback();
    return route.fulfill({ status: 400, json: { error: "info", field: "start", reason: "year" } });
  });
  await page.goto("/project.html?id=a1#info");
  const start = page.locator("#panel-info").getByLabel("Target start date");
  const year = new Date().getUTCFullYear() + 10;
  await start.fill("1950-01-01");
  await page.getByRole("button", { name: "Save info" }).click();
  await expect(start).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#info-start-error")).toHaveText(`Pick a start date between 2000 and ${year}.`);
  await expect(start).toBeFocused();
  // The server's own refusal lands on the same field with the same words.
  await start.fill("2030-01-01");
  await page.getByRole("button", { name: "Save info" }).click();
  await expect(start).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#info-start-error")).toHaveText(`Pick a start date between 2000 and ${year}.`);
});

// The table view is offered only where it fits: from 1180 px every heading
// sits in its own box in all three languages, the Project column has real
// room, and the page keeps using the width above 1280.
test("the table view fits at every width it's offered, in en/es/pt, and grows with the window", async ({ page }) => {
  test.setTimeout(90000);
  const projects = [];
  for (let i = 0; i < 12; i++) {
    projects.push({
      id: "p" + i,
      name: "Garcia master bath " + i,
      info: {
        client: "Maria Garcia " + i,
        street: "1200 Blueprint Avenue",
        city: "Springfield",
        state: "IL",
        zip: "62704",
        status: ["lead", "estimate", "approved", "progress", "done"][i % 5],
        start: "2026-11-0" + ((i % 9) + 1),
      },
      updated_at: DAY,
    });
  }
  await signedIn(page, { projects });
  await page.addInitScript(() => localStorage.setItem("rd3d_projects_view", "table"));
  for (const dir of ["", "es/", "pt/"]) {
    for (const width of [1180, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/" + dir + "projects.html");
      await expect(page.locator(".project-item")).toHaveCount(12);
      await expect(page.locator("#projects-list")).toHaveClass(/is-table/);
      const facts = await page.evaluate(() => {
        const heads = Array.from(document.querySelectorAll("#projects-table-head [role=columnheader]"));
        const row = document.querySelector(".project-item");
        const cells = [".project-name", ".project-client", ".project-status", ".project-start", ".project-updated"];
        const name = row.querySelector(".project-name");
        return {
          // No heading runs past its box or into its neighbour.
          overflow: heads.map((h) => h.scrollWidth - h.clientWidth),
          gaps: heads.map((h, i) =>
            i ? h.getBoundingClientRect().left - heads[i - 1].getBoundingClientRect().right : 1,
          ),
          projectWidth: name.getBoundingClientRect().width,
          nameLines: name.getBoundingClientRect().height / parseFloat(getComputedStyle(name).lineHeight),
          aligned: heads.map(
            (h, i) =>
              i >= cells.length ||
              Math.abs(h.getBoundingClientRect().left - row.querySelector(cells[i]).getBoundingClientRect().left) <= 1,
          ),
          page: document.querySelector(".app-wide").getBoundingClientRect().width,
        };
      });
      const label = dir + "@" + width;
      for (const o of facts.overflow) expect(o, label + " heading overflow").toBeLessThanOrEqual(0);
      for (const g of facts.gaps) expect(g, label + " headings apart").toBeGreaterThan(0);
      expect(facts.aligned.every(Boolean), label + " headings over their columns").toBe(true);
      expect(facts.projectWidth, label + " project column").toBeGreaterThanOrEqual(160);
      if (width >= 1280) expect(facts.nameLines, label + " name on one line").toBeLessThanOrEqual(1.05);
      if (width === 1440) expect(facts.page, "the table grows past 1280").toBeGreaterThan(1250);
    }
  }
  // Between the phone layout and 1180 the cards stay, and the table isn't offered.
  for (const width of [900, 1024, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByLabel("View")).toBeHidden();
    await expect(page.locator("#projects-table-head")).toBeHidden();
    // The rows are cards again: the name sits above the dates, not beside them.
    const stacked = await page
      .locator(".project-item")
      .first()
      .evaluate((li) => {
        return (
          li.querySelector(".project-updated").getBoundingClientRect().top >
          li.querySelector(".project-name").getBoundingClientRect().top
        );
      });
    expect(stacked, "cards at " + width).toBe(true);
  }
});

// Every control in the list's toolbar shows its whole value, and the labels
// stay on one line, so the Spanish "Estado del proyecto" doesn't push its
// select below the others.
test("the Status filter shows its whole value and its label stays on one line, in en/es/pt at desktop widths", async ({
  page,
}) => {
  await signedIn(page, {
    projects: [
      { id: "a1", name: "Smith main bath", info: { status: "progress" }, updated_at: DAY },
      { id: "a2", name: "Lee guest bath", info: {}, updated_at: DAY },
    ],
  });
  for (const dir of ["", "es/", "pt/"]) {
    for (const width of [1024, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/" + dir + "projects.html");
      await expect(page.locator(".project-item")).toHaveCount(2);
      const facts = await page.evaluate(() => {
        // The width the selected option's words need, in the select's font.
        const needs = (select) => {
          const probe = document.createElement("span");
          probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap";
          probe.style.font = getComputedStyle(select).font;
          probe.textContent = select.options[select.selectedIndex].textContent;
          document.body.appendChild(probe);
          const w = probe.getBoundingClientRect().width;
          probe.remove();
          return w;
        };
        const out = {};
        for (const id of ["projects-sort", "projects-filter"]) {
          const select = document.getElementById(id);
          const label = document.querySelector('label[for="' + id + '"]');
          out[id] = {
            room: select.clientWidth - needs(select), // the arrow and padding need ~30 px
            labelLines: label.getBoundingClientRect().height / parseFloat(getComputedStyle(label).lineHeight),
            top: select.getBoundingClientRect().top,
            left: select.parentElement.getBoundingClientRect().left,
          };
        }
        out.toolsLeft = document.getElementById("projects-search-wrap").getBoundingClientRect().left;
        return out;
      });
      const label = dir + "@" + width;
      for (const id of ["projects-sort", "projects-filter"]) {
        expect(facts[id].room, label + " " + id + " shows its whole value").toBeGreaterThanOrEqual(30);
        expect(facts[id].labelLines, label + " " + id + " label on one line").toBeLessThanOrEqual(1.05);
      }
      // The filter sits level with the sort control, or (when the toolbar
      // wraps on a narrow page) starts its own row: never a control pushed
      // down by its own label.
      const level = Math.abs(facts["projects-sort"].top - facts["projects-filter"].top) <= 1;
      const ownRow = Math.abs(facts["projects-filter"].left - facts.toolsLeft) <= 1;
      expect(level || ownRow, label + " filter level with the others or on its own row").toBe(true);
    }
  }
});

// The kill switch flipped while a page is open: the switches are read again
// when the page is looked at again (focus, or the tab shown), so the bar
// hides Save and says saving is paused before anyone presses it, and My
// projects shows the notice without a reload.
test("saving switched off mid-session: the open designer and My projects say so on the next look, before a press", async ({
  page,
}) => {
  await signedIn(page);
  await openStudio(page, "/designer.html?b=smith-bath");
  const bar = page.locator("#project-bar");
  await expect(bar).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#project-save")).toBeVisible();
  const fresh = [];
  await page.route("**/api/config*", (route) => {
    fresh.push(route.request().url());
    return route.fulfill({
      json: {
        accounts: true,
        payments: false,
        supabaseUrl: SUPABASE,
        supabaseAnonKey: "anon",
        plans: {},
        switches: { signups: true, checkout: true, saving: false },
        notice: "Back Monday 9am.",
      },
    });
  });
  // Nothing happens until the page is looked at again.
  await page.waitForTimeout(500);
  expect(fresh.length).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(bar).toContainText("Saving projects is paused right now.");
  await expect(bar).toContainText("Notice: Back Monday 9am.");
  await expect(page.locator("#project-save")).toBeHidden();
  // Past the server's cache: the switches as they are now.
  expect(fresh.some((u) => /fresh=1/.test(u))).toBe(true);
  // The estimate step's Save goes too.
  await answerAll(page);
  await step(page, "estimate").click();
  await expect(page.getByTestId("estimate-card")).toBeVisible();
  await expect(page.locator('[data-key="save"]')).toHaveCount(0);
  // Looking again straight away doesn't ask again (throttled).
  const asked = fresh.length;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(300);
  expect(fresh.length).toBe(asked);

  // My projects, open with saving on, learns the same way.
  await page.route("**/api/config*", (route) =>
    route.fulfill({
      json: { accounts: true, payments: false, supabaseUrl: SUPABASE, supabaseAnonKey: "anon", plans: {} },
    }),
  );
  await page.goto("/pt/projects.html");
  await expect(page.locator("#projects-app")).toBeVisible();
  await expect(page.locator("#projects-paused")).toBeHidden();
  await page.route("**/api/config*", (route) =>
    route.fulfill({
      json: {
        accounts: true,
        payments: false,
        supabaseUrl: SUPABASE,
        supabaseAnonKey: "anon",
        plans: {},
        switches: { signups: true, checkout: true, saving: false },
      },
    }),
  );
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator("#projects-paused")).toBeVisible();
  await expect(page.locator("#projects-paused")).toContainText("Salvar projetos está pausado no momento.");
});
