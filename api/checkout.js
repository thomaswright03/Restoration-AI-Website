// POST /api/checkout {plan: "monthly"|"yearly", lang: ""|"es"|"pt"}
// with the signed-in user's Supabase access token as a Bearer token.
// Starts a Stripe Checkout subscription and answers {url} to send them to.
"use strict";

const { env, supabaseReady, stripeReady, sendJson, siteUrl, db, currentUser, stripe, readForm } = require("./_lib.js");

const PRICE_ENV = { monthly: "STRIPE_PRICE_MONTHLY", yearly: "STRIPE_PRICE_YEARLY" };

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "method" });
  }
  if (!supabaseReady() || !stripeReady()) return sendJson(res, 503, { error: "not-configured" });

  const user = await currentUser(req);
  if (!user) return sendJson(res, 401, { error: "signin" });

  const body = await readForm(req);
  const plan = PRICE_ENV[body.plan] ? body.plan : "monthly";
  const price = env(PRICE_ENV[plan]);
  if (!price) return sendJson(res, 400, { error: "plan" });
  const dir = body.lang === "es" || body.lang === "pt" ? body.lang + "/" : "";
  const base = siteUrl(req) + "/" + dir + "account.html";

  try {
    const subs = await db("subscriptions?owner_id=eq." + encodeURIComponent(user.id) + "&select=*");
    const existing = subs && subs[0];
    if (existing && ["active", "trialing", "past_due"].includes(existing.status)) {
      return sendJson(res, 409, { error: "already-subscribed" });
    }
    const trialDays = Number(env("TRIAL_DAYS")) || 0;
    const session = await stripe("checkout/sessions", {
      mode: "subscription",
      line_items: { 0: { price, quantity: 1 } },
      success_url: base + "?checkout=success",
      cancel_url: base + "?checkout=cancelled",
      client_reference_id: user.id,
      customer: existing && existing.stripe_customer_id ? existing.stripe_customer_id : undefined,
      customer_email: existing && existing.stripe_customer_id ? undefined : user.email,
      allow_promotion_codes: "true",
      subscription_data: {
        metadata: { owner_id: user.id },
        // One free trial per account: not again after an earlier subscription.
        trial_period_days: trialDays > 0 && !(existing && existing.stripe_subscription_id) ? trialDays : undefined,
      },
      metadata: { owner_id: user.id },
    });
    return sendJson(res, 200, { url: session.url });
  } catch (e) {
    console.error(e);
    return sendJson(res, 502, { error: "stripe" });
  }
};
