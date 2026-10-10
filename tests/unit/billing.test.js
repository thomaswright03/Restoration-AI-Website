"use strict";

// Billing, branch by branch: api/portal.js and api/account.js against a
// scripted fetch (every method check, configuration check, sign-in answer,
// database and Stripe failure), the one retry api/_lib.js gives a Stripe
// create that carries an idempotency key, and which plan a subscriptions row
// puts its owner on when the stored plan and the price disagree.

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

function reply(status, body, headers = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    ok: status < 300,
    status,
    headers: { get: (k) => lower[k.toLowerCase()] ?? null },
    text: async () => (body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body)),
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
  };
}

function setEnv() {
  process.env.SUPABASE_URL = "https://db.example";
  process.env.SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  process.env.STRIPE_PRICE_STARTER = "price_s";
  process.env.STRIPE_PRICE_PRO = "price_p";
  process.env.STRIPE_PRICE_MAX = "price_m, price_m_old";
}

// A fetch answered by `routes`: each key "METHOD host/path" maps to a reply,
// or a function of (url, opts) returning one; anything else is a 404.
// Records "METHOD host/path" for every call, plus the request headers.
function route(routes) {
  const calls = [];
  const headers = [];
  global.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const method = opts.method || "GET";
    const key = method + " " + u.host + u.pathname;
    calls.push(key);
    headers.push(opts.headers || {});
    const hit = routes[key];
    if (hit instanceof Error) throw hit;
    if (typeof hit === "function") return hit(u, opts);
    if (hit) return hit;
    return reply(404, { message: "unexpected " + key });
  };
  return { calls, headers };
}

const AUTH_OK = (u, opts) =>
  opts.headers.Authorization === "Bearer good" ? reply(200, { id: USER, email: "owner@example.com" }) : reply(401, {});

async function call(file, body, token = "good", method = "POST") {
  const res = fakeRes();
  await require("../../api/" + file)(
    { method, body, query: {}, headers: token ? { authorization: "Bearer " + token } : {} },
    res,
  );
  return res;
}

// ---------------------------------------------------------------- portal

test("portal: only POST, and only once Supabase and Stripe are configured", async () => {
  setEnv();
  route({});
  const get = await call("portal.js", {}, "good", "GET");
  assert.equal(get.statusCode, 405);
  assert.equal(get.headers.allow, "POST");
  assert.equal(get.json().error, "method");

  delete process.env.STRIPE_SECRET_KEY;
  const off = await call("portal.js", {});
  assert.equal(off.statusCode, 503);
  assert.equal(off.json().error, "not-configured");
  setEnv();
});

test("portal: no sign-in is 401; an auth service that fails is 503, not 'sign in'", async () => {
  setEnv();
  route({ "GET db.example/auth/v1/user": AUTH_OK });
  assert.equal((await call("portal.js", {}, "bad")).statusCode, 401);
  assert.equal((await call("portal.js", {}, "")).statusCode, 401);

  route({ "GET db.example/auth/v1/user": reply(503, {}) });
  const down = await call("portal.js", {});
  assert.equal(down.statusCode, 503);
  assert.equal(down.json().error, "unavailable");
});

test("portal: a database failure is 502 server; no customer on file is 404", async () => {
  setEnv();
  route({
    "GET db.example/auth/v1/user": AUTH_OK,
    "GET db.example/rest/v1/subscriptions": reply(500, "boom"),
  });
  const failed = await call("portal.js", {});
  assert.equal(failed.statusCode, 502);
  assert.equal(failed.json().error, "server");
  assert.ok(failed.json().requestId, "carries a request id to quote");

  for (const rows of [[], [{ stripe_customer_id: null }]]) {
    const { calls } = route({
      "GET db.example/auth/v1/user": AUTH_OK,
      "GET db.example/rest/v1/subscriptions": reply(200, rows),
    });
    const none = await call("portal.js", {});
    assert.equal(none.statusCode, 404);
    assert.equal(none.json().error, "no-customer");
    assert.ok(!calls.some((c) => c.includes("api.stripe.com")));
  }
});

