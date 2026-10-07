"use strict";

const { test, expect } = require("@playwright/test");
const { useConfig, openStudio, wait3d, step, byKey, studioStatus, studioToast } = require("./helpers");

test.describe("design studio", () => {
  test("opens on the sample full bath, drawn in 3D, with everything fitting and a price", async ({ page }) => {
    const errors = await openStudio(page);
    await wait3d(page);
    await expect(page.locator("#room-3d-canvas canvas")).toBeVisible();
    await expect(studioStatus(page)).toHaveText("Everything fits");
    await expect(page.locator(".studio-total-chip strong")).toContainText("$");
    await expect(page.locator(".studio-biz")).toHaveText("Sample Remodeling Co.");
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
    await byKey(page, "tpl-primary").click();
    await expect(studioToast(page)).toContainText("Started from: Primary bath.");
    await expect(page.locator("#studio-size-w")).toHaveValue("11′");
    await expect(studioStatus(page)).toHaveText("Everything fits");
    await studioToast(page).getByRole("button", { name: "Undo" }).click();
    await expect(page.locator("#studio-size-w")).toHaveValue("8′");
    await page.locator(".studio-action", { hasText: "Redo" }).click();
    await expect(page.locator("#studio-size-w")).toHaveValue("11′");
    expect(errors).toEqual([]);
  });

  test("a fixture is added where it fits; one with no room is shown as not fitting until it's undone", async ({
    page,
  }) => {
    const errors = await openStudio(page);
    await step(page, "layout").click();
    await byKey(page, "add-shower").click();
    await expect(studioToast(page)).toContainText("Shower added, but there's no free spot where it fits");
    await expect(studioStatus(page)).toHaveClass(/is-error/);
    await expect(page.locator(".studio-issues").first()).toBeVisible();
    await expect(page.locator(".studio-item-btn")).toHaveCount(4);
    await page.keyboard.press("Control+z");
    await expect(studioStatus(page)).toHaveText("Everything fits");
    await expect(page.locator(".studio-item-btn")).toHaveCount(3);

    // The 11 x 9 primary bath has room for another toilet.
    await step(page, "room").click();
    await byKey(page, "tpl-primary").click();
    await step(page, "layout").click();
    await byKey(page, "add-toilet").click();
    await expect(studioToast(page)).toContainText(/Toilet 2 added on wall [ABCD]\./);
    await expect(page.locator(".studio-item-btn")).toHaveCount(7);
    await expect(studioStatus(page)).not.toHaveClass(/is-error/);
    expect(errors).toEqual([]);
  });

  test("a fixture can be moved to another wall, removed, and put back with Undo", async ({ page }) => {
    const errors = await openStudio(page);
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
    await step(page, "layout").click();
    // In the 8 x 5 full bath, the layout it has is the only one that works.
    await byKey(page, "arrange").click();
    await expect(page.locator(".studio-arrangement")).toHaveCount(1, { timeout: 15000 });
    await expect(page.locator(".studio-arrangement")).toHaveClass(/is-current/);
    await expect(page.locator(".studio-step.is-layout")).toContainText("the only one where everything fits");

    await step(page, "room").click();
    await byKey(page, "tpl-showerBath").click();
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
    await page.locator('.studio-view-btn[data-view="plan"]').click();
    await expect(page.locator("#studio-plan")).toBeVisible();
    await expect(page.locator("#room-3d")).toBeHidden();
    const toilet = page.locator('#studio-plan .plan-item[data-id="f3"]');
    await expect(toilet).toHaveAttribute("aria-label", "Toilet on wall A, center 3′ 6″ from the left corner");
    await toilet.click();
    await expect(toilet).toBeFocused();
    await page.keyboard.press("Shift+ArrowRight");
    await expect(toilet).toHaveAttribute("aria-label", "Toilet on wall A, center 4′ from the left corner");
    await page.keyboard.press("ArrowLeft");
    await expect(toilet).toHaveAttribute("aria-label", "Toilet on wall A, center 3′ 11″ from the left corner");
    await page.keyboard.press("Control+z");
    await expect(toilet).toHaveAttribute("aria-label", "Toilet on wall A, center 3′ 6″ from the left corner");
    await page.keyboard.press("Escape");
    await expect(page.locator("#studio-selchip")).toBeHidden();
    expect(errors).toEqual([]);
  });

  test("in 3D, a fixture dragged onto another goes back and says why; dragged to free floor, it moves", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const errors = await openStudio(page);
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
    await expect(studioStatus(page)).toHaveText("Everything fits");
    await expect(page.locator("#studio-selchip")).toContainText("Toilet");

    // 9 in. to the right along wall A, where there's free floor.
    const shift = await page.evaluate(() => {
      const a = window.BathroomRoom3D.project(3.5, 1, 1.2);
      const b = window.BathroomRoom3D.project(4.25, 1, 1.2);
      return { x: b.x - a.x, y: b.y - a.y };
    });
    const from = await point("f3");
    await drag(from, { x: from.x + shift.x, y: from.y + shift.y });
    await step(page, "layout").click();
    await expect(byKey(page, "item-f3")).toContainText("Wall A");
    await expect(byKey(page, "item-f3")).not.toContainText("3′ 6″ from the left");
    await expect(studioStatus(page)).not.toHaveClass(/is-error/);
    expect(errors).toEqual([]);
  });

  test("walk-in stands inside the doorway, and the room view comes back", async ({ page }) => {
    const errors = await openStudio(page);
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

  test("finishes change the room and the price", async ({ page }) => {
    const errors = await openStudio(page);
    const total = page.locator(".studio-total-chip strong");
    await expect(total).toContainText("$");
    await step(page, "finishes").click();
    const before = await total.innerText();
    await byKey(page, "fin-walls-tile").click();
    await expect(byKey(page, "fin-walls-tile")).toHaveAttribute("aria-pressed", "true");
    await expect(total).not.toHaveText(before);
    const tiled = await total.innerText();
    await page.locator("#studio-fin-demo").uncheck();
    await expect(total).not.toHaveText(tiled);
    expect(errors).toEqual([]);
  });

  test("the estimate lists the work, fills in the request, downloads a PDF and shares a link", async ({
    browser,
    page,
  }) => {
    test.setTimeout(60000);
    const errors = await openStudio(page);
    await step(page, "estimate").click();
    await expect(page.getByTestId("estimate-card")).toBeVisible();
    const total = await page.getByTestId("estimate-total").innerText();
    expect(total).toMatch(/^\$[\d,]+\.\d\d$/);
    await expect(page.locator(".studio-total-chip strong")).toHaveText(total);

    const message = await page.locator("#message").inputValue();
    expect(message).toContain("Room: 8′ × 5′");
    expect(message).toContain("Toilet: wall A");
    expect(message).toContain("#design=");
    await expect(page.locator("#lead-form")).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent("download"), byKey(page, "pdf").click()]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);

    // No clipboard: the link shows in a box to copy by hand.
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }));
    await byKey(page, "share").click();
    await expect(page.locator("#studio-link-dialog")).toBeVisible();
    const link = await page.locator("#studio-link-input").inputValue();
    expect(link).toContain("/designer.html#design=");
    await page.locator("#studio-link-dialog [data-close]").click();

    const other = await browser.newPage();
    await other.goto(link);
    await expect(other.locator("#studio-toast")).toContainText("Here's the design from your link.");
    await expect(other.locator("#studio-size-w")).toHaveValue("8′");
    await expect(other).not.toHaveURL(/#design=/);
    await other.close();
    expect(errors).toEqual([]);
  });

  test("the design is still there after a reload, and Start over begins again", async ({ page }) => {
    const errors = await openStudio(page);
    await page.locator("#studio-size-w").fill("9");
    await page.locator("#studio-size-w").press("Enter");
    await expect(page.locator("#studio-size-w")).toHaveValue("9′");
    await page.reload();
    await expect(page.locator("#studio-size-w")).toHaveValue("9′");
    await expect(studioToast(page)).toContainText("Here's the design you were working on.");
    await studioToast(page).getByRole("button", { name: "Start over" }).click();
    await expect(page.locator("#studio-size-w")).toHaveValue("8′");
    expect(errors).toEqual([]);
  });

  test("without the price estimator, the last step sends the design without prices", async ({ page }) => {
    await useConfig(page, { priceEstimator: { enabled: false } });
    const errors = await openStudio(page);
    await expect(step(page, "estimate")).toContainText("Send");
    await expect(page.locator(".studio-total-chip")).toBeHidden();
    await step(page, "estimate").click();
    await expect(page.getByTestId("estimate-total")).toHaveCount(0);
    await expect(page.locator("#lead-form")).toBeVisible();
    expect(errors).toEqual([]);
  });

  for (const [dir, lang, labels, fits] of [
    ["es", "es", ["Baño", "Distribución", "Productos", "Acabados", "Estimación"], "Todo cabe"],
    ["pt", "pt", ["Banheiro", "Distribuição", "Produtos", "Acabamentos", "Estimativa"], "Tudo cabe"],
  ]) {
    test(`/${dir}/designer.html runs the studio in that language`, async ({ page }) => {
      const errors = await openStudio(page, `/${dir}/designer.html?lang=${lang}`);
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
});
