"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const lib = require("../../api/_lib.js");

function fakeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    end(b) {
      this.body = b || "";
    },
  };
  return res;
}

test("Stripe signatures: valid passes, tampered, stale or wrong-secret fail", () => {
  const secret = "whsec_test";
  const body = '{"id":"evt_1"}';
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto
    .createHmac("sha256", secret)
    .update(t + "." + body)
    .digest("hex");
  const header = `t=${t},v1=${sig}`;
  assert.equal(lib.verifyStripeSignature(body, header, secret), true);
  assert.equal(lib.verifyStripeSignature(body + " ", header, secret), false);
  assert.equal(lib.verifyStripeSignature(body, header, "whsec_other"), false);
  assert.equal(lib.verifyStripeSignature(body, header, secret, 300, Date.now() + 3600 * 1000), false);
  assert.equal(lib.verifyStripeSignature(body, "", secret), false);
});

test("Stripe form encoding nests keys and skips empty values", () => {
  const out = lib
    .formEncode({ mode: "subscription", line_items: { 0: { price: "price_1", quantity: 1 } }, customer: undefined })
    .toString();
  assert.equal(out, "mode=subscription&line_items%5B0%5D%5Bprice%5D=price_1&line_items%5B0%5D%5Bquantity%5D=1");
});

test("with no keys set, config reports demo mode and the business script says not configured", async () => {
  for (const k of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "STRIPE_SECRET_KEY"]) {
    delete process.env[k];
  }
  const cfg = fakeRes();
  await require("../../api/config.js")({ headers: {} }, cfg);
  assert.equal(JSON.parse(cfg.body).accounts, false);
  // With nothing configured every switch is on.
  assert.deepEqual(JSON.parse(cfg.body).switches, { signups: true, checkout: true, saving: true });

  const biz = fakeRes();
  await require("../../api/business.js")({ query: { b: "smith" }, headers: {} }, biz);
  assert.match(biz.body, /^window\.DesignerBusiness\.load\(null, "not-configured"\);/);
});

// A fetch that answers from a script of replies, one per call, and records
// each call's method.
function scriptedFetch(replies) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push(opts.method || "GET");
    const next = replies.shift();
    if (next instanceof Error) throw next;
    const { status = 200, body = "[]", headers = {} } = next;
    return {
      ok: status < 300,
      status,
      headers: { get: (k) => headers[k.toLowerCase()] ?? null },
      text: async () => body,
      json: async () => JSON.parse(body),
    };
  };
  return calls;
}

test("upstream reads are retried once after a dropped connection or a 5xx; writes and timeouts are not", async () => {
  process.env.SUPABASE_URL = "https://db.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.STRIPE_SECRET_KEY = "sk_test";
  assert.ok(lib.RETRY_DELAY_MS <= 500, "a retry waits briefly, within the function's time budget");

  // A 503, then the rows: one retry, the caller never notices.
  let calls = scriptedFetch([{ status: 503, body: "busy" }, { body: '[{"id":1}]' }]);
  assert.deepEqual(await lib.db("projects?select=id"), [{ id: 1 }]);
  assert.deepEqual(calls, ["GET", "GET"]);

  // A connection that dropped (fetch rejected), then success.
  const dropped = Object.assign(new TypeError("fetch failed"), { code: "ECONNRESET" });
  calls = scriptedFetch([dropped, { body: '[{"id":2}]' }]);
  assert.deepEqual(await lib.db("projects?select=id"), [{ id: 2 }]);
  assert.equal(calls.length, 2);

  // Only one retry: two failures reach the caller as the second error.
  calls = scriptedFetch([{ status: 502, body: "bad" }, { status: 503, body: "worse" }, { body: "[]" }]);
  await assert.rejects(lib.db("projects?select=id"), /Supabase 503/);
  assert.equal(calls.length, 2);

  // A 4xx is an answer, not a hiccup: no retry.
  calls = scriptedFetch([{ status: 400, body: "nope" }, { body: "[]" }]);
  await assert.rejects(lib.db("projects?select=id"), /Supabase 400/);
  assert.equal(calls.length, 1);

  // A write is never repeated, whatever happened.
  calls = scriptedFetch([{ status: 503, body: "busy" }, { body: "[]" }]);
  await assert.rejects(lib.db("projects", { method: "POST", body: { name: "x" } }), /Supabase 503/);
  assert.deepEqual(calls, ["POST"]);
  calls = scriptedFetch([dropped, { body: "[]" }]);
  await assert.rejects(lib.db("projects", { method: "PATCH", body: { name: "x" } }), /unreachable/);
  assert.deepEqual(calls, ["PATCH"]);

  // A timeout has spent the budget: no retry.
  calls = [];
  global.fetch = (url, opts) =>
    new Promise((resolve, reject) => {
      calls.push(opts.method || "GET");
      opts.signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
  await assert.rejects(lib.db("projects?select=id", { timeoutMs: 20 }), /timeout/);
  assert.deepEqual(calls, ["GET"]);

  // Stripe: a GET is retried on a 5xx, a POST is not.
  calls = scriptedFetch([{ status: 500, body: "{}" }, { body: '{"id":"cus_1"}' }]);
  assert.deepEqual(await lib.stripe("customers/cus_1"), { id: "cus_1" });
  assert.deepEqual(calls, ["GET", "GET"]);
  calls = scriptedFetch([{ status: 500, body: '{"error":{"message":"down"}}' }, { body: "{}" }]);
  await assert.rejects(lib.stripe("customers", { email: "a@b.co" }), /Stripe 500: down/);
  assert.deepEqual(calls, ["POST"]);
});

test("dbCount asks the database for the number and reads it from Content-Range", async () => {
  process.env.SUPABASE_URL = "https://db.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  let seen = [];
  global.fetch = async (url, opts) => {
    seen.push({ url, method: opts.method, prefer: opts.headers.Prefer });
    return {
      ok: true,
      status: 200,
      headers: { get: (k) => (k === "content-range" ? (seen.length === 1 ? "0-999/1000" : "*/0") : null) },
      text: async () => "",
      json: async () => null,
    };
  };
  assert.equal(await lib.dbCount("projects?owner_id=eq.u1"), 1000);
  assert.equal(await lib.dbCount("projects?owner_id=eq.u2"), 0);
  assert.deepEqual(seen, [
    { url: "https://db.example/rest/v1/projects?owner_id=eq.u1", method: "HEAD", prefer: "count=exact" },
    { url: "https://db.example/rest/v1/projects?owner_id=eq.u2", method: "HEAD", prefer: "count=exact" },
  ]);
  // A proxy that strips the header is an error, not a zero.
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => "",
    json: async () => null,
  });
  await assert.rejects(lib.dbCount("projects"), /no Content-Range/);
  // A retried count: 503 then the number.
  let n = 0;
  global.fetch = async () => ({
    ok: ++n > 1,
    status: n > 1 ? 200 : 503,
    headers: { get: () => "0-2/3" },
    text: async () => "",
    json: async () => null,
  });
  assert.equal(await lib.dbCount("projects"), 3);
  assert.equal(n, 2);
});
