// @ts-check
// /api/projects: a subscriber's saved designs ("projects"), with the
// signed-in user's Supabase access token as a Bearer token.
//
//   GET                       the plan, its limits, what's used, and the list
//   GET    ?counts=1          the plan, its limits and what's used, without the
//                             list (for screens that only show usage; the
//                             counts come from the database as numbers)
//   GET    ?id=<id>           one project, with its design
//   POST   {name, design, info?, summary?}   save a new project (needs a paid
//                             plan, within its limits)
//   PATCH  {id, name?, info?, design?, summary?, updated_at?}   rename or edit
//                             the details (any plan), or save the design again
//                             (paid plan). With updated_at (the value the
//                             project was loaded with), the save is refused
//                             with 409 {error:"conflict", project} when the
//                             project changed since, so work done in another
//                             tab or on another device isn't silently undone.
//
// A body that isn't a JSON object (malformed JSON, an array, plain text)
// answers 400 {error:"json"}: a client bug, not a missing name.
// A field that doesn't fit answers 400 {error:"info"|"name", field, reason},
// reason being "long", "date" (not a real day), "year" (a start date outside
// 2000 to ten years from now), "email", "value" or "empty". Text with a NUL
// or another control character (which Postgres refuses and no name needs)
// is "value".
//
// info is the client and the job (INFO below); summary is the estimate and
// materials list the designer worked out when the design was saved.
//   DELETE ?id=<id>           delete it (frees a slot under the total, not the month)
//
// Limits per plan are in api/_plans.js. A new project is created by the
// create_project() database function (supabase/schema.sql), which checks
// both limits and inserts in one locked transaction.
//
// Saving a design (POST, or PATCH with a design) answers 503 {error: "paused"}
// while the saving switch is off (api/_switches.js); renaming, editing the
// details, reading and deleting still work.
"use strict";

const { supabaseReady, sendJson, sendError, db, dbCount, requireUser, readForm, readRawBody } = require("./_lib.js");
const { planOf, limitsOf } = require("./_plans.js");
const { subscriptionOf } = require("./_subscriptions.js");
const { isOff, pausedBody, switches } = require("./_switches.js");
const Plan = require("../js/room-plan.js");

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST_FIELDS = "id,name,info,created_at,updated_at";

// The project details, each a string of at most this many characters, or
// one of these values.
const INFO = {
  client: 120,
  phone: 40,
  email: 160,
  street: 160,
  unit: 40,
  city: 80,
  state: 40,
  zip: 12,
  start: /^(\d{4}-\d{2}-\d{2})?$/,
  type: ["", "full", "partial", "other"],
  status: ["", "lead", "estimate", "approved", "progress", "done"],
  notes: 2000,
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// C0 and C1 control characters and DEL, apart from tab, newline and carriage
// return (which a text field collapses to spaces and notes may keep).
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

// "YYYY-MM-DD" naming a day that exists (no February 30th).
function realDay(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === text;
}

// A plausible year for a job's start date: 2000 to ten years from now (a
// typo like 0226, 1950 or 2206 is refused with reason "year"). The same
// bounds are checked in the browser (js/projects.js).
const START_YEAR_MIN = 2000;
const START_YEARS_AHEAD = 10;
function plausibleYear(text, now = new Date()) {
  const y = Number(text.slice(0, 4));
  return y >= START_YEAR_MIN && y <= now.getUTCFullYear() + START_YEARS_AHEAD;
}

// Only known fields, trimmed: { info } or, for the first field that doesn't
// fit, { field, reason }.
function parseInfo(value) {
  if (value === undefined || value === null) return { info: {} };
  if (typeof value !== "object" || Array.isArray(value)) return { field: "info", reason: "value" };
  const out = {};
  for (const [key, rule] of Object.entries(INFO)) {
    const raw = value[key];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== "string" || CONTROL.test(raw)) return { field: key, reason: "value" };
    const text = key === "notes" ? raw.trim() : raw.replace(/\s+/g, " ").trim();
    if (typeof rule === "number") {
      if (text.length > rule) return { field: key, reason: "long" };
      if (key === "email" && text && !EMAIL.test(text)) return { field: key, reason: "email" };
    } else if (Array.isArray(rule)) {
      if (!rule.includes(text)) return { field: key, reason: "value" };
    } else if (text && !realDay(text)) {
      return { field: key, reason: "date" };
    } else if (text && !plausibleYear(text)) {
      return { field: key, reason: "year" };
    }
    if (text) out[key] = text;
  }
  return { info: out };
}

