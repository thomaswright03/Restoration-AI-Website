// GET /api/business?b=<slug>: a tiny script the designer page loads (see
// js/business.js). It hands the page the business's public profile, or
// tells it the designer isn't available (unknown slug, inactive plan, or
// accounts not set up yet).
"use strict";

const { supabaseReady, activeBusiness } = require("./_lib.js");

function script(res, payload, reason, maxAge) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=" + maxAge);
  // JSON is valid JS; escape "<" so a value can never close a script tag.
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  res.end("window.DesignerBusiness.load(" + json + (reason ? ", " + JSON.stringify(reason) : "") + ");\n");
}

module.exports = async function handler(req, res) {
  const slug = String((req.query && req.query.b) || "").toLowerCase();
  if (!supabaseReady()) return script(res, null, "not-configured", 60);
  try {
    const biz = await activeBusiness(slug);
    if (!biz) return script(res, null, "not-found", 60);
    if (biz.inactive) return script(res, null, "inactive", 60);
    return script(
      res,
      {
        slug: biz.slug,
        name: biz.name,
        phone: biz.phone,
        email: biz.email,
        legalName: biz.legal_name,
        prices: biz.prices || {},
      },
      "",
      60,
    );
  } catch (e) {
    console.error(e);
    return script(res, null, "error", 0);
  }
};
