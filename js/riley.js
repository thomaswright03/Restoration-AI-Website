// Room Designer 3D — Riley, the guide who talks the homeowner through it.
//
// Riley says what's happening in the design as it happens: what each step
// is for, what she just did, and — when something doesn't fit — what she
// can do about it, with a button that does it. js/studio.js decides what
// she says (it knows the design); this file is her voice and her bubble.
//
// She speaks out loud with the browser's own speech (no network, no key),
// in the page's language, and can be muted. The voices come from the
// person's own device and browser, so they differ from one to the next; her
// voice list (the wave button) plays each one and remembers the pick. Browsers don't let a page make
// noise before the person has touched it, so her first line waits for the
// first click, tap or key press and then catches up.
(function () {
  "use strict";

  var I18n = window.I18n;
  var T = I18n ? I18n.t : null;
  var MUTE_KEY = "rd3d_riley_muted";
  // The voice picked in her voice list, one per language ("" = automatic).
  var VOICE_KEY = "rd3d_riley_voice_";
  // Voices that sound like a person called Riley, best first. Browsers
  // name voices differently, so this is a preference, not a requirement.
  var PREFERRED = {
    en: ["samantha", "ava", "allison", "serena", "karen", "moira", "tessa", "fiona", "victoria", "zira", "female"],
    es: ["monica", "mónica", "paulina", "marisol", "esperanza", "helena", "female"],
    // Brazilian voices first (Luciana and Francisca are pt-BR on Apple and
    // Windows); Joana and Catarina speak European Portuguese.
    pt: ["luciana", "francisca", "brasil", "brazil", "fernanda", "joana", "catarina", "female"],
  };
  // The regional accent she speaks each language in: her lines are written
  // in Brazilian Portuguese and Latin American Spanish, so a voice from that
  // region (pt-BR before pt-PT, es-US/es-MX before es-ES) comes first.
  var LANG_TAGS = { en: "en-US", es: "es-US", pt: "pt-BR" };
  var REGIONS = { en: ["en-us"], es: ["es-us", "es-mx", "es-419"], pt: ["pt-br"] };

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
  var defaultVoice = {}; // site-config.json riley.voice: { en, es, pt } voice names

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

  function readVoice() {
    try {
      return localStorage.getItem(VOICE_KEY + lang()) || "";
    } catch (e) {
      return "";
    }
  }

  function writeVoice(name) {
    try {
      if (name) localStorage.setItem(VOICE_KEY + lang(), name);
      else localStorage.removeItem(VOICE_KEY + lang());
    } catch (e) {
      /* storage blocked: the pick lasts for this visit only */
    }
  }

  var chosen = null; // the name picked this visit (null: read it from storage)

  function chosenName() {
    return chosen === null ? readVoice() : chosen;
  }

  // The voices this browser has for the page's language. They come from
  // the person's own device and browser, so the list differs between them.
  function voicesHere() {
    if (!speech || !speech.getVoices) return [];
    var want = lang();
    return (speech.getVoices() || []).filter(function (v) {
      return (
        String(v.lang || "")
          .toLowerCase()
          .indexOf(want) === 0
      );
    });
  }

  function byName(list, name) {
    return list.filter(function (v) {
      return v.name === name;
    })[0];
  }

  // The voice she uses: the one picked in her voice list, else the site's
  // default (site-config.json), else the nicest one for the language.
  function pickVoice() {
    var mine = voicesHere();
    if (!mine.length) return null;
    var picked = byName(mine, chosenName());
    if (picked) return picked;
    return autoVoice(mine);
  }

  // Voices from the region her lines are written for (REGIONS) come before
  // the language's other accents, so a Brazilian voice reads her Portuguese
  // whenever the device has one.
  function byRegion(list, want) {
    var regions = REGIONS[want] || [];
    var regional = list.filter(function (v) {
      var tag = String(v.lang || "")
        .toLowerCase()
        .replace("_", "-");
      return regions.indexOf(tag) !== -1;
    });
    return regional.concat(
      list.filter(function (v) {
        return regional.indexOf(v) === -1;
      }),
    );
  }

  function autoVoice(mine, want) {
    want = want || lang();
    var ordered = byRegion(mine, want);
    var names = (defaultVoice[want] ? [String(defaultVoice[want]).toLowerCase()] : []).concat(PREFERRED[want] || []);
    for (var i = 0; i < names.length; i++) {
      var hit = ordered.filter(function (v) {
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
      ordered.filter(function (v) {
        return v.localService;
      })[0] || ordered[0]
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

  // withVoice: a sample in that voice from her voice list (plays even muted).
  function speak(text, noWait, withVoice) {
    if (!speech || !text) return;
    if (!withVoice && muted) return;
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
      var use = withVoice || voice;
      if (use) line.voice = use;
      line.lang = (use && use.lang) || LANG_TAGS[want] || "en-US";
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

  var VOICE_ICON =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/></svg>';

  // Her voice list: every voice this browser has for the page's language,
  // each with a button that plays a sample line, and the one in use marked.
  function renderVoices() {
    if (!els.voices || els.voices.hidden) return;
    var list = els.voiceList;
    while (list.firstChild) list.removeChild(list.firstChild);
    var mine = voicesHere();
    var current = chosenName();
    if (current && !byName(mine, current)) current = "";
    els.voiceEmpty.hidden = mine.length > 0;
    if (!mine.length) return;
    var auto = autoVoice(mine);
    var rows = [{ name: "", label: T ? T("riley.voiceAuto", { name: auto ? auto.name : "" }) : "Automatic", v: auto }];
    mine.forEach(function (v) {
      rows.push({ name: v.name, label: v.name, v: v, note: v.lang });
    });
    rows.forEach(function (r) {
      var on = r.name === current;
      list.appendChild(
        el("li", { class: "riley-voice" + (on ? " is-on" : "") }, [
          el(
            "button",
            {
              type: "button",
              class: "riley-voice-pick",
              "aria-pressed": on ? "true" : "false",
              onclick: function () {
                Riley.useVoice(r.name);
                speak(T ? T("riley.sample") : "Hi, I'm Riley.", true, r.v);
              },
            },
            [
              el("span", { class: "riley-voice-name", text: r.label }),
              r.note ? el("span", { class: "riley-voice-note", text: r.note }) : null,
            ],
          ),
          el("button", {
            type: "button",
            class: "riley-voice-play",
            text: T ? T("riley.play") : "Play",
            "aria-label": T ? T("riley.playVoice", { name: r.label }) : "Play " + r.label,
            onclick: function () {
              speak(T ? T("riley.sample") : "Hi, I'm Riley.", true, r.v);
            },
          }),
        ]),
      );
    });
  }

  function renderMute() {
    if (!els.mute) return;
    els.mute.innerHTML = muted ? MUTE_OFF : MUTE_ON;
    // A toggle: the name stays put and aria-pressed says whether her voice
    // is on, so a screen reader never hears "Mute Riley, pressed" while
    // she's talking. The tooltip says what a click will do.
    els.mute.setAttribute("aria-pressed", muted ? "false" : "true");
    els.mute.setAttribute("aria-label", T ? T("riley.voiceOn") : "Riley's voice");
    els.mute.setAttribute("title", T ? T(muted ? "riley.unmute" : "riley.mute") : "Riley's voice");
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
      var voiceLabel = T ? T("riley.voices") : "Choose Riley's voice";
      els.voiceBtn = el("button", {
        type: "button",
        class: "riley-tool riley-voice-btn",
        html: VOICE_ICON,
        "aria-label": voiceLabel,
        title: voiceLabel,
        "aria-expanded": "false",
        onclick: function () {
          Riley.showVoices(els.voices.hidden);
        },
      });
      els.voiceList = el("ul", { class: "riley-voice-list" });
      els.voiceEmpty = el("p", { class: "riley-voice-note", hidden: true, text: T ? T("riley.voicesNone") : "" });
      els.voices = el("div", { class: "riley-voices", hidden: true }, [
        el("p", { class: "riley-name riley-voices-title", text: voiceLabel }),
        el("p", { class: "riley-voice-help", text: T ? T("riley.voicesHelp") : "" }),
        els.voiceEmpty,
        els.voiceList,
        el("button", {
          type: "button",
          class: "riley-action",
          text: T ? T("riley.voicesDone") : "Done",
          onclick: function () {
            Riley.showVoices(false);
          },
        }),
      ]);
      els.root = el("div", { class: "riley", hidden: true }, [
        el("span", { class: "riley-avatar", html: AVATAR, "aria-hidden": "true" }),
        el("div", { class: "riley-body" }, [
          el("p", { class: "riley-name", text: T ? T("riley.name") : "Riley" }),
          els.text,
          els.actions,
          els.voices,
        ]),
        el("div", { class: "riley-tools" }, [els.mute, els.voiceBtn]),
      ]);
      // Escape closes her voice list and puts focus back on its button.
      els.root.addEventListener("keydown", function (e) {
        if (e.key !== "Escape" || els.voices.hidden) return;
        e.preventDefault();
        e.stopPropagation();
        Riley.showVoices(false);
        els.voiceBtn.focus();
      });
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
          renderVoices();
        });
        // Asking once now gets Chrome loading its voices before she speaks.
        pickVoice();
      }
      if (!speech) els.voiceBtn.hidden = true;
      if (window.SiteConfig && window.SiteConfig.ready) {
        window.SiteConfig.ready.then(function (config) {
          defaultVoice = (config && config.riley && config.riley.voice) || {};
          voice = pickVoice();
          renderVoices();
        });
      }
      // designer.html?voices opens her voice list straight away.
      if (/[?&]voices\b/.test(location.search)) {
        Riley.showVoices(true);
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

    // Opens or closes her voice list.
    showVoices: function (open) {
      if (!els.voices) return;
      els.voices.hidden = !open;
      els.voiceBtn.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) els.root.hidden = false;
      renderVoices();
    },

    // Uses the voice with this name from now on, in this language on this
    // browser ("" goes back to automatic).
    useVoice: function (name) {
      chosen = name || "";
      writeVoice(chosen);
      voice = pickVoice();
      renderVoices();
    },

    muted: function () {
      return muted;
    },

    // Whether this browser can speak at all.
    canSpeak: function () {
      return !!speech;
    },

    stop: stop,

    // The voice she would pick by herself from these voices for a language
    // ("en", "es", "pt"); for the tests, since the voices come from the device.
    autoVoiceFor: function (voices, want) {
      return voices && voices.length ? autoVoice(voices, want) : null;
    },
  };

  window.Riley = Riley;
})();
