"use strict";

// vercel.json: the security headers reach every page, and the big files that
// never change in place (3D models, vendored libraries, fonts, images) are
// cached for a year, so a repeat visit doesn't revalidate ~40 requests.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "vercel.json"), "utf8"));

// The headers Vercel would send for a path: every rule whose source matches,
// later rules adding to earlier ones (Vercel's own order).
function headersFor(urlPath) {
  const out = {};
  for (const rule of config.headers) {
    const re = new RegExp("^" + rule.source + "$");
    if (!re.test(urlPath)) continue;
    for (const h of rule.headers) out[h.key.toLowerCase()] = h.value;
  }
  return out;
}

test("every rule's source is a valid pattern", () => {
  for (const rule of config.headers) {
    assert.doesNotThrow(() => new RegExp("^" + rule.source + "$"), rule.source);
    assert.ok(rule.headers.length > 0, rule.source + " sets no header");
  }
});

test("security headers reach pages, API routes and assets alike", () => {
  for (const p of [
    "/index.html",
    "/es/account.html",
    "/api/projects",
    "/js/studio.js",
    "/models/fixtures/toilet.glb",
  ]) {
    const h = headersFor(p);
    assert.equal(h["x-content-type-options"], "nosniff", p);
    assert.equal(h["x-frame-options"], "SAMEORIGIN", p);
    assert.equal(h["content-security-policy"], "frame-ancestors 'self'", p);
    assert.equal(h["referrer-policy"], "strict-origin-when-cross-origin", p);
  }
});

test("models, vendored libraries, fonts and images are immutable for a year", () => {
  const immutable = "public, max-age=31536000, immutable";
  for (const p of [
    "/models/fixtures/toilet.glb",
    "/models/products/kohler/K-2874-0.glb",
    "/js/vendor/three/three.module.js",
    "/js/vendor/three/addons/controls/OrbitControls.js",
    "/js/vendor/jspdf.umd.min.js",
    "/js/vendor/supabase/supabase.js",
    "/fonts/inter-latin.woff2",
    "/images/og-en.png",
  ]) {
    assert.equal(headersFor(p)["cache-control"], immutable, p);
  }
});

test("pages, first-party scripts, styles and settings are never served stale without a check", () => {
  for (const p of ["/index.html", "/designer.html", "/es/designer.html", "/site-config.json", "/api/config"]) {
    assert.equal(headersFor(p)["cache-control"], undefined, p + " keeps Vercel's revalidate-every-time default");
  }
  for (const p of ["/js/studio.js", "/js/i18n.js", "/css/studio.css"]) {
    assert.match(headersFor(p)["cache-control"], /^public, max-age=0, must-revalidate/, p);
  }
  // The models manifest is data read by tools, not the browser, but it must
  // not be frozen by the .glb rule either.
  assert.equal(headersFor("/models/products/kohler/manifest.json")["cache-control"], undefined);
});
