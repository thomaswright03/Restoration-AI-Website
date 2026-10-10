// Room Designer 3D — a subscriber's projects: designs saved to their account,
// each with the client's details and a materials list.
//
// Three places use this file:
//   - projects.html ("My projects"): the plan's limits and what's used, and
//     every saved project (client, address, status), to search, open,
//     rename or delete.
//   - project.html?id=<id>: one project, in three sections: the 3D model,
//     the info (client, address, job), and the materials it needs.
//   - designer.html: when someone is signed in, a bar above the studio that
//     saves the design as a project (asking for the client's details the
//     first time), saves changes, or saves it as a new one. Homeowners using
//     a business's designer aren't signed in, so they never see it, and the
//     Supabase script is only loaded when a sign-in exists.
//
// Everything goes through api/projects.js, which checks the plan: free
// accounts can design but not save, and each plan has a monthly and a total
// limit (api/_plans.js).

(function () {
  "use strict";

  var T = window.I18n.t;
  var LANG = window.I18n.lang();
  var DIR = LANG === "en" ? "" : LANG + "/";
  var page = document.getElementById("projects-app")
    ? "list"
    : document.getElementById("project-page")
      ? "detail"
      : document.getElementById("project-bar")
        ? "bar"
        : "";
  if (!page) return;

  var client = null;
  var session = null;
  var params = new URLSearchParams(window.location.search);

  function $(id) {
    return document.getElementById(id);
  }

  function show(el, on) {
    if (el) el.hidden = !on;
  }

  function status(el, kind, text) {
    if (!el) return;
    el.className = "form-status is-" + kind;
    el.textContent = text;
    el.hidden = !text;
  }

  function el(tag, attrs, kids) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "text") node.textContent = v;
      else if (k === "class") node.className = v;
      else if (k.slice(0, 2) === "on") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function sitePath(file) {
    return window.location.origin + "/" + DIR + file;
  }

  function formatDate(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString(window.I18n.locale(), { year: "numeric", month: "short", day: "numeric" });
  }

  // A "YYYY-MM-DD" date as the reader writes dates (no time zone shift).
  function formatDay(day) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || "");
    if (!m) return "";
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString(window.I18n.locale(), {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }

  function money(n) {
    var P = window.BathroomPricing;
    return P && P.money ? P.money(n) : "$" + Number(n || 0).toFixed(2);
  }

  function planName(plan) {
    return T("proj.plan." + (plan || "free"));
  }

  // Calls api/projects.js (js/net.js: a time limit, and err.kind tells
  // offline, timeout and server failure apart). Rejects with err.code set to
  // the API's error word.
  function api(method, query, body) {
    return window.Net.fetchJson("/api/projects" + (query || ""), {
      method: method,
      headers: Object.assign(
        { Authorization: "Bearer " + session.access_token },
        body ? { "Content-Type": "application/json" } : {},
      ),
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  }

  // The message for a failure, in plain words: the API's own reasons first,
  // else what the connection did, after what was being done (actionKey).
  function errorText(err, actionKey) {
    var d = (err && err.data) || {};
    var limits = d.limits || {};
    if (err.code === "plan") return T("proj.err.plan");
    if (err.code === "monthly-limit") return T("proj.err.monthly", { n: limits.monthly || 0 });
    if (err.code === "total-limit") return T("proj.err.total", { n: limits.total || 0 });
    if (err.code === "setup") return T("proj.err.setup");
    if (err.code === "signin") return T("proj.err.signin");
    if (err.code === "not-found") return T("proj.err.notFound");
    if (err.code === "business") return T("proj.err.business");
    if (err.code === "info" || err.code === "name") return fieldErrorText(d) || T("proj.err.info");
    // The owner's notice, when there is one, on its own line (.form-status
    // keeps line breaks), marked as a notice rather than run into the sentence.
    if (err.code === "paused") {
      return T("proj.err.paused") + (d.notice ? "\n" + T("proj.pausedNotice", { notice: d.notice }) : "");
    }
    if (err.code === "conflict") return T("proj.conflict");
    if (err.kind === "http") return T("acct.error");
    return (actionKey ? T(actionKey) + " " : "") + T(window.Net.errorKey(err));
  }

  // What's wrong with one field, from the API's {field, reason}.
  function fieldErrorText(d) {
    if (!d || !d.field) return "";
    if (d.reason === "long") return T("proj.err.field.long");
    if (d.reason === "date") return T("proj.err.field.date");
    if (d.reason === "email") return T("auth.emailInvalid");
    if (d.reason === "empty") return T("proj.err.name");
    return T("proj.err.field.value");
  }

  // Marks a field (prefix + name) as wrong, with the message under it, and
  // moves focus there. Returns true when the field exists in container.
  function showFieldError(container, prefix, field, text) {
    var input = container.querySelector("#" + prefix + field);
    if (!input) return false;
    input.setAttribute("aria-invalid", "true");
    var note = $(prefix + field + "-error");
    if (note) {
      note.textContent = text;
      note.hidden = false;
    }
    input.focus();
    return true;
  }

  function clearFieldErrors(container) {
    Array.prototype.forEach.call(container.querySelectorAll("[aria-invalid]"), function (input) {
      input.removeAttribute("aria-invalid");
    });
    Array.prototype.forEach.call(container.querySelectorAll(".field-error"), function (note) {
      note.textContent = "";
      note.hidden = true;
    });
  }

  // A failed save of details: the field's own message when the API named
  // one, else the form-level message.
  function showSaveError(err, container, prefix, out, actionKey) {
    var d = (err && err.data) || {};
    if (
      (err.code === "info" || err.code === "name") &&
      d.field &&
      showFieldError(container, prefix, d.field, fieldErrorText(d))
    ) {
      return status(out, "error", T("proj.err.info"));
    }
    status(out, "error", errorText(err, actionKey));
  }

  // The details a person typed, checked before they're sent: the first
  // problem is shown at its field. True when everything fits.
  function checkInfo(container, prefix, info) {
    clearFieldErrors(container);
    if (!validEmail(info.email)) return !showFieldError(container, prefix, "email", T("auth.emailInvalid"));
    if (info.start && !realDay(info.start))
      return !showFieldError(container, prefix, "start", T("proj.err.field.date"));
    return true;
  }

  // "YYYY-MM-DD" naming a day that exists, in a plausible year for a job's
  // start (1950 to 2100, the same bounds as api/projects.js).
  function realDay(text) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text || "");
    if (!m) return false;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return +m[1] >= 1950 && +m[1] <= 2100 && d.toISOString().slice(0, 10) === text;
  }

  // Two tabs: the project changed since this one loaded it. Says so, with
  // the choice to take the newer version or save over it.
  function conflictNotice(out, onReload, onOverwrite) {
    status(out, "error", T("proj.conflict") + " ");
    out.appendChild(
      el("button", { type: "button", class: "link-button", text: T("proj.conflict.reload"), onclick: onReload }),
    );
    out.appendChild(document.createTextNode(" · "));
    out.appendChild(
      el("button", { type: "button", class: "link-button", text: T("proj.conflict.overwrite"), onclick: onOverwrite }),
    );
  }

  // /api/config with a time limit (js/net.js); unreachable when it can't be read.
  function loadConfig() {
    return window.Net.config();
  }

  // "Saving projects is paused right now…", with the owner's notice from
  // /api/config when there is one.
  function pausedText(config) {
    var notice = config && typeof config.notice === "string" ? config.notice.trim() : "";
    return T("proj.err.paused") + (notice ? " " + T("proj.pausedNotice", { notice: notice }) : "");
  }

  // The sign-in page, with the way back to this page after logging in.
  function loginPath() {
    var query = new URLSearchParams({
      mode: "login",
      next: window.location.pathname + window.location.search + window.location.hash,
    });
    return sitePath("signup.html") + "?" + query.toString();
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // Supabase keeps a sign-in in localStorage as sb-<project>-auth-token.
  function hasStoredSignIn() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        if (/^sb-.+-auth-token$/.test(localStorage.key(i) || "")) return true;
      }
    } catch (e) {
      /* storage blocked: treat as signed out */
    }
    return false;
  }

  // Resolves with the signed-in session, or null.
  function signIn(config) {
    var ready = window.supabase ? Promise.resolve() : loadScript("/js/vendor/supabase/supabase.js");
    return ready.then(function () {
      if (!window.supabase) return null;
      client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
      return client.auth.getSession().then(function (r) {
        session = (r.data && r.data.session) || null;
        if (session) {
          client.auth.onAuthStateChange(function (event, next) {
            if (next) session = next;
          });
        }
        return session;
      });
    });
  }

  // On the account pages: signed in, or off to log in. Resolves with the
  // session, or false when the page has already shown why it can't go on.
  function signInOrLeave(config, loadingId) {
    function off(err) {
      show($(loadingId), false);
      // No answer from the server is a connection problem, not accounts
      // being switched off.
      var down = config.unreachable || Boolean(err);
      show($(down ? "server-down" : "accounts-off"), true);
      return false;
    }
    if (!config.accounts) return Promise.resolve(off());
    return signIn(config)
      .catch(off)
      .then(function (s) {
        if (s === false) return false;
        if (!s) {
          window.location.href = loginPath();
          return false;
        }
        return s;
      });
  }

  // The owner's business (null while they haven't set one up). When it
  // can't be read, that's an error the page shows with Try again: an owner's
  // projects never quietly open in the demo designer at sample rates.
  function loadBusiness() {
    return client
      .from("businesses")
      .select("slug")
      .maybeSingle()
      .then(
        function (r) {
          if (r.error) throw r.error;
          return r.data || null;
        },
        function (e) {
          throw e;
        },
      )
      .catch(function (e) {
        var err = new Error("business");
        err.code = "business";
        err.cause = e;
        throw err;
      });
  }

  // Where projects open: the subscriber's own designer (their prices) once
  // their business is set up, else the demo designer.
  function designerBase(business) {
    return sitePath("designer.html") + (business && business.slug ? "?b=" + encodeURIComponent(business.slug) : "");
  }

  function withParams(base, extra) {
    return base + (base.indexOf("?") >= 0 ? "&" : "?") + extra;
  }

  function withProject(base, id) {
    return withParams(base, "project=" + encodeURIComponent(id));
  }

  function projectPage(id) {
    return sitePath("project.html") + "?id=" + encodeURIComponent(id);
  }

  // ===================================================================
  // Project details: the client, the job address and the job
  // ===================================================================
  // Grouped as they're asked for. Each field: [key, input type, extra].
  var INFO_GROUPS = [
    [
      "proj.group.client",
      [
        ["client", "text", { maxlength: 120, autocomplete: "off" }],
        ["phone", "tel", { maxlength: 40 }],
        ["email", "email", { maxlength: 160 }],
      ],
    ],
    [
      "proj.group.address",
      [
        ["street", "text", { maxlength: 160 }],
        ["unit", "text", { maxlength: 40 }],
        ["city", "text", { maxlength: 80 }],
        ["state", "text", { maxlength: 40 }],
        ["zip", "text", { maxlength: 12, inputmode: "numeric" }],
      ],
    ],
    [
      "proj.group.job",
      [
        ["type", "select", { options: ["", "full", "partial", "other"] }],
        ["status", "select", { options: ["", "lead", "estimate", "approved", "progress", "done"] }],
        ["start", "date", {}],
        ["notes", "textarea", { maxlength: 2000, rows: 4 }],
      ],
    ],
  ];

  // The name field and the detail fields, ids starting with prefix.
  function infoFields(prefix, name, info) {
    info = info || {};
    var wrap = el("div", { class: "info-fields" });
    wrap.appendChild(
      el("div", { class: "form-group" }, [
        el("label", { for: prefix + "name", text: T("proj.f.name") }),
        el("input", {
          type: "text",
          id: prefix + "name",
          maxlength: 120,
          value: name || "",
          "aria-describedby": prefix + "name-help " + prefix + "name-error",
        }),
        el("p", { class: "form-note", id: prefix + "name-help", text: T("proj.f.nameHelp") }),
        el("p", { class: "field-error", id: prefix + "name-error", hidden: true }),
      ]),
    );
    INFO_GROUPS.forEach(function (group) {
      var set = el("fieldset", { class: "info-group" }, [el("legend", { text: T(group[0]) })]);
      var grid = el("div", { class: "info-grid" });
      group[1].forEach(function (f) {
        var key = f[0];
        var id = prefix + key;
        var input;
        if (f[1] === "select") {
          input = el(
            "select",
            { id: id },
            f[2].options.map(function (v) {
              return el("option", { value: v, text: T(v ? "proj." + key + "." + v : "proj.choose") });
            }),
          );
        } else if (f[1] === "textarea") {
          input = el("textarea", { id: id, maxlength: f[2].maxlength, rows: f[2].rows });
        } else {
          input = el("input", Object.assign({ type: f[1], id: id }, f[2]));
        }
        input.value = info[key] || "";
        input.setAttribute("data-info", key);
        input.setAttribute("aria-describedby", id + "-error");
        grid.appendChild(
          el("div", { class: "form-group info-" + key }, [
            el("label", { for: id, text: T("proj.f." + key) }),
            input,
            el("p", { class: "field-error", id: id + "-error", hidden: true }),
          ]),
        );
      });
      set.appendChild(grid);
      wrap.appendChild(set);
    });
    return wrap;
  }

  function readInfo(container) {
    var info = {};
    Array.prototype.forEach.call(container.querySelectorAll("[data-info]"), function (input) {
      var v = input.value.trim();
      if (v) info[input.getAttribute("data-info")] = v;
    });
    return info;
  }

  function addressOf(info) {
    info = info || {};
    var line = [info.street, info.unit].filter(Boolean).join(", ");
    var place = [info.city, [info.state, info.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    return [line, place].filter(Boolean).join(", ");
  }

  // A name from the details when none was typed. With no details either,
  // the date and time, so two saves the same day don't look alike.
  function nameFrom(info, typed) {
    if (typed) return typed;
    var parts = [info.client, info.street].filter(Boolean);
    if (parts.length) return parts.join(", ");
    var when = new Date().toLocaleString(window.I18n.locale(), {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    return T("proj.defaultName", { date: when });
  }

  function validEmail(v) {
    return !v || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
  }

  // ===================================================================
  // My projects page
  // ===================================================================
  var state = {
    plan: "free",
    limits: { monthly: 0, total: 0 },
    used: { month: 0, total: 0 },
    projects: [],
    loaded: false,
  };

  function renderUsage() {
    var paid = state.plan !== "free";
    $("projects-plan").textContent = T("proj.planLine", { plan: planName(state.plan) });
    show($("projects-plan"), true);
    show($("projects-free"), !paid);
    show($("projects-usage"), paid);
    show($("project-new"), true);
    if (!paid) return;
    meter("usage-month", state.used.month, state.limits.monthly, "proj.usage.month");
    meter("usage-total", state.used.total, state.limits.total, "proj.usage.total");
  }

  function meter(id, used, limit, key) {
    var box = $(id);
    box.querySelector("[data-meter-text]").textContent = T(key, { used: used, limit: limit });
    var bar = box.querySelector("meter");
    bar.max = limit || 1;
    bar.value = Math.min(used, limit);
    bar.high = Math.max(1, Math.floor((limit || 1) * 0.8));
    bar.low = Math.max(0, Math.floor((limit || 1) * 0.5));
    bar.optimum = 0;
    bar.textContent = used + " / " + limit;
  }

  var STATUSES = ["lead", "estimate", "approved", "progress", "done"];

  function searchText(p) {
    var i = p.info || {};
    var statusWord = i.status ? T("proj.status." + i.status) : "";
    return [p.name, i.client, i.phone, i.email, addressOf(i), statusWord].join(" ").toLowerCase();
  }

  var SORTS = ["updated", "name", "start", "status"];
  var VIEW_KEY = "rd3d_projects_view"; // "cards" or "table", this browser's pick

  function sortName(value) {
    return SORTS.indexOf(value) > 0 ? value : "updated";
  }

  // Search, sort and status filter, as the controls have them.
  function listView() {
    return {
      q: ($("projects-search").value || "").trim(),
      sort: sortName($("projects-sort").value),
      status: $("projects-filter").value || "",
    };
  }

  // The view lives in the address (?q=&sort=&status=), so a reload or a
  // shared link keeps it; the defaults stay out of it.
  function readViewFromUrl() {
    var q = params.get("q") || "";
    var sort = sortName(params.get("sort"));
    var status = STATUSES.indexOf(params.get("status")) >= 0 ? params.get("status") : "";
    $("projects-search").value = q;
    $("projects-sort").value = sort;
    $("projects-filter").value = status;
  }

  // Cards (the default) or a table, on screens wide enough for one
  // (css/product.css); the pick is kept in this browser.
  function readListLayout() {
    try {
      return localStorage.getItem(VIEW_KEY) === "table" ? "table" : "cards";
    } catch (e) {
      return "cards";
    }
  }

  function applyListLayout() {
    var layout = $("projects-view").value === "table" ? "table" : "cards";
    try {
      if (layout === "table") localStorage.setItem(VIEW_KEY, layout);
      else localStorage.removeItem(VIEW_KEY);
    } catch (e) {
      /* storage blocked: the pick lasts for this visit */
    }
    $("projects-list").classList.toggle("is-table", layout === "table");
    show($("projects-table-head"), layout === "table" && state.projects.length > 0);
  }

  // "Clear filters" shows while a search or status filter narrows the list;
  // it puts the search, the status and the sort back to their defaults.
  function clearFilters() {
    $("projects-search").value = "";
    $("projects-sort").value = "updated";
    $("projects-filter").value = "";
    renderList();
    $("projects-search").focus();
  }

  function writeViewToUrl(view) {
    try {
      var url = new URL(window.location.href);
      ["q", "sort", "status"].forEach(function (k) {
        var v = view[k];
        if (v && !(k === "sort" && v === "updated")) url.searchParams.set(k, v);
        else url.searchParams.delete(k);
      });
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch (e) {
      /* fine */
    }
  }

  function fillFilter() {
    var select = $("projects-filter");
    if (select.options.length) return;
    select.appendChild(el("option", { value: "", text: T("proj.filter.all") }));
    STATUSES.forEach(function (st) {
      select.appendChild(el("option", { value: st, text: T("proj.status." + st) }));
    });
  }

  // Last updated (newest first); name; start date (soonest first, projects
  // without one last); status (in the order a job goes through, projects
  // without one last). Ties fall back to last updated.
  function sortProjects(list, sort) {
    var collator = new Intl.Collator(window.I18n.locale(), { sensitivity: "base", numeric: true });
    var byUpdated = function (a, b) {
      return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
    };
    var rank = function (p) {
      var i = STATUSES.indexOf((p.info || {}).status);
      return i < 0 ? STATUSES.length : i;
    };
    return list.slice().sort(function (a, b) {
      if (sort === "name") return collator.compare(a.name || "", b.name || "") || byUpdated(a, b);
      if (sort === "start") {
        var sa = (a.info || {}).start || "";
        var sb = (b.info || {}).start || "";
        if (sa !== sb) return !sa ? 1 : !sb ? -1 : sa.localeCompare(sb);
        return byUpdated(a, b);
      }
      if (sort === "status") return rank(a) - rank(b) || byUpdated(a, b);
      return byUpdated(a, b);
    });
  }

  function renderList() {
    var list = $("projects-list");
    var view = listView();
    var q = view.q.toLowerCase();
    var shown = sortProjects(
      state.projects.filter(function (p) {
        if (view.status && (p.info || {}).status !== view.status) return false;
        return !q || searchText(p).indexOf(q) >= 0;
      }),
      view.sort,
    );
    list.innerHTML = "";
    shown.forEach(function (p) {
      list.appendChild(projectItem(p));
    });
    // The empty state is only for a list that loaded with nothing in it.
    show($("projects-empty"), state.loaded && !state.projects.length);
    show($("projects-search-wrap"), state.projects.length > 1);
    show($("projects-view-wrap"), state.projects.length > 1);
    applyListLayout();
    show($("projects-clear-wrap"), !!(view.q || view.status || view.sort !== "updated"));
    show($("projects-no-match"), !!state.projects.length && !shown.length);
    $("projects-count").textContent = state.projects.length ? "(" + state.projects.length + ")" : "";
    writeViewToUrl(view);
  }

  function projectItem(p) {
    var info = p.info || {};
    var li = el("li", { class: "project-item", "data-project": p.id });
    // A row with no client or no status says so with a dash, so the rows
    // line up and nothing looks left out by mistake.
    var meta = [info.client || "—"];
    if (addressOf(info)) meta.push(addressOf(info));
    // Each fact in its own element: the cards run them together, the table
    // view gives each a column (css/product.css).
    var main = el("div", { class: "project-main" }, [
      el("a", { class: "project-name", href: projectPage(p.id), text: p.name }),
      el("p", { class: "project-client", text: meta.join(" · ") }),
      el("p", { class: "project-meta" }, [
        info.status
          ? el("span", { class: "project-status is-" + info.status, text: T("proj.status." + info.status) })
          : el("span", {
              class: "project-status is-none",
              text: "—",
              "aria-label": T("proj.status.none"),
            }),
        el("span", {
          class: "project-start",
          text: info.start ? T("proj.starts", { date: formatDay(info.start) }) : "—",
          "aria-label": info.start ? null : T("proj.noStart"),
        }),
        el("span", { class: "project-updated", text: T("proj.updated", { date: formatDate(p.updated_at) }) }),
      ]),
    ]);
    li.appendChild(main);

    var rename = el("button", {
      type: "button",
      class: "link-button",
      text: T("proj.rename"),
      "aria-label": T("proj.renameNamed", { name: p.name }),
      onclick: function () {
        startRename(li, p);
      },
    });
    var del = el("button", {
      type: "button",
      class: "link-button project-delete",
      text: T("proj.delete"),
      "aria-label": T("proj.deleteNamed", { name: p.name }),
      onclick: function () {
        remove(p, del);
      },
    });
    li.appendChild(
      el("div", { class: "project-actions" }, [
        el("a", {
          class: "btn btn-outline-dark btn-sm",
          href: projectPage(p.id),
          text: T("proj.open"),
          "aria-label": T("proj.openNamed", { name: p.name }),
        }),
        rename,
        del,
      ]),
    );
    return li;
  }

  function startRename(li, p) {
    var id = "rename-" + p.id;
    var input = el("input", {
      type: "text",
      id: id,
      maxlength: 120,
      required: true,
      "aria-describedby": id + "-error",
    });
    input.value = p.name;
    var note = el("p", { class: "field-error", id: id + "-error", hidden: true });
    var save = el("button", { type: "submit", class: "btn btn-primary btn-sm", text: T("proj.saveName") });
    var cancel = function () {
      var fresh = projectItem(p);
      li.replaceWith(fresh);
      fresh.querySelector(".project-actions button").focus();
    };
    var form = el("form", { class: "project-rename", novalidate: true }, [
      el("label", { for: id, class: "visually-hidden", text: T("proj.nameLabel") }),
      input,
      save,
      el("button", { type: "button", class: "link-button", text: T("proj.cancel"), onclick: cancel }),
      note,
    ]);
    // Escape leaves the name as it was.
    form.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      cancel();
    });
    var fail = function (text) {
      input.setAttribute("aria-invalid", "true");
      note.textContent = text;
      note.hidden = false;
      input.focus();
    };
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = input.value.trim();
      input.removeAttribute("aria-invalid");
      note.hidden = true;
      if (!name) return fail(T("proj.err.name"));
      save.disabled = true;
      api("PATCH", "", { id: p.id, name: name })
        .then(function (data) {
          Object.assign(p, data.project);
          var fresh = projectItem(p);
          li.replaceWith(fresh);
          fresh.querySelector(".project-name").focus();
          status($("projects-status"), "success", T("proj.renamed"));
        })
        .catch(function (err) {
          save.disabled = false;
          fail(errorText(err, "proj.err.renameFailed"));
        });
    });
    li.querySelector(".project-main").replaceWith(form);
    var actions = li.querySelector(".project-actions");
    if (actions) actions.hidden = true;
    input.focus();
    input.select();
  }

  // "Delete project" asks first, in a dialog that names the project; Cancel
  // has the focus, so Enter alone deletes nothing.
  var deleting = null; // { p, btn } while the dialog is up

  function remove(p, btn) {
    var paid = state.plan !== "free";
    var dialog = $("projects-delete-dialog");
    deleting = { p: p, btn: btn };
    $("projects-delete-text").textContent = T(paid ? "proj.deleteConfirm" : "proj.deleteConfirmFree", { name: p.name });
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    $("projects-delete-cancel").focus();
  }

  function closeDeleteDialog() {
    var dialog = $("projects-delete-dialog");
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else dialog.removeAttribute("open");
  }

  function confirmRemove() {
    if (!deleting) return;
    var p = deleting.p;
    var btn = deleting.btn;
    deleting = null;
    closeDeleteDialog();
    btn.disabled = true;
    api("DELETE", "?id=" + encodeURIComponent(p.id))
      .then(function () {
        state.projects = state.projects.filter(function (x) {
          return x.id !== p.id;
        });
        state.used.total = Math.max(0, state.used.total - 1);
        renderList();
        renderUsage();
        status($("projects-status"), "success", T("proj.deleted", { name: p.name }));
        $("projects-heading").focus();
      })
      .catch(function (err) {
        btn.disabled = false;
        status($("projects-status"), "error", errorText(err, "proj.err.deleteFailed"));
        btn.focus();
      });
  }

  // Loads the plan and the list. On failure the page says what happened
  // with a Try again button, and never shows "No projects yet": that's only
  // for a list that loaded empty. An ended sign-in shows only the way to
  // log in again.
  function loadList() {
    show($("projects-failed"), false);
    show($("projects-signin"), false);
    show($("projects-app"), false);
    show($("projects-loading"), true);
    Promise.all([api("GET"), loadBusiness()])
      .then(function (results) {
        var data = results[0];
        state.plan = data.plan;
        state.limits = data.limits;
        state.used = data.used;
        state.projects = data.projects || [];
        state.loaded = true;
        $("project-new").href = designerBase(results[1]);
        show($("projects-loading"), false);
        show($("projects-app"), true);
        renderUsage();
        renderList();
      })
      .catch(function (err) {
        show($("projects-loading"), false);
        if (err.code === "signin") {
          $("projects-signin-text").textContent = T("proj.err.signinList");
          show($("projects-signin"), true);
          return;
        }
        $("projects-failed-text").textContent = errorText(err, "proj.err.loadFailed");
        show($("projects-failed"), true);
        $("projects-retry").focus();
      });
  }

  function initList(config) {
    signInOrLeave(config, "projects-loading").then(function (s) {
      if (!s) return;
      $("projects-email").textContent = T("auth.signedInAs", { email: s.user.email });
      show($("projects-email"), true);
      fillFilter();
      readViewFromUrl();
      $("projects-search").addEventListener("input", renderList);
      $("projects-sort").addEventListener("change", renderList);
      $("projects-view").value = readListLayout();
      $("projects-view").addEventListener("change", applyListLayout);
      // Saving paused (the kill switch, /api/config): said here, before
      // anyone opens the designer to save.
      if (config.switches && config.switches.saving === false) {
        $("projects-paused-text").textContent = pausedText(config);
        show($("projects-paused"), true);
      }
      $("projects-filter").addEventListener("change", renderList);
      $("projects-retry").addEventListener("click", loadList);
      $("projects-clear").addEventListener("click", clearFilters);
      $("projects-delete-cancel").addEventListener("click", closeDeleteDialog);
      $("projects-delete-close").addEventListener("click", closeDeleteDialog);
      $("projects-delete-confirm").addEventListener("click", confirmRemove);
      // A click on the backdrop lands on the dialog itself, not its body.
      $("projects-delete-dialog").addEventListener("click", function (e) {
        if (e.target === $("projects-delete-dialog")) closeDeleteDialog();
      });
      $("projects-delete-dialog").addEventListener("close", function () {
        var was = deleting;
        deleting = null;
        if (was && was.btn && document.contains(was.btn)) was.btn.focus();
      });
      loadList();
    });
  }

  // ===================================================================
  // One project's page: 3D model, info, materials
  // ===================================================================
  var project = null;
  var designerUrl = "";
  var TABS = ["model", "info", "materials"];

  function showTab(name, focus) {
    if (TABS.indexOf(name) < 0) name = "model";
    TABS.forEach(function (t) {
      var tab = $("tab-" + t);
      var on = t === name;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
      show($("panel-" + t), on);
    });
    if (focus) $("tab-" + name).focus();
    if (name === "model") loadModel();
    try {
      history.replaceState(null, "", window.location.pathname + window.location.search + "#" + name);
    } catch (e) {
      /* fine */
    }
  }

  // The design in the designer, inside the page (embedded: no site header).
  function loadModel() {
    var frame = $("project-model-frame");
    if (frame.getAttribute("src")) return;
    frame.src = withParams(withProject(designerUrl, project.id), "embed=1");
  }

  function renderHead() {
    var info = project.info || {};
    $("project-title").textContent = project.name;
    document.title = project.name + " | Room Designer 3D";
    var sub = [info.client, addressOf(info)].filter(Boolean).join(" · ");
    $("project-sub").textContent = sub;
    show($("project-sub"), !!sub);
    $("project-updated").textContent = T("proj.updated", { date: formatDate(project.updated_at) });
  }

  var infoDirty = false; // the info form has edits that aren't saved

  function renderInfo() {
    var box = $("project-info-fields");
    box.innerHTML = "";
    box.appendChild(infoFields("info-", project.name, project.info));
    infoDirty = false;
  }

  // Takes the version from the server (what another tab saved) into the
  // page, letting go of this form's edits.
  function reloadProject() {
    var out = $("project-info-status");
    status(out, "info", T("proj.loading"));
    return api("GET", "?id=" + encodeURIComponent(project.id))
      .then(function (data) {
        project = data.project;
        renderHead();
        renderInfo();
        renderMaterials();
        status(out, "info", "");
      })
      .catch(function (err) {
        status(out, "error", errorText(err, "proj.err.openFailed"));
      });
  }

  function saveInfo(e, overwrite) {
    if (e) e.preventDefault();
    var out = $("project-info-status");
    var form = $("project-info-form");
    var info = readInfo(form);
    if (!checkInfo(form, "info-", info)) return;
    var name = nameFrom(info, $("info-name").value.trim());
    var btn = form.querySelector("[type=submit]");
    btn.disabled = true;
    status(out, "info", T("proj.saving"));
    var body = { id: project.id, name: name, info: info };
    // The version this page loaded: the server refuses to write over a
    // newer one (409) unless this is the "save anyway" that follows.
    if (!overwrite && project.updated_at) body.updated_at = project.updated_at;
    api("PATCH", "", body)
      .then(function (data) {
        Object.assign(project, data.project);
        $("info-name").value = project.name;
        infoDirty = false;
        renderHead();
        status(out, "success", T("proj.infoSaved"));
      })
      .catch(function (err) {
        if (err.code === "conflict") {
          return conflictNotice(out, reloadProject, function () {
            saveInfo(null, true);
          });
        }
        showSaveError(err, form, "info-", out, "proj.err.saveFailed");
      })
      .then(function () {
        btn.disabled = false;
      });
  }

  function feet(n) {
    var inches = Math.round(Number(n || 0) * 12);
    var ft = Math.floor(inches / 12);
    var rest = inches - ft * 12;
    return ft + "′" + (rest ? " " + rest + "″" : "");
  }

  function table(caption, head, rows, cls) {
    return el("table", { class: "materials-table" + (cls ? " " + cls : "") }, [
      el("caption", { text: caption }),
      el("thead", {}, [
        el(
          "tr",
          {},
          head.map(function (h, i) {
            return el("th", { scope: "col", class: i === head.length - 1 ? "num" : null, text: h });
          }),
        ),
      ]),
      el(
        "tbody",
        {},
        rows.map(function (r) {
          return el(
            "tr",
            { class: r.cls || null },
            r.cells.map(function (c, i) {
              var cell = el(i === 0 ? "th" : "td", {
                scope: i === 0 ? "row" : null,
                class: i === r.cells.length - 1 ? "num" : null,
              });
              if (c && c.href)
                cell.appendChild(el("a", { href: c.href, target: "_blank", rel: "noopener", text: c.text }));
              else cell.textContent = c === null || c === undefined ? "" : String(c);
              return cell;
            }),
          );
        }),
      ),
    ]);
  }

  function renderMaterials() {
    var box = $("project-materials");
    box.innerHTML = "";
    var s = project.summary;
    show($("project-materials-empty"), !s);
    show($("project-materials-actions"), !!s);
    if (!s) return;

    var room = s.room || {};
    var size = T("proj.mat.roomSize", { w: feet(room.w), l: feet(room.l), h: feet(room.h) });
    var fixtures = (s.fixtures || [])
      .map(function (f) {
        return f.qty > 1 ? f.label + " × " + f.qty : f.label;
      })
      .join(", ");
    box.appendChild(
      el("dl", { class: "materials-room" }, [
        el("dt", { text: T("proj.mat.room") }),
        el("dd", { text: size }),
        fixtures ? el("dt", { text: T("proj.mat.fixtures") }) : null,
        fixtures ? el("dd", { text: fixtures }) : null,
      ]),
    );

    var mats = (s.materials || []).map(function (m) {
      return {
        cells: [
          m.label,
          m.url ? { href: m.url, text: m.product + " (" + m.store + ")" } : m.product,
          m.quantity,
          money(m.cost),
        ],
      };
    });
    if (mats.length) {
      box.appendChild(
        table(
          T("proj.mat.surfaces"),
          [T("proj.mat.item"), T("proj.mat.product"), T("proj.mat.qty"), T("proj.mat.cost")],
          mats,
        ),
      );
    }

    var products = (s.products || []).map(function (p) {
      return {
        cells: [
          p.label,
          { href: p.url, text: (p.models || []).join(" + ") },
          String(p.qty || 1),
          p.cost === null || p.cost === undefined ? T("proj.mat.notPriced") : money(p.cost),
        ],
      };
    });
    if (products.length) {
      box.appendChild(
        table(
          T("proj.mat.products"),
          [T("proj.mat.item"), T("proj.mat.model"), T("proj.mat.qty"), T("proj.mat.cost")],
          products,
        ),
      );
    }
    if (!mats.length && !products.length) box.appendChild(el("p", { class: "form-note", text: T("proj.mat.none") }));

    var labor = (s.labor || []).map(function (l) {
      return { cells: [l.label, l.detail || "", money(l.cost)] };
    });
    if (labor.length) {
      box.appendChild(
        table(T("proj.mat.labor"), [T("proj.mat.item"), T("proj.mat.detail"), T("proj.mat.cost")], labor),
      );
    }

    box.appendChild(
      el("dl", { class: "materials-totals" }, [
        el("dt", { text: T("proj.mat.laborTotal") }),
        el("dd", { text: money(s.laborSubtotal) }),
        el("dt", { text: T("proj.mat.materialsTotal") }),
        el("dd", { text: money(s.materialsTotal) }),
        el("dt", { class: "is-total", text: T("proj.mat.total") }),
        el("dd", { class: "is-total", text: money(s.grandTotal) }),
      ]),
    );
    (s.notes || []).forEach(function (n) {
      box.appendChild(el("p", { class: "form-note", text: n }));
    });
    box.appendChild(
      el("p", { class: "form-note", text: T("proj.mat.asOf", { date: formatDate(project.updated_at) }) }),
    );
  }

  function initDetail(config) {
    var id = params.get("id") || "";
    signInOrLeave(config, "project-loading").then(function (s) {
      if (!s) return;
      if (!id) {
        window.location.href = sitePath("projects.html");
        return;
      }
      Promise.all([api("GET", "?id=" + encodeURIComponent(id)), loadBusiness()])
        .then(function (results) {
          project = results[0].project;
          designerUrl = designerBase(results[1]);
          $("project-edit").href = withProject(designerUrl, project.id);
          show($("project-loading"), false);
          show($("project-app"), true);
          renderHead();
          renderInfo();
          renderMaterials();
          $("project-info-form").addEventListener("submit", saveInfo);
          $("project-info-form").addEventListener("input", function () {
            infoDirty = true;
          });
          // Leaving with edits that aren't saved asks first.
          window.addEventListener("beforeunload", function (e) {
            if (!infoDirty) return;
            e.preventDefault();
            e.returnValue = T("proj.infoUnsaved");
          });
          $("project-print").addEventListener("click", function () {
            window.print();
          });
          TABS.forEach(function (t, i) {
            var tab = $("tab-" + t);
            tab.addEventListener("click", function () {
              showTab(t);
            });
            tab.addEventListener("keydown", function (e) {
              var step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
              if (e.key === "Home") showTab(TABS[0], true);
              else if (e.key === "End") showTab(TABS[TABS.length - 1], true);
              else if (step) showTab(TABS[(i + step + TABS.length) % TABS.length], true);
              else return;
              e.preventDefault();
            });
          });
          showTab(window.location.hash.slice(1));
        })
        .catch(function (err) {
          show($("project-loading"), false);
          var out = $("project-error");
          status(out, "error", errorText(err, "proj.err.openFailed") + " ");
          out.appendChild(el("a", { href: window.location.href, text: T("proj.bar.retry") }));
        });
    });
  }

  // ===================================================================
  // The bar above the design studio
  // ===================================================================
  var current = null; // the open project: { id, name, info, updated_at }
  var barPlan = "free"; // or "unknown" when the plan couldn't be loaded
  var barConfig = null; // /api/config, for the saving switch and its notice
  var barLimits = null; // { monthly, total }
  var barUsed = null; // { month, total }
  var savedCode = null; // the design as last saved to (or opened from) the project
  var baselinePending = false; // the opened project's design is on its way into the studio
  var dirty = false; // the design differs from savedCode

  // The limit a new project would run into, from what the bar last heard.
  function barLimitHit() {
    if (!barLimits || !barUsed) return "";
    if (barUsed.month >= barLimits.monthly) return "monthly-limit";
    if (barUsed.total >= barLimits.total) return "total-limit";
    return "";
  }

  function studio(fn) {
    var S = window.StudioDesign;
    return S && typeof S[fn] === "function" ? S[fn]() : null;
  }

  function renderBar() {
    var paid = barPlan !== "free";
    var text = $("project-bar-text");
    text.textContent = "";
    if (barConfig && barConfig.switches && barConfig.switches.saving === false) {
      // Saving is paused (the kill switch): said up front, with the owner's
      // notice, instead of after the client's details are typed in.
      if (current) {
        text.appendChild(document.createTextNode(T("proj.bar.project") + " "));
        text.appendChild(el("a", { href: projectPage(current.id), text: current.name }));
        text.appendChild(document.createTextNode(" · "));
      }
      text.appendChild(document.createTextNode(pausedText(barConfig)));
      show($("project-save-form"), false);
      show($("project-save-new"), false);
      return;
    }
    if (barPlan === "unknown") {
      // Saving still works if the plan allows it; the server decides.
      text.appendChild(document.createTextNode(T("proj.bar.down") + " "));
      text.appendChild(el("a", { href: window.location.href, text: T("proj.bar.retry") }));
    } else if (!paid) {
      text.appendChild(document.createTextNode(T("proj.bar.free") + " "));
      text.appendChild(el("a", { href: sitePath("account.html"), text: T("proj.bar.pickPlan") }));
    } else if (current) {
      text.appendChild(document.createTextNode(T("proj.bar.project") + " "));
      text.appendChild(el("a", { href: projectPage(current.id), text: current.name }));
      var where = [current.info && current.info.client, addressOf(current.info)].filter(Boolean).join(" · ");
      if (where) text.appendChild(el("span", { class: "project-bar-where", text: " · " + where }));
    } else {
      text.textContent = T("proj.bar.unsaved");
      if (barLimits && barUsed) {
        text.appendChild(
          el("span", {
            class: "project-bar-where",
            text:
              " " +
              T("proj.bar.left", {
                month: Math.max(0, barLimits.monthly - barUsed.month),
                monthly: barLimits.monthly,
                total: Math.max(0, barLimits.total - barUsed.total),
              }),
          }),
        );
      }
    }
    show($("project-save-form"), paid);
    show($("project-save-new"), paid && !!current);
    $("project-save").textContent = current ? T("proj.save") : T("proj.saveFirst");
  }

  // The bar says when the open project has changes that aren't saved, and
  // the page asks before they'd be lost (closing the tab, following a link).
  function setDirty(on) {
    if (on === dirty) return;
    dirty = on;
    var out = $("project-status");
    if (on) status(out, "info", T("proj.unsavedChanges"));
    else if (out.textContent === T("proj.unsavedChanges")) status(out, "info", "");
  }

  function markSaved() {
    savedCode = studio("encoded");
    baselinePending = false;
    setDirty(false);
  }

  function onStudioChange() {
    if (!current) return;
    if (baselinePending) return markSaved();
    setDirty(studio("encoded") !== savedCode);
  }

  function setCurrent(p) {
    current = p ? { id: p.id, name: p.name, info: p.info || {}, updated_at: p.updated_at || "" } : null;
    try {
      var url = new URL(window.location.href);
      if (current) url.searchParams.set("project", current.id);
      else url.searchParams.delete("project");
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch (e) {
      /* fine */
    }
    renderBar();
  }

  function busy(on) {
    $("project-save").disabled = on;
    $("project-save-new").disabled = on;
    var dialogSave = document.querySelector("#project-dialog [type=submit]");
    if (dialogSave) dialogSave.disabled = on;
  }

  function saved(out, data) {
    if (data.used) barUsed = data.used;
    if (data.limits) barLimits = data.limits;
    setCurrent(data.project);
    markSaved();
    var used = data.used;
    var msg =
      used && data.limits
        ? T("proj.savedNew", {
            name: data.project.name,
            month: used.month,
            monthly: data.limits.monthly,
            total: used.total,
            limit: data.limits.total,
          })
        : T("proj.saved", { name: data.project.name });
    status(out, "success", msg);
    // A success note steps aside after a while; errors stay.
    clearTimeout(saved.timer);
    saved.timer = setTimeout(function () {
      if (out.classList.contains("is-success")) status(out, "info", "");
    }, 8000);
  }

  // Saves changes to the open project's design. The version the bar holds
  // goes along, so a save over work done in another tab is refused (409) and
  // the person chooses: take the newer version, or save over it.
  function saveChanges(overwrite) {
    var out = $("project-status");
    var code = studio("encoded");
    if (!code) return status(out, "error", T("acct.error"));
    busy(true);
    status(out, "info", T("proj.saving"));
    var body = { id: current.id, design: code, summary: studio("summary") };
    if (!overwrite && current.updated_at) body.updated_at = current.updated_at;
    api("PATCH", "", body)
      .then(function (data) {
        saved(out, data);
      })
      .catch(function (err) {
        if (err.code === "conflict") {
          return conflictNotice(
            out,
            function () {
              openProject(current.id);
            },
            function () {
              saveChanges(true);
            },
          );
        }
        status(out, "error", errorText(err, "proj.err.saveFailed"));
      })
      .then(function () {
        busy(false);
      });
  }

  // A new project: the client's details first, in a dialog. Details typed
  // and then closed away are still there when it's opened again; they go
  // once the project is saved.
  var dialogMode = null; // "new" | "copy" while the fields are built

  function openNewDialog(asCopy) {
    // Say so now rather than after the client's details are typed in.
    var hit = barLimitHit();
    if (hit) return status($("project-status"), "error", errorText({ code: hit, data: { limits: barLimits } }));
    var dialog = $("project-dialog");
    var box = $("project-dialog-fields");
    var mode = asCopy ? "copy" : "new";
    if (dialogMode !== mode) {
      box.innerHTML = "";
      box.appendChild(infoFields("new-", "", asCopy && current ? current.info : {}));
      dialogMode = mode;
    }
    status($("project-dialog-status"), "info", "");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    $("new-client").focus();
  }

  function closeDialog() {
    var dialog = $("project-dialog");
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  function createProject(e) {
    e.preventDefault();
    var out = $("project-dialog-status");
    var form = $("project-dialog-form");
    var info = readInfo(form);
    if (!checkInfo(form, "new-", info)) return;
    var code = studio("encoded");
    if (!code) return status(out, "error", T("acct.error"));
    busy(true);
    status(out, "info", T("proj.saving"));
    api("POST", "", {
      name: nameFrom(info, $("new-name").value.trim()),
      info: info,
      design: code,
      summary: studio("summary"),
    })
      .then(function (data) {
        closeDialog();
        $("project-dialog-fields").innerHTML = "";
        dialogMode = null;
        saved($("project-status"), data);
      })
      .catch(function (err) {
        showSaveError(err, form, "new-", out, "proj.err.saveFailed");
      })
      .then(function () {
        busy(false);
      });
  }

  // Opens ?project=<id>: the studio takes its design as that project
  // (StudioDesign.open: no word about links, its answers counted). The
  // design as opened is the saved state edits are measured against, so the
  // bar says "unsaved changes" only once the owner changes something.
  function openProject(id) {
    var out = $("project-status");
    status(out, "info", T("proj.loading"));
    return api("GET", "?id=" + encodeURIComponent(id))
      .then(function (data) {
        setCurrent(data.project);
        status(out, "info", "");
        var S = window.StudioDesign;
        if (!data.project.design) {
          markSaved();
        } else if (S && typeof S.open === "function" && S.open(data.project.design, data.project.name)) {
          // The studio's change event on opening sets the baseline; when
          // the design is already in place, this does.
          baselinePending = true;
          if (studio("encoded")) markSaved();
        } else {
          // An older studio: the design goes in through the address.
          baselinePending = true;
          window.location.hash = "design=" + data.project.design;
        }
      })
      .catch(function (err) {
        setCurrent(null);
        status(out, "error", errorText(err, "proj.err.openFailed"));
      });
  }

  function initBar(config) {
    var biz = window.DesignerBusiness || {};
    if (biz.unavailable && biz.unavailable !== "loading") return;
    if (!config.accounts || !hasStoredSignIn()) return;
    barConfig = config;
    var FAILED = { failed: true };
    signIn(config)
      .catch(function () {
        return FAILED;
      })
      .then(function (s) {
        if ((window.DesignerBusiness || {}).unavailable) return;
        if (s === FAILED) {
          // There is a sign-in here, but it couldn't be checked (the auth
          // service didn't answer): say so, with a way to try again, rather
          // than quietly showing no bar at all.
          var text = $("project-bar-text");
          text.textContent = "";
          text.appendChild(document.createTextNode(T("proj.bar.signinFailed") + " "));
          text.appendChild(el("a", { href: window.location.href, text: T("proj.bar.retry") }));
          show($("project-save-form"), false);
          show($("project-save-new"), false);
          show($("project-bar"), true);
          return;
        }
        if (!s) return;
        $("project-save-form").addEventListener("submit", function (e) {
          e.preventDefault();
          if (current) saveChanges();
          else openNewDialog(false);
        });
        $("project-save-new").addEventListener("click", function () {
          openNewDialog(true);
        });
        $("project-dialog-form").addEventListener("submit", createProject);
        $("project-dialog-cancel").addEventListener("click", closeDialog);
        $("project-dialog-close").addEventListener("click", closeDialog);
        document.addEventListener("studio:change", onStudioChange);
        window.addEventListener("beforeunload", function (e) {
          if (!current || !dirty) return;
          e.preventDefault();
          e.returnValue = T("proj.unsavedChanges");
        });
        api("GET", "?counts=1")
          .then(function (data) {
            barPlan = data.plan;
            barLimits = data.limits || null;
            barUsed = data.used || null;
          })
          .catch(function () {
            barPlan = "unknown";
          })
          .then(function () {
            renderBar();
            show($("project-bar"), true);
            var id = params.get("project");
            if (id) openProject(id);
          });
      });
  }

  loadConfig().then(function (config) {
    if (page === "list") initList(config);
    else if (page === "detail") initDetail(config);
    else initBar(config);
  });
})();
