"use strict";

// api/projects.js and api/_plans.js against a stand-in Supabase: fetch is
// replaced by a tiny in-memory version of the auth, REST and create_project()
// calls the API makes. The SQL function here is a stand-in; the real one in
// supabase/schema.sql runs in tests/unit/schema-sql.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const Plan = require("../../js/room-plan.js");
const { planOf, planFromPrice, limitsOf } = require("../../api/_plans.js");

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
  const data = {
    subs: sub ? [Object.assign({ owner_id: USER }, sub)] : [],
    projects: [],
    creations: [],
    // Every request made: { method, path, bytes } (bytes: the body sent back).
    requests: [],
  };
  let n = 0;
  const reply = (status, body, headers = {}) => ({
    ok: status < 300,
    status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
    json: async () => body,
  });
  // Like PostgREST: a HEAD with Prefer: count=exact answers the matching
  // rows' count in Content-Range, with no body.
  const counted = (rows) =>
    reply(200, undefined, { "content-range": rows.length ? "0-" + (rows.length - 1) + "/" + rows.length : "*/0" });
  global.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const method = opts.method || "GET";
    const q = u.searchParams;
    const eq = (k) => (q.get(k) || "").replace(/^eq\./, "");
    const body = opts.body ? JSON.parse(opts.body) : null;
    const res = await serve(u, method, q, eq, body, opts);
    data.requests.push({ method, path: u.pathname + u.search, bytes: (await res.text()).length });
    return res;
  };
  const serve = async (u, method, q, eq, body, opts) => {
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
      const rows = data.creations.filter((c) => c.owner_id === eq("owner_id") && c.created_at >= since);
      if (method === "HEAD") return counted(rows);
      return reply(200, rows);
    }
    if (u.pathname === "/rest/v1/projects") {
      const match = (p) =>
        p.owner_id === eq("owner_id") &&
        (!q.get("id") || p.id === eq("id")) &&
        (!q.get("updated_at") || Date.parse(p.updated_at) === Date.parse(eq("updated_at")));
      const rows = data.projects.filter(match);
      if (method === "HEAD") return counted(rows);
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

async function call(method, { body, query, token = "good", headers = {} } = {}) {
  process.env.SUPABASE_URL = "https://db.example";
  process.env.SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  const handler = require("../../api/projects.js");
  const res = fakeRes();
  await handler(
    { method, body, query: query || {}, headers: Object.assign({ authorization: "Bearer " + token }, headers) },
    res,
  );
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
  assert.equal(list.json().website, undefined);
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

test("projects: a body that isn't a JSON object is refused as such, not as a missing name", async () => {
  fakeSupabase({ status: "active" });
  const json = { "content-type": "application/json" };
  for (const body of ['{"name":', "[1, 2]", "null", '"text"', "42"]) {
    const res = await call("POST", { body, headers: json });
    assert.equal(res.statusCode, 400, body);
    assert.deepEqual(res.json(), { error: "json" }, body);
  }
  // An already-parsed array (a platform that parses JSON itself) too.
  const arr = await call("PATCH", { body: [{ id: "x" }], headers: json });
  assert.deepEqual(arr.json(), { error: "json" });
  // A well-formed object with no name is still a missing name.
  const empty = await call("POST", { body: "{}", headers: json });
  assert.deepEqual(empty.json(), { error: "name", field: "name", reason: "empty" });
  // A raw (Buffer) body is parsed the same way.
  const buf = await call("POST", { body: Buffer.from('{"name": "Buffered"}'), headers: json });
  assert.equal(buf.json().error, "design");
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
  // Each refusal names the field and what's wrong with it.
  const { parseInfo, parseName } = require("../../api/projects.js");
  assert.deepEqual(parseInfo({ status: "maybe" }), { field: "status", reason: "value" });
  assert.deepEqual(parseInfo({ start: "2026-02-30" }), { field: "start", reason: "date" });
  // A real day in an implausible year (a typo like 0226, 1950 or 2206) is
  // refused as "year": 2000 up to ten years from now.
  const thisYear = new Date().getUTCFullYear();
  assert.deepEqual(parseInfo({ start: "0999-01-01" }), { field: "start", reason: "year" });
  assert.deepEqual(parseInfo({ start: "1949-12-31" }), { field: "start", reason: "year" });
  assert.deepEqual(parseInfo({ start: "1950-01-01" }), { field: "start", reason: "year" });
  assert.deepEqual(parseInfo({ start: "1999-12-31" }), { field: "start", reason: "year" });
  assert.deepEqual(parseInfo({ start: "2000-01-01" }), { info: { start: "2000-01-01" } });
  assert.deepEqual(parseInfo({ start: thisYear + 10 + "-12-31" }), { info: { start: thisYear + 10 + "-12-31" } });
  assert.deepEqual(parseInfo({ start: thisYear + 11 + "-01-01" }), { field: "start", reason: "year" });
  assert.deepEqual(parseInfo({ start: "2026-02-28" }), { info: { start: "2026-02-28" } });
  const { plausibleYear } = require("../../api/projects.js");
  assert.equal(plausibleYear("2036-01-01", new Date("2026-10-10T00:00:00Z")), true);
  assert.equal(plausibleYear("2037-01-01", new Date("2026-10-10T00:00:00Z")), false);
  assert.deepEqual(parseInfo({ email: "not-an-email" }), { field: "email", reason: "email" });
  assert.deepEqual(parseInfo({ notes: "x".repeat(2001) }), { field: "notes", reason: "long" });
  assert.deepEqual(parseName("x".repeat(121)), { reason: "long" });
  assert.deepEqual(parseName("  "), { reason: "empty" });
  assert.deepEqual(parseName(" Smith  bath "), { name: "Smith bath" });

  const data = fakeSupabase({ status: "active" });
  const summary = { v: 1, grandTotal: 1234 };
  const res = await call("POST", { body: { name: "Job", design: DESIGN, info: { client: "Lee" }, summary } });
  assert.equal(res.statusCode, 201);
  const sent = data.projects[0];
  assert.equal(sent.name, "Job");
  assert.deepEqual(sent.info, { client: "Lee" });
  // The summary is kept with the moment the design was saved, so its page
  // can date the materials list by that, not by a later rename.
  assert.equal(sent.summary.v, 1);
  assert.equal(sent.summary.grandTotal, 1234);
  assert.ok(Math.abs(Date.parse(sent.summary.savedAt) - Date.now()) < 5000, sent.summary.savedAt);
  const savedAt = sent.summary.savedAt;
  await new Promise((r) => setTimeout(r, 5));
  const renamed = await call("PATCH", { body: { id: sent.id, name: "Job renamed" } });
  assert.equal(renamed.statusCode, 200);
  assert.equal(sent.summary.savedAt, savedAt, "a rename leaves the estimate's date alone");
  assert.notEqual(sent.updated_at, savedAt);
  const resaved = await call("PATCH", { body: { id: sent.id, design: DESIGN, summary: { v: 1, grandTotal: 99 } } });
  assert.equal(resaved.statusCode, 200);
  assert.equal(sent.summary.grandTotal, 99);
  assert.ok(sent.summary.savedAt >= savedAt, "saving the design again moves it");
  const { cleanSummary } = require("../../api/projects.js");
  assert.deepEqual(cleanSummary({ v: 1 }, new Date("2026-10-10T12:00:00Z")), {
    v: 1,
    savedAt: "2026-10-10T12:00:00.000Z",
  });
  assert.equal(cleanSummary(null), null);
  assert.equal(cleanSummary([1]), false);
  assert.equal(cleanSummary({ big: "x".repeat(90000) }), false);
  const badYear = await call("PATCH", { body: { id: sent.id, info: { start: "1950-01-01" } } });
  assert.equal(badYear.statusCode, 400);
  assert.deepEqual(badYear.json(), { error: "info", field: "start", reason: "year" });
  const bad = await call("POST", { body: { name: "Job", design: DESIGN, info: { status: "nope" } } });
  assert.equal(bad.statusCode, 400);
  assert.deepEqual(bad.json(), { error: "info", field: "status", reason: "value" });
  const badDate = await call("PATCH", { body: { id: data.projects[0].id, info: { start: "2026-13-01" } } });
  assert.deepEqual(badDate.json(), { error: "info", field: "start", reason: "date" });
  const longName = await call("PATCH", { body: { id: data.projects[0].id, name: "n".repeat(121) } });
  assert.equal(longName.statusCode, 400);
  assert.deepEqual(longName.json(), { error: "name", field: "name", reason: "long" });
  assert.equal((await call("POST", { body: { name: "Job", design: DESIGN, summary: [1] } })).statusCode, 400);
});

test("projects: counts come from the database as numbers, and ?counts=1 skips the list", async () => {
  const data = fakeSupabase({ status: "active", plan: "max" });
  for (let i = 0; i < 1000; i++)
    data.projects.push({
      id: "00000000-0000-4000-9000-" + String(i).padStart(12, "0"),
      owner_id: USER,
      name: "Old " + i,
    });
  data.creations.push({ owner_id: USER, created_at: new Date().toISOString() });
  data.creations.push({ owner_id: OTHER, created_at: new Date().toISOString() });

  const counts = await call("GET", { query: { counts: "1" } });
  assert.equal(counts.statusCode, 200);
  assert.deepEqual(counts.json(), { plan: "max", limits: limitsOf("max"), used: { month: 1, total: 1000 } });
  // No project row travelled: the counts are HEAD requests with empty bodies.
  const reads = data.requests.filter((r) => r.path.startsWith("/rest/v1/projects"));
  assert.deepEqual(
    reads.map((r) => r.method),
    ["HEAD"],
  );
  assert.ok(reads.every((r) => r.bytes === 0));
  const creations = data.requests.filter((r) => r.path.startsWith("/rest/v1/project_creations"));
  assert.deepEqual(
    creations.map((r) => r.method),
    ["HEAD"],
  );

  // The usage payload is the same size at 1,000 projects as at 1.
  data.projects.length = 1;
  data.requests.length = 0;
  const one = await call("GET", { query: { counts: "1" } });
  assert.deepEqual(one.json().used, { month: 1, total: 1 });
  assert.equal(one.body.length, counts.body.length - 3);

  // The full list still comes with the counts, from one list request.
  const list = await call("GET");
  assert.equal(list.json().projects.length, 1);
  assert.deepEqual(list.json().used, { month: 1, total: 1 });
  const listReads = data.requests.filter((r) => r.path.startsWith("/rest/v1/projects") && r.method === "GET");
  assert.equal(listReads.length, 1);
});

test("projects: names and details with NUL or other control characters are refused as values", async () => {
  const { parseInfo, parseName } = require("../../api/projects.js");
  assert.deepEqual(parseName("Smith\u0000 bath"), { reason: "value" });
  assert.deepEqual(parseName("Smith\u001b[31m bath"), { reason: "value" });
  assert.deepEqual(parseName("Smith\u0085bath"), { reason: "value" });
  assert.deepEqual(parseName("Smith\tbath\n"), { name: "Smith bath" });
  assert.deepEqual(parseInfo({ client: "Lee\u0000" }), { field: "client", reason: "value" });
  assert.deepEqual(parseInfo({ notes: "line 1\nline 2\ttabbed\r\n" }), { info: { notes: "line 1\nline 2\ttabbed" } });
  assert.deepEqual(parseInfo({ notes: "bell\u0007" }), { field: "notes", reason: "value" });
  assert.deepEqual(parseInfo({ city: "São Paulo — ñ" }), { info: { city: "São Paulo — ñ" } });

  fakeSupabase({ status: "active" });
  const res = await call("POST", { body: { name: "Job\u0000", design: DESIGN } });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.json(), { error: "name", field: "name", reason: "value" });
  const info = await call("POST", { body: { name: "Job", design: DESIGN, info: { street: "1\u0000 Main" } } });
  assert.deepEqual(info.json(), { error: "info", field: "street", reason: "value" });
});

test("projects: a save that names the version it loaded is refused once the project changed", async () => {
  const data = fakeSupabase({ status: "active" });
  const created = (await call("POST", { body: { name: "Job", design: DESIGN } })).json().project;
  data.projects[0].updated_at = "2026-10-01T12:00:00.000Z"; // saved a while ago
  const loaded = (await call("GET", { query: { id: created.id } })).json().project.updated_at;

  // The same tab saves: fine, and the version moves on.
  const first = await call("PATCH", { body: { id: created.id, name: "Job A", updated_at: loaded } });
  assert.equal(first.statusCode, 200);
  assert.notEqual(first.json().project.updated_at, loaded);

  // A second tab that still holds the old version: told, with what's there now.
  const stale = await call("PATCH", { body: { id: created.id, name: "Job B", updated_at: loaded } });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().error, "conflict");
  assert.equal(stale.json().project.name, "Job A");
  assert.equal(data.projects[0].name, "Job A");

  // Saving anyway (no version) or with the current version goes through.
  const current = stale.json().project.updated_at;
  assert.equal((await call("PATCH", { body: { id: created.id, name: "Job B", updated_at: current } })).statusCode, 200);
  assert.equal((await call("PATCH", { body: { id: created.id, name: "Job C" } })).statusCode, 200);
  assert.equal(
    (await call("PATCH", { body: { id: created.id, name: "Job D", updated_at: "garbage" } })).statusCode,
    400,
  );

  // A project that's gone is still "not found", version or not.
  data.projects = [];
  assert.equal((await call("PATCH", { body: { id: created.id, name: "X", updated_at: current } })).statusCode, 404);
});
