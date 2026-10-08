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
  const d = P.fromTemplate("primary", {});
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

// ---------------------------------------------------------------------
// Electrical
// ---------------------------------------------------------------------
function elecErrors(d, id) {
  return (P.validateElectrical(d, {})[id] || []).filter((x) => x.level === "error").map((x) => x.code);
}

test("every starting layout gets electrical that works, and suggesting again changes nothing", () => {
  for (const t of P.TEMPLATES) {
    const d = P.fromTemplate(t.id, {});
    const issues = P.validateElectrical(d, {});
    for (const id of Object.keys(issues)) assert.deepEqual(issues[id], [], t.id + " " + id);
    assert.deepEqual(P.electricalGaps(d), [], t.id);
    assert.equal(P.suggestElectrical(d, {}).added.length, 0, t.id + " suggested twice");
  }
});

test("a bathroom with a basin gets a receptacle within reach of it, a light, a switch and a fan", () => {
  const d = P.fromTemplate("full5x8", {});
  const kinds = P.electrical(d).map((p) => p.kind);
  assert.ok(kinds.includes("outlet"), kinds.join());
  assert.ok(kinds.includes("light"), kinds.join());
  assert.ok(kinds.includes("switch"), kinds.join());
  assert.ok(kinds.includes("fan"), kinds.join());
  const vanity = d.items.find((it) => it.type === "vanity");
  const outlet = P.electrical(d).find((p) => p.kind === "outlet");
  assert.equal(outlet.for, vanity.id);
  assert.equal(outlet.wall, vanity.wall);
  assert.equal(Math.round(outlet.height * 12), 42);
  // The fan hangs in the ceiling over the tub, not on a wall.
  const fan = P.electrical(d).find((p) => p.kind === "fan");
  assert.equal(fan.wall, null);
  const tub = d.items.find((it) => it.type === "tub");
  const body = P.geometry(tub, d.room, {}).body;
  const at = P.electricalPose(d, fan, {});
  assert.ok(at.x >= body.x0 && at.x <= body.x1 && at.z >= body.z0 && at.z <= body.z1, JSON.stringify(at));
  assert.equal(at.y, d.room.h);
});

test("a half bath with no tub or shower gets no fan", () => {
  const d = P.fromTemplate("half", {});
  assert.equal(
    P.electrical(d).some((p) => p.kind === "fan"),
    false,
  );
  assert.deepEqual(P.electricalGaps(d), []);
});

test("a receptacle may not stand within 3 ft of a tub, behind a fixture or past the wall", () => {
  const d = design({ w: 9, l: 7 }, [
    { id: "tub", type: "tub", wall: "N", offset: 2.5 },
    { id: "cab", type: "cabinet", wall: "S", offset: 1 },
  ]);
  const put = (point) => Object.assign({}, d, { electrical: [Object.assign({ id: "p", for: "room" }, point)] });
  assert.deepEqual(elecErrors(put({ kind: "outlet", wall: "N", offset: 6, height: 3.5 }), "p"), ["wet"]);
  // A light over the tub is fine: only receptacles and switches keep away.
  assert.deepEqual(elecErrors(put({ kind: "light", wall: "N", offset: 6, height: 6.75 }), "p"), []);
  assert.deepEqual(elecErrors(put({ kind: "outlet", wall: "S", offset: 1, height: 1.5 }), "p"), ["behind"]);
  assert.deepEqual(elecErrors(put({ kind: "outlet", wall: "S", offset: 1, height: 3.5 }), "p"), []);
  assert.deepEqual(elecErrors(put({ kind: "outlet", wall: "E", offset: 7.5, height: 3.5 }), "p"), ["outside"]);
  assert.deepEqual(elecErrors(put({ kind: "switch", wall: "E", offset: 3, height: 7.9 }), "p"), ["outside"]);
});

test("two points can't sit on top of each other at the same height", () => {
  const d = design({ w: 9, l: 7 }, [{ id: "door", type: "door", wall: "S", offset: 4 }]);
  const two = (gap) =>
    Object.assign({}, d, {
      electrical: [
        { id: "a", kind: "switch", wall: "N", offset: 3, height: 4, for: "room" },
        { id: "b", kind: "switch", wall: "N", offset: 3 + gap, height: 4, for: "room" },
      ],
    });
  assert.deepEqual(elecErrors(two(0.3), "b"), ["crowded"]);
  assert.deepEqual(elecErrors(two(0.9), "b"), []);
});

