"use strict";

// Riley's automatic voice pick (js/riley.js). The voices come from the
// person's device, so these are the shapes browsers really hand out.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadRiley() {
  const window = {
    I18n: { t: (k) => k, locale: () => "pt-BR" },
    speechSynthesis: null,
    localStorage: null,
  };
  window.window = window;
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "js", "riley.js"), "utf8");
  vm.runInNewContext(src, { window, document: { addEventListener() {} }, setTimeout, clearTimeout });
  return window.Riley;
}

const v = (name, lang, localService = true) => ({ name, lang, localService });

test("Portuguese: a Brazilian voice beats a European one, whatever their names", () => {
  const Riley = loadRiley();
  const voices = [v("Joana", "pt-PT"), v("Catarina", "pt-PT"), v("Google português do Brasil", "pt-BR", false)];
  assert.equal(Riley.autoVoiceFor(voices, "pt").name, "Google português do Brasil");
  // Chrome on Android writes the tag with an underscore.
  assert.equal(Riley.autoVoiceFor([v("Joana", "pt-PT"), v("Francisca", "pt_BR")], "pt").name, "Francisca");
});

test("Portuguese: with only pt-PT voices she still speaks, preferring a name she knows", () => {
  const Riley = loadRiley();
  assert.equal(Riley.autoVoiceFor([v("Duarte", "pt-PT"), v("Joana", "pt-PT")], "pt").name, "Joana");
});

test("English keeps its own preferences and a local voice over a remote one", () => {
  const Riley = loadRiley();
  assert.equal(Riley.autoVoiceFor([v("Daniel", "en-GB"), v("Samantha", "en-US")], "en").name, "Samantha");
  assert.equal(Riley.autoVoiceFor([v("Remote", "en-US", false), v("Local", "en-US")], "en").name, "Local");
  assert.equal(Riley.autoVoiceFor([], "en"), null);
});
