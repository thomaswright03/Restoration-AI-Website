"use strict";

// api/account.js (Delete account) and api/checkout.js (plans, promo codes),
// against a stand-in fetch for Supabase and Stripe.

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
  // A leftover add-on price must never reach checkout.
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

test("checkout: only the plan is sold; a website add-on is never added", async () => {
  const calls = setup();
  const res = await post("checkout.js", { plan: "starter", website: true });
  assert.equal(res.statusCode, 200, res.body);
  const session = calls.find((c) => c.includes("/v1/checkout/sessions"));
  assert.doesNotMatch(session, /price_web|line_items%5B1%5D|website/);
  // The old "add it to my plan" request names no plan: refused, nothing sold.
  const old = setup();
  const refused = await post("checkout.js", { addon: "website" });
  assert.equal(refused.statusCode, 400);
  assert.equal(refused.json().error, "plan");
  assert.ok(!old.some((c) => c.includes("api.stripe.com")));
});

test("checkout: a plan that isn't starter, pro or max is refused with 400, never sold as Starter", async () => {
  for (const plan of [undefined, "", "gold", "STARTER_PLUS", 1, { plan: "starter" }]) {
    const calls = setup();
    const res = await post("checkout.js", { plan });
    assert.equal(res.statusCode, 400, JSON.stringify(plan));
    assert.equal(res.json().error, "plan");
    assert.ok(!calls.some((c) => c.includes("api.stripe.com")), "nothing reaches Stripe for " + JSON.stringify(plan));
  }
  // A known plan with no price configured is a 400 too, not another plan.
  delete process.env.STRIPE_PRICE_PRO;
  const calls = setup();
  const noPrice = await post("checkout.js", { plan: "pro" });
  assert.equal(noPrice.statusCode, 400);
  assert.equal(noPrice.json().error, "plan");
  assert.ok(!calls.some((c) => c.includes("api.stripe.com")));
  // Case and spaces around a real plan name are forgiven, and the session
  // sells that plan's price.
  const okCalls = setup();
  const ok = await post("checkout.js", { plan: " Starter " });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.match(
    okCalls.find((c) => c.includes("/v1/checkout/sessions")),
    /line_items%5B0%5D%5Bprice%5D=price_s/,
  );
});

test("checkout: an incomplete subscription (a first payment still confirming) counts as one already running", async () => {
  // In our table.
  let calls = setup({ sub: { owner_id: USER, status: "incomplete", stripe_subscription_id: "sub_i" } });
  let res = await post("checkout.js", { plan: "starter" });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error, "already-subscribed");
  assert.ok(!calls.some((c) => c.includes("/v1/checkout/sessions")));

  // Known only to Stripe so far (the webhook hasn't landed): found by email.
  calls = setup();
  const plain = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    if (u.host === "api.stripe.com" && u.pathname === "/v1/customers" && (opts.method || "GET") === "GET") {
      calls.push("GET api.stripe.com/v1/customers");
      return reply(200, {
        data: [{ id: "cus_9", subscriptions: { data: [{ id: "sub_9", status: "incomplete", items: { data: [] } }] } }],
      });
    }
    if (u.pathname === "/rest/v1/subscriptions" && opts.method === "POST") {
      calls.push("POST db.example/rest/v1/subscriptions");
      return reply(201, {});
    }
    return plain(url, opts);
  };
  res = await post("checkout.js", { plan: "starter" });
  assert.equal(res.statusCode, 409, res.body);
  assert.equal(res.json().error, "already-subscribed");
  assert.ok(calls.includes("POST db.example/rest/v1/subscriptions"), "the found subscription is recorded");
  assert.ok(!calls.some((c) => c.includes("/v1/checkout/sessions")));
});

test("checkout: a promo code makes the first week free, once per account; a wrong code is refused", async () => {
  delete process.env.PROMO_CODES;
  delete process.env.TRIAL_DAYS;
  let calls = setup();
  const res = await post("checkout.js", { plan: "starter", promo: " freeweek " });
  assert.equal(res.statusCode, 200, res.body);
  const session = calls.find((c) => c.includes("/v1/checkout/sessions"));
  assert.match(session, /subscription_data%5Btrial_period_days%5D=7/);
  assert.match(session, /subscription_data%5Bmetadata%5D%5Bpromo%5D=FREEWEEK/);
  assert.doesNotMatch(session, /allow_promotion_codes/);

  // No code: no free days.
  calls = setup();
  await post("checkout.js", { plan: "starter" });
  assert.doesNotMatch(
    calls.find((c) => c.includes("/v1/checkout/sessions")),
    /trial_period_days/,
  );

  // A code that isn't on the list never reaches Stripe.
  calls = setup();
  const bad = await post("checkout.js", { plan: "starter", promo: "NOPE" });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().error, "promo");
  assert.ok(!calls.some((c) => c.includes("api.stripe.com")));

  // Not again after an earlier subscription.
  setup({
    sub: { owner_id: USER, status: "canceled", stripe_subscription_id: "sub_old", stripe_customer_id: "cus_1" },
  });
  const used = await post("checkout.js", { plan: "starter", promo: "FREEWEEK" });
  assert.equal(used.statusCode, 409);
  assert.equal(used.json().error, "promo-used");

  // PROMO_CODES replaces the list, with optional days per code; "none" turns codes off.
  process.env.PROMO_CODES = "LAUNCH30:30, spring";
  calls = setup();
  await post("checkout.js", { plan: "starter", promo: "launch30" });
  assert.match(
    calls.find((c) => c.includes("/v1/checkout/sessions")),
    /trial_period_days%5D=30/,
  );
  assert.equal((await post("checkout.js", { plan: "starter", promo: "FREEWEEK" })).json().error, "promo");
  const { promoDays } = require("../../api/_plans.js");
  assert.equal(promoDays("Spring"), 7);
  process.env.PROMO_CODES = "none";
  assert.equal(promoDays("FREEWEEK"), 0);
  delete process.env.PROMO_CODES;
});