// The details as parseInfo reads them, or null when something doesn't fit.
function cleanInfo(value) {
  return parseInfo(value).info || null;
}

function infoError(res, problem) {
  return sendJson(res, 400, { error: "info", field: problem.field, reason: problem.reason });
}

// The designer's estimate snapshot: any plain object, within a size limit,
// stamped with when the design was saved (savedAt). The project's page dates
// the materials list by it; updated_at also moves on a rename or an edit of
// the details, which don't change the estimate.
function cleanSummary(value, now = new Date()) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  if (JSON.stringify(value).length > 90000) return false;
  return Object.assign({}, value, { savedAt: now.toISOString() });
}

// A project's name: text, at most 120 characters. { name } or { reason }.
function parseName(value) {
  if (value !== undefined && value !== null && typeof value !== "string") return { reason: "value" };
  if (typeof value === "string" && CONTROL.test(value)) return { reason: "value" };
  const name = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name) return { reason: "empty" };
  if (name.length > 120) return { reason: "long" };
  return { name };
}

function nameError(res, problem) {
  return sendJson(res, 400, { error: "name", field: "name", reason: problem.reason });
}

// A design as js/room-plan.js encode() writes it, and one that decodes.
function validDesign(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,20000}$/.test(value) && Plan.decode(value) !== null;
}

// The request's JSON body as a plain object, or null when it isn't one
// (malformed JSON, an array, a number, plain text). A form post goes
// through readForm like everywhere else.
async function readBody(req) {
  const type = String(req.headers["content-type"] || "");
  if (!type.includes("application/json")) return readForm(req);
  let raw;
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return Array.isArray(req.body) ? null : req.body;
  }
  if (Buffer.isBuffer(req.body)) raw = req.body.toString("utf8");
  else raw = typeof req.body === "string" ? req.body : await readRawBody(req);
  if (!raw.trim()) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
}

function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

async function planFor(userId) {
  const plan = planOf(await subscriptionOf(userId));
  return { plan, limits: limitsOf(plan) };
}

// What the account has used, counted by the database (no rows travel).
async function usage(userId) {
  const owner = "owner_id=eq." + encodeURIComponent(userId);
  const [month, total] = await Promise.all([
    dbCount("project_creations?" + owner + "&created_at=gte." + encodeURIComponent(monthStart())),
    dbCount("projects?" + owner),
  ]);
  return { month, total };
}

// Supabase answers this way when supabase/schema.sql hasn't been re-run
// since projects were added.
function missingTables(e) {
  return /PGRST20[25]|42P01|42883|does not exist|Could not find/i.test(String(e && e.message));
}