test("portal: opens Stripe's portal for the customer on file, returning to the page's language", async () => {
  setEnv();
  process.env.SITE_URL = "https://rooms.example/";
  let seen;
  const { calls, headers } = route({
    "GET db.example/auth/v1/user": AUTH_OK,
    "GET db.example/rest/v1/subscriptions": reply(200, [{ stripe_customer_id: "cus_7" }]),
    "POST api.stripe.com/v1/billing_portal/sessions": (u, opts) => {
      seen = opts.body;
      return reply(200, { url: "https://billing.stripe.com/p/session_1" });
    },
  });
  const ok = await call("portal.js", { lang: "pt" });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.deepEqual(ok.json(), { url: "https://billing.stripe.com/p/session_1" });
  assert.equal(seen, "customer=cus_7&return_url=https%3A%2F%2Frooms.example%2Fpt%2Faccount.html");
  const stripeHeaders = headers[calls.indexOf("POST api.stripe.com/v1/billing_portal/sessions")];
  assert.match(stripeHeaders["Idempotency-Key"], /^[0-9a-f]{64}$/);

  // English (no lang) and a language that isn't offered both return to the English page.
  for (const lang of ["", "fr", undefined]) {
    route({
      "GET db.example/auth/v1/user": AUTH_OK,
      "GET db.example/rest/v1/subscriptions": reply(200, [{ stripe_customer_id: "cus_7" }]),
      "POST api.stripe.com/v1/billing_portal/sessions": (u, opts) => {
        seen = opts.body;
        return reply(200, { url: "https://billing.stripe.com/p/s" });
      },
    });
    await call("portal.js", { lang });
    assert.match(seen, /return_url=https%3A%2F%2Frooms.example%2Faccount.html$/);
  }
  delete process.env.SITE_URL;
});

test("portal: when Stripe fails the answer is 502 stripe (and a transient failure was tried twice)", async () => {
  setEnv();
  const { calls } = route({
    "GET db.example/auth/v1/user": AUTH_OK,
    "GET db.example/rest/v1/subscriptions": reply(200, [{ stripe_customer_id: "cus_7" }]),
    "POST api.stripe.com/v1/billing_portal/sessions": reply(503, { error: { message: "down" } }),
  });
  const failed = await call("portal.js", {});
  assert.equal(failed.statusCode, 502);
  assert.equal(failed.json().error, "stripe");
  assert.equal(calls.filter((c) => c.includes("billing_portal")).length, 2);

  // A refusal (4xx) is an answer: once, and still reported as a Stripe failure.
  const second = route({
    "GET db.example/auth/v1/user": AUTH_OK,
    "GET db.example/rest/v1/subscriptions": reply(200, [{ stripe_customer_id: "cus_7" }]),
    "POST api.stripe.com/v1/billing_portal/sessions": reply(400, { error: { message: "no portal configured" } }),
  });
  const refused = await call("portal.js", {});
  assert.equal(refused.statusCode, 502);
  assert.equal(refused.json().error, "stripe");
  assert.equal(second.calls.filter((c) => c.includes("billing_portal")).length, 1);
});

// ---------------------------------------------------------------- Stripe create retry

test("a Stripe create with an idempotency key is retried once on 5xx, 429 or a dropped connection, with the same key", async () => {
  setEnv();
  const lib = require("../../api/_lib.js");
  assert.ok(lib.RETRY_DELAY_MAX_MS <= 1000, "a Retry-After is honoured only within the function's budget");

  const replies = (list) => {
    const keys = [];
    global.fetch = async (url, opts = {}) => {
      keys.push(opts.headers["Idempotency-Key"]);
      const next = list.shift();
      if (next instanceof Error) throw next;
      return next;
    };
    return keys;
  };

  // 503 then the session: the caller gets the session.
  let keys = replies([reply(503, { error: { message: "busy" } }), reply(200, { id: "cs_1", url: "u" })]);
  let out = await lib.stripe("checkout/sessions", { mode: "subscription" }, "POST", { idempotencyKey: "k1" });
  assert.equal(out.id, "cs_1");
  assert.deepEqual(keys, ["k1", "k1"]);

  // 429 with Retry-After: waited (bounded) and retried.
  keys = replies([reply(429, { error: { message: "rate" } }, { "Retry-After": "1" }), reply(200, { id: "cs_2" })]);
  const started = Date.now();
  out = await lib.stripe("checkout/sessions", { mode: "subscription" }, "POST", { idempotencyKey: "k2" });
  assert.equal(out.id, "cs_2");
  assert.ok(Date.now() - started >= 900, "honoured the second Stripe asked for");
  assert.deepEqual(keys, ["k2", "k2"]);

  // A connection that dropped before any answer.
  const dropped = Object.assign(new TypeError("fetch failed"), { code: "ECONNRESET" });
  keys = replies([dropped, reply(200, { id: "cs_3" })]);
  out = await lib.stripe("billing_portal/sessions", { customer: "c" }, "POST", { idempotencyKey: "k3" });
  assert.equal(out.id, "cs_3");
  assert.equal(keys.length, 2);

  // Only once: two failures reach the caller as the second error.
  keys = replies([reply(502, {}), reply(503, { error: { message: "still down" } }), reply(200, { id: "no" })]);
  await assert.rejects(
    lib.stripe("checkout/sessions", { mode: "subscription" }, "POST", { idempotencyKey: "k4" }),
    /Stripe 503: still down/,
  );
  assert.equal(keys.length, 2);

  // A 4xx is an answer, not a hiccup.
  keys = replies([reply(400, { error: { message: "bad param" } }), reply(200, { id: "no" })]);
  await assert.rejects(
    lib.stripe("checkout/sessions", { mode: "subscription" }, "POST", { idempotencyKey: "k5" }),
    /Stripe 400: bad param/,
  );
  assert.equal(keys.length, 1);

  // Without a key a POST is never repeated (api.test.js covers timeouts:
  // one has spent the budget, so it isn't retried either).
  keys = replies([reply(503, {}), reply(200, { id: "no" })]);
  await assert.rejects(lib.stripe("customers", { email: "a@b.co" }, "POST"), /Stripe 503/);
  assert.equal(keys.length, 1);
});

