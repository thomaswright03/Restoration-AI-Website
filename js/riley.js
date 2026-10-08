// Room Designer 3D — Riley, the guide who talks the homeowner through it.
//
// Riley says what's happening in the design as it happens: what each step
// is for, what she just did, and — when something doesn't fit — what she
// can do about it, with a button that does it. js/studio.js decides what
// she says (it knows the design); this file is her voice and her bubble.
//
// She speaks out loud with the browser's own speech (no network, no key),
// in the page's language, and can be muted. Browsers don't let a page make
// noise before the person has touched it, so her first line waits for the
// first click, tap or key press and then catches up.
(function () {
  "use strict";

  var I18n = window.I18n;
  var T = I18n ? I18n.t : null;
  var MUTE_KEY = "rd3d_riley_muted";
  // Voices that sound like a person called Riley, best first. Browsers
  // name voices differently, so this is a preference, not a requirement.
  var PREFERRED = {
    en: ["samantha", "ava", "allison", "serena", "karen", "moira", "tessa", "fiona", "victoria", "zira", "female"],
    es: ["monica", "mónica", "paulina", "marisol", "esperanza", "helena", "female"],
    pt: ["luciana", "joana", "catarina", "fernanda", "female"],
  };
  var LANG_TAGS = { en: "en-US", es: "es-US", pt: "pt-BR" };

  var speech = window.speechSynthesis || null;
  var muted = false;
  var waiting = null; // a line held back until the person touches the page
  var unlocked = false;
  var voice = null;
  var held = null; // a line waiting for the browser's voices to load
  var heldTimer = null;
  var els = {};
  var onAction = null;
  var lastText = "";

  function lang() {
    return (I18n && I18n.locale ? String(I18n.locale()).slice(0, 2) : "en") || "en";
  }

  function readMuted() {
    try {
      return localStorage.getItem(MUTE_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function writeMuted(on) {
    try {
      localStorage.setItem(MUTE_KEY, on ? "1" : "0");
    } catch (e) {
      /* storage blocked: she stays muted for this visit only */
    }
  }

  // The nicest voice for the page's language, once the browser has them.
  function pickVoice() {
    if (!speech || !speech.getVoices) return null;
    var all = speech.getVoices() || [];
    if (!all.length) return null;
    var want = lang();
    var mine = all.filter(function (v) {
      return (
        String(v.lang || "")
          .toLowerCase()
          .indexOf(want) === 0
      );
    });
    if (!mine.length) return null;
    var names = PREFERRED[want] || [];
    for (var i = 0; i < names.length; i++) {
      var hit = mine.filter(function (v) {
        return (
          String(v.name || "")
            .toLowerCase()
            .indexOf(names[i]) !== -1
        );
      })[0];
      if (hit) return hit;
    }
    // Failing a name we know, a local voice sounds better than a remote one.
    return (
      mine.filter(function (v) {
        return v.localService;
      })[0] || mine[0]
    );
  }

  function speaksLang(v, want) {
    return (
      !!v &&
      String(v.lang || "")
        .toLowerCase()
        .indexOf(want) === 0
    );
  }

  // Some browsers (Chrome) load their voices a moment after the page asks,
  // and with no voice set they read any language in their default (English)
  // accent. So a line spoken before the voices arrive waits for them briefly.
  function holdForVoices(text) {
    held = text;
    if (heldTimer) return;
    heldTimer = setTimeout(function () {
      heldTimer = null;
      var text = held;
      held = null;
      if (text) speak(text, true);
    }, 1500);
  }

  function releaseHeld() {
    if (heldTimer) clearTimeout(heldTimer);
    heldTimer = null;
    var text = held;
    held = null;
    if (text) speak(text);
  }

  function speak(text, noWait) {
    if (!speech || muted || !text) return;
    if (!unlocked) {
      waiting = text;
      return;
    }
    try {
      // The voice always follows the page's current language, never one
      // remembered from an earlier line.
      var want = lang();
      if (!speaksLang(voice, want)) voice = pickVoice();
      if (!voice && !noWait && speech.getVoices && !(speech.getVoices() || []).length) {
        holdForVoices(text);
        return;
      }
      speech.cancel();
      var line = new SpeechSynthesisUtterance(text);
      if (voice) line.voice = voice;
      line.lang = (voice && voice.lang) || LANG_TAGS[want] || "en-US";
      line.rate = 1.02;
      line.pitch = 1.05;
      speech.speak(line);
    } catch (e) {
      /* no speech on this browser: her words are on screen anyway */
    }
  }

  function stop() {
    held = null;
    try {
      if (speech) speech.cancel();
    } catch (e) {
      /* nothing to stop */
    }
  }

  // The first click, tap or key press lets the page make noise.
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    voice = pickVoice();
    if (waiting) {
      var text = waiting;
      waiting = null;
      speak(text);
    }
  }

  function el(tag, attrs, kids) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "text") node.textContent = v;
      else if (k === "html") node.innerHTML = v;
      else if (k.slice(0, 2) === "on") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) {
      if (c) node.appendChild(c);
    });
    return node;
  }

  var AVATAR =
    '<svg viewBox="0 0 40 40" width="36" height="36" aria-hidden="true" focusable="false">' +
    '<circle cx="20" cy="20" r="19" fill="currentColor" opacity="0.14"/>' +
    '<circle cx="20" cy="15.5" r="6" fill="currentColor"/>' +
    '<path d="M8.5 33a11.5 11.5 0 0 1 23 0z" fill="currentColor"/></svg>';

  var MUTE_ON =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/>' +
    '<path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
  var MUTE_OFF =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/>' +
    '<path d="M16 9.5l5 5m0-5l-5 5"/></svg>';

  function renderMute() {
    if (!els.mute) return;
    els.mute.innerHTML = muted ? MUTE_OFF : MUTE_ON;
    els.mute.setAttribute("aria-pressed", muted ? "false" : "true");
    var label = T ? T(muted ? "riley.unmute" : "riley.mute") : "Riley's voice";
    els.mute.setAttribute("aria-label", label);
    els.mute.setAttribute("title", label);
  }

  var Riley = {
    // Builds her bubble inside `mount`. onAction(id) runs when the person
    // takes one of the choices she offers.
    init: function (mount, handler) {
      if (!mount || els.root) return;
      onAction = handler || null;
      muted = readMuted();
      els.text = el("p", { class: "riley-text" });
      els.actions = el("div", { class: "riley-actions" });
      els.mute = el("button", { type: "button", class: "riley-mute", onclick: Riley.toggleMute });
      els.root = el("div", { class: "riley", hidden: true }, [
        el("span", { class: "riley-avatar", html: AVATAR, "aria-hidden": "true" }),
        el("div", { class: "riley-body" }, [
          el("p", { class: "riley-name", text: T ? T("riley.name") : "Riley" }),
          els.text,
          els.actions,
        ]),
        els.mute,
      ]);
      els.root.setAttribute("role", "status");
      els.root.setAttribute("aria-live", "polite");
      mount.appendChild(els.root);
      renderMute();
      ["pointerdown", "keydown", "touchstart"].forEach(function (name) {
        document.addEventListener(name, unlock, { once: true, passive: true });
      });
      if (speech && typeof speech.addEventListener === "function") {
        speech.addEventListener("voiceschanged", function () {
          voice = pickVoice();
          releaseHeld();
        });
        // Asking once now gets Chrome loading its voices before she speaks.
        pickVoice();
      }
    },

    // { text, actions: [{ id, label }], tone: "ok" | "warn" | "error" }.
    // The same line twice in a row isn't repeated.
    say: function (line) {
      if (!els.root || !line || !line.text) return;
      var again = line.text === lastText;
      lastText = line.text;
      els.text.textContent = line.text;
      els.root.setAttribute("data-tone", line.tone || "ok");
      els.root.hidden = false;
      while (els.actions.firstChild) els.actions.removeChild(els.actions.firstChild);
      (line.actions || []).forEach(function (a) {
        els.actions.appendChild(
          el("button", {
            type: "button",
            class: "riley-action",
            text: a.label,
            onclick: function () {
              if (onAction) onAction(a.id);
            },
          }),
        );
      });
      if (!again) speak(line.text);
    },

    // Says it again out loud (the button on her bubble).
    repeat: function () {
      if (lastText) speak(lastText);
    },

    toggleMute: function () {
      muted = !muted;
      writeMuted(muted);
      if (muted) stop();
      renderMute();
      if (!muted) {
        unlock();
        speak(lastText);
      }
    },

    muted: function () {
      return muted;
    },

    // Whether this browser can speak at all.
    canSpeak: function () {
      return !!speech;
    },

    stop: stop,
  };

  window.Riley = Riley;
})();
