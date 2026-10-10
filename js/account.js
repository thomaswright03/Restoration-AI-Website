// Room Designer 3D — sign-up / log-in page and the account page.
//
// Accounts are Supabase Auth; the browser talks to Supabase directly with
// the public anon key, and row-level security (supabase/schema.sql) limits
// each owner to their own business, subscription and leads. Buying and
// billing go through api/checkout.js and api/portal.js (Stripe).
//
// /api/config says whether accounts and payments are switched on. When they
// aren't (no keys set yet), both pages show a short "not switched on yet"
// notice instead of the forms.

(function () {
  "use strict";

  var T = window.I18n.t;
  var Pricing = window.BathroomPricing;
  var page = document.getElementById("auth-form") ? "signup" : document.getElementById("account-app") ? "account" : "";
  if (!page) return;

  var LANG = window.I18n.lang();
  var DIR = LANG === "en" ? "" : LANG + "/";
  var params = new URLSearchParams(window.location.search);
  var PLANS = ["starter", "pro", "max"];
  var client = null;
  var config = null;
  // After coming back from a successful checkout: "pending" while the plan
  // is being confirmed, "slow" when confirmation hasn't come in 30 s. The
  // buy buttons stay away in both, so nobody buys twice.
  var checkoutWait = "";

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
    // Pages live at /<file>, /es/<file>, /pt/<file>.
    return window.location.origin + "/" + DIR + file;
  }

  function formatDate(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString(window.I18n.locale(), { year: "numeric", month: "long", day: "numeric" });
  }

  // /api/config with a time limit (js/net.js); unreachable when it can't be
  // read, with reason: the js/i18n.js key that says why (offline, timed out,
  // unreachable, or the server failing), for the "couldn't reach" notice.
  function loadConfig() {
    return window.Net.fetchJson("/api/config", { cache: "no-store" }, window.Net.CONFIG_TIMEOUT).catch(function (err) {
      return { accounts: false, payments: false, unreachable: true, reason: window.Net.errorKey(err) };
    });
  }

  // Where to go after signing in: ?next=<path on this site> when the link
  // says so (My projects sends people here with it), else My projects. A plan
  // or promo code in the link goes to the account page, where the plans are.
  function safeNext(value) {
    var text = String(value || "");
    if (!/^\/(?!\/)/.test(text)) return "";
    try {
      var url = new URL(text, window.location.origin);
      if (url.origin !== window.location.origin) return "";
      return url.pathname + url.search + url.hash;
    } catch (e) {
      return "";
    }
  }

  // The address of this page, for a ?next= that brings someone back here.
  function herePath() {
    return window.location.pathname + window.location.search + window.location.hash;
  }

  function loginPath(next) {
    var query = new URLSearchParams({ mode: "login" });
    if (safeNext(next)) query.set("next", safeNext(next));
    return sitePath("signup.html") + "?" + query.toString();
  }

  // The kill switches (api/_switches.js): off only when the server says so.
  function switchedOff(name) {
    return !!(config && config.switches && config.switches[name] === false);
  }

  // A notice the owner set in site_switches.notice, shown as written.
  function showSiteNotice() {
    var el = $("site-notice");
    var text = String((config && config.notice) || "").trim();
    if (!el || !text) return;
    el.querySelector("p").textContent = text;
    show(el, true);
  }

  // The message for a failed call to api/: what happened, in plain words,
  // naming the real cause. The API's own reasons come first (a paused
  // checkout is a 503 too, and must never read as a connection problem);
  // then the server's own failure (a 5xx, or the API saying "server" or
  // "unavailable": nothing to do with the connection); then what the
  // connection did (js/net.js err.kind: offline, timed out, unreachable).
  // stripeKey: the text for a Stripe failure in this call (the payment page
  // or the billing page couldn't be opened; the server itself was reached).
  function errorKey(err, stripeKey) {
    var code = err && err.code;
    var kind = err && err.kind;
    if (code === "paused") return "acct.paused.checkout";
    if (code === "already-subscribed") return "acct.alreadySubscribed";
    if (code === "promo") return "acct.promo.invalid";
    if (code === "promo-used") return "acct.promo.used";
    if (code === "stripe") return stripeKey || "acct.stripe.checkout";
    if (code === "unavailable" || code === "server" || kind === "server") return "net.server";
    if (kind === "offline" || kind === "timeout" || kind === "network") return window.Net.errorKey(err);
    return "acct.error";
  }

  // A fetch that never got an answer (Supabase's client rejects with a
  // TypeError, or answers with an error whose status is 0 and whose message
  // names the fetch): the connection, not the service.
  function connectionFailed(error) {
    if (!error) return false;
    if (error instanceof TypeError) return true;
    if (error.status === 0) return true;
    return /failed to fetch|fetch failed|networkerror|load failed|network request failed/i.test(error.message || "");
  }

  // Why a Supabase call (a read, a save, a sign-in) failed, in plain words,
  // by its real cause: ran out of time (timedRead), no answer from the
  // network (offline, or the server unreachable), the server itself failing
  // (a PostgREST or 5xx code), else a refused request ("something went
  // wrong": the fields were checked before sending).
  function failReason(error) {
    if (error && error.kind === "timeout") return "net.timeout";
    if (connectionFailed(error)) return navigator.onLine === false ? "net.offline" : "net.network";
    var code = String((error && error.code) || "");
    if (!code || /^(PGRST|5\d\d)/.test(code) || (error && error.status >= 500 && error.status < 600)) {
      return "net.server";
    }
    return "acct.error";
  }

  function accountsOff() {
    show($("account-loading"), false);
    var down = config && config.unreachable;
    // Why /api/config couldn't be read, when known (loadConfig): the
    // connection or the server, not always "check your connection".
    if (down && config.reason && $("server-down-text")) $("server-down-text").textContent = T(config.reason);
    show($(down ? "server-down" : "accounts-off"), true);
  }

  // Supabase Auth error codes worth their own message.
  function signupErrorKey(error) {
    var code = error.code || "";
    if (code === "email_address_invalid") return "auth.emailRejected";
    if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit") return "auth.rateLimited";
    if (code === "weak_password") return "auth.passwordShort";
    if (code === "user_already_exists" || /already|registered/i.test(error.message || "")) return "auth.exists";
    if (databaseRefused(error) || (error.status >= 500 && error.status < 600)) return "auth.serviceDown";
    if (connectionFailed(error)) return failReason(error);
    return "acct.error";
  }

  // The sign-up trigger (supabase/schema.sql, refuse_signup_when_paused)
  // reaches the page as Supabase Auth's "Database error saving new user"
  // (unexpected_failure): the switch flipped after the page loaded, or the
  // database itself failed. Which one, the switches say (loadConfig again).
  function databaseRefused(error) {
    return (
      (error && error.code === "unexpected_failure") ||
      /database error|signups-paused/i.test((error && error.message) || "")
    );
  }

  // ===================================================================
  // Sign-up / log-in page
  // ===================================================================
  function initSignup() {
    var form = $("auth-form");
    var statusEl = $("auth-status");
    var submit = $("auth-submit");
    var signupsOff = switchedOff("signups");
    var mode = params.get("mode") === "login" || signupsOff ? "login" : "signup";

    // Sign-ups paused: say so, and offer only log in.
    function showSignupsPaused() {
      signupsOff = true;
      show($("signups-paused"), true);
      show(document.querySelector('[data-mode="signup"]'), false);
      showSiteNotice();
    }
    if (signupsOff) showSignupsPaused();

    function setMode(next) {
      mode = next;
      Array.prototype.forEach.call(document.querySelectorAll("[data-mode]"), function (b) {
        b.setAttribute("aria-pressed", b.getAttribute("data-mode") === mode ? "true" : "false");
      });
      Array.prototype.forEach.call(document.querySelectorAll("[data-mode-text]"), function (el) {
        el.hidden = el.getAttribute("data-mode-text") !== mode;
      });
      Array.prototype.forEach.call(document.querySelectorAll("[data-mode-field]"), function (el) {
        el.hidden = el.getAttribute("data-mode-field").split(" ").indexOf(mode) < 0;
      });
      $("auth-password").setAttribute("autocomplete", mode === "signup" ? "new-password" : "current-password");
      status(statusEl, "info", "");
    }

    Array.prototype.forEach.call(document.querySelectorAll("[data-mode]"), function (b) {
      b.addEventListener("click", function () {
        setMode(b.getAttribute("data-mode"));
      });
    });
    $("auth-forgot").addEventListener("click", function () {
      setMode("reset");
    });
    $("auth-back").addEventListener("click", function () {
      setMode("login");
    });
    setMode(mode);
    if (params.get("deleted")) status(statusEl, "success", T("acct.delete.done"));

    // After signing in: the account page when the link carries a plan or
    // promo code (the plans are there), else ?next= or My projects. A new
    // account goes to the account page either way: its plan is picked there.
    function next(signup) {
      var keep = new URLSearchParams();
      var plan = params.get("plan");
      if (PLANS.indexOf(plan) >= 0) keep.set("plan", plan);
      if (params.get("promo")) keep.set("promo", params.get("promo"));
      var query = keep.toString();
      if (query || signup) return sitePath("account.html") + (query ? "?" + query : "");
      var wanted = safeNext(params.get("next"));
      return wanted ? window.location.origin + wanted : sitePath("projects.html");
    }

    // A refused sign-up: paused (the switch flipped after the page loaded),
    // or the sign-up service failed. The switches say which.
    function explainRefusal(error) {
      if (!databaseRefused(error)) return Promise.resolve(status(statusEl, "error", T(signupErrorKey(error))));
      // fresh: past the server's 15 s cache, so a switch flipped seconds ago
      // reads as "paused" and not as a service fault.
      return window.Net.config(true).then(function (c) {
        if (c && c.switches) config = c;
        if (switchedOff("signups")) {
          showSignupsPaused();
          setMode("login");
          return status(statusEl, "error", T("acct.paused.signups"));
        }
        status(statusEl, "error", T("auth.serviceDown"));
      });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = $("auth-email").value.trim();
      var password = $("auth-password").value;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return status(statusEl, "error", T("auth.emailInvalid"));
      if (mode !== "reset" && password.length < 8) return status(statusEl, "error", T("auth.passwordShort"));
      if (mode === "signup" && signupsOff) return status(statusEl, "error", T("acct.paused.signups"));
      submit.disabled = true;

      var request;
      if (mode === "reset") {
        request = client.auth.resetPasswordForEmail(email, { redirectTo: sitePath("account.html") }).then(function (r) {
          if (r.error && r.error.code !== "user_not_found")
            return status(statusEl, "error", T(signupErrorKey(r.error)));
          status(statusEl, "success", T("auth.resetSent"));
        });
      } else if (mode === "login") {
        request = client.auth.signInWithPassword({ email: email, password: password }).then(function (r) {
          if (r.error) {
            // A wrong password is a 400; a failing service is a 5xx; no
            // answer at all is the connection. Never "don't match" for those.
            var key =
              r.error.status >= 500
                ? "auth.serviceDown"
                : connectionFailed(r.error)
                  ? failReason(r.error)
                  : "auth.badLogin";
            return status(statusEl, "error", T(key));
          }
          window.location.href = next(false);
        });
      } else {
        request = client.auth
          .signUp({
            email: email,
            password: password,
            options: {
              // lang picks the language of Supabase's emails (supabase/emails/).
              data: { business_name: $("auth-business").value.trim().slice(0, 120), lang: LANG },
              emailRedirectTo: next(true),
            },
          })
          .then(function (r) {
            if (r.error) return explainRefusal(r.error);
            if (r.data && r.data.session) window.location.href = next(true);
            else status(statusEl, "success", T("auth.checkEmail"));
          });
      }
      request
        .catch(function (err) {
          // The client itself threw (no answer from the network, most often).
          status(statusEl, "error", T(failReason(err)));
        })
        .then(function () {
          submit.disabled = false;
        });
    });

    client.auth.getSession().then(function (r) {
      if (r.data && r.data.session && mode !== "reset") window.location.href = next(false);
      else show($("auth-card"), true);
    });
  }

  // ===================================================================
  // Account page
  // ===================================================================
  var session = null;
  var business = null;
  var subscription = null;
  // Whether the last read of each failed (or ran out of time). While a read
  // has failed the page shows that, never "no plan" or an empty form: a
  // paying business must not be told it's on the free plan, and an owner
  // must not re-type details that are safely saved.
  var planFailed = false;

  // A Supabase read with a time limit: a hung database must not leave a card
  // blank forever. Resolves with the data; rejects with the PostgREST error,
  // or {kind: "timeout"} after READ_MS.
  var READ_MS = 10000;
  function timedRead(query) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        done = true;
        var err = new Error("timeout");
        err.kind = "timeout";
        err.code = "timeout";
        reject(err);
      }, READ_MS);
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

  // js/net.js: a time limit, and err.kind tells offline, timeout and server
  // failure apart. Rejects with err.code set to the API's error word.
  function api(path, body) {
    return window.Net.fetchJson(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
      body: JSON.stringify(body || {}),
    });
  }

  function isLive() {
    return !!subscription && (subscription.status === "active" || subscription.status === "trialing");
  }

  // The plan card's one sentence for a subscription state (and whether a
  // plan can be bought from here). Stripe statuses: none (no row yet),
  // trialing, active, past_due, unpaid, paused, incomplete,
  // incomplete_expired, canceled.
  function planText(s) {
    var date = formatDate(s.current_period_end);
    if (s.status === "trialing") {
      return date ? T("acct.status.trialing", { date: date }) : T("acct.status.trialingNoDate");
    }
    if (s.status === "active" && s.cancel_at_period_end) {
      return date ? T("acct.status.ending", { date: date }) : T("acct.status.endingNoDate");
    }
    if (s.status === "active") return date ? T("acct.status.active", { date: date }) : T("acct.status.activeNoDate");
    // The states a plan can be bought from: when it can't be (payments not
    // set up, or checkout paused), the sentence must not point at buttons
    // that aren't there.
    if (s.status === "none" || s.status === "canceled" || s.status === "incomplete_expired") {
      if (!config.payments) return T("acct.status." + s.status + "PaymentsOff");
      if (switchedOff("checkout")) return T("acct.status." + s.status + "Paused");
      return T("acct.status." + s.status);
    }
    var known = ["past_due", "unpaid", "paused", "incomplete"];
    return T(known.indexOf(s.status) >= 0 ? "acct.status." + s.status : "acct.status.other");
  }

  // The plan card when the subscription couldn't be read: what happened, a
  // Try again, and nothing that could be acted on wrongly (no buy buttons,
  // no promo box, no "free plan").
  function renderPlanFailed(err) {
    $("plan-status").textContent = T("acct.plan.loadFailed") + " " + T(failReason(err));
    show($("plan-buy"), false);
    show($("plan-promo-row"), false);
    show($("plan-trial-note"), false);
    show($("plan-manage"), false);
    show($("plan-retry-row"), true);
    $("plan-retry").disabled = false;
  }

  function renderPlan() {
    if (planFailed) return;
    var s = subscription || { status: "none" };
    var out = $("plan-message");
    var text = planText(s);
    show($("plan-retry-row"), false);
    var canBuy =
      ["none", "canceled", "incomplete_expired"].indexOf(s.status) >= 0 &&
      !!config.payments &&
      !switchedOff("checkout") &&
      !checkoutWait;
    if (checkoutWait && !isLive()) {
      status(out, checkoutWait === "slow" ? "error" : "info", T("acct.checkout." + checkoutWait));
    }
    $("plan-status").textContent = text;

    show($("plan-buy"), canBuy);
    // Promo codes give free days only on an account's first plan.
    var promo = canBuy && !!config.promo && !s.stripe_subscription_id;
    show($("plan-promo-row"), promo);
    show($("plan-trial-note"), promo);
    if (promo && params.get("promo") && !$("plan-promo").value) $("plan-promo").value = params.get("promo");
    show($("plan-manage"), !!s.stripe_customer_id);
    Array.prototype.forEach.call(document.querySelectorAll("[data-plan]"), function (b) {
      b.hidden = !config.plans || !config.plans[b.getAttribute("data-plan")];
    });
    var wanted = params.get("plan");
    if (canBuy && PLANS.indexOf(wanted) >= 0) {
      var btn = document.querySelector('[data-plan="' + wanted + '"]');
      if (btn) btn.classList.add("is-suggested");
    }
    if (business) renderBusinessCards();
  }

  // The subscription row (none yet = the free plan). A failed or hung read is
  // shown as such, never as the free plan. Never rejects.
  function loadSubscription() {
    return timedRead(client.from("subscriptions").select("*").maybeSingle()).then(
      function (data) {
        planFailed = false;
        subscription = data;
        renderPlan();
      },
      function (err) {
        planFailed = true;
        renderPlanFailed(err);
      },
    );
  }

  function slugify(text) {
    return String(text || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/g, "");
  }

  function fillBusinessForm() {
    var b = business || {};
    var suggested = (session.user.user_metadata && session.user.user_metadata.business_name) || "";
    $("biz-name").value = b.name || suggested;
    $("biz-slug").value = b.slug || slugify(suggested);
    $("biz-phone").value = b.phone || "";
    $("biz-email").value = b.email || session.user.email || "";
    $("biz-legal").value = b.legal_name || "";
    renderDesignerUrl();
  }

  // The owner's designer opens at designer.html?b=<slug> on this site, in the
  // page's language. The full address is shown under the field, following
  // what's typed, with Copy and Open once it's the saved one (an address that
  // isn't saved yet opens nothing, so the buttons wait for Save).
  function designerUrl(slug) {
    return sitePath("designer.html") + "?b=" + encodeURIComponent(slug);
  }

  function renderDesignerUrl() {
    var out = $("biz-url");
    if (!out) return;
    var typed = $("biz-slug").value.trim().toLowerCase();
    var saved = !!(business && business.slug && typed === business.slug);
    var url = typed ? designerUrl(typed) : "";
    out.textContent = url;
    show($("biz-url-row"), !!url);
    show($("biz-url-unsaved"), !!url && !saved);
    $("biz-url-copy").disabled = !saved;
    var open = $("biz-url-open");
    open.setAttribute("href", saved ? url : "#");
    open.setAttribute("aria-disabled", saved ? "false" : "true");
    open.tabIndex = saved ? 0 : -1;
  }

  function copyDesignerUrl() {
    var url = $("biz-url").textContent;
    var out = $("biz-url-status");
    var done = function () {
      status(out, "success", T("acct.url.copied"));
    };
    var failed = function () {
      // No clipboard (an insecure page, a browser that refused): the address
      // is right there and selected, so one key copies it.
      var range = document.createRange();
      range.selectNodeContents($("biz-url"));
      var selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
      status(out, "error", T("acct.url.copyFailed"));
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, failed);
    } else {
      failed();
    }
  }

  function priceInputs() {
    return Array.prototype.slice.call(document.querySelectorAll("[data-price-key]"));
  }

  function fillPrices() {
    var saved = (business && business.prices) || {};
    // The bathtub's default follows this business's own shower price.
    var effective = Object.assign({}, Pricing.DEFAULT_PRICES, saved, { Bathtub_Price: null });
    priceInputs().forEach(function (input) {
      var key = input.getAttribute("data-price-key");
      var fallback = key === "Bathtub_Price" ? Pricing.bathtubPrice(effective) : Pricing.DEFAULT_PRICES[key];
      input.placeholder = String(fallback);
      input.value = saved[key] !== undefined && saved[key] !== null ? saved[key] : "";
      input.removeAttribute("aria-invalid");
    });
    markPrices();
  }

  // Which prices are the owner's and which are the defaults, said on each
  // box (the small word under it) and in one line over the grid ("3 of 18
  // prices set"). Follows what's typed, so it reads right before Save too.
  function markPrices() {
    var inputs = priceInputs();
    var set = 0;
    inputs.forEach(function (input) {
      var own = input.value !== "";
      if (own) set++;
      var mark = $(input.id + "-mark");
      if (mark) mark.textContent = T(own ? "acct.prices.yours" : "acct.prices.default");
    });
    var summary = $("prices-summary");
    if (!summary) return;
    var total = inputs.length;
    summary.textContent =
      set === 0
        ? T("acct.prices.summaryNone", { total: total })
        : set === total
          ? T("acct.prices.summaryAll", { total: total })
          : T("acct.prices.summary", { set: set, total: total });
  }

  // The cards that need a business: its labor prices. (Old homeowner
  // requests show only when there are some to read; see loadLeads.)
  function renderBusinessCards() {
    show($("prices-card"), !!business);
  }

  // The business row (none yet = a new account, the form starts empty). The
  // form is shown only once the read has answered: a failed or hung read
  // shows what happened and a Try again, never an empty form whose Save
  // would look like a second business. Never rejects.
  function loadBusiness() {
    show($("business-form"), false);
    show($("business-failed"), false);
    show($("business-loading"), true);
    $("business-retry").disabled = true;
    return timedRead(client.from("businesses").select("*").maybeSingle()).then(
      function (data) {
        business = data;
        fillBusinessForm();
        fillPrices();
        renderBusinessCards();
        show($("business-loading"), false);
        show($("business-form"), true);
        if (business) loadLeads();
      },
      function (err) {
        business = null;
        renderBusinessCards();
        show($("business-loading"), false);
        $("business-failed-text").textContent = T("acct.biz.loadFailed") + " " + T(failReason(err));
        show($("business-failed"), true);
        $("business-retry").disabled = false;
      },
    );
  }

  // A Save button while its request is out: disabled and reading "Saving…",
  // so a second click can't send a second save. pending(button, false) puts
  // its own label back.
  function pending(button, on) {
    if (!button) return;
    if (on && !button.hasAttribute("data-label")) button.setAttribute("data-label", button.textContent);
    button.disabled = on;
    button.textContent = on ? T("proj.saving") : button.getAttribute("data-label") || button.textContent;
  }

  // What's wrong with one field, next to it (and the form's status line says
  // the save didn't happen). fieldError(input, "") clears it.
  function fieldError(input, text) {
    var out = $(input.id + "-error");
    if (text) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
    if (out) {
      out.textContent = text;
      out.hidden = !text;
    }
  }

  // The message for a Supabase (PostgREST) failure saving a row.
  function saveErrorText(error) {
    var why = error && error.code === "23505" ? "acct.slugTaken" : failReason(error);
    return T("acct.saveFailed") + " " + T(why);
  }

  function saveBusiness(e) {
    e.preventDefault();
    var out = $("business-status");
    var button = $("business-save");
    if (button.disabled) return;
    var name = $("biz-name").value.trim();
    var slug = $("biz-slug").value.trim().toLowerCase();
    fieldError($("biz-name"), "");
    fieldError($("biz-slug"), "");
    if (!name) {
      fieldError($("biz-name"), T("acct.nameRequired"));
      $("biz-name").focus();
      return status(out, "error", T("acct.saveFailed") + " " + T("acct.nameRequired"));
    }
    if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(slug) || slug === "demo") {
      fieldError($("biz-slug"), T("acct.slugInvalid"));
      $("biz-slug").focus();
      return status(out, "error", T("acct.saveFailed") + " " + T("acct.slugInvalid"));
    }
    pending(button, true);
    status(out, "info", T("proj.saving"));
    var row = {
      owner_id: session.user.id,
      name: name,
      slug: slug,
      phone: $("biz-phone").value.trim(),
      email: $("biz-email").value.trim(),
      legal_name: $("biz-legal").value.trim(),
      updated_at: new Date().toISOString(),
    };
    // One business per account (owner_id is unique). A known row is updated
    // by id; with none read, the save is an upsert on owner_id, so if a row
    // does exist after all it's updated, and a second one is never inserted.
    var query = business
      ? client.from("businesses").update(row).eq("id", business.id).select().single()
      : client.from("businesses").upsert(row, { onConflict: "owner_id" }).select().single();
    Promise.resolve(query)
      .then(
        function (r) {
          if (r.error) {
            if (r.error.code === "23505") {
              fieldError($("biz-slug"), T("acct.slugTaken"));
              $("biz-slug").focus();
            }
            return status(out, "error", saveErrorText(r.error));
          }
          business = r.data;
          status(out, "success", T("acct.saved"));
          renderDesignerUrl();
          fillPrices();
          renderBusinessCards();
          loadLeads();
        },
        function (err) {
          status(out, "error", saveErrorText(err));
        },
      )
      .then(function () {
        pending(button, false);
      });
  }

  function savePrices(e, reset) {
    if (e) e.preventDefault();
    var out = $("prices-status");
    if (!business) return status(out, "error", T("acct.saveBusinessFirst"));
    var prices = {};
    var bad = [];
    if (!reset) {
      priceInputs().forEach(function (input) {
        input.removeAttribute("aria-invalid");
        if (input.value === "") return;
        var n = Number(input.value);
        if (!isFinite(n) || n < 0 || n > 100000) bad.push(input);
        else prices[input.getAttribute("data-price-key")] = n;
      });
    }
    if (bad.length) {
      // Said at the field: marked, and the first one gets the focus.
      bad.forEach(function (input) {
        input.setAttribute("aria-invalid", "true");
      });
      bad[0].focus();
      return status(out, "error", T("acct.saveFailed") + " " + T("acct.priceInvalid"));
    }
    var buttons = [$("prices-save"), $("prices-reset")];
    if (buttons[0].disabled) return;
    pending(buttons[0], true);
    buttons[1].disabled = true;
    status(out, "info", T("proj.saving"));
    Promise.resolve(
      client
        .from("businesses")
        .update({ prices: prices, updated_at: new Date().toISOString() })
        .eq("id", business.id)
        .select()
        .single(),
    )
      .then(
        function (r) {
          if (r.error) return status(out, "error", saveErrorText(r.error));
          business = r.data;
          fillPrices();
          status(out, "success", T("acct.saved"));
        },
        function (err) {
          status(out, "error", saveErrorText(err));
        },
      )
      .then(function () {
        pending(buttons[0], false);
        buttons[1].disabled = false;
      });
  }

  function leadItem(lead) {
    var li = document.createElement("li");
    li.className = "lead-item";
    var head = document.createElement("p");
    head.className = "lead-head";
    var name = document.createElement("strong");
    name.textContent = lead.name || "—";
    head.appendChild(name);
    head.appendChild(document.createTextNode(" · " + formatDate(lead.created_at)));
    li.appendChild(head);

    var contact = document.createElement("p");
    if (lead.phone) {
      var tel = document.createElement("a");
      tel.href = "tel:" + lead.phone.replace(/[^0-9+]/g, "");
      tel.textContent = lead.phone;
      contact.appendChild(tel);
    }
    if (lead.email) {
      if (lead.phone) contact.appendChild(document.createTextNode(" · "));
      var mail = document.createElement("a");
      mail.href = "mailto:" + lead.email;
      mail.textContent = lead.email;
      contact.appendChild(mail);
    }
    li.appendChild(contact);

    var meta = [];
    if (lead.service) meta.push(T("acct.lead.work") + ": " + lead.service);
    if (lead.language) meta.push(T("acct.lead.language") + ": " + lead.language);
    if (meta.length) {
      var m = document.createElement("p");
      m.className = "form-note";
      m.textContent = meta.join(" · ");
      li.appendChild(m);
    }
    if (lead.message) {
      var msg = document.createElement("pre");
      msg.className = "lead-message";
      msg.textContent = lead.message;
      li.appendChild(msg);
    }
    var del = document.createElement("button");
    del.type = "button";
    del.className = "link-button";
    del.textContent = T("acct.lead.delete");
    del.setAttribute("aria-label", T("acct.lead.deleteNamed", { name: lead.name || "—" }));
    del.addEventListener("click", function () {
      askDeleteLead(lead, li, del);
    });
    li.appendChild(del);
    return li;
  }

  // "Delete" on a request asks first, in a dialog that names who it's from;
  // Cancel has the focus, and Escape, the X or a click outside close it.
  var deletingLead = null; // { lead, li, btn } while the dialog is up

  function askDeleteLead(lead, li, btn) {
    var dialog = $("lead-delete-dialog");
    deletingLead = { lead: lead, li: li, btn: btn };
    $("lead-delete-text").textContent = T("acct.lead.deleteConfirm", { name: lead.name || "—" });
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    $("lead-delete-cancel").focus();
  }

  function closeLeadDialog() {
    var dialog = $("lead-delete-dialog");
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else dialog.removeAttribute("open");
  }

  function confirmDeleteLead() {
    if (!deletingLead) return;
    var d = deletingLead;
    deletingLead = null;
    closeLeadDialog();
    var out = $("leads-status");
    d.btn.disabled = true;
    Promise.resolve(client.from("leads").delete().eq("id", d.lead.id)).then(
      function (r) {
        if (r.error) throw r.error;
        d.li.remove();
        status(out, "success", T("acct.lead.deleted"));
        var left = $("leads-list").children.length;
        show($("leads-card"), !!left);
        if (left) $("leads-card").querySelector("summary").focus();
      },
      function (err) {
        d.btn.disabled = false;
        d.btn.focus();
        status(out, "error", T("acct.lead.deleteFailed") + " " + T(failReason(err)));
      },
    );
  }

  function initLeadDialog() {
    var dialog = $("lead-delete-dialog");
    if (!dialog) return;
    $("lead-delete-cancel").addEventListener("click", closeLeadDialog);
    $("lead-delete-close").addEventListener("click", closeLeadDialog);
    $("lead-delete-confirm").addEventListener("click", confirmDeleteLead);
    // A click on the backdrop lands on the dialog itself, not its body.
    dialog.addEventListener("click", function (e) {
      if (e.target === dialog) closeLeadDialog();
    });
    dialog.addEventListener("close", function () {
      var was = deletingLead;
      deletingLead = null;
      if (was && was.btn && document.contains(was.btn)) was.btn.focus();
    });
  }

  // Requests homeowners sent before a business's designer became owner-only
  // (no new ones arrive): the card shows only while there are some to read.
  function loadLeads() {
    if (!business) return;
    client
      .from("leads")
      .select("*")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false })
      .limit(100)
      .then(function (r) {
        var list = $("leads-list");
        list.innerHTML = "";
        (r.data || []).forEach(function (lead) {
          list.appendChild(leadItem(lead));
        });
        show($("leads-card"), !!list.children.length);
      });
  }

  // The plan's project limits and what's used (api/projects.js); the full
  // list is on projects.html.
  // On failure the line says so (with why) instead of going blank; the list
  // page has its own Try again.
  function loadProjectsSummary() {
    var out = $("projects-summary");
    window.Net.fetchJson("/api/projects?counts=1", {
      headers: { Authorization: "Bearer " + session.access_token },
      cache: "no-store",
    })
      .then(function (data) {
        out.className = "";
        out.textContent =
          data.plan === "free"
            ? T("proj.summary.free")
            : T("proj.summary.paid", {
                plan: T("proj.plan." + data.plan),
                month: data.used.month,
                monthly: data.limits.monthly,
                total: data.used.total,
                limit: data.limits.total,
              });
      })
      .catch(function (err) {
        var why = err.code === "signin" ? "proj.err.signin" : errorKey(err);
        out.className = "form-note";
        out.textContent = T("acct.projects.failed") + " " + T(why);
      })
      .then(function () {
        show(out, true);
        show($("projects-card"), true);
      });
  }

  // Delete account: shown behind a button, confirmed by typing the sign-in
  // email, done by api/account.js.
  function initDelete() {
    var form = $("delete-form");
    var out = $("delete-status");
    $("delete-start").addEventListener("click", function () {
      show($("delete-start"), false);
      show(form, true);
      $("delete-confirm").focus();
    });
    function cancel() {
      show(form, false);
      show($("delete-start"), true);
      status(out, "info", "");
      $("delete-start").focus();
    }
    $("delete-cancel").addEventListener("click", cancel);
    // Escape closes the form, like a dialog, unless the deletion is under way.
    form.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" || $("delete-submit").disabled) return;
      e.preventDefault();
      cancel();
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var typed = $("delete-confirm").value.trim().toLowerCase();
      if (typed !== String(session.user.email || "").toLowerCase()) {
        return status(out, "error", T("acct.delete.mismatch"));
      }
      $("delete-submit").disabled = true;
      status(out, "info", T("acct.delete.working"));
      api("/api/account", { action: "delete", confirm: typed })
        .then(function () {
          // The sign-in is gone on the server; forget it here too.
          return client.auth.signOut({ scope: "local" }).catch(function () {});
        })
        .then(function () {
          window.location.href = sitePath("signup.html") + "?deleted=1";
        })
        .catch(function (err) {
          status(out, "error", T(err.code === "stripe" ? "acct.delete.stripe" : errorKey(err)));
          $("delete-submit").disabled = false;
        });
    });
  }

  function buy(plan, button) {
    var out = $("plan-message");
    if (!config.payments) return status(out, "error", T("acct.paymentsOff"));
    if (switchedOff("checkout")) return status(out, "error", T("acct.paused.checkout"));
    button.disabled = true;
    var promo = $("plan-promo-row").hidden ? "" : $("plan-promo").value.trim();
    api("/api/checkout", { plan: plan, promo: promo, lang: LANG === "en" ? "" : LANG })
      .then(function (data) {
        window.location.href = data.url;
      })
      .catch(function (err) {
        var key = errorKey(err);
        status(out, "error", T(key));
        if (key === "acct.promo.invalid" || key === "acct.promo.used") $("plan-promo").focus();
        button.disabled = false;
        // The server found a plan already running (a webhook still on its
        // way, or another tab): it recorded it, so show it instead of the buttons.
        if (err.code === "already-subscribed") loadSubscription();
        if (err.code === "paused") {
          config.switches = Object.assign({}, config.switches, { checkout: false });
          renderPlan();
        }
      });
  }

  function initAccount() {
    client.auth.onAuthStateChange(function (event) {
      if (event === "PASSWORD_RECOVERY") show($("password-card"), true);
    });

    $("password-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var pw = $("new-password").value;
      if (pw.length < 8) return status($("password-status"), "error", T("auth.passwordShort"));
      client.auth.updateUser({ password: pw }).then(function (r) {
        status(
          $("password-status"),
          r.error ? "error" : "success",
          r.error ? T("acct.error") : T("auth.passwordSaved"),
        );
      });
    });

    client.auth.getSession().then(function (r) {
      session = r.data && r.data.session;
      if (!session) {
        // Log in, then back here when the link carries a plan, a promo code
        // or a checkout result (those belong on this page). Otherwise the
        // nav's Log in brought them, and logging in lands on My projects.
        var backHere = params.get("plan") || params.get("promo") || params.get("checkout");
        window.location.href = loginPath(backHere ? herePath() : "");
        return;
      }
      show($("account-loading"), false);
      show($("account-app"), true);
      show($("sign-out"), true);
      $("account-email").textContent = T("auth.signedInAs", { email: session.user.email });
      show($("account-email"), true);

      var checkout = params.get("checkout");
      $("plan-status").textContent = T("proj.loading");
      if (checkout === "success") checkoutWait = "pending";
      if (checkout === "cancelled") status($("plan-message"), "info", T("acct.checkout.cancelled"));

      loadSubscription().then(function () {
        // The Stripe webhook can land a few seconds after the redirect back.
        // Until it does, the page says so and offers no buy buttons; if it
        // takes more than 30 s it still doesn't (api/checkout.js would
        // refuse a second plan anyway), and says what to do.
        if (checkout !== "success") return;
        if (isLive()) {
          checkoutWait = "";
          status($("plan-message"), "success", T("acct.checkout.success"));
          return;
        }
        var tries = 0;
        var timer = setInterval(function () {
          tries++;
          loadSubscription().then(function () {
            if (isLive()) {
              clearInterval(timer);
              checkoutWait = "";
              status($("plan-message"), "success", T("acct.checkout.success"));
              renderPlan();
            } else if (tries >= 10) {
              clearInterval(timer);
              checkoutWait = "slow";
              renderPlan();
            }
          });
        }, 3000);
      });
      loadBusiness();
      loadProjectsSummary();
    });

    $("sign-out").addEventListener("click", function () {
      client.auth.signOut().then(function () {
        window.location.href = sitePath("index.html");
      });
    });
    $("business-form").addEventListener("submit", saveBusiness);
    $("biz-name").addEventListener("input", function () {
      if (!business) $("biz-slug").value = slugify($("biz-name").value);
      renderDesignerUrl();
    });
    $("biz-slug").addEventListener("input", renderDesignerUrl);
    $("biz-url-copy").addEventListener("click", copyDesignerUrl);
    $("biz-url-open").addEventListener("click", function (e) {
      if (this.getAttribute("aria-disabled") === "true") e.preventDefault();
    });
    $("prices-form").addEventListener("submit", function (e) {
      savePrices(e, false);
    });
    priceInputs().forEach(function (input) {
      input.addEventListener("input", function () {
        input.removeAttribute("aria-invalid");
        markPrices();
      });
    });
    $("plan-retry").addEventListener("click", function () {
      $("plan-retry").disabled = true;
      $("plan-status").textContent = T("proj.loading");
      loadSubscription();
    });
    $("business-retry").addEventListener("click", function () {
      loadBusiness();
    });
    $("prices-reset").addEventListener("click", function () {
      savePrices(null, true);
    });
    initDelete();
    initLeadDialog();
    Array.prototype.forEach.call(document.querySelectorAll("[data-plan]"), function (b) {
      b.addEventListener("click", function () {
        buy(b.getAttribute("data-plan"), b);
      });
    });
    $("manage-billing").addEventListener("click", function () {
      var btn = $("manage-billing");
      btn.disabled = true;
      api("/api/portal", { lang: LANG === "en" ? "" : LANG })
        .then(function (data) {
          window.location.href = data.url;
        })
        .catch(function (err) {
          status($("plan-message"), "error", T(errorKey(err, "acct.stripe.portal")));
          btn.disabled = false;
        });
    });
  }

  // The nav's Log out link: sign out, then back to the home page.
  function logOut() {
    function clearLocal() {
      try {
        for (var i = localStorage.length - 1; i >= 0; i--) {
          var key = localStorage.key(i) || "";
          if (/^sb-.+-auth-token$/.test(key)) localStorage.removeItem(key);
        }
      } catch (e) {
        /* storage blocked: nothing stored to clear */
      }
    }
    var done = client ? client.auth.signOut().catch(function () {}) : Promise.resolve();
    done.then(function () {
      clearLocal();
      window.location.replace(sitePath("index.html"));
    });
  }

  loadConfig().then(function (c) {
    config = c;
    if (params.get("logout") === "1") {
      if (c.accounts && window.supabase) client = window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey);
      return logOut();
    }
    if (!c.accounts || !window.supabase) return accountsOff();
    showSiteNotice();
    client = window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey);
    if (page === "signup") initSignup();
    else initAccount();
  });
})();
