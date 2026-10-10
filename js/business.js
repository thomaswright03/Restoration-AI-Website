// Room Designer 3D — which business this designer is for.
//
// The designer page is shared by every subscriber. Its address says whose it
// is: designer.html?b=<business-slug>. This script sets window.DesignerBusiness
// (name, initials, phone, email, labor prices) before the
// studio's scripts load, so they speak for that business.
//
//   - No ?b= (or ?b=demo): the built-in sample business, for the public demo.
//   - ?b=<slug>: /api/business?b=<slug>&t=<sign-in token> is loaded as a
//     script right here, so it runs before the next <script> on the page. A
//     business's designer opens only for its own signed-in owner: it calls
//     DesignerBusiness.load({...}) with the business's profile for them (with
//     preview: true while the plan isn't active), or
//     DesignerBusiness.load(null, reason) for anyone else, and the studio is
//     replaced by a short notice.
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

  var biz = Object.assign({}, DEMO);
  window.DesignerBusiness = biz;

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
  }

  // Loads the business's profile as a script, so it runs before the next
  // <script> on the page (also when called from inside that script).
  function profileScript(token) {
    document.write(
      '<script src="/api/business?b=' +
        encodeURIComponent(biz.slug) +
        (token ? "&t=" + encodeURIComponent(token) : "") +
        '"></' +
        "script>",
    );
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
    if (biz.unavailable) {
      Array.prototype.forEach.call(document.querySelectorAll("[data-biz-live]"), function (el) {
        el.hidden = true;
      });
      var notice = document.getElementById("designer-unavailable");
      if (notice) notice.hidden = false;
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fill);
  else fill();
})();
