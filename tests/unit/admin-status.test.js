"use strict";

// api/admin-status.js: who may read the status, its JSON shape, and that a
// missing Stripe key or an unreachable database turns the matching rows (and
// overall) Down. All upstream calls are stubbed; nothing leaves the machine.

const test = require("node:test");
const assert = require("node:assert/strict");

const handler = require("../../api/admin-status.js");
const switches = require("../../api/_switches.js");

const VARS = [
  "ADMIN_STATUS_TOKEN",
  "ADMIN_EMAILS",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_STARTER",
  "ALERT_EMAIL",
  "RESEND_API_KEY",
  "VERCEL_GIT_COMMIT_SHA",
];
const TIERS = ["important", "key", "basic"];

function json(status, body) {
  return {
    ok: status < 400,
    status,
    headers: new Headers(),
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

// Healthy upstreams; `dead` is a host fragment that refuses connections, and
// `run` the latest GitHub Actions run.
function upstream(dead, run) {
  return async (url) => {
    const u = String(url);
    if (dead && u.includes(dead)) throw new Error("connect ECONNREFUSED");
    if (u.includes("/rest/v1/")) return json(200, []);
    if (u.includes("/auth/v1/settings")) return json(200, { external: { email: true } });
    if (u.includes("/auth/v1/health")) return json(200, { ok: true });
    if (u.includes("api.stripe.com/v1/balance")) return json(200, { object: "balance" });
    if (u.includes("api.stripe.com/v1/events")) return json(200, { data: [{ created: 1760000000 }] });
    if (u.includes("api.resend.com")) return json(200, { data: [] });
    if (u.includes("api.github.com")) return json(200, { workflow_runs: [run] });
    return json(404, {});
  };
}

async function call(headers, { dead, env = {}, run } = {}) {
  const saved = VARS.map((k) => process.env[k]);
  const realFetch = global.fetch;
  const realError = console.error;
  VARS.forEach((k) => delete process.env[k]);
  Object.assign(
    process.env,
    {
      SUPABASE_URL: "https://db.example.test",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      STRIPE_SECRET_KEY: "sk_test_x",
      STRIPE_WEBHOOK_SECRET: "whsec_x",
      STRIPE_PRICE_STARTER: "price_x",
      ALERT_EMAIL: "a@example.test",
      RESEND_API_KEY: "re_x",
      ADMIN_STATUS_TOKEN: "secret-token",
      VERCEL_GIT_COMMIT_SHA: "0123456789abcdef",
    },
    env,
  );
  Object.keys(env).forEach((k) => env[k] === undefined && delete process.env[k]);
  global.fetch = upstream(dead, run || { conclusion: "success", updated_at: new Date().toISOString() });
  console.error = () => {};
  switches.resetCache();
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
  try {
    await handler({ method: "GET", url: "/admin/status.json", headers }, res);
  } finally {
    VARS.forEach((k, i) => {
      if (saved[i] === undefined) delete process.env[k];
      else process.env[k] = saved[i];
    });
    global.fetch = realFetch;
    console.error = realError;
    switches.resetCache();
  }
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

const AUTH = { authorization: "Bearer secret-token" };
const row = (body, name) => body.functions.find((f) => f.name.startsWith(name));

test("without a sign-in the status is refused", async () => {
  assert.equal((await call({})).status, 401);
  assert.equal((await call({ authorization: "Bearer wrong" })).status, 401);
});

test("with neither a token nor admin emails set, the route does not exist", async () => {
  const r = await call({}, { env: { ADMIN_STATUS_TOKEN: undefined } });
  assert.equal(r.status, 404);
});

test("the bearer token returns the documented shape, three groups in order, all OK", async () => {
  const r = await call(AUTH);
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body), ["product", "checked_at", "overall", "functions"]);
  assert.deepEqual(
    r.body.functions.filter((f) => f.status !== "ok").map((f) => f.name + ": " + f.detail),
    [],
  );
  assert.equal(r.body.overall, "ok");
  const order = r.body.functions.map((f) => TIERS.indexOf(f.tier));
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
  );
  assert.deepEqual([...new Set(r.body.functions.map((f) => f.tier))], TIERS);
  for (const f of r.body.functions) {
    assert.deepEqual(Object.keys(f), [
      "tier",
      "name",
      "status",
      "last_checked",
      "last_success",
      "next_expected_run",
      "detail",
    ]);
    if (f.status !== "ok") assert.fail(f.name + ": " + f.detail);
  }
  assert.ok(row(r.body, "Daily backup").next_expected_run);
});

test("an unset STRIPE_SECRET_KEY turns Stripe checkout Down and overall down", async () => {
  const r = await call(AUTH, { env: { STRIPE_SECRET_KEY: undefined } });
  assert.equal(row(r.body, "Stripe checkout").status, "down");
  assert.match(row(r.body, "Stripe checkout").detail, /Check the Stripe keys/);
  assert.equal(row(r.body, "Stripe API").status, "down");
  assert.equal(r.body.overall, "down");
});

test("a database host that does not answer turns the database rows Down and overall down", async () => {
  const r = await call(AUTH, { dead: "db.example.test" });
  assert.equal(row(r.body, "Database query").status, "down");
  assert.equal(row(r.body, "Saving and loading").status, "down");
  assert.equal(r.body.overall, "down");
});

test("a failed backup run is Down in Key, a stale one is a Warning, and overall stays ok", async () => {
  const failed = await call(AUTH, { run: { conclusion: "failure", updated_at: new Date().toISOString() } });
  assert.equal(row(failed.body, "Daily backup").status, "down");
  assert.equal(failed.body.overall, "ok");
  const old = new Date(Date.now() - 50 * 3600 * 1000).toISOString();
  const stale = await call(AUTH, { run: { conclusion: "success", updated_at: old } });
  assert.equal(row(stale.body, "Daily backup").status, "warning");
  assert.ok(row(stale.body, "Daily backup").last_success);
});