module.exports = async function handler(req, res) {
  if (!supabaseReady()) return sendJson(res, 503, { error: "not-configured" });

  let user;
  try {
    user = await requireUser(req, res);
    if (!user) return;
    const owner = "owner_id=eq." + encodeURIComponent(user.id);

    if (req.method === "GET") {
      const id = String((req.query && req.query.id) || "");
      if (id) {
        if (!ID.test(id)) return sendJson(res, 404, { error: "not-found" });
        const rows = await db("projects?id=eq." + id + "&" + owner + "&select=" + LIST_FIELDS + ",design,summary");
        if (!rows || !rows[0]) return sendJson(res, 404, { error: "not-found" });
        return sendJson(res, 200, { project: rows[0] });
      }
      const countsOnly = /^(1|true)$/.test(String((req.query && req.query.counts) || ""));
      const [{ plan, limits }, used, projects] = await Promise.all([
        planFor(user.id),
        usage(user.id),
        countsOnly ? null : db("projects?" + owner + "&select=" + LIST_FIELDS + "&order=updated_at.desc&limit=1000"),
      ]);
      if (countsOnly) return sendJson(res, 200, { plan, limits, used });
      return sendJson(res, 200, { plan, limits, used, projects: projects || [] });
    }

    const body = req.method === "DELETE" ? {} : await readBody(req);
    if (!body) return sendJson(res, 400, { error: "json" });

    if (req.method === "POST") {
      const named = parseName(body.name);
      if (!named.name) return nameError(res, named);
      const name = named.name;
      if (!validDesign(body.design)) return sendJson(res, 400, { error: "design" });
      const parsed = parseInfo(body.info);
      if (!parsed.info) return infoError(res, parsed);
      const info = parsed.info;
      const summary = cleanSummary(body.summary);
      if (summary === false) return sendJson(res, 400, { error: "summary" });
      if (await isOff("saving")) return sendJson(res, 503, pausedBody("saving", await switches()));
      const { plan, limits } = await planFor(user.id);
      if (!limits.total) return sendJson(res, 403, { error: "plan", plan });
      const result = await db("rpc/create_project", {
        method: "POST",
        body: {
          p_owner: user.id,
          p_name: name,
          p_design: body.design,
          p_monthly: limits.monthly,
          p_total: limits.total,
          p_info: info,
          p_summary: summary,
        },
      });
      const used = { month: result.month, total: result.total };
      if (result.error) return sendJson(res, 403, { error: result.error, plan, limits, used });
      return sendJson(res, 201, { project: result.project, plan, limits, used });
    }

    if (req.method === "PATCH") {
      const id = String(body.id || "");
      if (!ID.test(id)) return sendJson(res, 404, { error: "not-found" });
      const patch = {};
      if (body.name !== undefined) {
        const named = parseName(body.name);
        if (!named.name) return nameError(res, named);
        patch.name = named.name;
      }
      if (body.info !== undefined) {
        const parsed = parseInfo(body.info);
        if (!parsed.info) return infoError(res, parsed);
        patch.info = parsed.info;
      }
      if (body.design !== undefined) {
        if (!validDesign(body.design)) return sendJson(res, 400, { error: "design" });
        const summary = cleanSummary(body.summary);
        if (summary === false) return sendJson(res, 400, { error: "summary" });
        if (summary) patch.summary = summary;
        if (await isOff("saving")) return sendJson(res, 503, pausedBody("saving", await switches()));
        // Saving a design is what a paid plan buys; renaming isn't.
        const { plan, limits } = await planFor(user.id);
        if (!limits.total) return sendJson(res, 403, { error: "plan", plan });
        patch.design = body.design;
      }
      if (!Object.keys(patch).length) return sendJson(res, 400, { error: "nothing" });
      // The version the client loaded: the save only lands on that version.
      const loaded = typeof body.updated_at === "string" && body.updated_at ? body.updated_at : "";
      if (loaded && Number.isNaN(Date.parse(loaded))) return sendJson(res, 400, { error: "updated_at" });
      const where = "projects?id=eq." + id + "&" + owner;
      patch.updated_at = new Date().toISOString();
      const rows = await db(
        where + (loaded ? "&updated_at=eq." + encodeURIComponent(loaded) : "") + "&select=" + LIST_FIELDS,
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: patch,
        },
      );
      if (rows && rows[0]) return sendJson(res, 200, { project: rows[0] });
      if (loaded) {
        // Nothing matched: the project is gone, or it changed since it was loaded.
        const now = await db(where + "&select=" + LIST_FIELDS);
        if (now && now[0]) return sendJson(res, 409, { error: "conflict", project: now[0] });
      }
      return sendJson(res, 404, { error: "not-found" });
    }

    if (req.method === "DELETE") {
      const id = String((req.query && req.query.id) || "");
      if (!ID.test(id)) return sendJson(res, 404, { error: "not-found" });
      const rows = await db("projects?id=eq." + id + "&" + owner + "&select=id", {
        method: "DELETE",
        headers: { Prefer: "return=representation" },
      });
      if (!rows || !rows[0]) return sendJson(res, 404, { error: "not-found" });
      return sendJson(res, 200, { deleted: id });
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return sendJson(res, 405, { error: "method" });
  } catch (e) {
    if (missingTables(e)) return sendError(req, res, 503, { error: "setup" }, e, user);
    return sendError(req, res, 502, { error: "server" }, e, user);
  }
};

module.exports.cleanInfo = cleanInfo;
module.exports.parseInfo = parseInfo;
module.exports.parseName = parseName;
module.exports.cleanSummary = cleanSummary;
module.exports.plausibleYear = plausibleYear;
