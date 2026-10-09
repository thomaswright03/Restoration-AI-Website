// POST /api/checkout {plan: "starter"|"pro"|"max", website: true|false, promo: "", lang: ""|"es"|"pt"}
// with the signed-in user's Supabase access token as a Bearer token.
// Starts a Stripe Checkout subscription and answers {url} to send them to.
// A valid promo code (PROMO_CODES, see api/_plans.js) makes the first days
// free as a Stripe trial, once per account: {error: "promo"} for a code that
// isn't valid, {error: "promo-used"} when the account has had a plan before.
//
// POST /api/checkout {addon: "website"}: adds "Put it on your website" to the
// subscription they already have (Stripe prorates it on the next invoice)
// and answers {ok: true}; the designer link and embed code unlock at once.
"use strict";

const { env, supabaseReady, stripeReady, sendJson, siteUrl, db, currentUser, stripe, readForm } = require("./_lib.js");
const { planOf, websiteOf, promoDays } = require("./_plans.js");

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
  if (body.addon === "website") return addWebsite(req, res, user);
  const plan = PRICE_ENV[body.plan] ? body.plan : "starter";
  const price = priceOf(PRICE_ENV[plan]);
  if (!price) return sendJson(res, 400, { error: "plan" });
  // "Put it on your website": an add-on, already part of Max.
  const website =
    plan !== "max" && (body.website === true || body.website === "true") ? env("STRIPE_PRICE_WEBSITE") : "";
  const lineItems = { 0: { price, quantity: 1 } };
  if (website) lineItems[1] = { price: website, quantity: 1 };
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
          website: plan === "max" || website ? "yes" : "no",
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

async function addWebsite(req, res, user) {
  const price = priceOf("STRIPE_PRICE_WEBSITE");
  if (!price) return sendJson(res, 400, { error: "plan" });
  try {
    const subs = await db("subscriptions?owner_id=eq." + encodeURIComponent(user.id) + "&select=*");
    const sub = subs && subs[0];
    if (planOf(sub) === "free") return sendJson(res, 409, { error: "no-plan" });
    if (websiteOf(sub)) return sendJson(res, 200, { ok: true, already: true });
    // A plan set by hand (no Stripe subscription) has nothing to add it to.
    if (!sub.stripe_subscription_id) return sendJson(res, 409, { error: "no-stripe" });
    await stripe("subscription_items", {
      subscription: sub.stripe_subscription_id,
      price,
      quantity: 1,
      proration_behavior: "create_prorations",
    });
    await stripe("subscriptions/" + encodeURIComponent(sub.stripe_subscription_id), { metadata: { website: "yes" } });
    // The webhook records it too; this makes it true before that arrives.
    await db("subscriptions?owner_id=eq." + encodeURIComponent(user.id), {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: { website: true, updated_at: new Date().toISOString() },
    });
    return sendJson(res, 200, { ok: true });
  } catch (e) {
    console.error(e);
    return sendJson(res, 502, { error: "stripe" });
  }
}
