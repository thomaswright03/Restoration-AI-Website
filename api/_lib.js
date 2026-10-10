// @ts-check
// Shared helpers for the Vercel functions in api/. Files starting with "_"
// are not routes. No npm packages: Stripe and Supabase are called over their
// REST APIs with fetch (Node 20+).
//
// Environment variables (set them in the Vercel project; see .env.example):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
//   STRIPE_PRICE_STARTER, STRIPE_PRICE_PRO, STRIPE_PRICE_MAX (monthly prices)
//   PROMO_CODES (optional, free-week codes; see api/_plans.js)
//   TRIAL_DAYS (optional: a trial for everyone, e.g. 14), SITE_URL (optional, e.g. https://example.com)
//   STRIPE_API_VERSION (optional: overrides the pinned Stripe API version below)
//
// Every call to Supabase or Stripe has a timeout, so a hung upstream answers
// with a JSON error within a few seconds instead of holding the function
// until Vercel kills it. The handlers answer these errors (always JSON):
//   401 {error: "signin"}        no valid sign-in token
//   503 {error: "unavailable"}   Supabase Auth couldn't answer (not the same as "sign in")
//   503 {error: "paused"}        the action is switched off (api/_switches.js)
//   502 {error: "server"}        the database failed;  502 {error: "stripe"}  Stripe failed
"use strict";

const crypto = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");

// How long one upstream call may take. Vercel functions get 10 s by default.
const UPSTREAM_TIMEOUT_MS = 8000;

// The time budget of one whole request (api/checkout.js, api/portal.js):
// every upstream call inside withBudget() is cut to what is left of it, and
// a retry is skipped when too little is left, so a request that chains
// several calls still answers (success or a clear error) before the
// browser's own 15 s wait (js/net.js) and before vercel.json's maxDuration.
const REQUEST_BUDGET_MS = 9000;
// A retry needs at least this much of the budget left to be worth starting.
const RETRY_MIN_LEFT_MS = 1500;

const budgetStore = new AsyncLocalStorage();

// Runs fn with a deadline that every fetchWithTimeout() and withRetry()
// inside it respects (through async context, so the Stripe and Supabase
// helpers need no extra parameter).
function withBudget(ms, fn) {
  return budgetStore.run({ deadline: Date.now() + (ms || REQUEST_BUDGET_MS) }, fn);
}

// Milliseconds left of the enclosing budget, or Infinity outside one.
function budgetLeft() {
  const b = budgetStore.getStore();
  return b ? Math.max(0, b.deadline - Date.now()) : Infinity;
}

// Stripe's behaviour (the shapes it sends, the webhook payloads) is pinned to
// one API version, so a dashboard upgrade can't change what this code reads.
// periodEnd() in api/stripe-webhook.js reads this version's shape.
const STRIPE_API_VERSION = "2025-08-27.basil";

// fetch with a bounded wait that covers the whole exchange: the headers and
// the body (res.text() / res.json()). A timeout or network failure rejects
// with an Error whose .upstream is true, so handlers can tell it from a bug.
async function fetchWithTimeout(url, options = {}, ms = UPSTREAM_TIMEOUT_MS) {
  const controller = new AbortController();
  let timedOut = false;
  const upstreamError = (e) => {
    const err = new Error("Upstream " + (timedOut ? "timeout" : "unreachable") + ": " + url);
    err.upstream = true;
    err.timedOut = timedOut;
    err.cause = e;
    return err;
  };
  // Inside withBudget(): never longer than what the request has left, and
  // nothing at all once it's spent.
  const left = budgetLeft();
  if (left <= 0) {
    timedOut = true;
    throw upstreamError(new Error("request budget spent"));
  }
  const timer = setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    Math.min(ms, left),
  );
  let res;
  try {
    res = await fetch(url, Object.assign({}, options, { signal: controller.signal }));
  } catch (e) {
    clearTimeout(timer);
    throw upstreamError(e);
  }
  // A HEAD (dbCount) and any answer without a body have nothing more to
  // wait for: the timer is done with, so it never outlives the call.
  if (String(options.method || "GET").toUpperCase() === "HEAD" || res.body === null) {
    clearTimeout(timer);
    return res;
  }
  // Reading the body is bounded by the same timer; it stops once the body is in.
  const bounded = (read) => async () => {
    try {
      return await read();
    } catch (e) {
      if (timedOut || (e && e.name === "AbortError")) throw upstreamError(e);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };
  const text = res.text.bind(res);
  const json = res.json.bind(res);
  try {
    res.text = bounded(text);
    res.json = bounded(json);
  } catch {
    /* a response object that can't be written to: the headers were bounded */
    clearTimeout(timer);
  }
  return res;
}

