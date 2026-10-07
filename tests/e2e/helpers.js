"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { expect } = require("@playwright/test");

const ROOT = path.join(__dirname, "..", "..");
const BASE_CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "site-config.json"), "utf8"));

// Serve a modified site-config.json for this page only.
async function useConfig(page, overrides) {
  const config = JSON.parse(JSON.stringify(BASE_CONFIG));
  for (const [section, values] of Object.entries(overrides || {})) {
    config[section] = Object.assign({}, config[section], values);
  }
  await page.route("**/site-config.json", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(config) }),
  );
  return config;
}

// Opens the design studio (the sample full bath: 8 ft x 5 ft, a tub on wall
// B, a vanity on wall D, a toilet on wall A, the door on wall C) and waits
// until it's drawn. Returns the page errors seen, for a final check.
async function openStudio(page, url = "/designer.html") {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await expect(page.locator(".studio-step-btn")).toHaveCount(5);
  await expect(page.locator(".studio-status")).toBeVisible();
  return errors;
}

// The 3D room is up and drawing (software WebGL in CI is slow to start).
async function wait3d(page) {
  await page.waitForFunction(() => window.BathroomRoom3D && window.BathroomRoom3D.available === true);
  await page.waitForFunction(() => window.BathroomRoom3D.itemScreenPoint("f1") !== null);
}

const step = (page, name) => page.locator(`.studio-step-btn[data-step="${name}"]`);
const byKey = (page, key) => page.locator(`[data-key="${key}"]`);
const studioStatus = (page) => page.locator(".studio-status");
const studioToast = (page) => page.locator("#studio-toast");

module.exports = {
  ROOT,
  BASE_CONFIG,
  useConfig,
  openStudio,
  wait3d,
  step,
  byKey,
  studioStatus,
  studioToast,
};
