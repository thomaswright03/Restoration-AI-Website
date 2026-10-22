// @ts-check
// GET /admin/status.json (vercel.json rewrites it here): the owner's status
// page data. Every row comes from a real read-only check made now, or from a
// recorded GitHub Actions run; nothing here sends a message, charges anyone
// or writes business data. Who may read it:
//
//   Authorization: Bearer $ADMIN_STATUS_TOKEN        (read-only, for the CAO)
//   Authorization: Bearer <Supabase access token>    of a user whose email is
//                                                    in ADMIN_EMAILS (comma
//                                                    separated)
//
// Anyone else gets 401 {error: "signin"} (403 for a signed-in non-admin), and
// with neither setting configured the route answers 404 as if absent.
//
// Shape: {product, checked_at, overall, functions: [{tier, name, status,
// last_checked, last_success, next_expected_run, detail}]}. tier is
// important | key | basic; status is ok | warning | down | unknown; overall is
// the worst status among the Important rows. detail is empty when ok, else
// one line saying what to do. last_success is null when this check has not
// passed now (the route keeps no history of its own).
"use strict";

const crypto = require("node:crypto");
const {
  env,
  supabaseReady,
  stripeReady,
  sendJson,
  refuseMethod,
  fetchWithTimeout,
  db,
  currentUser,
} = require("./_lib.js");
const { switches } = require("./_switches.js");

const CHECK_MS = 4000;
const REPO = "thomaswright03/Restoration-AI-Website";
const RANK = { ok: 0, unknown: 1, warning: 2, down: 3 };
const HOUR = 3600 * 1000;

function sameSecret(given, want) {
  if (!want || typeof given !== "string") return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(want).digest();
  return crypto.timingSafeEqual(a, b);
}

function adminEmails() {
  return env("ADMIN_EMAILS")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// {allowed: true}, or {allowed: false, status} with the HTTP status to answer.
async function authorize(req) {
  const header = String(req.headers.authorization || "");
  const m = /^Bearer\s+(\S+)$/.exec(header);
  if (!m) return { allowed: false, status: 401 };
  if (sameSecret(m[1], env("ADMIN_STATUS_TOKEN"))) return { allowed: true };
  if (!adminEmails().length || !supabaseReady()) return { allowed: false, status: 401 };
  let user;
  try {
    user = await currentUser(req);
  } catch {
    return { allowed: false, status: 503 };
  }
  if (!user) return { allowed: false, status: 401 };
  const email = String(user.email || "").toLowerCase();
  return adminEmails().includes(email) ? { allowed: true } : { allowed: false, status: 403 };
}

/** @typedef {{ tier: string, name: string, status: string, last_checked: string, last_success: string|null, next_expected_run: string|null, detail: string }} Row */
/** @typedef {{ status?: string, detail?: string, last_success?: string|null, next_expected_run?: string|null }} Result */

/**
 * Runs one check; a throw is Down with the reason.
 * @param {string} tier
 * @param {string} name
 * @param {string} todo what to do when it is not OK
 * @param {() => Promise<Result|void>} fn
 * @returns {Promise<Row>}
 */
async function check(tier, name, todo, fn) {
  const at = new Date().toISOString();
  let status = "ok";
  let detail = "";
  let lastSuccess = /** @type {string|null} */ (null);
  let next = /** @type {string|null} */ (null);
  try {
    const r = (await fn()) || {};
    status = r.status || "ok";
    detail = r.detail || "";
    lastSuccess = r.last_success === undefined ? (status === "ok" ? at : null) : r.last_success;
    next = r.next_expected_run || null;
  } catch (e) {
    status = "down";
    detail = String((e && e.message) || e).slice(0, 160);
  }
  if (status !== "ok") detail = (detail ? detail + ". " : "") + todo;
  return { tier, name, status, last_checked: at, last_success: lastSuccess, next_expected_run: next, detail };
}

async function getJson(url, headers, ms = CHECK_MS) {
  const res = await fetchWithTimeout(url, { headers }, ms);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, ok: res.ok, body };
}

function need(...names) {
  const missing = names.filter((n) => !env(n));
  if (missing.length) throw new Error(missing.join(", ") + " not set");
}

