"use strict";

// api/leads.js (demo only, email check) and api/stripe-webhook.js (records
// the subscription as Stripe has it now, not as an out-of-order event saw
// it), against a stand-in fetch for Supabase and Stripe.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const OWNER = "11111111-1111-4111-8111-111111111111";

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    end(b) {
      this.body = b || "";
    },
    json() {
      return JSON.parse(this.body);
    },
  };
}

function reply(status, body) {
  return {
    ok: status < 300,
    status,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
    json: async () => body,
  };
}

function setEnv() {
  process.env.SUPABASE_URL = "https://db.example";
  process.env.SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  delete process.env.RESEND_API_KEY;
}

async function postLead(body) {
  const res = fakeRes();
  await require("../../api/leads.js")({ method: "POST", headers: {}, body }, res);
  return res;
}

test("leads: the demo's requests are checked and answered, never stored", async () => {
  setEnv();
  const calls = [];
  global.fetch = async (url) => {
    calls.push(url);
    return reply(500, {});
  };
  const ok = await postLead({ name: "Ana", email: "ana@example.com", business: "demo" });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().demo, true);
  const bad = await postLead({ name: "Ana", email: "not an email", business: "demo" });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().error, "email");
  assert.equal(calls.length, 0);
});

test("leads: a business's designer takes no requests, whatever its plan", async () => {
  setEnv();
  const calls = [];
  global.fetch = async (url) => {
    calls.push(url);
    return reply(200, [{ status: "active", plan: "max", website: true }]);
  };
  const res = await postLead({ name: "Ana", email: "ana@example.com", business: "smith" });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, "unavailable");
  assert.equal(calls.length, 0);
});

test("webhook: a stale subscription event records the subscription as Stripe has it now", async () => {
  setEnv();
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  const saved = [];
  global.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    if (u.host === "api.stripe.com" && u.pathname === "/v1/subscriptions/sub_1") {
      return reply(200, {
        id: "sub_1",
        customer: "cus_1",
        status: "active",
        metadata: { owner_id: OWNER },
        // A retired add-on listed first: the plan still comes from the plan's price.
        items: {
          data: [
            { price: { id: "price_web" }, current_period_end: 1900000000 },
            { price: { id: "price_m", lookup_key: "pro_monthly" }, current_period_end: 1900000000 },
          ],
        },
      });
    }
    if (u.pathname === "/rest/v1/subscriptions") {
      saved.push(JSON.parse(opts.body));
      return reply(201);
    }
    return reply(404, { message: "unexpected " + u.href });
  };
  // An old "trialing" update that arrives after the subscription went active.
  const raw = JSON.stringify({
    type: "customer.subscription.updated",
    data: { object: { id: "sub_1", status: "trialing", metadata: { owner_id: OWNER }, items: { data: [] } } },
  });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto
    .createHmac("sha256", "whsec_test")
    .update(t + "." + raw)
    .digest("hex");
  const req = (async function* () {
    yield Buffer.from(raw);
  })();
  req.method = "POST";
  req.headers = { "stripe-signature": `t=${t},v1=${sig}` };
  const res = fakeRes();
  await require("../../api/stripe-webhook.js")(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].status, "active");
  assert.equal(saved[0].plan, "pro");
  assert.equal(saved[0].price_id, "price_m");
  assert.equal(saved[0].website, undefined);
  assert.equal(saved[0].owner_id, OWNER);
});
