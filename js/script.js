// Room Designer 3D — page behaviour: navigation (the menu button, the
// language and theme menus), the offline notice, the FAQ and scroll reveal.
// The design studio itself is js/studio.js.

// Errors the page hits (an uncaught exception, a script that didn't load)
// are reported to /api/log, so the owner can see browser-side failures in
// the function log (js/net.js Net.reportErrors). Installed as soon as this
// file runs, before the page's own scripts start.
if (window.Net && typeof window.Net.reportErrors === "function") window.Net.reportErrors();

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

  // The nav's menus (a <details> each: the language menu and the theme
  // menu): close on a click elsewhere, on Escape (the focus goes back to the
  // button), and the theme menu once a theme is picked. The chosen language
  // is saved by the page's head script, from the ?lang= its links carry; the
  // theme buttons are js/theme.js's.
  Array.prototype.forEach.call(document.querySelectorAll(".nav-menu"), function (menu) {
    document.addEventListener("click", function (e) {
      if (menu.open && !menu.contains(e.target)) menu.open = false;
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && menu.open) {
        menu.open = false;
        menu.querySelector("summary").focus();
      }
    });
    menu.addEventListener("click", function (e) {
      if (e.target.closest("[data-theme-choice]")) {
        menu.open = false;
        menu.querySelector("summary").focus();
      }
    });
  });

  // Offline: a notice at the foot of the page the moment the browser loses
  // its connection, before anything fails, and a short "back online" when it
  // returns. Pages that save (My projects, the designer's save bar) still say
  // what happened to each action; this is the heads-up.
  // It can be closed (the X, Enter or Space on it, or Escape while it has
  // the focus). On the designer it sits in the page above the studio rather
  // than floating over it, so it never covers Riley's card or a control on a
  // phone.
  var I18n = window.I18n;
  if (I18n && document.body) {
    var notice = document.createElement("div");
    notice.className = "offline-notice";
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");
    notice.hidden = true;
    var noticeText = document.createElement("span");
    noticeText.className = "offline-notice-text";
    var noticeClose = document.createElement("button");
    noticeClose.type = "button";
    noticeClose.className = "offline-notice-close";
    noticeClose.setAttribute("aria-label", I18n.t("net.offlineDismiss"));
    noticeClose.textContent = "×";
    notice.appendChild(noticeText);
    notice.appendChild(noticeClose);
    var studioMain = document.querySelector("main.studio-page");
    if (studioMain) {
      notice.classList.add("is-inline");
      studioMain.insertBefore(notice, studioMain.firstChild);
    } else {
      document.body.appendChild(notice);
    }
    var backTimer = null;
    var wasOffline = false;
    var dismiss = function () {
      notice.hidden = true;
      // Focus was on the X: it goes back to the page rather than nowhere.
      if (document.activeElement === noticeClose) noticeClose.blur();
    };
    noticeClose.addEventListener("click", dismiss);
    notice.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      dismiss();
    });
    var setOffline = function (off) {
      clearTimeout(backTimer);
      if (off) {
        wasOffline = true;
        noticeText.textContent = I18n.t("net.offlineNotice");
        notice.classList.remove("is-back");
        notice.hidden = false;
        return;
      }
      if (!wasOffline) return;
      wasOffline = false;
      noticeText.textContent = I18n.t("net.backOnline");
      notice.classList.add("is-back");
      notice.hidden = false;
      backTimer = setTimeout(function () {
        notice.hidden = true;
      }, 4000);
    };
    window.addEventListener("offline", function () {
      setOffline(true);
    });
    window.addEventListener("online", function () {
      setOffline(false);
    });
    if (navigator.onLine === false) setOffline(true);
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
  var revealTargets = document.querySelectorAll(".card, .faq-item, .scope-note");
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
