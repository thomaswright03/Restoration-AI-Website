"use strict";

const path = require("path");
const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const {
  useConfig,
  openStudio,
  wait3d,
  answerAll,
  confirmStack,
  onScreen,
  step,
  byKey,
  studioStatus,
  studioToast,
  expectNoPlaceholders,
} = require("./helpers");

test.describe("design studio", () => {
  test("opens on the sample full bath, drawn in 3D, with everything fitting and a price", async ({ page }) => {
    const errors = await openStudio(page);
    await answerAll(page);
    await wait3d(page);
    await expect(page.locator("#room-3d-canvas canvas")).toBeVisible();
    // The untouched sample (5 x 8½) opens with nothing to warn about.
    await expect(studioStatus(page)).toHaveText("Everything fits");
    await expect(page.locator(".studio-total-chip strong")).toContainText("$");
    // The common "Full bath" is the classic 5 x 8, six inches narrower: its
    // toilet only gets code's 15 in. beside it rather than the recommended
    // 18, which is a note, not a problem. The chip names it and says why; a
    // click shows it.
    await byKey(page, "tpl-full5x8").click();
    await confirmStack(page);
    await expect(page.locator("#studio-size-w")).toHaveValue("8′");
    await expect(studioStatus(page)).toHaveText("Fits; the toilet is tight");
    await expect(studioStatus(page)).toHaveAttribute("title", /^Toilet: .*15/);
    await studioStatus(page).click();
    await expect(page.locator(".studio-step.is-layout")).toBeVisible();
    await expect(page.locator(".studio-step.is-layout")).toContainText("15");
    await expect(page.locator(".studio-biz")).toHaveText("Sample Remodeling Co.");
    // The site header scrolls with the page here, so it never covers the steps.
    await expect(page.locator(".site-header")).toHaveCSS("position", "relative");
    await expect(page.locator("#studio-labels .is-wall")).toHaveCount(4);
    await step(page, "layout").click();
    await expect(page.locator(".studio-item-btn")).toHaveCount(3);
    await expect(page.locator(".studio-item-btn").nth(0)).toContainText("Bathtub");
    expect(errors).toEqual([]);
  });

  test("the room's size takes feet and inches, refuses a size out of range, and resizes the price", async ({
    page,
  }) => {
    const errors = await openStudio(page);
    await answerAll(page);
    const total = page.locator(".studio-total-chip strong");
    await expect(total).toContainText("$");
    const before = await total.innerText();
    const width = page.locator("#studio-size-w");
    await width.fill(`10' 6"`);
    await width.press("Enter");
    await expect(width).toHaveValue("10′ 6″");
    await expect(page.locator(".studio-step.is-room")).toContainText("Floor area: 52.5 sq ft");
    await expect(total).not.toHaveText(before);

    await width.fill("50");
    await width.press("Enter");
    await expect(page.locator("#studio-size-w-error")).toHaveText("Enter a length between 3′ and 30′.");
    await expect(width).toHaveAttribute("aria-invalid", "true");

    await width.fill("nine feet");
    await width.press("Enter");
    await expect(page.locator("#studio-size-w-error")).toBeVisible();

    await byKey(page, "size-l-more").click();
    await expect(page.locator("#studio-size-l")).toHaveValue("5′ 1″");
    expect(errors).toEqual([]);
  });

  test("a common bathroom replaces the room, and Undo brings the old one back", async ({ page }) => {
    const errors = await openStudio(page);
    await answerAll(page);
    await byKey(page, "tpl-primary").click();
    await expect(studioToast(page)).toContainText("Started from: Primary bath.");
    await expect(page.locator("#studio-size-w")).toHaveValue("11′");
    await expect(studioStatus(page)).not.toHaveClass(/is-error/);
    await studioToast(page).getByRole("button", { name: "Undo" }).click();
    await expect(page.locator("#studio-size-w")).toHaveValue("8′ 6″");
    await page.locator(".studio-action", { hasText: "Redo" }).click();
    await expect(page.locator("#studio-size-w")).toHaveValue("11′");
    expect(errors).toEqual([]);
  });

  test("a fixture is added where it fits; one with no room is shown as not fitting until it's undone", async ({
    page,
  }) => {
    const errors = await openStudio(page);
    await answerAll(page);
    await step(page, "layout").click();
    await byKey(page, "add-shower").click();
    await expect(studioToast(page)).toContainText("Shower added, but there's no free spot where it fits");
    await expect(studioStatus(page)).toHaveClass(/is-error/);
    await expect(page.locator(".studio-issues").first()).toBeVisible();
    await expect(page.locator(".studio-item-btn")).toHaveCount(4);
    await page.keyboard.press("Control+z");
    await expect(studioStatus(page)).not.toHaveClass(/is-error/);
    await expect(page.locator(".studio-item-btn")).toHaveCount(3);

    // The 11 x 9 primary bath has room for another toilet.
    await step(page, "room").click();
    await byKey(page, "tpl-primary").click();
    await confirmStack(page);
    await step(page, "layout").click();
    await byKey(page, "add-toilet").click();
    await expect(studioToast(page)).toContainText(/Toilet 2 added on wall [ABCD]\./);
    await expect(page.locator(".studio-item-btn")).toHaveCount(7);
    await expect(studioStatus(page)).not.toHaveClass(/is-error/);
    expect(errors).toEqual([]);
  });

  test("a fixture can be moved to another wall, removed, and put back with Undo", async ({ page }) => {
    const errors = await openStudio(page);
    await answerAll(page);
    await step(page, "layout").click();
    await byKey(page, "item-f3").click();
    await expect(byKey(page, "item-f3")).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".studio-gaps")).toBeVisible();

    await byKey(page, "insp-f3-remove").click();
    await expect(studioToast(page)).toContainText("Toilet removed.");
    await expect(page.locator(".studio-item-btn")).toHaveCount(2);
    await studioToast(page).getByRole("button", { name: "Undo" }).click();
    await expect(page.locator(".studio-item-btn")).toHaveCount(3);

    await byKey(page, "item-f2").click();
    await byKey(page, "insp-f2-wall-N").click();
    await expect(byKey(page, "item-f2")).toContainText("Wall A");
    expect(errors).toEqual([]);
  });

  test("Show me layouts that fit offers whole-room layouts and uses the one picked", async ({ page }) => {
    const errors = await openStudio(page);
    await answerAll(page);
    await step(page, "layout").click();
    // In the 8 x 5 full bath a few layouts work, and the one on screen is
    // marked as the one in use.
    await byKey(page, "arrange").click();
    await expect(page.locator(".studio-arrangement").first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".studio-arrangement.is-current")).toHaveCount(1);
    for (const fit of await page.locator(".studio-arrangement-fit").allInnerTexts())
      expect(fit).toBe("Everything fits");

    await step(page, "room").click();
    await byKey(page, "tpl-showerBath").click();
    await confirmStack(page);
    await step(page, "layout").click();
    await byKey(page, "arrange").click();
    await expect(page.locator(".studio-arrangement").nth(1)).toBeVisible({ timeout: 15000 });
    for (const fit of await page.locator(".studio-arrangement-fit").allInnerTexts())
      expect(fit).toBe("Everything fits");
    await page.locator(".studio-arrangement:not(.is-current)").first().click();
    await expect(studioToast(page)).toContainText("Room arranged.");
    await expect(studioStatus(page)).not.toHaveClass(/is-error/);
    expect(errors).toEqual([]);
  });

  test("on the floor plan, the arrow keys slide the selected fixture along its wall", async ({ page }) => {
    const errors = await openStudio(page);
    await answerAll(page);
    await page.locator('.studio-view-btn[data-view="plan"]').click();
    await expect(page.locator("#studio-plan")).toBeVisible();
    await expect(page.locator("#room-3d")).toBeHidden();
    const toilet = page.locator('#studio-plan .plan-item[data-id="f3"]');
    await expect(toilet).toHaveAttribute("aria-label", "Toilet on wall A, center 1′ 6″ from the left corner");
    await toilet.click();
    await expect(toilet).toBeFocused();
    await page.keyboard.press("Shift+ArrowRight");
    await expect(toilet).toHaveAttribute("aria-label", "Toilet on wall A, center 2′ from the left corner");
    await page.keyboard.press("ArrowLeft");
    await expect(toilet).toHaveAttribute("aria-label", "Toilet on wall A, center 1′ 11″ from the left corner");
    await page.keyboard.press("Control+z");
    await expect(toilet).toHaveAttribute("aria-label", "Toilet on wall A, center 1′ 6″ from the left corner");
    await page.keyboard.press("Escape");
    await expect(page.locator("#studio-selchip")).toBeHidden();
    expect(errors).toEqual([]);
  });

  test("in 3D, a fixture dragged onto another goes back and says why; dragged to free floor, it moves", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const errors = await openStudio(page);
    await answerAll(page);
    await wait3d(page);
    const point = (id) => page.evaluate((i) => window.BathroomRoom3D.itemScreenPoint(i), id);
    const drag = async (from, to) => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
      await page.mouse.move(to.x, to.y, { steps: 5 });
      await page.mouse.up();
    };

    await drag(await point("f3"), await point("f1"));
    await expect(studioToast(page)).toContainText("That spot doesn't work, so it went back.");
    // The toast offers a way out, never just a dead end.
    await expect(studioToast(page).locator(".studio-toast-action")).toHaveText(/Best spot|Arrange for me/);
    await expect(studioStatus(page)).not.toHaveClass(/is-error/);
    await expect(page.locator("#studio-selchip")).toContainText("Toilet");

    // A roomier room, then across to wall D, where there's free floor.
    await step(page, "room").click();
    const width = page.locator("#studio-size-w");
    await width.fill("12'");
    await width.press("Enter");
    const length = page.locator("#studio-size-l");
    await length.fill("10'");
    await length.press("Enter");
    await expect(length).toHaveValue("10′");
    await drag(await point("f3"), await onScreen(page, 1.2, 1, 5));
    await step(page, "layout").click();
    await expect(byKey(page, "item-f3")).toContainText("Wall D");
    await expect(studioStatus(page)).not.toHaveClass(/is-error/);
    expect(errors).toEqual([]);
  });

  test("walk-in stands inside the doorway, and the room view comes back", async ({ page }) => {
    const errors = await openStudio(page);
    await answerAll(page);
    await wait3d(page);
    await page.locator('.studio-view-btn[data-view="walk"]').click();
    await expect(page.locator('.studio-view-btn[data-view="walk"]')).toHaveAttribute("aria-pressed", "true");
    // The door is on wall C (the far side, z = 5 ft): the camera is just inside it, at eye height.
    await expect
      .poll(() => page.evaluate(() => window.BathroomRoom3D.cameraPosition()))
      .toMatchObject({ z: expect.closeTo(4.7, 1) });
    const cam = await page.evaluate(() => window.BathroomRoom3D.cameraPosition());
    expect(cam.y).toBeGreaterThan(4.5);
    expect(cam.z).toBeLessThan(5);
    await page.locator('.studio-view-btn[data-view="3d"]').click();
    await expect.poll(() => page.evaluate(() => window.BathroomRoom3D.cameraPosition().y)).toBeGreaterThan(8);
    expect(errors).toEqual([]);
  });

  test("the PDF lists exactly the Estimate step's lines, with a picture even from plan view", async ({ page }) => {
    test.setTimeout(60000);
    const errors = await openStudio(page);
    await answerAll(page);
    await wait3d(page);
    await step(page, "finishes").click();
    await byKey(page, "fin-walls-tile").click();
    await page.locator('.studio-view-btn[data-view="plan"]').click();
    await step(page, "estimate").click();
    await expect(page.getByTestId("estimate-card")).toBeVisible();
    const card = await page
      .locator(".studio-estimate .studio-lines:not(.is-excluded) .studio-line")
      .evaluateAll((rows) =>
        rows.map((r) => ({
          label: r.querySelector(".studio-line-label").firstChild.textContent,
          detail: (r.querySelector(".studio-line-label small") || {}).textContent || null,
          amount: r.querySelector(".studio-line-amount").textContent,
        })),
      );
    await page.evaluate(() => {
      const build = window.EstimatePdf.build;
      window.EstimatePdf.build = (spec) => {
        window.__pdfSpec = spec;
        return build(spec);
      };
    });
    await Promise.all([page.waitForEvent("download"), byKey(page, "pdf").click()]);
    const pdf = await page.evaluate(() => ({
      lines: window.__pdfSpec.lines.map((l) => ({ label: l.label, detail: l.detail || null, amount: l.amount })),
      picture: Boolean(window.__pdfSpec.picture),
      plan: Boolean(window.__pdfSpec.plan),
      design: window.__pdfSpec.design,
      link: window.__pdfSpec.sections[window.__pdfSpec.sections.length - 1].items[0],
      planTexts: window.__pdfSpec.plan.texts.filter((t) => t.bold).map((t) => ({ text: t.text, x: t.x, z: t.z })),
    }));
    expect(card.length).toBeGreaterThan(2);
    expect(pdf.lines).toEqual(card);
    expect(pdf.picture).toBe(true);
    expect(pdf.plan).toBe(true);
    // "Your design" names every product in the room, the ones still on a
    // stand-in (the sample's toilet) included, and never a panel aside.
    expect(pdf.design).toContainEqual(expect.stringMatching(/^Toilet: /));
    expect(pdf.design).toContainEqual(expect.stringMatching(/^Tub: .*K-/));
    expect(pdf.design.join("\n")).not.toMatch(/\(pick /);
    // The closing link reads on paper: no "click here", and its address is given.
    expect(pdf.link.text).not.toMatch(/click/i);
    expect(pdf.link.text).toMatch(/address/);
    expect(pdf.link.url).toMatch(/designer\.html#design=/);
    // On the plan, the room's length label stands clear of the wall letters
    // (which sit 0.7 ft outside the walls): at least 1.5 ft further out.
    const letterD = pdf.planTexts.find((t) => t.text === "D");
    const length = pdf.planTexts.find((t) => /^5/.test(t.text));
    expect(letterD.x - length.x).toBeGreaterThanOrEqual(1.5);
    expect(errors).toEqual([]);
  });

  test("on a phone in Portuguese the page never scrolls sideways and every step is in the bar", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    const errors = await openStudio(page, "/pt/designer.html");
    await expect(step(page, "estimate")).toHaveText(/6/);
    const fit = await page.evaluate(() => {
      const nav = document.querySelector(".studio-steps");
      const last = nav.lastElementChild;
      // Scrolled to the end, step 6 is fully inside the bar.
      nav.scrollLeft = nav.scrollWidth;
      const bar = nav.getBoundingClientRect();
      const six = last.getBoundingClientRect();
      nav.scrollLeft = 0;
      return {
        pageWidth: document.documentElement.scrollWidth,
        navRight: Math.round(bar.right),
        lastInNav: six.right <= bar.right + 1 && six.left >= bar.left - 1,
        scrollable: nav.scrollWidth >= nav.clientWidth,
      };
    });
    expect(fit.pageWidth).toBeLessThanOrEqual(375);
    expect(fit.navRight).toBeLessThanOrEqual(375);
    expect(fit.lastInNav).toBe(true);
    expect(fit.scrollable).toBe(true);
    // Going to a step brings it into view inside the bar.
    await confirmStack(page);
    await step(page, "layout").click();
    const inView = await page.evaluate(() => {
      const nav = document.querySelector(".studio-steps").getBoundingClientRect();
      const cur = document.querySelector('.studio-step-btn[aria-current="step"]').getBoundingClientRect();
      return cur.left >= nav.left - 1 && cur.right <= nav.right + 1;
    });
    expect(inView).toBe(true);
    expect(errors).toEqual([]);
  });

  test("finishes change the room and the price", async ({ page }) => {
    const errors = await openStudio(page);
    await answerAll(page);
    const total = page.locator(".studio-total-chip strong");
    await expect(total).toContainText("$");
    await step(page, "finishes").click();
    const before = await total.innerText();
    // Picking another product for a surface moves the price in the bar.
    const floor = page.locator('.studio-swatch-group[data-cat="floorTile"] .studio-swatch');
    await expect(floor.first()).toHaveAttribute("aria-pressed", "true");
    await floor.nth(1).click();
    await expect(floor.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(total).not.toHaveText(before);
    await floor.first().click();
    await expect(total).toHaveText(before);
    await byKey(page, "fin-walls-tile").click();
    await expect(byKey(page, "fin-walls-tile")).toHaveAttribute("aria-pressed", "true");
    await expect(total).not.toHaveText(before);
    const tiled = await total.innerText();
    await page.locator("#studio-fin-demo").uncheck();
    await expect(total).not.toHaveText(tiled);
    expect(errors).toEqual([]);
  });

  test("the demo's estimate ends with the PDF and a sign-up, never a homeowner's request form", async ({
    browser,
    page,
  }) => {
    test.setTimeout(60000);
    const errors = await openStudio(page);
    await answerAll(page);
    await step(page, "estimate").click();
    await expect(page.getByTestId("estimate-card")).toBeVisible();
    const total = await page.getByTestId("estimate-total").innerText();
    expect(total).toMatch(/^\$[\d,]+\.\d\d$/);
    await expect(page.locator(".studio-total-chip strong")).toHaveText(total);

    // The demo speaks to the business trying it, not to a homeowner.
    const estimateStep = page.locator(".studio-step.is-estimate");
    await expect(estimateStep.locator(".studio-step-intro")).toContainText("at a sample business's prices");
    await expect(estimateStep).not.toContainText("Send");
    await expect(page.locator("#lead-form, #studio-request")).toHaveCount(0);
    await expect(estimateStep.locator(".studio-demo-end")).toContainText("What your business gets");
    await expect(byKey(page, "signup")).toHaveAttribute("href", /signup\.html$/);
    await expect(byKey(page, "save")).toHaveCount(0);

    const [download] = await Promise.all([page.waitForEvent("download"), byKey(page, "pdf").click()]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);

    // The estimate names the day the catalog's prices were checked, never "current".
    await expect(page.getByTestId("estimate-card")).toContainText("catalog prices as of October 2026");
    await expect(page.getByTestId("estimate-card")).not.toContainText("current Home Depot");

    // No clipboard: the link shows in a box to copy by hand.
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }));
    await byKey(page, "share").click();
    await expect(page.locator("#studio-link-dialog")).toBeVisible();
    const link = await page.locator("#studio-link-input").inputValue();
    expect(link).toContain("/designer.html#design=");
    // A click on the backdrop closes it, like the other dialogs; focus goes back to Share.
    await page.mouse.click(4, 4);
    await expect(page.locator("#studio-link-dialog")).toBeHidden();
    await expect(byKey(page, "share")).toBeFocused();
    await byKey(page, "share").click();
    await expect(page.locator("#studio-link-dialog")).toBeVisible();
    await page.locator("#studio-link-dialog [data-close]").click();

    const other = await browser.newPage();
    await other.goto(link);
    await expect(other.locator("#studio-toast")).toContainText("Here's the design from your link.");
    await expect(other.locator("#studio-size-w")).toHaveValue("8′ 6″");
    await expect(other).not.toHaveURL(/#design=/);
    await other.close();
    expect(errors).toEqual([]);
  });

  test("the design is still there after a reload, and Start over begins again", async ({ page }) => {
    const errors = await openStudio(page);
    await answerAll(page);
    await page.locator("#studio-size-w").fill("9");
    await page.locator("#studio-size-w").press("Enter");
    await expect(page.locator("#studio-size-w")).toHaveValue("9′");
    await page.reload();
    await expect(page.locator("#studio-size-w")).toHaveValue("9′");
    await expect(studioToast(page)).toContainText("Here's the design you were working on.");
    await page.locator(".studio-action", { hasText: "Start over" }).click();
    await expect(page.locator("#studio-size-w")).toHaveValue("8′ 6″");
    expect(errors).toEqual([]);
  });

  test("without the price estimator, the last step shows the design without prices", async ({ page }) => {
    await useConfig(page, { priceEstimator: { enabled: false } });
    const errors = await openStudio(page);
    await answerAll(page);
    await expect(step(page, "estimate")).toContainText("Design");
    await expect(page.locator(".studio-total-chip")).toBeHidden();
    await step(page, "estimate").click();
    await expect(page.getByTestId("estimate-total")).toHaveCount(0);
    await expect(page.locator(".studio-step.is-estimate h2")).toHaveText("Your design");
    // Still the sixth step, and Riley doesn't promise a total that isn't there.
    await expect(page.locator(".studio-step.is-estimate .studio-step-count")).toHaveText("Step 6 of 6");
    await expect(page.locator(".studio-riley .riley-text")).toContainText("Here's your design in full");
    await expect(page.locator(".studio-riley .riley-text")).not.toContainText("adds up to");
    // The estimator is off by choice here, not by a failed load: no notice.
    await expect(page.getByTestId("settings-failed")).toHaveCount(0);
    await expect(byKey(page, "pdf")).toBeVisible();
    await expectNoPlaceholders(page);
    expect(errors).toEqual([]);
  });

  test("when the settings file won't load, the designer retries, then says so on the last step, and Try again brings the estimate back", async ({
    page,
  }) => {
    let asked = 0;
    let broken = true;
    await page.route("**/site-config.json", (route) => {
      asked++;
      if (broken) return route.fulfill({ status: 502, contentType: "text/plain", body: "bad gateway" });
      return route.continue();
    });
    const errors = await openStudio(page);
    await answerAll(page);
    await expect(page.locator("html")).toHaveAttribute("data-config", "defaults");
    expect(asked).toBe(3);
    await expect(page.locator(".studio-total-chip")).toBeHidden();
    await step(page, "estimate").click();
    await expect(page.locator(".studio-step.is-estimate .studio-step-count")).toHaveText("Step 6 of 6");
    const notice = page.getByTestId("settings-failed");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("price settings couldn't be loaded");
    await expect(page.locator(".studio-riley .riley-text")).not.toContainText("adds up to");
    // Still down: says so, stays on the design.
    await byKey(page, "settings-retry").click();
    await expect(studioToast(page)).toContainText("Still couldn't load");
    await expect(notice).toBeVisible();
    // Back up: the estimate appears without a reload.
    broken = false;
    await byKey(page, "settings-retry").click();
    await expect(page.getByTestId("estimate-card")).toBeVisible();
    await expect(page.locator(".studio-step.is-estimate .studio-step-count")).toHaveText("Step 6 of 6");
    await expect(page.locator(".studio-total-chip strong")).toContainText("$");
    await expect(page.getByTestId("settings-failed")).toHaveCount(0);
    await expect(page.locator(".studio-riley .riley-text")).toContainText("adds up to");
    await expectNoPlaceholders(page);
    expect(errors).toEqual([]);
  });

  test("on a slow connection the studio starts on the floor plan before the 3D room arrives, then takes it up", async ({
    page,
  }) => {
    // three.js itself is the big download: hold it back.
    let release = null;
    const held = new Promise((r) => (release = r));
    await page.route("**/js/vendor/three-r186/three.module.js", async (route) => {
      await held;
      await route.continue();
    });
    // Not waiting for "load": the held module keeps that from firing.
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/designer.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".studio-step-btn")).toHaveCount(6);
    // Usable on the plan: the room's size can be changed.
    await expect(page.locator("#studio-plan")).toBeVisible();
    const width = page.locator("#studio-size-w");
    await width.fill("9");
    await width.press("Enter");
    await expect(page.locator(".studio-step.is-room")).toContainText("Floor area: 45 sq ft");
    expect(await page.evaluate(() => !!(window.BathroomRoom3D && window.BathroomRoom3D.available))).toBe(false);
    release();
    await wait3d(page);
    await answerAll(page);
    await expect(page.locator("#room-3d-canvas canvas")).toBeVisible();
    // The late room shows the design as it stands now, and the view is 3D.
    await expect(page.locator(".studio-step.is-room")).toContainText("Floor area: 45 sq ft");
    await expect(page.locator("#studio-labels .is-wall")).toHaveCount(4);
    await step(page, "layout").click();
    await expect(page.locator(".studio-item-btn")).toHaveCount(3);
    expect(errors).toEqual([]);
  });

  test("the plumbing wall decides where a drain can go, and the estimate prices the pipe", async ({ page }) => {
    const errors = await openStudio(page);
    await answerAll(page);
    // The sample bath's plumbing is in wall A, where the toilet and vanity are.
    await expect(page.locator(".studio-step.is-room")).toContainText("Everything with a drain is on that wall");
    await expect(byKey(page, "stack-N")).toHaveAttribute("aria-pressed", "true");

    // In a bathroom this small every drain reaches any wall, so grow it:
    // now the toilet can't reach the far wall (S, shown as C).
    const width = page.locator("#studio-size-w");
    const length = page.locator("#studio-size-l");
    const size = async (w, l) => {
      await width.fill(w);
      await width.press("Enter");
      await length.fill(l);
      await length.press("Enter");
    };
    await size("12'", "12'");
    await expect(length).toHaveValue("12′");
    await byKey(page, "stack-S").click();
    await expect(studioStatus(page)).toHaveClass(/is-error/);
    await step(page, "layout").click();
    await expect(page.locator(".studio-issues").first()).toContainText("too far from the plumbing in wall C");

    // Back to the small bath: wall E (shown as B) is around the corner, so
    // it works, but it's priced.
    await step(page, "room").click();
    await size("8' 6\"", "5'");
    await expect(length).toHaveValue("5′");
    await byKey(page, "stack-E").click();
    await expect(studioStatus(page)).not.toHaveClass(/is-error/);
    await expect(page.locator(".studio-step.is-room")).toContainText("of new drain line");
    await step(page, "estimate").click();
    await expect(page.getByTestId("estimate-card")).toContainText("New drain line to the plumbing wall");
    expect(errors).toEqual([]);
  });

  test("the electrical step suggests the wiring, and a point slides along its wall", async ({ page }) => {
    const errors = await openStudio(page);
    await answerAll(page);
    await step(page, "electrical").click();
    await expect(page.locator(".studio-step h2")).toHaveText("Electrical");
    // A GFCI outlet by the vanity, a light over the mirror, a switch by the
    // door, the fan over the tub and a switch for it.
    const rows = page.locator(".studio-item-btn");
    await expect(rows).toHaveCount(5);
    await expect(rows.nth(0)).toContainText("Outlet");
    await expect(page.locator(".studio-step.is-electrical")).toContainText("Exhaust fan");
    await expect(page.locator(".studio-step.is-electrical .studio-issues")).toHaveCount(0);

    await rows.nth(0).click();
    const slider = page.locator(".studio-inspector input[type=range]").first();
    const before = await slider.inputValue();
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    expect(Number(await slider.inputValue())).toBeGreaterThan(Number(before));
    // Removing it is noticed by the rules and can be undone.
    const first = await page.evaluate(() => window.RoomPlan.electrical(window.RoomStudio.design())[0].id);
    await byKey(page, `pt-${first}-remove`).click();
    await expect(page.locator(".studio-step.is-electrical")).toContainText("The vanity needs a GFCI outlet");
    await studioToast(page).getByRole("button", { name: "Undo" }).click();
    await expect(page.locator(".studio-item-btn")).toHaveCount(5);
    expect(errors).toEqual([]);
  });

  test("an outlet drags along the wall in 3D, and a bad spot goes back with the reason", async ({ page }) => {
    test.setTimeout(60000);
    const errors = await openStudio(page);
    await answerAll(page);
    await wait3d(page);
    await step(page, "electrical").click();
    const at = (x, y, z) => onScreen(page, x, y, z);
    const drag = async (from, to) => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
      await page.mouse.move(to.x, to.y, { steps: 5 });
      await page.mouse.up();
    };
    const outlet = await page.evaluate(() => {
      const p = window.RoomPlan.electrical(window.RoomStudio.design())[0];
      return { id: p.id, offset: p.offset, height: p.height };
    });
    const from = await at(outlet.offset, outlet.height, 0.1);
    // A foot to the left along wall A is free wall.
    await drag(from, await at(outlet.offset - 1, outlet.height, 0.1));
    await expect
      .poll(() => page.evaluate(() => window.RoomPlan.electrical(window.RoomStudio.design())[0].offset))
      .toBeLessThan(outlet.offset - 0.5);
    expect(errors).toEqual([]);
  });

  test("picking a product shows that fixture on its own, and Just this turns it off", async ({ page }) => {
    const errors = await openStudio(page);
    await answerAll(page);
    await wait3d(page);
    await step(page, "products").click();
    await byKey(page, "focus-toilet").click();
    const iso = page.locator(".studio-iso-btn");
    await expect(iso).toHaveAttribute("aria-pressed", "true");
    await expect(iso).toContainText("Showing just this");
    await expect.poll(() => page.evaluate(() => window.BathroomRoom3D.itemScreenPoint("f1"))).toBeNull();
    await iso.click();
    await expect(iso).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => page.evaluate(() => window.BathroomRoom3D.itemScreenPoint("f1"))).not.toBeNull();
    expect(errors).toEqual([]);
  });

  test("leaving Products brings the whole room back, so isolation never follows into Finishes", async ({ page }) => {
    const errors = await openStudio(page);
    await answerAll(page);
    await wait3d(page);
    await step(page, "products").click();
    await byKey(page, "focus-toilet").click();
    const iso = page.locator(".studio-iso-btn");
    await expect(iso).toHaveAttribute("aria-pressed", "true");
    await step(page, "finishes").click();
    await expect(iso).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => page.evaluate(() => window.BathroomRoom3D.itemScreenPoint("f1"))).not.toBeNull();
    expect(errors).toEqual([]);
  });

  test("Just this turned on in Layout ends with the step, like every other step change", async ({ page }) => {
    const errors = await openStudio(page);
    await answerAll(page);
    await wait3d(page);
    await step(page, "layout").click();
    await byKey(page, "item-f1").click();
    const iso = page.locator(".studio-iso-btn");
    await iso.click();
    await expect(iso).toHaveAttribute("aria-pressed", "true");
    await step(page, "electrical").click();
    await expect(iso).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => page.evaluate(() => window.BathroomRoom3D.itemScreenPoint("f2"))).not.toBeNull();
    expect(errors).toEqual([]);
  });

  test("electrical the rules still ask for is said on the Estimate, by Riley too, with a way to add it", async ({
    page,
  }) => {
    const errors = await openStudio(page);
    await answerAll(page);
    await step(page, "electrical").click();
    const first = await page.evaluate(() => window.RoomPlan.electrical(window.RoomStudio.design())[0].id);
    await page.locator(".studio-item-btn").first().click();
    await byKey(page, `pt-${first}-remove`).click();
    await step(page, "estimate").click();
    const banner = page.locator(".studio-banner.is-warn");
    await expect(banner).toContainText("Not in this price yet: The vanity needs a GFCI outlet");
    const riley = page.locator(".riley");
    await expect(riley).toHaveAttribute("data-tone", "warn");
    await expect(riley.locator(".riley-text")).toContainText("One thing first: The vanity needs a GFCI outlet");
    await riley.getByRole("button", { name: "Yes please" }).click();
    await expect(banner).toHaveCount(0);
    await expect(riley.locator(".riley-text")).not.toContainText("One thing first");
    expect(await page.evaluate(() => window.RoomPlan.electricalGaps(window.RoomStudio.design(), {}))).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("Show examples opens a product's listing photos as a slideshow", async ({ page }) => {
    // The photos come from Home Depot's image server: stand in a local
    // picture so the test doesn't depend on it.
    await page.route("https://images.thdstatic.com/**", (route) =>
      route.fulfill({ path: path.join(__dirname, "../../apple-touch-icon.png"), contentType: "image/png" }),
    );
    const errors = await openStudio(page);
    await answerAll(page);
    await step(page, "products").click();
    const button = page.locator(".studio-examples-btn").first();
    await expect(button).toHaveText("Show examples");
    const mmns = await page.evaluate(() => {
      const item = window.BathroomRoom3D.getProductPricingItems().filter((it) => it.mmns.length)[0];
      return item.mmns;
    });
    await button.click();
    const dialog = page.locator("#studio-photos-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".studio-photos-model")).toHaveText(mmns.join(" + "));
    const total = await page.evaluate(() => document.querySelectorAll(".studio-photos-thumb").length);
    expect(total).toBeGreaterThan(1);
    await expect(dialog.locator(".studio-photos-stage img")).toHaveAttribute("src", /images\.thdstatic\.com/);
    await expect(dialog.locator(".studio-photos-count")).toHaveText(`1 of ${total}`);
    await byKey(page, "photo-next").click();
    await expect(dialog.locator(".studio-photos-count")).toHaveText(`2 of ${total}`);
    await page.keyboard.press("ArrowLeft");
    await expect(dialog.locator(".studio-photos-count")).toHaveText(`1 of ${total}`);
    await page.keyboard.press("ArrowLeft");
    await expect(dialog.locator(".studio-photos-count")).toHaveText(`${total} of ${total}`);
    await dialog.locator(".studio-photos-thumb").nth(1).click();
    await expect(dialog.locator(".studio-photos-count")).toHaveText(`2 of ${total}`);
    await expect(dialog.locator(".studio-photos-foot a")).toHaveAttribute("href", /homedepot\.com/);
    const axe = await new AxeBuilder({ page })
      .include("#studio-photos-dialog")
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(errors).toEqual([]);
  });

  test("a product with no in-home photos says so, and one with no photos links to Home Depot", async ({ page }) => {
    await page.route("https://images.thdstatic.com/**", (route) =>
      route.fulfill({ path: path.join(__dirname, "../../apple-touch-icon.png"), contentType: "image/png" }),
    );
    const errors = await openStudio(page);
    await answerAll(page);
    await step(page, "products").click();
    await page.locator(".studio-examples-btn").first().click();
    const dialog = page.locator("#studio-photos-dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    // Sterling 402078-0's listing has only product photos; a model with no
    // matching listing has none.
    await page.evaluate(() => {
      const p = window.ProductPhotos.products;
      p["TEST-ONLY"] = { listing: p["402078-0"].listing, home: [], other: p["402078-0"].other };
    });
    expect(await page.evaluate(() => window.ProductPhotos.products["402078-0"].home.length)).toBe(0);
    await page.evaluate(() => {
      const item = window.BathroomRoom3D.getProductPricingItems().filter((it) => it.mmns.length)[0];
      window.__examplesItem = Object.assign({}, item, { mmns: ["TEST-ONLY"] });
    });
    await page.evaluate(() => window.RoomStudio.showExamples(window.__examplesItem));
    await expect(dialog.locator(".studio-photos-note")).toContainText("no photos of this one in a home");
    await page.keyboard.press("Escape");
    await page.evaluate(() =>
      window.RoomStudio.showExamples(Object.assign({}, window.__examplesItem, { mmns: ["K-NOPE-0"] })),
    );
    await expect(dialog.locator(".studio-photos-note")).toContainText("don't have photos of this model");
    await expect(dialog.locator(".studio-photos-stage")).toHaveCount(0);
    await expect(dialog.locator(".studio-photos-foot a")).toHaveAttribute(
      "href",
      "https://www.homedepot.com/s/K-NOPE-0",
    );
    expect(errors).toEqual([]);
  });

  test("each step waits until its questions are answered; going back is always fine", async ({ page }) => {
    const errors = await openStudio(page);
    await wait3d(page);
    const need = page.locator("#studio-step-need");
    await expect(need).toHaveText("To go on: pick the wall your plumbing is in.");
    await expect(step(page, "layout")).toHaveAttribute("aria-disabled", "true");
    await byKey(page, "nav-next").click();
    await expect(page.locator(".studio-step.is-room")).toBeVisible();
    await expect(studioToast(page)).toContainText("To go on: pick the wall your plumbing is in.");
    await expect(page.locator(".studio-riley .riley-text")).toContainText("Before we move on");
    await expect(page.locator(".studio-field.is-missing")).toHaveCount(1);
    // Jumping ahead from the step bar is refused too.
    await step(page, "estimate").click({ force: true });
    await expect(page.locator(".studio-step.is-room")).toBeVisible();

    await byKey(page, "stack-N").click();
    await expect(need).toHaveCount(0);
    await byKey(page, "nav-next").click();
    await expect(page.locator(".studio-step.is-layout")).toBeVisible();
    await byKey(page, "nav-next").click();
    await expect(page.locator(".studio-step.is-electrical")).toBeVisible();
    await byKey(page, "nav-next").click();
    await expect(page.locator(".studio-step.is-products")).toBeVisible();
    // Every product list starts on the model the room shows: nothing to pick before going on.
    await expect(page.locator('.studio-product-card select option[value=""]')).toHaveCount(0);
    await expect(need).toHaveCount(0);
    await byKey(page, "nav-next").click();
    await expect(page.locator(".studio-step.is-finishes")).toBeVisible();
    // Every surface starts on a product (the one the estimate prices), shown
    // pressed: nothing to pick before going on.
    await expect(need).toHaveCount(0);
    await expect(page.locator(".studio-swatch-group:not(:has([aria-pressed='true']))")).toHaveCount(0);
    await byKey(page, "nav-next").click();
    await expect(page.locator(".studio-step.is-estimate")).toBeVisible();
    await step(page, "room").click();
    await expect(page.locator(".studio-step.is-room")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Riley's voice list plays each voice on this device and remembers the pick", async ({ page }) => {
    // A stand-in for the browser's speech, with two English voices and one Spanish.
    await page.addInitScript(() => {
      const voices = [
        { name: "Samantha", lang: "en-US", localService: true },
        { name: "Daniel", lang: "en-GB", localService: true },
        { name: "Mónica", lang: "es-ES", localService: true },
      ];
      window.__spoken = [];
      const synth = {
        getVoices: () => voices,
        speak: (u) => window.__spoken.push({ text: u.text, voice: u.voice && u.voice.name }),
        cancel: () => {},
        addEventListener: () => {},
      };
      Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
      window.SpeechSynthesisUtterance = function (text) {
        this.text = text;
      };
    });
    const errors = await openStudio(page);
    const riley = page.locator(".riley");
    await riley.getByRole("button", { name: "Choose Riley's voice" }).click();
    const list = riley.locator(".riley-voice");
    await expect(list).toHaveCount(3);
    await expect(list.nth(0)).toContainText("Automatic (Samantha)");
    await expect(list.nth(0)).toHaveClass(/is-on/);

    await list.nth(2).getByRole("button", { name: "Play Daniel" }).click();
    let spoken = await page.evaluate(() => window.__spoken.at(-1));
    expect(spoken).toEqual({ text: expect.stringContaining("This is how I'll sound"), voice: "Daniel" });

    await list.nth(2).locator(".riley-voice-pick").click();
    await expect(list.nth(2)).toHaveClass(/is-on/);
    expect(await page.evaluate(() => localStorage.getItem("rd3d_riley_voice_en"))).toBe("Daniel");

    // She keeps it after a reload, and speaks with it.
    await page.goto("designer.html?voices");
    await expect(riley.locator(".riley-voice.is-on")).toContainText("Daniel");
    await riley.getByRole("button", { name: "Done" }).click();
    await expect(riley.locator(".riley-voices")).toBeHidden();
    await answerAll(page);
    spoken = await page.evaluate(() => window.__spoken.at(-1));
    expect(spoken.voice).toBe("Daniel");
    expect(errors).toEqual([]);
  });

  test("Escape closes Riley's voice list and returns focus to its button", async ({ page }) => {
    await page.addInitScript(() => {
      const voices = [{ name: "Samantha", lang: "en-US", localService: true }];
      const synth = { getVoices: () => voices, speak: () => {}, cancel: () => {}, addEventListener: () => {} };
      Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
      window.SpeechSynthesisUtterance = function (text) {
        this.text = text;
      };
    });
    const errors = await openStudio(page);
    const riley = page.locator(".riley");
    const button = riley.getByRole("button", { name: "Choose Riley's voice" });
    await button.click();
    await expect(riley.locator(".riley-voices")).toBeVisible();
    await riley.getByRole("button", { name: "Done" }).focus();
    await page.keyboard.press("Escape");
    await expect(riley.locator(".riley-voices")).toBeHidden();
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute("aria-expanded", "false");
    expect(errors).toEqual([]);
  });

  test("while its scripts are still on their way, the designer says it's loading", async ({ page }) => {
    // The studio's own script arrives late, as on a slow connection.
    await page.route("**/js/studio.js", async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    });
    // Not waiting for "load": deferred scripts have run by then.
    await page.goto("/designer.html", { waitUntil: "commit" });
    const loading = page.locator("#studio-loading");
    await expect(loading).toBeVisible();
    await expect(loading).toContainText("Loading the designer…");
    await expect(page.locator("#room-3d-canvas")).toHaveAttribute("data-loading", "Loading the designer…");
    await expect(page.locator(".studio-step-btn")).toHaveCount(6, { timeout: 20000 });
    await expect(loading).toHaveCount(0);
  });

  test("Riley talks through each step and offers a fix when something won't work", async ({ page }) => {
    const errors = await openStudio(page);
    const riley = page.locator(".riley");
    await expect(riley).toBeVisible();
    await expect(riley.locator(".riley-body > .riley-name")).toHaveText("Riley");
    await expect(riley.locator(".riley-text")).toContainText("Hi, I'm Riley");
    await expect(riley).toHaveAttribute("data-tone", "ok");
    await answerAll(page);

    await step(page, "layout").click();
    await expect(riley.locator(".riley-text")).toContainText("Now the layout");

    // Something that doesn't fit: she says so and offers to put it right.
    await byKey(page, "add-shower").click();
    await expect(riley).toHaveAttribute("data-tone", "error");
    await expect(riley.locator(".riley-text")).toContainText("Can I offer an alternative?");
    await expect(riley.locator(".riley-text")).toContainText("I'd take it back out");
    await riley.getByRole("button", { name: "Yes please" }).click();
    await expect(studioStatus(page)).not.toHaveClass(/is-error/);
    await expect(riley).not.toHaveAttribute("data-tone", "error");

    // Muting her is remembered, and she keeps writing either way.
    await riley.locator(".riley-mute").click();
    await expect(riley.locator(".riley-mute")).toHaveAttribute("aria-pressed", "false");
    await page.reload();
    await expect(page.locator(".riley-mute")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".riley-text")).not.toHaveText("");
    expect(errors).toEqual([]);
  });

  test("Riley speaks a new language in its own accent after mute and unmute", async ({ page }) => {
    // A fake of the browser's speech, shaped like Chrome's: the voices arrive
    // a moment after the page first asks, and a line with no voice set is
    // read in the default (English) voice whatever its language.
    await page.addInitScript(() => {
      const voices = [
        { name: "Samantha", lang: "en-US", localService: true },
        { name: "Mónica", lang: "es-ES", localService: true },
        { name: "Luciana", lang: "pt-BR", localService: true },
      ];
      let loaded = false;
      const listeners = [];
      window.__spoken = [];
      window.SpeechSynthesisUtterance = function (text) {
        this.text = text;
      };
      Object.defineProperty(window, "speechSynthesis", {
        value: {
          getVoices() {
            if (!loaded) {
              setTimeout(() => {
                loaded = true;
                listeners.forEach((fn) => fn());
              }, 300);
              return [];
            }
            return voices;
          },
          addEventListener(name, fn) {
            if (name === "voiceschanged") listeners.push(fn);
          },
          speak(line) {
            window.__spoken.push({ text: line.text, accent: line.voice ? line.voice.lang : "en-US" });
          },
          cancel() {},
        },
      });
    });
    await page.addInitScript(() => localStorage.setItem("rd3d_riley_muted", "0"));

    await openStudio(page);
    await page.locator(".riley-text").click();
    await expect.poll(() => page.evaluate(() => window.__spoken.length)).toBeGreaterThan(0);

    const errors = await openStudio(page, "/es/designer.html?lang=es");
    const mute = page.locator(".riley-mute");
    await mute.click();
    await expect(mute).toHaveAttribute("aria-pressed", "false");
    await mute.click();
    await expect(mute).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => page.evaluate(() => window.__spoken.length)).toBeGreaterThan(0);
    const spoken = await page.evaluate(() => window.__spoken);
    expect(spoken.map((s) => s.accent)).toEqual(spoken.map(() => "es-ES"));
    expect(errors).toEqual([]);
  });

  for (const [dir, lang, labels, fits] of [
    ["es", "es", ["Baño", "Distribución", "Electricidad", "Productos", "Acabados", "Estimación"], "Todo cabe"],
    ["pt", "pt", ["Banheiro", "Distribuição", "Elétrica", "Produtos", "Acabamentos", "Estimativa"], "Tudo cabe"],
  ]) {
    test(`/${dir}/designer.html runs the studio in that language`, async ({ page }) => {
      const errors = await openStudio(page, `/${dir}/designer.html?lang=${lang}`);
      await answerAll(page);
      await expect(page.locator(".studio-step-label")).toHaveText(labels);
      await expect(studioStatus(page)).toHaveText(fits);
      await step(page, "estimate").click();
      await expect(page.getByTestId("estimate-total")).toContainText("$");
      expect(errors).toEqual([]);
    });
  }
});

