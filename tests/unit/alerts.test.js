"use strict";

// api/_lib.js sendAlert: with ALERT_EMAIL and RESEND_API_KEY set, an error
// line is also emailed through Resend, at most once per route and error word
// per ALERT_EVERY_MS, and a send that fails or hangs never changes the
// request's answer. Unset, nothing is sent.

const test = require("node:test");
const assert = require("node:assert/strict");

const lib = require("../../api/_lib.js");

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
  };
}

const VARS = ["ALERT_EMAIL", "RESEND_API_KEY", "ALERT_EMAIL_FROM"];

// Runs fn with ALERT_EMAIL = to (and a Resend key), global fetch stubbed by
// `reply`, and console.error silenced; resolves the fetch calls made.
async function withAlerts(to, reply, fn) {
  const saved = { env: VARS.map((k) => process.env[k]), fetch: global.fetch, error: console.error };
  const calls = [];
  VARS.forEach((k) => delete process.env[k]);
  if (to !== undefined) {
    process.env.ALERT_EMAIL = to;
    process.env.RESEND_API_KEY = "re_test";
  }
  global.fetch = async (u, opts) => {
    calls.push({ url: u, auth: opts.headers.Authorization, body: JSON.parse(opts.body) });
    return reply();
  };
  console.error = () => {};
  try {
    await fn();
  } finally {
    VARS.forEach((k, i) => {
      if (saved.env[i] === undefined) delete process.env[k];
      else process.env[k] = saved.env[i];
    });
    global.fetch = saved.fetch;
    console.error = saved.error;
  }
  return calls;
}

function req(url) {
  return { method: "POST", url, headers: { "x-vercel-id": "iad1::abc" } };
}

test("alerts: unset, a server error posts nothing", async () => {
  const calls = await withAlerts(
    undefined,
    () => ({ ok: true }),
    async () => {
      const res = fakeRes();
      await lib.sendError(req("/api/alert-unset"), res, 502, { error: "server" }, new Error("boom"));
      assert.equal(res.statusCode, 502);
    },
  );
  assert.equal(calls.length, 0);
});

test("alerts: a server error is posted once with its route, cause and reference, then throttled", async () => {
  const calls = await withAlerts(
    "owner@example.com",
    () => ({ ok: true }),
    async () => {
      for (let i = 0; i < 3; i++) {
        const res = fakeRes();
        await lib.sendError(req("/api/alert-once"), res, 502, { error: "stripe" }, new Error("Stripe 503: down"));
        assert.equal(JSON.parse(res.body).error, "stripe");
      }
      // Another error word on the same route is its own alert.
      await lib.sendError(req("/api/alert-once"), fakeRes(), 502, { error: "server" }, new Error("db"));
    },
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(calls[0].auth, "Bearer re_test");
  const { to, from, subject, text } = calls[0].body;
  assert.deepEqual(to, ["owner@example.com"]);
  assert.match(from, /onboarding@resend\.dev/);
  assert.match(subject, /stripe on \/api\/alert-once/);
  assert.match(text, /Stripe 503: down/);
  assert.match(text, /Reference: iad1::abc/);
});

test("alerts: a failing or rejected send doesn't change the answer", async () => {
  await withAlerts(
    "owner@example.com",
    () => ({ ok: false }),
    async () => {
      const res = fakeRes();
      await lib.sendError(req("/api/alert-fails"), res, 502, { error: "server" }, new Error("x"));
      assert.equal(res.statusCode, 502);
      assert.equal(JSON.parse(res.body).requestId, "iad1::abc");
    },
  );
  await withAlerts(
    "owner@example.com",
    () => {
      throw new Error("network");
    },
    async () => {
      assert.equal(await lib.sendAlert({ route: "/api/alert-throws", error: "server", message: "x" }), false);
      const res = fakeRes();
      await lib.sendError(req("/api/alert-throws-2"), res, 503, { error: "unavailable" }, new Error("x"));
      assert.equal(res.statusCode, 503);
    },
  );
});

test("alerts: a Resend rejection writes an alert-failed log line", async () => {
  const lines = [];
  const orig = console.error;
  await withAlerts(
    "owner@example.com",
    () => ({ ok: false, status: 403, text: async () => "domain not verified" }),
    async () => {
      console.error = (m) => lines.push(String(m));
      try {
        assert.equal(await lib.sendAlert({ route: "/api/alert-403", error: "server", message: "x" }), false);
      } finally {
        console.error = orig;
      }
    },
  );
  const failed = lines.map((l) => JSON.parse(l)).find((l) => l.error === "alert-failed");
  assert.ok(failed);
  assert.equal(failed.status, 403);
  assert.match(failed.message, /domain not verified/);
});
