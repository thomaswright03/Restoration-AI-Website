"use strict";

// scripts/serve.mjs reads .env.local (the format of .env.example) so a
// developer can run the functions against their own keys, as .env.example
// says; the shell wins over the file; the browser tests pass ENV_FILE= so a
// developer's keys never leak into them; and the file itself is never served.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");

async function envFile() {
  return import("../../scripts/env-file.mjs");
}

function tmpFile(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd3d-env-"));
  const file = path.join(dir, ".env.local");
  fs.writeFileSync(file, text);
  return file;
}

test("env file: the .env.example format, quotes, comments and export are read", async () => {
  const { parseEnvFile } = await envFile();
  const parsed = parseEnvFile(`# Copy to .env.local
SUPABASE_URL=https://abc.supabase.co
SUPABASE_ANON_KEY =  anon.key.here   # the public one
STRIPE_SECRET_KEY='sk_test_quoted'
PROMO_CODES="FREEWEEK,LAUNCH30:30"
MULTI="line one\\nline two"
export SITE_URL=https://example.com
TRIAL_DAYS=
HASH=abc#notacomment
not a line
=novalue
`);
  assert.deepEqual(parsed, {
    SUPABASE_URL: "https://abc.supabase.co",
    SUPABASE_ANON_KEY: "anon.key.here",
    STRIPE_SECRET_KEY: "sk_test_quoted",
    PROMO_CODES: "FREEWEEK,LAUNCH30:30",
    MULTI: "line one\nline two",
    SITE_URL: "https://example.com",
    TRIAL_DAYS: "",
    HASH: "abc#notacomment",
  });
  // .env.example itself parses to exactly the variables the functions read.
  const example = parseEnvFile(fs.readFileSync(path.join(ROOT, ".env.example"), "utf8"));
  assert.deepEqual(Object.keys(example).sort(), [
    "PROMO_CODES",
    "SITE_URL",
    "STRIPE_API_VERSION",
    "STRIPE_PRICE_MAX",
    "STRIPE_PRICE_PRO",
    "STRIPE_PRICE_STARTER",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_URL",
    "TRIAL_DAYS",
  ]);
});

test("env file: the shell wins over the file, and a missing file sets nothing", async () => {
  const { loadEnvFile } = await envFile();
  const file = tmpFile("SUPABASE_URL=https://file.example\nSTRIPE_SECRET_KEY=sk_from_file\n");
  const env = { SUPABASE_URL: "https://shell.example" };
  assert.deepEqual(loadEnvFile(file, env), ["STRIPE_SECRET_KEY"]);
  assert.deepEqual(env, { SUPABASE_URL: "https://shell.example", STRIPE_SECRET_KEY: "sk_from_file" });
  const none = {};
  assert.deepEqual(loadEnvFile(path.join(path.dirname(file), "missing.env"), none), []);
  assert.deepEqual(none, {});
});

// Starts scripts/serve.mjs on a free port; resolves with the port and the
// first lines it printed.
function startServer(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, "scripts", "serve.mjs"), "0"], {
      cwd: os.tmpdir(),
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.stdout.on("data", (d) => {
      out += d;
      const m = /http:\/\/localhost:(\d+)/.exec(out);
      if (m && /\n$/.test(out)) resolve({ child, port: Number(m[1]), out });
    });
    child.on("exit", (code) => reject(new Error("serve.mjs exited " + code + ": " + err)));
    setTimeout(() => reject(new Error("serve.mjs didn't start: " + out + err)), 10000).unref();
  });
}

test("serve: loads ENV_FILE (by default .env.local) for the functions, never serves it, and ENV_FILE= reads none", async () => {
  const file = tmpFile(
    "# local keys\nSUPABASE_URL=https://file.example\nSTRIPE_SECRET_KEY=sk_test_file\nSITE_URL=https://shell.example\n",
  );
  const withFile = await startServer({ ENV_FILE: file, SITE_URL: "https://set-in-shell.example" });
  try {
    // The shell's SITE_URL is kept, the other two come from the file.
    assert.match(withFile.out, /Loaded 2 settings from .*\.env\.local: SUPABASE_URL, STRIPE_SECRET_KEY\n/);
    const base = "http://localhost:" + withFile.port;
    const page = await fetch(base + "/index.html");
    assert.equal(page.status, 200);
    // Dotfiles and sources are 404.html, like any missing path.
    for (const p of ["/.env.local", "/.env.example", "/.gitignore", "/scripts/serve.mjs", "/supabase/schema.sql"]) {
      const res = await fetch(base + p);
      assert.equal(res.status, 404, p);
      assert.match(res.headers.get("content-type"), /text\/html/, p);
    }
  } finally {
    withFile.child.kill();
  }

  const noFile = await startServer({ ENV_FILE: "" });
  try {
    assert.doesNotMatch(noFile.out, /Loaded/);
    assert.equal((await fetch("http://localhost:" + noFile.port + "/index.html")).status, 200);
  } finally {
    noFile.child.kill();
  }
});

test("serve: the browser tests start the server with ENV_FILE= so a developer's .env.local stays out of them", () => {
  const config = fs.readFileSync(path.join(ROOT, "playwright.config.js"), "utf8");
  assert.match(config, /env:\s*\{\s*ENV_FILE:\s*""\s*\}/);
});
