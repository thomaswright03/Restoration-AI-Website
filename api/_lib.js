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

// How long one upstream call may take. Vercel functions get 10 s by default.
const UPSTREAM_TIMEOUT_MS = 8000;

// Stripe's behaviour (the shapes it sends, the webhook payloads) is pinned to
// one API version, so a dashboard upgrade can't change what this code reads.
// periodEnd() in api/stripe-webhook.js reads this version's shape.
const STRIPE_API_VERSION = "2025-08-27.basil";

// fetch with a bounded wait. A timeout or network failure rejects with an
// Error whose .upstream is true, so handlers can tell it from a bug.
async function fetchWithTimeout(url, options = {}, ms = UPSTREAM_TIMEOUT_MS) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  try {
    return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
  } catch (e) {
    const err = new Error("Upstream " + (timedOut ? "timeout" : "unreachable") + ": " + url);
    err.upstream = true;
    err.cause = e;
    throw err;
  } finally {
    clearTimeout(timer);
  }
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

// Supabase PostgREST with the service role key (bypasses row-level security,
// so only ever used server-side, with filters built from validated input).
async function db(path, options = {}) {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const res = await fetchWithTimeout(env("SUPABASE_URL") + "/rest/v1/" + path, {
    method: options.method || "GET",
    headers: Object.assign(
      { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" },
      options.headers || {},
    ),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error("Supabase " + res.status + ": " + text.slice(0, 300));
  return text ? JSON.parse(text) : null;
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
    console.error(e);
    sendJson(res, 503, { error: "unavailable" });
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
async function stripe(path, params, method, options = {}) {
  method = method || (params ? "POST" : "GET");
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
  if (!res.ok) throw new Error("Stripe " + res.status + ": " + ((data.error && data.error.message) || ""));
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

const ACTIVE_STATUSES = ["active", "trialing"];

// A business by its slug, or null when there's no such business. One without
// an active plan comes back as { inactive: true, business }: its owner sees
// their designer as a preview (api/business.js).
async function activeBusiness(slug) {
  if (!/^[a-z0-9-]{1,64}$/.test(slug || "")) return null;
  const rows = await db(
    "businesses?slug=eq." + encodeURIComponent(slug) + "&select=id,owner_id,slug,name,phone,email,legal_name,prices",
  );
  const biz = rows && rows[0];
  if (!biz) return null;
  const subs = await db("subscriptions?owner_id=eq." + encodeURIComponent(biz.owner_id) + "&select=status");
  const sub = subs && subs[0];
  if (!sub || !ACTIVE_STATUSES.includes(sub.status)) return { inactive: true, business: biz };
  return biz;
}

module.exports = {
  env,
  UPSTREAM_TIMEOUT_MS,
  STRIPE_API_VERSION,
  fetchWithTimeout,
  supabaseReady,
  stripeReady,
  sendJson,
  siteUrl,
  db,
  currentUser,
  requireUser,
  formEncode,
  stripe,
  idempotencyKey,
  verifyStripeSignature,
  readRawBody,
  readForm,
  activeBusiness,
};
