// POST /api/portal {lang} with the signed-in user's Supabase access token:
// opens Stripe's billing portal (change card, switch plan, cancel, invoices).
"use strict";

const {
  supabaseReady,
  stripeReady,
  sendJson,
  siteUrl,
  requireUser,
  stripe,
  idempotencyKey,
  readForm,
} = require("./_lib.js");
const { subscriptionOf } = require("./_subscriptions.js");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "method" });
  }
  if (!supabaseReady() || !stripeReady()) return sendJson(res, 503, { error: "not-configured" });

  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const body = await readForm(req);
    const dir = body.lang === "es" || body.lang === "pt" ? body.lang + "/" : "";

    let customer;
    try {
      const sub = await subscriptionOf(user.id, "stripe_customer_id");
      customer = sub && sub.stripe_customer_id;
    } catch (e) {
      console.error(e);
      return sendJson(res, 502, { error: "server" });
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
      console.error(e);
      return sendJson(res, 502, { error: "stripe" });
    }
  } catch (e) {
    console.error(e);
    return sendJson(res, 502, { error: "server" });
  }
};
