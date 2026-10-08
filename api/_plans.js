// The plans and how many projects each may save. A project is one saved
// design in a subscriber's account (api/projects.js). The limits come from
// site-config.json "plans" (newPerMonth, maxProjects), the same numbers the
// pricing section shows.
//
//   monthly  new projects a month (calendar month, UTC). Deleting a project
//            does not give one back.
//   total    projects kept at any one time. Deleting one frees a slot.
//
// Free accounts (no paid plan, or one that isn't active) can use the
// designer but can't save projects.
//
// Which plan a subscription is on: subscriptions.plan when set (the Stripe
// webhook fills it from the price's lookup key or "plan" metadata, or it can
// be set by hand), else its Stripe price id matched against
// STRIPE_PRICE_PRO / STRIPE_PRICE_MAX (comma-separated lists allowed), else
// Starter.
//
// "Put it on your website" (the designer link and embed code for homeowners)
// is an add-on: STRIPE_PRICE_WEBSITE, added at checkout, recorded as
// subscriptions.website by the webhook (or set by hand); Max includes it
// (site-config.json plans.max.websiteIncluded). Without it, a business's
// designer opens only for its signed-in owner.
"use strict";

const CONFIG = require("../site-config.json").plans || {};

function limits(name, fallback) {
  const p = CONFIG[name] || {};
  const monthly = Number(p.newPerMonth);
  const total = Number(p.maxProjects);
  return {
    monthly: monthly > 0 ? monthly : fallback.monthly,
    total: total > 0 ? total : fallback.total,
  };
}

const PLANS = {
  free: { monthly: 0, total: 0 },
  starter: limits("starter", { monthly: 10, total: 50 }),
  pro: limits("pro", { monthly: 25, total: 100 }),
  max: limits("max", { monthly: 100, total: 1000 }),
};

const ACTIVE = ["active", "trialing"];

function priceList(name) {
  return String(process.env[name] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// "starter" | "pro" | "max" from a Stripe price object (lookup_key or
// metadata.plan), or "" when it doesn't say.
function planFromPrice(price) {
  if (!price || typeof price !== "object") return "";
  const named = [price.metadata && price.metadata.plan, price.lookup_key];
  for (const value of named) {
    const m = /^(starter|pro|max)(?![a-z])/i.exec(String(value || ""));
    if (m) return m[1].toLowerCase();
  }
  return "";
}

// The plan a subscriptions row puts its owner on.
function planOf(sub) {
  if (!sub || !ACTIVE.includes(sub.status)) return "free";
  if (sub.plan && PLANS[sub.plan] && sub.plan !== "free") return sub.plan;
  if (sub.price_id && priceList("STRIPE_PRICE_MAX").includes(sub.price_id)) return "max";
  if (sub.price_id && priceList("STRIPE_PRICE_PRO").includes(sub.price_id)) return "pro";
  return "starter";
}

function limitsOf(plan) {
  return PLANS[plan] || PLANS.free;
}

// Whether a subscriptions row lets its owner share their designer with
// homeowners (the link and the embed code).
function websiteOf(sub) {
  const plan = planOf(sub);
  if (plan === "free") return false;
  if (plan === "max" && (CONFIG.max || {}).websiteIncluded !== false) return true;
  return sub.website === true;
}

// Is this Stripe price the website add-on? By id (STRIPE_PRICE_WEBSITE,
// comma-separated list allowed), lookup key or "addon" metadata.
function isWebsitePrice(price) {
  if (!price || typeof price !== "object") return false;
  if (price.id && priceList("STRIPE_PRICE_WEBSITE").includes(price.id)) return true;
  const named = [price.metadata && price.metadata.addon, price.lookup_key];
  return named.some((value) => /^website(?![a-z])/i.test(String(value || "")));
}

module.exports = { PLANS, planFromPrice, planOf, limitsOf, websiteOf, isWebsitePrice };
