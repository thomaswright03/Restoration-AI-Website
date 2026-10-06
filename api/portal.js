// POST /api/portal {lang} with the signed-in user's Supabase access token:
// opens Stripe's billing portal (change card, switch plan, cancel, invoices).
"use strict";

const { supabaseReady, stripeReady, sendJson, siteUrl, db, currentUser, stripe, readForm } = require("./_lib.js");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "method" });
  }
  if (!supabaseReady() || !stripeReady()) return sendJson(res, 503, { error: "not-configured" });
  const user = await currentUser(req);
  if (!user) return sendJson(res, 401, { error: "signin" });
  const body = await readForm(req);
  const dir = body.lang === "es" || body.lang === "pt" ? body.lang + "/" : "";

  try {
    const subs = await db("subscriptions?owner_id=eq." + encodeURIComponent(user.id) + "&select=stripe_customer_id");
    const customer = subs && subs[0] && subs[0].stripe_customer_id;
    if (!customer) return sendJson(res, 404, { error: "no-customer" });
    const session = await stripe("billing_portal/sessions", {
      customer,
      return_url: siteUrl(req) + "/" + dir + "account.html",
    });
    return sendJson(res, 200, { url: session.url });
  } catch (e) {
    console.error(e);
    return sendJson(res, 502, { error: "stripe" });
  }
};
