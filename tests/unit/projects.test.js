"use strict";

// api/projects.js and api/_plans.js against a stand-in Supabase: fetch is
// replaced by a tiny in-memory version of the auth, REST and create_project()
// calls the API makes. The SQL function itself mirrors supabase/schema.sql.

const test = require("node:test");
const assert = require("node:assert/strict");
const Plan = require("../../js/room-plan.js");
const { planOf, planFromPrice, limitsOf, websiteOf, isWebsitePrice } = require("../../api/_plans.js");

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
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

// The rows a fake Supabase holds, and a fetch that serves them.
function fakeSupabase(sub) {
  const data = { subs: sub ? [Object.assign({ owner_id: USER }, sub)] : [], projects: [], creations: [] };
  let n = 0;
  const reply = (status, body) => ({
    ok: status < 300,
    status,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
    json: async () => body,
  });
  global.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const method = opts.method || "GET";
    const q = u.searchParams;
    const eq = (k) => (q.get(k) || "").replace(/^eq\./, "");
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (u.pathname === "/auth/v1/user") {
      return opts.headers.Authorization === "Bearer good" ? reply(200, { id: USER }) : reply(401, {});
    }
    if (u.pathname === "/rest/v1/subscriptions")
      return reply(
        200,
        data.subs.filter((s) => s.owner_id === eq("owner_id")),
      );
    if (u.pathname === "/rest/v1/project_creations") {
      const since = (q.get("created_at") || "").replace(/^gte\./, "");
      return reply(
        200,
        data.creations.filter((c) => c.owner_id === eq("owner_id") && c.created_at >= since),
      );
    }
    if (u.pathname === "/rest/v1/projects") {
      const match = (p) => p.owner_id === eq("owner_id") && (!q.get("id") || p.id === eq("id"));
      const rows = data.projects.filter(match);
      if (method === "GET") return reply(200, rows);
      if (method === "PATCH") {
        rows.forEach((p) => Object.assign(p, body));
        return reply(200, rows);
      }
      if (method === "DELETE") {
        data.projects = data.projects.filter((p) => !match(p));
        return reply(200, rows);
      }
    }
    if (u.pathname === "/rest/v1/rpc/create_project") {
      const month = data.creations.filter((c) => c.owner_id === body.p_owner).length;
      const total = data.projects.filter((p) => p.owner_id === body.p_owner).length;
      if (month >= body.p_monthly) return reply(200, { error: "monthly-limit", month, total });
      if (total >= body.p_total) return reply(200, { error: "total-limit", month, total });
      const id = "00000000-0000-4000-8000-" + String(++n).padStart(12, "0");
      const now = new Date().toISOString();
      data.projects.push({
        id,
        owner_id: body.p_owner,
        name: body.p_name,
        design: body.p_design,
        info: body.p_info,
        summary: body.p_summary,
        updated_at: now,
      });
      data.creations.push({ owner_id: body.p_owner, created_at: now });
      return reply(200, { project: { id, name: body.p_name }, month: month + 1, total: total + 1 });
    }
    return reply(404, { message: "unexpected " + method + " " + u.pathname });
  };
  return data;
}

async function call(method, { body, query, token = "good" } = {}) {
  process.env.SUPABASE_URL = "https://db.example";
  process.env.SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  const handler = require("../../api/projects.js");
  const res = fakeRes();
  await handler({ method, body, query: query || {}, headers: { authorization: "Bearer " + token } }, res);
  return res;
}

test("plans: free unless active or trialing; plan column, then Pro/Max price ids, else Starter", () => {
  assert.equal(planOf(null), "free");
  assert.equal(planOf({ status: "canceled", plan: "max" }), "free");
  assert.equal(planOf({ status: "past_due" }), "free");
  assert.equal(planOf({ status: "active" }), "starter");
  assert.equal(planOf({ status: "trialing", plan: "pro" }), "pro");
  process.env.STRIPE_PRICE_MAX = "price_a, price_max";
  assert.equal(planOf({ status: "active", price_id: "price_max" }), "max");
  delete process.env.STRIPE_PRICE_MAX;
  assert.deepEqual(limitsOf("starter"), { monthly: 10, total: 50 });
  assert.deepEqual(limitsOf("pro"), { monthly: 25, total: 100 });
  assert.deepEqual(limitsOf("max"), { monthly: 100, total: 1000 });
  assert.deepEqual(limitsOf("free"), { monthly: 0, total: 0 });
  assert.equal(planFromPrice({ lookup_key: "pro_monthly" }), "pro");
  assert.equal(planFromPrice({ metadata: { plan: "Max" } }), "max");
  assert.equal(planFromPrice({ lookup_key: "something" }), "");
});

test("plans: the website add-on comes with Max, with the add-on's price, or set by hand; never free", () => {
  assert.equal(websiteOf(null), false);
  assert.equal(websiteOf({ status: "active", plan: "starter" }), false);
  assert.equal(websiteOf({ status: "active", plan: "starter", website: true }), true);
  assert.equal(websiteOf({ status: "trialing", plan: "max" }), true);
  assert.equal(websiteOf({ status: "canceled", plan: "max", website: true }), false);
  process.env.STRIPE_PRICE_WEBSITE = "price_web";
  assert.equal(isWebsitePrice({ id: "price_web" }), true);
  assert.equal(isWebsitePrice({ id: "price_x", lookup_key: "website_monthly" }), true);
  assert.equal(isWebsitePrice({ id: "price_x", metadata: { addon: "website" } }), true);
  assert.equal(isWebsitePrice({ id: "price_x", lookup_key: "pro" }), false);
  delete process.env.STRIPE_PRICE_WEBSITE;
});

