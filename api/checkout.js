// POST /api/checkout {plan: "starter"|"pro"|"max", promo: "", lang: ""|"es"|"pt"}
// with the signed-in user's Supabase access token as a Bearer token.
// Starts a Stripe Checkout subscription and answers {url} to send them to.
// A valid promo code (PROMO_CODES, see api/_plans.js) makes the first days
// free as a Stripe trial, once per account: {error: "promo"} for a code that
// isn't valid, {error: "promo-used"} when the account has had a plan before.
//
// One subscription per account: before a session is made, Stripe itself is
// asked whether this account's customer already has a subscription that's
// running (so a webhook that hasn't arrived yet, or a second tab, can't
// buy a second one). If it has, the answer is 409 {error: "already-subscribed"}
// and that subscription is recorded right away.
//
// 503 {error: "paused"} while the checkout switch is off (api/_switches.js).
"use strict";

const {
  env,
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
  logError,
} = require("./_lib.js");
const { promoDays } = require("./_plans.js");
const { isOff, pausedBody, switches } = require("./_switches.js");
const { LIVE_STATUSES, saveSubscription } = require("./_subscriptions.js");

const PRICE_ENV = { starter: "STRIPE_PRICE_STARTER", pro: "STRIPE_PRICE_PRO", max: "STRIPE_PRICE_MAX" };

// The first id when the variable lists several (see api/_plans.js).
function priceOf(name) {
  return env(name).split(",")[0].trim();
}

// A subscription of this account's that Stripe still runs, if any: on the
// customer we have on file, or on any Stripe customer with their email (the
// first checkout's customer is only known once its webhook has landed).
async function liveStripeSubscription(user, existing) {
  const customers = [];
  if (existing && existing.stripe_customer_id) {
    const c = await stripe(
      "customers/" + encodeURIComponent(existing.stripe_customer_id),
      { expand: { 0: "subscriptions" } },
      "GET",
    );
    if (c && !c.deleted) customers.push(c);
  } else if (user.email) {
    const list = await stripe(
      "customers",
      { email: user.email, limit: 10, expand: { 0: "data.subscriptions" } },
      "GET",
    );
    customers.push(...((list && list.data) || []));
  }
  for (const c of customers) {
    const subs = (c.subscriptions && c.subscriptions.data) || [];
    const live = subs.find((s) => LIVE_STATUSES.includes(s.status));
    if (live) return live;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "method" });
  }
  if (!supabaseReady() || !stripeReady()) return sendJson(res, 503, { error: "not-configured" });

  let user;
  try {
    if (await isOff("checkout")) return sendJson(res, 503, pausedBody("checkout", await switches()));
    user = await requireUser(req, res);
    if (!user) return;

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

    let subs;
    try {
      subs = await db("subscriptions?owner_id=eq." + encodeURIComponent(user.id) + "&select=*");
    } catch (e) {
      return sendError(req, res, 502, { error: "server" }, e, user);
    }
    const existing = subs && subs[0];
    if (existing && LIVE_STATUSES.includes(existing.status)) {
      return sendJson(res, 409, { error: "already-subscribed" });
    }
    try {
      const live = await liveStripeSubscription(user, existing);
      if (live) {
        // The webhook hasn't recorded it yet: do it now so the account page sees it.
        await saveSubscription(user.id, live).catch((e) => logError(req, e, { error: "record", userId: user.id }));
        return sendJson(res, 409, { error: "already-subscribed" });
      }
      // One free trial per account: not again after an earlier subscription.
      const firstPlan = !(existing && existing.stripe_subscription_id);
      if (promoFree && !firstPlan) return sendJson(res, 409, { error: "promo-used" });
      const trialDays = promoFree || Number(env("TRIAL_DAYS")) || 0;
      const customer = existing && existing.stripe_customer_id ? existing.stripe_customer_id : undefined;
      const session = await stripe(
        "checkout/sessions",
        {
          mode: "subscription",
          line_items: lineItems,
          success_url: base + "?checkout=success",
          cancel_url: base + "?checkout=cancelled",
          client_reference_id: user.id,
          customer,
          customer_email: customer ? undefined : user.email,
          subscription_data: {
            metadata: {
              owner_id: user.id,
              plan,
              promo: promoFree ? promo.toUpperCase() : undefined,
            },
            trial_period_days: trialDays > 0 && firstPlan ? trialDays : undefined,
          },
          metadata: { owner_id: user.id, promo: promoFree ? promo.toUpperCase() : undefined },
        },
        "POST",
        {
          // Everything the session is made from is in the key: Stripe refuses
          // a reused key with different parameters, so a retry in another
          // language or with another code must be a new key, not an error.
          idempotencyKey: idempotencyKey([
            "checkout",
            user.id,
            plan,
            price,
            promoFree ? promo.toUpperCase() : "",
            promoFree,
            trialDays,
            customer || "",
            base,
          ]),
        },
      );
      return sendJson(res, 200, { url: session.url });
    } catch (e) {
      return sendError(req, res, 502, { error: "stripe" }, e, user);
    }
  } catch (e) {
    return sendError(req, res, 502, { error: "server" }, e, user);
  }
};
