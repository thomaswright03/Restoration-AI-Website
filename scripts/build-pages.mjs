// Builds every page in English, Spanish and Brazilian Portuguese from ONE
// template each, so the three languages can't drift apart:
//
//   pages/layout.html          the shared <head>, header and footer
//   pages/<page>.html          each page's <main> content
//   pages/strings/<file>.json  every text, as  "key": ["English", "Español", "Português"]
//
// In templates, {{key}} is replaced by that text (it may contain simple
// inline HTML such as <strong> or <a>), and {{@name}} by a built-in value:
//   @root      path back to the site root ("", "../", or "/" on 404.html)
//   @lang      en | es | pt          @htmlLang  en | es | pt-BR
//   @dir       "" | "es/" | "pt/"    @page      the page's file name
//   @priceStarter, @pricePro, @priceMax, @priceWebsite, @promoDays (free days a promo code
//   gives), and each
//   plan's limits (@starterMonthly, @starterTotal, @proMonthly, ...)
//                                    from site-config.json "plans"
// Text values may use the same {{@name}} values.
//
// The built pages are committed (Vercel serves them as plain files).
//   node scripts/build-pages.mjs           rebuild
//   node scripts/build-pages.mjs --check   exit 1 if a built page is stale or a text is missing (CI)

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import * as prettier from "prettier";

const root = fileURLToPath(new URL("..", import.meta.url));

export const SITE_URL = "https://restoration-ai-website-nu.vercel.app";

export const LANGS = [
  { code: "en", dir: "", htmlLang: "en", locale: "en-US", index: 0 },
  { code: "es", dir: "es/", htmlLang: "es", locale: "es-US", index: 1 },
  { code: "pt", dir: "pt/", htmlLang: "pt-BR", locale: "pt-BR", index: 2 },
];

// file: template in pages/; strings: which strings files it uses (common is always included).
// designer: loads the 3D designer's scripts and styles.
// noindex: kept out of search results and the sitemap (signed-in pages, 404).
export const PAGES = [
  { file: "index.html", strings: ["index"] },
  { file: "designer.html", strings: ["designer"], designer: true },
  { file: "signup.html", strings: ["account", "index"], app: "signup" },
  { file: "account.html", noindex: true, strings: ["account", "index"], app: "account" },
  { file: "projects.html", noindex: true, strings: ["projects", "account", "index"], app: "projects" },
  { file: "project.html", noindex: true, strings: ["projects", "account", "index"], app: "project" },
  { file: "privacy.html", strings: ["legal"] },
  { file: "terms.html", strings: ["legal"] },
  { file: "404.html", strings: ["notfound"], absolute: true, noindex: true },
];

async function loadStrings(name) {
  return JSON.parse(await readFile(join(root, "pages/strings", name + ".json"), "utf8"));
}

function money(amount, locale) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function count(n, locale) {
  return new Intl.NumberFormat(locale).format(Number(n) || 0);
}

// Prices and project limits for each plan, as the pricing section shows them.
function planBuiltins(plans, locale) {
  const out = { priceWebsite: money(Number(plans.websiteAddOn) || 0, locale) };
  for (const name of ["starter", "pro", "max"]) {
    const p = plans[name] || {};
    const cap = name[0].toUpperCase() + name.slice(1);
    out["price" + cap] = money(Number(p.price) || 0, locale);
    out[name + "Monthly"] = count(p.newPerMonth, locale);
    out[name + "Total"] = count(p.maxProjects, locale);
  }
  return out;
}

