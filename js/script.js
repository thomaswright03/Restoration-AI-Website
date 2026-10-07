// Room Designer 3D — page behaviour: navigation, the FAQ, scroll reveal and
// the request form that sends a design to the business using the designer
// (js/business.js). The design studio itself is js/studio.js.
//
// Settings (price estimator on/off, lead-form endpoint, owner details) come
// from site-config.json via js/site-config.js — see README "Site settings".

document.addEventListener("DOMContentLoaded", function () {
  "use strict";

  var BIZ = window.DesignerBusiness || { name: "", initials: "", phone: "", email: "", slug: "demo" };
  var PHONE = BIZ.phone;
  var EMAIL = BIZ.email;
  var I18n = window.I18n;
  var T = I18n.t;
  var CONTACT = { phone: PHONE, email: EMAIL };
  var configReady = window.SiteConfig ? window.SiteConfig.ready : Promise.resolve(null);

  // ---------- page chrome ----------
  Array.prototype.forEach.call(document.querySelectorAll("[data-year]"), function (el) {
    el.textContent = String(new Date().getFullYear());
  });

  var toggle = document.querySelector(".nav-toggle");
  var links = document.querySelector(".nav-links");
  if (toggle && links) {
    var setMenu = function (open) {
      links.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    };
    toggle.addEventListener("click", function () {
      setMenu(!links.classList.contains("open"));
    });
    links.addEventListener("click", function (e) {
      if (e.target.closest("a")) setMenu(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && links.classList.contains("open")) {
        setMenu(false);
        toggle.focus();
      }
    });
  }

  // Language menu (a <details> in the nav): close it on a click elsewhere or
  // Escape. The chosen language is saved by the page's head script, from the
  // ?lang= its links carry.
  var langMenu = document.querySelector(".lang-menu");
  if (langMenu) {
    document.addEventListener("click", function (e) {
      if (langMenu.open && !langMenu.contains(e.target)) langMenu.open = false;
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && langMenu.open) {
        langMenu.open = false;
        langMenu.querySelector("summary").focus();
      }
    });
  }

  var header = document.querySelector(".site-header");
  if (header) {
    var onScroll = function () {
      header.classList.toggle("scrolled", window.scrollY > 40);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  // Scroll-reveal (skipped when the visitor prefers reduced motion).
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var revealTargets = document.querySelectorAll(
    ".card, .value-item, .faq-item, .about-photo, .about-copy, .contact-info-card, #lead-form, .scope-note",
  );
  if (!reduceMotion && "IntersectionObserver" in window) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -60px 0px" },
    );
    revealTargets.forEach(function (el) {
      el.classList.add("reveal");
      observer.observe(el);
    });
    // Never leave content invisible if the observer doesn't fire.
    setTimeout(function () {
      revealTargets.forEach(function (el) {
        el.classList.add("visible");
      });
    }, 1500);
  }

  // FAQ accordion
  Array.prototype.forEach.call(document.querySelectorAll(".faq-item"), function (item, index) {
    var question = item.querySelector(".faq-question");
    var answer = item.querySelector(".faq-answer");
    if (!question || !answer) return;
    answer.id = answer.id || "faq-answer-" + (index + 1);
    question.setAttribute("aria-controls", answer.id);
    question.setAttribute("aria-expanded", "false");
    question.addEventListener("click", function () {
      var isOpen = item.classList.toggle("open");
      question.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });
  });

  initLeadForm();

  // =====================================================================
  // Get a Quote form. With leadForm.endpoint set in site-config.json, the
  // request is sent there (Formspree-style: POST, JSON reply, 2xx = sent).
  // Without it, the visitor's own email app opens with the request filled in.
  // =====================================================================
  function initLeadForm() {
    var form = document.getElementById("lead-form");
    if (!form) return;
    var status = document.getElementById("form-status");
    var submit = document.getElementById("lead-submit");
    function value(id) {
      var el = document.getElementById(id);
      if (!el) return "";
      if (el.tagName === "SELECT") return el.options[el.selectedIndex].text;
      return el.value.trim();
    }

    function setError(id, text) {
      var input = document.getElementById(id);
      var err = document.getElementById(id + "-error");
      if (err) {
        err.textContent = text || "";
        err.hidden = !text;
      }
      if (input) input.setAttribute("aria-invalid", text ? "true" : "false");
    }

    function validate() {
      var errors = {};
      if (!value("name")) errors.name = T("form.error.name");
      var phone = value("phone");
      var digits = phone.replace(/\D/g, "");
      if (!phone) errors.phone = T("form.error.phone");
      else if (!/^[0-9+().\-\s]+$/.test(phone) || digits.length < 10 || digits.length > 15) {
        errors.phone = T("form.error.phoneInvalid");
      }
      var email = value("email");
      if (!email) errors.email = T("form.error.email");
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = T("form.error.emailInvalid");
      ["name", "phone", "email"].forEach(function (id) {
        setError(id, errors[id]);
      });
      return errors;
    }

    ["name", "phone", "email"].forEach(function (id) {
      var input = document.getElementById(id);
      if (input) {
        input.addEventListener("input", function () {
          setError(id, null);
        });
      }
    });

    function showStatus(kind, nodes) {
      status.className = "form-status is-" + kind;
      status.innerHTML = "";
      nodes.forEach(function (n) {
        status.appendChild(typeof n === "string" ? document.createTextNode(n) : n);
      });
      status.hidden = false;
      status.focus({ preventScroll: false });
    }

    function link(href, text) {
      var a = document.createElement("a");
      a.href = href;
      a.textContent = text;
      return a;
    }

    function strong(text) {
      var s = document.createElement("strong");
      s.textContent = text;
      return s;
    }

    // Status messages mix text and links: "[b:bold text]", "[again:link
    // text]" and "[phone]" in the translation become the matching node.
    function rich(key, nodes) {
      var out = [];
      T(key, CONTACT)
        .split(/(\[[a-z]+(?::[^\]]*)?\])/)
        .forEach(function (part) {
          var m = /^\[([a-z]+)(?::([^\]]*))?\]$/.exec(part);
          if (m && nodes[m[1]]) out.push(nodes[m[1]](m[2]));
          else if (part) out.push(part);
        });
      return out;
    }

    function subject() {
      return T("form.subject", { name: value("name") });
    }

    function body() {
      var lines = [
        T("form.body.name") + ": " + value("name"),
        T("form.body.phone") + ": " + value("phone"),
        T("form.body.email") + ": " + value("email"),
        T("form.body.service") + ": " + value("service"),
      ];
      if (I18n.lang() !== "en") lines.push(T("lang.label") + ": " + I18n.name());
      return lines.join("\n") + "\n\n" + T("form.body.details") + ":\n" + value("message");
    }

    var phoneLink = function () {
      return link("tel:" + PHONE.replace(/[^0-9+]/g, ""), PHONE);
    };
    var emailLink = function () {
      return link("mailto:" + EMAIL, EMAIL);
    };

    function sendByEmailApp() {
      var href =
        "mailto:" + EMAIL + "?subject=" + encodeURIComponent(subject()) + "&body=" + encodeURIComponent(body());
      showStatus(
        "info",
        rich("form.status.mailto", {
          b: strong,
          again: function (text) {
            var again = link(href, text);
            again.id = "mailto-link";
            return again;
          },
          email: emailLink,
          phone: phoneLink,
        }),
      );
      window.location.href = href;
    }

    var sending = false;

    function sendToEndpoint(endpoint) {
      if (sending) return;
      sending = true;
      var original = submit.innerHTML;
      submit.disabled = true;
      submit.setAttribute("aria-busy", "true");
      submit.textContent = T("form.sending");
      showStatus("info", [T("form.status.sending")]);

      var data = new URLSearchParams(new FormData(form));
      data.set("service", value("service"));
      data.set("business", BIZ.slug || "");
      data.set("_subject", subject());
      if (I18n.lang() !== "en") data.set("language", I18n.name());
      var controller = "AbortController" in window ? new AbortController() : null;
      var timer = setTimeout(function () {
        if (controller) controller.abort();
      }, 15000);

      var honeypot = document.getElementById("company-website");
      var request =
        honeypot && honeypot.value
          ? Promise.resolve({ ok: true })
          : fetch(endpoint, {
              method: "POST",
              body: data,
              headers: { Accept: "application/json" },
              signal: controller ? controller.signal : undefined,
            });

      request
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          form.reset();
          showStatus("success", rich("form.status.sent", { b: strong, phone: phoneLink }));
        })
        .catch(function () {
          showStatus("error", rich("form.status.failed", { b: strong, phone: phoneLink, email: emailLink }));
        })
        .then(function () {
          clearTimeout(timer);
          sending = false;
          submit.disabled = false;
          submit.removeAttribute("aria-busy");
          submit.innerHTML = original;
        });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (sending) return;
      var errors = validate();
      var first = ["name", "phone", "email"].filter(function (id) {
        return errors[id];
      })[0];
      if (first) {
        document.getElementById(first).focus();
        return;
      }
      configReady.then(function (config) {
        var endpoint = config && config.leadForm.endpoint;
        if (endpoint) sendToEndpoint(endpoint);
        else sendByEmailApp();
      });
    });
  }
});
