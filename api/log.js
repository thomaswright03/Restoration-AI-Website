// POST /api/log: the browser reports an error it hit (js/net.js
// Net.report, installed by js/script.js): an uncaught exception, an
// unhandled promise rejection or a script that didn't load. One structured
// line goes to the function log (level "error", source "browser"), with a
// request id of its own, so the owner can find browser-side failures in
// Vercel's logs next to the API's (README "Finding an error in the logs").
//
// Body (JSON, at most BODY_MAX bytes):
//   kind     "error" | "unhandledrejection" | "load"
//   page     the page's path (its query is dropped here)
//   message  what went wrong (cut to 300 characters)
//   stack    optional (cut to 1000 characters)
//   source   optional: the script or file involved (its URL, cut to 300)
//   userId   optional: the signed-in account's id (a UUID), nothing else
//            about the person is taken
//   lang     optional: "en" | "es" | "pt"
//
// Answers 204 when logged, 400 for a body that isn't one report, 413 for
// one too big, 429 when a browser sends more than RATE_MAX in RATE_WINDOW_MS
// (a page in an error loop must not fill the log). Nothing is stored.
"use strict";

const { sendJson, requestId, refuseMethod, readRawBody } = require("./_lib.js");

const BODY_MAX = 4096;
const RATE_MAX = 20;
const RATE_WINDOW_MS = 60 * 1000;
const KINDS = ["error", "unhandledrejection", "load"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Reports per sender in the current window (per function instance: enough
// to stop one runaway page).
let buckets = new Map();
let windowStart = 0;

function sender(req) {
  const fwd = String((req.headers && req.headers["x-forwarded-for"]) || "")
    .split(",")[0]
    .trim();
  return fwd || String((req.headers && req.headers["x-real-ip"]) || "") || "unknown";
}

// True when this sender has sent too many reports in the window.
function overRate(key, now = Date.now()) {
  if (now - windowStart >= RATE_WINDOW_MS) {
    buckets = new Map();
    windowStart = now;
  }
  const n = (buckets.get(key) || 0) + 1;
  buckets.set(key, n);
  return n > RATE_MAX;
}

function text(value, max) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

// The page's path only: a query string may carry ids nobody asked to log.
function pagePath(value) {
  const raw = text(value, 300);
  if (!raw) return "";
  try {
    return new URL(raw, "https://site.invalid").pathname.slice(0, 200);
  } catch {
    return raw.split("?")[0].slice(0, 200);
  }
}

// The report as one log line, or null when the body isn't a report.
function logLine(body, id) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const kind = KINDS.includes(body.kind) ? body.kind : "";
  const message = text(body.message, 300);
  if (!kind || !message) return null;
  const userId = text(body.userId, 40);
  const lang = text(body.lang, 2);
  return {
    level: "error",
    source: "browser",
    route: "/api/log",
    requestId: id,
    kind,
    page: pagePath(body.page),
    message,
    stack: text(body.stack, 1000) || undefined,
    file: text(body.source, 300) || undefined,
    userId: UUID.test(userId) ? userId : null,
    lang: lang === "es" || lang === "pt" ? lang : "en",
  };
}

function resetRate() {
  buckets = new Map();
  windowStart = 0;
}

module.exports = async function handler(req, res) {
  if (refuseMethod(req, res, "POST")) return;
  const id = requestId(req);
  if (Number(req.headers && req.headers["content-length"]) > BODY_MAX) {
    return sendJson(res, 413, { requestId: id, error: "too-large" });
  }
  if (overRate(sender(req))) return sendJson(res, 429, { requestId: id, error: "rate" });
  let raw;
  if (typeof req.body === "string") raw = req.body;
  else if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) raw = JSON.stringify(req.body);
  else raw = await readRawBody(req);
  if (Buffer.byteLength(raw || "", "utf8") > BODY_MAX) return sendJson(res, 413, { requestId: id, error: "too-large" });
  let body;
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return sendJson(res, 400, { requestId: id, error: "body" });
  }
  const line = logLine(body, id);
  if (!line) return sendJson(res, 400, { requestId: id, error: "body" });
  console.error(JSON.stringify(line));
  res.statusCode = 204;
  res.setHeader("Cache-Control", "no-store");
  res.end();
};

module.exports.logLine = logLine;
module.exports.resetRate = resetRate;
module.exports.BODY_MAX = BODY_MAX;
module.exports.RATE_MAX = RATE_MAX;
