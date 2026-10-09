"use strict";

// The kill switch (api/_switches.js) and the API's behaviour when Supabase or
// Stripe fail: every answer is JSON with the documented error, a Supabase
// Auth outage is "unavailable" (not "sign in"), a webhook for a deleted
// account is acknowledged, a second subscription is refused, and Stripe
// calls carry a pinned version and idempotency keys.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Plan = require("../../js/room-plan.js");
const Switches = require("../../api/_switches.js");

const USER = "11111111-1111-4111-8111-111111111111";
const DESIGN = Plan.encode(Plan.fromTemplate("full5x8", null));

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
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  process.env.STRIPE_PRICE_STARTER = "price_s";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  delete process.env.PROMO_CODES;
  Switches.resetCache();
}

// A stand-in for Supabase and Stripe. opts.switches: the site_switches row
// (undefined = the table doesn't exist). opts.sub: the user's subscriptions
// row. opts.stripeCustomers: what GET /v1/customers answers. opts.authDown:
// /auth/v1/user answers 503. opts.authThrows: the network fails.
function setup(opts = {}) {
  setEnv();
  const calls = [];
  global.fetch = async (url, o = {}) => {
    const u = new URL(url);
    const method = o.method || "GET";
    calls.push({ method, url: u.host + u.pathname + u.search, headers: o.headers || {}, body: o.body });
    if (u.pathname === "/auth/v1/user") {
      if (opts.authThrows) throw new TypeError("fetch failed");
      if (opts.authDown) return reply(503, { message: "down" });
      return o.headers.Authorization === "Bearer good"
        ? reply(200, { id: USER, email: "o@example.com" })
        : reply(401, {});
    }
    if (u.pathname === "/rest/v1/site_switches") {
      if (opts.switches === undefined) {
        return reply(404, { code: "PGRST205", message: "Could not find the table 'public.site_switches'" });
      }
      return reply(200, [opts.switches]);
    }
    if (u.pathname === "/rest/v1/subscriptions" && method === "GET") return reply(200, opts.sub ? [opts.sub] : []);
    if (u.pathname === "/rest/v1/subscriptions" && method === "POST") {
      if (opts.ownerGone) {
        return reply(409, {
          code: "23503",
          message: 'insert or update on table "subscriptions" violates foreign key constraint',
        });
      }
      return reply(201);
    }
    if (u.pathname === "/rest/v1/project_creations" || u.pathname === "/rest/v1/projects") return reply(200, []);
    if (u.pathname === "/rest/v1/rpc/create_project") {
      return reply(200, { project: { id: "p1", name: "x" }, month: 1, total: 1 });
    }
    if (u.host === "api.stripe.com") {
      if (u.pathname === "/v1/customers") return reply(200, { data: opts.stripeCustomers || [] });
      if (/^\/v1\/customers\/cus_/.test(u.pathname)) return reply(200, opts.stripeCustomer || { id: "cus_1" });
      if (/^\/v1\/subscriptions\/sub_/.test(u.pathname)) {
        return reply(200, {
          id: "sub_1",
          customer: "cus_1",
          status: "canceled",
          metadata: { owner_id: USER },
          items: { data: [{ price: { id: "price_s", lookup_key: "starter" }, current_period_end: 1900000000 }] },
        });
      }
      return reply(200, { id: "cs_1", url: "https://checkout.stripe.com/x" });
    }
    return reply(404, { message: "unexpected " + method + " " + u.pathname });
  };
  return calls;
}

async function call(file, method, body, token = "good", query = {}) {
  const res = fakeRes();
  await require("../../api/" + file)({ method, body, query, headers: { authorization: "Bearer " + token } }, res);
  return res;
}

test("kill switch: with the table missing or a database failure every switch is on; the row is cached", async () => {
  setup();
  assert.deepEqual(await Switches.switches(), { signups: true, checkout: true, saving: true, notice: "" });
  const calls = setup({ switches: { signups: false, checkout: true, saving: false, notice: "Back Monday" } });
  const s = await Switches.switches();
  assert.deepEqual(s, { signups: false, checkout: true, saving: false, notice: "Back Monday" });
  assert.equal(await Switches.isOff("saving"), true);
  assert.equal(await Switches.isOff("checkout"), false);
  assert.equal(calls.filter((c) => c.url.includes("site_switches")).length, 1, "read once, then cached");
  // After the cache window the row is read again.
  const later = await Switches.switches(Date.now() + Switches.SWITCH_CACHE_MS + 1);
  assert.equal(later.signups, false);
  assert.equal(calls.filter((c) => c.url.includes("site_switches")).length, 2);
  // A broken database leaves the switches on (the switch is for stopping on purpose).
  setEnv();
  global.fetch = async () => reply(500, { message: "boom" });
  assert.equal((await Switches.switches()).saving, true);
});

