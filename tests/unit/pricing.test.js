"use strict";

// The estimate math, on the path the studio runs: computeEstimate() with
// includeTrade (every trade priced: plumbing points, electrical points,
// drain line, surcharges when flagged) at the business's prices.

const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../../js/bathroom-pricing.js");

const NOTHING = { demolition: false, floorFinish: "none", walls: "none", paintCeiling: false };
const ROOM_5x8x8 = { Bathroom_Width_Ft: 5, Bathroom_Length_Ft: 8, Bathroom_Height_Ft: 8 };
const TRADE_KEYS = ["plumbing", "noStack", "badValve", "electrical", "drainRun"];

function line(result, key) {
  return result.lines.find((l) => l.key === key);
}

// The studio's call: every trade included, at the given prices (defaults
// unless a business set its own).
function studioEstimate(values, scope, prices) {
  return P.computeEstimate(values, scope, { includeTrade: true, prices: prices || P.DEFAULT_PRICES });
}

test("owner-stated default prices: $60 per cabinet, $5 per sq ft of flooring", () => {
  assert.equal(P.DEFAULT_PRICES.Cabinet_Price, 60);
  assert.equal(P.DEFAULT_PRICES.Floor_Price_Per_SqFt, 5);
});

test("bathtub price is 70% of the shower price unless the business sets its own", () => {
  assert.equal(P.bathtubPrice(P.DEFAULT_PRICES), 350);
  assert.equal(P.bathtubPrice({ Shower_Price: 1000 }), 700);
  const r = studioEstimate({ Bathtub_Quantity: 2 }, NOTHING);
  assert.equal(line(r, "Bathtub_Quantity").cost, 700);
  // Each tub also needs a plumbing point.
  assert.equal(line(r, "plumbing").qty, 2);
  assert.equal(line(r, "plumbing").cost, 600);
  assert.equal(r.total, 1300);
});

test("area formulas: floor = W x L, walls = 2 x H x (W + L)", () => {
  assert.deepEqual(P.areas(ROOM_5x8x8), {
    floorSqFt: 40,
    grossWallSqFt: 208,
    openingsSqFt: 0,
    wallSqFt: 208,
    wetWallSqFt: 0,
  });
  const a = P.areas({ Bathroom_Width_Ft: "4", Bathroom_Length_Ft: "8", Bathroom_Height_Ft: "" });
  assert.equal(a.floorSqFt, 32);
  assert.equal(a.wallSqFt, 0);
  // The estimate reports the same areas it priced.
  const r = studioEstimate(ROOM_5x8x8, { demolition: true, floorFinish: "none", walls: "paint", paintCeiling: false });
  assert.equal(r.floorSqFt, 40);
  assert.equal(r.wallSqFt, 208);
});

test("doorways come off the wall area; tile around the tub is priced on its own area", () => {
  const values = Object.assign({ Wall_Openings_SqFt: 20, Wet_Wall_SqFt: 60 }, ROOM_5x8x8);
  const a = P.areas(values);
  assert.equal(a.grossWallSqFt, 208);
  assert.equal(a.wallSqFt, 188);
  assert.equal(a.wetWallSqFt, 60);

  const painted = studioEstimate(values, Object.assign({}, NOTHING, { walls: "paint" }));
  assert.equal(line(painted, "wallPaint").qty, 188);
  assert.match(P.estimateAssumptions(values, { walls: "paint" }, painted).join(" "), /less 20 sq ft of doorways/);

  const wet = studioEstimate(values, Object.assign({}, NOTHING, { walls: "tileWet" }));
  assert.equal(line(wet, "wallTile").qty, 60);
  assert.equal(line(wet, "wallTile").cost, 240);
  assert.equal(line(wet, "wallPaint").qty, 128);
  assert.equal(line(wet, "wallPaint").cost, 229.12);
  assert.equal(wet.wetWallSqFt, 60);
  assert.match(P.estimateAssumptions(values, { walls: "tileWet" }, wet).join(" "), /Tile around the tub: 60 sq ft/);

  // Never more tile than wall, nor negative areas.
  const odd = P.areas(Object.assign({}, ROOM_5x8x8, { Wall_Openings_SqFt: -5, Wet_Wall_SqFt: 900 }));
  assert.equal(odd.wallSqFt, 208);
  assert.equal(odd.wetWallSqFt, 208);
});

