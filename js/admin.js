// The owner's status page (admin.html): signs in with the same Supabase
// account as the site, asks /admin/status.json (api/admin-status.js, which
// checks the email is an admin's) and draws its three groups in order.
(function () {
  "use strict";

  var GROUPS = [
    ["important", "Important"],
    ["key", "Key"],
    ["basic", "Basic"],
  ];
  var WORDS = { ok: "OK", warning: "Warning", down: "Down", unknown: "Unknown" };
  var zone = "";

  function $(id) {
    return document.getElementById(id);
  }

  function say(text) {
    $("admin-message").textContent = text;
    $("admin-message").hidden = !text;
  }

  function when(iso) {
    if (!iso) return "never";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "unknown";
    var opts = { dateStyle: "medium", timeStyle: "short" };
    if (zone) opts.timeZone = zone;
    try {
      return d.toLocaleString("en-US", opts);
    } catch (e) {
      return d.toLocaleString("en-US");
    }
  }

  function status(value) {
    var s = document.createElement("span");
    s.className = "st st-" + value;
    s.textContent = WORDS[value] || "Unknown";
    return s;
  }

  function cell(row, text) {
    var td = document.createElement("td");
    if (typeof text === "string") td.textContent = text;
    else td.appendChild(text);
    row.appendChild(td);
  }

  function draw(data) {
    $("admin-overall").className = "st st-" + data.overall;
    $("admin-overall").textContent = WORDS[data.overall] || "Unknown";
    $("admin-checked").textContent = when(data.checked_at);
    $("admin-top").hidden = false;
    var host = $("admin-groups");
    host.textContent = "";
    GROUPS.forEach(function (g) {
      var rows = data.functions.filter(function (f) {
        return f.tier === g[0];
      });
      var section = document.createElement("section");
      section.setAttribute("data-group", g[0]);
      var h = document.createElement("h2");
      h.textContent = g[1];
      section.appendChild(h);
      var table = document.createElement("table");
      table.innerHTML =
        "<thead><tr><th>What</th><th>Status</th><th>Last checked</th><th>Last success</th><th>Next run</th><th>What to do</th></tr></thead>";
      var body = document.createElement("tbody");
      rows.forEach(function (f) {
        var tr = document.createElement("tr");
        cell(tr, f.name);
        cell(tr, status(f.status));
        cell(tr, when(f.last_checked));
        cell(tr, when(f.last_success));
        cell(tr, f.next_expected_run ? when(f.next_expected_run) : "");
        cell(tr, f.detail || "");
        body.appendChild(tr);
      });
      table.appendChild(body);
      section.appendChild(table);
      host.appendChild(section);
    });
  }

  function load(token) {
    say("Checking…");
    return fetch("/admin/status.json", { headers: { Authorization: "Bearer " + token }, cache: "no-store" })
      .then(function (r) {
        if (r.status === 401) return say("Sign in first: this page is for the site's admin.");
        if (r.status === 403 || r.status === 404) return say("This account is not an admin.");
        if (!r.ok) return say("The status check failed (" + r.status + "). Try again.");
        return r.json().then(function (data) {
          say("");
          draw(data);
        });
      })
      .catch(function () {
        say("Could not reach the server. Try again.");
      });
  }

  function start() {
    fetch("/site-config.json")
      .then(function (r) {
        return r.ok ? r.json() : {};
      })
      .then(function (c) {
        zone = (c && c.company && c.company.timeZone) || "";
      })
      .catch(function () {
        zone = "";
      })
      .then(function () {
        return fetch("/api/config").then(function (r) {
          return r.json();
        });
      })
      .then(function (config) {
        if (!config.accounts || !window.supabase) return say("Sign in first: this page is for the site's admin.");
        var client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
        return client.auth.getSession().then(function (r) {
          var session = r.data && r.data.session;
          if (!session) {
            say("Sign in first: this page is for the site's admin.");
            var a = document.createElement("a");
            a.href = "/signup.html?mode=login";
            a.textContent = " Sign in";
            $("admin-message").appendChild(a);
            return;
          }
          $("admin-refresh").addEventListener("click", function () {
            load(session.access_token);
          });
          return load(session.access_token);
        });
      })
      .catch(function () {
        say("Could not reach the server. Try again.");
      });
  }

  start();
})();
