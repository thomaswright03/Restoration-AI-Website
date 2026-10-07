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
  var client = null;
  var config = null;

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

  function loadConfig() {
    return fetch("/api/config", { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .catch(function () {
        return { accounts: false, payments: false };
      });
  }

  function accountsOff() {
    show($("account-loading"), false);
    show($("accounts-off"), true);
  }

  // Supabase Auth error codes worth their own message.
  function signupErrorKey(error) {
    var code = error.code || "";
    if (code === "email_address_invalid") return "auth.emailRejected";
    if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit") return "auth.rateLimited";
    if (code === "weak_password") return "auth.passwordShort";
    if (code === "user_already_exists" || /already|registered/i.test(error.message || "")) return "auth.exists";
    return "acct.error";
  }

  // ===================================================================
  // Sign-up / log-in page
  // ===================================================================
  function initSignup() {
    var form = $("auth-form");
    var statusEl = $("auth-status");
    var submit = $("auth-submit");
    var mode = params.get("mode") === "login" ? "login" : "signup";

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

    function next() {
      var plan = params.get("plan");
      return sitePath("account.html") + (plan === "monthly" || plan === "yearly" ? "?plan=" + plan : "");
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = $("auth-email").value.trim();
      var password = $("auth-password").value;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return status(statusEl, "error", T("auth.emailInvalid"));
      if (mode !== "reset" && password.length < 8) return status(statusEl, "error", T("auth.passwordShort"));
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
          if (r.error) return status(statusEl, "error", T("auth.badLogin"));
          window.location.href = next();
        });
      } else {
        request = client.auth
          .signUp({
            email: email,
            password: password,
            options: {
              // lang picks the language of Supabase's emails (supabase/emails/).
              data: { business_name: $("auth-business").value.trim().slice(0, 120), lang: LANG },
              emailRedirectTo: next(),
            },
          })
          .then(function (r) {
            if (r.error) return status(statusEl, "error", T(signupErrorKey(r.error)));
            if (r.data && r.data.session) window.location.href = next();
            else status(statusEl, "success", T("auth.checkEmail"));
          });
      }
      request
        .catch(function () {
          status(statusEl, "error", T("acct.error"));
        })
        .then(function () {
          submit.disabled = false;
        });
    });

    client.auth.getSession().then(function (r) {
      if (r.data && r.data.session && mode !== "reset") window.location.href = next();
      else show($("auth-card"), true);
    });
  }

  // ===================================================================
  // Account page
  // ===================================================================
  var session = null;
  var business = null;
  var subscription = null;

  function api(path, body) {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
      body: JSON.stringify(body || {}),
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || "HTTP " + res.status);
          err.code = data.error;
          throw err;
        }
        return data;
      });
    });
  }

  function isLive() {
    return !!subscription && (subscription.status === "active" || subscription.status === "trialing");
  }

  function renderPlan() {
    var s = subscription || { status: "none" };
    var text;
    if (s.status === "trialing") text = T("acct.status.trialing", { date: formatDate(s.current_period_end) });
    else if (s.status === "active" && s.cancel_at_period_end) {
      text = T("acct.status.ending", { date: formatDate(s.current_period_end) });
    } else if (s.status === "active") text = T("acct.status.active", { date: formatDate(s.current_period_end) });
    else if (s.status === "past_due") text = T("acct.status.past_due");
    else if (s.status === "canceled") text = T("acct.status.canceled");
    else if (s.status === "none") text = T("acct.status.none");
    else text = T("acct.status.other", { status: s.status });
    $("plan-status").textContent = text;

    var canBuy = ["none", "canceled", "incomplete_expired"].indexOf(s.status) >= 0;
    show($("plan-buy"), canBuy);
    show($("plan-trial-note"), canBuy && config.trialDays > 0 && !s.stripe_subscription_id);
    show($("plan-manage"), !!s.stripe_customer_id);
    Array.prototype.forEach.call(document.querySelectorAll("[data-plan]"), function (b) {
      b.hidden = !config.plans || !config.plans[b.getAttribute("data-plan")];
    });
    var wanted = params.get("plan");
    if (canBuy && (wanted === "monthly" || wanted === "yearly")) {
      var btn = document.querySelector('[data-plan="' + wanted + '"]');
      if (btn) btn.classList.add("is-suggested");
    }
    show($("share-inactive"), !isLive());
  }

  function loadSubscription() {
    return client
      .from("subscriptions")
      .select("*")
      .maybeSingle()
      .then(function (r) {
        subscription = r.data || null;
        renderPlan();
      });
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
  }

  function fillPrices() {
    var saved = (business && business.prices) || {};
    Array.prototype.forEach.call(document.querySelectorAll("[data-price-key]"), function (input) {
      var key = input.getAttribute("data-price-key");
      input.placeholder = String(Pricing.DEFAULT_PRICES[key]);
      input.value = saved[key] !== undefined ? saved[key] : "";
    });
  }

  function renderShare() {
    var on = !!business;
    show($("prices-card"), on);
    show($("share-card"), on);
    show($("leads-card"), on);
    if (!on) return;
    var dir = $("share-lang").value;
    var url = window.location.origin + "/" + dir + "designer.html?b=" + business.slug;
    $("share-link").href = url;
    $("share-link").textContent = url;
    $("embed-code").value =
      '<iframe src="' +
      url +
      '&embed=1" title="' +
      T("acct.iframeTitle") +
      '" style="width:100%;height:900px;border:0" loading="lazy" allow="fullscreen"></iframe>';
  }

  function loadBusiness() {
    return client
      .from("businesses")
      .select("*")
      .maybeSingle()
      .then(function (r) {
        business = r.data || null;
        fillBusinessForm();
        fillPrices();
        renderShare();
        if (business) loadLeads();
      });
  }

  function saveBusiness(e) {
    e.preventDefault();
    var out = $("business-status");
    var name = $("biz-name").value.trim();
    var slug = $("biz-slug").value.trim().toLowerCase();
    if (!name) return status(out, "error", T("acct.nameRequired"));
    if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(slug) || slug === "demo") {
      return status(out, "error", T("acct.slugInvalid"));
    }
    var row = {
      owner_id: session.user.id,
      name: name,
      slug: slug,
      phone: $("biz-phone").value.trim(),
      email: $("biz-email").value.trim(),
      legal_name: $("biz-legal").value.trim(),
      updated_at: new Date().toISOString(),
    };
    var query = business
      ? client.from("businesses").update(row).eq("id", business.id).select().single()
      : client.from("businesses").insert(row).select().single();
    query.then(function (r) {
      if (r.error) {
        return status(out, "error", r.error.code === "23505" ? T("acct.slugTaken") : T("acct.error"));
      }
      business = r.data;
      status(out, "success", T("acct.saved"));
      fillPrices();
      renderShare();
      loadLeads();
    });
  }

  function savePrices(e, reset) {
    if (e) e.preventDefault();
    var out = $("prices-status");
    if (!business) return status(out, "error", T("acct.saveBusinessFirst"));
    var prices = {};
    var bad = false;
    if (!reset) {
      Array.prototype.forEach.call(document.querySelectorAll("[data-price-key]"), function (input) {
        if (input.value === "") return;
        var n = Number(input.value);
        if (!isFinite(n) || n < 0 || n > 100000) bad = true;
        else prices[input.getAttribute("data-price-key")] = n;
      });
    }
    if (bad) return status(out, "error", T("acct.priceInvalid"));
    client
      .from("businesses")
      .update({ prices: prices, updated_at: new Date().toISOString() })
      .eq("id", business.id)
      .select()
      .single()
      .then(function (r) {
        if (r.error) return status(out, "error", T("acct.error"));
        business = r.data;
        fillPrices();
        status(out, "success", T("acct.saved"));
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
    del.addEventListener("click", function () {
      if (!window.confirm(T("acct.lead.deleteConfirm"))) return;
      client
        .from("leads")
        .delete()
        .eq("id", lead.id)
        .then(function (r) {
          if (!r.error) li.remove();
          show($("leads-empty"), !$("leads-list").children.length);
        });
    });
    li.appendChild(del);
    return li;
  }

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
        show($("leads-empty"), !list.children.length);
      });
  }

  function buy(plan, button) {
    var out = $("plan-message");
    if (!config.payments) return status(out, "error", T("acct.paymentsOff"));
    button.disabled = true;
    api("/api/checkout", { plan: plan, lang: LANG === "en" ? "" : LANG })
      .then(function (data) {
        window.location.href = data.url;
      })
      .catch(function () {
        status(out, "error", T("acct.error"));
        button.disabled = false;
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
        window.location.href = sitePath("signup.html") + "?mode=login";
        return;
      }
      show($("account-loading"), false);
      show($("account-app"), true);
      show($("sign-out"), true);
      $("account-email").textContent = T("auth.signedInAs", { email: session.user.email });
      show($("account-email"), true);

      var checkout = params.get("checkout");
      if (checkout === "success") status($("plan-message"), "success", T("acct.checkout.success"));
      if (checkout === "cancelled") status($("plan-message"), "info", T("acct.checkout.cancelled"));

      loadSubscription().then(function () {
        // The Stripe webhook can land a few seconds after the redirect back.
        if (checkout !== "success" || isLive()) return;
        var tries = 0;
        var timer = setInterval(function () {
          tries++;
          loadSubscription().then(function () {
            if (isLive() || tries >= 10) clearInterval(timer);
          });
        }, 3000);
      });
      loadBusiness();
    });

    $("sign-out").addEventListener("click", function () {
      client.auth.signOut().then(function () {
        window.location.href = sitePath("index.html");
      });
    });
    $("business-form").addEventListener("submit", saveBusiness);
    $("biz-name").addEventListener("input", function () {
      if (!business) $("biz-slug").value = slugify($("biz-name").value);
    });
    $("prices-form").addEventListener("submit", function (e) {
      savePrices(e, false);
    });
    $("prices-reset").addEventListener("click", function () {
      savePrices(null, true);
    });
    $("share-lang").addEventListener("change", renderShare);
    $("copy-embed").addEventListener("click", function () {
      var code = $("embed-code");
      code.select();
      var done = function () {
        status($("copy-status"), "success", T("acct.copied"));
      };
      if (navigator.clipboard) navigator.clipboard.writeText(code.value).then(done, done);
      else {
        document.execCommand("copy");
        done();
      }
    });
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
        .catch(function () {
          status($("plan-message"), "error", T("acct.error"));
          btn.disabled = false;
        });
    });
  }

  loadConfig().then(function (c) {
    config = c;
    if (!c.accounts || !window.supabase) return accountsOff();
    client = window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey);
    if (page === "signup") initSignup();
    else initAccount();
  });
})();