// ---------------------------------------------------------------- plan mapping

test("the plan follows the subscription's current price whenever that price maps to a plan", () => {
  setEnv();
  const plans = require("../../api/_plans.js");
  // A Starter row whose price moved to a Max price only the env knows: Max.
  assert.equal(plans.planOf({ status: "active", plan: "starter", price_id: "price_m_old" }), "max");
  assert.equal(plans.planOf({ status: "trialing", plan: "starter", price_id: "price_p" }), "pro");
  // A price nothing maps: the stored plan (set by the webhook or by hand).
  assert.equal(plans.planOf({ status: "active", plan: "pro", price_id: "price_unknown" }), "pro");
  // Nothing at all to go on: Starter, with a warning (never silent).
  const warned = [];
  const warn = console.warn;
  console.warn = (line) => warned.push(JSON.parse(line));
  try {
    assert.equal(plans.planOf({ status: "active", price_id: "price_unknown", owner_id: USER }), "starter");
  } finally {
    console.warn = warn;
  }
  assert.equal(warned.length, 1);
  assert.equal(warned[0].error, "unmapped-plan");
  assert.equal(warned[0].priceId, "price_unknown");
  // Not active: free, whatever the price.
  assert.equal(plans.planOf({ status: "canceled", plan: "max", price_id: "price_m" }), "free");
  assert.equal(plans.planOf(null), "free");

  // The helpers the functions share.
  assert.equal(plans.firstPriceId("max"), "price_m");
  assert.equal(plans.firstPriceId("gold"), "");
  assert.equal(plans.planFromPriceId("price_m_old"), "max");
  assert.equal(plans.planFromPriceId(""), "");
  assert.deepEqual(plans.priceList("STRIPE_PRICE_MAX"), ["price_m", "price_m_old"]);
  assert.deepEqual(plans.ACTIVE_STATUSES, ["active", "trialing"]);
  const { LIVE_STATUSES } = require("../../api/_subscriptions.js");
  assert.ok(LIVE_STATUSES.includes("incomplete"), "a payment still confirming blocks a second checkout");
  for (const s of plans.ACTIVE_STATUSES) assert.ok(LIVE_STATUSES.includes(s));
});

test("recording a subscription writes the plan its price maps to by the env lists when the price names none", async () => {
  setEnv();
  const { saveSubscription } = require("../../api/_subscriptions.js");
  let row;
  route({
    "POST db.example/rest/v1/subscriptions": (u, opts) => {
      row = JSON.parse(opts.body);
      return reply(201, {});
    },
  });
  const sub = {
    id: "sub_1",
    status: "active",
    customer: "cus_1",
    items: { data: [{ price: { id: "price_m_old" }, current_period_end: 1900000000 }] },
  };
  assert.equal(await saveSubscription(USER, sub), true);
  assert.equal(row.plan, "max");
  assert.equal(row.price_id, "price_m_old");
  // A lookup key still wins over the lists.
  sub.items.data[0].price = { id: "price_m_old", lookup_key: "pro" };
  await saveSubscription(USER, sub);
  assert.equal(row.plan, "pro");
  // Neither: the column isn't written, so a hand-set plan stays.
  sub.items.data[0].price = { id: "price_other" };
  await saveSubscription(USER, sub);
  assert.equal("plan" in row, false);
});

// ---------------------------------------------------------------- account (delete)

test("delete account: only POST, only when configured, only the delete action, and the email must match", async () => {
  setEnv();
  route({ "GET db.example/auth/v1/user": AUTH_OK });
  const get = await call("account.js", { action: "delete" }, "good", "GET");
  assert.equal(get.statusCode, 405);
  assert.equal(get.headers.allow, "POST");

  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.equal((await call("account.js", { action: "delete" })).statusCode, 503);
  setEnv();

  const other = await call("account.js", { action: "export", confirm: "owner@example.com" });
  assert.equal(other.statusCode, 400);
  assert.equal(other.json().error, "action");

  for (const confirm of [undefined, "", "   ", "someone@example.com"]) {
    const bad = await call("account.js", { action: "delete", confirm });
    assert.equal(bad.statusCode, 400, JSON.stringify(confirm));
    assert.equal(bad.json().error, "confirm");
  }
});

