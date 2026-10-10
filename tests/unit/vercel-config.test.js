"use strict";

// vercel.json: the security headers reach every page, and the big static
// files are cached so a repeat visit doesn't revalidate ~40 requests:
//
//   immutable for a year   only paths whose name changes with their content
//                          (the versioned Three.js folder, file by file, so a
//                          404 under it is never frozen)
//   a day, then refreshed  models, fonts, images and the other vendored
//                          libraries, which are edited in place under the same
//                          name: max-age=86400 with stale-while-revalidate, so
//                          a changed file reaches returning browsers within a day
//   checked every load     pages (Vercel's default) and first-party js/*.js,
//                          js/i18n/*.js and css/*.css: max-age=0,
//                          must-revalidate and no stale-while-revalidate, so a
//                          page is never paired with the previous deploy's script

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));

const IMMUTABLE = "public, max-age=31536000, immutable";
const DAILY = "public, max-age=86400, stale-while-revalidate=604800";

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

function filesUnder(dir) {
  const out = [];
  (function walk(d) {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else out.push("/" + path.relative(root, p).split(path.sep).join("/"));
    }
  })(path.join(root, dir));
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

test("only versioned paths are immutable, and every one of them exists", () => {
  const immutableRules = config.headers.filter((r) => r.headers.some((h) => h.value === IMMUTABLE));
  assert.ok(immutableRules.length > 0, "no immutable rule");
  for (const rule of immutableRules) {
    // A version in the folder name: js/vendor/three-r186/...
    assert.match(rule.source, /^\/js\/vendor\/[a-z]+-r\d+\//, rule.source + " is not a versioned folder");
  }
  // Every file that gets the header is in the repo, and every file in the
  // versioned folder gets it (the rule lists them one by one).
  const versioned = filesUnder("js/vendor/three-r186").filter((p) => p.endsWith(".js"));
  assert.ok(versioned.length >= 2, "three.module.js and three.core.js");
  for (const p of versioned) assert.equal(headersFor(p)["cache-control"], IMMUTABLE, p);
  const listed = new Set();
  for (const rule of immutableRules) {
    const m = /^\/(js\/vendor\/[a-z]+-r\d+)\/\((.*)\)$/.exec(rule.source);
    assert.ok(m, rule.source + " must list its files");
    for (const f of m[2].split("|")) listed.add("/" + m[1] + "/" + f.replace(/\\\./g, "."));
  }
  assert.deepEqual([...listed].sort(), versioned.sort(), "vercel.json lists exactly the vendored Three.js files");
  // Every page's import map points at the versioned folder.
  const layout = fs.readFileSync(path.join(root, "pages", "layout.html"), "utf8");
  assert.match(layout, /"three": "\.\/\{\{@root\}\}js\/vendor\/three-r186\/three\.module\.js"/);
});

test("a missing file is never cached as immutable", () => {
  for (const p of [
    "/js/vendor/three-r186/missing.js",
    "/js/vendor/three-r186/addons/controls/TrackballControls.js",
    "/js/vendor/three/three.module.js",
    "/js/vendor/nothing.js",
    "/fonts/missing.woff2",
    "/fonts/OFL-Inter.txt",
    "/images/missing.png",
    "/models/products/kohler/manifest.json",
  ]) {
    assert.notEqual(headersFor(p)["cache-control"], IMMUTABLE, p);
  }
});

test("models, fonts, images and unversioned libraries are cached a day and refreshed in the background", () => {
  const sample = [
    "/models/fixtures/toilet.glb",
    "/models/products/kohler/K-2874-0.glb",
    "/js/vendor/jspdf.umd.min.js",
    "/js/vendor/supabase/supabase.js",
    "/fonts/inter-latin.woff2",
    "/images/og-en.png",
  ];
  for (const p of sample) assert.equal(headersFor(p)["cache-control"], DAILY, p);
  // The real files, so a renamed font or image doesn't silently lose its rule.
  for (const p of [...filesUnder("fonts"), ...filesUnder("images"), ...filesUnder("models")]) {
    if (/\.(woff2|png|glb)$/.test(p)) assert.equal(headersFor(p)["cache-control"], DAILY, p);
  }
  for (const p of ["/js/vendor/jspdf.umd.min.js", "/js/vendor/supabase/supabase.js"]) {
    assert.ok(fs.existsSync(path.join(root, p.slice(1))), p);
  }
});

test("pages, first-party scripts, styles and settings are never served stale without a check", () => {
  for (const p of ["/index.html", "/designer.html", "/es/designer.html", "/site-config.json", "/api/config"]) {
    assert.equal(headersFor(p)["cache-control"], undefined, p + " keeps Vercel's revalidate-every-time default");
  }
  // No stale-while-revalidate here: with it, the browser may run the previous
  // deploy's studio.js against the new designer.html for one load.
  const FRESH = "public, max-age=0, must-revalidate";
  for (const p of [
    "/js/studio.js",
    "/js/i18n.js",
    "/js/i18n/es.js",
    "/js/net.js",
    "/css/studio.css",
    "/css/style.css",
  ]) {
    assert.equal(headersFor(p)["cache-control"], FRESH, p);
  }
  for (const p of filesUnder("js")) {
    if (p.startsWith("/js/vendor/")) continue;
    assert.equal(headersFor(p)["cache-control"], FRESH, p + " is a first-party script without a cache rule");
  }
  for (const p of filesUnder("css")) assert.equal(headersFor(p)["cache-control"], FRESH, p);
  // The models manifest is data read by tools, not the browser, but it must
  // not be frozen by the .glb rule either.
  assert.equal(headersFor("/models/products/kohler/manifest.json")["cache-control"], undefined);
});