export async function buildAll() {
  const config = JSON.parse(await readFile(join(root, "site-config.json"), "utf8"));
  const plans = config.plans || {};
  const layout = await readFile(join(root, "pages/layout.html"), "utf8");
  const common = await loadStrings("common");
  const problems = [];
  const out = new Map();

  for (const page of PAGES) {
    const body = await readFile(join(root, "pages", page.file), "utf8");
    const strings = Object.assign({}, common);
    for (const name of page.strings) Object.assign(strings, await loadStrings(name));

    for (const [key, value] of Object.entries(strings)) {
      if (!Array.isArray(value) || value.length !== 3 || value.some((v) => typeof v !== "string" || !v.trim())) {
        problems.push(`${key}: needs English, Spanish and Portuguese text`);
      }
    }

    for (const lang of LANGS) {
      const builtins = {
        root: page.absolute ? "/" : lang.dir ? "../" : "",
        lang: lang.code,
        htmlLang: lang.htmlLang,
        dir: lang.dir,
        page: page.file,
        siteUrl: SITE_URL,
        ...planBuiltins(plans, lang.locale),
        promoDays: String(Number(plans.promoFreeDays) || 7),
        designerHead: page.designer ? "designer" : "",
        appScript: page.app || "",
        seoHead: page.noindex
          ? '<meta name="robots" content="noindex" />'
          : `<link rel="canonical" href="${SITE_URL}/${lang.dir}${page.file}" />`,
      };
      const fill = (text, depth = 0) =>
        text.replace(/\{\{(@?)([A-Za-z0-9_.-]+)\}\}/g, (match, at, key) => {
          if (at) {
            if (!(key in builtins)) problems.push(`${page.file}: unknown {{@${key}}}`);
            return builtins[key] ?? "";
          }
          const value = strings[key];
          if (!value) {
            problems.push(`${page.file}: missing text "${key}"`);
            return match;
          }
          return depth > 3 ? value[lang.index] : fill(value[lang.index], depth + 1);
        });

      // Each page's <title> and description: "<name>.title" / "<name>.description".
      const name = page.file === "404.html" ? "notfound" : page.file.replace(/\.html$/, "");
      let html = layout
        .replace("<!-- page:main -->", body)
        .replace(/\{\{page\.(title|description)\}\}/g, `{{${name}.$1}}`);
      html = html.replace(/<!-- if:designer -->([\s\S]*?)<!-- \/if:designer -->/g, page.designer ? "$1" : "");
      html = html.replace(/<!-- if:app -->([\s\S]*?)<!-- \/if:app -->/g, page.app ? "$1" : "");
      html = html.replace(/<!-- if:plain -->([\s\S]*?)<!-- \/if:plain -->/g, page.app || page.designer ? "" : "$1");
      html = fill(html);
      // Language switcher: mark the current language.
      html = html.replace(new RegExp(`(data-lang-choice="${lang.code}")`), '$1 aria-current="true"');
      const pretty = await prettier.format(html, { parser: "html", printWidth: 120 });
      out.set(lang.dir + page.file, pretty);
    }
  }
  out.set("robots.txt", `User-agent: *\nDisallow: /api/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  out.set("sitemap.xml", sitemap());
  return { out, problems };
}

// Every page search engines should list, with its other languages.
function sitemap() {
  const urls = PAGES.filter((p) => !p.noindex).map((page) => {
    const links = LANGS.map(
      (l) => `    <xhtml:link rel="alternate" hreflang="${l.htmlLang}" href="${SITE_URL}/${l.dir}${page.file}"/>`,
    ).join("\n");
    return LANGS.map((l) => `  <url>\n    <loc>${SITE_URL}/${l.dir}${page.file}</loc>\n${links}\n  </url>`).join("\n");
  });
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
    urls.join("\n") +
    "\n</urlset>\n"
  );
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const check = process.argv.includes("--check");
  const { out, problems } = await buildAll();
  const unique = [...new Set(problems)];
  if (unique.length) {
    console.error(unique.join("\n"));
    process.exit(1);
  }
  let stale = 0;
  for (const [file, html] of out) {
    const path = join(root, file);
    let current = "";
    try {
      current = await readFile(path, "utf8");
    } catch {
      current = "";
    }
    if (current === html) continue;
    if (check) {
      console.error(`${file} is out of date: run npm run pages`);
      stale++;
    } else {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, html);
      console.log(`wrote ${file}`);
    }
  }
  if (stale) process.exit(1);
  if (check) console.log(`All ${out.size} pages are up to date.`);
}
