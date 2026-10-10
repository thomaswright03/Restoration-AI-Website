// Room Designer 3D — Light / Dark / System colour theme switch.
//
// The choice is saved in this browser (localStorage "pr_theme"). "System"
// (the default) follows the device's setting. A tiny inline script in each
// page's <head> applies a saved choice before the page is first painted, so
// there is no flash of the wrong theme; this file wires up the buttons (the
// theme menu in the header and the switch in the footer, both
// [data-theme-choice]) and keeps <meta name="theme-color"> in step.

(function () {
  "use strict";

  var KEY = "pr_theme";

  function saved() {
    try {
      var t = localStorage.getItem(KEY);
      return t === "light" || t === "dark" ? t : "system";
    } catch (e) {
      return "system";
    }
  }

  // The browser's own chrome (the address bar on phones) takes the colour
  // of the page's top edge, which is the header: --color-dark, which the
  // theme sets. Read after the theme is applied, so it follows a switch and
  // the device's setting under System.
  function paintThemeColor() {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta || !window.getComputedStyle) return;
    var color = getComputedStyle(document.documentElement).getPropertyValue("--color-dark").trim();
    if (color) meta.setAttribute("content", color);
  }

  function apply(choice) {
    if (choice === "light" || choice === "dark") {
      document.documentElement.setAttribute("data-theme", choice);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    // Every control for the theme (the header menu and the footer switch) shows the choice.
    Array.prototype.forEach.call(document.querySelectorAll("[data-theme-choice]"), function (btn) {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-theme-choice") === choice ? "true" : "false");
    });
    paintThemeColor();
  }

  function choose(choice) {
    try {
      if (choice === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, choice);
    } catch (e) {
      /* storage blocked: the choice still applies to this page view */
    }
    apply(choice);
  }

  function init() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-theme-choice]"), function (btn) {
      btn.addEventListener("click", function () {
        choose(btn.getAttribute("data-theme-choice"));
      });
    });
    apply(saved());
    // A switch made in another page of this site (another tab, or the
    // project page around an embedded designer) restyles this one too.
    window.addEventListener("storage", function (e) {
      if (e.key === KEY || e.key === null) apply(saved());
    });
    // Under System, the device switching between light and dark re-colours
    // the page; the browser chrome follows.
    if (window.matchMedia) {
      var dark = window.matchMedia("(prefers-color-scheme: dark)");
      var onChange = function () {
        paintThemeColor();
      };
      if (dark.addEventListener) dark.addEventListener("change", onChange);
      else if (dark.addListener) dark.addListener(onChange);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
