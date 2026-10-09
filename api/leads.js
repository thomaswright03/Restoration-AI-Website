// POST /api/leads: the request form of the public demo designer. Requests
// from the demo (business=demo) are checked and answered but not kept. A
// business's own designer opens only for its signed-in owner and has no
// request form, so requests for any other business are refused. Requests
// saved before that change stay on the business's account page.
"use strict";

const { sendJson, readForm } = require("./_lib.js");

const LIMITS = { name: 120, phone: 40, email: 160, service: 120, message: 6000, language: 40 };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function field(form, key) {
  return String(form[key] || "")
    .trim()
    .slice(0, LIMITS[key]);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "method" });
  }
  const form = await readForm(req);
  // Spam trap: real people never fill the hidden field. Pretend it worked.
  if (form._gotcha) return sendJson(res, 200, { ok: true });

  const lead = {
    name: field(form, "name"),
    phone: field(form, "phone"),
    email: field(form, "email"),
    service: field(form, "service"),
    message: field(form, "message"),
    language: field(form, "language"),
  };
  if (!lead.name || (!lead.phone && !lead.email)) return sendJson(res, 400, { error: "missing" });
  if (lead.email && !EMAIL.test(lead.email)) return sendJson(res, 400, { error: "email" });

  const slug = String(form.business || "").toLowerCase();
  if (!slug || slug === "demo") return sendJson(res, 200, { ok: true, demo: true });
  return sendJson(res, 404, { error: "unavailable" });
};
