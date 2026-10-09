"use strict";

// api/business.js: a business's designer opens only for its own signed-in
// owner, on every plan (as an uncached preview while the plan isn't active).
// Everyone else is told "owner-only".

const test = require("node:test");
const assert = require("node:assert/strict");

const OWNER = "11111111-1111-4111-8111-111111111111";

function fakeRes() {
  return {
    headers: {},
    body: "",
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    end(b) {
      this.body = b || "";
    },
  };
}

// sub: the subscriptions row (status alone, or a full row).
function setup(sub) {
  if (typeof sub === "string") sub = { status: sub };
  process.env.SUPABASE_URL = "https://db.example";
  process.env.SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  const json = (body, ok = true) => ({
    ok,
    status: ok ? 200 : 401,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  global.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    if (u.pathname === "/auth/v1/user") {
      const auth = opts.headers.Authorization;
      if (auth === "Bearer owner-token") return json({ id: OWNER });
      if (auth === "Bearer other-token") return json({ id: "someone-else" });
      return json({}, false);
    }
    if (u.pathname === "/rest/v1/businesses") {
      return json([
        {
          id: "b1",
          owner_id: OWNER,
          slug: "smith",
          name: "Smith Bath",
          phone: "",
          email: "",
          legal_name: "",
          prices: {},
        },
      ]);
    }
    if (u.pathname === "/rest/v1/subscriptions") return json(sub ? [sub] : []);
    throw new Error("unexpected " + url);
  };
}

async function load(query) {
  const res = fakeRes();
  await require("../../api/business.js")({ query, headers: {} }, res);
  return res;
}

test("an inactive business is unavailable to the public and to other accounts", async () => {
  setup(null);
  const anon = await load({ b: "smith" });
  assert.match(anon.body, /load\(null, "owner-only"\)/);
  assert.match(anon.headers["cache-control"], /s-maxage=60/);
  const other = await load({ b: "smith", t: "other-token" });
  assert.match(other.body, /load\(null, "owner-only"\)/);
  assert.equal(other.headers["cache-control"], "private, no-store");
});

test("its owner gets a preview of their own designer, never cached", async () => {
  setup("canceled");
  const res = await load({ b: "smith", t: "owner-token" });
  assert.match(res.body, /"name":"Smith Bath"/);
  assert.match(res.body, /"preview":true/);
  assert.equal(res.headers["cache-control"], "private, no-store");
});

test("an active business opens only for its owner, on every plan, even with the old website flag", async () => {
  for (const sub of [
    { status: "active", plan: "starter", website: true },
    { status: "trialing", plan: "max", website: true },
    { status: "active", plan: "pro", website: false },
  ]) {
    setup(sub);
    const anon = await load({ b: "smith" });
    assert.match(anon.body, /load\(null, "owner-only"\)/);
    assert.doesNotMatch(anon.body, /Smith Bath/);
    const other = await load({ b: "smith", t: "other-token" });
    assert.match(other.body, /load\(null, "owner-only"\)/);
    const owner = await load({ b: "smith", t: "owner-token" });
    assert.match(owner.body, /"name":"Smith Bath"/);
    assert.doesNotMatch(owner.body, /preview|websiteLocked/);
    assert.equal(owner.headers["cache-control"], "private, no-store");
  }
});

test("an unknown business is not found", async () => {
  setup("active");
  global.fetch = ((orig) => async (url, opts) =>
    new URL(url).pathname === "/rest/v1/businesses"
      ? { ok: true, status: 200, json: async () => [], text: async () => "[]" }
      : orig(url, opts))(global.fetch);
  assert.match((await load({ b: "nobody" })).body, /load\(null, "not-found"\)/);
});