// A short id for one request, from Vercel's own (x-vercel-id) when there is
// one, so a log line can be found again from what a person reports.
function requestId(req) {
  const given = String((req && req.headers && req.headers["x-vercel-id"]) || "").trim();
  if (given) return given.slice(0, 80);
  if (!req || typeof req !== "object") return crypto.randomUUID();
  if (!req.__requestId) req.__requestId = crypto.randomUUID();
  return req.__requestId;
}

// One structured log line per failed request: the route, the request id, the
// signed-in user (when known), the error word the client got and the cause.
function logError(req, e, info = {}) {
  const line = Object.assign(
    {
      level: "error",
      route: String((req && req.url) || "").split("?")[0] || info.route || "",
      method: (req && req.method) || "",
      requestId: requestId(req),
      userId: info.userId || null,
      error: info.error || "server",
      message: e && e.message ? String(e.message).slice(0, 500) : String(e),
    },
    info.extra || {},
  );
  console.error(JSON.stringify(line));
  if (e && e.stack && !e.upstream) console.error(e.stack);
}

// Answers a failed request: logs it (logError) and sends the JSON error with
// the request id, so the person can quote it.
function sendError(req, res, status, body, e, user) {
  logError(req, e, { error: body.error, userId: user && user.id });
  return sendJson(res, status, Object.assign({ requestId: requestId(req) }, body));
}

function env(name) {
  return (process.env[name] || "").trim();
}

function supabaseReady() {
  return !!(env("SUPABASE_URL") && env("SUPABASE_ANON_KEY") && env("SUPABASE_SERVICE_ROLE_KEY"));
}

