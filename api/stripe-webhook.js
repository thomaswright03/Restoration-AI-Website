// POST /api/stripe-webhook: Stripe tells us when a subscription starts,
// changes or ends, and we record its status in Supabase (subscriptions
// table). A business's designer is live while its status is active or
// trialing. In Stripe, point a webhook at https://<site>/api/stripe-webhook
// for: checkout.session.completed, customer.subscription.created,
// customer.subscription.updated, customer.subscription.deleted.
"use strict";

const { env, supabaseReady, sendJson, db, stripe, verifyStripeSignature, readRawBody } = require("./_lib.js");
const { planFromPrice } = require("./_plans.js");

function periodEnd(sub) {
  const item = sub.items && sub.items.data && sub.items.data[0];
  const seconds = sub.current_period_end || (item && item.current_period_end);
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

// The plan's line item (older subscriptions may also carry the retired
// "Put it on your website" add-on, which isn't a plan).
function planItem(sub) {
  const items = (sub.items && sub.items.data) || [];
  return items.find((i) => planFromPrice(i.price)) || items[0];
}

async function saveSubscription(ownerId, sub) {
  if (!ownerId) return;
  const item = planItem(sub);
  // Only when the price names its plan, so a plan set by hand isn't wiped.
  const plan = planFromPrice(item && item.price) || undefined;
  await db("subscriptions?on_conflict=owner_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: {
      owner_id: ownerId,
      stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer && sub.customer.id,
      stripe_subscription_id: sub.id,
      status: sub.status,
      price_id: item && item.price ? item.price.id : null,
      plan,
      current_period_end: periodEnd(sub),
      cancel_at_period_end: !!sub.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    },
  });
}

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
  const event = JSON.parse(raw);
  const obj = event.data && event.data.object;

  try {
    if (event.type === "checkout.session.completed" && obj.mode === "subscription" && obj.subscription) {
      const sub = await stripe("subscriptions/" + encodeURIComponent(obj.subscription));
      await saveSubscription(obj.client_reference_id || (obj.metadata && obj.metadata.owner_id), sub);
    } else if (/^customer\.subscription\.(created|updated|deleted)$/.test(event.type)) {
      // Stripe doesn't promise events arrive in order, so record the
      // subscription as it is now rather than as this (maybe older) event saw it.
      const sub = await stripe("subscriptions/" + encodeURIComponent(obj.id));
      await saveSubscription((sub.metadata && sub.metadata.owner_id) || (obj.metadata && obj.metadata.owner_id), sub);
    }
    return sendJson(res, 200, { received: true });
  } catch (e) {
    console.error(e);
    // A 500 makes Stripe retry later.
    return sendJson(res, 500, { error: "server" });
  }
};
