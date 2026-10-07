// Shared helpers for the Vercel functions in api/. Files starting with "_"
// are not routes. No npm packages: Stripe and Supabase are called over their
// REST APIs with fetch (Node 20+).
//
// Environment variables (set them in the Vercel project; see .env.example):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
//   STRIPE_PRICE_MONTHLY, STRIPE_PRICE_YEARLY
//   TRIAL_DAYS (optional, e.g. 14), SITE_URL (optional, e.g. https://example.com)
//   RESEND_API_KEY, LEADS_FROM_EMAIL (optional: email each new lead to the business)
"use strict";

const crypto = require("node:crypto");

function env(name) {
  return (process.env[name] || "").trim();
}

function supabaseReady() {
  return !!(env("SUPABASE_URL") && env("SUPABASE_ANON_KEY") && env("SUPABASE_SERVICE_ROLE_KEY"));
}

function stripeReady() {
  return !!(env("STRIPE_SECRET_KEY") && (env("STRIPE_PRICE_MONTHLY") || env("STRIPE_PRICE_YEARLY")));
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
  const res = await fetch(env("SUPABASE_URL") + "/rest/v1/" + path, {
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

// The signed-in user behind "Authorization: Bearer <Supabase access token>".
async function currentUser(req) {
  const header = String(req.headers.authorization || "");
  const m = /^Bearer\s+(\S+)$/.exec(header);
  if (!m) return null;
  const res = await fetch(env("SUPABASE_URL") + "/auth/v1/user", {
    headers: { apikey: env("SUPABASE_ANON_KEY"), Authorization: "Bearer " + m[1] },
  });
  if (!res.ok) return null;
  const user = await res.json();
  return user && user.id ? user : null;
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

async function stripe(path, params, method) {
  const res = await fetch("https://api.stripe.com/v1/" + path, {
    method: method || (params ? "POST" : "GET"),
    headers: {
      Authorization: "Bearer " + env("STRIPE_SECRET_KEY"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params ? formEncode(params).toString() : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Stripe " + res.status + ": " + ((data.error && data.error.message) || ""));
  return data;
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

// The public profile of a business whose subscription is active, or null.
async function activeBusiness(slug) {
  if (!/^[a-z0-9-]{1,64}$/.test(slug || "")) return null;
  const rows = await db(
    "businesses?slug=eq." + encodeURIComponent(slug) + "&select=id,owner_id,slug,name,phone,email,legal_name,prices",
  );
  const biz = rows && rows[0];
  if (!biz) return null;
  const subs = await db("subscriptions?owner_id=eq." + encodeURIComponent(biz.owner_id) + "&select=status");
  const status = subs && subs[0] ? subs[0].status : "none";
  // inactive: only its owner may see it, as a preview (api/business.js).
  if (!ACTIVE_STATUSES.includes(status)) return { inactive: true, business: biz };
  return biz;
}

module.exports = {
  env,
  supabaseReady,
  stripeReady,
  sendJson,
  siteUrl,
  db,
  currentUser,
  formEncode,
  stripe,
  verifyStripeSignature,
  readRawBody,
  readForm,
  activeBusiness,
  ACTIVE_STATUSES,
};
