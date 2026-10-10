"use strict";

// js/business.js: a business's designer opens only for its own signed-in
// owner, so the visitor's sign-in is sent with the one request for it.

const { test, expect } = require("@playwright/test");
const { answerAll, step, expectNoPlaceholders } = require("./helpers");

async function signedIn(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "sb-test-auth-token",
      JSON.stringify({ access_token: "tok-123", expires_at: Math.floor(Date.now() / 1000) + 3600 }),
    );
  });
}

// The owner's sign-in gets their designer (a preview while the plan isn't
// active); anyone else is told it's owner-only.
function ownerOnly(page, asked, profile) {
  return page.route("**/api/business?**", (route) => {
    const url = route.request().url();
    asked.push(url);
    const body = url.includes("t=tok-123")
      ? "window.DesignerBusiness.load(" + JSON.stringify(profile) + ");"
      : 'window.DesignerBusiness.load(null, "owner-only");';
    return route.fulfill({ contentType: "application/javascript", body });
  });
}

test("the owner's designer is asked for once, with their sign-in, and has no request form", async ({ page }) => {
  await signedIn(page);
  const asked = [];
  await ownerOnly(page, asked, { slug: "smith-bath", name: "Smith Bath Co.", prices: {} });
  await page.goto("/designer.html?b=smith-bath");
  await expect(page.locator(".studio-step-btn")).toHaveCount(6);
  expect(asked).toHaveLength(1);
  expect(asked[0]).toContain("t=tok-123");
  await expect(page.locator("[data-biz-preview]")).toBeHidden();
  // The footer speaks to the owner, not to a homeowner waiting on "the business".
  await expect(page.locator(".studio-disclosure:visible")).toContainText("your written quote sets the real price");
  await expect(page.locator(".studio-disclosure:visible")).not.toContainText("until the business sends");
  await answerAll(page);
  await step(page, "estimate").click();
  await expect(page.getByTestId("estimate-card")).toBeVisible();
  await expect(page.locator(".studio-demo-end")).toHaveCount(0);
  // No prices set yet: the whole estimate is at sample rates, and says so.
  await expect(page.locator(".studio-step.is-estimate .studio-step-intro")).toContainText("at default sample prices");
  await expectNoPlaceholders(page);
  const rates = await page.evaluate(() => window.StudioDesign.summary().rates);
  expect(rates.mode).toBe("sample");
  expect(rates.sampleLines.length).toBeGreaterThan(3);
});

test("Riley's partial-prices line is a whole sentence in Spanish and Portuguese too", async ({ page }) => {
  await signedIn(page);
  await ownerOnly(page, [], { slug: "smith-bath", name: "Smith Bath Co.", prices: { Toilet_Price: 250 } });
  for (const [dir, rest] of [
    ["es", /el resto \(Demolición, .*Bañeras.*\) sigue con tarifas de ejemplo/],
    ["pt", /o resto \(Demolição, .*Banheiras.*\) ainda está com valores de exemplo/],
  ]) {
    await page.goto(`/${dir}/designer.html?b=smith-bath`);
    await expect(page.locator(".studio-step-btn")).toHaveCount(6);
    await answerAll(page);
    await step(page, "estimate").click();
    await expect(page.locator(".studio-riley .riley-text")).toHaveText(rest);
    await expectNoPlaceholders(page);
  }
});

test("an owner whose plan isn't active gets the preview banner", async ({ page }) => {
  await signedIn(page);
  await ownerOnly(page, [], { slug: "smith-bath", name: "Smith Bath Co.", prices: {}, preview: true });
  await page.goto("/designer.html?b=smith-bath");
  await expect(page.locator(".studio-step-btn")).toHaveCount(6);
  await expect(page.locator("[data-biz-preview]")).toBeVisible();
});

test("while the database hangs, the owner's designer paints its loading state at once, then says it couldn't open with Try again", async ({
  page,
}) => {
  test.slow();
  await signedIn(page);
  let calls = 0;
  await page.route("**/api/business?**", async (route) => {
    calls++;
    if (calls > 1) {
      return route.fulfill({
        contentType: "application/javascript",
        body: 'window.DesignerBusiness.load({"slug":"smith-bath","name":"Smith Bath Co.","prices":{}});',
      });
    }
    // The server waits on the database for its full 8 s, then gives up.
    await new Promise((r) => setTimeout(r, 11000));
    return route.fulfill({
      contentType: "application/javascript",
      body: 'window.DesignerBusiness.load(null, "error");',
    });
  });
  const t0 = Date.now();
  await page.goto("/designer.html?b=smith-bath", { waitUntil: "commit" });
  await expect(page.locator("#studio-loading")).toBeVisible();
  expect(Date.now() - t0).toBeLessThan(2000);
  // Nothing of the sample business shows while the owner's loads: no
  // "Sample Remodeling Co." in the header for the whole wait.
  await expect(page.locator(".studio-biz")).toBeHidden();
  await expect(page.locator(".studio-biz")).toHaveText("");
  await expect(page.locator("#designer-failed")).toBeHidden();
  await expect(page.locator("#designer-unavailable")).toBeHidden();
  // The time limit: a clear message, not "only for its owner", with Try again.
  await expect(page.locator("#designer-failed")).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#designer-failed")).toContainText("couldn't open this designer");
  await expect(page.locator("#designer-unavailable")).toBeHidden();
  await expect(page.locator("#studio")).toBeHidden();
  await page.locator("#designer-failed-retry").click();
  await expect(page.locator(".studio-step-btn")).toHaveCount(6);
  await expect(page.locator(".studio-biz")).toHaveText("Smith Bath Co.");
  expect(calls).toBe(2);
});

