"use strict";

// api/stripe-webhook.js, branch by branch, against a stand-in fetch for
// Stripe and Supabase: the request checks (method, configuration, signature,
// body), each event type it records and the ones it acknowledges without
// touching anything, what it writes for a price that doesn't name its plan,
// a subscription whose owner deleted their account, and a Supabase failure
// (a 500, so Stripe retries). The happy path for an out-of-order event is in
// leads-webhook.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const OWNER = "11111111-1111-4111-8111-111111111111";
const SECRET = "whsec_test";

function setEnv() {
  process.env.SUPABASE_URL = "https://db.example";
  process.env.SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
}

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

function sign(raw, secret = SECRET, t = Math.floor(Date.now() / 1000)) {
  const sig = crypto
    .createHmac("sha256", secret)
    .update(t + "." + raw)
    .digest("hex");
  return `t=${t},v1=${sig}`;
}

// A request whose body streams like Vercel's (no pre-parsed req.body).
function request(raw, headers = { "stripe-signature": sign(raw) }, method = "POST") {
  const req = (async function* () {
    if (raw) yield Buffer.from(raw);
  })();
  req.method = method;
  req.headers = headers;
  return req;
}

async function post(raw, headers, method) {
  const res = fakeRes();
  await require("../../api/stripe-webhook.js")(request(raw, headers, method), res);
  return res;
}

// Stripe answers GET /v1/subscriptions/<id> with `subs[id]` (a DELETE
// cancels it: status canceled from then on); Supabase's read of the
// account's row answers `rows`, and its upsert answers `upsert` (a status,
// or a function of the row). Records every call.
function stubFetch({ subs = {}, upsert = 201, rows = [] } = {}) {
  const calls = { stripe: [], saved: [], cancelled: [] };
  global.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const method = opts.method || "GET";
    if (u.host === "api.stripe.com") {
      calls.stripe.push((method === "GET" ? "" : method + " ") + u.pathname);
      const m = /^\/v1\/subscriptions\/(.+)$/.exec(u.pathname);
      const sub = m && subs[decodeURIComponent(m[1])];
      if (sub && method === "DELETE") {
        calls.cancelled.push(sub.id);
        sub.status = "canceled";
        return reply(200, sub);
      }
      return sub
        ? reply(200, sub)
        : reply(404, { error: { message: "No such subscription: " + (m ? m[1] : u.pathname) } });
    }
    if (u.host === "db.example" && u.pathname === "/rest/v1/subscriptions" && method === "GET") {
      return reply(200, rows);
    }
    if (u.host === "db.example" && u.pathname === "/rest/v1/subscriptions") {
      const row = JSON.parse(opts.body);
      calls.saved.push({ row, query: u.search, prefer: opts.headers.Prefer });
      const answer = typeof upsert === "function" ? upsert(row) : upsert;
      return typeof answer === "number" ? reply(answer) : reply(answer.status, answer.body);
    }
    return reply(404, { message: "unexpected " + u.href });
  };
  return calls;
}

function event(type, object) {
  return JSON.stringify({ id: "evt_1", type, data: { object } });
}

const PRO_SUB = {
  id: "sub_pro",
  customer: "cus_1",
  status: "active",
  cancel_at_period_end: false,
  metadata: { owner_id: OWNER },
  items: { data: [{ price: { id: "price_pro", lookup_key: "pro" }, current_period_end: 1900000000 }] },
};

test("webhook: only POST, and only once Supabase and the signing secret are configured", async () => {
  setEnv();
  const calls = stubFetch();
  const get = await post("", {}, "GET");
  assert.equal(get.statusCode, 405);
  assert.equal(get.headers.allow, "POST");
  assert.equal(get.json().error, "method");

  delete process.env.STRIPE_WEBHOOK_SECRET;
  const noSecret = await post(event("customer.subscription.created", { id: "sub_pro" }));
  assert.equal(noSecret.statusCode, 503);
  assert.equal(noSecret.json().error, "not-configured");

  setEnv();
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const noDb = await post(event("customer.subscription.created", { id: "sub_pro" }));
  assert.equal(noDb.statusCode, 503);
  assert.equal(noDb.json().error, "not-configured");
  assert.equal(calls.stripe.length + calls.saved.length, 0);
});

