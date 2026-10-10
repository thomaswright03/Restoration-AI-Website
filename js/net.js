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
//   Net.config(fresh) -> Promise<config>  /api/config (accounts, payments,
//     the kill switches), with a time limit of its own; when it can't be read
//     the answer is {accounts: false, payments: false, unreachable: true}, so
//     a page says the server couldn't be reached instead of waiting. fresh:
//     ask the server to read the switches again past its 15 s cache (after a
//     refusal that may be a switch).
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

  function config(fresh) {
    var url = fresh ? "/api/config?fresh=1" : "/api/config";
    return fetchJson(url, { cache: "no-store" }, CONFIG_TIMEOUT).catch(function () {
      return { accounts: false, payments: false, unreachable: true };
    });
  }

  window.Net = {
    fetchJson: fetchJson,
    errorKey: errorKey,
    config: config,
    TIMEOUT: TIMEOUT,
    CONFIG_TIMEOUT: CONFIG_TIMEOUT,
  };
})();
