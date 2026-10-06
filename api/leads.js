// POST /api/leads: the designer's request form. Saves the homeowner's request
// for the business it came from (shown on that business's account page), and
// emails it to the business when RESEND_API_KEY and LEADS_FROM_EMAIL are set.
// Requests from the public demo (business=demo) are accepted but not kept.
"use strict";

const { env, supabaseReady, sendJson, db, readForm, activeBusiness } = require("./_lib.js");

const LIMITS = { name: 120, phone: 40, email: 160, service: 120, message: 6000, language: 40 };

function field(form, key) {
  return String(form[key] || "")
    .trim()
    .slice(0, LIMITS[key]);
}

async function emailBusiness(biz, lead) {
  if (!env("RESEND_API_KEY") || !env("LEADS_FROM_EMAIL") || !biz.email) return;
  const text = [
    "New request from your 3D bathroom designer",
    "",
    "Name: " + lead.name,
    "Phone: " + lead.phone,
    "Email: " + lead.email,
    "Work: " + lead.service,
    lead.language ? "Language: " + lead.language : "",
    "",
    lead.message,
  ]
    .filter((line, i, all) => line || all[i - 1] !== "")
    .join("\n");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + env("RESEND_API_KEY"), "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env("LEADS_FROM_EMAIL"),
      to: [biz.email],
      reply_to: lead.email || undefined,
      subject: "New bathroom request from " + (lead.name || "a homeowner"),
      text,
    }),
  });
  if (!res.ok) console.error("Resend " + res.status + ": " + (await res.text()).slice(0, 300));
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

  const slug = String(form.business || "").toLowerCase();
  if (!slug || slug === "demo") return sendJson(res, 200, { ok: true, demo: true });
  if (!supabaseReady()) return sendJson(res, 503, { error: "not-configured" });

  try {
    const biz = await activeBusiness(slug);
    if (!biz || biz.inactive) return sendJson(res, 404, { error: "unavailable" });
    await db("leads", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: Object.assign({ business_id: biz.id }, lead),
    });
    await emailBusiness(biz, lead).catch((e) => console.error(e));
    return sendJson(res, 200, { ok: true });
  } catch (e) {
    console.error(e);
    return sendJson(res, 500, { error: "server" });
  }
};
