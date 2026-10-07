// Room Designer 3D — a subscriber's projects: designs saved to their account.
//
// Two places use this file:
//   - projects.html ("My projects"): the plan's limits and what's used, and
//     every saved project, to open, rename or delete.
//   - designer.html: when someone is signed in, a bar above the studio that
//     saves the design as a project (or saves it again, or as a new one).
//     Homeowners using a business's designer aren't signed in, so they never
//     see it, and the Supabase script is only loaded when a sign-in exists.
//
// Everything goes through api/projects.js, which checks the plan: free
// accounts can design but not save, and each plan has a monthly and a total
// limit (api/_plans.js).

(function () {
  "use strict";

  var T = window.I18n.t;
  var LANG = window.I18n.lang();
  var DIR = LANG === "en" ? "" : LANG + "/";
  var page = document.getElementById("projects-app") ? "list" : document.getElementById("project-bar") ? "bar" : "";
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

  function sitePath(file) {
    return window.location.origin + "/" + DIR + file;
  }

  function formatDate(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString(window.I18n.locale(), { year: "numeric", month: "short", day: "numeric" });
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

  // Where projects open: the subscriber's own designer (their prices) once
  // their business is set up, else the demo designer.
  function designerBase(business) {
    return sitePath("designer.html") + (business && business.slug ? "?b=" + encodeURIComponent(business.slug) : "");
  }

  function withProject(base, id) {
    return base + (base.indexOf("?") >= 0 ? "&" : "?") + "project=" + encodeURIComponent(id);
  }

  // ===================================================================
  // My projects page
  // ===================================================================
  var state = { plan: "free", limits: { monthly: 0, total: 0 }, used: { month: 0, total: 0 }, projects: [] };
  var base = "";

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
    var el = $(id);
    el.querySelector("[data-meter-text]").textContent = T(key, { used: used, limit: limit });
    var bar = el.querySelector("meter");
    bar.max = limit || 1;
    bar.value = Math.min(used, limit);
    bar.high = Math.max(1, Math.floor((limit || 1) * 0.8));
    bar.low = Math.max(0, Math.floor((limit || 1) * 0.5));
    bar.optimum = 0;
    bar.textContent = used + " / " + limit;
  }

  function renderList() {
    var list = $("projects-list");
    list.innerHTML = "";
    state.projects.forEach(function (p) {
      list.appendChild(projectItem(p));
    });
    show($("projects-empty"), !state.projects.length);
    $("projects-count").textContent = state.projects.length ? "(" + state.projects.length + ")" : "";
  }

  function button(text, cls, onclick) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = text;
    b.addEventListener("click", onclick);
    return b;
  }

  function projectItem(p) {
    var li = document.createElement("li");
    li.className = "project-item";
    li.setAttribute("data-project", p.id);

    var main = document.createElement("div");
    main.className = "project-main";
    var name = document.createElement("a");
    name.className = "project-name";
    name.href = withProject(base, p.id);
    name.textContent = p.name;
    var meta = document.createElement("p");
    meta.className = "project-meta";
    meta.textContent = T("proj.updated", { date: formatDate(p.updated_at) });
    main.appendChild(name);
    main.appendChild(meta);
    li.appendChild(main);

    var actions = document.createElement("div");
    actions.className = "project-actions";
    var open = document.createElement("a");
    open.className = "btn btn-outline-dark btn-sm";
    open.href = withProject(base, p.id);
    open.textContent = T("proj.open");
    open.setAttribute("aria-label", T("proj.openNamed", { name: p.name }));
    var rename = button(T("proj.rename"), "link-button", function () {
      startRename(li, p);
    });
    rename.setAttribute("aria-label", T("proj.renameNamed", { name: p.name }));
    var del = button(T("proj.delete"), "link-button project-delete", function () {
      remove(p, del);
    });
    del.setAttribute("aria-label", T("proj.deleteNamed", { name: p.name }));
    actions.appendChild(open);
    actions.appendChild(rename);
    actions.appendChild(del);
    li.appendChild(actions);
    return li;
  }

  function startRename(li, p) {
    var form = document.createElement("form");
    form.className = "project-rename";
    var id = "rename-" + p.id;
    var label = document.createElement("label");
    label.htmlFor = id;
    label.className = "visually-hidden";
    label.textContent = T("proj.nameLabel");
    var input = document.createElement("input");
    input.type = "text";
    input.id = id;
    input.maxLength = 120;
    input.required = true;
    input.value = p.name;
    var save = document.createElement("button");
    save.type = "submit";
    save.className = "btn btn-primary btn-sm";
    save.textContent = T("proj.saveName");
    var cancel = button(T("proj.cancel"), "link-button", function () {
      li.replaceWith(projectItem(p));
    });
    form.appendChild(label);
    form.appendChild(input);
    form.appendChild(save);
    form.appendChild(cancel);
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
    var main = li.querySelector(".project-main");
    main.replaceWith(form);
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
    if (!config.accounts) {
      show($("projects-loading"), false);
      show($("accounts-off"), true);
      return;
    }
    signIn(config).then(function (s) {
      if (!s) {
        window.location.href = sitePath("signup.html") + "?mode=login";
        return;
      }
      $("projects-email").textContent = T("auth.signedInAs", { email: s.user.email });
      show($("projects-email"), true);
      Promise.all([
        api("GET"),
        client
          .from("businesses")
          .select("slug")
          .maybeSingle()
          .then(function (r) {
            return r.data || null;
          }),
      ])
        .then(function (results) {
          var data = results[0];
          state.plan = data.plan;
          state.limits = data.limits;
          state.used = data.used;
          state.projects = data.projects || [];
          base = designerBase(results[1]);
          $("project-new").href = base;
          show($("projects-loading"), false);
          show($("projects-app"), true);
          renderUsage();
          renderList();
        })
        .catch(function (err) {
          show($("projects-loading"), false);
          show($("projects-app"), true);
          base = designerBase(null);
          $("project-new").href = base;
          renderList();
          status($("projects-status"), "error", errorText(err));
        });
    });
  }

  // ===================================================================
  // The bar above the design studio
  // ===================================================================
  var current = null; // the open project: { id, name }
  var barPlan = "free";

  function design() {
    return window.StudioDesign && typeof window.StudioDesign.encoded === "function"
      ? window.StudioDesign.encoded()
      : "";
  }

  function defaultName() {
    return T("proj.defaultName", { date: formatDate(new Date().toISOString()) });
  }

  function renderBar() {
    var paid = barPlan !== "free";
    var text = $("project-bar-text");
    text.textContent = "";
    if (!paid) {
      text.appendChild(document.createTextNode(T("proj.bar.free") + " "));
      var a = document.createElement("a");
      a.href = sitePath("account.html");
      a.textContent = T("proj.bar.pickPlan");
      text.appendChild(a);
    } else {
      text.textContent = current ? T("proj.bar.editing", { name: current.name }) : T("proj.bar.unsaved");
    }
    show($("project-save-form"), paid);
    show($("project-save-new"), paid && !!current);
    $("project-save").textContent = current ? T("proj.save") : T("proj.saveFirst");
  }

  function setCurrent(p) {
    current = p ? { id: p.id, name: p.name } : null;
    if (current) $("project-name").value = current.name;
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

  function saveProject(asNew) {
    var out = $("project-status");
    var code = design();
    var name = $("project-name").value.trim() || defaultName();
    if (!code) return status(out, "error", T("acct.error"));
    var request =
      current && !asNew
        ? api("PATCH", "", { id: current.id, name: name, design: code })
        : api("POST", "", { name: name, design: code });
    $("project-save").disabled = true;
    $("project-save-new").disabled = true;
    status(out, "info", T("proj.saving"));
    request
      .then(function (data) {
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
        clearTimeout(saveProject.timer);
        saveProject.timer = setTimeout(function () {
          if (out.classList.contains("is-success")) status(out, "info", "");
        }, 8000);
      })
      .catch(function (err) {
        status(out, "error", errorText(err));
      })
      .then(function () {
        $("project-save").disabled = false;
        $("project-save-new").disabled = false;
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
    signIn(config).then(function (s) {
      if (!s) return;
      if ((window.DesignerBusiness || {}).unavailable) return;
      $("project-name").placeholder = defaultName();
      $("project-save-form").addEventListener("submit", function (e) {
        e.preventDefault();
        saveProject(false);
      });
      $("project-save-new").addEventListener("click", function () {
        saveProject(true);
      });
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
    else initBar(config);
  });
})();
