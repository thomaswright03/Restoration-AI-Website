// Minimal local server that behaves like Vercel for this site: serves files
// from the repo root, runs api/<name>.js for /api/<name> (the same handler
// Vercel runs), and answers any missing path with 404.html and a 404 status.
//
//   node scripts/serve.mjs [port]      (default 8000, or PORT)
//
// The functions read their keys from the environment: your shell's, plus
// .env.local in the repo root when it exists (copy .env.example; a variable
// set in the shell wins). ENV_FILE=path reads another file; ENV_FILE= (empty)
// reads none, which is how the browser tests keep real keys out of their run.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { loadEnvFile } from "./env-file.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.argv[2] || process.env.PORT || 8000);

const envFile = process.env.ENV_FILE === undefined ? ".env.local" : process.env.ENV_FILE;
const loaded = envFile ? loadEnvFile(resolve(root, envFile)) : [];

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".glb": "model/gltf-binary",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

async function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const full = normalize(join(root, decoded));
  if (full !== root && !full.startsWith(root + sep)) return null;
  try {
    const info = await stat(full);
    if (info.isDirectory()) {
      const index = join(full, "index.html");
      await stat(index);
      return index;
    }
    return full;
  } catch {
    return null;
  }
}

const require = createRequire(import.meta.url);

// Vercel-style helpers: req.query, and api/_*.js are never routes.
async function runApi(req, res, name) {
  const url = new URL(req.url, "http://localhost");
  req.query = Object.fromEntries(url.searchParams);
  try {
    const handler = require(join(root, "api", name + ".js"));
    await handler(req, res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    res.end('{"error":"server"}');
  }
}

const server = createServer(async (req, res) => {
  const api = /^\/api\/([a-z][a-z0-9-]*)(?:\?|$)/.exec(req.url || "");
  if (api) {
    let exists = false;
    try {
      await stat(join(root, "api", api[1] + ".js"));
      exists = true;
    } catch {
      exists = false;
    }
    if (exists) return runApi(req, res, api[1]);
  }
  const file = await resolveFile(req.url || "/");
  const rel = file
    ? file
        .slice(root.length + 1)
        .split(sep)
        .join("/")
    : "";
  // Never the sources Vercel doesn't deploy (.vercelignore), nor a dotfile
  // such as .env.local.
  const blocked =
    file &&
    (/^(node_modules|tests|test-results|playwright-report|blob-report|api|supabase|pages|scripts|types|tools)\//.test(
      rel,
    ) ||
      /(^|\/)\./.test(rel));
  if (!file || blocked) {
    const body = await readFile(join(root, "404.html"));
    res.writeHead(404, { "Content-Type": TYPES[".html"] });
    res.end(body);
    return;
  }
  const body = await readFile(file);
  res.writeHead(200, {
    "Content-Type": TYPES[extname(file)] || "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  res.end(body);
});

server.listen(port, () => {
  if (loaded.length) console.log(`Loaded ${loaded.length} settings from ${envFile}: ${loaded.join(", ")}`);
  console.log(`Serving ${root} at http://localhost:${server.address().port}`);
});