test("dragging a point puts it on the nearest wall and says whether it works there", () => {
  const d = Object.assign({}, P.fromTemplate("full5x8", {}), {
    electrical: [{ id: "p", kind: "outlet", wall: "N", offset: 4, height: 3.5, for: "room" }],
  });
  // Close to wall C (south, z = 5) at 4 ft along, 4 ft up.
  const hit = P.snapElectrical(d, "p", 3, 4, 4.9, {});
  assert.equal(hit.wall, "S");
  assert.equal(Math.round(hit.height * 12), 48);
  assert.equal(Math.round(hit.offset * 12), Math.round((8 - 3) * 12));
  // Into the tub's 3 ft: it says so rather than refusing to report a spot.
  const tub = d.items.find((it) => it.type === "tub");
  const g = P.geometry(tub, d.room, {});
  const bad = P.snapElectrical(d, "p", (g.body.x0 + g.body.x1) / 2, 3.5, 0.1, {});
  assert.equal(bad.valid, false);
});

test("electrical points are added, moved, removed and counted", () => {
  let d = P.fromTemplate("blank", {});
  const before = P.electricalPoints(d);
  const added = P.addElectrical(d, "outlet", {});
  assert.equal(added.placed, true);
  d = added.design;
  assert.equal(P.electricalPoints(d), before + 1);
  d = P.moveElectrical(d, added.point.id, { offset: 2, height: 2 });
  assert.equal(P.electrical(d).find((p) => p.id === added.point.id).offset, 2);
  d = P.removeElectrical(d, added.point.id);
  assert.equal(P.electricalPoints(d), before);
});

test("a link carries the electrical, and an older link without any still opens", () => {
  const d = P.fromTemplate("full5x8", {});
  const back = P.decode(P.encode(d));
  // The link rounds to the nearest thousandth of a foot (about 1/100 in.).
  assert.deepEqual(
    back.electrical.map((p) => [p.id, p.kind, p.wall, Math.round(p.offset * 96), Math.round(p.height * 96)]),
    P.electrical(d).map((p) => [p.id, p.kind, p.wall, Math.round(p.offset * 96), Math.round(p.height * 96)]),
  );
  const old = P.sanitize({
    v: 2,
    room: { w: 8, l: 5, h: 8 },
    items: [{ id: "t", type: "toilet", wall: "N", offset: 2 }],
  });
  assert.deepEqual(old.electrical, []);
  // Junk is dropped the same way fixtures are.
  const junk = P.sanitize({
    v: 3,
    room: { w: 8, l: 5, h: 8 },
    items: [],
    electrical: [
      { id: "a", kind: "outlet", wall: "N", offset: 3, height: 3.5 },
      { id: "a", kind: "outlet", wall: "N", offset: 3, height: 3.5 },
      { id: "b", kind: "laser", wall: "N", offset: 3, height: 3.5 },
      { id: "c", kind: "switch", wall: "Q", offset: 3, height: 4 },
      { id: "d", kind: "outlet", wall: "N", offset: 99, height: 99 },
    ],
  });
  assert.deepEqual(
    junk.electrical.map((p) => p.id),
    ["a", "d"],
  );
  assert.equal(junk.electrical[1].offset, 8);
  assert.equal(junk.electrical[1].height, 8);
});

test("resizing the room keeps the electrical on its walls", () => {
  const d = Object.assign({}, P.fromTemplate("full5x8", {}), {
    electrical: [
      { id: "p", kind: "outlet", wall: "N", offset: 7.5, height: 3.5, for: "room" },
      { id: "f", kind: "fan", wall: null, offset: 0, height: 8, for: "room" },
    ],
  });
  const r = P.resize(d, { w: 5, l: 5, h: 7 });
  assert.equal(r.electrical[0].offset, 5);
  assert.equal(r.electrical[0].height, 3.5);
  assert.equal(r.electrical[1].height, 7);
});

// ---------- the plumbing stack ----------

test("a fixture on the plumbing wall needs no drain run", () => {
  const d = design({ w: 8, l: 6 }, [{ id: "wc", type: "toilet", wall: "N", offset: 2 }]);
  assert.equal(P.stackWall(d), "N");
  assert.equal(P.stackRun(d, d.items[0]), 0);
  assert.deepEqual(errors(d, "wc"), []);
  assert.equal(P.drainRun(d), 0);
});

test("a fixture a few feet from the plumbing wall is nobody's problem", () => {
  const d = design({ w: 8, l: 6 }, [{ id: "wc", type: "toilet", wall: "E", offset: 3 }]);
  assert.equal(P.stackRun(d, d.items[0]), 3);
  assert.deepEqual(P.validate(d, {}).wc, []);
  assert.equal(P.drainRun(d), 0);
});

