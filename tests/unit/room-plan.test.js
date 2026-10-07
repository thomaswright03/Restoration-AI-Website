"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../../js/room-plan.js");

function design(room, items) {
  const d = P.emptyDesign(room.w, room.l, room.h || 8);
  d.items = items.map((it, i) => Object.assign({ id: it.id || "x" + i, opts: P.defaultOpts(it.type) }, it));
  return d;
}

function errors(d, id) {
  return P.errorsOf(P.validate(d, {}), id).map((x) => x.code);
}

test("lengths read the ways people type them, in feet", () => {
  assert.equal(P.parseLength("5"), 5);
  assert.equal(P.parseLength("5.5"), 5.5);
  assert.equal(P.parseLength("5,5"), 5.5);
  assert.equal(P.parseLength("5'6"), 5.5);
  assert.equal(P.parseLength(`5' 6"`), 5.5);
  assert.equal(P.parseLength("5 6"), 5.5);
  assert.equal(P.parseLength("5ft 6in"), 5.5);
  assert.equal(P.parseLength("66in"), 5.5);
  assert.equal(P.parseLength(`66"`), 5.5);
  assert.equal(P.parseLength("5 pies 6 pulg"), 5.5);
  assert.equal(P.parseLength("five"), null);
  assert.equal(P.parseLength(""), null);
});

test("lengths are shown in feet and inches", () => {
  assert.equal(P.formatLength(5.5), "5′ 6″");
  assert.equal(P.formatLength(8), "8′");
  assert.equal(P.formatLength(0.75), "9″");
  assert.equal(P.formatInches(1.25), "15″");
});

test("every starting layout fits with no problems", () => {
  for (const t of P.TEMPLATES) {
    const d = P.fromTemplate(t.id, {});
    const issues = P.validate(d, {});
    assert.equal(P.hasErrors(issues), false, t.id + ": " + JSON.stringify(issues));
    assert.equal(d.items.length, t.items.length + 1, t.id);
  }
});

test("a standard 5 x 8 full bath (tub, toilet, vanity, door) arranges with nothing left out", () => {
  const d = design({ w: 8, l: 5 }, [
    { id: "door", type: "door", wall: "S", offset: 4.6 },
    { type: "tub", wall: "N", offset: 0 },
    { type: "toilet", wall: "N", offset: 0 },
    { type: "vanity", wall: "N", offset: 0 },
  ]);
  const best = P.arrange(d, {})[0];
  assert.equal(best.placed, 3);
  assert.equal(P.hasErrors(P.validate(Object.assign({}, d, { items: best.items }), {})), false);
  // The door never moves.
  assert.deepEqual(
    best.items.find((it) => it.id === "door"),
    d.items.find((it) => it.id === "door"),
  );
});

test("the same bathroom typed the other way round (5 wide, 8 long) fits too", () => {
  const d = design({ w: 5, l: 8 }, [
    { id: "door", type: "door", wall: "E", offset: 4.6 },
    { type: "tub", wall: "N", offset: 0 },
    { type: "toilet", wall: "N", offset: 0 },
    { type: "vanity", wall: "N", offset: 0 },
  ]);
  assert.equal(P.arrange(d, {})[0].placed, 3);
});

test("arrange offers different layouts to choose from", () => {
  const d = P.fromTemplate("showerBath", {});
  const options = P.arrange(d, {}, { count: 3 });
  assert.ok(options.length >= 2);
  const sigs = options.map((o) => o.items.map((it) => it.wall + it.offset).join());
  assert.equal(new Set(sigs).size, sigs.length);
});

test("a toilet needs 15 in. from its center to a wall or fixture beside it", () => {
  const d = design({ w: 8, l: 6 }, [{ id: "t", type: "toilet", wall: "N", offset: 1 }]);
  const issues = P.validate(d, {}).t;
  assert.equal(issues[0].code, "side");
  assert.equal(issues[0].other, "wall");
  assert.equal(issues[0].need, 15);
  assert.equal(issues[0].have, 12);
  d.items[0].offset = 1.25;
  assert.deepEqual(errors(d, "t"), []);
  // 15 in. fits but 18 is recommended.
  assert.equal(P.validate(d, {}).t[0].code, "tightSide");
  d.items[0].offset = 1.5;
  assert.deepEqual(P.validate(d, {}).t, []);
});

test("fixtures can't overlap, and both are told", () => {
  const d = design({ w: 8, l: 6 }, [
    { id: "a", type: "vanity", wall: "N", offset: 1.25 },
    { id: "b", type: "cabinet", wall: "N", offset: 2.2 },
  ]);
  assert.ok(errors(d, "a").includes("overlap"));
  assert.ok(errors(d, "b").includes("overlap"));
});

