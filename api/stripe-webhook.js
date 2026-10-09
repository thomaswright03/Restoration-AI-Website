// POST /api/stripe-webhook: Stripe tells us when a subscription starts,
// changes or ends, and we record its status in Supabase (subscriptions
// table). An account can save projects while its status is active or
// trialing. In Stripe, point a webhook at https://<site>/api/stripe-webhook
// for: checkout.session.completed, customer.subscription.created,
// customer.subscription.updated, customer.subscription.deleted.
//
// An event for an account that was deleted (its last
// customer.subscription.deleted arrives after api/account.js removed the
// user) is acknowledged with 200 and logged, so Stripe doesn't retry it for
// days.
"use strict";

const { env, supabaseReady, sendJson, stripe, verifyStripeSignature, readRawBody } = require("./_lib.js");
const { saveSubscription } = require("./_subscriptions.js");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "method" });
  }
  if (!supabaseReady() || !env("STRIPE_WEBHOOK_SECRET")) return sendJson(res, 503, { error: "not-configured" });

  const raw = await readRawBody(req);
  if (!verifyStripeSignature(raw, req.headers["stripe-signature"], env("STRIPE_WEBHOOK_SECRET"))) {
    return sendJson(res, 400, { error: "signature" });
  }
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return sendJson(res, 400, { error: "body" });
  }
  const obj = (event && event.data && event.data.object) || {};

  try {
    let recorded = true;
    if (event.type === "checkout.session.completed" && obj.mode === "subscription" && obj.subscription) {
      const sub = await stripe("subscriptions/" + encodeURIComponent(obj.subscription));
      recorded = await saveSubscription(obj.client_reference_id || (obj.metadata && obj.metadata.owner_id), sub);
    } else if (/^customer\.subscription\.(created|updated|deleted)$/.test(event.type)) {
      // Stripe doesn't promise events arrive in order, so record the
      // subscription as it is now rather than as this (maybe older) event saw it.
      const sub = await stripe("subscriptions/" + encodeURIComponent(obj.id));
      recorded = await saveSubscription(
        (sub.metadata && sub.metadata.owner_id) || (obj.metadata && obj.metadata.owner_id),
        sub,
      );
    }
    return sendJson(res, 200, recorded ? { received: true } : { received: true, ignored: "owner-gone" });
  } catch (e) {
    console.error(e);
    // A 500 makes Stripe retry later.
    return sendJson(res, 500, { error: "server" });
  }
};