test("a failed business lookup says so with Try again, not that the designer is someone else's", async ({ page }) => {
  await signedIn(page);
  await page.route("**/api/business?**", (route) => route.fulfill({ status: 500, body: "server" }));
  await page.goto("/designer.html?b=smith-bath");
  await expect(page.locator("#designer-failed")).toBeVisible();
  await expect(page.locator("#designer-failed-retry")).toBeVisible();
  await expect(page.locator("#designer-unavailable")).toBeHidden();
  await expect(page.locator(".studio-step-btn")).toHaveCount(0);
});

test("an owner with only some prices set is told which lines are still at sample rates, on screen and in the PDF's notes", async ({
  page,
}) => {
  await signedIn(page);
  await ownerOnly(page, [], {
    slug: "smith-bath",
    name: "Smith Bath Co.",
    prices: { Toilet_Price: 250, Vanity_Price: 180, Plumbing_Price_Per_Point: 320 },
  });
  await page.goto("/designer.html?b=smith-bath");
  await expect(page.locator(".studio-step-btn")).toHaveCount(6);
  await answerAll(page);
  await step(page, "estimate").click();
  const estimate = page.locator(".studio-step.is-estimate");
  await expect(estimate.locator(".studio-step-intro")).toContainText("at your prices where you've set them");
  await expect(estimate.locator(".studio-step-intro")).toContainText("sample rates price the rest (");
  await expect(estimate.locator(".studio-step-intro")).toContainText("Bathtubs");
  await expect(estimate.locator(".studio-step-intro")).not.toContainText("Toilets");
  await expect(estimate.locator(".studio-step-intro")).not.toContainText("at default sample prices");
  // Riley names the same lines, in a whole sentence.
  const riley = page.locator(".studio-riley .riley-text");
  await expect(riley).toContainText("at your prices where you've set them; the rest (");
  await expect(riley).toHaveText(/the rest \(Demolition, .*Bathtubs.*\) is still at sample rates/);
  await expect(riley).not.toContainText("Toilets");
  await expectNoPlaceholders(page);
  // The saved project's summary records which lines were at sample rates.
  const rates = await page.evaluate(() => window.StudioDesign.summary().rates);
  expect(rates.mode).toBe("partial");
  expect(rates.sampleLines).toContain("Bathtubs");
  expect(rates.sampleLines).toContain("Demolition");
  expect(rates.sampleLines).not.toContain("Toilets");
  // The assumptions (the PDF's notes) list the same lines.
  await page.locator(".studio-details summary").click();
  const assumptions = page.locator(".studio-details li");
  await expect(assumptions.filter({ hasText: "sample rates price the rest" })).toHaveCount(1);
  await expect(assumptions.filter({ hasText: "sample rates price the rest" })).toContainText("Bathtubs");
  await expect(assumptions.filter({ hasText: "hasn't set its own labor prices" })).toHaveCount(0);
});

test("signed out, a business's designer shows the unavailable notice after one request", async ({ page }) => {
  const asked = [];
  await ownerOnly(page, asked, {});
  await page.goto("/designer.html?b=smith-bath");
  await expect(page.locator("#designer-unavailable")).toBeVisible();
  await expect(page.locator("#designer-unavailable")).toContainText("only for its owner");
  await expect(page.locator(".studio-step-btn")).toHaveCount(0);
  expect(asked).toHaveLength(1);
  expect(asked[0]).not.toContain("t=");
});

test("a designer link with capitals finds the business; one that can't be a slug says it's unavailable", async ({
  page,
}) => {
  const asked = [];
  await page.route("**/api/business?**", (route) => {
    asked.push(route.request().url());
    return route.fulfill({
      contentType: "application/javascript",
      body: 'window.DesignerBusiness.load({"slug":"smith-bath","name":"Smith Bath Co.","prices":{}});',
    });
  });
  await page.goto("/designer.html?b=Smith-Bath");
  await expect(page.locator(".studio-step-btn")).toHaveCount(6);
  expect(asked[0]).toContain("b=smith-bath");

  await page.goto("/designer.html?b=smith.bath");
  await expect(page.locator("#designer-unavailable")).toBeVisible();
  expect(asked).toHaveLength(1);
});
