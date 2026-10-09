// The kill switch: a way to stop new sign-ups, buying a plan or saving
// projects without a deploy. The site_switches table (supabase/schema.sql)
// holds one row; flip a column to false in the Supabase Table Editor and
// within SWITCH_CACHE_MS every function refuses that action with
// 503 {error: "paused"}, the browser reads the same switches from
// /api/config, and a sign-up that gets past the page is stopped by a
// database trigger on auth.users. `notice` is a short text shown on the
// account and sign-up pages while it isn't empty.
//
//   signups   new accounts (sign-up page, auth.users trigger)
//   checkout  starting a Stripe Checkout (api/checkout.js)
//   saving    saving a project's design, new or again (api/projects.js)
//
// With no Supabase keys, or when the table hasn't been created yet, every
// switch is on, so re-running schema.sql is the only setup it needs. The row
// is read with a short time limit (SWITCH_READ_MS): /api/config is on every
// page's path, and the switches must never make a slow database slower. When
// the read fails or runs out of time, the switches stay as they were last
// read (all on if they never were), and the API that needs the database
// fails on its own, with its own error: the switch is for stopping the
// product on purpose, not for an outage.
"use strict";

const { supabaseReady, db, logError } = require("./_lib.js");

const SWITCH_CACHE_MS = 15000;
const SWITCH_READ_MS = 1500;
const NAMES = ["signups", "checkout", "saving"];

const ALL_ON = Object.freeze({ signups: true, checkout: true, saving: true, notice: "" });

let cache = { at: 0, value: ALL_ON };

function normalize(row) {
  const out = { notice: String((row && row.notice) || "").slice(0, 500) };
  for (const name of NAMES) out[name] = !(row && row[name] === false);
  return out;
}

// The switches as they are now (cached for SWITCH_CACHE_MS).
async function switches(now = Date.now()) {
  if (!supabaseReady()) return ALL_ON;
  if (now - cache.at < SWITCH_CACHE_MS) return cache.value;
  // Until the row is read again: what it said last time (all on at first).
  let value = cache.value;
  try {
    const rows = await db("site_switches?id=eq.1&select=signups,checkout,saving,notice", {
      timeoutMs: SWITCH_READ_MS,
    });
    value = normalize(rows && rows[0]);
  } catch (e) {
    // No table yet (schema.sql not re-run) is expected and means all on;
    // anything else is logged and keeps the last reading.
    if (/Supabase 404|PGRST20[25]|42P01|does not exist|Could not find/i.test(String(e && e.message))) {
      value = ALL_ON;
    } else {
      logError(null, e, { route: "site_switches", error: "switches" });
    }
  }
  cache = { at: now, value };
  return value;
}

// True when the named action is switched off right now.
async function isOff(name) {
  const s = await switches();
  return s[name] === false;
}

// The answer for a switched-off action.
function pausedBody(name, s) {
  return { error: "paused", switch: name, notice: (s && s.notice) || "" };
}

function resetCache() {
  cache = { at: 0, value: ALL_ON };
}

module.exports = { NAMES, SWITCH_CACHE_MS, SWITCH_READ_MS, switches, isOff, pausedBody, resetCache };
