// @ts-check
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
// Which plan a subscription is on: the plan its current Stripe price maps
// to, by any route: the price id matched against STRIPE_PRICE_STARTER /
// _PRO / _MAX (comma-separated lists allowed), else subscriptions.plan (the
// Stripe webhook fills it from the price's lookup key or "plan" metadata, or
// it can be set by hand). The price comes first so a plan switched in Stripe
// onto a price that only the env lists know is never held back by the plan
// stored from before. A price that matches nothing is a setup mistake (a
// price made in Stripe without a lookup key or metadata, and not in the env
// lists): the account gets Starter, the smallest paid plan (they did pay for
// a plan, so saving isn't refused), and every plan lookup for it logs a
// warning naming the price id and the owner, so the owner can set
// subscriptions.plan by hand or fix the price. It is never silent.
//
// A business's designer opens only for its signed-in owner, on every plan.
"use strict";

/** @type {Record<string, any>} */
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

// Statuses under which an account may save projects (and a business's
// designer is live rather than a preview).
const ACTIVE_STATUSES = ["active", "trialing"];

// The env variable that lists each plan's Stripe price id(s).
const PRICE_ENV = { starter: "STRIPE_PRICE_STARTER", pro: "STRIPE_PRICE_PRO", max: "STRIPE_PRICE_MAX" };

// The price ids a STRIPE_PRICE_* variable lists (comma-separated).
function priceList(name) {
  return String(process.env[name] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// The price id checkout sells for a plan: the first one its variable lists.
// "" for a plan that isn't a known one or has no price set.
function firstPriceId(plan) {
  return PRICE_ENV[plan] ? priceList(PRICE_ENV[plan])[0] || "" : "";
}

// "starter" | "pro" | "max" for a price id one of the STRIPE_PRICE_* lists
// names, or "" when none does.
function planFromPriceId(priceId) {
  if (!priceId) return "";
  for (const plan of Object.keys(PRICE_ENV)) {
    if (priceList(PRICE_ENV[plan]).includes(priceId)) return plan;
  }
  return "";
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
  if (!sub || !ACTIVE_STATUSES.includes(sub.status)) return "free";
  const mapped = planFromPriceId(sub.price_id);
  if (mapped) return mapped;
  if (sub.plan && PLANS[sub.plan] && sub.plan !== "free") return sub.plan;
  console.warn(
    JSON.stringify({
      level: "warn",
      error: "unmapped-plan",
      message:
        "Subscription price isn't mapped to a plan (no plan column, lookup_key or metadata.plan, and not in " +
        "STRIPE_PRICE_*): treating it as Starter. Set subscriptions.plan by hand or fix the price.",
      priceId: sub.price_id || null,
      ownerId: sub.owner_id || null,
      subscriptionId: sub.stripe_subscription_id || null,
    }),
  );
  return "starter";
}

function limitsOf(plan) {
  return PLANS[plan] || PLANS.free;
}

// Promo codes that make the first days of a new account's first plan free
// (a Stripe trial; the card is taken at checkout and first charged when it
// ends). PROMO_CODES lists them, comma-separated, each optionally with its
// own number of days: "FREEWEEK" or "FREEWEEK,LAUNCH30:30". Without a number
// a code gives site-config.json plans.promoFreeDays (7). Unset, the one code
// is FREEWEEK; set it to "none" to turn promo codes off.
const DEFAULT_PROMO_CODES = "FREEWEEK";

function promoCodes() {
  const fallback = Number(CONFIG.promoFreeDays) > 0 ? Math.floor(Number(CONFIG.promoFreeDays)) : 7;
  const raw = String(process.env.PROMO_CODES || "").trim() || DEFAULT_PROMO_CODES;
  const codes = {};
  for (const entry of raw.split(",")) {
    const [code, days] = entry.split(":").map((s) => s.trim());
    if (!code || code.toLowerCase() === "none") continue;
    const n = Math.floor(Number(days));
    codes[code.toUpperCase()] = days ? (n > 0 && n <= 730 ? n : 0) : fallback;
  }
  return codes;
}

// Free days for a code someone typed (any case, spaces ignored), or 0.
function promoDays(code) {
  const key = String(code || "")
    .replace(/\s+/g, "")
    .toUpperCase();
  return (key && promoCodes()[key]) || 0;
}

module.exports = {
  ACTIVE_STATUSES,
  PRICE_ENV,
  priceList,
  firstPriceId,
  planFromPriceId,
  planFromPrice,
  planOf,
  limitsOf,
  promoCodes,
  promoDays,
};
