// GET /api/config: what the browser needs to sign people in (the Supabase
// project URL and its public anon key, both safe to share) and whether
// payments are switched on. Missing keys = the site runs in demo mode.
"use strict";

const { env, supabaseReady, stripeReady, sendJson } = require("./_lib.js");

// STRIPE_PRICE_PRO / _MAX may list several price ids; checkout uses the first.
function firstPrice(name) {
  return env(name).split(",")[0].trim();
}

module.exports = function handler(req, res) {
  const ready = supabaseReady();
  sendJson(res, 200, {
    accounts: ready,
    payments: ready && stripeReady(),
    supabaseUrl: ready ? env("SUPABASE_URL") : "",
    supabaseAnonKey: ready ? env("SUPABASE_ANON_KEY") : "",
    plans: {
      starter: !!env("STRIPE_PRICE_STARTER"),
      pro: !!firstPrice("STRIPE_PRICE_PRO"),
      max: !!firstPrice("STRIPE_PRICE_MAX"),
      website: !!env("STRIPE_PRICE_WEBSITE"),
    },
    trialDays: Number(env("TRIAL_DAYS")) || 0,
  });
};