test("nothing may stand in front of a toilet, but clear floor spaces may share floor", () => {
  // Toilet on one wall, vanity facing it across a 6 ft room: their clear
  // floor spaces overlap in the middle. That's allowed.
  const ok = design({ w: 8, l: 6 }, [
    { id: "t", type: "toilet", wall: "N", offset: 2 },
    { id: "v", type: "vanity", wall: "S", offset: 6 },
  ]);
  assert.deepEqual(errors(ok, "t"), []);
  assert.deepEqual(errors(ok, "v"), []);
  // In a 4.5 ft room the vanity stands in the toilet's 21 in.
  const tight = design({ w: 8, l: 4.5 }, [
    { id: "t", type: "toilet", wall: "N", offset: 2 },
    { id: "v", type: "vanity", wall: "S", offset: 6 },
  ]);
  assert.ok(errors(tight, "t").includes("front"));
  assert.ok(errors(tight, "v").includes("blocking"));
});

test("a tub only needs one 30 in. wide clear spot along its front, so a toilet can sit beside it", () => {
  const d = design({ w: 8, l: 5 }, [
    { id: "tub", type: "tub", wall: "E", offset: 2.5 },
    { id: "t", type: "toilet", wall: "N", offset: 3.6 },
  ]);
  assert.deepEqual(errors(d, "tub"), []);
  assert.deepEqual(errors(d, "t"), []);
});

test("nothing may stand in a door's swing", () => {
  const d = design({ w: 8, l: 5 }, [
    { id: "door", type: "door", wall: "S", offset: 4 },
    { id: "c", type: "cabinet", wall: "W", offset: 0.8 },
  ]);
  // The cabinet on the left wall, at the door's end, is clear of it.
  assert.deepEqual(errors(d, "c"), []);
  d.items[1] = { id: "c", type: "cabinet", wall: "S", offset: 4.3, opts: {} };
  assert.ok(errors(d, "c").includes("overlap"));
});

test("a fixture taller than the ceiling, or deeper than the room, doesn't fit", () => {
  const low = design({ w: 8, l: 6, h: 6.5 }, [{ id: "d", type: "door", wall: "S", offset: 4 }]);
  assert.ok(errors(low, "d").includes("tooTall"));
  const shallow = design({ w: 8, l: 3 }, [{ id: "s", type: "shower", wall: "N", offset: 2 }]);
  assert.ok(errors(shallow, "s").includes("outside") || errors(shallow, "s").includes("front"));
});

test("a bigger picked product changes what fits", () => {
  const d = design({ w: 5, l: 8 }, [{ id: "tub", type: "tub", wall: "N", offset: 2.5 }]);
  assert.deepEqual(errors(d, "tub"), []);
  assert.ok(P.errorsOf(P.validate(d, { tub: { span: 6.1, depth: 3.6 } }), "tub").length > 0);
});

test("a new fixture goes to a spot where it fits, without upsetting the others", () => {
  const d = P.fromTemplate("full5x8", {});
  const before = P.validate(d, {});
  const added = P.addItem(d, "cabinet", {});
  const after = P.validate(added.design, {});
  if (added.placed) {
    assert.deepEqual(P.errorsOf(after, added.item.id), []);
  }
  for (const it of d.items) {
    assert.equal(P.errorsOf(after, it.id).length, P.errorsOf(before, it.id).length);
  }
});

test("a fixture with no room anywhere is still added, flagged, never silently dropped", () => {
  const d = design({ w: 4, l: 4 }, [{ id: "tub", type: "tub", wall: "N", offset: 2 }]);
  const added = P.addItem(d, "tub", {});
  assert.equal(added.placed, false);
  assert.equal(added.design.items.length, 2);
  assert.ok(P.errorsOf(P.validate(added.design, {}), added.item.id).length > 0);
});

test("dragging snaps to the wall nearest the pointer, and slides to the nearest spot that works", () => {
  const d = design({ w: 8, l: 6 }, [
    { id: "v", type: "vanity", wall: "N", offset: 1.25 },
    { id: "t", type: "toilet", wall: "S", offset: 2 },
  ]);
  // Pointer over the north wall, right on the vanity: the toilet slides
  // past it to the first spot with 15 in. to spare.
  const s = P.snap(d, "t", 1.5, 1, {});
  assert.equal(s.wall, "N");
  assert.equal(s.valid, true);
  assert.equal(s.snapped, true);
  assert.ok(s.offset >= 2.5 + 1.25 - 1e-6);
  // Near a corner, it snaps into the corner.
  const c = P.snap(d, "v", 0.7, 4.6, {});
  assert.equal(c.wall, "W");
  assert.equal(c.offset, 1.25);
});

