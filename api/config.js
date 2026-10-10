// GET /api/config: what the browser needs to sign people in (the Supabase
// project URL and its public anon key, both safe to share), whether
// payments are switched on, and the kill switches (api/_switches.js): which
// of sign-ups, checkout and saving are paused right now, and a notice to
// show. Missing keys = the site runs in demo mode. ?fresh=1 reads the
// switches again past their 15 s cache: the sign-up page asks that way when
// a sign-up was just refused, so it can say "paused" the moment the switch
// is off instead of calling it a service problem.
"use strict";

const { env, supabaseReady, stripeReady, sendJson } = require("./_lib.js");
const { promoCodes, firstPriceId } = require("./_plans.js");
const { switches } = require("./_switches.js");

module.exports = async function handler(req, res) {
  const ready = supabaseReady();
  const fresh = String((req.query && req.query.fresh) || "") === "1";
  const s = await switches(Date.now(), fresh);
  sendJson(res, 200, {
    accounts: ready,
    payments: ready && stripeReady(),
    supabaseUrl: ready ? env("SUPABASE_URL") : "",
    supabaseAnonKey: ready ? env("SUPABASE_ANON_KEY") : "",
    // Which plans have a Stripe price to sell (api/_plans.js).
    plans: {
      starter: !!firstPriceId("starter"),
      pro: !!firstPriceId("pro"),
      max: !!firstPriceId("max"),
    },
    trialDays: Number(env("TRIAL_DAYS")) || 0,
    // Whether checkout takes promo codes (the codes themselves stay private).
    promo: Object.keys(promoCodes()).length > 0,
    switches: { signups: s.signups, checkout: s.checkout, saving: s.saving },
    notice: s.notice,
  });
};
