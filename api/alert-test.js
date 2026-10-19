// @ts-check
// GET /api/alert-test?key=...: sends one test alert email through the same
// path a real server error takes (api/_lib.js sendAlert), so the owner can
// check ALERT_EMAIL and RESEND_API_KEY work on the live site (README
// "Alerts"). Only with ALERT_TEST_KEY set in Vercel and the same value in
// ?key=; otherwise the route answers 404 as if it didn't exist. Like any
// alert, at most one every 10 minutes per instance.
//
// Answers 200 {sent: true} when Resend took the email, 200 {sent: false}
// when it didn't (alerts not set up, throttled, or Resend refused it: the
// reason is in the function log), 404 without the right key.
"use strict";

const crypto = require("node:crypto");
const { env, sendJson, requestId, refuseMethod, sendAlert } = require("./_lib.js");

// Constant-time, so the key can't be guessed one character at a time.
function keyMatches(given, want) {
  if (!want || typeof given !== "string") return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(want).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = async function handler(req, res) {
  if (refuseMethod(req, res, "GET")) return;
  const key = new URL(String(req.url || ""), "https://site.invalid").searchParams.get("key");
  if (!keyMatches(key || "", env("ALERT_TEST_KEY"))) return sendJson(res, 404, { error: "not-found" });
  const id = requestId(req);
  const sent = await sendAlert({
    level: "info",
    route: "/api/alert-test",
    requestId: id,
    error: "test",
    message: "A test alert: if this reached you, alert emails work.",
  });
  return sendJson(res, 200, { requestId: id, sent: Boolean(sent) });
};

module.exports.keyMatches = keyMatches;