test("nothing is priced from dimensions alone", () => {
  const r = studioEstimate(ROOM_5x8x8, NOTHING);
  assert.equal(r.lines.length, 0);
  assert.equal(r.total, 0);
});

test("5 x 8 x 8 room, 3 cabinets, other flooring, everything else no = $380.00", () => {
  const values = Object.assign({ Cabinet_Quantity: 3 }, ROOM_5x8x8);
  const scope = Object.assign({}, NOTHING, { floorFinish: "flooring" });
  const r = studioEstimate(values, scope);
  assert.equal(r.total, 380);
  assert.equal(line(r, "flooring").cost, 200);
  assert.equal(line(r, "Cabinet_Quantity").cost, 180);
  assert.equal(line(r, "floorTile"), undefined);
  // Cabinets need no plumbing, so no plumbing line appears.
  assert.equal(line(r, "plumbing"), undefined);
});

test("switching the floor to tile replaces flooring with $160.00 of floor tile", () => {
  const values = Object.assign({ Cabinet_Quantity: 3 }, ROOM_5x8x8);
  const scope = Object.assign({}, NOTHING, { floorFinish: "tile" });
  const r = studioEstimate(values, scope);
  assert.equal(line(r, "flooring"), undefined);
  assert.equal(line(r, "floorTile").cost, 160);
  assert.equal(r.total, 340);
});

test("the floor is never charged twice and walls are never both tiled and painted", () => {
  const scopes = [];
  for (const floorFinish of ["tile", "flooring", "none"]) {
    for (const walls of ["tile", "paint", "none"]) {
      scopes.push({ demolition: true, floorFinish, walls, paintCeiling: true });
    }
  }
  for (const scope of scopes) {
    const r = studioEstimate(ROOM_5x8x8, scope);
    const keys = r.lines.map((l) => l.key);
    assert.ok(!(keys.includes("floorTile") && keys.includes("flooring")), JSON.stringify(scope));
    assert.ok(!(keys.includes("wallTile") && keys.includes("wallPaint")), JSON.stringify(scope));
  }
});

test("across a table of inputs, the trade lines are exactly the plumbing points, surcharges, wiring and drain line", () => {
  const table = [
    [{}, NOTHING],
    [ROOM_5x8x8, { demolition: true, floorFinish: "tile", walls: "tile", paintCeiling: true }],
    [ROOM_5x8x8, { demolition: false, floorFinish: "flooring", walls: "paint", paintCeiling: false }],
    [
      { Bathroom_Width_Ft: 4, Bathroom_Length_Ft: 8, Bathroom_Height_Ft: 9, Vanity_Quantity: 1, Mirror_Quantity: 2 },
      NOTHING,
    ],
    [
      {
        Bathroom_Width_Ft: 6.5,
        Bathroom_Length_Ft: 10,
        Bathroom_Height_Ft: 8,
        Toilet_Quantity: 1,
        Sink_Quantity: 2,
        Shower_Quantity: 1,
      },
      { demolition: true, floorFinish: "flooring", walls: "none", paintCeiling: true },
    ],
    [
      {
        Bathroom_Width_Ft: 12,
        Bathroom_Length_Ft: 14,
        Bathroom_Height_Ft: 10,
        Bathtub_Quantity: 1,
        Shower_Door_Quantity: 1,
        Door_Quantity: 1,
        Cabinet_Quantity: 6,
        Mirror_Huge_Quantity: 1,
        Shower_Shelf_Quantity: 2,
      },
      { demolition: true, floorFinish: "tile", walls: "paint", paintCeiling: true },
    ],
  ];
  for (const [values, scope] of table) {
    const withTrade = Object.assign({}, values, {
      Electrical_Points: 3,
      Drain_Run_Ft: 2,
      No_Stack_Surcharge_Included: true,
      Bad_Valve_Surcharge_Included: true,
    });
    const r = studioEstimate(withTrade, scope);
    const fixtures = P.plumbingFixtureCount(values);
    // One plumbing point per toilet, sink, tub, shower and vanity; none
    // when there are no such fixtures.
    if (fixtures) assert.equal(line(r, "plumbing").qty, fixtures, JSON.stringify(values));
    else assert.equal(line(r, "plumbing"), undefined, JSON.stringify(values));
    assert.equal(line(r, "electrical").cost, 300);
    assert.equal(line(r, "drainRun").cost, 190);
    assert.equal(line(r, "noStack").cost, 1000);
    assert.equal(line(r, "badValve").cost, 400);
    // The subtotal is exactly the sum of the lines, and the trade lines are
    // the only lines a design's fixtures and finishes don't produce.
    const sum = P.roundCents(r.lines.reduce((s, l) => s + l.cost, 0));
    assert.equal(r.subtotal, sum);
    const plain = studioEstimate(values, scope);
    assert.deepEqual(
      r.lines.filter((l) => !TRADE_KEYS.includes(l.key)),
      plain.lines.filter((l) => !TRADE_KEYS.includes(l.key)),
      "same lines, same order: " + JSON.stringify(values),
    );
    assert.ok(plain.lines.every((l) => !["noStack", "badValve", "electrical", "drainRun"].includes(l.key)));
  }
});

