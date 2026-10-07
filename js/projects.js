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

  // Calls api/projects.js. Rejects with err.code set to the API's error.
  function api(method, query, body) {
    return fetch("/api/projects" + (query || ""), {
      method: method,
      headers: Object.assign(
        { Authorization: "Bearer " + session.access_token },
        body ? { "Content-Type": "application/json" } : {},
      ),
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    }).then(function (res) {
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (data) {
          if (!res.ok) {
            var err = new Error(data.error || "HTTP " + res.status);
            err.code = data.error || "server";
            err.data = data;
            throw err;
          }
          return data;
        });
    });
  }

  // The message for a failed save, in plain words.
  function errorText(err) {
    var d = (err && err.data) || {};
    var limits = d.limits || {};
    if (err.code === "plan") return T("proj.err.plan");
    if (err.code === "monthly-limit") return T("proj.err.monthly", { n: limits.monthly || 0 });
    if (err.code === "total-limit") return T("proj.err.total", { n: limits.total || 0 });
    if (err.code === "setup") return T("proj.err.setup");
    if (err.code === "signin") return T("proj.err.signin");
    if (err.code === "not-found") return T("proj.err.notFound");
    if (err.code === "info") return T("proj.err.info");
    return T("acct.error");
  }

  function loadConfig() {
    return fetch("/api/config", { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .catch(function () {
        return { accounts: false };
      });
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
    function off() {
      show($(loadingId), false);
      show($("accounts-off"), true);
      return false;
    }
    if (!config.accounts) return Promise.resolve(off());
    return signIn(config)
      .catch(off)
      .then(function (s) {
        if (s === false) return false;
        if (!s) {
          window.location.href = sitePath("signup.html") + "?mode=login";
          return false;
        }
        return s;
      });
  }

  function loadBusiness() {
    return client
      .from("businesses")
      .select("slug")
      .maybeSingle()
      .then(function (r) {
        return r.data || null;
      })
      .catch(function () {
        return null;
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
          "aria-describedby": prefix + "name-help",
        }),
        el("p", { class: "form-note", id: prefix + "name-help", text: T("proj.f.nameHelp") }),
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
        grid.appendChild(
          el("div", { class: "form-group info-" + key }, [el("label", { for: id, text: T("proj.f." + key) }), input]),
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

  // A name from the details when none was typed.
  function nameFrom(info, typed) {
    if (typed) return typed;
    var parts = [info.client, info.street].filter(Boolean);
    return parts.length ? parts.join(", ") : T("proj.defaultName", { date: formatDate(new Date().toISOString()) });
  }

  function validEmail(v) {
    return !v || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
  }

  // ===================================================================
  // My projects page
  // ===================================================================
  var state = { plan: "free", limits: { monthly: 0, total: 0 }, used: { month: 0, total: 0 }, projects: [] };

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

  function searchText(p) {
    var i = p.info || {};
    return [p.name, i.client, i.phone, i.email, addressOf(i)].join(" ").toLowerCase();
  }

  function renderList() {
    var list = $("projects-list");
    var q = ($("projects-search").value || "").trim().toLowerCase();
    var shown = state.projects.filter(function (p) {
      return !q || searchText(p).indexOf(q) >= 0;
    });
    list.innerHTML = "";
    shown.forEach(function (p) {
      list.appendChild(projectItem(p));
    });
    show($("projects-empty"), !state.projects.length);
    show($("projects-search-wrap"), state.projects.length > 1);
    show($("projects-no-match"), !!state.projects.length && !shown.length);
    $("projects-count").textContent = state.projects.length ? "(" + state.projects.length + ")" : "";
  }

  function projectItem(p) {
    var info = p.info || {};
    var li = el("li", { class: "project-item", "data-project": p.id });
    var meta = [];
    if (info.client) meta.push(info.client);
    if (addressOf(info)) meta.push(addressOf(info));
    var main = el("div", { class: "project-main" }, [
      el("a", { class: "project-name", href: projectPage(p.id), text: p.name }),
      meta.length ? el("p", { class: "project-client", text: meta.join(" · ") }) : null,
      el("p", { class: "project-meta" }, [
        info.status
          ? el("span", { class: "project-status is-" + info.status, text: T("proj.status." + info.status) })
          : null,
        info.start ? T("proj.starts", { date: formatDay(info.start) }) + " · " : null,
        T("proj.updated", { date: formatDate(p.updated_at) }),
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
    var input = el("input", { type: "text", id: id, maxlength: 120, required: true });
    input.value = p.name;
    var save = el("button", { type: "submit", class: "btn btn-primary btn-sm", text: T("proj.saveName") });
    var form = el("form", { class: "project-rename" }, [
      el("label", { for: id, class: "visually-hidden", text: T("proj.nameLabel") }),
      input,
      save,
      el("button", {
        type: "button",
        class: "link-button",
        text: T("proj.cancel"),
        onclick: function () {
          li.replaceWith(projectItem(p));
        },
      }),
    ]);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = input.value.trim();
      if (!name) return status($("projects-status"), "error", T("proj.err.name"));
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
          status($("projects-status"), "error", errorText(err));
        });
    });
    li.querySelector(".project-main").replaceWith(form);
    var actions = li.querySelector(".project-actions");
    if (actions) actions.hidden = true;
    input.focus();
    input.select();
  }

  function remove(p, btn) {
    var paid = state.plan !== "free";
    if (!window.confirm(T(paid ? "proj.deleteConfirm" : "proj.deleteConfirmFree", { name: p.name }))) return;
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
        status($("projects-status"), "error", errorText(err));
      });
  }

  function initList(config) {
    signInOrLeave(config, "projects-loading").then(function (s) {
      if (!s) return;
      $("projects-email").textContent = T("auth.signedInAs", { email: s.user.email });
      show($("projects-email"), true);
      $("projects-search").addEventListener("input", renderList);
      Promise.all([api("GET"), loadBusiness()])
        .then(function (results) {
          var data = results[0];
          state.plan = data.plan;
          state.limits = data.limits;
          state.used = data.used;
          state.projects = data.projects || [];
          $("project-new").href = designerBase(results[1]);
          show($("projects-loading"), false);
          show($("projects-app"), true);
          renderUsage();
          renderList();
        })
        .catch(function (err) {
          show($("projects-loading"), false);
          show($("projects-app"), true);
          $("project-new").href = designerBase(null);
          renderList();
          status($("projects-status"), "error", errorText(err));
        });
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

  function renderInfo() {
    var box = $("project-info-fields");
    box.innerHTML = "";
    box.appendChild(infoFields("info-", project.name, project.info));
  }

  function saveInfo(e) {
    e.preventDefault();
    var out = $("project-info-status");
    var form = $("project-info-form");
    var info = readInfo(form);
    if (!validEmail(info.email)) return status(out, "error", T("auth.emailInvalid"));
    var name = nameFrom(info, $("info-name").value.trim());
    var btn = form.querySelector("[type=submit]");
    btn.disabled = true;
    api("PATCH", "", { id: project.id, name: name, info: info })
      .then(function (data) {
        Object.assign(project, data.project);
        $("info-name").value = project.name;
        renderHead();
        status(out, "success", T("proj.infoSaved"));
      })
      .catch(function (err) {
        status(out, "error", errorText(err));
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
          status($("project-error"), "error", errorText(err));
        });
    });
  }

  // ===================================================================
  // The bar above the design studio
  // ===================================================================
  var current = null; // the open project: { id, name, info }
  var barPlan = "free";

  function studio(fn) {
    var S = window.StudioDesign;
    return S && typeof S[fn] === "function" ? S[fn]() : null;
  }

  function renderBar() {
    var paid = barPlan !== "free";
    var text = $("project-bar-text");
    text.textContent = "";
    if (!paid) {
      text.appendChild(document.createTextNode(T("proj.bar.free") + " "));
      text.appendChild(el("a", { href: sitePath("account.html"), text: T("proj.bar.pickPlan") }));
    } else if (current) {
      text.appendChild(document.createTextNode(T("proj.bar.project") + " "));
      text.appendChild(el("a", { href: projectPage(current.id), text: current.name }));
      var where = [current.info && current.info.client, addressOf(current.info)].filter(Boolean).join(" · ");
      if (where) text.appendChild(el("span", { class: "project-bar-where", text: " · " + where }));
    } else {
      text.textContent = T("proj.bar.unsaved");
    }
    show($("project-save-form"), paid);
    show($("project-save-new"), paid && !!current);
    $("project-save").textContent = current ? T("proj.save") : T("proj.saveFirst");
  }

  function setCurrent(p) {
    current = p ? { id: p.id, name: p.name, info: p.info || {} } : null;
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
    setCurrent(data.project);
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

  // Saves changes to the open project's design.
  function saveChanges() {
    var out = $("project-status");
    var code = studio("encoded");
    if (!code) return status(out, "error", T("acct.error"));
    busy(true);
    status(out, "info", T("proj.saving"));
    api("PATCH", "", { id: current.id, design: code, summary: studio("summary") })
      .then(function (data) {
        saved(out, data);
      })
      .catch(function (err) {
        status(out, "error", errorText(err));
      })
      .then(function () {
        busy(false);
      });
  }

  // A new project: the client's details first, in a dialog.
  function openNewDialog(asCopy) {
    var dialog = $("project-dialog");
    var box = $("project-dialog-fields");
    box.innerHTML = "";
    box.appendChild(infoFields("new-", "", asCopy && current ? current.info : {}));
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
    if (!validEmail(info.email)) return status(out, "error", T("auth.emailInvalid"));
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
        saved($("project-status"), data);
      })
      .catch(function (err) {
        status(out, "error", errorText(err));
      })
      .then(function () {
        busy(false);
      });
  }

  // Opens ?project=<id>: its design goes into the address as #design=...,
  // which the studio picks up (on load, or as a link opened in place).
  function openProject(id) {
    return api("GET", "?id=" + encodeURIComponent(id))
      .then(function (data) {
        setCurrent(data.project);
        if (data.project.design) window.location.hash = "design=" + data.project.design;
      })
      .catch(function (err) {
        setCurrent(null);
        status($("project-status"), "error", errorText(err));
      });
  }

  function initBar(config) {
    var biz = window.DesignerBusiness || {};
    if (biz.unavailable && biz.unavailable !== "loading") return;
    if (!config.accounts || !hasStoredSignIn()) return;
    signIn(config)
      .catch(function () {
        return null;
      })
      .then(function (s) {
        if (!s) return;
        if ((window.DesignerBusiness || {}).unavailable) return;
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
        api("GET")
          .then(function (data) {
            barPlan = data.plan;
          })
          .catch(function () {
            barPlan = "free";
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