test("webhook: a missing, wrong, stale or tampered signature is refused before anything is read", async () => {
  setEnv();
  const calls = stubFetch({ subs: { sub_pro: PRO_SUB } });
  const raw = event("customer.subscription.created", { id: "sub_pro" });
  const cases = [
    ["no header", {}],
    ["header without v1", { "stripe-signature": "t=" + Math.floor(Date.now() / 1000) }],
    ["another endpoint's secret", { "stripe-signature": sign(raw, "whsec_other") }],
    ["an hour old", { "stripe-signature": sign(raw, SECRET, Math.floor(Date.now() / 1000) - 3600) }],
    ["body changed after signing", { "stripe-signature": sign(raw + " ") }],
  ];
  for (const [name, headers] of cases) {
    const res = await post(raw, headers);
    assert.equal(res.statusCode, 400, name);
    assert.equal(res.json().error, "signature", name);
  }
  assert.equal(calls.stripe.length, 0);
  assert.equal(calls.saved.length, 0);
});

test("webhook: a signed body that isn't JSON is a 400, not a retry", async () => {
  setEnv();
  const calls = stubFetch();
  const res = await post("{not json");
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "body");
  assert.equal(calls.stripe.length + calls.saved.length, 0);
});

test("webhook: event types it doesn't handle are acknowledged without a call to Stripe or Supabase", async () => {
  setEnv();
  const calls = stubFetch({ subs: { sub_pro: PRO_SUB } });
  for (const [type, object] of [
    ["invoice.paid", { id: "in_1", subscription: "sub_pro" }],
    ["customer.subscription.trial_will_end", { id: "sub_pro" }],
    ["customer.created", { id: "cus_1" }],
    ["payment_intent.succeeded", { id: "pi_1" }],
  ]) {
    const res = await post(event(type, object));
    assert.equal(res.statusCode, 200, type);
    assert.deepEqual(res.json(), { received: true }, type);
  }
  // A one-time payment's checkout is not a subscription either.
  const payment = await post(
    event("checkout.session.completed", { mode: "payment", client_reference_id: OWNER, subscription: null }),
  );
  assert.equal(payment.statusCode, 200);
  assert.deepEqual(payment.json(), { received: true });
  assert.equal(calls.stripe.length, 0);
  assert.equal(calls.saved.length, 0);
});

test("webhook: checkout.session.completed records the subscription for the account that bought it", async () => {
  setEnv();
  const calls = stubFetch({ subs: { sub_pro: PRO_SUB } });
  const res = await post(
    event("checkout.session.completed", { mode: "subscription", subscription: "sub_pro", client_reference_id: OWNER }),
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { received: true });
  assert.deepEqual(calls.stripe, ["/v1/subscriptions/sub_pro"]);
  assert.equal(calls.saved.length, 1);
  const { row, query, prefer } = calls.saved[0];
  // One row per account: the upsert merges on owner_id.
  assert.equal(query, "?on_conflict=owner_id");
  assert.match(prefer, /merge-duplicates/);
  assert.equal(row.owner_id, OWNER);
  assert.equal(row.stripe_customer_id, "cus_1");
  assert.equal(row.stripe_subscription_id, "sub_pro");
  assert.equal(row.status, "active");
  assert.equal(row.plan, "pro");
  assert.equal(row.price_id, "price_pro");
  assert.equal(row.current_period_end, new Date(1900000000 * 1000).toISOString());
  assert.equal(row.cancel_at_period_end, false);
  assert.ok(!Number.isNaN(Date.parse(row.updated_at)));
});

