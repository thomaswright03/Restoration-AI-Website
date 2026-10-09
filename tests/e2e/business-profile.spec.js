"use strict";

// js/business.js: a business's designer opens only for its own signed-in
// owner, so the visitor's sign-in is sent with the one request for it.

const { test, expect } = require("@playwright/test");
const { answerAll, step } = require("./helpers");

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
  await answerAll(page);
  await step(page, "estimate").click();
  await expect(page.getByTestId("estimate-card")).toBeVisible();
  await expect(page.locator(".studio-demo-end")).toHaveCount(0);
});

test("an owner whose plan isn't active gets the preview banner", async ({ page }) => {
  await signedIn(page);
  await ownerOnly(page, [], { slug: "smith-bath", name: "Smith Bath Co.", prices: {}, preview: true });
  await page.goto("/designer.html?b=smith-bath");
  await expect(page.locator(".studio-step-btn")).toHaveCount(6);
  await expect(page.locator("[data-biz-preview]")).toBeVisible();
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
