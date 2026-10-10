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
//
// One subscription per account: api/checkout.js refuses a second checkout
// while one is running, but two Checkout tabs opened before either paid can
// both complete. So before a live subscription is recorded, the one the
// account already has on file is checked with Stripe; when both still run,
// the newer one is cancelled (one log line names both), and the older one
// is what the account keeps. Its proration/refund is the owner's call in
// the Stripe dashboard.
"use strict";

const {
  env,
  supabaseReady,
  sendJson,
  sendError,
  stripe,
  verifyStripeSignature,
  readRawBody,
  refuseMethod,
} = require("./_lib.js");
const { LIVE_STATUSES, saveSubscription, subscriptionOf } = require("./_subscriptions.js");

// Records `sub` for its owner, unless the owner already has another
// subscription Stripe still runs: then the newer of the two is cancelled and
// the older one is recorded (as Stripe has it now). Resolves what
// saveSubscription does (false when the owner's account is gone).
async function recordSubscription(ownerId, sub) {
  if (!ownerId || !sub) return false;
  if (LIVE_STATUSES.includes(sub.status)) {
    const existing = await subscriptionOf(ownerId, "stripe_subscription_id,status");
    const otherId = existing && existing.stripe_subscription_id;
    if (otherId && otherId !== sub.id && LIVE_STATUSES.includes(existing.status)) {
      // Stripe's word, not the row's: the row may lag an event still on its
      // way. One Stripe no longer knows (a test-mode object wiped) isn't live.
      const other = await stripe("subscriptions/" + encodeURIComponent(otherId)).catch((e) => {
        if (e && e.status === 404) return null;
        throw e;
      });
      if (other && !other.deleted && LIVE_STATUSES.includes(other.status)) {
        const newer = (sub.created || 0) >= (other.created || 0) ? sub : other;
        const older = newer === sub ? other : sub;
        console.warn(
          JSON.stringify({
            level: "warn",
            error: "duplicate-subscription",
            message: "Two live subscriptions for one account: cancelling the newer one.",
            ownerId,
            kept: older.id,
            cancelled: newer.id,
          }),
        );
        await stripe("subscriptions/" + encodeURIComponent(newer.id), undefined, "DELETE");
        return saveSubscription(ownerId, older);
      }
    }
  }
  return saveSubscription(ownerId, sub);
}

module.exports = async function handler(req, res) {
  if (refuseMethod(req, res, "POST")) return;
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
      recorded = await recordSubscription(obj.client_reference_id || (obj.metadata && obj.metadata.owner_id), sub);
    } else if (/^customer\.subscription\.(created|updated|deleted)$/.test(event.type)) {
      // Stripe doesn't promise events arrive in order, so record the
      // subscription as it is now rather than as this (maybe older) event saw it.
      const sub = await stripe("subscriptions/" + encodeURIComponent(obj.id));
      recorded = await recordSubscription(
        (sub.metadata && sub.metadata.owner_id) || (obj.metadata && obj.metadata.owner_id),
        sub,
      );
    }
    return sendJson(res, 200, recorded ? { received: true } : { received: true, ignored: "owner-gone" });
  } catch (e) {
    // A 500 makes Stripe retry later.
    return sendError(req, res, 500, { error: "server" }, e, { id: (obj.metadata && obj.metadata.owner_id) || null });
  }
};