function stripeReady() {
  return !!(
    env("STRIPE_SECRET_KEY") &&
    (env("STRIPE_PRICE_STARTER") || env("STRIPE_PRICE_PRO") || env("STRIPE_PRICE_MAX"))
  );
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function siteUrl(req) {
  const fixed = env("SITE_URL").replace(/\/+$/, "");
  if (fixed) return fixed;
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  const proto = req.headers["x-forwarded-proto"] || (String(host).startsWith("localhost") ? "http" : "https");
  return proto + "://" + host;
}

// An upstream call that failed in a way a second try may fix: the connection
// dropped before an answer came (not a timeout, which has already spent the
// request's budget), or the upstream answered 5xx or 429. Only a call that
// can't land twice is tried again: a read (GET or HEAD), or a Stripe create
// sent with an idempotency key (Stripe answers the retry with the object the
// first try made, if it made one). A plain write is never retried: a create
// or a patch that may have landed must not run twice.
const RETRY_DELAY_MS = 150;
// The longest a Retry-After is honoured for (REQUEST_BUDGET_MS is the whole request).
const RETRY_DELAY_MAX_MS = 1000;
const RETRY_STATUSES = [429, 500, 502, 503, 504];

// When Stripe says so, its word is final: Stripe-Should-Retry: false means
// a retry would only get the same answer again (for a keyed create, Stripe
// replays the stored result, a 500 included), and true means it's safe.
function retryable(method, e, idempotent) {
  if (method !== "GET" && method !== "HEAD" && !idempotent) return false;
  if (e && e.upstream) return !e.timedOut;
  if (e && typeof e.shouldRetry === "boolean") return e.shouldRetry;
  return !!(e && RETRY_STATUSES.includes(e.status));
}

// How long to wait before the retry: Retry-After when the upstream said
// (a 429), within RETRY_DELAY_MAX_MS, else RETRY_DELAY_MS.
function retryDelay(e) {
  const asked = Number(e && e.retryAfterMs);
  if (asked > 0) return Math.min(asked, RETRY_DELAY_MAX_MS);
  return RETRY_DELAY_MS;
}

// Runs an upstream call, once more after a short pause when the first try
// failed the way retryable() describes. idempotent: the call is safe to
// repeat although it isn't a read (a keyed Stripe create).
async function withRetry(method, call, idempotent = false) {
  try {
    return await call();
  } catch (e) {
    if (!retryable(method, e, idempotent)) throw e;
    // Not when the request's budget is nearly spent: the retry would only
    // be cut short, and the caller is better off with this answer now.
    const delay = retryDelay(e);
    if (budgetLeft() < delay + RETRY_MIN_LEFT_MS) throw e;
    await new Promise((resolve) => setTimeout(resolve, delay));
    return call();
  }
}

// An error for an upstream answer that isn't ok, carrying its status (and
// its Retry-After, in ms) so the call can be retried on a 5xx or 429.
// shouldRetry: Stripe's own Stripe-Should-Retry header ("true" | "false"),
// when it sent one.
function statusError(message, status, retryAfter, shouldRetry) {
  const err = new Error(message);
  err.status = status;
  const seconds = Number(retryAfter);
  if (seconds > 0) err.retryAfterMs = seconds * 1000;
  const said = String(shouldRetry || "").toLowerCase();
  if (said === "true" || said === "false") err.shouldRetry = said === "true";
  return err;
}

// "" | "es/" | "pt/": the folder of the pages in the language the browser
// said (api/checkout.js and api/portal.js send people back to account.html).
function langDir(lang) {
  return lang === "es" || lang === "pt" ? lang + "/" : "";
}

// Refuses any method but the one allowed with 405 and answers the request.
// True when it did (the handler returns), false when the method is allowed.
function refuseMethod(req, res, allowed) {
  if (req.method === allowed) return false;
  res.setHeader("Allow", allowed);
  sendJson(res, 405, { error: "method" });
  return true;
}

// One PostgREST request with the service role key: the Response, not yet read.
function dbRequest(path, options) {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  return fetchWithTimeout(
    env("SUPABASE_URL") + "/rest/v1/" + path,
    {
      method: options.method || "GET",
      headers: Object.assign(
        { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" },
        options.headers || {},
      ),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    },
    options.timeoutMs || UPSTREAM_TIMEOUT_MS,
  );
}

// Supabase PostgREST with the service role key (bypasses row-level security,
// so only ever used server-side, with filters built from validated input).
// A GET is retried once when the connection dropped or Supabase answered 5xx.
async function db(path, options = {}) {
  const method = options.method || "GET";
  return withRetry(method, async () => {
    const res = await dbRequest(path, options);
    const text = await res.text();
    if (!res.ok) throw statusError("Supabase " + res.status + ": " + text.slice(0, 300), res.status);
    return text ? JSON.parse(text) : null;
  });
}

// How many rows match a PostgREST query (e.g. "projects?owner_id=eq.<id>"),
// as a number the database counted: a HEAD with Prefer: count=exact answers
// Content-Range "0-24/1234" or "*/0", and no rows travel. Use it wherever the
// code only needs a count, so the cost stays flat as a table grows.
async function dbCount(path) {
  return withRetry("HEAD", async () => {
    const res = await dbRequest(path, { method: "HEAD", headers: { Prefer: "count=exact" } });
    if (!res.ok) throw statusError("Supabase " + res.status + " counting " + path.split("?")[0], res.status);
    const range = String((res.headers && res.headers.get && res.headers.get("content-range")) || "");
    const m = /\/(\d+)\s*$/.exec(range);
    if (!m) throw new Error("Supabase count: no Content-Range for " + path.split("?")[0]);
    return Number(m[1]);
  });
}

// The signed-in user behind "Authorization: Bearer <Supabase access token>",
// or null when there's no valid sign-in. Throws (err.upstream) when Supabase
// Auth itself fails or doesn't answer, so an outage is never reported as
// "please sign in".
async function currentUser(req) {
  const header = String(req.headers.authorization || "");
  const m = /^Bearer\s+(\S+)$/.exec(header);
  if (!m) return null;
  const res = await fetchWithTimeout(env("SUPABASE_URL") + "/auth/v1/user", {
    headers: { apikey: env("SUPABASE_ANON_KEY"), Authorization: "Bearer " + m[1] },
  });
  if (res.status >= 500) {
    const err = new Error("Supabase auth " + res.status);
    err.upstream = true;
    throw err;
  }
  if (!res.ok) return null;
  let user = null;
  try {
    user = await res.json();
  } catch {
    return null;
  }
  return user && user.id ? user : null;
}

// The signed-in user, or null after answering the request itself: 401 for no
// sign-in, 503 {error: "unavailable"} when the auth service failed.
async function requireUser(req, res) {
  let user;
  try {
    user = await currentUser(req);
  } catch (e) {
    sendError(req, res, 503, { error: "unavailable" }, e);
    return null;
  }
  if (!user) {
    sendJson(res, 401, { error: "signin" });
    return null;
  }
  return user;
}

// Stripe REST: form-encoded bodies, nested keys as a[b][c].
function formEncode(obj, prefix, out) {
  out = out || new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    const key = prefix ? prefix + "[" + k + "]" : k;
    if (typeof v === "object") formEncode(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

// A Stripe call. params: form fields (a GET with params puts them in the
// query string). options.idempotencyKey: for a create call, so a retry of the
// same request (a double click, a function retried) makes one object, not two.
// A GET, and a create sent with an idempotency key, are retried once when the
// connection dropped or Stripe answered 5xx or 429 (Retry-After honoured).
async function stripe(path, params, method, options = {}) {
  method = method || (params ? "POST" : "GET");
  return withRetry(method, () => stripeOnce(path, params, method, options), !!options.idempotencyKey);
}

async function stripeOnce(path, params, method, options) {
  const encoded = params ? formEncode(params).toString() : "";
  const url = "https://api.stripe.com/v1/" + path + (method === "GET" && encoded ? "?" + encoded : "");
  const headers = {
    Authorization: "Bearer " + env("STRIPE_SECRET_KEY"),
    "Content-Type": "application/x-www-form-urlencoded",
    "Stripe-Version": env("STRIPE_API_VERSION") || STRIPE_API_VERSION,
  };
  if (options.idempotencyKey) headers["Idempotency-Key"] = String(options.idempotencyKey).slice(0, 255);
  const res = await fetchWithTimeout(url, {
    method,
    headers,
    body: method === "GET" ? undefined : encoded || undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    const header = (name) => (res.headers && res.headers.get ? res.headers.get(name) : null);
    throw statusError(
      "Stripe " + res.status + ": " + ((data.error && data.error.message) || ""),
      res.status,
      header("retry-after"),
      header("stripe-should-retry"),
    );
  }
  return data;
}

// A stable idempotency key for a Stripe create call: the same request within
// the same 5-minute window reuses the object Stripe already made.
function idempotencyKey(parts) {
  const window = Math.floor(Date.now() / (5 * 60 * 1000));
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(parts) + ":" + window)
    .digest("hex");
}

// Verifies a Stripe-Signature header against the raw request body.
function verifyStripeSignature(rawBody, header, secret, toleranceSeconds = 300, now = Date.now()) {
  if (!header || !secret) return false;
  const parts = {};
  for (const item of String(header).split(",")) {
    const i = item.indexOf("=");
    if (i < 0) continue;
    const k = item.slice(0, i).trim();
    (parts[k] = parts[k] || []).push(item.slice(i + 1).trim());
  }
  const t = parts.t && parts.t[0];
  if (!t || !parts.v1) return false;
  if (Math.abs(now / 1000 - Number(t)) > toleranceSeconds) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(t + "." + rawBody, "utf8")
    .digest("hex");
  return parts.v1.some((sig) => {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString("utf8");
}

// A form post (application/x-www-form-urlencoded) or JSON, as a plain object.
async function readForm(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  const raw = typeof req.body === "string" ? req.body : await readRawBody(req);
  const type = String(req.headers["content-type"] || "");
  if (type.includes("application/json")) {
    try {
      return JSON.parse(raw || "{}");
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

module.exports = {
  env,
  UPSTREAM_TIMEOUT_MS,
  REQUEST_BUDGET_MS,
  RETRY_MIN_LEFT_MS,
  STRIPE_API_VERSION,
  withBudget,
  budgetLeft,
  fetchWithTimeout,
  supabaseReady,
  stripeReady,
  sendJson,
  sendError,
  logError,
  requestId,
  siteUrl,
  db,
  dbCount,
  RETRY_DELAY_MS,
  RETRY_DELAY_MAX_MS,
  currentUser,
  requireUser,
  formEncode,
  stripe,
  idempotencyKey,
  verifyStripeSignature,
  readRawBody,
  readForm,
  langDir,
  refuseMethod,
};
