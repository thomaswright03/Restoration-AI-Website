"use strict";

// api/business.js: a business without an active plan is "inactive" to
// everyone except its own signed-in owner, who gets an uncached preview.
// One whose plan lacks "Put it on your website" is "no-website" to everyone
// except its owner, who gets it for their own use (websiteLocked).

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

// sub: the subscriptions row (status alone, or a row with plan/website).
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
  assert.match(anon.body, /load\(null, "inactive"\)/);
  assert.match(anon.headers["cache-control"], /s-maxage=60/);
  const other = await load({ b: "smith", t: "other-token" });
  assert.match(other.body, /load\(null, "inactive"\)/);
  assert.equal(other.headers["cache-control"], "private, no-store");
});

test("its owner gets a preview of their own designer, never cached", async () => {
  setup("canceled");
  const res = await load({ b: "smith", t: "owner-token" });
  assert.match(res.body, /"name":"Smith Bath"/);
  assert.match(res.body, /"preview":true/);
  assert.equal(res.headers["cache-control"], "private, no-store");
});

test("an active business with the website add-on loads for everyone, with no preview flag", async () => {
  setup({ status: "active", plan: "starter", website: true });
  const res = await load({ b: "smith" });
  assert.match(res.body, /"name":"Smith Bath"/);
  assert.doesNotMatch(res.body, /preview|websiteLocked/);
  assert.match(res.headers["cache-control"], /s-maxage=60/);
  // Max includes the add-on.
  setup({ status: "trialing", plan: "max", website: false });
  assert.match((await load({ b: "smith" })).body, /"name":"Smith Bath"/);
});

test("without the add-on, the public and other accounts get no-website; the owner gets it for their own use", async () => {
  setup({ status: "active", plan: "pro", website: false });
  const anon = await load({ b: "smith" });
  assert.match(anon.body, /load\(null, "no-website"\)/);
  assert.match(anon.headers["cache-control"], /s-maxage=60/);
  const other = await load({ b: "smith", t: "other-token" });
  assert.match(other.body, /load\(null, "no-website"\)/);
  const owner = await load({ b: "smith", t: "owner-token" });
  assert.match(owner.body, /"name":"Smith Bath"/);
  assert.match(owner.body, /"websiteLocked":true/);
  assert.doesNotMatch(owner.body, /"preview"/);
  assert.equal(owner.headers["cache-control"], "private, no-store");
});