test("projects: signed-out callers are refused", async () => {
  fakeSupabase({ status: "active" });
  const res = await call("GET", { token: "bad" });
  assert.equal(res.statusCode, 401);
});

test("projects: a free account can list but not save", async () => {
  fakeSupabase(null);
  const list = await call("GET");
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().plan, "free");
  assert.equal(list.json().website, false);
  const save = await call("POST", { body: { name: "Smith bath", design: DESIGN } });
  assert.equal(save.statusCode, 403);
  assert.equal(save.json().error, "plan");
});

test("projects: Starter stops at 10 a month, and deleting doesn't give one back", async () => {
  const data = fakeSupabase({ status: "active" });
  for (let i = 0; i < 10; i++) {
    const res = await call("POST", { body: { name: "Job " + i, design: DESIGN } });
    assert.equal(res.statusCode, 201, res.body);
  }
  const eleventh = await call("POST", { body: { name: "Job 11", design: DESIGN } });
  assert.equal(eleventh.statusCode, 403);
  assert.equal(eleventh.json().error, "monthly-limit");

  const del = await call("DELETE", { query: { id: data.projects[0].id } });
  assert.equal(del.statusCode, 200);
  const again = await call("POST", { body: { name: "Job 11", design: DESIGN } });
  assert.equal(again.json().error, "monthly-limit");

  const list = (await call("GET")).json();
  assert.deepEqual(list.used, { month: 10, total: 9 });
  assert.deepEqual(list.limits, { monthly: 10, total: 50 });
});

test("projects: at the total cap, deleting one frees a slot", async () => {
  const data = fakeSupabase({ status: "active", plan: "pro" });
  for (let i = 0; i < 100; i++)
    data.projects.push({
      id: "00000000-0000-4000-9000-" + String(i).padStart(12, "0"),
      owner_id: USER,
      name: "Old " + i,
    });
  const full = await call("POST", { body: { name: "New", design: DESIGN } });
  assert.equal(full.json().error, "total-limit");
  await call("DELETE", { query: { id: data.projects[0].id } });
  const ok = await call("POST", { body: { name: "New", design: DESIGN } });
  assert.equal(ok.statusCode, 201);
  assert.deepEqual(ok.json().used, { month: 1, total: 100 });
});

test("projects: rename, save the design again, open, and only your own", async () => {
  const data = fakeSupabase({ status: "active" });
  const created = (await call("POST", { body: { name: "  Smith   bath ", design: DESIGN } })).json().project;
  assert.equal(created.name, "Smith bath");

  const renamed = await call("PATCH", { body: { id: created.id, name: "Smith main bath" } });
  assert.equal(renamed.json().project.name, "Smith main bath");
  assert.equal((await call("PATCH", { body: { id: created.id, name: "  " } })).statusCode, 400);
  assert.equal((await call("PATCH", { body: { id: created.id, design: "not a design" } })).statusCode, 400);
  assert.equal((await call("PATCH", { body: { id: created.id, design: DESIGN } })).statusCode, 200);

  const opened = await call("GET", { query: { id: created.id } });
  assert.equal(opened.json().project.design, DESIGN);

  data.projects[0].owner_id = OTHER;
  assert.equal((await call("GET", { query: { id: created.id } })).statusCode, 404);
  assert.equal((await call("DELETE", { query: { id: created.id } })).statusCode, 404);
  assert.equal((await call("PATCH", { body: { id: created.id, name: "Mine now" } })).statusCode, 404);
  assert.equal(data.projects.length, 1);
});

test("projects: a lapsed plan can still rename and delete, but not save designs", async () => {
  const data = fakeSupabase({ status: "active" });
  const created = (await call("POST", { body: { name: "Job", design: DESIGN } })).json().project;
  data.subs[0].status = "canceled";
  assert.equal((await call("PATCH", { body: { id: created.id, design: DESIGN } })).statusCode, 403);
  assert.equal((await call("PATCH", { body: { id: created.id, name: "Job 2" } })).statusCode, 200);
  assert.equal((await call("DELETE", { query: { id: created.id } })).statusCode, 200);
});

test("projects: a design must be one the designer can open", async () => {
  fakeSupabase({ status: "active" });
  const bad = await call("POST", { body: { name: "X", design: "abc" } });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().error, "design");
});

test("projects: client and job details are checked field by field", async () => {
  const { cleanInfo } = require("../../api/projects.js");
  assert.deepEqual(
    cleanInfo({ client: "  Maria   Garcia ", unit: "", status: "lead", start: "2026-11-02", other: "x" }),
    {
      client: "Maria Garcia",
      status: "lead",
      start: "2026-11-02",
    },
  );
  assert.equal(cleanInfo({ status: "maybe" }), null);
  assert.equal(cleanInfo({ start: "next week" }), null);
  assert.equal(cleanInfo({ client: "x".repeat(121) }), null);
  assert.equal(cleanInfo({ client: 5 }), null);
  assert.equal(cleanInfo("text"), null);

  const data = fakeSupabase({ status: "active" });
  const summary = { v: 1, grandTotal: 1234 };
  const res = await call("POST", { body: { name: "Job", design: DESIGN, info: { client: "Lee" }, summary } });
  assert.equal(res.statusCode, 201);
  const sent = data.projects[0];
  assert.equal(sent.name, "Job");
  assert.deepEqual(sent.info, { client: "Lee" });
  assert.deepEqual(sent.summary, summary);
  assert.equal(
    (await call("POST", { body: { name: "Job", design: DESIGN, info: { status: "nope" } } })).statusCode,
    400,
  );
  assert.equal((await call("POST", { body: { name: "Job", design: DESIGN, summary: [1] } })).statusCode, 400);
});
