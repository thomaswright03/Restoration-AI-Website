// GET /api/business?b=<slug>: a tiny script the designer page loads (see
// js/business.js). It hands the page the business's public profile, or
// tells it the designer isn't available (unknown slug, inactive plan, or
// accounts not set up yet). A business without an active plan is still shown
// to its own owner, as a preview: js/business.js passes their sign-in token
// as ?t=, and that answer is never cached.
"use strict";

const { supabaseReady, activeBusiness, currentUser } = require("./_lib.js");

function script(res, payload, reason, maxAge) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", maxAge < 0 ? "private, no-store" : "public, max-age=0, s-maxage=" + maxAge);
  // JSON is valid JS; escape "<" so a value can never close a script tag.
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  res.end("window.DesignerBusiness.load(" + json + (reason ? ", " + JSON.stringify(reason) : "") + ");\n");
}

function profile(biz) {
  return {
    slug: biz.slug,
    name: biz.name,
    phone: biz.phone,
    email: biz.email,
    legalName: biz.legal_name,
    prices: biz.prices || {},
  };
}

module.exports = async function handler(req, res) {
  const slug = String((req.query && req.query.b) || "").toLowerCase();
  if (!supabaseReady()) return script(res, null, "not-configured", 60);
  try {
    const biz = await activeBusiness(slug);
    if (!biz) return script(res, null, "not-found", 60);
    if (biz.inactive) {
      const token = String((req.query && req.query.t) || "");
      const owner = token ? await currentUser({ headers: { authorization: "Bearer " + token } }) : null;
      if (!owner || owner.id !== biz.business.owner_id) return script(res, null, "inactive", token ? -1 : 60);
      return script(res, Object.assign(profile(biz.business), { preview: true }), "", -1);
    }
    return script(res, profile(biz), "", 60);
  } catch (e) {
    console.error(e);
    return script(res, null, "error", 0);
  }
};