test.describe("design studio on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("each step starts just under the room, which stays in view", async ({ page }) => {
    const errors = await openStudio(page);
    await answerAll(page);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.locator(".studio-step-nav .btn-primary").click();
    await expect(page.locator(".studio-step h2")).toHaveText("Layout");
    const stage = await page.locator(".studio-stage").boundingBox();
    const heading = await page.locator(".studio-step h2").boundingBox();
    expect(stage.y).toBeGreaterThanOrEqual(0);
    expect(heading.y).toBeGreaterThanOrEqual(stage.y + stage.height - 1);
    expect(heading.y + heading.height).toBeLessThan(844);
    expect(errors).toEqual([]);
  });

  test("Riley's card sits under the room, not over the 3D view", async ({ page }) => {
    const errors = await openStudio(page);
    await answerAll(page);
    const riley = page.locator(".riley");
    await expect(riley).toBeVisible();
    const stage = await page.locator(".studio-stage").boundingBox();
    const card = await riley.boundingBox();
    expect(card.y).toBeGreaterThanOrEqual(stage.y + stage.height - 1);
    expect(errors).toEqual([]);
  });

  test("every designer control is at least 44 px on a touch screen", async ({ page }) => {
    const errors = await openStudio(page);
    await answerAll(page);
    await expect(page.locator(".riley")).toBeVisible();
    const controls = page.locator(
      ".studio-step-btn, .studio-action, .studio-view-btn, .studio-status, .riley-mute, .riley-tool",
    );
    const n = await controls.count();
    expect(n).toBeGreaterThan(10);
    for (let i = 0; i < n; i++) {
      const el = controls.nth(i);
      if (!(await el.isVisible())) continue;
      const box = await el.boundingBox();
      expect(box.width, `control ${i} width`).toBeGreaterThanOrEqual(44);
      expect(box.height, `control ${i} height`).toBeGreaterThanOrEqual(44);
    }
    expect(errors).toEqual([]);
  });
});

test.describe("design studio on a tablet", () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true });

  test("Riley's card sits under the room, not over the 3D view", async ({ page }) => {
    const errors = await openStudio(page);
    await answerAll(page);
    const riley = page.locator(".riley");
    await expect(riley).toBeVisible();
    const stage = await page.locator(".studio-stage").boundingBox();
    const card = await riley.boundingBox();
    expect(card.y).toBeGreaterThanOrEqual(stage.y + stage.height - 1);
    expect(errors).toEqual([]);
  });
});