async function dbRead(path) {
  need("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
  return db(path, { timeoutMs: CHECK_MS });
}

async function stripeGet(path) {
  need("STRIPE_SECRET_KEY");
  const r = await getJson("https://api.stripe.com/v1/" + path, { Authorization: "Bearer " + env("STRIPE_SECRET_KEY") });
  if (!r.ok) throw new Error("Stripe answered " + r.status);
  return r.body;
}

// The latest finished run of a workflow, from GitHub's public API. It is due
// every `everyHours`; Warning once the last good run is older than `staleHours`.
async function workflowRun(file, everyHours, staleHours) {
  /** @type {Record<string, string>} */
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "room-designer-status" };
  if (env("GITHUB_TOKEN")) headers.Authorization = "Bearer " + env("GITHUB_TOKEN");
  const r = await getJson(
    "https://api.github.com/repos/" + REPO + "/actions/workflows/" + file + "/runs?per_page=1&status=completed",
    headers,
  );
  if (!r.ok) throw new Error("GitHub answered " + r.status);
  const run = r.body && r.body.workflow_runs && r.body.workflow_runs[0];
  if (!run) return { status: "unknown", detail: "No finished run found", last_success: null };
  const at = Date.parse(run.updated_at || run.created_at);
  const next = new Date(at + everyHours * HOUR).toISOString();
  if (run.conclusion !== "success")
    return {
      status: "down",
      detail: "The last run ended " + run.conclusion,
      last_success: null,
      next_expected_run: next,
    };
  const age = Date.now() - at;
  const lastSuccess = new Date(at).toISOString();
  if (age > staleHours * HOUR)
    return {
      status: "warning",
      detail: "The last good run was " + Math.round(age / HOUR) + " h ago",
      last_success: lastSuccess,
      next_expected_run: next,
    };
  return { last_success: lastSuccess, next_expected_run: next };
}

// Stripe keeps retrying a failed delivery for days; one still failing after
// this long means the site isn't taking webhooks.
const WEBHOOK_GRACE_MS = 30 * 60 * 1000;
const WEBHOOK_LOOKBACK_DAYS = 3;

// This site's webhook endpoint in Stripe, and whether Stripe could deliver to
// it lately: Down when there's no enabled endpoint at /api/stripe-webhook, or
// when an event of a type it listens to has been undelivered for longer than
// WEBHOOK_GRACE_MS in the last WEBHOOK_LOOKBACK_DAYS days. Stripe reports
// delivery per event, not per endpoint, so on an account shared with other
// products a failure at another endpoint for the same event type also shows.
/** @returns {Promise<Result>} */
async function webhookHealth() {
  need("STRIPE_WEBHOOK_SECRET");
  const eps = await stripeGet("webhook_endpoints?limit=100");
  const ours = ((eps && eps.data) || []).filter((e) => /\/api\/stripe-webhook\/?$/.test(String(e.url || "")));
  if (!ours.length) throw new Error("No Stripe webhook endpoint points at /api/stripe-webhook");
  const on = ours.find((e) => e.status === "enabled");
  if (!on) throw new Error("The Stripe webhook endpoint is disabled");
  const listens = Array.isArray(on.enabled_events) && !on.enabled_events.includes("*") ? on.enabled_events : [];
  // Stripe's `types` filter takes at most 20 types; any beyond that go unchecked.
  const types = listens
    .slice(0, 20)
    .map((t) => "&types%5B%5D=" + encodeURIComponent(t))
    .join("");
  const since = Math.floor(Date.now() / 1000) - WEBHOOK_LOOKBACK_DAYS * 24 * 3600;
  const failed = await stripeGet("events?delivery_success=false&limit=100&created%5Bgte%5D=" + since + types);
  const stuck = ((failed && failed.data) || []).filter((e) => e.created * 1000 < Date.now() - WEBHOOK_GRACE_MS);
  const latest = await stripeGet("events?limit=1" + types);
  const last = latest && latest.data && latest.data[0];
  const lastAt = last ? new Date(last.created * 1000).toISOString() : null;
  if (stuck.length) {
    const oldest = new Date(Math.min(...stuck.map((e) => e.created * 1000))).toISOString();
    return {
      status: "down",
      detail: stuck.length + " event(s) not delivered, the oldest from " + oldest,
      last_success: null,
    };
  }
  if (!last) return { status: "unknown", detail: "Stripe has no events of these types yet", last_success: null };
  return { last_success: lastAt };
}