test("plumbing is one point per toilet, sink, shower and bathtub, plus surcharges only when flagged", () => {
  const values = {
    Toilet_Quantity: 1,
    Sink_Quantity: 2,
    Shower_Quantity: 1,
    Bathtub_Quantity: 1,
    Electrical_Points: 4,
    No_Stack_Surcharge_Included: true,
    Bad_Valve_Surcharge_Included: false,
  };
  const r = studioEstimate(values, NOTHING);
  assert.equal(line(r, "plumbing").qty, 5);
  assert.equal(line(r, "plumbing").cost, 1500);
  assert.equal(line(r, "plumbing").detail, "5 points × $300.00");
  assert.equal(line(r, "noStack").cost, 1000);
  assert.equal(line(r, "badValve"), undefined);
  assert.equal(line(r, "electrical").cost, 400);
  assert.equal(r.plumbingFixtureCount, 5);
  assert.equal(r.plumbingIncluded, true);
});

test("a drain line to the plumbing wall is priced by the foot, capped at a sane length", () => {
  const r = studioEstimate({ Drain_Run_Ft: 6.5 }, NOTHING);
  assert.equal(line(r, "drainRun").qty, 6.5);
  assert.equal(line(r, "drainRun").cost, 617.5);
  // No run, no line.
  assert.equal(line(studioEstimate({ Drain_Run_Ft: 0 }, NOTHING), "drainRun"), undefined);
  assert.equal(line(studioEstimate({ Drain_Run_Ft: 5000 }, NOTHING), "drainRun").qty, 200);
});

test("tax is added only at the rate the business set; the default is 0", () => {
  const prices = Object.assign({}, P.DEFAULT_PRICES, { Labor_Tax_Rate_Percent: 10 });
  const taxed = studioEstimate({ Cabinet_Quantity: 1 }, NOTHING, prices);
  assert.equal(taxed.taxAmount, 6);
  assert.equal(taxed.total, 66);
  const untaxed = studioEstimate({ Cabinet_Quantity: 1 }, NOTHING);
  assert.equal(untaxed.taxAmount, 0);
  assert.equal(untaxed.total, untaxed.subtotal);
});

test("painting uses $1.79 per sq ft of wall or ceiling", () => {
  const r = studioEstimate(ROOM_5x8x8, {
    demolition: false,
    floorFinish: "none",
    walls: "paint",
    paintCeiling: true,
  });
  assert.equal(line(r, "wallPaint").cost, P.roundCents(208 * 1.79));
  assert.equal(line(r, "ceilingPaint").cost, P.roundCents(40 * 1.79));
  assert.equal(line(r, "wallPaint").detail, "208 sq ft × $1.79");
});

test("bad numbers count as nothing, never as NaN in a price", () => {
  const r = studioEstimate({ Toilet_Quantity: "abc", Electrical_Points: "", Drain_Run_Ft: null }, NOTHING);
  assert.equal(r.lines.length, 0);
  assert.equal(r.total, 0);
  assert.equal(P.parseNumber("2.5"), 2.5);
  assert.equal(P.parseNumber(""), null);
  assert.ok(Number.isNaN(P.parseNumber("1e200")));
});

test("money formatting", () => {
  assert.equal(P.money(3315.92), "$3,315.92");
  assert.equal(P.shortMoney(60), "$60");
  assert.equal(P.shortMoney(37.5), "$37.50");
});

