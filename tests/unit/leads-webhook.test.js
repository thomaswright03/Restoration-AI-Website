"use strict";

// api/leads.js (rate limit, email check) and api/stripe-webhook.js (records
// the subscription as Stripe has it now, not as an out-of-order event saw
// it), against a stand-in fetch for Supabase and Stripe.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const OWNER = "11111111-1111-4111-8111-111111111111";
const BIZ = "33333333-3333-4333-8333-333333333333";

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

function fakeLeadsDb(existing) {
  const data = { leads: existing };
  global.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const method = opts.method || "GET";
    if (u.pathname === "/rest/v1/businesses") return reply(200, [{ id: BIZ, owner_id: OWNER, slug: "smith" }]);
    if (u.pathname === "/rest/v1/subscriptions") return reply(200, [{ status: "active" }]);
    if (u.pathname === "/rest/v1/leads" && method === "GET") {
      const since = u.searchParams.get("created_at").replace(/^gte\./, "");
      const limit = Number(u.searchParams.get("limit"));
      return reply(200, data.leads.filter((l) => l.created_at >= since).slice(0, limit));
    }
    if (u.pathname === "/rest/v1/leads" && method === "POST") {
      data.leads.push(Object.assign({ created_at: new Date().toISOString() }, JSON.parse(opts.body)));
      return reply(201);
    }
    return reply(404, { message: "unexpected " + method + " " + u.pathname });
  };
  return data;
}

async function postLead(body) {
  const res = fakeRes();
  await require("../../api/leads.js")({ method: "POST", headers: {}, body }, res);
  return res;
}

test("leads: saved for an active business; a bad email is refused", async () => {
  setEnv();
  const data = fakeLeadsDb([]);
  const ok = await postLead({ name: "Ana", email: "ana@example.com", business: "smith" });
  assert.equal(ok.statusCode, 200);
  assert.equal(data.leads.length, 1);
  const bad = await postLead({ name: "Ana", email: "not an email", business: "smith" });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().error, "email");
  assert.equal(data.leads.length, 1);
});

test("leads: more than 30 in an hour for one business are turned away; older ones don't count", async () => {
  setEnv();
  const hourAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  const now = new Date().toISOString();
  const old = Array.from({ length: 40 }, () => ({ created_at: hourAgo }));
  const data = fakeLeadsDb(old.concat(Array.from({ length: 29 }, () => ({ created_at: now }))));
  const last = await postLead({ name: "Ana", phone: "555", business: "smith" });
  assert.equal(last.statusCode, 200);
  const over = await postLead({ name: "Bo", phone: "555", business: "smith" });
  assert.equal(over.statusCode, 429);
  assert.equal(data.leads.length, 70);
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
        // The website add-on listed first: the plan still comes from the plan's price.
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
  assert.equal(saved[0].owner_id, OWNER);
});
