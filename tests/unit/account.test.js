"use strict";

// api/account.js (Delete account) and api/checkout.js's "add the website
// add-on" path, against a stand-in fetch for Supabase and Stripe.

const test = require("node:test");
const assert = require("node:assert/strict");

const USER = "11111111-1111-4111-8111-111111111111";

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

// sub: the user's subscriptions row, or null. stripeFails: Stripe answers 500.
function setup({ sub = null, stripeFails = false } = {}) {
  process.env.SUPABASE_URL = "https://db.example";
  process.env.SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  process.env.STRIPE_PRICE_STARTER = "price_s";
  process.env.STRIPE_PRICE_WEBSITE = "price_web";
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const method = opts.method || "GET";
    calls.push(method + " " + u.host + u.pathname + (opts.body ? " " + opts.body : ""));
    if (u.pathname === "/auth/v1/user") {
      return opts.headers.Authorization === "Bearer good"
        ? reply(200, { id: USER, email: "Owner@Example.com" })
        : reply(401, {});
    }
    if (u.pathname === "/auth/v1/admin/users/" + USER && method === "DELETE") return reply(200, {});
    if (u.pathname === "/rest/v1/subscriptions" && method === "GET") return reply(200, sub ? [sub] : []);
    if (u.pathname === "/rest/v1/subscriptions" && method === "PATCH") return reply(204);
    if (u.host === "api.stripe.com") {
      if (stripeFails) return reply(500, { error: { message: "boom" } });
      return reply(200, { id: "x", status: "canceled" });
    }
    return reply(404, { message: "unexpected " + method + " " + u.pathname });
  };
  return calls;
}

async function post(file, body, token = "good") {
  const res = fakeRes();
  await require("../../api/" + file)(
    { method: "POST", body, query: {}, headers: { authorization: "Bearer " + token } },
    res,
  );
  return res;
}

test("delete account: needs a sign-in and the typed email; then cancels Stripe and deletes the user", async () => {
  const calls = setup({ sub: { owner_id: USER, status: "active", stripe_subscription_id: "sub_1" } });
  assert.equal((await post("account.js", { action: "delete", confirm: "owner@example.com" }, "bad")).statusCode, 401);
  const wrong = await post("account.js", { action: "delete", confirm: "someone@example.com" });
  assert.equal(wrong.statusCode, 400);
  assert.equal(wrong.json().error, "confirm");
  assert.ok(!calls.some((c) => c.startsWith("DELETE")));

  const ok = await post("account.js", { action: "delete", confirm: " owner@example.com " });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.deepEqual(ok.json(), { deleted: true });
  const stripeCancel = calls.indexOf("DELETE api.stripe.com/v1/subscriptions/sub_1");
  const userDelete = calls.indexOf("DELETE db.example/auth/v1/admin/users/" + USER);
  assert.ok(stripeCancel >= 0 && userDelete > stripeCancel, calls.join("\n"));
});

test("delete account: with no Stripe subscription, just the user goes; if Stripe won't cancel, nothing is deleted", async () => {
  let calls = setup({ sub: { owner_id: USER, status: "active", plan: "max" } });
  const ok = await post("account.js", { action: "delete", confirm: "owner@example.com" });
  assert.equal(ok.statusCode, 200);
  assert.ok(!calls.some((c) => c.includes("api.stripe.com")));
  assert.ok(calls.includes("DELETE db.example/auth/v1/admin/users/" + USER));

  calls = setup({ sub: { owner_id: USER, status: "active", stripe_subscription_id: "sub_1" }, stripeFails: true });
  const failed = await post("account.js", { action: "delete", confirm: "owner@example.com" });
  assert.equal(failed.statusCode, 502);
  assert.equal(failed.json().error, "stripe");
  assert.ok(!calls.some((c) => c.startsWith("DELETE db.example")));
});

test("checkout: adding the website add-on puts it on the Stripe subscription and the record", async () => {
  const calls = setup({ sub: { owner_id: USER, status: "active", plan: "pro", stripe_subscription_id: "sub_1" } });
  const res = await post("checkout.js", { addon: "website" });
  assert.equal(res.statusCode, 200, res.body);
  assert.match(
    calls.find((c) => c.includes("/v1/subscription_items")),
    /subscription=sub_1&price=price_web/,
  );
  assert.match(
    calls.find((c) => c.startsWith("PATCH db.example/rest/v1/subscriptions")),
    /"website":true/,
  );

  // Already included (Max), a plan set by hand, or no plan at all.
  setup({ sub: { owner_id: USER, status: "active", plan: "max" } });
  assert.equal((await post("checkout.js", { addon: "website" })).json().already, true);
  setup({ sub: { owner_id: USER, status: "active", plan: "starter" } });
  assert.equal((await post("checkout.js", { addon: "website" })).json().error, "no-stripe");
  setup();
  assert.equal((await post("checkout.js", { addon: "website" })).json().error, "no-plan");
});