test("a vanity's sink counts as a plumbing point", () => {
  const r = studioEstimate({ Toilet_Quantity: 1, Vanity_Quantity: 1, Bathtub_Quantity: 1 }, NOTHING);
  assert.equal(r.plumbingFixtureCount, 3);
  assert.equal(line(r, "plumbing").qty, 3);
});

test("a business's own bathtub price replaces the 70%-of-shower rule; empty keeps the rule", () => {
  assert.equal(P.bathtubPrice({ Shower_Price: 1000, Bathtub_Price: 450 }), 450);
  assert.equal(P.bathtubPrice({ Shower_Price: 1000, Bathtub_Price: 0 }), 0);
  assert.equal(P.bathtubPrice({ Shower_Price: 1000, Bathtub_Price: null }), 700);
  assert.equal(P.bathtubPrice({ Shower_Price: 1000, Bathtub_Price: "" }), 700);
  assert.equal(P.bathtubPrice({ Shower_Price: 1000, Bathtub_Price: "abc" }), 700);
  const own = studioEstimate({ Bathtub_Quantity: 1 }, NOTHING, { Bathtub_Price: 450 });
  assert.equal(line(own, "Bathtub_Quantity").cost, 450);
  // The account page lists Bathtub_Price with the other prices (js/business.js applies the same keys).
  assert.ok(Object.prototype.hasOwnProperty.call(P.DEFAULT_PRICES, "Bathtub_Price"));
  assert.equal(P.DEFAULT_PRICES.Bathtub_Price, null);
});

test("the designer's estimate prices every line at the business's own rates", () => {
  // Every price the account page offers set to $1: nothing is left at a platform rate.
  const ones = {};
  for (const key of Object.keys(P.DEFAULT_PRICES)) ones[key] = 1;
  ones.Labor_Tax_Rate_Percent = 0;
  const values = Object.assign({}, ROOM_5x8x8, {
    Toilet_Quantity: 1,
    Bathtub_Quantity: 1,
    Vanity_Quantity: 1,
    Electrical_Points: 6,
    Drain_Run_Ft: 4,
  });
  const scope = { demolition: true, floorFinish: "tile", walls: "paint", paintCeiling: true };
  const r = studioEstimate(values, scope, ones);
  for (const l of r.lines) assert.equal(l.rate, 1, l.key + " is charged at the business's rate");
  assert.equal(line(r, "plumbing").qty, 3, "one plumbing point per toilet, tub and vanity");
  assert.equal(line(r, "electrical").qty, 6);
  assert.equal(line(r, "drainRun").qty, 4);
  assert.equal(r.plumbingIncluded, true);
});

test("the estimate's words agree with its lines: plumbing and electrical are in, never 'excluded'", () => {
  const I18n = require("../../js/i18n.js");
  for (const lang of ["en", "es", "pt"]) {
    I18n.setLang(lang);
    try {
      const words = [
        I18n.t("card.plumbingNote"),
        I18n.t("card.disclaimer"),
        I18n.t("card.disclaimerMaterials"),
        I18n.t("card.excluded.tradesPriced"),
        I18n.t("card.alsoNotIncluded"),
        I18n.t("card.materialsNote"),
      ].join(" ");
      assert.doesNotMatch(
        words,
        /excludes plumbing|not included\. Toilets|No incluye trabajo de plomería|Não inclui serviço de encanamento/i,
        lang,
      );
      assert.doesNotMatch(words, /real current prices for the exact products/i, lang);
    } finally {
      I18n.setLang("en");
    }
  }
  // The card's note names the point rule the lines follow.
  assert.match(I18n.t("card.plumbingNote"), /one plumbing point for each toilet, sink, vanity, shower and bathtub/);
  assert.match(I18n.t("card.disclaimer"), /includes the labor for the plumbing and electrical points listed/);
  assert.match(I18n.t("card.disclaimerMaterials"), /includes the labor for the plumbing and electrical points listed/);
});

test("only code a page runs is exported", () => {
  const exported = Object.keys(P).sort();
  assert.deepEqual(exported, [
    "DEFAULT_PRICES",
    "areas",
    "bathtubPrice",
    "computeEstimate",
    "describeScope",
    "estimateAssumptions",
    "formatQty",
    "money",
    "parseNumber",
    "plumbingFixtureCount",
    "roundCents",
    "shortMoney",
  ]);
});
