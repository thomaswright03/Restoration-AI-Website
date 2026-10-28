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
  pickTemplate,
} = require("./helpers");

// The studio a first visit sees: the basics of each step, with the rest
// behind "More options", and an All options switch that brings every
// setting back (tests/e2e/studio.spec.js drives those).
test.describe("the simple studio", () => {
  const open = (page, url) => openStudio(page, url, { simple: true });
  const question = (page) => page.locator(".studio-question");
  // Next through the Room step's first question (the size) to the pipes.
  const toPipes = async (page) => {
    await byKey(page, "nav-next").click();
    await expect(question(page)).toHaveAttribute("data-question", "pipes");
  };

  test("opens with the basics, keeps the rest behind More options, and remembers All options", async ({ page }) => {
    const errors = await open(page);
    const mode = page.locator("#studio-mode");
    await expect(mode).not.toBeChecked();
    await expect(page.locator("#studio")).toHaveClass(/is-simple/);
    // The width and length are asked; the height waits behind the fold,
    // with the room's shape.
    await expect(page.locator("#studio-size-w")).toBeVisible();
    await expect(page.locator("#studio-size-l")).toBeVisible();
    await expect(page.locator("#studio-size-h")).toBeHidden();
    const more = page.locator('.studio-more[data-more="roomSize"]');
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
    await expect(page.locator(".studio-more:not(.studio-templates-fold)")).toHaveCount(0);
    // Every question of the step at once, with no Question 1 of 3.
    await expect(page.locator(".studio-question")).toHaveCount(0);
    await expect(byKey(page, "stack-N")).toBeVisible();
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
    await toPipes(page);
    // Each wall is named by what stands on it, so "the toilet's wall" is a
    // tap, not a letter to look up on the plan.
    await expect(byKey(page, "stack-N")).toContainText("A");
    await expect(byKey(page, "stack-N")).toContainText("Vanity, Toilet");
    await expect(byKey(page, "stack-N")).toHaveAttribute("aria-label", "Wall A: Vanity, Toilet");
    await expect(byKey(page, "stack-E")).toContainText("Bathtub");
    await expect(byKey(page, "stack-S")).toContainText("Door");
    await expect(byKey(page, "stack-W")).toContainText("nothing on it yet");
    await expect(page.locator("[data-key^='stack-'][aria-pressed='true']")).toHaveCount(0);
    // No wall is marked as having the pipes until one is picked.
    await expect(page.locator(".studio-wall-pipes")).toHaveCount(0);
    await expect(page.locator(".plan-stack")).toHaveCount(0);
    expect(await page.evaluate(() => window.BathroomRoom3D.getPipes())).toEqual([]);
    await expect(page.locator("#studio-step-need")).toHaveText("To go on: tap the walls your pipes are in.");
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
    // The wall with the pipes is marked: a Pipes tag on its button, pipe
    // blue on the plan and pipes on that wall in the 3D room.
    await expect(byKey(page, "stack-N").locator(".studio-wall-pipes")).toHaveText("Pipes");
    await expect(page.locator(".studio-wall-pipes")).toHaveCount(1);
    await expect(page.locator('.studio-wall-plan .plan-stack[data-wall="N"]')).toHaveCount(1);
    expect(await page.evaluate(() => window.BathroomRoom3D.getPipes())).toEqual(["N"]);

    // A new room (back on the size question) asks again; "Not sure?" takes
    // the wall the room suggests (the least pipe).
    await byKey(page, "nav-prev").click();
    await expect(question(page)).toHaveAttribute("data-question", "size");
    await pickTemplate(page, "full5x8");
    await toPipes(page);
    await expect(page.locator("#studio-step-need")).toHaveText("To go on: tap the walls your pipes are in.");
    expect(await page.evaluate(() => window.BathroomRoom3D.getPipes())).toEqual([]);
    await expect(byKey(page, "suggest-stack")).toHaveText(/Not sure\? Use wall A/);
    await byKey(page, "suggest-stack").click();
    await expect(byKey(page, "stack-N")).toHaveAttribute("aria-pressed", "true");
    await expect(byKey(page, "suggest-stack")).toHaveCount(0);
    await expect(page.locator("#studio-step-need")).toHaveCount(0);
    // Pipes in more than one wall: a tap adds one, a second tap takes it off.
    await byKey(page, "stack-E").click();
    await expect(byKey(page, "stack-N")).toHaveAttribute("aria-pressed", "true");
    await expect(byKey(page, "stack-E")).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => window.RoomPlan.stackWalls(window.RoomStudio.design()))).toEqual(["N", "E"]);
    await expect(page.locator(".studio-wall-pipes")).toHaveCount(2);
    expect(await page.evaluate(() => window.BathroomRoom3D.getPipes())).toEqual(["N", "E"]);
    await byKey(page, "stack-E").click();
    await expect(byKey(page, "stack-E")).toHaveAttribute("aria-pressed", "false");
    await expect(byKey(page, "stack-E").locator(".studio-wall-pipes")).toHaveCount(0);
    // Answered, the room step gets its check mark once it's left (past
    // its last question, the door).
    await byKey(page, "nav-next").click();
    await expect(question(page)).toHaveAttribute("data-question", "door");
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

  test("electrical says what's done; products are asked one list at a time, kept or changed by picture", async ({
    page,
  }) => {
    test.setTimeout(240000); // a pick in each of the sample room's product lists loads its model
    const errors = await open(page);
    await wait3d(page);
    await toPipes(page);
    await byKey(page, "suggest-stack").click();
    await step(page, "electrical").click();
    const done = page.locator('[data-testid="elec-done"]');
    await expect(done).toContainText("Done for you:");
    await expect(done).toContainText(/\d outlets?, \d switch(es)?, \d lights?, 1 fan, placed where the rules say\./);
    await expect(done).not.toHaveClass(/is-empty/);

    await step(page, "products").click();
    const progress = page.locator('[data-testid="products-progress"]');
    await expect(progress).toHaveText("0 of 14 picked");
    // One list at a time.
    await expect(page.locator(".studio-pick")).toHaveCount(1);
    await expect(page.locator(".studio-q-count")).toHaveText("Question 1 of 14");
    const pick = page.locator(".studio-pick");
    // The list shows what's in the room now, with its picture, and says so.
    await expect(pick.locator(".studio-pick-state")).toContainText("Shown now");
    await expect(pick.locator(".studio-thumb")).toBeVisible();
    await expect(pick.locator(".studio-pick-keep")).toHaveText(/Keep/);
    await expect(pick.locator(".studio-pick-change")).toHaveText(/Change/);
    // Next waits for a pick.
    await expect(byKey(page, "nav-next")).toHaveText("Next");
    const firstSlot = await pick.getAttribute("data-slot");
    await byKey(page, "nav-next").click();
    await expect(page.locator(".studio-q-count")).toHaveText("Question 1 of 14");
    await expect(studioToast(page)).toContainText("To go on: pick a product for:");
    // Keep counts and goes on to the next list.
    await pick.locator(".studio-pick-keep").click();
    await expect(progress).toHaveText("1 of 14 picked");
    await expect(page.locator(".studio-q-count")).toHaveText("Question 2 of 14");
    const nextSlot = await pick.getAttribute("data-slot");
    expect(nextSlot).not.toBe(firstSlot);
    await expect(page.locator(":focus")).toHaveAttribute("data-key", `keep-${nextSlot}`);
    // Back shows the first one again, picked.
    await byKey(page, "nav-prev").click();
    await expect(page.locator(`.studio-pick[data-slot="${firstSlot}"]`)).toHaveAttribute("data-picked", "true");
    await expect(page.locator(`.studio-pick[data-slot="${firstSlot}"] .studio-pick-state`)).toContainText("Picked");
    await byKey(page, "nav-next").click();
    // Change opens the choices as pictures; one picked closes them and
    // stays on the list, for Next.
    await pick.locator(".studio-pick-change").click();
    await expect(pick.locator(".studio-pick-change")).toHaveAttribute("aria-expanded", "true");
    await expect(pick.locator(".studio-pick-change")).toHaveText(/Close the choices/);
    const options = page.locator(".studio-option");
    await expect(options.first()).toBeVisible();
    await expect(page.locator(".studio-option[aria-pressed='true']")).toHaveCount(1);
    await expect(options.first().locator(".studio-thumb")).toBeVisible();
    const other = page.locator(".studio-option:not([disabled])[aria-pressed='false']").first();
    const otherName = await other.locator(".studio-option-name").innerText();
    await other.click();
    await expect(page.locator(".studio-option")).toHaveCount(0);
    await expect(progress).toHaveText("2 of 14 picked");
    await expect(pick).toHaveAttribute("data-slot", nextSlot);
    await expect(pick).toHaveAttribute("data-picked", "true");
    await expect(pick.locator(".studio-pick-name")).toHaveText(otherName);
    await byKey(page, "nav-next").click();
    await expect(page.locator(".studio-q-count")).toHaveText("Question 3 of 14");
    // Keep on each list left finishes the step.
    while ((await page.locator('.studio-pick[data-picked="false"]').count()) > 0)
      await page.locator(".studio-pick-keep").click();
    await expect(page.locator(".studio-q-count")).toHaveText("Question 14 of 14");
    await expect(progress).toHaveText("All picked. Change any of them whenever you like.");
    await expect(progress).toHaveClass(/is-done/);
    await expect(byKey(page, "nav-next")).toHaveText("Next: Finishes");
    await byKey(page, "nav-next").click();
    await expect(page.locator(".studio-step.is-finishes")).toBeVisible();
    await expect(step(page, "products")).toHaveClass(/is-done/);
    expect(errors).toEqual([]);
  });

  test("every question comes one at a time: Next shows the next, Back the one before, across steps", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const errors = await open(page);
    await wait3d(page);
    // The Room step opens with only the size.
    await expect(question(page)).toHaveCount(1);
    await expect(question(page)).toHaveAttribute("data-question", "size");
    await expect(page.locator(".studio-q-count")).toHaveText("Question 1 of 3");
    await expect(page.locator(".studio-q-title")).toHaveText("What are the dimensions of the bathroom?");
    await expect(page.locator("#studio-size-w")).toBeVisible();
    await expect(page.locator('[data-key^="stack-"]')).toHaveCount(0);
    await expect(page.locator('[data-key^="door-wall-"]')).toHaveCount(0);
    // "Pick a bathroom like yours" comes after the size, folded.
    const fold = page.locator(".studio-templates-fold");
    await expect(fold).not.toHaveAttribute("open");
    await expect(fold.locator("summary")).toHaveText("Pick a bathroom like yours");
    await expect(byKey(page, "tpl-full5x8")).toBeHidden();
    const order = await page.evaluate(() => {
      const size = document.querySelector(".studio-question");
      const tpl = document.querySelector(".studio-templates-fold");
      return size.compareDocumentPosition(tpl) & Node.DOCUMENT_POSITION_FOLLOWING;
    });
    expect(order).toBeTruthy();
    await expect(byKey(page, "nav-prev")).toHaveCount(0);
    await expect(byKey(page, "nav-next")).toHaveText("Next");
    // Next: the size goes away and the pipes are asked, then the door.
    await byKey(page, "nav-next").click();
    await expect(question(page)).toHaveAttribute("data-question", "pipes");
    await expect(page.locator(".studio-q-count")).toHaveText("Question 2 of 3");
    await expect(page.locator(":focus")).toHaveClass(/studio-q-title/);
    await expect(page.locator("#studio-size-w")).toHaveCount(0);
    await expect(page.locator("#studio-hint")).toContainText("Tap the wall your pipes are in.");
    // Unanswered, Next stays and says what it needs.
    await byKey(page, "nav-next").click();
    await expect(question(page)).toHaveAttribute("data-question", "pipes");
    await expect(studioToast(page)).toContainText("To go on: tap the walls your pipes are in.");
    await byKey(page, "suggest-stack").click();
    await byKey(page, "nav-next").click();
    await expect(question(page)).toHaveAttribute("data-question", "door");
    await expect(page.locator(".studio-q-count")).toHaveText("Question 3 of 3");
    await expect(byKey(page, "nav-next")).toHaveText("Next: Layout");
    await expect(byKey(page, "nav-prev")).toHaveText("Back");
    await byKey(page, "nav-next").click();
    await expect(page.locator(".studio-step.is-layout")).toBeVisible();
    // Back from the next step lands on the Room step's last question.
    await byKey(page, "nav-prev").click();
    await expect(question(page)).toHaveAttribute("data-question", "door");
    // The stepper opens a step at its first question.
    await step(page, "room").click();
    await expect(question(page)).toHaveAttribute("data-question", "door");
    await step(page, "layout").click();
    await step(page, "room").click();
    await expect(question(page)).toHaveAttribute("data-question", "size");

    // Finishes asks the floor, the walls, then the ceiling. Going there with
    // the product lists unanswered (a locked step, so the click is sent
    // straight to it) goes to the first list waiting.
    await step(page, "finishes").dispatchEvent("click");
    await expect(page.locator(".studio-step.is-products")).toBeVisible();
    await expect(page.locator(".studio-q-count")).toHaveText("Question 1 of 14");
    await answerAll(page);
    await step(page, "finishes").click();
    await expect(question(page)).toHaveAttribute("data-question", "floor");
    await expect(page.locator(".studio-q-count")).toHaveText("Question 1 of 3");
    await expect(byKey(page, "fin-walls-paint")).toHaveCount(0);
    await byKey(page, "nav-next").click();
    await expect(question(page)).toHaveAttribute("data-question", "walls");
    await expect(byKey(page, "fin-floor-tile")).toHaveCount(0);
    await byKey(page, "nav-next").click();
    await expect(question(page)).toHaveAttribute("data-question", "ceiling");
    await expect(page.locator('.studio-more[data-more="finishes"]')).toHaveCount(1);
    await expect(byKey(page, "nav-next")).toHaveText(/^Next: /);
    await byKey(page, "nav-next").click();
    await expect(page.locator(".studio-step.is-estimate")).toBeVisible();
    await expectNoPlaceholders(page);
    expect(errors).toEqual([]);
  });

  test("the door is a tap on its wall; sliding it and a second door wait under More options", async ({ page }) => {
    const errors = await open(page);
    await wait3d(page);
    await toPipes(page);
    await byKey(page, "suggest-stack").click();
    await byKey(page, "nav-next").click();
    await expect(question(page)).toHaveAttribute("data-question", "door");
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
    await toPipes(page);
    await byKey(page, "nav-next").click();
    await expect(studioToast(page)).toBeVisible();
    await expect(studioToast(page)).toContainText("To go on: tap the walls your pipes are in.");
    await byKey(page, "suggest-stack").click();
    await byKey(page, "nav-next").click();
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
      await byKey(page, "nav-next").click();
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

test.describe("the simple studio on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the first screen shows Riley's whole message, the size question, Next and a short demo button", async ({
    page,
  }) => {
    const errors = await openStudio(page, "/designer.html", { simple: true });
    const title = page.locator(".studio-q-title");
    await expect(title).toHaveText("What are the dimensions of the bathroom?");
    const seen = await page.evaluate(() => {
      const text = document.querySelector(".riley-text");
      const btn = document.querySelector(".designer-intro .btn");
      const line = parseFloat(getComputedStyle(btn).lineHeight) || 20;
      return {
        clipped: text.scrollHeight > text.clientHeight + 1,
        questionBottom: document.querySelector(".studio-q-title").getBoundingClientRect().bottom,
        nextBottom: document.querySelector('[data-key="nav-next"]').getBoundingClientRect().bottom,
        btnLines: btn.getBoundingClientRect().height / line,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    expect(seen.clipped, "Riley's text is clipped").toBe(false);
    expect(seen.questionBottom, "the size question is on the first screen").toBeLessThanOrEqual(844);
    expect(seen.nextBottom, "Next is on the first screen").toBeLessThanOrEqual(844);
    expect(seen.btnLines, "the demo button is at most two lines").toBeLessThanOrEqual(2.5);
    expect(seen.scrollWidth).toBeLessThanOrEqual(390);
    expect(errors).toEqual([]);
  });
});
