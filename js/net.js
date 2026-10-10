// Room Designer 3D — one way for the browser to call the server (the
// account, projects and designer pages): a JSON fetch with a time limit that
// tells being offline, a request that never comes back and a server failure
// apart, so each page can say what happened and what to do.
//
//   Net.fetchJson(url, options, timeoutMs) -> Promise<data>
//     Rejects with an Error carrying:
//       kind   "offline" | "network" | "timeout" | "server" | "http"
//       status the HTTP status, for "server" and "http"
//       code   the API's own error word ({error: "..."}), else the kind
//       data   the parsed body, or {}
//   Net.errorKey(err) -> the js/i18n.js key that says what to do
//   Net.timedQuery(query, timeoutMs) -> Promise<data>
//     A supabase-js read with a time limit (READ_TIMEOUT by default): a hung
//     database must never leave a page on "Loading…" for good. Resolves with
//     the row(s); rejects with the PostgREST error, or with an Error of
//     kind/code "timeout" after the limit. The hung request is aborted too,
//     so a Try again right after doesn't queue behind it in the browser.
//   Net.config(fresh) -> Promise<config>  /api/config (accounts, payments,
//     the kill switches), with a time limit of its own; when it can't be read
//     the answer is {accounts: false, payments: false, unreachable: true,
//     reason} (reason: the js/i18n.js key that says why: offline, timed out,
//     unreachable, or the server failing), so a page says what happened
//     instead of waiting. fresh: ask the server to read the switches again
//     past its 15 s cache (after a refusal that may be a switch).
//   Net.reference(err) -> string  the API's request id for a failed call
//     (the "Reference: …" a person can quote; it's in the server's log line),
//     or "" when there is none.
//   Net.withReference(text, err) -> string  text, plus the reference sentence
//     (I18n "net.reference") when the error carries one.
//   Net.report(kind, message, extra) sends one error report to /api/log
//     (api/log.js): kind "error" | "unhandledrejection" | "load", with the
//     page's path, the language and the signed-in account's id (nothing else
//     about the person). At most REPORT_MAX per page load, never while
//     offline, and a failure to send is ignored.
//   Net.reportErrors() installs the reporters: uncaught errors, unhandled
//     promise rejections and a <script>/<link> that failed to load (a key
//     file missing is the one failure nothing else on the page can explain).
//     js/script.js calls it once; a second call does nothing.
//
// Must load after js/i18n.js and before js/account.js and js/projects.js.
(function () {
  "use strict";

  var TIMEOUT = 15000;
  // /api/config is on every signed-in page's way in, so it waits less.
  var CONFIG_TIMEOUT = 10000;

  function fetchJson(url, options, timeoutMs) {
    options = Object.assign({}, options || {});
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timedOut = false;
    var timer = setTimeout(function () {
      timedOut = true;
      if (controller) controller.abort();
    }, timeoutMs || TIMEOUT);
    if (controller) options.signal = controller.signal;
    return fetch(url, options)
      .then(
        function (res) {
          return res
            .json()
            .catch(function () {
              return {};
            })
            .then(function (data) {
              if (!res.ok) {
                var err = new Error(data.error || "HTTP " + res.status);
                err.kind = res.status >= 500 ? "server" : "http";
                err.status = res.status;
                err.code = data.error || "server";
                err.data = data;
                throw err;
              }
              return data;
            });
        },
        function () {
          // fetch itself failed: the request never got an answer.
          var kind = timedOut ? "timeout" : navigator.onLine === false ? "offline" : "network";
          var err = new Error(kind);
          err.kind = kind;
          err.code = kind;
          err.data = {};
          throw err;
        },
      )
      .then(
        function (data) {
          clearTimeout(timer);
          return data;
        },
        function (err) {
          clearTimeout(timer);
          throw err;
        },
      );
  }

  function errorKey(err) {
    var kind = err && err.kind;
    if (kind === "offline") return "net.offline";
    if (kind === "network") return "net.network";
    if (kind === "timeout") return "net.timeout";
    return "net.server";
  }

  // Browser-side Supabase reads (the account and projects pages).
  var READ_TIMEOUT = 10000;

  function timedQuery(query, timeoutMs) {
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    // supabase-js: the request is cancelled when the signal fires, so a
    // retry isn't held behind a request nobody is waiting for any more.
    if (controller && query && typeof query.abortSignal === "function") query = query.abortSignal(controller.signal);
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        done = true;
        var err = new Error("timeout");
        err.kind = "timeout";
        err.code = "timeout";
        reject(err);
        if (controller) controller.abort();
      }, timeoutMs || READ_TIMEOUT);
      Promise.resolve(query).then(
        function (r) {
          if (done) return;
          clearTimeout(timer);
          if (r && r.error) reject(r.error);
          else resolve((r && r.data) || null);
        },
        function (err) {
          if (done) return;
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  function config(fresh) {
    var url = fresh ? "/api/config?fresh=1" : "/api/config";
    return fetchJson(url, { cache: "no-store" }, CONFIG_TIMEOUT).catch(function (err) {
      return { accounts: false, payments: false, unreachable: true, reason: errorKey(err) };
    });
  }

  function reference(err) {
    var id = err && err.data && err.data.requestId;
    return typeof id === "string" ? id.slice(0, 80) : "";
  }

  function withReference(text, err) {
    var id = reference(err);
    if (!id || !window.I18n) return text;
    return text + " " + window.I18n.t("net.reference", { id: id });
  }

  // ---------- error reports (api/log.js) ----------
  var REPORT_MAX = 5;
  var reported = 0;
  var installed = false;

  // The signed-in account's id, from the sign-in supabase-js keeps in
  // localStorage (sb-<project>-auth-token), or "". Only the id.
  function userId() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i) || "";
        if (!/^sb-.+-auth-token$/.test(key)) continue;
        var saved = JSON.parse(localStorage.getItem(key) || "null");
        var id = saved && saved.user && saved.user.id;
        if (typeof id === "string") return id;
      }
    } catch (e) {
      /* storage blocked or not JSON: no id */
    }
    return "";
  }

  function report(kind, message, extra) {
    if (reported >= REPORT_MAX || navigator.onLine === false) return false;
    reported++;
    var body = {
      kind: kind,
      page: window.location.pathname,
      message: String(message || "").slice(0, 300),
      lang: window.I18n ? window.I18n.lang() : "",
      userId: userId(),
    };
    if (extra && extra.stack) body.stack = String(extra.stack).slice(0, 1000);
    if (extra && extra.source) body.source = String(extra.source).slice(0, 300);
    var json = JSON.stringify(body);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon("/api/log", new Blob([json], { type: "application/json" }))) {
        return true;
      }
      fetch("/api/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: json,
        keepalive: true,
      }).catch(function () {});
    } catch (e) {
      /* a report must never be a second failure */
    }
    return true;
  }

  // A script, stylesheet, image or model that didn't load: the event fires
  // on the element and never bubbles, so it is caught on the way down.
  function failedLoad(e) {
    var el = e && e.target;
    if (!el || el === window || !el.tagName) return false;
    var tag = el.tagName.toUpperCase();
    if (tag !== "SCRIPT" && tag !== "LINK") return false;
    report("load", tag.toLowerCase() + " failed to load", { source: el.src || el.href || "" });
    return true;
  }

  function reportErrors() {
    if (installed || typeof window.addEventListener !== "function") return;
    installed = true;
    window.addEventListener(
      "error",
      function (e) {
        if (failedLoad(e)) return;
        if (!e || e.target !== window) return;
        var err = e.error;
        report("error", e.message || (err && err.message) || "error", {
          stack: err && err.stack,
          source: e.filename ? e.filename + ":" + (e.lineno || 0) : "",
        });
      },
      true,
    );
    window.addEventListener("unhandledrejection", function (e) {
      var r = e && e.reason;
      // A failed API call already made its own log line on the server.
      if (r && r.kind && r.data) return;
      report("unhandledrejection", (r && r.message) || String(r || "rejection"), { stack: r && r.stack });
    });
  }

  window.Net = {
    fetchJson: fetchJson,
    errorKey: errorKey,
    timedQuery: timedQuery,
    config: config,
    reference: reference,
    withReference: withReference,
    report: report,
    reportErrors: reportErrors,
    TIMEOUT: TIMEOUT,
    READ_TIMEOUT: READ_TIMEOUT,
    CONFIG_TIMEOUT: CONFIG_TIMEOUT,
    REPORT_MAX: REPORT_MAX,
  };
})();