test("kill switch: /api/config reports the switches and notice; checkout and saving refuse with 503 paused", async () => {
  setup({ switches: { signups: false, checkout: false, saving: false, notice: "Maintenance" } });
  const cfg = fakeRes();
  await require("../../api/config.js")({ headers: {} }, cfg);
  assert.deepEqual(cfg.json().switches, { signups: false, checkout: false, saving: false });
  assert.equal(cfg.json().notice, "Maintenance");

  const checkout = await call("checkout.js", "POST", { plan: "starter" });
  assert.equal(checkout.statusCode, 503);
  assert.deepEqual(checkout.json(), { error: "paused", switch: "checkout", notice: "Maintenance" });

  const save = await call("projects.js", "POST", { name: "Bath", design: DESIGN });
  assert.equal(save.statusCode, 503);
  assert.equal(save.json().error, "paused");
  assert.equal(save.json().switch, "saving");
  const resave = await call("projects.js", "PATCH", { id: "00000000-0000-4000-8000-000000000001", design: DESIGN });
  assert.equal(resave.statusCode, 503);
  assert.equal(resave.json().error, "paused");
  // Reading and renaming still work while saving is paused.
  const list = await call("projects.js", "GET");
  assert.equal(list.statusCode, 200);
  const rename = await call("projects.js", "PATCH", { id: "00000000-0000-4000-8000-000000000001", name: "New" });
  assert.notEqual(rename.statusCode, 503);

  // Switched back on: checkout goes through.
  setup({ switches: { signups: true, checkout: true, saving: true, notice: "" } });
  assert.equal((await call("checkout.js", "POST", { plan: "starter" })).statusCode, 200);
});

test("a Supabase Auth outage answers 503 unavailable (JSON), never 'sign in' or a crash", async () => {
  for (const opts of [{ authDown: true }, { authThrows: true }]) {
    setup(opts);
    for (const [file, method, body] of [
      ["projects.js", "GET"],
      ["projects.js", "POST", { name: "Bath", design: DESIGN }],
      ["checkout.js", "POST", { plan: "starter" }],
      ["portal.js", "POST", {}],
      ["account.js", "POST", { action: "delete", confirm: "o@example.com" }],
    ]) {
      const res = await call(file, method, body);
      assert.equal(res.statusCode, 503, file + " " + JSON.stringify(opts));
      assert.equal(res.json().error, "unavailable", file);
      // The request id the log line carries, so the person can quote it.
      assert.match(res.json().requestId, /^[0-9a-f-]{36}$/, file);
      assert.match(res.headers["content-type"], /json/);
    }
  }
  // No token is still "sign in".
  setup();
  assert.equal((await call("projects.js", "GET", undefined, "bad")).json().error, "signin");
});

test("a database that fails or hangs answers 502 server (JSON) within the timeout", async () => {
  setup();
  const lib = require("../../api/_lib.js");
  global.fetch = async (url) => {
    const u = new URL(url);
    if (u.pathname === "/auth/v1/user") return reply(200, { id: USER, email: "o@example.com" });
    if (u.pathname === "/rest/v1/site_switches") return reply(200, []);
    throw new TypeError("fetch failed");
  };
  for (const [file, method, body] of [
    ["projects.js", "GET"],
    ["checkout.js", "POST", { plan: "starter" }],
    ["portal.js", "POST", {}],
    ["account.js", "POST", { action: "delete", confirm: "o@example.com" }],
  ]) {
    const res = await call(file, method, body);
    assert.equal(res.statusCode, 502, file);
    assert.equal(res.json().error, "server", file);
  }
  // The timeout itself: fetch honours the abort signal.
  global.fetch = (url, o) =>
    new Promise((_, reject) => {
      o.signal.addEventListener("abort", () => reject(o.signal.reason));
    });
  const started = Date.now();
  await assert.rejects(lib.fetchWithTimeout("https://db.example/x", {}, 30), (e) => e.upstream === true);
  assert.ok(Date.now() - started < 2000);
});

