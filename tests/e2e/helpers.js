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

// Opens the design studio (the sample full bath: 8 ft x 5 ft, the plumbing
// in wall A with the vanity and toilet on it, a tub on wall B, the door on
// wall C) and waits until it's drawn. Returns the page errors seen, for a
// final check.
async function openStudio(page, url = "/designer.html") {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await expect(page.locator(".studio-step-btn")).toHaveCount(6);
  await expect(page.locator(".studio-status")).toBeVisible();
  return errors;
}

// The 3D room is up and drawing (software WebGL in CI is slow to start).
async function wait3d(page) {
  await page.waitForFunction(() => window.BathroomRoom3D && window.BathroomRoom3D.available === true);
  await page.waitForFunction(() => window.BathroomRoom3D.itemScreenPoint("f1") !== null);
}

// Answers every step's questions the way a person clicking through would
// (the plumbing wall, a finish for every surface; the product lists start
// answered), so a test can go to any step. Loads it like a shared link.
async function answerAll(page) {
  await page.waitForFunction(
    () => window.RoomStudio && window.BathroomRoom3D && window.BathroomRoom3D.available === true,
  );
  await page.evaluate(() => {
    const d = JSON.parse(JSON.stringify(window.RoomStudio.design()));
    const products = {};
    for (const group of window.BathroomRoom3D.getProductGroups())
      for (const slot of group.slots) products[slot.id] = true;
    d.answered = { stack: true, products };
    for (const cat of ["floorTile", "flooring", "wallTile", "wallPaint", "ceilingPaint"]) {
      const first = window.MaterialsPricing.getOptionsForCategory(cat, "")[0];
      if (first && !d.finishes.picks[cat]) d.finishes.picks[cat] = first.id;
    }
    window.location.hash = "design=" + window.RoomPlan.encode(d);
  });
  await page.waitForFunction(() => window.RoomStudio.design().answered.stack === true);
}

// A new room asks again where the plumbing is: this answers with the wall
// it suggests.
async function confirmStack(page) {
  const wall = await page.evaluate(() => window.RoomPlan.stackWall(window.RoomStudio.design()));
  await page.locator(`[data-key="stack-${wall}"]`).click();
  await page.waitForFunction(() => window.RoomStudio.design().answered.stack === true);
}

// The page point a room point (feet: x across, y up, z back) is drawn at,
// for driving a drag with the mouse. BathroomRoom3D.project() measures from
// the canvas; the mouse measures from the page.
async function onScreen(page, x, y, z) {
  return page.evaluate(
    ([a, b, c]) => {
      const p = window.BathroomRoom3D.project(a, b, c);
      const rect = document.querySelector("#room-3d-canvas canvas").getBoundingClientRect();
      return { x: rect.left + p.x, y: rect.top + p.y };
    },
    [x, y, z],
  );
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
  answerAll,
  confirmStack,
  onScreen,
  step,
  byKey,
  studioStatus,
  studioToast,
};
