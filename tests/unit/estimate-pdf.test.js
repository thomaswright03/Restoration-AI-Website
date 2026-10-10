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
    textWithLink(t, x, y, opts) {
      texts.push({ text: String(t), page, y, link: opts && opts.url });
    },
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

function spec(lineCount, overrides) {
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
    ...overrides,
  };
}

const pageOf = (texts, re) => texts.find((t) => re.test(t.text)).page;

test("the subtotals and total share a page with the row before them, and the rows before that fill their pages", () => {
  // Every count from a few lines to several pages' worth: the totals are
  // never on a page by themselves, and the table never leaves a page half
  // empty: at most the one row before the totals moves on with them.
  for (let n = 1; n <= 120; n++) {
    const texts = build(spec(n));
    const lastLine = pageOf(texts, new RegExp("^Line " + n + "$"));
    const lastRow = pageOf(texts, /^Permits and taxes/);
    const total = pageOf(texts, /^Estimated Total/);
    const laborSubtotal = pageOf(texts, /^Labor Subtotal/);
    assert.equal(total, lastRow, n + " lines: the total is on the page of the row before it");
    assert.equal(laborSubtotal, lastRow, n + " lines: the subtotals are on the page of the row before them");
    assert.ok(lastLine >= total - 1, n + " lines: the line items run up to the totals' page");
    // The line before the last never moves on with the totals: when the
    // totals start a new page, only the row right before them came along.
    if (n >= 2) {
      const beforeLast = pageOf(texts, new RegExp("^Line " + (n - 1) + "$"));
      const firstExcluded = pageOf(texts, /^Other work/);
      assert.ok(firstExcluded <= total, n + " lines: the not-included rows come before the totals");
      assert.ok(beforeLast >= firstExcluded - 1, n + " lines: the rows flow one after another");
    }
  }
});

test("without not-included rows, the totals share a page with the last line item", () => {
  for (let n = 1; n <= 120; n++) {
    const texts = build(spec(n, { excluded: [] }));
    const lastLine = pageOf(texts, new RegExp("^Line " + n + "$"));
    assert.equal(pageOf(texts, /^Estimated Total/), lastLine, n + " lines");
    assert.equal(pageOf(texts, /^Labor Subtotal/), lastLine, n + " lines");
  }
});

test("a link item prints its address under the linked text, so it works on paper too", () => {
  const url = "https://example.com/designer.html#design=abc";
  const texts = build(spec(3, { sections: [{ title: "Open this design", items: [{ text: "Open in 3D at:", url }] }] }));
  const label = texts.find((t) => t.text === "Open in 3D at:");
  assert.ok(label && label.link === url, "the text is linked");
  const address = texts.find((t) => t.text === url);
  assert.ok(address && address.link === url, "the address is printed and linked");
  assert.ok(address.page === label.page && address.y > label.y, "the address sits under the text");
  assert.ok(!texts.some((t) => /click here/i.test(t.text)));
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
