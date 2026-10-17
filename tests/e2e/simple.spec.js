"use strict";

const { test, expect } = require("@playwright/test");
const {
  openStudio,
  wait3d,
  answerAll,
  onScreen,
  step,
  byKey,
  studioStatus,
  studioToast,
  expectNoPlaceholders,
} = require("./helpers");

// The studio a first visit sees: the basics of each step, with the rest
// behind "More options", and an All options switch that brings every
// setting back (tests/e2e/studio.spec.js drives those).
test.describe("the simple studio", () => {
  const open = (page, url) => openStudio(page, url, { simple: true });

  test("opens with the basics, keeps the rest behind More options, and remembers All options", async ({ page }) => {
    const errors = await open(page);
    const mode = page.locator("#studio-mode");
    await expect(mode).not.toBeChecked();
    await expect(page.locator("#studio")).toHaveClass(/is-simple/);
    // The width and length are asked; the height waits behind the fold,
    // with the room's shape and windows.
    await expect(page.locator("#studio-size-w")).toBeVisible();
    await expect(page.locator("#studio-size-l")).toBeVisible();
    await expect(page.locator("#studio-size-h")).toBeHidden();
    const more = page.locator('.studio-more[data-more="room"]');
    await expect(more).toHaveCount(1);
    await expect(more).not.toHaveAttribute("open");
    await more.locator("summary").click();
    await expect(page.locator("#studio-size-h")).toBeVisible();
    await expect(byKey(page, "shape-L")).toBeVisible();
    // Opened once, the fold stays open while the step is redrawn.
    await byKey(page, "size-w-more").click();
    await expect(page.locator("#studio-size-h")).toBeVisible();
    // In the simple studio the steppers move by 6 inches, not an inch.
    await expect(page.locator("#studio-size-w")).toHaveValue("9′");
    await expect(byKey(page, "size-w-more")).toHaveAttribute("aria-label", /: 6 inches more$/);

    // All options lays every setting out, as it always did.
    await mode.check();
    await expect(page.locator("#studio")).not.toHaveClass(/is-simple/);
    await expect(page.locator(".studio-more")).toHaveCount(0);
    await expect(page.locator("#studio-size-h")).toBeVisible();
    await expect(byKey(page, "size-w-more")).toHaveAttribute("aria-label", /: 1 inch more$/);
    await expect(page.locator("#studio-live")).toContainText("Showing all options.");
    // The choice is remembered by this browser.
    await page.reload();
    await expect(page.locator(".studio-step-btn")).toHaveCount(6, { timeout: 20000 });
    await expect(page.locator("#studio-mode")).toBeChecked();
    await expect(page.locator("#studio-size-h")).toBeVisible();
    await page.locator("#studio-mode").uncheck();
    await expect(page.locator("#studio-size-h")).toBeHidden();
    await expect(page.locator("#studio-live")).toContainText("Showing the basics of each step.");
    expect(errors).toEqual([]);
  });

  test("the plumbing wall is a tap on the wall that says what's on it, the wall in 3D, or the suggested wall", async ({
    page,
  }) => {
    test.setTimeout(60000); // two rooms drawn in 3D
    const errors = await open(page);
    await wait3d(page);
    // Each wall is named by what stands on it, so "the toilet's wall" is a
    // tap, not a letter to look up on the plan.
    await expect(byKey(page, "stack-N")).toContainText("A");
    await expect(byKey(page, "stack-N")).toContainText("Vanity, Toilet");
    await expect(byKey(page, "stack-N")).toHaveAttribute("aria-label", "Wall A: Vanity, Toilet");
    await expect(byKey(page, "stack-E")).toContainText("Bathtub");
    await expect(byKey(page, "stack-S")).toContainText("Door");
    await expect(byKey(page, "stack-W")).toContainText("nothing on it yet");
    await expect(page.locator("[data-key^='stack-'][aria-pressed='true']")).toHaveCount(0);
    await expect(page.locator("#studio-step-need")).toHaveText("To go on: tap the wall your pipes are in.");
    // Over the room, the hint says so too, and a tap on wall A there answers it.
    await expect(page.locator("#studio-hint")).toContainText("Tap the wall your pipes are in.");
    const room = await page.evaluate(() => window.RoomStudio.design().room);
    const at = await onScreen(page, room.w / 2, room.h * 0.8, 0.02);
    await page.mouse.click(at.x, at.y);
    await expect(studioToast(page)).toContainText("Plumbing wall: A");
    await expect(byKey(page, "stack-N")).toHaveAttribute("aria-pressed", "true");
    await expect(byKey(page, "suggest-stack")).toHaveCount(0);
    await expect(page.locator("#studio-step-need")).toHaveCount(0);
    await expect(page.locator("#studio-hint")).not.toContainText("Tap the wall your pipes are in.");

    // A new room asks again; "Not sure?" takes the wall the room suggests
    // (the least pipe).
    await byKey(page, "tpl-full5x8").click();
    await expect(page.locator("#studio-step-need")).toHaveText("To go on: tap the wall your pipes are in.");
    await expect(byKey(page, "suggest-stack")).toHaveText(/Not sure\? Use wall A/);
    await byKey(page, "suggest-stack").click();
    await expect(byKey(page, "stack-N")).toHaveAttribute("aria-pressed", "true");
    await expect(byKey(page, "suggest-stack")).toHaveCount(0);
    await expect(page.locator("#studio-step-need")).toHaveCount(0);
    // Answered, the room step gets its check mark once it's left.
    await byKey(page, "nav-next").click();
    await expect(page.locator(".studio-step.is-layout")).toBeVisible();
    await expect(step(page, "room")).toHaveClass(/is-done/);
    await expect(step(page, "room").locator(".studio-step-donetext")).toHaveText(/done/);
    await expect(step(page, "layout")).not.toHaveClass(/is-done/);
    expect(errors).toEqual([]);
  });

  test("layout has one button: Fix it for me when something doesn't fit, Try another layout when all does", async ({
    page,
  }) => {
    const errors = await open(page);
    await answerAll(page);
    await step(page, "layout").click();
    const arrange = byKey(page, "arrange");
    await expect(arrange).toHaveText(/Try another layout/);
    await expect(arrange).toHaveClass(/btn-secondary/);
    // The toilet moved onto the tub's wall has no spot there.
    await byKey(page, "item-f3").click();
    await byKey(page, "insp-f3-wall-E").click();
    await expect(studioToast(page)).toContainText("Toilet: no spot on wall B fits it");
    await expect(studioStatus(page)).toHaveClass(/is-error/);
    await expect(arrange).toHaveText(/Fix it for me/);
    await expect(arrange).toHaveClass(/btn-primary/);
    // A fixture's gaps are details, folded away.
    await expect(page.locator('.studio-more[data-more="insp-f3"]')).toHaveCount(1);
    await expect(page.locator(".studio-gaps")).toBeHidden();
    await arrange.click();
    await expect(studioToast(page)).toContainText("Room arranged.");
    await expect(studioStatus(page)).not.toHaveClass(/is-error/);
    await expect(arrange).toHaveText(/Try another layout/);
    // Which, like before, offers the layouts that fit.
    await arrange.click();
    await expect(page.locator(".studio-arrangement").first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".studio-arrangement.is-current")).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test("electrical says what's done; products are kept or changed by picture, and Keep moves to the next list", async ({
    page,
  }) => {
    test.setTimeout(90000); // a pick in each of the sample room's product lists loads its model
    const errors = await open(page);
    await wait3d(page);
    await byKey(page, "suggest-stack").click();
    await step(page, "electrical").click();
    const done = page.locator('[data-testid="elec-done"]');
    await expect(done).toContainText("Done for you:");
    await expect(done).toContainText(/\d outlets?, \d switch(es)?, \d lights?, 1 fan, placed where the rules say\./);
    await expect(done).not.toHaveClass(/is-empty/);

    await step(page, "products").click();
    const progress = page.locator('[data-testid="products-progress"]');
    await expect(progress).toHaveText("0 of 14 picked");
    const waiting = page.locator('.studio-pick[data-picked="false"]');
    await expect(waiting).toHaveCount(14);
    // Each list shows what's in the room now, with its picture, and says so.
    const first = waiting.first();
    await expect(first.locator(".studio-pick-state")).toContainText("Shown now");
    await expect(first.locator(".studio-thumb")).toBeVisible();
    await expect(first.locator(".studio-pick-keep")).toHaveText(/Keep/);
    await expect(first.locator(".studio-pick-change")).toHaveText(/Change/);
    const firstSlot = await first.getAttribute("data-slot");
    // Keep counts, marks the list, and moves on to the next one waiting.
    await first.locator(".studio-pick-keep").click();
    await expect(progress).toHaveText("1 of 14 picked");
    await expect(page.locator(`.studio-pick[data-slot="${firstSlot}"]`)).toHaveAttribute("data-picked", "true");
    await expect(page.locator(`.studio-pick[data-slot="${firstSlot}"] .studio-pick-state`)).toContainText("Picked");
    await expect(page.locator(`.studio-pick[data-slot="${firstSlot}"] .studio-pick-keep`)).toHaveCount(0);
    const nextSlot = await waiting.first().getAttribute("data-slot");
    await expect(page.locator(":focus")).toHaveAttribute("data-key", `keep-${nextSlot}`);
    // Change opens the choices as pictures; one picked closes them.
    await waiting.first().locator(".studio-pick-change").click();
    await expect(waiting.first().locator(".studio-pick-change")).toHaveAttribute("aria-expanded", "true");
    await expect(waiting.first().locator(".studio-pick-change")).toHaveText(/Close the choices/);
    const options = page.locator(".studio-option");
    await expect(options.first()).toBeVisible();
    await expect(page.locator(".studio-option[aria-pressed='true']")).toHaveCount(1);
    await expect(options.first().locator(".studio-thumb")).toBeVisible();
    const other = page.locator(".studio-option:not([disabled])[aria-pressed='false']").first();
    const otherName = await other.locator(".studio-option-name").innerText();
    await other.click();
    await expect(page.locator(".studio-option")).toHaveCount(0);
    await expect(progress).toHaveText("2 of 14 picked");
    const changed = page.locator(`.studio-pick[data-slot="${nextSlot}"]`);
    await expect(changed).toHaveAttribute("data-picked", "true");
    await expect(changed.locator(".studio-pick-name")).toHaveText(otherName);
    // Keep on each list left finishes the step.
    while (await waiting.count()) await waiting.first().locator(".studio-pick-keep").click();
    await expect(progress).toHaveText("All picked. Change any of them whenever you like.");
    await expect(progress).toHaveClass(/is-done/);
    await byKey(page, "nav-next").click();
    await expect(page.locator(".studio-step.is-finishes")).toBeVisible();
    await expect(step(page, "products")).toHaveClass(/is-done/);
    expect(errors).toEqual([]);
  });

  test("the door is a tap on its wall; sliding it and a second door wait under More options", async ({ page }) => {
    const errors = await open(page);
    await wait3d(page);
    const picker = page.locator('[data-key^="door-wall-"]');
    await expect(picker).toHaveCount(4);
    await expect(byKey(page, "door-wall-S")).toHaveAttribute("aria-pressed", "true");
    // The door's own wall says so; the others say what else stands there.
    await expect(byKey(page, "door-wall-S")).toContainText("Door");
    await expect(byKey(page, "door-wall-N")).toContainText("Vanity, Toilet");
    await expect(byKey(page, "door-wall-W")).toContainText("nothing on it yet");
    await byKey(page, "door-wall-W").click();
    await expect(byKey(page, "door-wall-W")).toHaveAttribute("aria-pressed", "true");
    await expect(byKey(page, "door-wall-W")).toContainText("Door");
    await expect(byKey(page, "door-wall-S")).toContainText("nothing on it yet");
    await expect(page.locator(".studio-step.is-room")).toContainText("On wall D");
    await expect(studioStatus(page)).toHaveText("Everything fits");
    // The full door card (its position, type, Add another door) is folded.
    await expect(byKey(page, "door-add")).toBeHidden();
    await page.locator('.studio-more[data-more="room"] > summary').click();
    await expect(byKey(page, "door-add")).toBeVisible();
    await expect(page.locator('.studio-more[data-more="room"] [data-key$="-wall-W"][aria-pressed="true"]')).toHaveCount(
      1,
    );
    expect(errors).toEqual([]);
  });

  test("a fixture only goes in where it fits: the room is rearranged for it, or it isn't added", async ({ page }) => {
    const errors = await open(page);
    await answerAll(page);
    await step(page, "layout").click();
    // A second toilet fits the sample bath once the rest moves over.
    await byKey(page, "add-toilet").click();
    await expect(studioToast(page)).toContainText("Toilet 2 added; the rest moved over to make room.");
    await expect(page.locator(".studio-item-btn")).toHaveCount(4);
    await expect(studioStatus(page)).not.toHaveClass(/is-error/);
    await page.keyboard.press("Control+z");
    await expect(page.locator(".studio-item-btn")).toHaveCount(3);
    // A shower has no room in it however the rest is arranged: it stays out.
    await byKey(page, "add-shower").click();
    await expect(studioToast(page)).toContainText("Shower: no room for it here, even after moving things around.");
    await expect(page.locator(".studio-item-btn")).toHaveCount(3);
    await expect(studioStatus(page)).not.toHaveClass(/is-error/);
    expect(errors).toEqual([]);
  });

  test("a new size moves the fixtures to fit; when nothing fits, Fix it for me takes out what has no room", async ({
    page,
  }) => {
    const errors = await open(page);
    await answerAll(page);
    // Six inches narrower, the tub and vanity would collide: they're moved.
    await byKey(page, "size-w-less").click();
    await expect(page.locator("#studio-size-w")).toHaveValue("8′");
    await expect(studioToast(page)).toContainText("The fixtures moved to fit the new size.");
    await expect(studioStatus(page)).not.toHaveClass(/is-error/);
    // A foot narrower still, nothing can fit the tub: the note offers the fix.
    await byKey(page, "size-w-less").click();
    await expect(page.locator("#studio-size-w")).toHaveValue("7′ 6″");
    await expect(studioStatus(page)).toHaveClass(/is-error/);
    await expect(studioToast(page)).toContainText("With the new size, some fixtures don't fit anymore.");
    await studioToast(page).getByRole("button", { name: "Fix it for me" }).click();
    await expect(studioToast(page)).toContainText("Arranged, and took out Bathtub: there's no room for it.");
    await expect(studioStatus(page)).not.toHaveClass(/is-error/);
    await step(page, "layout").click();
    await expect(page.locator(".studio-item-btn")).toHaveCount(2);
    // Undo brings the tub back, red, with its wiring.
    await page.keyboard.press("Control+z");
    await expect(page.locator(".studio-item-btn")).toHaveCount(3);
    await expect(studioStatus(page)).toHaveClass(/is-error/);
    expect(errors).toEqual([]);
  });

  test("a note about one step doesn't follow onto the next, and a reload comes back to the same step", async ({
    page,
  }) => {
    const errors = await open(page);
    await wait3d(page);
    await byKey(page, "nav-next").click();
    await expect(studioToast(page)).toBeVisible();
    await expect(studioToast(page)).toContainText("To go on: tap the wall your pipes are in.");
    await byKey(page, "suggest-stack").click();
    await byKey(page, "nav-next").click();
    await expect(page.locator(".studio-step.is-layout")).toBeVisible();
    await expect(studioToast(page)).toBeHidden();
    await byKey(page, "nav-next").click();
    await expect(page.locator(".studio-step.is-electrical")).toBeVisible();
    await page.reload();
    await expect(page.locator(".studio-step-btn")).toHaveCount(6, { timeout: 20000 });
    await expect(page.locator(".studio-step.is-electrical")).toBeVisible();
    await expect(studioToast(page)).toContainText("Here's the design you were working on.");
    expect(errors).toEqual([]);
  });

  for (const [lang, keep] of [
    ["es", "Dejar"],
    ["pt", "Manter"],
  ]) {
    test(`in ${lang} every step of the simple studio reads in its language, with nothing unfilled`, async ({
      page,
    }) => {
      const errors = await open(page, `/${lang}/designer.html`);
      await wait3d(page);
      await expectNoPlaceholders(page);
      await byKey(page, "suggest-stack").click();
      await expectNoPlaceholders(page);
      for (const name of ["layout", "electrical", "products"]) {
        await step(page, name).click();
        await expect(page.locator(`.studio-step.is-${name}`)).toBeVisible();
        await expectNoPlaceholders(page);
      }
      await expect(page.locator(".studio-pick-keep").first()).toHaveText(new RegExp(keep));
      await expect(page.locator("#studio-mode")).not.toBeChecked();
      expect(errors).toEqual([]);
    });
  }
});