test("webhook: a checkout session without client_reference_id falls back to its owner_id metadata", async () => {
  setEnv();
  const calls = stubFetch({ subs: { sub_pro: PRO_SUB } });
  const res = await post(
    event("checkout.session.completed", {
      mode: "subscription",
      subscription: "sub_pro",
      metadata: { owner_id: OWNER },
    }),
  );
  assert.equal(res.statusCode, 200);
  assert.equal(calls.saved[0].row.owner_id, OWNER);
});

test("webhook: created, updated and deleted each record the subscription's current state", async () => {
  setEnv();
  for (const [type, status, cancelAtPeriodEnd] of [
    ["customer.subscription.created", "trialing", false],
    ["customer.subscription.updated", "past_due", true],
    ["customer.subscription.deleted", "canceled", false],
  ]) {
    const calls = stubFetch({
      subs: { sub_pro: { ...PRO_SUB, status, cancel_at_period_end: cancelAtPeriodEnd } },
    });
    // The event's own copy says "active": the row must follow Stripe's answer.
    const res = await post(event(type, { id: "sub_pro", status: "active", metadata: { owner_id: OWNER } }));
    assert.equal(res.statusCode, 200, type);
    assert.deepEqual(res.json(), { received: true }, type);
    assert.deepEqual(calls.stripe, ["/v1/subscriptions/sub_pro"], type);
    assert.equal(calls.saved.length, 1, type);
    assert.equal(calls.saved[0].row.status, status, type);
    assert.equal(calls.saved[0].row.cancel_at_period_end, cancelAtPeriodEnd, type);
    assert.equal(calls.saved[0].row.plan, "pro", type);
  }
});

test("webhook: the owner comes from the event when Stripe's copy of the subscription has no metadata", async () => {
  setEnv();
  const calls = stubFetch({ subs: { sub_pro: { ...PRO_SUB, metadata: {} } } });
  const res = await post(event("customer.subscription.updated", { id: "sub_pro", metadata: { owner_id: OWNER } }));
  assert.equal(res.statusCode, 200);
  assert.equal(calls.saved[0].row.owner_id, OWNER);
});

