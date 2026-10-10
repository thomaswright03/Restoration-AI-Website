// Recording a Stripe subscription in the subscriptions table (the webhook's
// job, api/stripe-webhook.js; api/checkout.js also does it when it finds a
// live subscription the webhook hasn't delivered yet), reading an account's
// row, what counts as a subscription that's still running, and which
// business a designer link opens (api/business.js).
"use strict";

const { db } = require("./_lib.js");
const { planFromPrice, planFromPriceId, ACTIVE_STATUSES } = require("./_plans.js");

// Statuses under which Stripe may still bill, or may start to: an account
// with one of these must not start another subscription. incomplete is a
// first payment still being confirmed (a card check in another tab); it
// expires on its own within a day if it never goes through, and until then a
// second checkout could leave the account paying twice.
const LIVE_STATUSES = ["active", "trialing", "past_due", "unpaid", "paused", "incomplete"];

// Pinned to STRIPE_API_VERSION (api/_lib.js): since 2025-03-31.basil the
// period end lives on each item; older shapes carried it on the subscription.
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

// The account's subscriptions row (one per owner), or null. `select` is the
// PostgREST column list.
async function subscriptionOf(ownerId, select = "*") {
  const rows = await db("subscriptions?owner_id=eq." + encodeURIComponent(ownerId) + "&select=" + select);
  return (rows && rows[0]) || null;
}

// Supabase refuses a row for an owner that no longer exists (the account
// was deleted; the auth user is gone and so is the foreign key's target).
function ownerGone(e) {
  return /23503|foreign key|is not present in table/i.test(String(e && e.message));
}

// Records the subscription as Stripe has it. Resolves false when the owner's
// account no longer exists (nothing to record; not an error).
async function saveSubscription(ownerId, sub) {
  if (!ownerId || !sub) return false;
  const item = planItem(sub);
  // Only when the price names its plan (by lookup key or metadata, or by the
  // STRIPE_PRICE_* lists), so a plan set by hand isn't wiped.
  const price = item && item.price;
  const plan = planFromPrice(price) || planFromPriceId(price && price.id) || undefined;
  try {
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
    return true;
  } catch (e) {
    if (ownerGone(e)) {
      console.warn("subscription " + sub.id + " belongs to a deleted account " + ownerId + "; ignored");
      return false;
    }
    throw e;
  }
}

// A business by its slug, or null when there's no such business. One without
// an active plan comes back as { inactive: true, business }: its owner sees
// their designer as a preview (api/business.js).
async function activeBusiness(slug) {
  if (!/^[a-z0-9-]{1,64}$/.test(slug || "")) return null;
  const rows = await db(
    "businesses?slug=eq." + encodeURIComponent(slug) + "&select=id,owner_id,slug,name,phone,email,legal_name,prices",
  );
  const biz = rows && rows[0];
  if (!biz) return null;
  const sub = await subscriptionOf(biz.owner_id, "status");
  if (!sub || !ACTIVE_STATUSES.includes(sub.status)) return { inactive: true, business: biz };
  return biz;
}

module.exports = {
  LIVE_STATUSES,
  periodEnd,
  planItem,
  subscriptionOf,
  saveSubscription,
  ownerGone,
  activeBusiness,
};