test("Stripe calls are pinned to one API version and create calls carry an idempotency key", async () => {
  const calls = setup();
  const lib = require("../../api/_lib.js");
  assert.equal((await call("checkout.js", "POST", { plan: "starter" })).statusCode, 200);
  const stripeCalls = calls.filter((c) => c.url.startsWith("api.stripe.com"));
  assert.ok(stripeCalls.length >= 2, "asks Stripe about existing subscriptions, then creates the session");
  for (const c of stripeCalls) assert.equal(c.headers["Stripe-Version"], lib.STRIPE_API_VERSION);
  const session = stripeCalls.find((c) => c.url.includes("/v1/checkout/sessions"));
  assert.match(session.headers["Idempotency-Key"], /^[0-9a-f]{64}$/);
  // The same request again, right away, reuses the key; a different plan doesn't.
  setup();
  const again = setup();
  await call("checkout.js", "POST", { plan: "starter" });
  const second = again.find((c) => c.url.includes("/v1/checkout/sessions"));
  assert.equal(second.headers["Idempotency-Key"], session.headers["Idempotency-Key"]);
  const other = setup();
  process.env.STRIPE_PRICE_PRO = "price_p";
  await call("checkout.js", "POST", { plan: "pro" });
  assert.notEqual(
    other.find((c) => c.url.includes("/v1/checkout/sessions")).headers["Idempotency-Key"],
    second.headers["Idempotency-Key"],
  );
  delete process.env.STRIPE_PRICE_PRO;
  // GET with params goes in the query string, no body.
  const customers = stripeCalls.find((c) => c.url.includes("/v1/customers"));
  assert.match(customers.url, /email=o%40example\.com/);
  assert.equal(customers.body, undefined);
});

test("checkout: a subscription Stripe still runs blocks a second one, even before its webhook arrives", async () => {
  // No row yet (first webhook lagging), but Stripe already has a trialing subscription for the email.
  const live = {
    id: "sub_live",
    customer: "cus_9",
    status: "trialing",
    metadata: { owner_id: USER },
    items: { data: [{ price: { id: "price_s", lookup_key: "starter" }, current_period_end: 1900000000 }] },
  };
  let calls = setup({ stripeCustomers: [{ id: "cus_9", subscriptions: { data: [live] } }] });
  const res = await call("checkout.js", "POST", { plan: "starter" });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error, "already-subscribed");
  assert.ok(!calls.some((c) => c.url.includes("/v1/checkout/sessions")), "no session was made");
  const recorded = calls.find((c) => c.url.includes("/rest/v1/subscriptions") && c.method === "POST");
  assert.ok(recorded, "the subscription is recorded without waiting for the webhook");
  assert.equal(JSON.parse(recorded.body).stripe_subscription_id, "sub_live");
  assert.equal(JSON.parse(recorded.body).status, "trialing");

  // A customer on file whose subscription was cancelled: a new plan is fine.
  calls = setup({
    sub: { owner_id: USER, status: "canceled", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_old" },
    stripeCustomer: { id: "cus_1", subscriptions: { data: [{ id: "sub_old", status: "canceled" }] } },
  });
  assert.equal((await call("checkout.js", "POST", { plan: "starter" })).statusCode, 200);
  assert.ok(calls.some((c) => c.url.includes("/v1/customers/cus_1")));

  // The row says past_due (still billing): refused without asking Stripe.
  calls = setup({ sub: { owner_id: USER, status: "past_due", stripe_customer_id: "cus_1" } });
  assert.equal((await call("checkout.js", "POST", { plan: "starter" })).json().error, "already-subscribed");
  assert.ok(!calls.some((c) => c.url.startsWith("api.stripe.com")));
});