// The commit this function runs (Vercel sets VERCEL_GIT_COMMIT_SHA) and when
// it went live: the time of Vercel's successful GitHub deployment for that
// commit. Vercel sets no deploy-time variable of its own.
/** @returns {Promise<Result>} */
async function deployedVersion() {
  const sha = env("VERCEL_GIT_COMMIT_SHA");
  if (!sha) return { status: "unknown", detail: "Not running on Vercel", last_success: null };
  const commit = "Commit " + sha.slice(0, 7);
  /** @type {Record<string, string>} */
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "room-designer-status" };
  if (env("GITHUB_TOKEN")) headers.Authorization = "Bearer " + env("GITHUB_TOKEN");
  const base = "https://api.github.com/repos/" + REPO + "/deployments";
  const deps = await getJson(base + "?per_page=5&sha=" + encodeURIComponent(sha), headers);
  const list = Array.isArray(deps.body) ? deps.body : [];
  const want = env("VERCEL_ENV") === "production" ? "Production" : "Preview";
  const dep = list.find((d) => d.environment === want) || list[0];
  if (!deps.ok || !dep) return { status: "warning", detail: commit + " (deploy time not found)", last_success: null };
  const st = await getJson(base + "/" + dep.id + "/statuses?per_page=1", headers);
  const done = Array.isArray(st.body) && st.body.find((x) => x.state === "success");
  if (!done) return { status: "warning", detail: commit + " (deploy time not found)", last_success: null };
  return { detail: commit + ", deployed " + done.created_at, last_success: done.created_at };
}

// The assets the paid designer needs, read from the site's own origin.
/** @type {[string, RegExp][]} */
const DESIGNER_ASSETS = [
  ["/designer.html", /text\/html/],
  ["/js/studio.js", /javascript/],
  ["/js/bathroom-room-3d.js", /javascript/],
  ["/js/vendor/three-r186/three.module.js", /javascript/],
  ["/models/products/sterling/S1201-0.glb", /gltf|octet-stream/],
];

async function designerLoads(origin) {
  const bad = [];
  await Promise.all(
    DESIGNER_ASSETS.map(async ([path, type]) => {
      try {
        const r = await fetchWithTimeout(origin + path, { method: "HEAD" }, CHECK_MS);
        const ct = String((r.headers && r.headers.get && r.headers.get("content-type")) || "");
        if (r.status !== 200) bad.push(path + " answered " + r.status);
        else if (!type.test(ct)) bad.push(path + " has content type " + (ct || "none"));
      } catch {
        bad.push(path + " did not answer");
      }
    }),
  );
  if (bad.length) throw new Error(bad.sort().join("; "));
}