test("webhook: a subscription that names no owner is acknowledged and nothing is written", async () => {
  setEnv();
  const calls = stubFetch({ subs: { sub_pro: { ...PRO_SUB, metadata: {} } } });
  const res = await post(event("customer.subscription.updated", { id: "sub_pro" }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { received: true, ignored: "owner-gone" });
  assert.equal(calls.saved.length, 0);
});

test("webhook: a price that doesn't name its plan keeps the row's plan and records the price id", async () => {
  setEnv();
  const calls = stubFetch({
    subs: {
      sub_x: {
        ...PRO_SUB,
        id: "sub_x",
        // A customer object instead of an id, and the period end on the
        // item only (STRIPE_API_VERSION's shape).
        customer: { id: "cus_obj", object: "customer" },
        items: {
          data: [{ price: { id: "price_unknown", lookup_key: "legacy_monthly" }, current_period_end: 1900000000 }],
        },
      },
    },
  });
  const warned = [];
  const realWarn = console.warn;
  console.warn = (line) => warned.push(String(line));
  let res;
  try {
    res = await post(event("customer.subscription.updated", { id: "sub_x" }));
  } finally {
    console.warn = realWarn;
  }
  assert.equal(res.statusCode, 200);
  // Never silent: one warning names the price, the owner and the subscription.
  const warning = warned.map((l) => JSON.parse(l)).find((l) => l.error === "unmapped-price");
  assert.ok(warning, "an unmapped-price warning was logged");
  assert.equal(warning.priceId, "price_unknown");
  assert.equal(warning.ownerId, OWNER);
  assert.equal(warning.subscriptionId, "sub_x");
  const { row } = calls.saved[0];
  assert.equal(row.price_id, "price_unknown");
  // Not written at all, so a plan set by hand in the table isn't wiped
  // (undefined is dropped by JSON.stringify).
  assert.equal("plan" in row, false);
  assert.equal(row.stripe_customer_id, "cus_obj");
  assert.equal(row.current_period_end, new Date(1900000000 * 1000).toISOString());
});

test("webhook: a subscription with no items or period end records nulls rather than failing", async () => {
  setEnv();
  const calls = stubFetch({ subs: { sub_e: { ...PRO_SUB, id: "sub_e", items: undefined } } });
  const res = await post(event("customer.subscription.deleted", { id: "sub_e" }));
  assert.equal(res.statusCode, 200);
  const { row } = calls.saved[0];
  assert.equal(row.price_id, null);
  assert.equal(row.current_period_end, null);
  assert.equal("plan" in row, false);
});

test("webhook: an event for a deleted account is acknowledged (200) so Stripe stops retrying", async () => {
  setEnv();
  const calls = stubFetch({
    subs: { sub_pro: PRO_SUB },
    upsert: {
      status: 409,
      body: {
        code: "23503",
        message:
          'insert or update on table "subscriptions" violates foreign key constraint "subscriptions_owner_id_fkey"',
      },
    },
  });
  const warnings = [];
  const warn = console.warn;
  console.warn = (m) => warnings.push(String(m));
  try {
    const res = await post(event("customer.subscription.deleted", { id: "sub_pro" }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { received: true, ignored: "owner-gone" });
  } finally {
    console.warn = warn;
  }
  assert.equal(calls.saved.length, 1);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /sub_pro/);
  assert.match(warnings[0], new RegExp(OWNER));
});

test("webhook: when Supabase or Stripe fails for any other reason the answer is 500, so Stripe retries", async () => {
  setEnv();
  const errors = [];
  const error = console.error;
  console.error = (e) => errors.push(e);
  try {
    // Supabase down.
    const calls = stubFetch({ subs: { sub_pro: PRO_SUB }, upsert: { status: 500, body: { message: "db down" } } });
    const res = await post(event("customer.subscription.updated", { id: "sub_pro" }));
    assert.equal(res.statusCode, 500);
    assert.equal(res.json().error, "server");
    assert.equal(calls.saved.length, 1);

    // Stripe doesn't know the subscription (nothing is written).
    const none = stubFetch();
    const missing = await post(event("customer.subscription.updated", { id: "sub_gone" }));
    assert.equal(missing.statusCode, 500);
    assert.equal(missing.json().error, "server");
    assert.equal(none.saved.length, 0);

    // A subscription event with no data.object asks Stripe for
    // "subscriptions/undefined" and so is retried too (nothing is written).
    const noObject = await post(JSON.stringify({ type: "customer.subscription.updated" }));
    assert.equal(noObject.statusCode, 500);
    assert.deepEqual(none.stripe, ["/v1/subscriptions/sub_gone", "/v1/subscriptions/undefined"]);
    assert.equal(none.saved.length, 0);
  } finally {
    console.error = error;
  }
  assert.ok(errors.length >= 3, "each failure is logged");
});

// ------------------------------------------------- two Checkout tabs

function quietWarn(fn) {
  const warned = [];
  const realWarn = console.warn;
  console.warn = (line) => warned.push(String(line));
  return fn().then(
    (v) => {
      console.warn = realWarn;
      return { value: v, warned };
    },
    (e) => {
      console.warn = realWarn;
      throw e;
    },
  );
}

test("webhook: a second live subscription for the same account is cancelled (the newer one) and the older one kept", async () => {
  setEnv();
  const first = { ...PRO_SUB, id: "sub_first", created: 1000, customer: "cus_a" };
  const second = { ...PRO_SUB, id: "sub_second", created: 2000, customer: "cus_b" };
  // The first tab's webhook landed and was recorded; now the second tab's.
  const calls = stubFetch({
    subs: { sub_first: first, sub_second: second },
    rows: [{ stripe_subscription_id: "sub_first", status: "active" }],
  });
  const { value: res, warned } = await quietWarn(() =>
    post(
      event("checkout.session.completed", {
        mode: "subscription",
        subscription: "sub_second",
        client_reference_id: OWNER,
      }),
    ),
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.cancelled, ["sub_second"]);
  assert.ok(calls.stripe.includes("/v1/subscriptions/sub_first"), "the one on file was checked with Stripe");
  // The account keeps the older one: that's what the row says.
  assert.equal(calls.saved.length, 1);
  assert.equal(calls.saved[0].row.stripe_subscription_id, "sub_first");
  assert.equal(calls.saved[0].row.status, "active");
  const line = warned.map((l) => JSON.parse(l)).find((l) => l.error === "duplicate-subscription");
  assert.ok(line, "one log line names the duplicate");
  assert.equal(line.kept, "sub_first");
  assert.equal(line.cancelled, "sub_second");
  assert.equal(line.ownerId, OWNER);
});

test("webhook: when the event is for the older subscription, the newer one on file is the one cancelled", async () => {
  setEnv();
  const first = { ...PRO_SUB, id: "sub_first", created: 1000 };
  const second = { ...PRO_SUB, id: "sub_second", created: 2000 };
  // Events out of order: the second tab's was recorded first.
  const calls = stubFetch({
    subs: { sub_first: first, sub_second: second },
    rows: [{ stripe_subscription_id: "sub_second", status: "trialing" }],
  });
  const { value: res } = await quietWarn(() => post(event("customer.subscription.created", { id: "sub_first" })));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.cancelled, ["sub_second"]);
  assert.equal(calls.saved[0].row.stripe_subscription_id, "sub_first");
});

