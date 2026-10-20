"use strict";

// /admin, the owner's status page: refused without a sign-in, and drawn as
// the Important, Key and Basic groups (in that order) for an admin. Supabase
// and /admin/status.json are stood in for with page.route.

const { test, expect } = require("@playwright/test");

const SUPABASE = "https://fakeproject.supabase.co";
const NOW = "2026-10-20T12:00:00Z";

function fn(tier, name, status, detail = "") {
  return {
    tier,
    name,
    status,
    last_checked: NOW,
    last_success: status === "ok" ? NOW : null,
    next_expected_run: null,
    detail,
  };
}

const STATUS = {
  product: "Room Designer 3D",
  checked_at: NOW,
  overall: "down",
  functions: [
    fn("important", "Saving and loading a client project", "ok"),
    fn("important", "Stripe checkout", "down", "Stripe is not set up. Check the Stripe keys and prices in Vercel"),
    fn("key", "Stripe API", "ok"),
    fn("key", "Daily backup and restore check", "warning", "The last good run was 40 h ago"),
    fn("basic", "Database query", "ok"),
    fn("basic", "Deployed version", "unknown", "Not running on Vercel"),
  ],
};

test("without a sign-in /admin refuses and /admin/status.json is not served", async ({ page, request }) => {
  await page.goto("/admin");
  await expect(page.locator("#admin-message")).toContainText("Sign in first");
  await expect(page.locator("#admin-groups section")).toHaveCount(0);
  const res = await request.get("/admin/status.json");
  expect([401, 404]).toContain(res.status());
});

test("an admin sees the overall status and the three groups in order", async ({ page }) => {
  await page.route("**/api/config*", (route) =>
    route.fulfill({
      json: { accounts: true, payments: false, supabaseUrl: SUPABASE, supabaseAnonKey: "anon", plans: {} },
    }),
  );
  await page.route(SUPABASE + "/**", (route) => route.fulfill({ json: {} }));
  await page.route("**/admin/status.json", (route) => {
    expect(route.request().headers().authorization).toBe("Bearer token");
    return route.fulfill({ json: STATUS });
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      "sb-fakeproject-auth-token",
      JSON.stringify({
        access_token: "token",
        refresh_token: "refresh",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: "u1", email: "owner@example.com", aud: "authenticated", user_metadata: {} },
      }),
    );
  });
  await page.goto("/admin");
  await expect(page.locator("#admin-overall")).toHaveText("Down");
  await expect(page.locator("#admin-groups section")).toHaveCount(3);
  await expect(page.locator("#admin-groups section h2")).toHaveText(["Important", "Key", "Basic"]);
  const checkout = page.locator("tr", { hasText: "Stripe checkout" });
  await expect(checkout.locator(".st")).toHaveText("Down");
  await expect(checkout).toContainText("Check the Stripe keys");
  await expect(page.locator("tr", { hasText: "Daily backup" }).locator(".st")).toHaveText("Warning");
  await expect(page.locator("tr", { hasText: "Deployed version" }).locator(".st")).toHaveText("Unknown");
});
