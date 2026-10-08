"use strict";

const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

const PAGES = [
  "index.html",
  "designer.html",
  "signup.html",
  "account.html",
  "projects.html",
  "project.html",
  "privacy.html",
  "terms.html",
];

for (const dir of ["", "es/", "pt/"]) {
  for (const file of PAGES) {
    test(`/${dir}${file} loads without errors and passes axe, light and dark`, async ({ page }) => {
      // Reduced motion skips the scroll-reveal fade, which axe would catch mid-way.
      await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`/${dir}${file}?lang=${dir ? dir.slice(0, 2) : "en"}`);
      await expect(page.locator("main")).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(errors).toEqual([]);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(results.violations.map((v) => v.id)).toEqual([]);
      await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
      const dark = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
      expect(dark.violations.map((v) => v.nodes.map((n) => n.target.join(" "))).flat()).toEqual([]);
    });
  }
}

test("the landing page shows the plan prices from site-config.json in each language's format", async ({ page }) => {
  await page.goto("/index.html?lang=en");
  const prices = page.locator(".plan-price");
  await expect(prices).toHaveCount(3);
  await expect(prices.nth(0)).toContainText("$49.99");
  await expect(prices.nth(1)).toContainText("$99.99");
  await expect(prices.nth(2)).toContainText("$199.99");
  await expect(page.locator(".plan-limits").first()).toContainText("10 new projects a month");
  await expect(page.locator(".plan-limits").nth(2)).toContainText("1,000");
  await expect(page.locator(".plan-addon")).toContainText("$9.99");
  await expect(page.locator('a[href="signup.html?plan=max"]')).toBeVisible();
  await page.goto("/pt/index.html?lang=pt");
  await expect(page.locator(".plan-price").first()).toContainText("US$ 49,99");
});

test("the demo designer speaks for the sample business", async ({ page }) => {
  await page.goto("/designer.html");
  await expect(page.locator(".studio-biz")).toHaveText("Sample Remodeling Co.");
  await expect(page.locator(".designer-intro")).toBeVisible();
});

test("an unknown business shows the unavailable notice, not the demo", async ({ page }) => {
  await page.goto("/designer.html?b=nobody-here");
  await expect(page.locator("#designer-unavailable")).toBeVisible();
  await expect(page.locator("#studio")).toBeHidden();
  await expect(page.locator(".designer-intro")).toBeHidden();
});

test("embedded, the designer has no product header or footer", async ({ page }) => {
  await page.goto("/designer.html?embed=1");
  await expect(page.locator(".site-header")).toBeHidden();
  await expect(page.locator(".site-footer")).toBeHidden();
  await expect(page.locator("#studio")).toBeVisible();
  await expect(page.locator(".studio-step-btn")).toHaveCount(6);
});

test("with no account keys set, sign-up and account say accounts aren't on yet", async ({ page }) => {
  await page.goto("/signup.html");
  await expect(page.locator("#accounts-off")).toBeVisible();
  await page.goto("/account.html");
  await expect(page.locator("#accounts-off")).toBeVisible();
});
