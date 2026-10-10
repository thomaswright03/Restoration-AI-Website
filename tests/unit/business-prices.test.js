"use strict";

// js/business.js in the browser: which of the owner's labor prices replace
// the sample rates, so the estimate can say "at your prices where set;
// sample rates for the rest" (js/studio.js) line by line.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadBusiness(search) {
  const Pricing = require("../../js/bathroom-pricing.js");
  const window = {
    BathroomPricing: { DEFAULT_PRICES: Object.assign({}, Pricing.DEFAULT_PRICES) },
    location: { search },
    localStorage: { length: 0, key: () => null, getItem: () => null },
  };
  window.window = window;
  // The profile loads as a <script> element appended to <head>.
  const scripts = [];
  const document = {
    readyState: "complete",
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: () => ({}),
    head: { appendChild: (el) => scripts.push(el) },
  };
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "js", "business.js"), "utf8");
  vm.runInNewContext(src, { window, document, setTimeout: () => 0, clearTimeout() {} });
  window.scripts = scripts;
  return window;
}

test("the prices the owner set are remembered by key; the rest stay at the sample rates", () => {
  const w = loadBusiness("?b=smith-bath");
  w.DesignerBusiness.load({
    slug: "smith-bath",
    name: "Smith Bath Co.",
    prices: { Toilet_Price: 250, Tile_Price_Per_SqFt: "6.5", Sink_Price: "", Vanity_Price: null, Bogus: 9 },
  });
  const biz = w.DesignerBusiness;
  assert.equal(biz.demo, false);
  assert.equal(biz.ownPrices, true);
  // Objects from the vm realm have another Object prototype: compare plain copies.
  assert.deepEqual(JSON.parse(JSON.stringify(biz.priceSet)), { Toilet_Price: true, Tile_Price_Per_SqFt: true });
  assert.equal(w.BathroomPricing.DEFAULT_PRICES.Toilet_Price, 250);
  assert.equal(w.BathroomPricing.DEFAULT_PRICES.Tile_Price_Per_SqFt, 6.5);
  assert.equal(w.BathroomPricing.DEFAULT_PRICES.Sink_Price, 200, "a blank price keeps the sample rate");
  assert.equal("Bogus" in w.BathroomPricing.DEFAULT_PRICES, false);
});

test("no prices set: the estimate is on sample rates throughout", () => {
  const w = loadBusiness("?b=smith-bath");
  w.DesignerBusiness.load({ slug: "smith-bath", name: "Smith Bath Co.", prices: {} });
  assert.equal(w.DesignerBusiness.ownPrices, false);
  assert.deepEqual(JSON.parse(JSON.stringify(w.DesignerBusiness.priceSet)), {});
  // Out-of-range numbers never replace a rate.
  const w2 = loadBusiness("?b=smith-bath");
  w2.DesignerBusiness.load({ slug: "smith-bath", name: "Smith", prices: { Toilet_Price: -1, Sink_Price: 1e9 } });
  assert.deepEqual(JSON.parse(JSON.stringify(w2.DesignerBusiness.priceSet)), {});
});

test("a business's profile is asked for once, as a script that doesn't hold the page, and the designer waits for it", async () => {
  const w = loadBusiness("?b=smith-bath");
  assert.equal(w.scripts.length, 1);
  assert.match(w.scripts[0].src, /^\/api\/business\?b=smith-bath$/);
  assert.equal(w.scripts[0].async, true);
  assert.equal(w.DesignerBusiness.unavailable, "loading");
  let ready = false;
  w.DesignerBusiness.ready.then(() => (ready = true));
  await Promise.resolve();
  assert.equal(ready, false);
  w.DesignerBusiness.load({ slug: "smith-bath", name: "Smith Bath Co.", prices: {} });
  await w.DesignerBusiness.ready;
  assert.equal(w.DesignerBusiness.unavailable, "");
  assert.equal(w.DesignerBusiness.name, "Smith Bath Co.");
});

test("the demo business is ready at once, and a failed lookup settles as unavailable with its reason", async () => {
  const demo = loadBusiness("");
  assert.equal(demo.scripts.length, 0);
  assert.equal((await demo.DesignerBusiness.ready).demo, true);
  const w = loadBusiness("?b=smith-bath");
  w.DesignerBusiness.load(null, "timeout");
  await w.DesignerBusiness.ready;
  assert.equal(w.DesignerBusiness.unavailable, "timeout");
});
