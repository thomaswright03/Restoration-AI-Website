"use strict";

// What every page shares: the offline notice, the theme menu in the header
// (not only the footer's switch) and the browser-chrome colour that follows
// the theme.

const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

test("going offline shows a page-level notice before anything fails; coming back says so and clears", async ({
  page,
  context,
}) => {
  await page.goto("/projects.html");
  const notice = page.locator(".offline-notice");
  await expect(notice).toBeHidden();
  await context.setOffline(true);
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("You're offline");
  await expect(notice).toHaveAttribute("role", "status");
  await context.setOffline(false);
  await expect(notice).toContainText("You're back online.");
  await expect(notice).toBeHidden({ timeout: 10000 });

  // In Portuguese too.
  await page.goto("/pt/projects.html");
  await context.setOffline(true);
  await expect(notice).toContainText("Você está off-line");
  await context.setOffline(false);
  await expect(notice).toContainText("A conexão voltou.");
});

test("the theme can be switched from the header on every page, by keyboard, and the browser chrome colour follows", async ({
  page,
}) => {
  test.setTimeout(90000);
  for (const path of ["/index.html", "/es/signup.html", "/pt/privacy.html"]) {
    await page.goto(path);
    const menu = page.locator(".site-header .theme-menu");
    await expect(menu).toBeVisible();
    const summary = menu.locator("summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(menu.locator("[data-theme-choice='dark']")).toBeVisible();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(menu.locator("[data-theme-choice='dark']")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    // Picking closes the menu and puts the focus back on its button.
    await expect(menu).not.toHaveAttribute("open", /.*/);
    await expect(summary).toBeFocused();
    // Both controls agree.
    await expect(menu.locator("[data-theme-choice='dark']")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".theme-switch [data-theme-choice='dark']")).toHaveAttribute("aria-pressed", "true");
    // The browser's own chrome takes the header's colour for this theme.
    const themeColor = page.locator('meta[name="theme-color"]');
    await expect(themeColor).toHaveAttribute("content", "#070b18");
    await summary.click();
    await menu.locator("[data-theme-choice='light']").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(themeColor).toHaveAttribute("content", "#0a1024");
    await summary.click();
    await menu.locator("[data-theme-choice='system']").click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
    // Escape closes an open menu.
    await summary.click();
    await expect(menu).toHaveAttribute("open", "");
    await page.keyboard.press("Escape");
    await expect(menu).not.toHaveAttribute("open", /.*/);
  }
});

test("the header with its menus open has no accessibility violations and fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/es/index.html");
  await page.locator(".nav-toggle").click();
  await page.locator(".site-header .theme-menu summary").click();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  // The theme menu's buttons are finger-sized.
  const box = await page.locator(".site-header .theme-menu [data-theme-choice='dark']").boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
});
