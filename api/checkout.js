// POST /api/checkout {plan: "starter"|"pro"|"max", promo: "", lang: ""|"es"|"pt"}
// with the signed-in user's Supabase access token as a Bearer token.
// Starts a Stripe Checkout subscription and answers {url} to send them to.
// A valid promo code (PROMO_CODES, see api/_plans.js) makes the first days
// free as a Stripe trial, once per account: {error: "promo"} for a code that
// isn't valid, {error: "promo-used"} when the account has had a plan before.
"use strict";

const { env, supabaseReady, stripeReady, sendJson, siteUrl, db, currentUser, stripe, readForm } = require("./_lib.js");
const { promoDays } = require("./_plans.js");

const PRICE_ENV = { starter: "STRIPE_PRICE_STARTER", pro: "STRIPE_PRICE_PRO", max: "STRIPE_PRICE_MAX" };

// The first id when the variable lists several (see api/_plans.js).
function priceOf(name) {
  return env(name).split(",")[0].trim();
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "method" });
  }
  if (!supabaseReady() || !stripeReady()) return sendJson(res, 503, { error: "not-configured" });

  const user = await currentUser(req);
  if (!user) return sendJson(res, 401, { error: "signin" });

  const body = await readForm(req);
  const plan = PRICE_ENV[body.plan] ? body.plan : "starter";
  const price = priceOf(PRICE_ENV[plan]);
  if (!price) return sendJson(res, 400, { error: "plan" });
  const lineItems = { 0: { price, quantity: 1 } };
  const promo = String(body.promo || "").trim();
  const promoFree = promo ? promoDays(promo) : 0;
  if (promo && !promoFree) return sendJson(res, 400, { error: "promo" });
  const dir = body.lang === "es" || body.lang === "pt" ? body.lang + "/" : "";
  const base = siteUrl(req) + "/" + dir + "account.html";

  try {
    const subs = await db("subscriptions?owner_id=eq." + encodeURIComponent(user.id) + "&select=*");
    const existing = subs && subs[0];
    if (existing && ["active", "trialing", "past_due"].includes(existing.status)) {
      return sendJson(res, 409, { error: "already-subscribed" });
    }
    // One free trial per account: not again after an earlier subscription.
    const firstPlan = !(existing && existing.stripe_subscription_id);
    if (promoFree && !firstPlan) return sendJson(res, 409, { error: "promo-used" });
    const trialDays = promoFree || Number(env("TRIAL_DAYS")) || 0;
    const session = await stripe("checkout/sessions", {
      mode: "subscription",
      line_items: lineItems,
      success_url: base + "?checkout=success",
      cancel_url: base + "?checkout=cancelled",
      client_reference_id: user.id,
      customer: existing && existing.stripe_customer_id ? existing.stripe_customer_id : undefined,
      customer_email: existing && existing.stripe_customer_id ? undefined : user.email,
      subscription_data: {
        metadata: {
          owner_id: user.id,
          plan,
          promo: promoFree ? promo.toUpperCase() : undefined,
        },
        trial_period_days: trialDays > 0 && firstPlan ? trialDays : undefined,
      },
      metadata: { owner_id: user.id, promo: promoFree ? promo.toUpperCase() : undefined },
    });
    return sendJson(res, 200, { url: session.url });
  } catch (e) {
    console.error(e);
    return sendJson(res, 502, { error: "stripe" });
  }
};