test("placements carry what the 3D room draws: mirrors on vanities, glass on showers", () => {
  const d = design({ w: 8, l: 6 }, [
    { id: "v", type: "vanity", wall: "N", offset: 1.25, opts: { mirror: "large" } },
    { id: "s", type: "shower", wall: "E", offset: 4.3, opts: { glassDoor: true, shelf: true } },
    { id: "door", type: "door", wall: "S", offset: 3, opts: { kind: "opening" } },
  ]);
  const p = P.toPlacements(d, {});
  const keys = p.map((x) => x.fixtureKey);
  assert.deepEqual(keys, [
    "Vanity_Quantity",
    "Mirror_Huge_Quantity",
    "Shower_Quantity",
    "Shower_Door_Quantity",
    "Shower_Shelf_Quantity",
    "Door_Quantity",
  ]);
  assert.equal(p.find((x) => x.fixtureKey === "Door_Quantity").hasDoor, false);
  assert.ok(p.every((x) => x.itemId));
  // East wall faces west into the room.
  const shower = p.find((x) => x.fixtureKey === "Shower_Quantity");
  assert.equal(shower.x, 8);
  assert.equal(shower.z, 4.3);
});

test("only new doors are priced as door installs, and a vanity isn't a sink too", () => {
  const d = design({ w: 8, l: 6 }, [
    { id: "a", type: "door", wall: "S", offset: 3, opts: { kind: "existing" } },
    { id: "b", type: "door", wall: "E", offset: 3, opts: { kind: "new" } },
    { id: "c", type: "door", wall: "W", offset: 3, opts: { kind: "opening" } },
    { id: "v", type: "vanity", wall: "N", offset: 1.25, opts: { mirror: "standard" } },
    { id: "s", type: "shower", wall: "N", offset: 5, opts: { glassDoor: false, shelf: true } },
  ]);
  const c = P.counts(d);
  assert.equal(c.Door_Quantity, 1);
  assert.equal(c.Vanity_Quantity, 1);
  assert.equal(c.Sink_Quantity, 0);
  assert.equal(c.Mirror_Quantity, 1);
  assert.equal(c.Shower_Quantity, 1);
  assert.equal(c.Shower_Door_Quantity, 0);
  assert.equal(c.Shower_Shelf_Quantity, 1);
});

test("wall areas take out the doorway, and the tub surround is the walls around the tub", () => {
  const d = design({ w: 8, l: 5, h: 8 }, [
    { id: "door", type: "door", wall: "S", offset: 4.6 },
    { id: "tub", type: "tub", wall: "E", offset: 2.5 },
  ]);
  const a = P.wallAreas(d, {});
  assert.equal(a.grossSqFt, 208);
  assert.equal(a.openingsSqFt, 16.88);
  assert.equal(a.netSqFt, 191.13);
  // Back wall 5 x 6 plus both ends 2.9 x 6 (it fills the alcove).
  assert.equal(a.wetSqFt, 64.8);
});

test("a design survives a link and comes back the same", () => {
  const d = P.fromTemplate("full5x8", {});
  d.finishes.picks.floorTile = "hd-123";
  d.products.toilet = "K-31648-0";
  const back = P.decode(P.encode(d));
  assert.deepEqual(back.room, d.room);
  assert.deepEqual(
    back.items.map((it) => [it.id, it.type, it.wall]),
    d.items.map((it) => [it.id, it.type, it.wall]),
  );
  assert.equal(back.finishes.picks.floorTile, "hd-123");
  assert.equal(back.products.toilet, "K-31648-0");
});

test("anything odd in a loaded design is dropped or reset, never trusted", () => {
  assert.equal(P.decode("not a design"), null);
  assert.equal(P.sanitize({ v: 1 }), null);
  const d = P.sanitize({
    v: 2,
    room: { w: 999, l: -3, h: "x" },
    items: [
      { id: "ok", type: "toilet", wall: "N", offset: 2 },
      { id: "ok", type: "toilet", wall: "N", offset: 4 },
      { id: "bad", type: "rocket", wall: "N", offset: 2 },
      { id: "<script>", type: "toilet", wall: "N", offset: 2 },
      { id: "w", type: "toilet", wall: "Q", offset: 2 },
    ],
    finishes: { floor: "lava", walls: "tileWet", picks: { floorTile: { evil: 1 } } },
  });
  assert.equal(d.room.w, P.LIMITS.maxW);
  assert.equal(d.room.l, P.LIMITS.min);
  assert.equal(d.room.h, 8);
  assert.deepEqual(
    d.items.map((it) => it.id),
    ["ok"],
  );
  assert.equal(d.finishes.floor, "tile");
  assert.equal(d.finishes.walls, "tileWet");
  assert.deepEqual(d.finishes.picks, {});
});

test("resizing keeps fixtures on their walls, inside the new length", () => {
  const d = design({ w: 10, l: 8 }, [{ id: "t", type: "toilet", wall: "N", offset: 9 }]);
  const r = P.resize(d, { w: 6, l: 8, h: 8 });
  assert.equal(r.items[0].wall, "N");
  assert.equal(r.items[0].offset, 6);
});