test("webhook: an event for a deleted account is acknowledged with 200 and ignored", async () => {
  setup({ ownerGone: true });
  const raw = JSON.stringify({
    type: "customer.subscription.deleted",
    data: { object: { id: "sub_1", status: "canceled", metadata: { owner_id: USER }, items: { data: [] } } },
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
  const warnings = [];
  const warn = console.warn;
  console.warn = (m) => warnings.push(String(m));
  try {
    await require("../../api/stripe-webhook.js")(req, res);
  } finally {
    console.warn = warn;
  }
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { received: true, ignored: "owner-gone" });
  assert.ok(warnings.some((w) => w.includes("deleted account")));
});

test("the upstream time limit covers the body too: headers that arrive and a body that never does give 502", async () => {
  setup();
  const lib = require("../../api/_lib.js");
  // Headers at once, then a body that only ends when the request is aborted.
  global.fetch = async (url, o) => ({
    ok: true,
    status: 200,
    text: () =>
      new Promise((_, reject) => {
        o.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      }),
    json: () => new Promise(() => {}),
  });
  const started = Date.now();
  const res = await lib.fetchWithTimeout("https://db.example/rest/v1/x", {}, 40);
  await assert.rejects(res.text(), (e) => e.upstream === true && /timeout/.test(e.message));
  assert.ok(Date.now() - started < 2000);
});

test("kill switch: the row is read with a short time limit, and a hung database keeps the last reading", async () => {
  setup({ switches: { signups: true, checkout: false, saving: true, notice: "Checkout back tonight" } });
  assert.equal((await Switches.switches()).checkout, false);
  // Now the database hangs: fetch only ends when the (short) timer aborts it.
  const timeouts = [];
  global.fetch = (url, o) =>
    new Promise((_, reject) => {
      o.signal.addEventListener("abort", () => {
        timeouts.push(Date.now());
        reject(o.signal.reason);
      });
    });
  const errors = [];
  const error = console.error;
  console.error = (m) => errors.push(String(m));
  const started = Date.now();
  let s;
  try {
    s = await Switches.switches(Date.now() + Switches.SWITCH_CACHE_MS + 1);
  } finally {
    console.error = error;
  }
  const took = Date.now() - started;
  assert.ok(took >= Switches.SWITCH_READ_MS - 50 && took < Switches.SWITCH_READ_MS + 1000, "took " + took + " ms");
  assert.ok(Switches.SWITCH_READ_MS <= 2000, "well under the 8 s general limit");
  // The owner's pause survives the outage; nothing fails open.
  assert.equal(s.checkout, false);
  assert.equal(s.notice, "Checkout back tonight");
  assert.ok(
    errors.some((m) => /"error":"switches"/.test(m) && /requestId/.test(m)),
    "the failure is logged",
  );
  // /api/config answers from the same reading, right away.
  const cfg = fakeRes();
  const t0 = Date.now();
  await require("../../api/config.js")({ headers: {} }, cfg);
  assert.ok(Date.now() - t0 < 500);
  assert.equal(cfg.json().switches.checkout, false);
});

test("checkout: the idempotency key changes with the language and the promo code, not just the plan", async () => {
  const key = (calls) => calls.find((c) => c.url.includes("/v1/checkout/sessions")).headers["Idempotency-Key"];
  let calls = setup();
  await call("checkout.js", "POST", { plan: "starter" });
  const en = key(calls);
  calls = setup();
  await call("checkout.js", "POST", { plan: "starter", lang: "es" });
  const es = key(calls);
  calls = setup();
  await call("checkout.js", "POST", { plan: "starter", promo: "FREEWEEK" });
  const promo = key(calls);
  calls = setup();
  await call("checkout.js", "POST", { plan: "starter" });
  assert.equal(key(calls), en, "the same request reuses the key");
  assert.notEqual(es, en, "a Spanish return address is a different session");
  assert.notEqual(promo, en, "a promo code is a different session");
});

test("API failures are logged as one JSON line with the route, request id, user id and error word", async () => {
  setup();
  global.fetch = async (url) => {
    const u = new URL(url);
    if (u.pathname === "/auth/v1/user") return reply(200, { id: USER, email: "o@example.com" });
    if (u.pathname === "/rest/v1/site_switches") return reply(200, []);
    return reply(500, { message: "boom" });
  };
  const lines = [];
  const error = console.error;
  console.error = (m) => lines.push(String(m));
  let res;
  try {
    const fake = fakeRes();
    await require("../../api/projects.js")(
      {
        method: "GET",
        query: {},
        url: "/api/projects?x=1",
        headers: { authorization: "Bearer good", "x-vercel-id": "iad1::abc" },
      },
      fake,
    );
    res = fake;
  } finally {
    console.error = error;
  }
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().error, "server");
  assert.equal(res.json().requestId, "iad1::abc", "the body carries the request id");
  const line = lines
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .find(Boolean);
  assert.ok(line, "a JSON log line");
  assert.equal(line.route, "/api/projects");
  assert.equal(line.requestId, "iad1::abc");
  assert.equal(line.userId, USER);
  assert.equal(line.error, "server");
  assert.match(line.message, /Supabase 500/);
});

test("a subscription on a price that maps to no plan gets Starter and is logged, never silently", async () => {
  setEnv();
  const { planOf } = require("../../api/_plans.js");
  const warnings = [];
  const warn = console.warn;
  console.warn = (m) => warnings.push(String(m));
  try {
    assert.equal(planOf({ status: "active", price_id: "price_s", owner_id: USER }), "starter");
    assert.equal(warnings.length, 0, "a Starter price is mapped, nothing to say");
    assert.equal(
      planOf({ status: "active", price_id: "price_mystery", owner_id: USER, stripe_subscription_id: "sub_9" }),
      "starter",
    );
    assert.equal(warnings.length, 1);
    const line = JSON.parse(warnings[0]);
    assert.equal(line.error, "unmapped-plan");
    assert.equal(line.priceId, "price_mystery");
    assert.equal(line.ownerId, USER);
    assert.equal(planOf({ status: "active", price_id: "price_mystery", plan: "max" }), "max");
    assert.equal(warnings.length, 1, "a hand-set plan needs no warning");
  } finally {
    console.warn = warn;
  }
});
