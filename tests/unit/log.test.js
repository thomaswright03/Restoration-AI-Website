"use strict";

// api/log.js: a browser error report becomes one structured log line with a
// request id, and nothing else gets through: only POST, only a JSON report
// of a known kind with a message, only a small one, only so many a minute
// from one sender, and only the account id about the person (the page's
// query string is dropped).

const test = require("node:test");
const assert = require("node:assert/strict");

const handler = require("../../api/log.js");

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

async function post(body, headers = {}, method = "POST") {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const req = (async function* () {
    if (raw) yield Buffer.from(raw);
  })();
  req.method = method;
  req.url = "/api/log";
  req.headers = Object.assign({ "content-type": "application/json", "x-forwarded-for": "203.0.113.9" }, headers);
  const res = fakeRes();
  const lines = [];
  const real = console.error;
  console.error = (line) => lines.push(String(line));
  try {
    await handler(req, res);
  } finally {
    console.error = real;
  }
  return { res, lines: lines.map((l) => JSON.parse(l)) };
}

const USER = "11111111-1111-4111-8111-111111111111";

test("a report becomes one log line: level error, source browser, a request id, the page's path only", async () => {
  handler.resetRate();
  const { res, lines } = await post(
    {
      kind: "error",
      page: "/es/account.html?project=abc&email=someone@example.com",
      message: "  TypeError: x is   not a function ",
      stack: "TypeError: x is not a function\n    at account.js:10:5",
      source: "https://site/js/account.js:10",
      userId: USER,
      lang: "es",
    },
    { "x-vercel-id": "iad1::req-1" },
  );
  assert.equal(res.statusCode, 204);
  assert.equal(res.body, "");
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].level, "error");
  assert.equal(lines[0].source, "browser");
  assert.equal(lines[0].route, "/api/log");
  assert.equal(lines[0].requestId, "iad1::req-1");
  assert.equal(lines[0].kind, "error");
  assert.equal(lines[0].page, "/es/account.html");
  assert.equal(lines[0].message, "TypeError: x is not a function");
  assert.match(lines[0].stack, /account\.js:10:5/);
  assert.equal(lines[0].file, "https://site/js/account.js:10");
  assert.equal(lines[0].userId, USER);
  assert.equal(lines[0].lang, "es");
  assert.equal(
    JSON.stringify(lines[0]).includes("someone@example.com"),
    false,
    "the query string never reaches the log",
  );
});

test("only the account id is taken about the person; anything else in userId is dropped", async () => {
  handler.resetRate();
  const { lines } = await post({ kind: "load", page: "/designer.html", message: "script failed", userId: "me@x.co" });
  assert.equal(lines[0].userId, null);
  assert.equal(lines[0].lang, "en");
  assert.equal(lines[0].stack, undefined);
});

test("not a report: a GET is 405, bad JSON or an unknown kind or no message is 400, nothing is logged", async () => {
  handler.resetRate();
  let r = await post({ kind: "error", message: "x" }, {}, "GET");
  assert.equal(r.res.statusCode, 405);
  assert.equal(r.res.headers.allow, "POST");
  r = await post("{not json");
  assert.equal(r.res.statusCode, 400);
  assert.equal(r.res.json().error, "body");
  assert.ok(r.res.json().requestId);
  r = await post({ kind: "console", message: "x" });
  assert.equal(r.res.statusCode, 400);
  r = await post({ kind: "error", message: "" });
  assert.equal(r.res.statusCode, 400);
  r = await post([1, 2]);
  assert.equal(r.res.statusCode, 400);
  assert.equal(r.lines.length, 0);
});

test("a report over the size cap is 413 (by its header, or by what arrived), and texts are cut", async () => {
  handler.resetRate();
  let r = await post({ kind: "error", message: "x" }, { "content-length": String(handler.BODY_MAX + 1) });
  assert.equal(r.res.statusCode, 413);
  r = await post({ kind: "error", message: "x".repeat(handler.BODY_MAX) });
  assert.equal(r.res.statusCode, 413);
  assert.equal(r.lines.length, 0);
  r = await post({ kind: "error", message: "m".repeat(2000), stack: "s".repeat(1500) });
  assert.equal(r.res.statusCode, 204);
  assert.equal(r.lines[0].message.length, 300);
  assert.equal(r.lines[0].stack.length, 1000);
});

test("one sender gets RATE_MAX reports a minute; the next is 429 and not logged; another sender is unaffected", async () => {
  handler.resetRate();
  for (let i = 0; i < handler.RATE_MAX; i++) {
    const { res } = await post({ kind: "error", message: "loop " + i });
    assert.equal(res.statusCode, 204, "report " + i);
  }
  const over = await post({ kind: "error", message: "one too many" });
  assert.equal(over.res.statusCode, 429);
  assert.equal(over.res.json().error, "rate");
  assert.equal(over.lines.length, 0);
  const other = await post({ kind: "error", message: "elsewhere" }, { "x-forwarded-for": "198.51.100.7, 10.0.0.1" });
  assert.equal(other.res.statusCode, 204);
});
