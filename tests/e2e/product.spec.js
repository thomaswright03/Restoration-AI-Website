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
  await expect(page.locator("#pricing")).not.toContainText(/website|\$9\.99/i);
  await expect(page.locator('a[href="signup.html?plan=max"]')).toBeVisible();
  await page.goto("/pt/index.html?lang=pt");
  await expect(page.locator(".plan-price").first()).toContainText("US$ 49,99");
});

test("the landing page's hero shows the designer itself, described in the page's language", async ({ page }) => {
  for (const [dir, word] of [
    ["", "layout step"],
    ["es/", "distribución"],
    ["pt/", "layout"],
  ]) {
    await page.goto(`/${dir}index.html?lang=${dir ? dir.slice(0, 2) : "en"}`);
    const shot = page.locator(".hero .hero-shot img");
    await expect(shot).toBeVisible();
    await expect(shot).toHaveAttribute("alt", new RegExp(word, "i"));
    await expect(shot).toHaveAttribute("width", "1440");
    await expect(shot).toHaveAttribute("height", "743");
    // A real, loaded image (not a broken one), served as WebP.
    await expect
      .poll(() => shot.evaluate((img) => img.complete && img.naturalWidth > 0 && /\.webp$/.test(img.currentSrc)))
      .toBe(true);
    await expect(page.locator(".hero .hero-shot figcaption")).not.toBeEmpty();
  }
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

test("embedded, the designer is a read-only viewer with no product header or footer", async ({ page }) => {
  await page.goto("/designer.html?embed=1");
  await expect(page.locator(".site-header")).toBeHidden();
  await expect(page.locator(".site-footer")).toBeHidden();
  await expect(page.locator("#studio")).toBeVisible();
  await expect(page.locator(".studio-status")).toBeVisible();
  // The room and its views; nothing to edit, and no button of its own (the
  // project page that frames it has "Open in the designer").
  await expect(page.locator(".studio-view-btn[data-view]")).toHaveCount(3);
  await expect(page.locator(".studio-step-btn")).toHaveCount(0);
  await expect(page.locator(".studio-action")).toHaveCount(0);
  await expect(page.locator("#studio-panel")).toBeHidden();
  await expect(page.locator("#studio-riley")).toBeHidden();
  await expect(page.getByRole("link", { name: /Open in/ })).toHaveCount(0);
});

test("with no account keys set, sign-up and account say accounts aren't on yet", async ({ page }) => {
  await page.goto("/signup.html");
  await expect(page.locator("#accounts-off")).toBeVisible();
  await page.goto("/account.html");
  await expect(page.locator("#accounts-off")).toBeVisible();
});

test("when the server can't be reached, the account pages say so in the page's language", async ({ page }) => {
  await page.route("**/api/config", (route) => route.abort("internetdisconnected"));
  for (const [path, text] of [
    ["/signup.html", "We couldn't reach the server."],
    ["/es/projects.html", "No pudimos conectar con el servidor."],
    ["/pt/account.html", "Não conseguimos falar com o servidor."],
  ]) {
    await page.goto(path);
    await expect(page.locator("#server-down")).toContainText(text);
    await expect(page.locator("#accounts-off")).toBeHidden();
  }
});
