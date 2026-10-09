// Reads a .env file (the format of .env.example) into an env object, for the
// local server (scripts/serve.mjs). Vercel sets the same variables itself in
// production, so nothing here runs there.
//
//   KEY=value          one per line; blank lines and # comments are skipped
//   KEY="value"        single or double quotes are removed; "\n" in double
//                      quotes is a newline
//   KEY=value # note   a trailing comment after a space is dropped
//   export KEY=value   accepted
//
// A variable already set in the shell wins over the file, so a one-off
// `STRIPE_SECRET_KEY=... npm run serve` still works.

import { readFileSync } from "node:fs";

export function parseEnvFile(text) {
  const out = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2];
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.lastIndexOf(quote) > 0) {
      value = value.slice(1, value.lastIndexOf(quote));
      if (quote === '"') value = value.replace(/\\n/g, "\n");
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    out[m[1]] = value;
  }
  return out;
}

// Loads `path` into `env` (process.env by default) without overriding what's
// already set. Returns the names it set; a missing file sets nothing.
export function loadEnvFile(path, env = process.env) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") return [];
    throw e;
  }
  const loaded = [];
  for (const [key, value] of Object.entries(parseEnvFile(text))) {
    if (env[key] !== undefined) continue;
    env[key] = value;
    loaded.push(key);
  }
  return loaded;
}
