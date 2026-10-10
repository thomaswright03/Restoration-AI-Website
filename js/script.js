// Room Designer 3D — page behaviour: navigation, the FAQ and scroll reveal.
// The design studio itself is js/studio.js.

document.addEventListener("DOMContentLoaded", function () {
  "use strict";

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

  // Signed in (Supabase keeps the sign-in in localStorage as
  // sb-<project>-auth-token): the nav's Log in becomes Log out, which the
  // account page carries out (js/account.js, ?logout=1).
  var authLink = document.querySelector("[data-auth-link]");
  if (authLink) {
    var signedIn = false;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        if (/^sb-.+-auth-token$/.test(localStorage.key(i) || "")) signedIn = true;
      }
    } catch (e) {
      /* storage blocked: treat as signed out */
    }
    if (signedIn) {
      authLink.textContent = authLink.getAttribute("data-logout-label");
      authLink.setAttribute("href", authLink.getAttribute("href").replace(/account\.html.*$/, "account.html?logout=1"));
    }
    // A signed-in business gets My projects and Account where visitors see
    // Pricing and Get started.
    Array.prototype.forEach.call(document.querySelectorAll("[data-nav-signed-in]"), function (li) {
      li.hidden = !signedIn;
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-nav-signed-out]"), function (li) {
      li.hidden = signedIn;
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
  var revealTargets = document.querySelectorAll(".card, .value-item, .faq-item, .scope-note");
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
});
