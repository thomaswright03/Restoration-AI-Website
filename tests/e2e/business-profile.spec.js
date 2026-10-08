"use strict";

// js/business.js: a signed-in visitor's sign-in only goes to
// /api/business when the business isn't live, so its owner can preview it.

const { test, expect } = require("@playwright/test");

async function signedIn(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "sb-test-auth-token",
      JSON.stringify({ access_token: "tok-123", expires_at: Math.floor(Date.now() / 1000) + 3600 }),
    );
  });
}

test("a live business's designer is asked for without the visitor's sign-in", async ({ page }) => {
  await signedIn(page);
  const asked = [];
  await page.route("**/api/business?**", (route) => {
    asked.push(route.request().url());
    return route.fulfill({
      contentType: "application/javascript",
      body: 'window.DesignerBusiness.load({"slug":"smith-bath","name":"Smith Bath Co.","prices":{}});',
    });
  });
  await page.goto("/designer.html?b=smith-bath");
  await expect(page.locator(".studio-step-btn")).toHaveCount(6);
  expect(asked).toHaveLength(1);
  expect(asked[0]).not.toContain("t=");
});

test("a business that isn't live is asked again with the sign-in, and its owner gets the preview", async ({ page }) => {
  await signedIn(page);
  const asked = [];
  await page.route("**/api/business?**", (route) => {
    const url = route.request().url();
    asked.push(url);
    const body = url.includes("t=tok-123")
      ? 'window.DesignerBusiness.load({"slug":"smith-bath","name":"Smith Bath Co.","prices":{},"preview":true});'
      : 'window.DesignerBusiness.load(null, "inactive");';
    return route.fulfill({ contentType: "application/javascript", body });
  });
  await page.goto("/designer.html?b=smith-bath");
  await expect(page.locator(".studio-step-btn")).toHaveCount(6);
  expect(asked).toHaveLength(2);
  expect(asked[1]).toContain("t=tok-123");
  expect(await page.evaluate(() => window.DesignerBusiness.preview)).toBe(true);
});

// A plan without "Put it on your website": its owner gets the designer for
// their own use, with the banner; anyone else the unavailable notice.
function noWebsite(page) {
  return page.route("**/api/business?**", (route) => {
    const body = route.request().url().includes("t=tok-123")
      ? 'window.DesignerBusiness.load({"slug":"smith-bath","name":"Smith Bath Co.","prices":{},"websiteLocked":true});'
      : 'window.DesignerBusiness.load(null, "no-website");';
    return route.fulfill({ contentType: "application/javascript", body });
  });
}

test("a plan without the website add-on: the owner gets their designer, with the locked banner", async ({ page }) => {
  await signedIn(page);
  await noWebsite(page);
  await page.goto("/designer.html?b=smith-bath");
  await expect(page.locator(".studio-step-btn")).toHaveCount(6);
  await expect(page.locator("[data-biz-website-locked]")).toBeVisible();
  await expect(page.locator("[data-biz-website-locked]")).toContainText("Put it on your website");
  await expect(page.locator("[data-biz-preview]")).toBeHidden();
});

test("a plan without the website add-on: visitors get the unavailable notice", async ({ page }) => {
  await noWebsite(page);
  await page.goto("/designer.html?b=smith-bath");
  await expect(page.locator("#designer-unavailable")).toBeVisible();
  await expect(page.locator(".studio-step-btn")).toHaveCount(0);
});

test("signed out, a business that isn't live shows the unavailable notice after one request", async ({ page }) => {
  const asked = [];
  await page.route("**/api/business?**", (route) => {
    asked.push(route.request().url());
    return route.fulfill({
      contentType: "application/javascript",
      body: 'window.DesignerBusiness.load(null, "inactive");',
    });
  });
  await page.goto("/designer.html?b=smith-bath");
  await expect(page.locator("#designer-unavailable")).toBeVisible();
  expect(asked).toHaveLength(1);
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
