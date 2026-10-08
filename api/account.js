// POST /api/account {action: "delete", confirm: "<their sign-in email>"}
// with the signed-in user's Supabase access token as a Bearer token:
// closes the account for good. Their Stripe subscription is cancelled first
// (so nobody keeps paying for an account that's gone), then the auth user
// is deleted with the service role key; supabase/schema.sql cascades that
// to the business, its leads, the subscription row and every project.
// Stripe keeps the customer and invoices, as billing records must be kept.
"use strict";

const { env, supabaseReady, sendJson, db, currentUser, stripe, readForm } = require("./_lib.js");

async function cancelStripe(sub) {
  if (!sub || !sub.stripe_subscription_id || !env("STRIPE_SECRET_KEY")) return;
  if (["canceled", "incomplete_expired"].includes(sub.status)) return;
  try {
    await stripe("subscriptions/" + encodeURIComponent(sub.stripe_subscription_id), undefined, "DELETE");
  } catch (e) {
    // Already cancelled in Stripe is fine; anything else stops the deletion.
    if (!/No such subscription|already been canceled|canceled subscription/i.test(String(e.message))) throw e;
  }
}

async function deleteAuthUser(id) {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const res = await fetch(env("SUPABASE_URL") + "/auth/v1/admin/users/" + encodeURIComponent(id), {
    method: "DELETE",
    headers: { apikey: key, Authorization: "Bearer " + key },
  });
  if (!res.ok && res.status !== 404)
    throw new Error("Supabase auth " + res.status + ": " + (await res.text()).slice(0, 300));
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "method" });
  }
  if (!supabaseReady()) return sendJson(res, 503, { error: "not-configured" });
  const user = await currentUser(req);
  if (!user) return sendJson(res, 401, { error: "signin" });

  const body = await readForm(req);
  if (body.action !== "delete") return sendJson(res, 400, { error: "action" });
  // The page asks them to type their email; the server checks it too.
  const confirm = String(body.confirm || "")
    .trim()
    .toLowerCase();
  if (!confirm || confirm !== String(user.email || "").toLowerCase()) return sendJson(res, 400, { error: "confirm" });

  try {
    const subs = await db("subscriptions?owner_id=eq." + encodeURIComponent(user.id) + "&select=*");
    await cancelStripe(subs && subs[0]);
  } catch (e) {
    console.error(e);
    return sendJson(res, 502, { error: "stripe" });
  }
  try {
    await deleteAuthUser(user.id);
    return sendJson(res, 200, { deleted: true });
  } catch (e) {
    console.error(e);
    return sendJson(res, 500, { error: "server" });
  }
};
