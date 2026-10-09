// /api/projects: a subscriber's saved designs ("projects"), with the
// signed-in user's Supabase access token as a Bearer token.
//
//   GET                       the plan, its limits, what's used, and the list
//   GET    ?id=<id>           one project, with its design
//   POST   {name, design, info?, summary?}   save a new project (needs a paid
//                             plan, within its limits)
//   PATCH  {id, name?, info?, design?, summary?}   rename or edit the details
//                             (any plan), or save the design again (paid plan)
//
// info is the client and the job (INFO below); summary is the estimate and
// materials list the designer worked out when the design was saved.
//   DELETE ?id=<id>           delete it (frees a slot under the total, not the month)
//
// Limits per plan are in api/_plans.js. A new project is created by the
// create_project() database function (supabase/schema.sql), which checks
// both limits and inserts in one locked transaction.
"use strict";

const { supabaseReady, sendJson, db, currentUser, readForm } = require("./_lib.js");
const { planOf, limitsOf } = require("./_plans.js");
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

// Only known fields, trimmed; null when something doesn't fit.
function cleanInfo(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const out = {};
  for (const [key, rule] of Object.entries(INFO)) {
    const raw = value[key];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== "string") return null;
    const text = key === "notes" ? raw.trim() : raw.replace(/\s+/g, " ").trim();
    if (typeof rule === "number" ? text.length > rule : Array.isArray(rule) ? !rule.includes(text) : !rule.test(text)) {
      return null;
    }
    if (text) out[key] = text;
  }
  return out;
}

// The designer's estimate snapshot: any plain object, within a size limit.
function cleanSummary(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  return JSON.stringify(value).length <= 90000 ? value : false;
}

function cleanName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

// A design as js/room-plan.js encode() writes it, and one that decodes.
function validDesign(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,20000}$/.test(value) && Plan.decode(value) !== null;
}

function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

async function planFor(userId) {
  const subs = await db("subscriptions?owner_id=eq." + encodeURIComponent(userId) + "&select=*");
  const sub = subs && subs[0];
  const plan = planOf(sub);
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
  const user = await currentUser(req);
  if (!user) return sendJson(res, 401, { error: "signin" });
  const owner = "owner_id=eq." + encodeURIComponent(user.id);

  try {
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
      const name = cleanName(body.name);
      if (!name) return sendJson(res, 400, { error: "name" });
      if (!validDesign(body.design)) return sendJson(res, 400, { error: "design" });
      const info = cleanInfo(body.info);
      if (!info) return sendJson(res, 400, { error: "info" });
      const summary = cleanSummary(body.summary);
      if (summary === false) return sendJson(res, 400, { error: "summary" });
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
        patch.name = cleanName(body.name);
        if (!patch.name) return sendJson(res, 400, { error: "name" });
      }
      if (body.info !== undefined) {
        patch.info = cleanInfo(body.info);
        if (!patch.info) return sendJson(res, 400, { error: "info" });
      }
      if (body.design !== undefined) {
        if (!validDesign(body.design)) return sendJson(res, 400, { error: "design" });
        const summary = cleanSummary(body.summary);
        if (summary === false) return sendJson(res, 400, { error: "summary" });
        if (summary) patch.summary = summary;
        // Saving a design is what a paid plan buys; renaming isn't.
        const { plan, limits } = await planFor(user.id);
        if (!limits.total) return sendJson(res, 403, { error: "plan", plan });
        patch.design = body.design;
      }
      if (!Object.keys(patch).length) return sendJson(res, 400, { error: "nothing" });
      patch.updated_at = new Date().toISOString();
      const rows = await db("projects?id=eq." + id + "&" + owner + "&select=" + LIST_FIELDS, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: patch,
      });
      if (!rows || !rows[0]) return sendJson(res, 404, { error: "not-found" });
      return sendJson(res, 200, { project: rows[0] });
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
