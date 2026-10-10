// POST /api/portal {lang} with the signed-in user's Supabase access token:
// opens Stripe's billing portal (change card, switch plan, cancel, invoices).
// 404 {error: "no-customer"} for an account that never bought a plan. The
// portal session is created with an idempotency key, so a transient Stripe
// failure is tried once more (api/_lib.js stripe()). The whole request runs
// inside one time budget (api/_lib.js withBudget), like api/checkout.js.
"use strict";

const {
  supabaseReady,
  stripeReady,
  sendJson,
  sendError,
  siteUrl,
  requireUser,
  stripe,
  idempotencyKey,
  readForm,
  langDir,
  refuseMethod,
  withBudget,
} = require("./_lib.js");
const { subscriptionOf } = require("./_subscriptions.js");

module.exports = async function handler(req, res) {
  if (refuseMethod(req, res, "POST")) return;
  if (!supabaseReady() || !stripeReady()) return sendJson(res, 503, { error: "not-configured" });
  return withBudget(0, () => portal(req, res));
};

async function portal(req, res) {
  let user;
  try {
    user = await requireUser(req, res);
    if (!user) return;
    const body = await readForm(req);
    const dir = langDir(body.lang);

    let customer;
    try {
      const sub = await subscriptionOf(user.id, "stripe_customer_id");
      customer = sub && sub.stripe_customer_id;
    } catch (e) {
      return sendError(req, res, 502, { error: "server" }, e, user);
    }
    if (!customer) return sendJson(res, 404, { error: "no-customer" });
    try {
      const session = await stripe(
        "billing_portal/sessions",
        { customer, return_url: siteUrl(req) + "/" + dir + "account.html" },
        "POST",
        { idempotencyKey: idempotencyKey(["portal", user.id, dir]) },
      );
      return sendJson(res, 200, { url: session.url });
    } catch (e) {
      return sendError(req, res, 502, { error: "stripe" }, e, user);
    }
  } catch (e) {
    return sendError(req, res, 502, { error: "server" }, e, user);
  }
}
