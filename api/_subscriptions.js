// @ts-check
// Recording a Stripe subscription in the subscriptions table (the webhook's
// job, api/stripe-webhook.js; api/checkout.js also does it when it finds a
// live subscription the webhook hasn't delivered yet), reading an account's
// row, what counts as a subscription that's still running, and which
// business a designer link opens (api/business.js).
"use strict";

const crypto = require("node:crypto");
const { db } = require("./_lib.js");
const { planFromPrice, planFromPriceId, hasPlan } = require("./_plans.js");

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
//
// subscriptions.free_week_ends comes from a later schema change. Until
// supabase/schema.sql has been re-run, a select that names it is refused
// (400, column does not exist); the read is then repeated without it, so the
// plan is computed with no free week rather than failing, and a loud
// warning goes to the log.
async function subscriptionOf(ownerId, select = "*") {
  const path = "subscriptions?owner_id=eq." + encodeURIComponent(ownerId) + "&select=";
  let rows;
  try {
    rows = await db(path + select);
  } catch (e) {
    const all = select.split(",");
    const cols = all.filter((c) => c.trim() !== "free_week_ends");
    if (cols.length === all.length || !/free_week_ends/.test(String(e && e.message))) throw e;
    console.warn(
      JSON.stringify({
        level: "warn",
        error: "schema-missing-free-week",
        message:
          "subscriptions.free_week_ends is missing: re-run supabase/schema.sql. Free weeks are ignored until then.",
      }),
    );
    rows = await db(path + cols.join(","));
  }
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
  if (price && price.id && !plan) {
    // Kept quiet it would look like a plan change that never showed: the
    // row keeps its plan, and the owner gets a line to act on.
    console.warn(
      JSON.stringify({
        level: "warn",
        error: "unmapped-price",
        message:
          "Subscription moved onto a price that names no plan (no lookup_key or metadata.plan, and not in " +
          "STRIPE_PRICE_*): the stored plan is kept. Give the price a lookup key or set subscriptions.plan by hand.",
        priceId: price.id,
        ownerId,
        subscriptionId: sub.id,
      }),
    );
  }
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
  const sub = await subscriptionOf(biz.owner_id, "status,free_week_ends");
  if (!hasPlan(sub)) return { inactive: true, business: biz };
  return biz;
}

// One free trial per email, even across a deleted and re-made account:
// deleting an account that ever had a Stripe subscription leaves a one-way
// SHA-256 of its email in used_trials (the auth.users trigger in
// supabase/schema.sql, which hashes the same trimmed, lower-cased email).
// The free week at sign-up records the hash of emailKey() instead, so
// name+1@ and n.a.m.e@gmail.com count as the same person.
function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function emailHash(email) {
  return sha256(
    String(email || "")
      .trim()
      .toLowerCase(),
  );
}

// The email with what a person can vary at will taken out: a +tag, and
// Gmail's dots. Must match public.email_key() in supabase/schema.sql.
function emailKey(email) {
  const e = String(email || "")
    .trim()
    .toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return e;
  let local = e.slice(0, at).split("+")[0];
  let domain = e.slice(at + 1);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replace(/\./g, "");
    domain = "gmail.com";
  }
  return local + "@" + domain;
}

// Whether this email (or its emailKey) already had a free trial or free
// week. A database that hasn't had the table added yet (schema.sql not
// re-run: PostgREST answers 404) counts as no, with a warning, so checkout
// keeps working.
async function trialUsedBefore(email) {
  if (!email) return false;
  try {
    const hashes = [...new Set([emailHash(email), sha256(emailKey(email))])];
    const rows = await db("used_trials?email_hash=in.(" + hashes.join(",") + ")&select=email_hash");
    return !!(rows && rows.length);
  } catch (e) {
    if (/Supabase 404|PGRST205|42P01/.test(String(e && e.message))) {
      console.warn(
        JSON.stringify({
          level: "warn",
          error: "used-trials-missing",
          message: "used_trials table not found: re-run supabase/schema.sql. Free trials aren't checked by email.",
        }),
      );
      return false;
    }
    throw e;
  }
}

module.exports = {
  LIVE_STATUSES,
  emailHash,
  emailKey,
  trialUsedBefore,
  periodEnd,
  planItem,
  subscriptionOf,
  saveSubscription,
  ownerGone,
  activeBusiness,
};
