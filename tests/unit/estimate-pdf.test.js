"use strict";

// js/estimate-pdf.js: the page layout of the estimate PDF, run against a
// stand-in for jsPDF that only records which page each text lands on.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const I18n = require("../../js/i18n.js");

function fakeJsPdf() {
  const texts = []; // { text, page, y }
  let page = 1;
  let pages = 1;
  function Doc() {
    this.internal = { pageSize: { getWidth: () => 612, getHeight: () => 792 } };
  }
  Doc.prototype = {
    setFont() {},
    setFontSize() {},
    setTextColor() {},
    setDrawColor() {},
    setFillColor() {},
    setLineWidth() {},
    line() {},
    rect() {},
    addImage() {},
    textWithLink() {},
    getImageProperties: () => ({ width: 3, height: 2 }),
    getTextWidth: (t) => String(t).length * 5,
    // About 80 characters to a full-width line, like the real font at 11pt.
    splitTextToSize(text, width) {
      const per = Math.max(1, Math.floor(width / 6));
      const out = [];
      for (const para of String(text).split("\n")) {
        let s = para;
        do {
          out.push(s.slice(0, per));
          s = s.slice(per);
        } while (s.length);
      }
      return out;
    },
    text(t, x, y) {
      (Array.isArray(t) ? t : [t]).forEach((line) => texts.push({ text: String(line), page, y }));
    },
    addPage() {
      pages += 1;
      page = pages;
    },
    setPage(n) {
      page = n;
    },
    getNumberOfPages: () => pages,
  };
  return { jsPDF: Doc, texts };
}

function build(spec) {
  const fake = fakeJsPdf();
  const window = { I18n, jspdf: fake, document: {} };
  window.window = window;
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "js", "estimate-pdf.js"), "utf8");
  vm.runInNewContext(src, { window, document: { currentScript: null } });
  window.EstimatePdf.build(spec);
  return fake.texts;
}

function spec(lineCount) {
  const lines = [];
  for (let i = 1; i <= lineCount; i++)
    lines.push({ label: "Line " + i, detail: "1 unit × $100.00", amount: "$100.00" });
  return {
    heading: "Smith Bath Co.",
    title: "Bathroom design and estimate",
    lines,
    linesTitle: "Labor and materials estimate",
    excluded: [
      { label: "Other work", value: "Extra" },
      { label: "Permits and taxes", value: "Not included" },
    ],
    totals: [
      { label: "Labor Subtotal", value: "$1,000.00" },
      { label: "Materials Subtotal", value: "$500.00" },
      { label: "Estimated Total (Labor + Materials)", value: "$1,500.00", strong: true },
    ],
    afterTotal: ["Non-binding."],
    sections: [],
    footer: { business: "Smith Bath Co.", date: "Oct 10, 2026" },
  };
}

const pageOf = (texts, re) => texts.find((t) => re.test(t.text)).page;

test("the subtotals and total share a page with at least the last line item, however many lines there are", () => {
  // Every count from a few lines to several pages' worth: the totals are
  // never on a page by themselves.
  for (let n = 1; n <= 120; n++) {
    const texts = build(spec(n));
    const lastLine = pageOf(texts, new RegExp("^Line " + n + "$"));
    const total = pageOf(texts, /^Estimated Total/);
    const laborSubtotal = pageOf(texts, /^Labor Subtotal/);
    assert.equal(total, lastLine, n + " lines: the total is on the last line item's page");
    assert.equal(laborSubtotal, lastLine, n + " lines: the subtotals are on the last line item's page");
  }
});

test("the footer is on every page, numbered", () => {
  const texts = build(spec(60));
  const pages = Math.max(...texts.map((t) => t.page));
  assert.ok(pages >= 2);
  for (let p = 1; p <= pages; p++) {
    assert.ok(
      texts.some((t) => t.page === p && t.text === `Page ${p} of ${pages}`),
      "page " + p,
    );
  }
});
