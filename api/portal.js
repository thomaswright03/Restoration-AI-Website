// POST /api/portal {lang} with the signed-in user's Supabase access token:
// opens Stripe's billing portal (change card, switch plan, cancel, invoices).
"use strict";

const {
  supabaseReady,
  stripeReady,
  sendJson,
  sendError,
  siteUrl,
  db,
  requireUser,
  stripe,
  idempotencyKey,
  readForm,
} = require("./_lib.js");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "method" });
  }
  if (!supabaseReady() || !stripeReady()) return sendJson(res, 503, { error: "not-configured" });

  let user;
  try {
    user = await requireUser(req, res);
    if (!user) return;
    const body = await readForm(req);
    const dir = body.lang === "es" || body.lang === "pt" ? body.lang + "/" : "";

    let customer;
    try {
      const subs = await db("subscriptions?owner_id=eq." + encodeURIComponent(user.id) + "&select=stripe_customer_id");
      customer = subs && subs[0] && subs[0].stripe_customer_id;
    } catch (e) {
      return sendError(req, res, 502, { error: "server" }, e, user);
    }
    if (!customer) return sendJson(res, 404, { error: "no-customer" });
    try {
      const session = await stripe(
        "billing_portal/sessions",
        { customer, return_url: siteUrl(req) + "/" + dir + "account.html" },
        "POST",
        { idempotencyKey: idempotencyKey(["portal", user.id, dir]) },
      );
      return sendJson(res, 200, { url: session.url });
    } catch (e) {
      return sendError(req, res, 502, { error: "stripe" }, e, user);
    }
  } catch (e) {
    return sendError(req, res, 502, { error: "server" }, e, user);
  }
};