test("delete account: the auth service failing is 503, and a database failure reading the plan is 502 server", async () => {
  setEnv();
  route({ "GET db.example/auth/v1/user": reply(502, {}) });
  const down = await call("account.js", { action: "delete", confirm: "owner@example.com" });
  assert.equal(down.statusCode, 503);
  assert.equal(down.json().error, "unavailable");

  const { calls } = route({
    "GET db.example/auth/v1/user": AUTH_OK,
    "GET db.example/rest/v1/subscriptions": reply(500, "boom"),
  });
  const failed = await call("account.js", { action: "delete", confirm: "owner@example.com" });
  assert.equal(failed.statusCode, 502);
  assert.equal(failed.json().error, "server");
  assert.ok(!calls.some((c) => c.startsWith("DELETE")), "nothing is deleted when the plan can't be read");
});

test("delete account: a plan already cancelled in Stripe (or gone) is fine; any other Stripe refusal stops the deletion", async () => {
  setEnv();
  const row = { owner_id: USER, status: "active", stripe_subscription_id: "sub_1" };
  // Stripe says it's already cancelled: carry on.
  for (const message of ["No such subscription: 'sub_1'", "This subscription has already been canceled"]) {
    const { calls } = route({
      "GET db.example/auth/v1/user": AUTH_OK,
      "GET db.example/rest/v1/subscriptions": reply(200, [row]),
      "DELETE api.stripe.com/v1/subscriptions/sub_1": reply(404, { error: { message } }),
      ["DELETE db.example/auth/v1/admin/users/" + USER]: reply(200, {}),
    });
    const ok = await call("account.js", { action: "delete", confirm: "owner@example.com" });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.ok(calls.includes("DELETE db.example/auth/v1/admin/users/" + USER));
  }
  // Already ended on our side: Stripe isn't even asked.
  for (const status of ["canceled", "incomplete_expired"]) {
    const { calls } = route({
      "GET db.example/auth/v1/user": AUTH_OK,
      "GET db.example/rest/v1/subscriptions": reply(200, [{ ...row, status }]),
      ["DELETE db.example/auth/v1/admin/users/" + USER]: reply(200, {}),
    });
    assert.equal((await call("account.js", { action: "delete", confirm: "owner@example.com" })).statusCode, 200);
    assert.ok(!calls.some((c) => c.includes("api.stripe.com")));
  }
  // Without a Stripe key nothing can be cancelled, so the user is deleted alone.
  delete process.env.STRIPE_SECRET_KEY;
  {
    const { calls } = route({
      "GET db.example/auth/v1/user": AUTH_OK,
      "GET db.example/rest/v1/subscriptions": reply(200, [row]),
      ["DELETE db.example/auth/v1/admin/users/" + USER]: reply(200, {}),
    });
    assert.equal((await call("account.js", { action: "delete", confirm: "owner@example.com" })).statusCode, 200);
    assert.ok(!calls.some((c) => c.includes("api.stripe.com")));
  }
  setEnv();
});

test("delete account: a user already gone from Supabase Auth counts as deleted; any other auth failure is 502 server", async () => {
  setEnv();
  route({
    "GET db.example/auth/v1/user": AUTH_OK,
    "GET db.example/rest/v1/subscriptions": reply(200, []),
    ["DELETE db.example/auth/v1/admin/users/" + USER]: reply(404, { message: "User not found" }),
  });
  const gone = await call("account.js", { action: "delete", confirm: "owner@example.com" });
  assert.equal(gone.statusCode, 200);
  assert.deepEqual(gone.json(), { deleted: true });

  route({
    "GET db.example/auth/v1/user": AUTH_OK,
    "GET db.example/rest/v1/subscriptions": reply(200, []),
    ["DELETE db.example/auth/v1/admin/users/" + USER]: reply(500, { message: "oops" }),
  });
  const failed = await call("account.js", { action: "delete", confirm: "owner@example.com" });
  assert.equal(failed.statusCode, 502);
  assert.equal(failed.json().error, "server");

  // The body may arrive as a form post, not JSON.
  route({
    "GET db.example/auth/v1/user": AUTH_OK,
    "GET db.example/rest/v1/subscriptions": reply(200, []),
    ["DELETE db.example/auth/v1/admin/users/" + USER]: reply(200, {}),
  });
  const res = fakeRes();
  await require("../../api/account.js")(
    {
      method: "POST",
      body: "action=delete&confirm=Owner%40example.com",
      query: {},
      headers: { authorization: "Bearer good", "content-type": "application/x-www-form-urlencoded" },
    },
    res,
  );
  assert.equal(res.statusCode, 200, res.body);
});
