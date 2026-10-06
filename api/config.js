// GET /api/config: what the browser needs to sign people in (the Supabase
// project URL and its public anon key, both safe to share) and whether
// payments are switched on. Missing keys = the site runs in demo mode.
"use strict";

const { env, supabaseReady, stripeReady, sendJson } = require("./_lib.js");

module.exports = function handler(req, res) {
  const ready = supabaseReady();
  sendJson(res, 200, {
    accounts: ready,
    payments: ready && stripeReady(),
    supabaseUrl: ready ? env("SUPABASE_URL") : "",
    supabaseAnonKey: ready ? env("SUPABASE_ANON_KEY") : "",
    plans: { monthly: !!env("STRIPE_PRICE_MONTHLY"), yearly: !!env("STRIPE_PRICE_YEARLY") },
    trialDays: Number(env("TRIAL_DAYS")) || 0,
  });
};
