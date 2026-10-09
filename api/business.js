// GET /api/business?b=<slug>&t=<sign-in token>: a tiny script the designer
// page loads (see js/business.js). A business's designer opens only for its
// own signed-in owner: they get the business's profile (with preview: true
// while the plan isn't active); anyone else is told the designer isn't
// available (unknown slug, not the owner, or accounts not set up yet). The
// answer is never cached.
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
    const found = await activeBusiness(slug);
    if (!found) return script(res, null, "not-found", 60);
    const biz = found.business || found;
    const token = String((req.query && req.query.t) || "");
    const owner = token ? await currentUser({ headers: { authorization: "Bearer " + token } }) : null;
    if (!owner || owner.id !== biz.owner_id) return script(res, null, "owner-only", token ? -1 : 60);
    const flag = found.inactive ? { preview: true } : {};
    return script(res, Object.assign(profile(biz), flag), "", -1);
  } catch (e) {
    console.error(e);
    return script(res, null, "error", 0);
  }
};
