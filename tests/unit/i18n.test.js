"use strict";

// Spanish and Portuguese: every piece of JavaScript text exists in all three
// languages, and the estimate and number formats work in each.

const test = require("node:test");
const assert = require("node:assert/strict");
const I18n = require("../../js/i18n.js");
const P = require("../../js/bathroom-pricing.js");
const M = require("../../js/materials-pricing.js");

function tokens(text) {
  return (text.match(/\{\w+\}|\[[a-z]+/g) || []).sort().join(" ");
}

// Each case runs with the page "in" that language, then puts English back.
function inLang(lang, fn) {
  I18n.setLang(lang);
  try {
    fn();
  } finally {
    I18n.setLang("en");
  }
}

test("every text has English, Spanish and Portuguese, with the same placeholders", () => {
  for (const [key, entry] of Object.entries(I18n.STRINGS)) {
    assert.equal(entry.length, 3, key);
    entry.forEach((text) => assert.ok(typeof text === "string" && text.trim(), `${key} has an empty translation`));
    assert.equal(tokens(entry[1]), tokens(entry[0]), `${key}: Spanish placeholders differ from English`);
    assert.equal(tokens(entry[2]), tokens(entry[0]), `${key}: Portuguese placeholders differ from English`);
  }
});

test("t() fills placeholders and falls back to English for an unknown language", () => {
  assert.equal(I18n.t("pdf.page", { i: 1, n: 2 }, "es"), "Página 1 de 2");
  assert.equal(I18n.t("pdf.page", { i: 1, n: 2 }, "fr"), "Page 1 of 2");
  assert.throws(() => I18n.t("no.such.key"));
});

test("prices stay in US dollars, written the way each language writes numbers", () => {
  assert.equal(P.money(1234.5, "en-US"), "$1,234.50");
  assert.equal(P.money(1234.5, "es-US"), "$1,234.50");
  assert.equal(P.money(1234.5, "pt-BR").replace(/\s/g, " "), "US$ 1.234,50");
  assert.equal(P.shortMoney(60, "pt-BR").replace(/\s/g, " "), "US$ 60");
  assert.equal(P.shortMoney(1.79, "pt-BR").replace(/\s/g, " "), "US$ 1,79");
  inLang("pt", () => {
    assert.equal(P.formatQty(7.5), "7,5");
    assert.equal(M.money(10).replace(/\s/g, " "), "US$ 10,00");
  });
});

// The estimate the studio computes: every trade priced at the given prices.
function studioEstimate(values, scope) {
  return P.computeEstimate(values, scope, { includeTrade: true, prices: P.DEFAULT_PRICES });
}

test("the estimate's work description, lines and assumptions follow the page's language", () => {
  const scope = { demolition: true, floorFinish: "tile", walls: "paint", paintCeiling: false };
  const values = { Bathroom_Width_Ft: 5, Bathroom_Length_Ft: 8, Bathroom_Height_Ft: 8, Toilet_Quantity: 1 };
  inLang("es", () => {
    const r = studioEstimate(values, scope);
    assert.equal(P.describeScope(scope), "Demolición: Sí; piso nuevo: Azulejo; paredes: Pintura; pintar el techo: No");
    assert.equal(r.lines.find((l) => l.key === "floorTile").label, "Azulejo de piso");
    assert.equal(r.lines.find((l) => l.key === "Toilet_Quantity").label, "Inodoros");
    assert.equal(r.lines.find((l) => l.key === "Toilet_Quantity").detail, "1 unidad × $200.00");
    assert.equal(r.lines.find((l) => l.key === "plumbing").detail, "1 punto × $300.00");
    assert.match(P.estimateAssumptions(values, scope, r)[1], /^Área del piso: 5 × 8 pies = 40 pies²/);
  });
  inLang("pt", () => {
    const r = studioEstimate(values, scope);
    assert.equal(r.lines.find((l) => l.key === "wallPaint").label, "Pintura (paredes)");
    assert.match(r.lines.find((l) => l.key === "wallPaint").detail, /^208 pés² × US\$\s1,79$/);
    assert.match(r.lines.find((l) => l.key === "plumbing").detail, /^1 ponto × US\$\s300,00$/);
    assert.match(P.describeScope({}), /Sem resposta/);
  });
  // Same prices in every language.
  const en = studioEstimate(values, scope).total;
  inLang("es", () => assert.equal(studioEstimate(values, scope).total, en));
  inLang("pt", () => assert.equal(studioEstimate(values, scope).total, en));
});