test("a fixture off the plumbing wall is flagged with the drain run it needs", () => {
  const d = design({ w: 8, l: 6 }, [{ id: "wc", type: "toilet", wall: "E", offset: 5 }]);
  const issues = P.validate(d, {}).wc;
  const off = issues.filter((x) => x.code === "offStack");
  assert.equal(off.length, 1);
  assert.equal(off[0].level, "warn");
  assert.equal(off[0].have, 60);
  assert.equal(P.drainRun(d), 5);
});

test("a toilet too far from the stack for its drain to fall is an error", () => {
  // Across a 10 ft room the run picks up a side wall on the way: 10 + 5.
  const d = design({ w: 10, l: 10 }, [{ id: "wc", type: "toilet", wall: "S", offset: 5 }]);
  assert.equal(P.stackRun(d, d.items[0]), 15);
  assert.deepEqual(errors(d, "wc"), ["noStack"]);
  // A sink's smaller line reaches further.
  const s = design({ w: 10, l: 10 }, [{ id: "sk", type: "sink", wall: "S", offset: 5 }]);
  assert.deepEqual(errors(s, "sk"), []);
  assert.equal(P.validate(s, {}).sk[0].code, "offStack");
});

test("a tub's run is measured from whichever end is nearer the stack", () => {
  const d = design({ w: 8, l: 7 }, [{ id: "tb", type: "tub", wall: "E", offset: 3.5 }]);
  // Centered on a 7 ft wall, but a 5 ft tub's near end is only 1 ft along.
  assert.equal(P.stackRun(d, d.items[0], {}), 1);
  assert.deepEqual(errors(d, "tb"), []);
  // Measured from its center it would have been a flagged 3.5 ft run.
  assert.equal(P.drainRun(d, {}), 0);
});

test("moving the plumbing wall moves the problem", () => {
  let d = design({ w: 10, l: 10 }, [{ id: "wc", type: "toilet", wall: "S", offset: 5 }]);
  assert.deepEqual(errors(d, "wc"), ["noStack"]);
  d = P.setStack(d, "S");
  assert.equal(P.stackWall(d), "S");
  assert.deepEqual(errors(d, "wc"), []);
  // An unknown wall is ignored rather than accepted.
  assert.equal(P.stackWall(P.setStack(d, "Z")), "S");
});

test("the suggested plumbing wall is the toilet's, or the one with the least pipe", () => {
  const withWc = design({ w: 8, l: 6 }, [
    { id: "wc", type: "toilet", wall: "E", offset: 3 },
    { id: "sk", type: "sink", wall: "N", offset: 2 },
  ]);
  assert.equal(P.suggestStack(withWc, {}), "E");
  const noWc = design({ w: 8, l: 6 }, [
    { id: "sk", type: "sink", wall: "W", offset: 2 },
    { id: "sh", type: "shower", wall: "W", offset: 4.5 },
  ]);
  assert.equal(P.suggestStack(noWc, {}), "W");
});

test("a new fixture goes to the plumbing wall when it can", () => {
  const d = design({ w: 9, l: 9 }, [{ id: "door", type: "door", wall: "S", offset: 4.5 }]);
  const added = P.addItem(P.setStack(d, "W"), "toilet", {});
  assert.equal(added.placed, true);
  assert.equal(added.item.wall, "W");
});

test("the plumbing wall survives a link and a resize", () => {
  const d = P.setStack(design({ w: 8, l: 6 }, [{ id: "sk", type: "sink", wall: "E", offset: 2 }]), "E");
  const back = P.decode(P.encode(d));
  assert.equal(P.stackWall(back), "E");
  assert.equal(P.stackWall(P.resize(back, { w: 7, l: 5, h: 8 })), "E");
  // A design saved before the plumbing wall existed falls back to one.
  assert.equal(P.stackWall(P.sanitize({ v: 2, room: { w: 8, l: 6, h: 8 }, items: [] })), "N");
});

test("what the person has answered goes with the design, and nothing else does", () => {
  const d = P.fromTemplate("full5x8", {});
  assert.deepEqual(d.answered, { stack: false, products: {} });
  d.answered = { stack: true, products: { toilet: true } };
  const back = P.decode(P.encode(d));
  assert.deepEqual(back.answered, { stack: true, products: { toilet: true } });
  const odd = P.sanitize(
    Object.assign({}, d, { answered: { stack: "yes", products: { toilet: 1, "bad key": true } } }),
  );
  assert.deepEqual(odd.answered, { stack: false, products: {} });
  // A design saved before there were answers starts with none.
  const old = P.sanitize(Object.assign({}, d, { answered: undefined }));
  assert.deepEqual(old.answered, { stack: false, products: {} });
});
