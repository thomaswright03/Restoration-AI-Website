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

test("demo leads are accepted but not stored; incomplete ones are refused", async () => {
  const handler = require("../../api/leads.js");
  const ok = fakeRes();
  await handler({ method: "POST", headers: {}, body: { name: "A", phone: "555", business: "demo" } }, ok);
  assert.deepEqual(JSON.parse(ok.body), { ok: true, demo: true });
  const bad = fakeRes();
  await handler({ method: "POST", headers: {}, body: { business: "demo" } }, bad);
  assert.equal(bad.statusCode, 400);
});
