"use strict";

// api/_lib.js sendAlert: with ALERT_WEBHOOK_URL set, an error line is also
// posted to that webhook (Slack "text", Discord "content"), at most once per
// route and error word per ALERT_EVERY_MS, and a webhook that fails or hangs
// never changes the request's answer. Unset, nothing is sent.

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

// Runs fn with ALERT_WEBHOOK_URL = url, global fetch stubbed by `reply`, and
// console.error silenced; resolves the fetch calls made.
async function withAlerts(url, reply, fn) {
  const saved = { url: process.env.ALERT_WEBHOOK_URL, fetch: global.fetch, error: console.error };
  const calls = [];
  if (url === undefined) delete process.env.ALERT_WEBHOOK_URL;
  else process.env.ALERT_WEBHOOK_URL = url;
  global.fetch = async (u, opts) => {
    calls.push({ url: u, body: JSON.parse(opts.body) });
    return reply();
  };
  console.error = () => {};
  try {
    await fn();
  } finally {
    if (saved.url === undefined) delete process.env.ALERT_WEBHOOK_URL;
    else process.env.ALERT_WEBHOOK_URL = saved.url;
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
    "https://hooks.example/alert",
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
  assert.equal(calls[0].url, "https://hooks.example/alert");
  const { text, content } = calls[0].body;
  assert.equal(text, content);
  assert.match(text, /stripe on \/api\/alert-once/);
  assert.match(text, /Stripe 503: down/);
  assert.match(text, /Reference: iad1::abc/);
});

test("alerts: a failing or rejecting webhook doesn't change the answer", async () => {
  await withAlerts(
    "https://hooks.example/alert",
    () => ({ ok: false }),
    async () => {
      const res = fakeRes();
      await lib.sendError(req("/api/alert-fails"), res, 502, { error: "server" }, new Error("x"));
      assert.equal(res.statusCode, 502);
      assert.equal(JSON.parse(res.body).requestId, "iad1::abc");
    },
  );
  await withAlerts(
    "https://hooks.example/alert",
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