/** @param {string} [origin] */
async function buildStatus(origin) {
  const sw = supabaseReady() ? await switches(Date.now(), true) : null;
  /** @returns {Result} */
  const switchOff = (name, label) =>
    sw && sw[name] === false ? { status: "warning", detail: label + " is switched off in site_switches" } : {};

  const rows = await Promise.all([
    // Important
    check("important", "Saving and loading a client project", "Check Supabase and the saving switch", async () => {
      await dbRead("projects?select=id&limit=1");
      return switchOff("saving", "Saving");
    }),
    check("important", "The estimate", "Redeploy the last good version", async () => {
      const P = require("../js/bathroom-pricing.js");
      const r = P.computeEstimate(
        { Bathroom_Width_Ft: 5, Bathroom_Length_Ft: 8, Bathroom_Height_Ft: 8, Bathtub_Quantity: 1 },
        { demolition: false, floorFinish: "none", walls: "none", paintCeiling: false },
        { includeTrade: true, prices: P.DEFAULT_PRICES },
      );
      if (!(Number.isFinite(r.total) && r.total > 0)) throw new Error("The sample estimate came out as " + r.total);
    }),
    check("important", "The 3D designer loads", "Redeploy the last good version in Vercel", async () => {
      if (!origin) throw new Error("The site address is unknown");
      await designerLoads(origin);
    }),
    check("important", "Sign-up and the free week", "Check Supabase and the sign-ups switch", async () => {
      await dbRead("subscriptions?select=free_week_ends&limit=1");
      return switchOff("signups", "Sign-ups");
    }),
    check("important", "Stripe checkout", "Check the Stripe keys and prices in Vercel", async () => {
      if (!stripeReady()) throw new Error("Stripe is not set up");
      await stripeGet("balance");
      return switchOff("checkout", "Checkout");
    }),
    check("important", "Stripe webhook deliveries", "Check the webhook endpoint in the Stripe dashboard", () =>
      webhookHealth(),
    ),
    // Key
    check("key", "Stripe API", "Check STRIPE_SECRET_KEY and Stripe's status page", async () => {
      await stripeGet("balance");
    }),
    check("key", "Alert email (Resend)", "Set ALERT_EMAIL and RESEND_API_KEY in Vercel", async () => {
      need("ALERT_EMAIL", "RESEND_API_KEY");
      const r = await getJson("https://api.resend.com/domains", { Authorization: "Bearer " + env("RESEND_API_KEY") });
      // A send-only key is refused here by design; the key itself is fine.
      const sendOnly = r.status === 401 && r.body && r.body.name === "restricted_api_key";
      if (!r.ok && !sendOnly) throw new Error("Resend answered " + r.status);
    }),
    check("key", "Sign-up emails (Supabase auth)", "Check the Supabase auth email settings", async () => {
      need("SUPABASE_URL", "SUPABASE_ANON_KEY");
      const r = await getJson(env("SUPABASE_URL") + "/auth/v1/settings", { apikey: env("SUPABASE_ANON_KEY") });
      if (!r.ok) throw new Error("Supabase auth answered " + r.status);
      if (!(r.body && r.body.external && r.body.external.email)) throw new Error("Email sign-up is off");
    }),
    check("key", "Daily backup and restore check", "Open the Database backup run in GitHub Actions", () =>
      workflowRun("backup.yml", 24, 36),
    ),
    check("key", "Backup heartbeat", "Open the Backup heartbeat run in GitHub Actions", () =>
      workflowRun("backup-heartbeat.yml", 24, 36),
    ),
    // Basic
    check("basic", "Database query", "Check Supabase", async () => {
      await dbRead("site_switches?select=id&limit=1");
    }),
    check("basic", "Sign-in", "Check Supabase auth", async () => {
      need("SUPABASE_URL", "SUPABASE_ANON_KEY");
      const r = await getJson(env("SUPABASE_URL") + "/auth/v1/health", { apikey: env("SUPABASE_ANON_KEY") });
      if (!r.ok) throw new Error("Supabase auth answered " + r.status);
    }),
    check("basic", "Email provider", "Check Resend", async () => {
      need("RESEND_API_KEY");
      const r = await getJson("https://api.resend.com/domains", { Authorization: "Bearer " + env("RESEND_API_KEY") });
      if (r.status >= 500) throw new Error("Resend answered " + r.status);
    }),
    check("basic", "Latest backup age", "Run the Database backup workflow", () => workflowRun("backup.yml", 24, 30)),
    check(
      "basic",
      "Kill switches (site_switches)",
      "Flip the switch back on in the Supabase Table Editor",
      async () => {
        if (!sw) throw new Error("Supabase is not set up");
        const off = ["signups", "checkout", "saving"].filter((n) => sw[n] === false);
        if (off.length) return { status: "warning", detail: "Switched off: " + off.join(", ") };
      },
    ),
    check("basic", "Deployed version", "Deploy from Vercel", () => deployedVersion()),
  ]);

  let overall = "ok";
  for (const r of rows) if (r.tier === "important" && RANK[r.status] > RANK[overall]) overall = r.status;
  return { product: "Room Designer 3D", checked_at: new Date().toISOString(), overall, functions: rows };
}

module.exports = async function handler(req, res) {
  if (refuseMethod(req, res, "GET")) return;
  res.setHeader("Cache-Control", "no-store");
  if (!env("ADMIN_STATUS_TOKEN") && !adminEmails().length) return sendJson(res, 404, { error: "not-found" });
  const who = await authorize(req);
  if (!who.allowed) return sendJson(res, who.status || 401, { error: who.status === 403 ? "forbidden" : "signin" });
  // Prefer the configured production host so a caller-supplied header never picks the fetch target.
  const host = String(env("VERCEL_PROJECT_PRODUCTION_URL") || req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim();
  const origin = /^[a-z0-9.-]+(:\d+)?$/i.test(host) ? "https://" + host : "";
  return sendJson(res, 200, await buildStatus(origin));
};

module.exports.buildStatus = buildStatus;
module.exports.authorize = authorize;
