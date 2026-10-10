// Retakes the landing page's hero images from the designer itself, so the
// picture on the front page is always the product that ships (six steps,
// Riley, the real opening total), in each language:
//
//   node scripts/hero-shots.mjs            writes images/hero-designer-<lang>.webp
//                                          and images/hero-designer-<lang>-phone.webp
//   node scripts/hero-shots.mjs --port 4471   (the local server it starts; default 4461)
//
// It serves the repo with scripts/serve.mjs, opens the demo designer in the
// test browser (Playwright's Chromium, installed for the e2e tests), waits
// for the 3D room, every product model and Riley, goes to the Layout step,
// and takes two shots per language: the whole studio at desktop width
// (1280 px) and a tighter crop of the room for phones (720 px). The PNGs are
// encoded as WebP by the browser. Run it (npm run hero) after a visible
// change to the designer and commit the images.
//
// The pictures are reproducible: the sample room and its product picks are
// fixed (the same in every language), nothing is drawn until every model
// has loaded (a run that didn't wait showed the stand-in toilet in one
// language and the real one in another), and the camera is left to settle.
// Two runs at the same commit give the same six files.

/* global window, Image, document */
import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const portArg = process.argv.indexOf("--port");
const PORT = Number(portArg !== -1 ? process.argv[portArg + 1] : process.env.HERO_PORT || 4461);
const LANGS = [
  { code: "en", dir: "" },
  { code: "es", dir: "es/" },
  { code: "pt", dir: "pt/" },
];
// Desktop: the studio as it is on a laptop. Phone: the room and Riley, cropped.
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 720, height: 1200 };
// What each picture shows: the studio from its bar down (the bar with the
// six steps, the room with Riley under it, and the step's panel at desktop).
const DESKTOP_FRAME = { width: 1280, height: 760 };
const PHONE_FRAME = { width: 720, height: 672 };
const QUALITY = 0.8;

async function waitForServer(url, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("the local server didn't start");
}

// The sample room's products, picked the same way in every language and on
// every run: each fixture's first real Kohler or Sterling model.
const PRODUCT_PICKS = { toilet: "K-31648-0" };

// Every fixture and product model is in and drawn (no stand-ins left).
async function waitForModels(page) {
  await page.waitForFunction(() => window.BathroomRoom3D.pendingModels() === 0, null, { timeout: 120000 });
  await page.waitForFunction(() => window.BathroomRoom3D.itemScreenPoint("f1") !== null);
}

// The designer, drawn and talking, on the Layout step.
async function openDesigner(page, dir, lang) {
  await page.goto(`http://localhost:${PORT}/${dir}designer.html?lang=${lang}`);
  await page.waitForFunction(
    () => window.RoomStudio && window.BathroomRoom3D && window.BathroomRoom3D.available === true,
  );
  await waitForModels(page);
  await page.evaluate((picks) => {
    for (const slot of Object.keys(picks)) window.BathroomRoom3D.setProductPick(slot, picks[slot]);
  }, PRODUCT_PICKS);
  await waitForModels(page);
  // Riley's first line, then the plumbing wall she asks for, then Layout.
  await page.waitForFunction(() => /\S/.test((document.querySelector(".riley-text") || {}).textContent || ""));
  const wall = await page.evaluate(() => window.RoomPlan.stackWall(window.RoomStudio.design()));
  await page.locator(`[data-key="stack-${wall}"]`).click();
  await page.waitForFunction(() => window.RoomStudio.design().answered.stack === true);
  await page.locator('.studio-step-btn[data-step="layout"]').click();
  await page.locator(".studio-step.is-layout").waitFor();
  await page.waitForFunction(() => /\S/.test((document.querySelector(".riley-text") || {}).textContent || ""));
  await waitForModels(page);
  // Let the room settle (the camera's move, shadows) before the picture.
  await page.waitForTimeout(1500);
}

// PNG bytes -> WebP bytes, encoded by the browser itself (no extra tooling).
async function toWebp(page, png) {
  const dataUrl = await page.evaluate(
    ([b64, q]) =>
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.getContext("2d").drawImage(img, 0, 0);
          resolve(canvas.toDataURL("image/webp", q));
        };
        img.onerror = () => reject(new Error("could not decode the screenshot"));
        img.src = "data:image/png;base64," + b64;
      }),
    [png.toString("base64"), QUALITY],
  );
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

async function size(page, png) {
  return page.evaluate(
    (b64) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.src = "data:image/png;base64," + b64;
      }),
    png.toString("base64"),
  );
}

const server = spawn(process.execPath, [join(root, "scripts/serve.mjs"), String(PORT)], {
  stdio: "ignore",
  env: { ...process.env, ENV_FILE: "" },
});
try {
  await waitForServer(`http://localhost:${PORT}/index.html`);
  const browser = await chromium.launch();
  const encoder = await browser.newPage();
  await mkdir(join(root, "images"), { recursive: true });
  for (const { code, dir } of LANGS) {
    for (const [suffix, viewport] of [
      ["", DESKTOP],
      ["-phone", PHONE],
    ]) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: "light" });
      const page = await context.newPage();
      await openDesigner(page, dir, code);
      // Fixed frames, so the three languages' images share one size and the
      // page can reserve their space (width/height in pages/index.html).
      const bar = await page.locator(".studio-bar").boundingBox();
      const frame = suffix === "" ? DESKTOP_FRAME : PHONE_FRAME;
      const png = await page.screenshot({
        type: "png",
        clip: { x: bar.x, y: bar.y, width: frame.width, height: frame.height },
      });
      const webp = await toWebp(encoder, png);
      const dims = await size(encoder, png);
      const file = `images/hero-designer-${code}${suffix}.webp`;
      await writeFile(join(root, file), webp);
      console.log(`${file}  ${dims.width}x${dims.height}  ${Math.round(webp.length / 1024)} kB`);
      await context.close();
    }
  }
  await browser.close();
} finally {
  server.kill();
}
