// /api/projects: a subscriber's saved designs ("projects"), with the
// signed-in user's Supabase access token as a Bearer token.
//
//   GET                       the plan, its limits, what's used, and the list
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
// A field that doesn't fit answers 400 {error:"info"|"name", field, reason},
// reason being "long", "date", "email", "value" or "empty".
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

const { supabaseReady, sendJson, db, requireUser, readForm } = require("./_lib.js");
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

// "YYYY-MM-DD" naming a day that exists (no February 30th), in a plausible year.
function realDay(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const y = Number(m[1]);
  const d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[3])));
  return y >= 1900 && y <= 2100 && d.toISOString().slice(0, 10) === text;
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
    if (typeof raw !== "string") return { field: key, reason: "value" };
    const text = key === "notes" ? raw.trim() : raw.replace(/\s+/g, " ").trim();
    if (typeof rule === "number") {
      if (text.length > rule) return { field: key, reason: "long" };
      if (key === "email" && text && !EMAIL.test(text)) return { field: key, reason: "email" };
    } else if (Array.isArray(rule)) {
      if (!rule.includes(text)) return { field: key, reason: "value" };
    } else if (text && !realDay(text)) {
      return { field: key, reason: "date" };
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

// The designer's estimate snapshot: any plain object, within a size limit.
function cleanSummary(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  return JSON.stringify(value).length <= 90000 ? value : false;
}

// A project's name: text, at most 120 characters. { name } or { reason }.
function parseName(value) {
  if (value !== undefined && value !== null && typeof value !== "string") return { reason: "value" };
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

function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

async function planFor(userId) {
  const plan = planOf(await subscriptionOf(userId));
  return { plan, limits: limitsOf(plan) };
}

async function usage(userId) {
  const owner = "owner_id=eq." + encodeURIComponent(userId);
  const [month, total] = await Promise.all([
    db("project_creations?" + owner + "&created_at=gte." + encodeURIComponent(monthStart()) + "&select=id"),
    db("projects?" + owner + "&select=id"),
  ]);
  return { month: (month || []).length, total: (total || []).length };
}

// Supabase answers this way when supabase/schema.sql hasn't been re-run
// since projects were added.
function missingTables(e) {
  return /PGRST20[25]|42P01|42883|does not exist|Could not find/i.test(String(e && e.message));
}

module.exports = async function handler(req, res) {
  if (!supabaseReady()) return sendJson(res, 503, { error: "not-configured" });

  try {
    const user = await requireUser(req, res);
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
      const [{ plan, limits }, used, projects] = await Promise.all([
        planFor(user.id),
        usage(user.id),
        db("projects?" + owner + "&select=" + LIST_FIELDS + "&order=updated_at.desc&limit=1000"),
      ]);
      return sendJson(res, 200, { plan, limits, used, projects: projects || [] });
    }

    const body = req.method === "DELETE" ? {} : await readForm(req);

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
    console.error(e);
    if (missingTables(e)) return sendJson(res, 503, { error: "setup" });
    return sendJson(res, 502, { error: "server" });
  }
};

module.exports.cleanInfo = cleanInfo;
module.exports.parseInfo = parseInfo;
module.exports.parseName = parseName;
