// Room Designer 3D — which business this designer is for.
//
// The designer page is shared by every subscriber. Its address says whose it
// is: designer.html?b=<business-slug>. This script sets window.DesignerBusiness
// (name, initials, phone, email, labor prices) before the
// studio's scripts load, so they speak for that business.
//
//   - No ?b= (or ?b=demo): the built-in sample business, for the public demo.
//   - ?b=<slug>: /api/business?b=<slug>&t=<sign-in token> is loaded as a
//     script without holding the page (the designer shows its loading state
//     meanwhile; DesignerBusiness.ready resolves when the answer is in, and
//     the studio starts then). A business's designer opens only for its own
//     signed-in owner: the script calls DesignerBusiness.load({...}) with the
//     business's profile for them (with preview: true while the plan isn't
//     active), or DesignerBusiness.load(null, reason) for anyone else, and
//     the studio is replaced by a short notice. If the answer doesn't come
//     within LOAD_LIMIT_MS (a hung database), the notice says so and offers
//     Try again.
//
// Must load after js/bathroom-pricing.js (so a business's own labor prices can
// replace the defaults) and before js/script.js and js/studio.js.

(function () {
  "use strict";

  var DEMO = {
    slug: "demo",
    name: "Sample Remodeling Co.",
    initials: "SR",
    phone: "(555) 010-0199",
    email: "hello@example.com",
    legalName: "",
    serviceName: "Room Designer 3D",
    demo: true,
    ownPrices: false,
    // The owner's prices that are set, by DEFAULT_PRICES key ({} = none).
    priceSet: {},
    unavailable: "",
  };

  // How long the profile may take before the page says it couldn't load it
  // (the server gives up on a hung database after 8 s).
  var LOAD_LIMIT_MS = 10000;

  var biz = Object.assign({}, DEMO);
  window.DesignerBusiness = biz;
  // Resolves (always) once the profile is in, or has failed; the demo
  // business is ready at once.
  var readyResolve = null;
  biz.ready = new Promise(function (resolve) {
    readyResolve = resolve;
  });
  function settle() {
    if (readyResolve) readyResolve(biz);
    readyResolve = null;
    fill();
  }

  function clean(value, max) {
    return typeof value === "string" ? value.trim().slice(0, max || 120) : "";
  }

  function initialsOf(name) {
    var words = name.split(/\s+/).filter(Boolean);
    var letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] || "?").slice(0, 2);
    return letters.toUpperCase();
  }

  // Only known price keys with sensible numbers replace the defaults.
  // Returns the keys that did, as { key: true }: until the owner sets a
  // price, the estimate runs on the platform's sample rates and says so, and
  // with some set it says which lines are still at sample rates
  // (js/studio.js).
  function applyPrices(prices) {
    var Pricing = window.BathroomPricing;
    var set = {};
    if (!Pricing || !prices || typeof prices !== "object") return set;
    Object.keys(Pricing.DEFAULT_PRICES).forEach(function (key) {
      var n = Number(prices[key]);
      if (
        prices[key] !== undefined &&
        prices[key] !== null &&
        prices[key] !== "" &&
        isFinite(n) &&
        n >= 0 &&
        n <= 100000
      ) {
        Pricing.DEFAULT_PRICES[key] = n;
        set[key] = true;
      }
    });
    return set;
  }

  biz.load = function (data, reason) {
    if (!data) {
      biz.unavailable = reason || "unavailable";
      settle();
      return;
    }
    var name = clean(data.name) || DEMO.name;
    biz.slug = clean(data.slug, 64) || biz.slug;
    biz.name = name;
    biz.initials = clean(data.initials, 3) || initialsOf(name);
    biz.phone = clean(data.phone, 40);
    biz.email = clean(data.email, 120);
    biz.legalName = clean(data.legalName);
    biz.demo = false;
    biz.unavailable = "";
    // The owner looking at their own designer before their plan is active.
    biz.preview = data.preview === true;
    biz.priceSet = applyPrices(data.prices);
    biz.ownPrices = Object.keys(biz.priceSet).length > 0;
    settle();
  };

  // The signed-in user's Supabase access token, if any (it's kept in
  // localStorage as sb-<project>-auth-token). Sent along so the business's
  // owner, and only they, can open its designer.
  function signInToken() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i) || "";
        if (!/^sb-.+-auth-token$/.test(key)) continue;
        var s = JSON.parse(localStorage.getItem(key));
        if (s && s.access_token && (!s.expires_at || s.expires_at * 1000 > Date.now())) return s.access_token;
      }
    } catch (e) {
      /* storage blocked: no preview */
    }
    return "";
  }

  // Slugs are lowercase; a link typed with capitals still finds the business.
  // One that can't be a slug at all is a broken link, not the demo.
  var match = /[?&]b=([^&#]*)/.exec(window.location.search);
  var slug = "";
  try {
    slug = match ? decodeURIComponent(match[1].replace(/\+/g, " ")).trim().toLowerCase() : "";
  } catch (e) {
    slug = "%";
  }
  if (slug && slug !== "demo" && !/^[a-z0-9-]{1,64}$/.test(slug)) {
    biz.slug = "";
    biz.demo = false;
    biz.unavailable = "not-found";
  } else if (slug && slug !== "demo") {
    biz.slug = slug;
    biz.demo = false;
    // Assume unavailable until the profile script says otherwise (it may 404
    // or be blocked), so a broken link never shows the sample business.
    biz.unavailable = "loading";
    profileScript(signInToken());
  } else {
    settle();
  }

  // Loads the business's profile as a script (its answer calls biz.load).
  // It doesn't hold the page: the designer paints its loading state at once,
  // and if the answer hasn't come in LOAD_LIMIT_MS, or the request fails,
  // the page says so ("error"/"timeout") with Try again.
  function profileScript(token) {
    var el = document.createElement("script");
    el.src = "/api/business?b=" + encodeURIComponent(biz.slug) + (token ? "&t=" + encodeURIComponent(token) : "");
    el.async = true;
    var timer = setTimeout(function () {
      if (biz.unavailable === "loading") biz.load(null, "timeout");
    }, LOAD_LIMIT_MS);
    var done = function () {
      clearTimeout(timer);
    };
    el.onload = function () {
      done();
      // A script that ran without calling load() (an unexpected answer).
      if (biz.unavailable === "loading") biz.load(null, "error");
    };
    el.onerror = function () {
      done();
      if (biz.unavailable === "loading") biz.load(null, "error");
    };
    (document.head || document.documentElement).appendChild(el);
  }

  function fill() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-biz]"), function (el) {
      el.textContent = biz[el.getAttribute("data-biz")] || "";
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-biz-tel]"), function (el) {
      el.setAttribute("href", "tel:" + (biz.phone || "").replace(/[^0-9+]/g, ""));
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-biz-if]"), function (el) {
      el.hidden = !biz[el.getAttribute("data-biz-if")];
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-biz-demo]"), function (el) {
      el.hidden = !biz.demo;
    });
    // A business's own designer (its owner's, or their project page's viewer).
    Array.prototype.forEach.call(document.querySelectorAll("[data-biz-owner]"), function (el) {
      el.hidden = !!biz.demo;
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-biz-preview]"), function (el) {
      el.hidden = !biz.preview;
    });
    // Still loading: the designer keeps showing its loading state.
    if (biz.unavailable && biz.unavailable !== "loading") {
      Array.prototype.forEach.call(document.querySelectorAll("[data-biz-live]"), function (el) {
        el.hidden = true;
      });
      // A hung or failed lookup is a different message from "not yours":
      // the designer may well be theirs, so it offers Try again.
      var failed = biz.unavailable === "error" || biz.unavailable === "timeout";
      var notice = document.getElementById(failed ? "designer-failed" : "designer-unavailable");
      if (!notice) notice = document.getElementById("designer-unavailable");
      if (notice) notice.hidden = false;
      var retry = document.getElementById("designer-failed-retry");
      if (retry && !retry.hasAttribute("data-wired")) {
        retry.setAttribute("data-wired", "1");
        retry.addEventListener("click", function () {
          window.location.reload();
        });
      }
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fill);
  else fill();
})();