test("webhook: a different subscription on file that Stripe no longer runs (or never heard of) is no duplicate", async () => {
  setEnv();
  // Cancelled in Stripe, the row not yet updated: the new one is recorded, nothing cancelled.
  let calls = stubFetch({
    subs: { sub_old: { ...PRO_SUB, id: "sub_old", status: "canceled" }, sub_new: { ...PRO_SUB, id: "sub_new" } },
    rows: [{ stripe_subscription_id: "sub_old", status: "active" }],
  });
  let res = await post(event("customer.subscription.created", { id: "sub_new" }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.cancelled, []);
  assert.equal(calls.saved[0].row.stripe_subscription_id, "sub_new");
  // Gone from Stripe altogether (404): the same.
  calls = stubFetch({
    subs: { sub_new: { ...PRO_SUB, id: "sub_new" } },
    rows: [{ stripe_subscription_id: "sub_gone", status: "active" }],
  });
  res = await post(event("customer.subscription.created", { id: "sub_new" }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.cancelled, []);
  assert.equal(calls.saved[0].row.stripe_subscription_id, "sub_new");
  // The row's own status isn't live (a plan that ended, then a new purchase): no Stripe check at all.
  calls = stubFetch({
    subs: { sub_new: { ...PRO_SUB, id: "sub_new" } },
    rows: [{ stripe_subscription_id: "sub_ended", status: "canceled" }],
  });
  res = await post(event("customer.subscription.created", { id: "sub_new" }));
  assert.equal(res.statusCode, 200);
  assert.ok(!calls.stripe.includes("/v1/subscriptions/sub_ended"));
  assert.equal(calls.saved[0].row.stripe_subscription_id, "sub_new");
  // The same subscription again (an update), or one that isn't live: recorded as is.
  calls = stubFetch({
    subs: { sub_pro: { ...PRO_SUB, status: "canceled" } },
    rows: [{ stripe_subscription_id: "sub_other", status: "active" }],
  });
  res = await post(event("customer.subscription.deleted", { id: "sub_pro" }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.cancelled, []);
  assert.equal(calls.saved[0].row.status, "canceled");
});
