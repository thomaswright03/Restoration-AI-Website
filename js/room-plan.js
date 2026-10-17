// Room Designer 3D — the room plan: what is in the bathroom and where.
//
// Pure logic, no DOM and no Three.js, so it runs in the browser
// (window.RoomPlan) and in Node for the unit tests. js/studio.js keeps a
// design in this shape, asks this module whether it works, where a new
// fixture should go and how to arrange the whole room, and hands the
// result to js/bathroom-room-3d.js (toPlacements) to draw.
//
// A design:
//   { v: 3,
//     room: { w, l, h, wet, shape }, feet: width (x), length (z), ceiling,
//                                  the wall the plumbing is in (or a list
//                                  of them), and any cutout (see Room shapes)
//     items: [ { id, type, wall, offset, opts } ],
//     electrical: [ { id, kind, wall, offset, height, for } ],
//     windows: [ { id, wall, offset, width, height, sill } ],
//     finishes: { demolition, floor, walls, ceiling, picks: {} },
//     products: { <3D product slot id>: <option id> },
//     answered: { stack, products: { <slot id>: true } } }
//
// answered is what the person has chosen themselves rather than left at
// the suggestion: the plumbing wall, and each product. The studio won't go
// on to the next step until that step's questions are answered.
//
// Every fixture stands against a wall, facing into the room. In a
// rectangular room wall is "N" (z = 0), "E" (x = w), "S" (z = l) or "W"
// (x = 0); a room with a cutout (room.shape, an L, T or notched room) has
// walls "w1", "w2" … instead. offset is the distance in feet from the
// wall's left end (as seen standing in the room facing it) to the
// fixture's center. The people-facing names are the letters A, B, C …
// (wallLetter()).
//
// Electrical points (outlets, switches, lights and an exhaust fan) are
// suggested by suggestElectrical() from where the fixtures stand, and the
// person confirms or moves each one along its wall.
//
// Clearances are typical US residential code minimums and the NKBA
// recommendations, not a substitute for a code review: 15 in. from a
// toilet's center to anything beside it (18 recommended), 21 in. of clear
// floor in front of a toilet, sink or vanity (30 recommended), a 30 in.
// wide spot to step into a tub or shower, and a door's swing kept clear.
// Clear floor spaces may share floor with each other, as codes allow;
// nothing may stand in one.
(function (/** @type {any} */ root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.RoomPlan = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var IN = 1 / 12;
  var EPS = 1e-6;
  var WALL_IDS = ["N", "E", "S", "W"];
  var WALL_LETTERS = { N: "A", E: "B", S: "C", W: "D" };
  var LIMITS = { min: 3, maxW: 30, maxL: 30, minH: 6.5, maxH: 14 };
  var MAX_ITEMS = 16;
  var MAX_ELECTRICAL = 14;

  // What each fixture type is, for the plan and for the 3D room.
  //   fixtureKey: the type's key in js/bathroom-pricing.js and the 3D room
  //   size:       default footprint (span along the wall, depth, height),
  //               replaced by the picked product's real size when known
  //   front:      clear floor needed in front (in.) and how wide (in.;
  //               null = the fixture's own width)
  //   side:       clear space each side of its center (toilets)
  //   step:       a tub or shower only needs a stretch this wide (in.)
  //               somewhere along its front, not the whole length
  //   recommend:  roomier NKBA numbers; less only gives a warning
  //   wet:        has plumbing, so it groups with the other wet fixtures
  //   drainEnd:   its drain is at one end (a tub, a shower), so the run to
  //               the stack is measured from whichever end is nearer
  var TYPES = {
    toilet: {
      fixtureKey: "Toilet_Quantity",
      size: { span: 1.7, depth: 2.3, height: 2.5 },
      front: { depth: 21, width: 30 },
      side: 15,
      recommend: { side: 18, front: 30 },
      wet: true,
    },
    vanity: {
      fixtureKey: "Vanity_Quantity",
      size: { span: 2.5, depth: 1.6, height: 2.6 },
      front: { depth: 21, width: null },
      recommend: { front: 30 },
      wet: true,
    },
    sink: {
      fixtureKey: "Sink_Quantity",
      size: { span: 1.9, depth: 1.55, height: 2.6 },
      front: { depth: 21, width: 30 },
      sideGap: 4,
      recommend: { front: 30 },
      wet: true,
    },
    tub: {
      fixtureKey: "Bathtub_Quantity",
      size: { span: 5, depth: 2.9, height: 1.6 },
      front: { depth: 21, width: null },
      step: 30,
      wet: true,
      drainEnd: true,
    },
    shower: {
      fixtureKey: "Shower_Quantity",
      size: { span: 3.2, depth: 3.2, height: 6.5 },
      front: { depth: 24, width: null },
      step: 24,
      wet: true,
      drainEnd: true,
    },
    cabinet: {
      fixtureKey: "Cabinet_Quantity",
      size: { span: 1.6, depth: 1.4, height: 2.6 },
      front: { depth: 15, width: null },
    },
    door: {
      fixtureKey: "Door_Quantity",
      size: { span: 2.5, depth: 0.15, height: 6.75 },
      // A 30 in. door swings 30 in. into the room; an open doorway still
      // needs the same space to walk through.
      swing: 30,
    },
  };

  // The order the room is arranged in: the big pieces claim their walls
  // first, the toilet fits in after.
  var ARRANGE_ORDER = ["tub", "shower", "vanity", "sink", "toilet", "cabinet"];

  // Default options for a newly added fixture.
  function defaultOpts(type) {
    if (type === "vanity" || type === "sink") return { mirror: "standard" };
    if (type === "shower") return { glassDoor: true, shelf: false };
    if (type === "door") return { kind: "existing" };
    return {};
  }

  // -------------------------------------------------------------------
  // Numbers and lengths
  // -------------------------------------------------------------------
  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function round(n, places) {
    var f = Math.pow(10, places || 0);
    return Math.round(n * f) / f;
  }

  // Feet to whole inches, as feet and inches: 5.5 -> { ft: 5, in: 6 }.
  function toFtIn(ft) {
    var total = Math.round((Number(ft) || 0) * 12);
    return { ft: Math.floor(total / 12), in: total % 12 };
  }

  // 5.5 -> "5′ 6″"; under a foot -> "8″".
  function formatLength(ft) {
    var neg = ft < 0;
    var v = toFtIn(Math.abs(ft));
    var text = v.ft ? v.ft + "′" + (v.in ? " " + v.in + "″" : "") : v.in + "″";
    return neg ? "−" + text : text;
  }

  function formatInches(ft) {
    return Math.round((Number(ft) || 0) * 12) + "″";
  }

  // Reads a length typed by a person, in feet: "5", "5.5", "5,5", "5'6",
  // "5' 6\"", "5 6", "5ft 6in", "66in", "66\"". null when it isn't one.
  function parseLength(text) {
    if (typeof text === "number") return isFinite(text) ? text : null;
    var s = String(text || "")
      .trim()
      .toLowerCase()
      .replace(/,/g, ".")
      .replace(/[′’']/g, "'")
      .replace(/[″”"]/g, '"')
      .replace(/\s+/g, " ")
      .replace(/(ft|in|pulg|pol|pies|pés)\./g, "$1");
    if (!s) return null;
    var m = /^(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|pies|pie|pés|pé|')?$/.exec(s);
    if (m) return Number(m[1]);
    m = /^(\d+(?:\.\d+)?)\s*(?:in|inch|inches|pulg|pol|")$/.exec(s);
    if (m) return Number(m[1]) / 12;
    m = /^(\d+)\s*(?:ft|feet|foot|pies|pie|pés|pé|'|-|\s)\s*(\d+(?:\.\d+)?)\s*(?:in|inch|inches|pulg|pol|")?$/.exec(s);
    if (m) return Number(m[1]) + Number(m[2]) / 12;
    return null;
  }

  // -------------------------------------------------------------------
  // Room shapes
  // -------------------------------------------------------------------
  // A room is a w x l box unless room.shape takes a rectangle (or two) out
  // of it, which is how most bathrooms that aren't rectangles look:
  //   { kind: "L", at: "NE", w, l }  a w x l piece missing from one corner
  //                                  (six walls)
  //   { kind: "T", at: "S", w, l }   a w x l piece missing from both corners
  //                                  of one side (eight walls)
  //   { kind: "U", at: "N", w, l }   a w x l notch in the middle of one side,
  //                                  a closet or a chase (eight walls)
  // w and l are always across (x) and along (z), the same as the room's.
  // A rectangle's walls keep their compass ids N, E, S and W; a shaped
  // room's are "w1", "w2" … going round clockwise from the top wall's left
  // end, lettered A, B, C … the same way.
  var SHAPES = ["rect", "L", "T", "U"];
  var SHAPE_AT = { L: ["NW", "NE", "SE", "SW"], T: ["N", "E", "S", "W"], U: ["N", "E", "S", "W"] };
  var SHAPE_DEFAULT = { L: { at: "NE" }, T: { at: "S" }, U: { at: "N" } };
  var MIN_ARM = 2; // feet of room kept beside or past a cutout
  var MIN_CUT = 1; // the smallest cutout, feet

  function shapeOf(room) {
    var s = room && room.shape;
    if (!s || !SHAPE_AT[s.kind] || SHAPE_AT[s.kind].indexOf(s.at) === -1) return null;
    if (!(s.w > 0) || !(s.l > 0)) return null;
    return s;
  }

  // How big a cutout can be in this room: { minW, maxW, minL, maxL }, or
  // null when the room is too small for that shape at all.
  function shapeLimits(room, kind, at) {
    if (!SHAPE_AT[kind]) return null;
    var across = at === "N" || at === "S";
    var maxW = room.w - MIN_ARM;
    var maxL = room.l - MIN_ARM;
    if (kind === "T") {
      if (across) maxW = (room.w - MIN_ARM) / 2;
      else maxL = (room.l - MIN_ARM) / 2;
    }
    if (kind === "U") {
      if (across) maxW = room.w - 2 * MIN_ARM;
      else maxL = room.l - 2 * MIN_ARM;
    }
    maxW = round(maxW, 4);
    maxL = round(maxL, 4);
    if (maxW < MIN_CUT - EPS || maxL < MIN_CUT - EPS) return null;
    return { minW: MIN_CUT, maxW: maxW, minL: MIN_CUT, maxL: maxL };
  }

  // A shape that fits the room: its cutout clamped to shapeLimits(), or
  // null for a rectangle (or a shape this room is too small for).
  function fitShape(room, shape) {
    if (!shape || typeof shape !== "object" || !SHAPE_AT[shape.kind]) return null;
    var at = SHAPE_AT[shape.kind].indexOf(shape.at) !== -1 ? shape.at : SHAPE_DEFAULT[shape.kind].at;
    var lim = shapeLimits(room, shape.kind, at);
    if (!lim) return null;
    var w = Number(shape.w);
    var l = Number(shape.l);
    return {
      kind: shape.kind,
      at: at,
      w: round(clamp(isFinite(w) ? w : lim.maxW / 2, lim.minW, lim.maxW), 4),
      l: round(clamp(isFinite(l) ? l : lim.maxL / 2, lim.minL, lim.maxL), 4),
    };
  }

  // A sensible first cutout for a shape: about a third of the room.
  function defaultShape(room, kind, at) {
    if (!SHAPE_AT[kind]) return null;
    at = at || SHAPE_DEFAULT[kind].at;
    var lim = shapeLimits(room, kind, at);
    if (!lim) return null;
    var third = function (n, lo, hi) {
      return clamp(Math.round(n / 3), lo, hi);
    };
    var w = kind === "T" && (at === "N" || at === "S") ? lim.maxW / 2 : third(room.w, lim.minW, lim.maxW);
    var l = kind === "T" && (at === "E" || at === "W") ? lim.maxL / 2 : third(room.l, lim.minL, lim.maxL);
    return fitShape(room, { kind: kind, at: at, w: w, l: l });
  }

  // The pieces a shape takes out of the box, as room rectangles.
  function cutsOf(room) {
    var s = shapeOf(room);
    if (!s) return [];
    var w = room.w;
    var l = room.l;
    var box = function (x0, z0) {
      return { x0: x0, x1: x0 + s.w, z0: z0, z1: z0 + s.l };
    };
    if (s.kind === "L") return [box(s.at.charAt(1) === "E" ? w - s.w : 0, s.at.charAt(0) === "S" ? l - s.l : 0)];
    var across = s.at === "N" || s.at === "S";
    var x = s.at === "E" ? w - s.w : 0;
    var z = s.at === "S" ? l - s.l : 0;
    if (s.kind === "T") return across ? [box(0, z), box(w - s.w, z)] : [box(x, 0), box(x, l - s.l)];
    return across ? [box((w - s.w) / 2, z)] : [box(x, (l - s.l) / 2)];
  }

  // The floor's corners, clockwise (as seen on the plan, wall A on top)
  // from the top wall's left end.
  function outline(room) {
    var cuts = cutsOf(room);
    if (!cuts.length) {
      return [
        { x: 0, z: 0 },
        { x: room.w, z: 0 },
        { x: room.w, z: room.l },
        { x: 0, z: room.l },
      ];
    }
    var uniq = function (list) {
      return list
        .map(function (n) {
          return round(n, 6);
        })
        .sort(function (a, b) {
          return a - b;
        })
        .filter(function (n, i, all) {
          return i === 0 || n - all[i - 1] > EPS;
        });
    };
    var xs = [0, room.w];
    var zs = [0, room.l];
    cuts.forEach(function (c) {
      xs.push(c.x0, c.x1);
      zs.push(c.z0, c.z1);
    });
    xs = uniq(xs);
    zs = uniq(zs);
    var filled = function (i, j) {
      if (i < 0 || j < 0 || i >= xs.length - 1 || j >= zs.length - 1) return false;
      var cx = (xs[i] + xs[i + 1]) / 2;
      var cz = (zs[j] + zs[j + 1]) / 2;
      return !cuts.some(function (c) {
        return cx > c.x0 && cx < c.x1 && cz > c.z0 && cz < c.z1;
      });
    };
    // Each cell's sides that face out, as edges running clockwise; then
    // followed head to tail.
    /** @type {Object<string, { x: number, z: number }>} */
    var next = {};
    var key = function (x, z) {
      return x + "," + z;
    };
    var edge = function (x0, z0, x1, z1) {
      next[key(x0, z0)] = { x: x1, z: z1 };
    };
    for (var i = 0; i < xs.length - 1; i++) {
      for (var j = 0; j < zs.length - 1; j++) {
        if (!filled(i, j)) continue;
        if (!filled(i, j - 1)) edge(xs[i], zs[j], xs[i + 1], zs[j]);
        if (!filled(i + 1, j)) edge(xs[i + 1], zs[j], xs[i + 1], zs[j + 1]);
        if (!filled(i, j + 1)) edge(xs[i + 1], zs[j + 1], xs[i], zs[j + 1]);
        if (!filled(i - 1, j)) edge(xs[i], zs[j + 1], xs[i], zs[j]);
      }
    }
    /** @type {{ x: number, z: number } | null} */
    var start = null;
    Object.keys(next).forEach(function (k) {
      var p = k.split(",").map(Number);
      var to = next[k];
      if (to.z !== p[1]) return;
      if (!start || p[1] < start.z - EPS || (Math.abs(p[1] - start.z) < EPS && p[0] < start.x)) {
        start = { x: p[0], z: p[1] };
      }
    });
    var pts = [];
    var at = start;
    for (var guard = 0; at && guard < 200; guard++) {
      pts.push(at);
      at = next[key(at.x, at.z)];
      if (at && start && Math.abs(at.x - start.x) < EPS && Math.abs(at.z - start.z) < EPS) break;
    }
    // Only the corners: drop the points partway along a straight wall.
    return pts.filter(function (p, k) {
      var a = pts[(k + pts.length - 1) % pts.length];
      var b = pts[(k + 1) % pts.length];
      return Math.abs((p.x - a.x) * (b.z - p.z) - (p.z - a.z) * (b.x - p.x)) > EPS;
    });
  }

  function floorArea(room) {
    return cutsOf(room).reduce(function (sum, c) {
      return sum - (c.x1 - c.x0) * (c.z1 - c.z0);
    }, room.w * room.l);
  }

  function perimeter(room) {
    return wallList(room).reduce(function (sum, wall) {
      return sum + wall.span;
    }, 0);
  }

  // -------------------------------------------------------------------
  // Walls and rectangles
  // -------------------------------------------------------------------
  // Each wall: where its left end is (ox, oz), which way it runs (dx, dz),
  // which way is into the room (nx, nz), how long it is and how deep the
  // room is in front of it. rotY turns a fixture modeled facing +z to face
  // into the room from this wall. index is its place going round (A is 0),
  // start the distance round the room to its left end, and inStart / inEnd
  // whether its ends are inside corners (a fixture can tuck into one) or
  // the outside corner of a cutout.
  var wallCache = {};
  var wallCacheSize = 0;

  function wallList(room) {
    var s = shapeOf(room);
    var cacheKey = [room.w, room.l, s ? s.kind + s.at + s.w + "x" + s.l : ""].join("|");
    if (wallCache[cacheKey]) return wallCache[cacheKey];
    var w = room.w;
    var l = room.l;
    /** @type {any[]} */
    var list;
    if (!s) {
      list = [
        { id: "N", ox: 0, oz: 0, dx: 1, dz: 0, nx: 0, nz: 1, span: w, deep: l, rotY: 0 },
        { id: "E", ox: w, oz: 0, dx: 0, dz: 1, nx: -1, nz: 0, span: l, deep: w, rotY: -Math.PI / 2 },
        { id: "S", ox: w, oz: l, dx: -1, dz: 0, nx: 0, nz: -1, span: w, deep: l, rotY: Math.PI },
        { id: "W", ox: 0, oz: l, dx: 0, dz: -1, nx: 1, nz: 0, span: l, deep: w, rotY: Math.PI / 2 },
      ];
    } else {
      var pts = outline(room);
      list = pts.map(function (p, i) {
        var q = pts[(i + 1) % pts.length];
        var span = Math.abs(q.x - p.x) + Math.abs(q.z - p.z);
        var dx = Math.sign(q.x - p.x);
        var dz = Math.sign(q.z - p.z);
        var nx = -dz || 0;
        var nz = dx || 0;
        return {
          id: "w" + (i + 1),
          ox: p.x,
          oz: p.z,
          dx: dx || 0,
          dz: dz || 0,
          nx: nx,
          nz: nz,
          span: round(span, 6),
          deep: 0,
          rotY: Math.atan2(nx, nz),
        };
      });
    }
    var run = 0;
    list.forEach(function (wall, i) {
      var prev = list[(i + list.length - 1) % list.length];
      var after = list[(i + 1) % list.length];
      wall.index = i;
      wall.letter = String.fromCharCode(65 + i);
      wall.start = run;
      run += wall.span;
      // Turning right (clockwise) at a corner makes it an inside corner.
      wall.inStart = prev.dx * wall.dz - prev.dz * wall.dx > 0;
      wall.inEnd = wall.dx * after.dz - wall.dz * after.dx > 0;
    });
    if (s) {
      list.forEach(function (wall) {
        wall.deep = depthAcross(list, wall, 0, wall.span);
      });
    }
    if (wallCacheSize > 200) {
      wallCache = {};
      wallCacheSize = 0;
    }
    wallCache[cacheKey] = list;
    wallCacheSize++;
    return list;
  }

  function walls(room) {
    var out = {};
    wallList(room).forEach(function (wall) {
      out[wall.id] = wall;
    });
    return out;
  }

  function wallIds(room) {
    return wallList(room).map(function (wall) {
      return wall.id;
    });
  }

  function isWall(room, wallId) {
    return wallIds(room).indexOf(wallId) !== -1;
  }

  // The letter people know a wall by: A, B, C … going round.
  function wallLetter(room, wallId) {
    var wall = walls(room)[wallId];
    return wall ? wall.letter : WALL_LETTERS[wallId] || "?";
  }

  function wallSpan(room, wallId) {
    var wall = walls(room)[wallId];
    return wall ? wall.span : 0;
  }

  // How far the floor runs straight out from a wall across a stretch of it
  // (a0..a1 along it) before another wall: the room's depth there.
  function depthAcross(list, wall, a0, a1) {
    var best = Infinity;
    list.forEach(function (o) {
      if (o === wall) return;
      var along0 = (o.ox - wall.ox) * wall.dx + (o.oz - wall.oz) * wall.dz;
      var d0 = (o.ox - wall.ox) * wall.nx + (o.oz - wall.oz) * wall.nz;
      var along1 = along0 + (o.dx * wall.dx + o.dz * wall.dz) * o.span;
      var d1 = d0 + (o.dx * wall.nx + o.dz * wall.nz) * o.span;
      if (Math.max(along0, along1) <= a0 + EPS || Math.min(along0, along1) >= a1 - EPS) return;
      if (Math.max(d0, d1) <= EPS) return;
      best = Math.min(best, Math.max(0, Math.min(d0, d1)));
    });
    return best === Infinity ? 0 : best;
  }

  function frontDepth(room, wall, a0, a1) {
    if (!shapeOf(room)) return wall.deep;
    return depthAcross(wallList(room), wall, a0, a1);
  }

  // The wall straight across the room from a point a along this one:
  // { wall, offset } or null.
  function acrossFrom(room, wall, a) {
    var x = wall.ox + wall.dx * a;
    var z = wall.oz + wall.dz * a;
    /** @type {{ wall: any, offset: number, d: number } | null} */
    var best = null;
    wallList(room).forEach(function (o) {
      if (o.nx !== -wall.nx || o.nz !== -wall.nz) return;
      var d = (o.ox - x) * wall.nx + (o.oz - z) * wall.nz;
      var along = (x - o.ox) * o.dx + (z - o.oz) * o.dz;
      if (d <= EPS || along < -EPS || along > o.span + EPS) return;
      if (!best || d < best.d) best = { wall: o, offset: along, d: d };
    });
    return best ? { wall: best.wall, offset: best.offset } : null;
  }

  // Which of `list`'s walls a room point (x, z) is up against, for
  // something whose middle is `depth` out from the wall: the one whose face
  // is nearest that far out, in front of it and within its ends.
  // { wall, along, dist }.
  function nearestWall(list, x, z, depth) {
    /** @type {{ wall: any, along: number, dist: number, cost: number } | null} */
    var best = null;
    list.forEach(function (wall) {
      var along = (x - wall.ox) * wall.dx + (z - wall.oz) * wall.dz;
      var dist = (x - wall.ox) * wall.nx + (z - wall.oz) * wall.nz;
      var off = Math.max(0, -along, along - wall.span);
      var cost = Math.abs(dist - depth) + 2 * off + (dist < -0.1 ? 10 - dist : 0);
      if (!best || cost < best.cost - EPS) best = { wall: wall, along: along, dist: dist, cost: cost };
    });
    return best;
  }

  // A point inside the floor: its middle when that's in the room, else
  // the middle of the biggest piece of it.
  function interiorPoint(room) {
    var mid = { x: room.w / 2, z: room.l / 2 };
    var cuts = cutsOf(room);
    var inCut = function (p) {
      return cuts.some(function (c) {
        return p.x > c.x0 - EPS && p.x < c.x1 + EPS && p.z > c.z0 - EPS && p.z < c.z1 + EPS;
      });
    };
    if (!inCut(mid)) return mid;
    var pts = outline(room);
    /** @type {{ x: number, z: number, area: number } | null} */
    var best = null;
    pts.forEach(function (a) {
      pts.forEach(function (b) {
        var p = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
        var area = Math.abs(a.x - b.x) * Math.abs(a.z - b.z);
        if (area > EPS && !inCut(p) && !insideHole(p, a, b, cuts) && (!best || area > best.area)) {
          best = { x: p.x, z: p.z, area: area };
        }
      });
    });
    return best ? { x: best.x, z: best.z } : mid;
  }

  function insideHole(p, a, b, cuts) {
    var r = { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z) };
    return cuts.some(function (c) {
      return overlaps(r, c);
    });
  }

  // A rectangle in a wall's own terms (a0..a1 along it, d0..d1 into the
  // room) as a room rectangle { x0, x1, z0, z1 }.
  function wallRect(wall, a0, a1, d0, d1) {
    var xs = [];
    var zs = [];
    [a0, a1].forEach(function (a) {
      [d0, d1].forEach(function (d) {
        xs.push(wall.ox + wall.dx * a + wall.nx * d);
        zs.push(wall.oz + wall.dz * a + wall.nz * d);
      });
    });
    return {
      x0: Math.min.apply(null, xs),
      x1: Math.max.apply(null, xs),
      z0: Math.min.apply(null, zs),
      z1: Math.max.apply(null, zs),
    };
  }

  // A room rectangle in a wall's terms.
  function toWall(wall, r) {
    var as = [];
    var ds = [];
    [r.x0, r.x1].forEach(function (x) {
      [r.z0, r.z1].forEach(function (z) {
        as.push((x - wall.ox) * wall.dx + (z - wall.oz) * wall.dz);
        ds.push((x - wall.ox) * wall.nx + (z - wall.oz) * wall.nz);
      });
    });
    return {
      a0: Math.min.apply(null, as),
      a1: Math.max.apply(null, as),
      d0: Math.min.apply(null, ds),
      d1: Math.max.apply(null, ds),
    };
  }

  function overlaps(a, b) {
    return a.x0 < b.x1 - EPS && a.x1 > b.x0 + EPS && a.z0 < b.z1 - EPS && a.z1 > b.z0 + EPS;
  }

  function inside(r, room) {
    if (r.x0 < -EPS || r.z0 < -EPS || r.x1 > room.w + EPS || r.z1 > room.l + EPS) return false;
    return !cutsOf(room).some(function (c) {
      return overlaps(r, c);
    });
  }

  // -------------------------------------------------------------------
  // Fixtures in the room
  // -------------------------------------------------------------------
  // sizes: { type: { span, depth, height } } from the picked products
  // (see BathroomRoom3D.itemSizes()); missing types use TYPES' defaults.
  function sizeOf(item, sizes) {
    var base = TYPES[item.type].size;
    var s = (sizes && sizes[item.type]) || {};
    return {
      span: s.span > 0 ? s.span : base.span,
      depth: s.depth > 0 ? s.depth : base.depth,
      height: s.height > 0 ? s.height : base.height,
    };
  }

  // Everything about one fixture where it stands now:
  //   body:  the room it takes up
  //   zones: floor that must stay clear, each { rect, kind, need (in.) }
  //   step:  a tub's or shower's front strip, where some `need` wide
  //          stretch must stay clear
  function geometry(item, room, sizes) {
    var t = TYPES[item.type];
    var wall = walls(room)[item.wall];
    var size = sizeOf(item, sizes);
    var half = size.span / 2;
    var a = item.offset;
    var g = {
      item: item,
      room: room,
      wall: wall,
      size: size,
      a0: a - half,
      a1: a + half,
      body: wallRect(wall, a - half, a + half, 0, size.depth),
      zones: [],
      step: null,
    };
    if (t.side) {
      var s = t.side * IN;
      g.zones.push({ rect: wallRect(wall, a - s, a + s, 0, size.depth), kind: "side", need: t.side });
    }
    if (t.sideGap) {
      var gap = t.sideGap * IN;
      g.zones.push({
        rect: wallRect(wall, a - half - gap, a + half + gap, 0, size.depth),
        kind: "side",
        need: t.sideGap,
        gap: true,
      });
    }
    if (t.front) {
      var fw = t.front.width ? Math.max(t.front.width * IN, size.span) / 2 : half;
      var frontRect = wallRect(wall, a - fw, a + fw, size.depth, size.depth + t.front.depth * IN);
      if (t.step) {
        g.step = { rect: frontRect, need: t.step, depthNeed: t.front.depth };
      } else {
        g.zones.push({ rect: frontRect, kind: "front", need: t.front.depth });
      }
    }
    if (t.swing) {
      g.zones.push({
        rect: wallRect(wall, a - half, a + half, 0, size.depth + t.swing * IN),
        kind: "swing",
        need: t.swing,
      });
    }
    return g;
  }

  // The longest clear stretch (feet) along a tub's or shower's front strip,
  // inside the room, with other fixtures' bodies taken out.
  function clearStretch(g, others) {
    var wall = g.wall;
    var strip = toWall(wall, g.step.rect);
    // The strip must fit in the room to count at all.
    if (strip.d1 > frontDepth(g.room, wall, strip.a0, strip.a1) + EPS) return 0;
    var blocked = [];
    others.forEach(function (o) {
      if (o.item.type === "door" || !overlaps(o.body, g.step.rect)) return;
      var r = toWall(wall, o.body);
      blocked.push([Math.max(r.a0, strip.a0), Math.min(r.a1, strip.a1)]);
    });
    blocked.sort(function (p, q) {
      return p[0] - q[0];
    });
    var best = 0;
    var cursor = Math.max(strip.a0, 0);
    var end = Math.min(strip.a1, wall.span);
    blocked.forEach(function (b) {
      if (b[0] > cursor) best = Math.max(best, b[0] - cursor);
      cursor = Math.max(cursor, b[1]);
    });
    if (end > cursor) best = Math.max(best, end - cursor);
    return best;
  }

  // How far (feet) from a fixture's center to the nearest wall end or other
  // fixture beside it, within its depth, on the side `dir` (+1 right, -1 left).
  function sideRoom(g, others, dir) {
    var wall = g.wall;
    var a = g.item.offset;
    var dist = dir > 0 ? wall.span - a : a;
    var what = "wall";
    others.forEach(function (o) {
      var r = toWall(wall, o.body);
      if (r.d0 >= g.size.depth - EPS || r.d1 <= EPS) return;
      var near = dir > 0 ? r.a0 - a : a - r.a1;
      if (near >= -EPS && near < dist) {
        dist = near;
        what = o.item.id;
      }
    });
    return { dist: Math.max(0, dist), what: what };
  }

  // Clear floor (feet) in front of a fixture, across its own width (or the
  // front width it needs), to the nearest other fixture or the far wall.
  function frontRoom(g, others) {
    var wall = g.wall;
    var t = TYPES[g.item.type];
    var half = t.front && t.front.width ? Math.max(t.front.width * IN, g.size.span) / 2 : g.size.span / 2;
    var a = g.item.offset;
    var dist = frontDepth(g.room, wall, a - half, a + half) - g.size.depth;
    var what = "wall";
    others.forEach(function (o) {
      // A doorway in front of a fixture is a way out, not in the way.
      if (o.item.type === "door") return;
      var r = toWall(wall, o.body);
      if (r.a1 <= a - half + EPS || r.a0 >= a + half - EPS) return;
      if (r.d1 <= g.size.depth + EPS) return;
      var near = r.d0 - g.size.depth;
      if (near < dist) {
        dist = Math.max(0, near);
        what = o.item.id;
      }
    });
    return { dist: dist, what: what };
  }

  function issue(level, code, extra) {
    return Object.assign({ level: level, code: code }, extra || {});
  }

  // What's wrong with each fixture where it stands: { itemId: [issues] }.
  // An issue is { level: "error" | "warn", code, other (an item id or
  // "wall" or "ceiling"), need, have (inches) }:
  //   outside     it sticks out past the walls or is deeper than the room
  //   tooTall     it's taller than the ceiling
  //   overlap     it overlaps another fixture
  //   side        too close beside it (a toilet's 15 in., a sink's gap)
  //   front       not enough clear floor in front
  //   step        no 30 in. (shower 24 in.) wide spot to step into it
  //   swing       it stands in a door's swing
  //   blocking    it stands in another fixture's clear floor
  //   offStack    away from the plumbing wall: needs a drain run (warn)
  //   noStack     too far from the plumbing wall for a drain to reach
  //   tightSide / tightFront   fits, but less than recommended (warn)
  function validate(design, sizes, onlyIds) {
    var room = design.room;
    var geos = design.items.map(function (it) {
      return geometry(it, room, sizes);
    });
    var out = {};
    geos.forEach(function (g) {
      out[g.item.id] = [];
    });
    geos.forEach(function (g, i) {
      if (onlyIds && onlyIds.indexOf(g.item.id) === -1) return;
      var list = out[g.item.id];
      var others = geos.filter(function (o, j) {
        return j !== i;
      });
      var t = TYPES[g.item.type];
      if (!inside(g.body, room) || g.size.depth > frontDepth(room, g.wall, g.a0, g.a1) + EPS) {
        list.push(issue("error", "outside", { other: "wall" }));
      }
      if (g.size.height > room.h + EPS) {
        list.push(
          issue("error", "tooTall", {
            other: "ceiling",
            need: Math.round(g.size.height * 12),
            have: Math.round(room.h * 12),
          }),
        );
      }
      others.forEach(function (o) {
        if (overlaps(g.body, o.body)) list.push(issue("error", "overlap", { other: o.item.id }));
      });
      plumbingIssues(design, g.item, sizes).forEach(function (x) {
        list.push(x);
      });
      // Its own clear spaces: inside the room, and nothing standing in them.
      g.zones.forEach(function (z) {
        if (z.kind === "swing") {
          if (!inside(z.rect, room)) list.push(issue("error", "outside", { other: "wall" }));
          return;
        }
        if (z.kind === "side") {
          /** @type {{ have: number, what: string } | null} */
          var worst = null;
          [-1, 1].forEach(function (dir) {
            var room2 = sideRoom(g, others, dir);
            var have = z.gap ? room2.dist - g.size.span / 2 : room2.dist;
            var need = z.need * IN;
            // A pedestal sink may stand right against a wall; only other
            // fixtures need the gap.
            if (z.gap && room2.what === "wall") return;
            if (have < need - EPS && (!worst || have < worst.have)) worst = { have: have, what: room2.what };
          });
          if (worst) {
            list.push(
              issue("error", "side", {
                other: worst.what,
                need: z.need,
                have: Math.max(0, Math.floor(worst.have * 12 + EPS)),
              }),
            );
          }
          return;
        }
        if (z.kind === "front") {
          var fr = frontRoom(g, others);
          if (fr.dist < z.need * IN - EPS) {
            list.push(
              issue("error", "front", {
                other: fr.what,
                need: z.need,
                have: Math.max(0, Math.floor(fr.dist * 12 + EPS)),
              }),
            );
          }
        }
      });
      if (g.step) {
        var run = clearStretch(g, others);
        var fr2 = frontRoom(g, []);
        if (fr2.dist < g.step.depthNeed * IN - EPS) {
          list.push(
            issue("error", "front", {
              other: "wall",
              need: g.step.depthNeed,
              have: Math.max(0, Math.floor(fr2.dist * 12 + EPS)),
            }),
          );
        } else if (run < g.step.need * IN - EPS) {
          list.push(issue("error", "step", { need: g.step.need, have: Math.max(0, Math.floor(run * 12 + EPS)) }));
        }
      }
      // Standing in someone else's clear space. A doorway may open onto a
      // fixture's clear floor; only the door's own swing must stay clear.
      others.forEach(function (o) {
        o.zones.forEach(function (z) {
          if (z.kind === "side" && z.gap) return;
          if (g.item.type === "door" && z.kind !== "side") return;
          if (!overlaps(g.body, z.rect)) return;
          if (z.kind === "swing") list.push(issue("error", "swing", { other: o.item.id }));
          else list.push(issue("error", "blocking", { other: o.item.id }));
        });
      });
      // Roomier recommendations, once it fits at all.
      if (!list.some(isError) && t.recommend) {
        if (t.recommend.side) {
          var l = sideRoom(g, others, -1);
          var r = sideRoom(g, others, 1);
          var tight = l.dist < r.dist ? l : r;
          if (tight.dist < t.recommend.side * IN - EPS) {
            list.push(
              issue("warn", "tightSide", {
                other: tight.what,
                need: t.recommend.side,
                have: Math.floor(tight.dist * 12 + EPS),
              }),
            );
          }
        }
        if (t.recommend.front) {
          var f = frontRoom(g, others);
          if (f.dist < t.recommend.front * IN - EPS) {
            list.push(
              issue("warn", "tightFront", {
                other: f.what,
                need: t.recommend.front,
                have: Math.floor(f.dist * 12 + EPS),
              }),
            );
          }
        }
      }
      // One message per problem and other fixture.
      var seen = {};
      out[g.item.id] = list.filter(function (x) {
        var key = x.code + "|" + (x.other || "");
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });
    });
    return out;
  }

  function isError(x) {
    return x.level === "error";
  }

  function errorsOf(issues, id) {
    return (issues[id] || []).filter(isError);
  }

  function hasErrors(issues) {
    return Object.keys(issues).some(function (id) {
      return errorsOf(issues, id).length > 0;
    });
  }

  // -------------------------------------------------------------------
  // Finding spots
  // -------------------------------------------------------------------
  function withItem(design, item) {
    return Object.assign({}, design, {
      items: design.items
        .filter(function (it) {
          return it.id !== item.id;
        })
        .concat([item]),
    });
  }

  // Whether `item` can stand where it says among `design`'s other items
  // without anything (it or them) gaining an error.
  function fitsAmong(design, item, sizes, baseIssues) {
    var trial = withItem(design, item);
    var issues = validate(trial, sizes);
    if (errorsOf(issues, item.id).length) return false;
    return trial.items.every(function (it) {
      if (it.id === item.id) return true;
      var before = baseIssues ? errorsOf(baseIssues, it.id).length : 0;
      return errorsOf(issues, it.id).length <= before;
    });
  }

  // Whether a fixture fills the inside corner at either end of its wall
  // (the outside corner of a cutout is no corner to tuck into).
  function nearCorner(wall, a0, a1) {
    return { left: wall.inStart !== false && a0 < 2 * IN, right: wall.inEnd !== false && a1 > wall.span - 2 * IN };
  }

  // How good a spot is for a fixture (higher is better). Hard rules are
  // validate()'s; this only prefers: tubs filling an alcove, showers in a
  // corner, the wet fixtures near each other, a toilet tucked beside
  // something rather than in the middle of a wall or facing the door,
  // a vanity facing the door, and more room in front.
  function scoreSpot(design, item, sizes) {
    var room = design.room;
    var g = geometry(item, room, sizes);
    var others = design.items
      .filter(function (it) {
        return it.id !== item.id;
      })
      .map(function (it) {
        return geometry(it, room, sizes);
      });
    var t = TYPES[item.type];
    var corner = nearCorner(g.wall, g.a0, g.a1);
    var score = 0;
    var doors = others.filter(function (o) {
      return o.item.type === "door";
    });
    if (item.type === "tub") {
      if (corner.left && corner.right) score += 60;
      else if (corner.left || corner.right) score += 25;
      // A tub on a short wall reads as the classic alcove.
      if (g.wall.span <= frontDepth(room, g.wall, 0, g.wall.span)) score += 8;
    }
    if (item.type === "shower") {
      if (corner.left && corner.right) score += 30;
      else if (corner.left || corner.right) score += 30;
    }
    if (item.type === "cabinet" && (corner.left || corner.right)) score += 10;
    if (item.type === "vanity" || item.type === "sink") {
      if (corner.left || corner.right) score += 6;
    }
    if (t.wet) {
      // Every foot of drain line away from the stack is money, so the
      // stack wall wins unless the room gives it no room.
      score -= stackRun(design, item, sizes) * 6;
      var wets = others.filter(function (o) {
        return TYPES[o.item.type].wet;
      });
      if (wets.length) {
        var nearest = Infinity;
        wets.forEach(function (o) {
          var dx = Math.max(0, o.body.x0 - g.body.x1, g.body.x0 - o.body.x1);
          var dz = Math.max(0, o.body.z0 - g.body.z1, g.body.z0 - o.body.z1);
          nearest = Math.min(nearest, Math.sqrt(dx * dx + dz * dz));
          if (o.wall.id === g.wall.id) score += 6;
        });
        score -= nearest * 4;
      }
    }
    if (item.type === "toilet") {
      var l = sideRoom(g, others, -1);
      var r = sideRoom(g, others, 1);
      // Nestled: something (or a wall) close on at least one side.
      if (Math.min(l.dist, r.dist) < 24 * IN) score += 10;
      if (l.what !== "wall" || r.what !== "wall") score += 6;
      // The recommended 18 in. each side beats the bare 15.
      if (Math.min(l.dist, r.dist) >= 18 * IN - EPS) score += 8;
    }
    doors.forEach(function (d) {
      if (d.wall.id === g.wall.id) score -= item.type === "toilet" ? 8 : 3;
      var opposite = d.wall.nx === -g.wall.nx && d.wall.nz === -g.wall.nz;
      if (opposite) {
        var center = (d.body.x0 + d.body.x1) / 2;
        var cz = (d.body.z0 + d.body.z1) / 2;
        var mine = (g.body.x0 + g.body.x1) / 2;
        var mz = (g.body.z0 + g.body.z1) / 2;
        var lined = g.wall.dz === 0 ? Math.abs(center - mine) < 1.5 : Math.abs(cz - mz) < 1.5;
        if (lined && item.type === "toilet") score -= 12;
        if (lined && (item.type === "vanity" || item.type === "sink")) score += 6;
      }
    });
    if (t.front) {
      var f = frontRoom(g, others);
      score += Math.min(f.dist, 4) * 2;
      if (t.recommend && t.recommend.front && f.dist < t.recommend.front * IN - EPS) score -= 5;
    }
    return score;
  }

  // The offsets on `wallId` that put `item` exactly against what's
  // already there (its own body and clearances touching theirs) or into a
  // corner: the positions a grid search is most likely to miss.
  function tightSpots(design, item, sizes, wallId, span) {
    var t = TYPES[item.type];
    var size = sizeOf(item, sizes);
    var half = size.span / 2;
    // How far the fixture claims each side of its center.
    var reach = Math.max(half, (t.side || 0) * IN, half + (t.sideGap || 0) * IN);
    var edges = [];
    design.items.forEach(function (other) {
      if (other.id === item.id || other.wall !== wallId) return;
      var g = geometry(other, design.room, sizes);
      edges.push([g.a0, g.a1]);
      g.zones.forEach(function (z) {
        if (z.kind !== "side") return;
        var w = toWall(g.wall, z.rect);
        edges.push([w.a0, w.a1]);
      });
    });
    var out = [reach, span - reach];
    edges.forEach(function (e) {
      out.push(e[0] - reach, e[1] + reach);
    });
    return out
      .map(function (a) {
        return round(a, 4);
      })
      .filter(function (a) {
        return a >= half - EPS && a <= span - half + EPS;
      });
  }

  // Every spot on every wall where `item` fits, best first, as
  // [{ wall, offset, score }]. step: search spacing in feet (1 in.).
  function findSpots(design, item, sizes, opts) {
    opts = opts || {};
    var room = design.room;
    var base = validate(design, sizes);
    var size = sizeOf(item, sizes);
    var step = opts.step || IN;
    var out = [];
    var ids = opts.walls || wallIds(room);
    ids.forEach(function (wid) {
      var span = wallSpan(room, wid);
      var half = size.span / 2;
      if (span < size.span - EPS) return;
      var positions = [];
      for (var a = half; a <= span - half + EPS; a += step) positions.push(Math.min(a, span - half));
      if (positions[positions.length - 1] < span - half - EPS) positions.push(span - half);
      // In a tight room the only spot that works can be the one flush
      // against what's already on the wall, which a grid walks straight
      // past. So the exact flush positions are candidates too.
      tightSpots(design, item, sizes, wid, span).forEach(function (a2) {
        positions.push(a2);
      });
      positions.sort(function (p, q) {
        return p - q;
      });
      positions = positions.filter(function (a2, i) {
        return i === 0 || a2 - positions[i - 1] > EPS;
      });
      positions.forEach(function (a) {
        var cand = Object.assign({}, item, { wall: wid, offset: round(a, 4) });
        if (!fitsAmong(design, cand, sizes, base)) return;
        var score = scoreSpot(design, cand, sizes);
        if (opts.near) {
          var g0 = geometry(opts.near, room, sizes);
          var g1 = geometry(cand, room, sizes);
          var cx = (g0.body.x0 + g0.body.x1 - g1.body.x0 - g1.body.x1) / 2;
          var cz = (g0.body.z0 + g0.body.z1 - g1.body.z0 - g1.body.z1) / 2;
          score -= Math.sqrt(cx * cx + cz * cz) * (opts.nearWeight || 3);
        }
        out.push({ wall: wid, offset: cand.offset, score: score });
      });
    });
    out.sort(function (p, q) {
      return q.score - p.score || ids.indexOf(p.wall) - ids.indexOf(q.wall) || p.offset - q.offset;
    });
    return out;
  }

  var idCounter = 0;
  function newId(design) {
    var used = {};
    design.items.forEach(function (it) {
      used[it.id] = true;
    });
    var id;
    do {
      idCounter++;
      id = "f" + idCounter;
    } while (used[id]);
    return id;
  }

  // A new fixture at the best spot for it. Returns { design, item, placed }:
  // placed is false when nothing fits, and the fixture is then put in the
  // least-bad spot so the person can see it and make room.
  function addItem(design, type, sizes, opts) {
    var item = {
      id: newId(design),
      type: type,
      wall: wallIds(design.room)[0],
      offset: 0,
      opts: Object.assign(defaultOpts(type), opts || {}),
    };
    var spots = findSpots(design, item, sizes, { step: 2 * IN });
    var placed = spots.length > 0;
    if (placed) {
      item.wall = spots[0].wall;
      item.offset = spots[0].offset;
    } else {
      var spot = leastBad(design, item, sizes);
      item.wall = spot.wall;
      item.offset = spot.offset;
    }
    return { design: withItem(design, item), item: item, placed: placed };
  }

  // The spot with the fewest problems, for a fixture that doesn't fit
  // anywhere: the middle of the longest wall it can stand against. A spot
  // that only flags the newcomer beats one that also upsets what's
  // already in the room.
  function leastBad(design, item, sizes) {
    var room = design.room;
    var size = sizeOf(item, sizes);
    var base = validate(design, sizes);
    /** @type {{ wall: string, offset: number, errs: number, span: number } | null} */
    var best = null;
    wallIds(room).forEach(function (wid) {
      var span = wallSpan(room, wid);
      var half = Math.min(size.span / 2, span / 2);
      [half, span / 2, span - half].forEach(function (a) {
        var cand = Object.assign({}, item, { wall: wid, offset: round(a, 4) });
        var issues = validate(withItem(design, cand), sizes);
        var hurt = design.items.reduce(function (sum, it) {
          return sum + Math.max(0, errorsOf(issues, it.id).length - errorsOf(base, it.id).length);
        }, 0);
        var errs = errorsOf(issues, cand.id).length + hurt * 3;
        if (!best || errs < best.errs || (errs === best.errs && span > best.span)) {
          best = { wall: wid, offset: cand.offset, errs: errs, span: span };
        }
      });
    });
    return best;
  }

  // Arranges every fixture except the doors (they're where the room's door
  // is). Tries spots for each fixture in ARRANGE_ORDER, keeping the best
  // few partial arrangements at each step (a beam search), so a fixture
  // placed early never boxes out a later one when another spot would have
  // worked. Returns up to `count` different arrangements, best first, each
  // { items, placed (how many fit), score }.
  function arrange(design, sizes, opts) {
    opts = opts || {};
    var count = opts.count || 3;
    var beamWidth = opts.beam || 14;
    var perItem = opts.perItem || 6;
    var fixed = design.items.filter(function (it) {
      return it.type === "door";
    });
    var movable = design.items
      .filter(function (it) {
        return it.type !== "door";
      })
      .slice()
      .sort(function (a, b) {
        var oa = ARRANGE_ORDER.indexOf(a.type);
        var ob = ARRANGE_ORDER.indexOf(b.type);
        if (oa !== ob) return oa - ob;
        // Bigger first within a type.
        return sizeOf(b, sizes).span - sizeOf(a, sizes).span;
      });
    var beam = [{ items: fixed.slice(), placed: 0, score: 0, left: [] }];
    movable.forEach(function (item) {
      var next = [];
      beam.forEach(function (state) {
        var partial = Object.assign({}, design, { items: state.items });
        var spots = findSpots(partial, item, sizes, { step: 2 * IN });
        // A spread of walls among the best spots, so the beam keeps real
        // alternatives instead of the same spot nudged an inch: the best
        // spot on each wall first, then the next best anywhere.
        var chosen = [];
        var perWall = {};
        var take = function (s, cap) {
          if (chosen.length >= perItem) return;
          if ((perWall[s.wall] || 0) >= cap) return;
          if (
            chosen.some(function (c) {
              return c.wall === s.wall && Math.abs(c.offset - s.offset) < 0.75;
            })
          )
            return;
          perWall[s.wall] = (perWall[s.wall] || 0) + 1;
          chosen.push(s);
        };
        spots.forEach(function (s) {
          take(s, 1);
        });
        spots.forEach(function (s) {
          take(s, Math.ceil(perItem / 2));
        });
        chosen.forEach(function (s) {
          var placedItem = Object.assign({}, item, { wall: s.wall, offset: s.offset });
          next.push({
            items: state.items.concat([placedItem]),
            placed: state.placed + 1,
            score: state.score + s.score,
            left: state.left,
          });
        });
        if (!chosen.length) {
          next.push({
            items: state.items,
            placed: state.placed,
            score: state.score - 100,
            left: state.left.concat([item]),
          });
        }
      });
      next.sort(function (p, q) {
        return q.placed - p.placed || q.score - p.score;
      });
      beam = next.slice(0, beamWidth);
    });
    // Fixtures that fit nowhere go back where they were (or the least-bad
    // spot), flagged by validate().
    var results = beam.map(function (state) {
      var items = state.items.slice();
      state.left.forEach(function (item) {
        var partial = Object.assign({}, design, { items: items });
        var spot = leastBad(partial, item, sizes);
        items.push(Object.assign({}, item, { wall: spot.wall, offset: spot.offset }));
      });
      // Keep the design's own order, so lists don't jump around.
      var order = {};
      design.items.forEach(function (it, i) {
        order[it.id] = i;
      });
      items.sort(function (a, b) {
        return order[a.id] - order[b.id];
      });
      return { items: items, placed: state.placed, total: movable.length, score: state.score };
    });
    // When some layouts fit everything, the ones that leave something out
    // aren't worth offering.
    var complete = results.filter(function (r) {
      return r.placed === r.total;
    });
    if (complete.length) results = complete;
    // Different enough to be worth showing: fixtures on different walls
    // first, then the same walls in other spots.
    var out = [];
    var seenWalls = {};
    var seen = {};
    function sigOf(r, withSpot) {
      return r.items
        .map(function (it) {
          return it.id + ":" + it.wall + (withSpot ? ":" + Math.round(it.offset * 2) : "");
        })
        .join("|");
    }
    results.forEach(function (r) {
      var w = sigOf(r, false);
      if (out.length >= count || seenWalls[w]) return;
      seenWalls[w] = true;
      seen[sigOf(r, true)] = true;
      out.push(r);
    });
    results.forEach(function (r) {
      var s = sigOf(r, true);
      if (out.length >= count || seen[s]) return;
      seen[s] = true;
      out.push(r);
    });
    out.sort(function (p, q) {
      return q.placed - p.placed || q.score - p.score;
    });
    // Each layout settled: a fixture left closer to a neighbour than
    // recommended slides over when the wall has the room (see settle()).
    out = out.map(function (r) {
      return Object.assign({}, r, { items: settle(Object.assign({}, design, { items: r.items }), sizes) });
    });
    return out;
  }

  // Where a fixture being dragged goes with the pointer over room point
  // (x, z): against the nearest wall, at that point along it, snapped to a
  // corner within 3 in. When that spot doesn't work, the nearest one on the
  // same wall that does (within `reach` feet, 3 by default), so it slides into place
  // instead of refusing. { wall, offset, valid, snapped }.
  function snap(design, itemId, x, z, sizes, reach) {
    var item = design.items.filter(function (it) {
      return it.id === itemId;
    })[0];
    if (!item) return null;
    var room = design.room;
    var size = sizeOf(item, sizes);
    x = clamp(x, 0, room.w);
    z = clamp(z, 0, room.l);
    // The pointer is roughly on the fixture's middle, half its depth out
    // from the wall: measure to the walls from there.
    var fits = wallList(room).filter(function (wall) {
      return wall.span >= size.span - EPS;
    });
    if (!fits.length) return { wall: item.wall, offset: item.offset, valid: false, snapped: false };
    var near = nearestWall(fits, x, z, size.depth / 2);
    var best = { wall: near.wall.id, along: near.along };
    var span = wallSpan(room, best.wall);
    var half = size.span / 2;
    var want = clamp(best.along, half, span - half);
    var snapped = false;
    if (want - half < 3 * IN) {
      want = half;
      snapped = true;
    } else if (span - half - want < 3 * IN) {
      want = span - half;
      snapped = true;
    }
    var others = Object.assign({}, design, {
      items: design.items.filter(function (it) {
        return it.id !== itemId;
      }),
    });
    var base = validate(others, sizes);
    var test = function (a) {
      return fitsAmong(others, Object.assign({}, item, { wall: best.wall, offset: round(a, 4) }), sizes, base);
    };
    if (test(want)) return { wall: best.wall, offset: round(want, 4), valid: true, snapped: snapped };
    reach = reach === undefined ? 3 : reach;
    for (var d = IN; d <= reach + EPS; d += IN) {
      var options = [want - d, want + d].filter(function (a) {
        return a >= half - EPS && a <= span - half + EPS;
      });
      for (var i = 0; i < options.length; i++) {
        if (test(options[i])) return { wall: best.wall, offset: round(options[i], 4), valid: true, snapped: true };
      }
    }
    return { wall: best.wall, offset: round(want, 4), valid: false, snapped: false };
  }

  // Distances around a fixture, for the labels while it's selected or
  // dragged: { left, right, front } each { dist (feet), what }.
  function measure(design, itemId, sizes) {
    var room = design.room;
    var geos = design.items.map(function (it) {
      return geometry(it, room, sizes);
    });
    var g = geos.filter(function (x) {
      return x.item.id === itemId;
    })[0];
    if (!g) return null;
    var others = geos.filter(function (x) {
      return x !== g;
    });
    var half = g.size.span / 2;
    var l = sideRoom(g, others, -1);
    var r = sideRoom(g, others, 1);
    return {
      left: { dist: Math.max(0, l.dist - half), what: l.what },
      right: { dist: Math.max(0, r.dist - half), what: r.what },
      front: frontRoom(g, others),
      fromLeftCorner: g.a0,
    };
  }

  // -------------------------------------------------------------------
  // For the 3D room
  // -------------------------------------------------------------------
  // What js/bathroom-room-3d.js draws: one placement per fixture, plus the
  // mirror over each vanity or sink that has one, the glass door and shelf
  // of a shower. Same shape as BathroomRoomLayout.computeLayout()'s, with
  // itemId so a click in the room finds the fixture again.
  var MIRROR_MOUNT = { standard: 3.2, large: 3.0 };

  function toPlacements(design, sizes) {
    var room = design.room;
    var byKey = {};
    var out = [];
    function next(key) {
      byKey[key] = (byKey[key] || 0) + 1;
      return byKey[key] - 1;
    }
    design.items.forEach(function (item) {
      var t = TYPES[item.type];
      var g = geometry(item, room, sizes);
      var wall = g.wall;
      var x = wall.ox + wall.dx * item.offset;
      var z = wall.oz + wall.dz * item.offset;
      var p = {
        itemId: item.id,
        fixtureKey: t.fixtureKey,
        index: next(t.fixtureKey),
        x: x,
        y: 0,
        z: z,
        rotationY: wall.rotY,
        wallId: wall.id,
        offsetFt: item.offset,
      };
      if (item.type === "door") p.hasDoor = (item.opts || {}).kind !== "opening";
      out.push(p);
      var opts = item.opts || {};
      if ((item.type === "vanity" || item.type === "sink") && opts.mirror && opts.mirror !== "none") {
        var mkey = opts.mirror === "large" ? "Mirror_Huge_Quantity" : "Mirror_Quantity";
        out.push({
          itemId: item.id,
          fixtureKey: mkey,
          index: next(mkey),
          x: x,
          y: MIRROR_MOUNT[opts.mirror] || 3.2,
          z: z,
          rotationY: wall.rotY,
          wallId: wall.id,
          attachedTo: { fixtureKey: t.fixtureKey, index: p.index },
        });
      }
      if (item.type === "shower") {
        if (opts.glassDoor) {
          out.push({
            itemId: item.id,
            fixtureKey: "Shower_Door_Quantity",
            index: next("Shower_Door_Quantity"),
            x: x,
            y: 0,
            z: z,
            rotationY: wall.rotY,
            wallId: wall.id,
            attachedTo: { fixtureKey: "Shower_Quantity", index: p.index },
            depthOffset: g.size.depth,
          });
        }
        if (opts.shelf) {
          out.push({
            itemId: item.id,
            fixtureKey: "Shower_Shelf_Quantity",
            index: next("Shower_Shelf_Quantity"),
            x: x,
            y: 4,
            z: z,
            rotationY: wall.rotY,
            wallId: wall.id,
            attachedTo: { fixtureKey: "Shower_Quantity", index: p.index },
          });
        }
      }
    });
    return out;
  }

  // Floor outlines for the plan view and while editing: each fixture's
  // body and its clear spaces, as room rectangles.
  function outlines(design, sizes) {
    return design.items.map(function (item) {
      var g = geometry(item, design.room, sizes);
      var zones = g.zones.map(function (z) {
        return { rect: z.rect, kind: z.kind };
      });
      if (g.step) zones.push({ rect: g.step.rect, kind: "step" });
      return { id: item.id, type: item.type, body: g.body, zones: zones };
    });
  }

  // -------------------------------------------------------------------
  // Plumbing: the stack wall, and how far a drain can run from it
  // -------------------------------------------------------------------
  // A bathroom's drains join a soil stack, which lives inside a wall.
  // Fixtures on a wall with plumbing in it tie straight in; anything on
  // another wall needs a drain line run around to it, under the floor,
  // falling about a quarter inch per foot. That run costs money and can't
  // go on forever, so where the plumbing is decides what layouts are real.
  //
  // design.room.wet is that wall ("N", "E", "S" or "W"), or a list of
  // them when pipes come in through more than one (a tub on one wall, the
  // toilet and vanity on another). Saved designs from before that hold a
  // single wall, which still reads the same. The run is measured the way
  // a plumber would route it: around the room's perimeter from the
  // fixture to the nearest end of the nearest plumbing wall.
  //
  // A toilet's 3 in. soil line is the fussy one (it needs the fall and a
  // big hole in the floor); a sink's 1.5 in. line travels much further.
  // FREE_RUN is the bit of slack that comes with cutting in at the corner.
  var STACK_LIMIT = { toilet: 10, tub: 14, shower: 14, vanity: 16, sink: 16 };
  // A fixture a few feet along from the stack wall ties in with ordinary
  // pipe under the floor and no one thinks twice; past that it's a job.
  var FREE_RUN = 3;

  // The plumbing walls a room's `wet` names, in wall order, each once:
  // a wall id or a list of them, with anything that isn't a wall of this
  // room dropped. Empty when it names none.
  function wetWalls(room, wet) {
    var list = Array.isArray(wet) ? wet : [wet];
    return wallIds(room).filter(function (wid) {
      return list.indexOf(wid) !== -1;
    });
  }

  // Every wall with plumbing in it (the first wall when the design names
  // none), and the first of them, for anything that wants just one.
  function stackWalls(design) {
    if (!design || !design.room) return ["N"];
    var list = wetWalls(design.room, design.room.wet);
    return list.length ? list : [wallIds(design.room)[0]];
  }

  function stackWall(design) {
    return stackWalls(design)[0];
  }

  // Whether the design says where the stack is. A design being arranged
  // from scratch doesn't yet: the layout decides, and the stack follows.
  function hasStack(design) {
    return !!design && !!design.room && wetWalls(design.room, design.room.wet).length > 0;
  }

  // How `wet` is kept: one wall as its id, as designs always held it,
  // several as a list.
  function wetValue(list) {
    return list.length === 1 ? list[0] : list.slice();
  }

  // Distance around the room's perimeter from wall A's left end,
  // clockwise. The walls chain head to tail (A ends where B starts, and so
  // on), so a wall's own offset adds straight onto where that wall begins.
  function perimeterAt(room, wallId, a) {
    return walls(room)[wallId].start + a;
  }

  function aroundTo(from, to, total) {
    var d = Math.abs(from - to) % total;
    return Math.min(d, total - d);
  }

  // Feet of new drain line a fixture needs where it stands: 0 on a
  // plumbing wall, otherwise the shorter way around to the nearest end of
  // the nearest plumbing wall. A fixture opposite the only plumbing wall
  // picks up the whole side wall on the way, which is why those runs get
  // long.
  function stackRun(design, item, sizes) {
    return stackReach(design, item, sizes).run;
  }

  // The plumbing wall a fixture's drain runs to, and how far: the wall
  // it stands on when that has plumbing, otherwise the nearest one.
  function nearestStack(design, item, sizes) {
    return stackReach(design, item, sizes).wall;
  }

  function stackReach(design, item, sizes) {
    var t = TYPES[item.type];
    var list = stackWalls(design);
    if (!t || !t.wet || !hasStack(design)) return { wall: list[0], run: 0 };
    if (list.indexOf(item.wall) !== -1) return { wall: item.wall, run: 0 };
    var room = design.room;
    var total = perimeter(room);
    var span = wallSpan(room, item.wall);
    var spots = [item.offset];
    if (t.drainEnd) {
      var half = sizeOf(item, sizes).span / 2;
      spots.push(item.offset - half, item.offset + half);
    }
    var best = { wall: list[0], run: Infinity };
    list.forEach(function (stack) {
      var start = perimeterAt(room, stack, 0);
      var end = start + wallSpan(room, stack);
      spots.forEach(function (a) {
        var me = perimeterAt(room, item.wall, clamp(a, 0, span));
        var run = Math.min(aroundTo(me, start, total), aroundTo(me, end, total));
        if (run < best.run - EPS) best = { wall: stack, run: run };
      });
    });
    return best;
  }

  // What's wrong with a fixture's plumbing where it stands:
  //   offStack  it works, but needs this much new drain line (warn)
  //   noStack   too far from the stack for its drain to fall (error)
  function plumbingIssues(design, item, sizes) {
    var limit = STACK_LIMIT[item.type];
    if (!limit) return [];
    var run = stackRun(design, item, sizes);
    if (run <= FREE_RUN + EPS) return [];
    var extra = {
      other: "stack",
      need: Math.round(limit * 12),
      have: Math.round(run * 12),
      wall: nearestStack(design, item, sizes),
    };
    return [issue(run > limit + EPS ? "error" : "warn", run > limit + EPS ? "noStack" : "offStack", extra)];
  }

  // Total length of every run longer than FREE_RUN, which arranging tries
  // to keep short (billing is drainRun's, below).
  function offStackFeet(design, sizes) {
    return design.items.reduce(function (sum, it) {
      var run = stackRun(design, it, sizes);
      return sum + (run > FREE_RUN ? run : 0);
    }, 0);
  }

  // Feet of new drain line the estimate bills: each fixture's first
  // FREE_RUN feet come with tying in, only the rest is charged.
  function drainRun(design, sizes) {
    return round(
      design.items.reduce(function (sum, it) {
        var run = stackRun(design, it, sizes);
        return sum + Math.max(0, run - FREE_RUN);
      }, 0),
      2,
    );
  }

  // The wall that suits the fixtures already in the room best, so the
  // person can be shown a sensible answer before they confirm it: the one
  // that leaves the least pipe to run, counting a toilet's soil line for
  // more than the rest because it's the one nobody wants to move.
  function suggestStack(design, sizes) {
    /** @type {{ wall: string, total: number } | null} */
    var best = null;
    wallIds(design.room).forEach(function (wid) {
      var trial = setStack(design, wid);
      var total = trial.items.reduce(function (sum, it) {
        return sum + stackRun(trial, it, sizes) * (it.type === "toilet" ? 2.5 : 1);
      }, 0);
      if (!best || total < best.total) best = { wall: wid, total: total };
    });
    return best ? best.wall : wallIds(design.room)[0];
  }

  // Sets the plumbing walls: one wall id, or a list of them. Anything
  // that names no wall of this room leaves the design as it is.
  function setStack(design, walls) {
    var list = wetWalls(design.room, walls);
    if (!list.length) return design;
    return Object.assign({}, design, { room: Object.assign({}, design.room, { wet: wetValue(list) }) });
  }

  // Adds a wall to the plumbing walls, or takes it off. The last one
  // stays: drains have to run somewhere.
  function toggleStack(design, wallId) {
    if (!isWall(design.room, wallId)) return design;
    var list = hasStack(design) ? stackWalls(design) : [];
    var on = list.indexOf(wallId) !== -1;
    if (on && list.length === 1) return design;
    return setStack(
      design,
      on
        ? list.filter(function (w) {
            return w !== wallId;
          })
        : list.concat([wallId]),
    );
  }

  // -------------------------------------------------------------------
  // Electrical: outlets, switches, lights and the fan
  // -------------------------------------------------------------------
  // Each point hangs on a wall at a height, except the exhaust fan, which
  // is in the ceiling over the wet part of the room.
  //
  // The rules are the usual US residential ones, as guidance and not a
  // substitute for an electrician: a GFCI receptacle within 36 in. of the
  // outside edge of every basin, no receptacle or switch within 3 ft of a
  // tub or shower, a switch inside the room beside each doorway, a light
  // over the mirror, and an exhaust fan wherever there's a tub or shower.
  var WET_CLEAR = 3; // feet from a tub or shower to a receptacle or switch
  var BASIN_REACH = 3; // feet from a basin's edge to its receptacle
  var ELEC_MARGIN = 0.35; // feet of wall kept clear at each corner
  var ELEC_APART = 0.4; // feet between two points on the same wall

  // dry: keeps its distance from a tub or shower (receptacles and
  // switches); a light may hang over one. margin: wall left clear at a
  // corner, less for a light so it can still center over a vanity there.
  var ELECTRICAL_KINDS = {
    outlet: { height: 3.5, minHeight: 1, plate: { w: 0.31, h: 0.46 }, dry: true, margin: ELEC_MARGIN },
    switch: { height: 4, minHeight: 3, plate: { w: 0.29, h: 0.46 }, dry: true, margin: ELEC_MARGIN },
    light: { height: 6.75, minHeight: 5, plate: { w: 2, h: 0.5 }, margin: 0.1 },
    fan: { ceiling: true },
  };

  function electricalOf(design) {
    return Array.isArray(design.electrical) ? design.electrical : [];
  }

  function withElectrical(design, list) {
    return Object.assign({}, design, { electrical: list });
  }

  // Where a point is in the room: { x, z, y, rotY }. The fan sits in the
  // ceiling over the middle of the wet fixtures (or the room).
  function electricalPose(design, p, sizes) {
    var room = design.room;
    if (p.kind === "fan") {
      var spot = fanSpot(design, sizes);
      return { x: spot.x, z: spot.z, y: room.h, rotY: 0, ceiling: true };
    }
    var wall = walls(room)[p.wall] || wallList(room)[0];
    var at = wallPointOf(wall, p.offset, 0.02);
    return { x: at.x, z: at.z, y: clamp(p.height, 0.3, room.h - 0.2), rotY: wall.rotY, ceiling: false };
  }

  function wallPointOf(wall, a, depth) {
    return { x: wall.ox + wall.dx * a + wall.nx * depth, z: wall.oz + wall.dz * a + wall.nz * depth };
  }

  function fanSpot(design, sizes) {
    var room = design.room;
    var wet = design.items.filter(function (it) {
      return it.type === "tub" || it.type === "shower";
    });
    if (!wet.length) return interiorPoint(room);
    var sx = 0;
    var sz = 0;
    wet.forEach(function (it) {
      var g = geometry(it, room, sizes);
      sx += (g.body.x0 + g.body.x1) / 2;
      sz += (g.body.z0 + g.body.z1) / 2;
    });
    return { x: round(sx / wet.length, 3), z: round(sz / wet.length, 3) };
  }

  // Shortest distance (feet) from a point to a rectangle, 0 inside it.
  function distToRect(x, z, r) {
    var dx = Math.max(r.x0 - x, 0, x - r.x1);
    var dz = Math.max(r.z0 - z, 0, z - r.z1);
    return Math.sqrt(dx * dx + dz * dz);
  }

  // What a wall point would be hidden behind: each fixture body and each
  // mirror, as a patch of wall { wall, a0, a1, y0, y1, id }.
  function wallCoverings(design, sizes) {
    var out = [];
    design.items.forEach(function (item) {
      if (item.type === "door") return;
      var g = geometry(item, design.room, sizes);
      out.push({ wall: item.wall, a0: g.a0, a1: g.a1, y0: 0, y1: g.size.height, id: item.id });
      var mirror = (item.opts || {}).mirror;
      if ((item.type === "vanity" || item.type === "sink") && mirror && mirror !== "none") {
        var tall = mirror === "large" ? 4 : 2.5;
        var mid = MIRROR_MOUNT[mirror] || 3.2;
        var wide = (mirror === "large" ? g.size.span + 0.5 : g.size.span) / 2;
        out.push({
          wall: item.wall,
          a0: item.offset - wide,
          a1: item.offset + wide,
          y0: mid - tall / 2,
          y1: mid + tall / 2,
          id: item.id,
          mirror: true,
        });
      }
    });
    windowsOf(design).forEach(function (w) {
      out.push({
        wall: w.wall,
        a0: w.offset - w.width / 2,
        a1: w.offset + w.width / 2,
        y0: w.sill,
        y1: w.sill + w.height,
        id: w.id,
        window: true,
      });
    });
    return out;
  }

  // What's wrong with one electrical point:
  //   outside   past the end of its wall, or above the ceiling
  //   wet       inside the 3 ft a tub or shower has to itself
  //   behind    hidden behind a fixture or a mirror
  //   crowded   on top of another point
  //   farBasin  (warn) more than 3 ft from the basin it serves
  function electricalIssues(design, sizes, point, coverings, others) {
    var room = design.room;
    var list = [];
    var kind = ELECTRICAL_KINDS[point.kind];
    if (!kind) return list;
    if (kind.ceiling) return list;
    var span = wallSpan(room, point.wall);
    var halfPlate = kind.plate.w / 2;
    if (point.offset - halfPlate < -EPS || point.offset + halfPlate > span + EPS) {
      list.push(issue("error", "outside", { other: "wall" }));
    }
    if (point.height + kind.plate.h / 2 > room.h - EPS || point.height < 0.3) {
      list.push(issue("error", "outside", { other: "ceiling" }));
    }
    var pose = electricalPose(design, point, sizes);
    design.items.forEach(function (it) {
      if (!kind.dry || (it.type !== "tub" && it.type !== "shower")) return;
      var g = geometry(it, room, sizes);
      var d = distToRect(pose.x, pose.z, g.body);
      if (d < WET_CLEAR - EPS) {
        list.push(issue("error", "wet", { other: it.id, need: WET_CLEAR * 12, have: Math.floor(d * 12 + EPS) }));
      }
    });
    (coverings || wallCoverings(design, sizes)).forEach(function (c) {
      if (c.wall !== point.wall) return;
      if (point.offset + halfPlate <= c.a0 + 0.1 || point.offset - halfPlate >= c.a1 - 0.1) return;
      if (point.height + kind.plate.h / 2 <= c.y0 + 0.1 || point.height - kind.plate.h / 2 >= c.y1 - 0.1) return;
      list.push(issue("error", "behind", { other: c.id }));
    });
    (others || []).forEach(function (o) {
      if (o.id === point.id || o.wall !== point.wall || o.kind === "fan") return;
      var gap = Math.abs(o.offset - point.offset) - halfPlate - ELECTRICAL_KINDS[o.kind].plate.w / 2;
      var apart = Math.abs(o.height - point.height) > 0.8;
      if (!apart && gap < ELEC_APART - EPS) list.push(issue("error", "crowded", { other: o.id }));
    });
    if (point.kind === "outlet" && point.for) {
      var basin = design.items.filter(function (it) {
        return it.id === point.for;
      })[0];
      if (basin) {
        var bg = geometry(basin, room, sizes);
        var reach = distToRect(pose.x, pose.z, bg.body);
        if (reach > BASIN_REACH + 0.25) {
          list.push(
            issue("warn", "farBasin", { other: basin.id, need: BASIN_REACH * 12, have: Math.round(reach * 12) }),
          );
        }
      }
    }
    return list;
  }

  // Every electrical point's problems: { id: [issues] }.
  function validateElectrical(design, sizes) {
    var list = electricalOf(design);
    var coverings = wallCoverings(design, sizes);
    var out = {};
    list.forEach(function (p) {
      out[p.id] = electricalIssues(design, sizes, p, coverings, list);
      if (NEEDS_SWITCH[p.kind] && !switchOf(design, p)) out[p.id].push(issue("error", "unswitched", {}));
    });
    return out;
  }

  // Every light and fan is turned on by a switch: its `sw` names the switch
  // point. One switch may run several (the lights by the door), and a
  // switch may run nothing yet.
  var NEEDS_SWITCH = { light: true, fan: true };

  function switchOf(design, point) {
    if (!point || !point.sw) return null;
    return (
      electricalOf(design).filter(function (p) {
        return p.id === point.sw && p.kind === "switch";
      })[0] || null
    );
  }

  // The lights and fan one switch turns on.
  function switchedBy(design, switchId) {
    return electricalOf(design).filter(function (p) {
      return NEEDS_SWITCH[p.kind] && p.sw === switchId;
    });
  }

  // Which switch a light or fan would go on: the fan's own switch for the
  // fan, the switch by the door for a light (else any switch but the
  // fan's). null when there's none to use.
  function usualSwitch(list, kind) {
    var switches = list.filter(function (p) {
      return p.kind === "switch";
    });
    var pick = function (test) {
      return switches.filter(test)[0] || null;
    };
    if (kind === "fan")
      return pick(function (p) {
        return p.for === "fan";
      });
    return (
      pick(function (p) {
        return p.for !== "fan" && p.for !== "room";
      }) ||
      pick(function (p) {
        return p.for !== "fan";
      })
    );
  }

  // Does the basin / doorway have its point? Judged by where the points
  // are, not what they were added for, so a point dragged away no longer
  // counts.
  var SWITCH_REACH = 2.5; // feet from a doorway to its switch
  function pointNear(design, sizes, list, kind, body, reach) {
    return list.some(function (p) {
      if (p.kind !== kind) return false;
      var pose = electricalPose(design, p, sizes);
      return distToRect(pose.x, pose.z, body) <= reach + EPS;
    });
  }
  function basinHasOutlet(design, sizes, list, basin) {
    return pointNear(design, sizes, list, "outlet", geometry(basin, design.room, sizes).body, BASIN_REACH + 0.25);
  }
  function basinHasLight(design, sizes, list, basin) {
    var half = geometry(basin, design.room, sizes).size.span / 2;
    return list.some(function (p) {
      return p.kind === "light" && p.wall === basin.wall && Math.abs(p.offset - basin.offset) <= half + 0.5;
    });
  }
  function doorHasSwitch(design, sizes, list, door) {
    return pointNear(design, sizes, list, "switch", geometry(door, design.room, sizes).body, SWITCH_REACH);
  }

  // Gaps in the electrical, as { code, for }: noOutlet (a basin with no
  // receptacle within reach), noLightOver (a basin with no light over its
  // mirror), noLight (no light at all), noSwitch (a doorway with no switch
  // beside it), noFan (there's a tub or shower), noSwitchFor (a light or
  // fan, by point id, with no switch to turn it on).
  function electricalGaps(design, sizes) {
    var list = electricalOf(design);
    var out = [];
    var has = function (kind) {
      return list.some(function (p) {
        return p.kind === kind;
      });
    };
    var basins = design.items.filter(function (it) {
      return it.type === "vanity" || it.type === "sink";
    });
    var wet = design.items.filter(function (it) {
      return it.type === "tub" || it.type === "shower";
    });
    basins.forEach(function (basin) {
      if (!basinHasOutlet(design, sizes, list, basin)) out.push({ code: "noOutlet", for: basin.id });
    });
    if (!has("light")) out.push({ code: "noLight" });
    else {
      basins.forEach(function (basin) {
        if (!basinHasLight(design, sizes, list, basin)) out.push({ code: "noLightOver", for: basin.id });
      });
    }
    itemsOfType(design, "door").forEach(function (door) {
      if (!doorHasSwitch(design, sizes, list, door)) out.push({ code: "noSwitch", for: door.id });
    });
    if (wet.length && !has("fan")) out.push({ code: "noFan" });
    list.forEach(function (p) {
      if (NEEDS_SWITCH[p.kind] && !switchOf(design, p)) out.push({ code: "noSwitchFor", for: p.id });
    });
    return out;
  }

  function itemsOfType(design, type) {
    return design.items.filter(function (it) {
      return it.type === type;
    });
  }

  // The wall round the corner from this one: dir +1 past its right end,
  // -1 past its left end (the walls run A, B, C … around the room).
  function neighbor(room, wallId, dir) {
    var ids = wallIds(room);
    var i = ids.indexOf(wallId);
    return ids[(i + (dir > 0 ? 1 : ids.length - 1)) % ids.length];
  }

  var elecCounter = 0;
  function newElectricalId(list) {
    var used = {};
    list.forEach(function (p) {
      used[p.id] = true;
    });
    var id;
    do {
      elecCounter++;
      id = "e" + elecCounter;
    } while (used[id]);
    return id;
  }

  // The nearest offset to `want` on `wall` where a point of this kind has
  // no problem, searched outward an inch at a time. null when the whole
  // wall is taken.
  function freeOffset(design, sizes, kind, wall, want, height, forId, coverings, others, reach) {
    var span = wallSpan(design.room, wall);
    var half = ELECTRICAL_KINDS[kind].plate.w / 2;
    var edge = ELECTRICAL_KINDS[kind].margin;
    var lo = half + edge;
    var hi = span - half - edge;
    if (hi < lo) return null;
    var limit = reach === undefined ? span : reach;
    for (var d = 0; d <= limit + EPS; d += IN) {
      var tries = d === 0 ? [want] : [want - d, want + d];
      for (var i = 0; i < tries.length; i++) {
        var a = round(clamp(tries[i], lo, hi), 4);
        if (Math.abs(a - tries[i]) > IN) continue;
        var cand = { id: "probe", kind: kind, wall: wall, offset: a, height: height, for: forId };
        if (!electricalIssues(design, sizes, cand, coverings, others).some(isError)) return a;
      }
    }
    return null;
  }

  // What the room needs, worked out from where the fixtures stand: a GFCI
  // receptacle beside each basin, a light over each mirror, a switch (and a
  // fan switch) inside each doorway, and an exhaust fan over the wet area.
  // Points already in the design stay where they are; this only fills gaps,
  // so confirming a suggestion and running it again changes nothing.
  function suggestElectrical(design, sizes) {
    var room = design.room;
    var coverings = wallCoverings(design, sizes);
    var list = electricalOf(design).slice();
    var added = [];
    function add(kind, wall, want, height, forId, reach) {
      if (list.length >= MAX_ELECTRICAL) return null;
      var at = freeOffset(design, sizes, kind, wall, want, height, forId, coverings, list, reach);
      if (at === null) return null;
      var p = { id: newElectricalId(list), kind: kind, wall: wall, offset: at, height: round(height, 3), for: forId };
      list.push(p);
      added.push(p);
      return p;
    }
    function have(kind, forId) {
      return list.some(function (p) {
        return p.kind === kind && (forId === undefined || p.for === forId);
      });
    }

    var basins = design.items.filter(function (it) {
      return it.type === "vanity" || it.type === "sink";
    });
    var lightHeight = Math.min(ELECTRICAL_KINDS.light.height, room.h - 1.1);
    basins.forEach(function (basin) {
      var g = geometry(basin, room, sizes);
      var half = g.size.span / 2;
      if (!basinHasOutlet(design, sizes, list, basin)) {
        // Beside the basin: either side of it, or around a corner onto the
        // next wall, whichever free spot ends up nearest the basin itself.
        var hi = ELECTRICAL_KINDS.outlet.height;
        var spots = [
          { wall: basin.wall, want: basin.offset + half + 0.75 },
          { wall: basin.wall, want: basin.offset - half - 0.75 },
          { wall: neighbor(room, basin.wall, 1), want: 0 },
          { wall: neighbor(room, basin.wall, -1), want: wallSpan(room, neighbor(room, basin.wall, -1)) },
        ];
        /** @type {{ wall: string, offset: number, away: number } | null} */
        var best = null;
        spots.forEach(function (t) {
          var at = freeOffset(design, sizes, "outlet", t.wall, t.want, hi, basin.id, coverings, list);
          if (at === null) return;
          var pose = electricalPose(design, { kind: "outlet", wall: t.wall, offset: at, height: hi }, sizes);
          // A foot of slack in favor of the basin's own wall: beside it is
          // where a receptacle belongs, round the corner is the fallback.
          var away = distToRect(pose.x, pose.z, g.body) + (t.wall === basin.wall ? 0 : 1);
          if (!best || away < best.away) best = { wall: t.wall, offset: at, away: away };
        });
        if (best) add("outlet", best.wall, best.offset, hi, basin.id, IN);
      }
      if (!basinHasLight(design, sizes, list, basin))
        add("light", basin.wall, basin.offset, lightHeight, basin.id, 1.5);
    });
    if (!basins.length && !have("light")) {
      // No vanity: a light on the wall across from the first doorway.
      var door0 = itemsOfType(design, "door")[0];
      var doorWall = door0 && walls(room)[door0.wall];
      var across = doorWall ? acrossFrom(room, doorWall, door0.offset) : null;
      var wall = across ? across.wall.id : wallIds(room)[0];
      add("light", wall, wallSpan(room, wall) / 2, lightHeight, "room");
    }

    var wet = design.items.filter(function (it) {
      return it.type === "tub" || it.type === "shower";
    });
    itemsOfType(design, "door").forEach(function (door, i) {
      var g = geometry(door, room, sizes);
      var span = wallSpan(room, door.wall);
      var half = g.size.span / 2;
      var side = span - (door.offset + half) >= door.offset - half ? 1 : -1;
      // About 7 in. clear of the casing, the way a switch sits by a door.
      var want = door.offset + side * (half + 0.6);
      if (!doorHasSwitch(design, sizes, list, door))
        add("switch", door.wall, want, ELECTRICAL_KINDS.switch.height, door.id);
      if (i === 0 && wet.length && !have("switch", "fan")) {
        add("switch", door.wall, want + side * 0.45, ELECTRICAL_KINDS.switch.height, "fan");
      }
    });
    if (wet.length && !have("fan")) {
      if (list.length < MAX_ELECTRICAL) {
        var fan = { id: newElectricalId(list), kind: "fan", wall: null, offset: 0, height: room.h, for: "room" };
        list.push(fan);
        added.push(fan);
      }
    }
    var wired = wireSwitches(design, sizes, list, added, coverings);
    return { design: withElectrical(design, list), added: added, wired: wired };
  }

  // Where a new switch goes: inside the first doorway, beside the switches
  // already there (or across the room from nothing, with no doorway).
  function placeSwitch(design, sizes, list, forId, coverings) {
    if (list.length >= MAX_ELECTRICAL) return null;
    var room = design.room;
    var height = Math.min(ELECTRICAL_KINDS.switch.height, room.h - 1.1);
    var door = itemsOfType(design, "door")[0];
    var spot = null;
    if (door) {
      var g = geometry(door, room, sizes);
      var span = wallSpan(room, door.wall);
      var half = g.size.span / 2;
      var side = span - (door.offset + half) >= door.offset - half ? 1 : -1;
      var at = freeOffset(
        design,
        sizes,
        "switch",
        door.wall,
        door.offset + side * (half + 0.6),
        height,
        forId,
        coverings,
        list,
      );
      if (at !== null) spot = { wall: door.wall, offset: at };
    }
    var ids = wallIds(room);
    for (var i = 0; !spot && i < ids.length; i++) {
      var wid = ids[i];
      var mid = freeOffset(design, sizes, "switch", wid, wallSpan(room, wid) / 2, height, forId, coverings, list);
      if (mid !== null) spot = { wall: wid, offset: mid };
    }
    if (!spot) return null;
    var p = {
      id: newElectricalId(list),
      kind: "switch",
      wall: spot.wall,
      offset: round(spot.offset, 4),
      height: round(height, 3),
      for: forId,
    };
    list.push(p);
    return p;
  }

  // Puts each light and fan with no switch on the usual one (see
  // usualSwitch), adding that switch by the door when there isn't one.
  // Changes `list` in place; returns the ids of the points it wired.
  function wireSwitches(design, sizes, list, added, coverings) {
    var wired = [];
    var probe = withElectrical(design, list);
    list.forEach(function (p, i) {
      if (!NEEDS_SWITCH[p.kind] || switchOf(probe, p)) return;
      var sw = usualSwitch(list, p.kind);
      if (!sw) {
        sw = placeSwitch(
          design,
          sizes,
          list,
          p.kind === "fan" ? "fan" : "room",
          coverings || wallCoverings(design, sizes),
        );
        if (!sw) return;
        added.push(sw);
      }
      list[i] = Object.assign({}, p, { sw: sw.id });
      wired.push(p.id);
    });
    return wired;
  }

  // Puts a light or fan on another switch: switchId, or "new" for a switch
  // of its own by the door. { design, added } (the new switch, if any).
  function setSwitch(design, pointId, switchId, sizes) {
    var list = electricalOf(design).slice();
    var i = -1;
    list.forEach(function (p, k) {
      if (p.id === pointId) i = k;
    });
    if (i === -1 || !NEEDS_SWITCH[list[i].kind]) return { design: design, added: null };
    var added = null;
    if (switchId === "new") {
      added = placeSwitch(design, sizes, list, list[i].kind === "fan" ? "fan" : "room", wallCoverings(design, sizes));
      if (!added) return { design: design, added: null };
      switchId = added.id;
    }
    var sw = list.filter(function (p) {
      return p.id === switchId && p.kind === "switch";
    })[0];
    if (!sw) return { design: design, added: null };
    list[i] = Object.assign({}, list[i], { sw: sw.id });
    return { design: withElectrical(design, list), added: added };
  }

  // Where a dragged point lands: the wall nearest the room point (x, z),
  // at the height y. { wall, offset, height, valid }.
  function snapElectrical(design, pointId, x, y, z, sizes) {
    var point = electricalOf(design).filter(function (p) {
      return p.id === pointId;
    })[0];
    if (!point || point.kind === "fan") return null;
    var room = design.room;
    var kind = ELECTRICAL_KINDS[point.kind];
    var near = nearestWall(wallList(room), x, z, 0);
    var best = { wall: near.wall.id, along: near.along };
    var span = near.wall.span;
    var half = kind.plate.w / 2;
    var offset = round(clamp(best.along, half, span - half), 4);
    var height = round(clamp(y, Math.max(kind.minHeight, 0.3), room.h - 0.4), 3);
    var cand = Object.assign({}, point, { wall: best.wall, offset: offset, height: height });
    var others = electricalOf(design);
    var valid = !electricalIssues(design, sizes, cand, null, others).some(isError);
    return { wall: best.wall, offset: offset, height: height, valid: valid };
  }

  // The free spot on `wall` nearest `want` for a point already in the
  // room, at the height it was dropped or else the height it had; null
  // when that wall has nowhere it works.
  function nearestElectrical(design, sizes, pointId, wall, want, height) {
    var list = electricalOf(design);
    var point = list.filter(function (p) {
      return p.id === pointId;
    })[0];
    if (!point || !wall || point.kind === "fan") return null;
    var others = list.filter(function (p) {
      return p.id !== pointId;
    });
    var coverings = wallCoverings(design, sizes);
    var heights = [height, point.height];
    for (var i = 0; i < heights.length; i++) {
      var at = freeOffset(design, sizes, point.kind, wall, want, heights[i], point.for, coverings, others);
      if (at !== null) return { wall: wall, offset: at, height: heights[i] };
    }
    return null;
  }

  function moveElectrical(design, id, change) {
    return withElectrical(
      design,
      electricalOf(design).map(function (p) {
        return p.id === id ? Object.assign({}, p, change) : p;
      }),
    );
  }

  function addElectrical(design, kind, sizes) {
    var list = electricalOf(design).slice();
    if (list.length >= MAX_ELECTRICAL) return { design: design, point: null, placed: false };
    var room = design.room;
    if (kind === "fan") {
      var fan = { id: newElectricalId(list), kind: "fan", wall: null, offset: 0, height: room.h, for: "room" };
      list.push(fan);
      var fanAt = list.length - 1;
      var fanSwitch = [];
      wireSwitches(design, sizes, list, fanSwitch);
      return { design: withElectrical(design, list), point: list[fanAt], placed: true, added: fanSwitch };
    }
    var coverings = wallCoverings(design, sizes);
    var height = Math.min(ELECTRICAL_KINDS[kind].height, room.h - 1.1);
    var best = null;
    wallIds(room).forEach(function (wid) {
      var at = freeOffset(design, sizes, kind, wid, wallSpan(room, wid) / 2, height, "room", coverings, list);
      if (at !== null && !best) best = { wall: wid, offset: at };
    });
    var first = wallList(room)[0];
    var spot = best || { wall: first.id, offset: first.span / 2 };
    var p = {
      id: newElectricalId(list),
      kind: kind,
      wall: spot.wall,
      offset: round(spot.offset, 4),
      height: round(height, 3),
      for: "room",
    };
    list.push(p);
    var at = list.length - 1;
    var extra = [];
    if (NEEDS_SWITCH[kind]) wireSwitches(design, sizes, list, extra);
    return { design: withElectrical(design, list), point: list[at], placed: !!best, added: extra };
  }

  // Taking out a switch leaves what it ran with no switch, so the step
  // says so (and an id reused later can't pick them up by accident).
  function removeElectrical(design, id) {
    return withElectrical(
      design,
      electricalOf(design)
        .filter(function (p) {
          return p.id !== id;
        })
        .map(function (p) {
          return p.sw === id ? Object.assign({}, p, { sw: null }) : p;
        }),
    );
  }

  // What the 3D room draws: one plate per point, in room feet.
  function toElectricalPlacements(design, sizes) {
    return electricalOf(design).map(function (p) {
      var pose = electricalPose(design, p, sizes);
      var kind = ELECTRICAL_KINDS[p.kind];
      return {
        id: p.id,
        kind: p.kind,
        x: pose.x,
        y: pose.y,
        z: pose.z,
        rotationY: pose.rotY,
        wallId: p.wall,
        ceiling: !!pose.ceiling,
        width: kind.plate ? kind.plate.w : 1,
        height: kind.plate ? kind.plate.h : 1,
      };
    });
  }

  // How many points the estimate charges for.
  function electricalPoints(design) {
    return electricalOf(design).length;
  }

  // -------------------------------------------------------------------
  // Windows
  // -------------------------------------------------------------------
  // A window is a hole in a wall: { id, wall, offset (feet from the wall's
  // left end to its middle), width, height, sill (floor to its bottom) }.
  // It takes no floor, so fixtures may stand under it (a vanity under a
  // window is a classic), but not in front of it, and nothing electrical
  // goes on it.
  var WINDOW = { width: 3, height: 4, sill: 3, min: 1, maxWidth: 8, maxHeight: 7, minSill: 0.5, topGap: 0.5 };
  var MAX_WINDOWS = 6;

  function windowsOf(design) {
    return Array.isArray(design.windows) ? design.windows : [];
  }

  function withWindows(design, list) {
    return Object.assign({}, design, { windows: list });
  }

  // What's wrong with one window where it is:
  //   outside   past the end of its wall, or into the floor or ceiling
  //   door      over a doorway on the same wall
  //   overlap   on top of another window
  //   behind    a fixture or mirror covers part of it
  //   inShower  in a shower's walls: it needs tempered, wet-rated glass (warn)
  function windowIssues(design, sizes, win, coverings) {
    var room = design.room;
    var list = [];
    var a0 = win.offset - win.width / 2;
    var a1 = win.offset + win.width / 2;
    var y1 = win.sill + win.height;
    if (!isWall(room, win.wall) || a0 < -EPS || a1 > wallSpan(room, win.wall) + EPS) {
      list.push(issue("error", "outside", { other: "wall" }));
    }
    if (win.sill < WINDOW.minSill - EPS || y1 > room.h - 0.25 + EPS) {
      list.push(issue("error", "outside", { other: "ceiling" }));
    }
    design.items.forEach(function (it) {
      if (it.type !== "door" || it.wall !== win.wall) return;
      var half = sizeOf(it, sizes).span / 2;
      if (a1 > it.offset - half + EPS && a0 < it.offset + half - EPS && win.sill < DOOR_OPENING.h - EPS) {
        list.push(issue("error", "door", { other: it.id }));
      }
    });
    windowsOf(design).forEach(function (o) {
      if (o.id === win.id || o.wall !== win.wall) return;
      var along = a1 > o.offset - o.width / 2 + EPS && a0 < o.offset + o.width / 2 - EPS;
      var up = y1 > o.sill + EPS && win.sill < o.sill + o.height - EPS;
      if (along && up) list.push(issue("error", "overlap", { other: o.id }));
    });
    (coverings || wallCoverings(design, sizes)).forEach(function (c) {
      if (c.window || c.wall !== win.wall) return;
      if (a1 <= c.a0 + EPS || a0 >= c.a1 - EPS || y1 <= c.y0 + EPS || win.sill >= c.y1 - EPS) return;
      var item = design.items.filter(function (it) {
        return it.id === c.id;
      })[0];
      if (item && item.type === "shower" && !c.mirror) list.push(issue("warn", "inShower", { other: c.id }));
      else list.push(issue("error", "behind", { other: c.id }));
    });
    var seen = {};
    return list.filter(function (x) {
      var key = x.code + "|" + (x.other || "");
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  // Every window's problems: { id: [issues] }.
  function validateWindows(design, sizes) {
    var coverings = wallCoverings(design, sizes);
    var out = {};
    windowsOf(design).forEach(function (win) {
      out[win.id] = windowIssues(design, sizes, win, coverings);
    });
    return out;
  }

  var windowCounter = 0;
  function newWindowId(design) {
    var used = {};
    windowsOf(design).forEach(function (w) {
      used[w.id] = true;
    });
    var id;
    do {
      windowCounter++;
      id = "n" + windowCounter;
    } while (used[id]);
    return id;
  }

  // The usual size for this ceiling: 3 ft by 4 ft, 3 ft off the floor,
  // shorter when the ceiling is low.
  function windowSize(room) {
    var height = Math.min(WINDOW.height, room.h - WINDOW.topGap - WINDOW.minSill - 0.25);
    var sill = Math.min(WINDOW.sill, room.h - WINDOW.topGap - height);
    return { width: WINDOW.width, height: round(Math.max(WINDOW.min, height), 3), sill: round(sill, 3) };
  }

  // A new window where it causes no problem: as near the middle of the
  // longest wall without a door as it can go, else the next wall along. Returns
  // { design, window, placed }.
  function addWindow(design, sizes, opts) {
    var room = design.room;
    var size = Object.assign(windowSize(room), opts || {});
    var win = {
      id: newWindowId(design),
      wall: wallIds(room)[0],
      offset: 0,
      width: size.width,
      height: size.height,
      sill: size.sill,
    };
    var others = windowsOf(design);
    var coverings = wallCoverings(design, sizes);
    var doors = {};
    itemsOfType(design, "door").forEach(function (d) {
      doors[d.wall] = true;
    });
    var order = wallList(room)
      .slice()
      .sort(function (p, q) {
        return (doors[p.id] ? 1 : 0) - (doors[q.id] ? 1 : 0) || q.span - p.span || p.index - q.index;
      });
    var trial = withWindows(design, others.concat([win]));
    /** @type {{ wall: string, offset: number } | null} */
    var spot = null;
    for (var i = 0; i < order.length && !spot; i++) {
      var wall = order[i];
      var half = win.width / 2;
      if (wall.span < win.width + EPS) continue;
      for (var d = 0; d <= wall.span / 2 + EPS && !spot; d += 2 * IN) {
        var tries = d === 0 ? [wall.span / 2] : [wall.span / 2 - d, wall.span / 2 + d];
        for (var k = 0; k < tries.length; k++) {
          var a = round(clamp(tries[k], half, wall.span - half), 4);
          var cand = Object.assign({}, win, { wall: wall.id, offset: a });
          if (!windowIssues(trial, sizes, cand, coverings).some(isError)) {
            spot = { wall: wall.id, offset: a };
            break;
          }
        }
      }
    }
    var first = order[0];
    win.wall = spot ? spot.wall : first.id;
    win.offset = spot ? spot.offset : round(first.span / 2, 4);
    return { design: withWindows(design, others.concat([win])), window: win, placed: !!spot };
  }

  function moveWindow(design, id, change) {
    return withWindows(
      design,
      windowsOf(design).map(function (w) {
        return w.id === id ? Object.assign({}, w, change) : w;
      }),
    );
  }

  function removeWindow(design, id) {
    return withWindows(
      design,
      windowsOf(design).filter(function (w) {
        return w.id !== id;
      }),
    );
  }

  // What the 3D room draws: { id, x, y, z, rotationY, wallId, width,
  // height } with (x, y, z) the middle of the opening on the wall's face.
  function toWindowPlacements(design) {
    var all = walls(design.room);
    return windowsOf(design)
      .filter(function (w) {
        return all[w.wall];
      })
      .map(function (w) {
        var wall = all[w.wall];
        return {
          id: w.id,
          x: wall.ox + wall.dx * w.offset,
          y: w.sill + w.height / 2,
          z: wall.oz + wall.dz * w.offset,
          rotationY: wall.rotY,
          wallId: w.wall,
          width: w.width,
          height: w.height,
        };
      });
  }

  // Moves something kept on a wall (a fixture, a point, a window) from one
  // room to a reshaped one: the same wall when it still exists, else the
  // new wall at the same place (or the nearest one facing the same way).
  function rewall(from, to, wallId, offset) {
    var same =
      (shapeOf(from) || { kind: "rect" }).kind === (shapeOf(to) || { kind: "rect" }).kind &&
      (shapeOf(from) || {}).at === (shapeOf(to) || {}).at;
    if (same && isWall(to, wallId)) return { wall: wallId, offset: clamp(offset, 0, wallSpan(to, wallId)) };
    var old = walls(from)[wallId];
    if (!old) return { wall: wallIds(to)[0], offset: 0 };
    var x = old.ox + old.dx * offset;
    var z = old.oz + old.dz * offset;
    var facing = wallList(to).filter(function (w) {
      return w.nx === old.nx && w.nz === old.nz;
    });
    var near = nearestWall(facing.length ? facing : wallList(to), x, z, 0);
    return { wall: near.wall.id, offset: round(clamp(near.along, 0, near.wall.span), 4) };
  }

  // -------------------------------------------------------------------
  // For the estimate
  // -------------------------------------------------------------------
  // The counts js/bathroom-pricing.js prices. Only a new door is an
  // install: an existing door or an open doorway isn't charged. A vanity
  // carries its own sink, so it isn't charged as a sink too.
  function counts(design) {
    var c = {
      Toilet_Quantity: 0,
      Sink_Quantity: 0,
      Bathtub_Quantity: 0,
      Shower_Quantity: 0,
      Shower_Door_Quantity: 0,
      Door_Quantity: 0,
      Vanity_Quantity: 0,
      Cabinet_Quantity: 0,
      Mirror_Quantity: 0,
      Mirror_Huge_Quantity: 0,
      Shower_Shelf_Quantity: 0,
    };
    design.items.forEach(function (item) {
      var opts = item.opts || {};
      if (item.type === "door") {
        if (opts.kind === "new") c.Door_Quantity++;
        return;
      }
      c[TYPES[item.type].fixtureKey]++;
      if ((item.type === "vanity" || item.type === "sink") && opts.mirror === "standard") c.Mirror_Quantity++;
      if ((item.type === "vanity" || item.type === "sink") && opts.mirror === "large") c.Mirror_Huge_Quantity++;
      if (item.type === "shower" && opts.glassDoor) c.Shower_Door_Quantity++;
      if (item.type === "shower" && opts.shelf) c.Shower_Shelf_Quantity++;
    });
    return c;
  }

  // Wall areas, sq ft: the full walls less the doorways and windows
  // (openingsSqFt), and
  // the tub surround a "tile around the tub" job tiles (wetSqFt): the wall
  // behind each tub and the ends of it against a side wall, up to 6 ft
  // off the floor.
  var SURROUND_TOP_FT = 6;
  var DOOR_OPENING = { w: 2.5, h: 6.75 };

  function wallAreas(design, sizes) {
    var room = design.room;
    var gross = room.h * perimeter(room);
    var openings = 0;
    windowsOf(design).forEach(function (w) {
      openings += w.width * w.height;
    });
    var wet = 0;
    design.items.forEach(function (item) {
      if (item.type === "door") openings += DOOR_OPENING.w * Math.min(DOOR_OPENING.h, room.h);
      if (item.type === "tub") {
        var g = geometry(item, room, sizes);
        var top = Math.min(SURROUND_TOP_FT, room.h);
        wet += g.size.span * top;
        var c = nearCorner(g.wall, g.a0, g.a1);
        if (c.left) wet += g.size.depth * top;
        if (c.right) wet += g.size.depth * top;
      }
    });
    var net = Math.max(0, gross - openings);
    return {
      grossSqFt: round(gross, 2),
      openingsSqFt: round(openings, 2),
      netSqFt: round(net, 2),
      wetSqFt: round(Math.min(wet, net), 2),
      floorSqFt: round(floorArea(room), 2),
      perimeterFt: round(perimeter(room), 2),
      walls: wallList(room).length,
    };
  }

  // -------------------------------------------------------------------
  // Starting points
  // -------------------------------------------------------------------
  function finishesDefault() {
    return { demolition: true, floor: "tile", walls: "paint", ceiling: true, picks: {} };
  }

  function emptyDesign(w, l, h) {
    return {
      v: 3,
      room: { w: w, l: l, h: h, wet: "N" },
      items: [],
      electrical: [],
      windows: [],
      finishes: finishesDefault(),
      products: {},
      answered: { stack: false, products: {} },
    };
  }

  // The common bathrooms people start from. Fixtures are listed with their
  // wall; arrange() places them for real, so a template always fits. wet
  // is the wall the plumbing stack is in, opposite the door.
  var TEMPLATES = [
    // The room the designer opens with: a full bath with six inches more
    // than the classic 5 x 8, so the toilet gets the recommended 18 in.
    // beside it and the sample starts with nothing to warn about. Not in
    // the "common bathrooms" list (hidden).
    {
      id: "sample",
      hidden: true,
      room: { w: 8.5, l: 5, h: 8, wet: "N" },
      door: { wall: "S", offset: 4.85 },
      items: ["tub", "vanity", "toilet"],
    },
    {
      id: "full5x8",
      room: { w: 8, l: 5, h: 8, wet: "N" },
      door: { wall: "S", offset: 4.6 },
      items: ["tub", "vanity", "toilet"],
    },
    {
      id: "showerBath",
      room: { w: 8, l: 6, h: 8, wet: "N" },
      door: { wall: "S", offset: 4.5 },
      items: ["shower", "vanity", "toilet"],
    },
    {
      id: "primary",
      room: { w: 11, l: 9, h: 8.5, wet: "N" },
      door: { wall: "S", offset: 2 },
      items: ["tub", "shower", "vanity", "vanity", "toilet", "cabinet"],
    },
    {
      id: "half",
      room: { w: 5, l: 5, h: 8, wet: "N" },
      door: { wall: "S", offset: 2.5 },
      items: ["sink", "toilet"],
    },
    {
      id: "lShape",
      room: { w: 9, l: 8, h: 8, shape: { kind: "L", at: "NE", w: 3, l: 3 } },
      door: { wall: "w5", offset: 2 },
      items: ["tub", "vanity", "toilet"],
    },
    {
      id: "blank",
      room: { w: 8, l: 6, h: 8, wet: "N" },
      door: { wall: "S", offset: 4 },
      items: [],
    },
  ];

  // Which of two layouts for the same room is the better one: nothing
  // broken first, then the least new drain line, then the fewest tight
  // spots. The wiring counts too, because a basin wedged between a tub
  // and a shower leaves nowhere legal for its receptacle.
  function better(design, items, than, sizes) {
    var score = function (list) {
      var trial = Object.assign({}, design, { items: list, electrical: [] });
      var issues = validate(trial, sizes);
      var bad = 0;
      var tight = 0;
      var count = function (list2) {
        Object.keys(list2).forEach(function (id) {
          bad += errorsOf(list2, id).length;
          tight += list2[id].length - errorsOf(list2, id).length;
        });
      };
      count(issues);
      var wired = suggestElectrical(trial, sizes).design;
      count(validateElectrical(wired, sizes));
      return [bad, offStackFeet(trial, sizes), tight];
    };
    var mine = score(items);
    var theirs = score(than);
    for (var i = 0; i < mine.length; i++) {
      if (Math.abs(mine[i] - theirs[i]) > 1e-6) return mine[i] < theirs[i];
    }
    return false;
  }

  function fromTemplate(templateId, sizes) {
    var tpl =
      TEMPLATES.filter(function (t) {
        return t.id === templateId;
      })[0] || TEMPLATES[0];
    var design = emptyDesign(tpl.room.w, tpl.room.l, tpl.room.h);
    var shape = fitShape(design.room, tpl.room.shape);
    if (shape) design.room.shape = shape;
    var first = wallIds(design.room)[0];
    design.room.wet = tpl.room.wet || first;
    var door = { id: "door", type: "door", wall: tpl.door.wall, offset: tpl.door.offset, opts: defaultOpts("door") };
    design.items.push(door);
    tpl.items.forEach(function (type) {
      design.items.push({ id: newId(design), type: type, wall: first, offset: 0, opts: defaultOpts(type) });
    });
    if (tpl.items.length) {
      // A bathroom that already exists has its stack where its fixtures
      // are, not the other way round: the room is arranged once with no
      // plumbing wall in mind, which says where the stack would be, then
      // again knowing it. The better of the two layouts wins.
      design.room.wet = null;
      var tries = arrange(design, sizes, { count: 3 });
      if (tries.length) design.items = tries[0].items;
      design.room.wet = suggestStack(design, sizes);
      arrange(design, sizes, { count: 3 }).forEach(function (option) {
        tries.push(option);
      });
      tries.forEach(function (option) {
        if (better(design, option.items, design.items, sizes)) design.items = option.items;
      });
      design.room.wet = suggestStack(design, sizes);
      design.items = settle(design, sizes);
    }
    return suggestElectrical(design, sizes).design;
  }

  // arrange() puts each fixture at the first spot that works, which can
  // leave a toilet closer to a neighbour than the recommended 18 in. while
  // the slack sits on its other side. This slides each toilet along its
  // wall, an inch at a time, to the nearest place with fewer tight spots and
  // no new problems. Only toilets: the side rule is theirs, and sliding one
  // changes nothing else's clear floor.
  function settle(design, sizes) {
    var items = design.items.slice();
    var score = function (list) {
      var issues = validate(Object.assign({}, design, { items: list, electrical: [] }), sizes);
      var bad = 0;
      var tight = 0;
      Object.keys(issues).forEach(function (id) {
        var errors = errorsOf(issues, id).length;
        bad += errors;
        tight += issues[id].length - errors;
      });
      return { bad: bad, tight: tight };
    };
    var base = score(items);
    if (!base.tight) return items;
    items.forEach(function (item, i) {
      if (item.type !== "toilet") return;
      /** @type {{ items: any[], score: { bad: number, tight: number } } | null} */
      var best = null;
      for (var k = 1; k <= 24 && base.tight; k++) {
        [k, -k].forEach(function (inches) {
          var trial = items.slice();
          trial[i] = Object.assign({}, item, { offset: item.offset + inches * IN });
          var s = score(trial);
          if (s.bad <= base.bad && s.tight < base.tight && (!best || s.tight < best.score.tight)) {
            best = { items: trial, score: s };
          }
        });
        if (best) break;
      }
      if (best) {
        items = best.items;
        base = best.score;
      }
    });
    return items;
  }

  // -------------------------------------------------------------------
  // Keeping designs safe to load
  // -------------------------------------------------------------------
  // Whatever comes back from storage or a shared link is checked field by
  // field; anything unusable is dropped or reset to its default.
  function sanitize(raw) {
    if (!raw || typeof raw !== "object" || (raw.v !== 2 && raw.v !== 3)) return null;
    var r = raw.room || {};
    var num = function (v, min, max, dflt) {
      var n = Number(v);
      return isFinite(n) ? clamp(n, min, max) : dflt;
    };
    var design = emptyDesign(
      num(r.w, LIMITS.min, LIMITS.maxW, 8),
      num(r.l, LIMITS.min, LIMITS.maxL, 5),
      num(r.h, LIMITS.minH, LIMITS.maxH, 8),
    );
    var shape = fitShape(design.room, r.shape);
    if (shape) design.room.shape = shape;
    var wet = wetWalls(design.room, Array.isArray(r.wet) ? r.wet.slice(0, 16) : r.wet);
    design.room.wet = wet.length ? wetValue(wet) : wallIds(design.room)[0];
    var seen = {};
    (Array.isArray(raw.items) ? raw.items : []).slice(0, MAX_ITEMS).forEach(function (it) {
      if (!it || !TYPES[it.type] || !isWall(design.room, it.wall)) return;
      var id = typeof it.id === "string" && /^[a-z0-9_-]{1,24}$/i.test(it.id) && !seen[it.id] ? it.id : null;
      if (!id) return;
      seen[id] = true;
      var span = wallSpan(design.room, it.wall);
      var opts = Object.assign(defaultOpts(it.type), {});
      var o = it.opts && typeof it.opts === "object" ? it.opts : {};
      if (it.type === "vanity" || it.type === "sink") {
        if (["standard", "large", "none"].indexOf(o.mirror) !== -1) opts.mirror = o.mirror;
      }
      if (it.type === "shower") {
        opts.glassDoor = o.glassDoor !== false;
        opts.shelf = o.shelf === true;
      }
      if (it.type === "door" && ["existing", "new", "opening"].indexOf(o.kind) !== -1) opts.kind = o.kind;
      design.items.push({
        id: id,
        type: it.type,
        wall: it.wall,
        offset: num(it.offset, 0, span, span / 2),
        opts: opts,
      });
    });
    var seenPoints = {};
    (Array.isArray(raw.electrical) ? raw.electrical : []).slice(0, MAX_ELECTRICAL).forEach(function (p) {
      if (!p || !ELECTRICAL_KINDS[p.kind]) return;
      var id = typeof p.id === "string" && /^[a-z0-9_-]{1,24}$/i.test(p.id) && !seenPoints[p.id] ? p.id : null;
      if (!id) return;
      if (p.kind !== "fan" && !isWall(design.room, p.wall)) return;
      seenPoints[id] = true;
      var forId = typeof p.for === "string" && /^[a-z0-9_-]{1,24}$/i.test(p.for) ? p.for : "room";
      design.electrical.push({
        id: id,
        kind: p.kind,
        wall: p.kind === "fan" ? null : p.wall,
        offset: p.kind === "fan" ? 0 : num(p.offset, 0, wallSpan(design.room, p.wall), 1),
        height: num(p.height, 0.3, design.room.h, ELECTRICAL_KINDS[p.kind].height || design.room.h),
        for: forId,
        sw: NEEDS_SWITCH[p.kind] && typeof p.sw === "string" && /^[a-z0-9_-]{1,24}$/i.test(p.sw) ? p.sw : null,
      });
    });
    // Designs saved before lights and fans named their switch: each goes on
    // the switch it would have been given, when the room has one.
    var raw2 = Array.isArray(raw.electrical) ? raw.electrical : [];
    var named = raw2.some(function (p) {
      return p && typeof p.sw === "string";
    });
    if (!named) {
      design.electrical = design.electrical.map(function (p) {
        if (!NEEDS_SWITCH[p.kind]) return p;
        var sw = usualSwitch(design.electrical, p.kind);
        return sw ? Object.assign({}, p, { sw: sw.id }) : p;
      });
    }
    var seenWindows = {};
    (Array.isArray(raw.windows) ? raw.windows : []).slice(0, MAX_WINDOWS).forEach(function (w) {
      if (!w || !isWall(design.room, w.wall)) return;
      var id = typeof w.id === "string" && /^[a-z0-9_-]{1,24}$/i.test(w.id) && !seenWindows[w.id] ? w.id : null;
      if (!id) return;
      seenWindows[id] = true;
      var span = wallSpan(design.room, w.wall);
      var width = num(w.width, WINDOW.min, Math.min(WINDOW.maxWidth, span), WINDOW.width);
      var height = num(w.height, WINDOW.min, WINDOW.maxHeight, WINDOW.height);
      design.windows.push({
        id: id,
        wall: w.wall,
        offset: num(w.offset, 0, span, span / 2),
        width: width,
        height: height,
        sill: num(w.sill, 0, design.room.h, WINDOW.sill),
      });
    });
    var f = raw.finishes && typeof raw.finishes === "object" ? raw.finishes : {};
    design.finishes = {
      demolition: f.demolition !== false,
      floor: ["tile", "flooring", "none"].indexOf(f.floor) !== -1 ? f.floor : "tile",
      walls: ["paint", "tileWet", "tile", "none"].indexOf(f.walls) !== -1 ? f.walls : "paint",
      ceiling: f.ceiling !== false,
      picks: {},
    };
    var picks = f.picks && typeof f.picks === "object" ? f.picks : {};
    Object.keys(picks).forEach(function (k) {
      if (/^[A-Za-z]{1,24}$/.test(k) && typeof picks[k] === "string" && picks[k].length < 64)
        design.finishes.picks[k] = picks[k];
    });
    var products = raw.products && typeof raw.products === "object" ? raw.products : {};
    Object.keys(products).forEach(function (k) {
      if (/^[A-Za-z]{1,32}$/.test(k) && typeof products[k] === "string" && products[k].length < 64)
        design.products[k] = products[k];
    });
    var a = raw.answered && typeof raw.answered === "object" ? raw.answered : {};
    design.answered.stack = a.stack === true;
    var picked = a.products && typeof a.products === "object" ? a.products : {};
    Object.keys(picked).forEach(function (k) {
      if (/^[A-Za-z]{1,32}$/.test(k) && picked[k] === true) design.answered.products[k] = true;
    });
    return design;
  }

  // A design in a link: compact JSON, base64url. decode() returns null for
  // anything that isn't one.
  function encode(design) {
    /** @type {any} */
    var compact = {
      v: 3,
      room: {
        w: round(design.room.w, 3),
        l: round(design.room.l, 3),
        h: round(design.room.h, 3),
        wet: wetValue(stackWalls(design)),
      },
      items: design.items.map(function (it) {
        return { id: it.id, type: it.type, wall: it.wall, offset: round(it.offset, 3), opts: it.opts };
      }),
      electrical: electricalOf(design).map(function (p) {
        return {
          id: p.id,
          kind: p.kind,
          wall: p.wall,
          offset: round(p.offset, 3),
          height: round(p.height, 3),
          for: p.for,
          sw: p.sw || undefined,
        };
      }),
      finishes: design.finishes,
      products: design.products,
      answered: design.answered || { stack: false, products: {} },
    };
    var shape = shapeOf(design.room);
    if (shape) compact.room.shape = { kind: shape.kind, at: shape.at, w: round(shape.w, 3), l: round(shape.l, 3) };
    if (windowsOf(design).length) {
      compact.windows = windowsOf(design).map(function (w) {
        return {
          id: w.id,
          wall: w.wall,
          offset: round(w.offset, 3),
          width: round(w.width, 3),
          height: round(w.height, 3),
          sill: round(w.sill, 3),
        };
      });
    }
    var json = JSON.stringify(compact);
    var b64 = btoa(unescape(encodeURIComponent(json)));
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function decode(text) {
    try {
      var b64 = String(text || "")
        .replace(/-/g, "+")
        .replace(/_/g, "/");
      if (!/^[A-Za-z0-9+/]+$/.test(b64) || b64.length > 20000) return null;
      var json = decodeURIComponent(escape(atob(b64)));
      return sanitize(JSON.parse(json));
    } catch (e) {
      return null;
    }
  }

  // Resizing the room keeps every fixture on its wall, the same distance
  // from that wall's left end (as far as the new wall allows).
  // A room that changes shape keeps each thing on the wall that's now where
  // it stood (see rewall()); the cutout shrinks if the room got too small
  // for it.
  function resize(design, room) {
    var from = design.room;
    room = Object.assign({}, room);
    var shape = fitShape(room, room.shape);
    if (shape) room.shape = shape;
    else delete room.shape;
    var wet = stackWall(design);
    if (!hasStack(design)) room.wet = room.wet === undefined ? wet : room.wet;
    else {
      room.wet = wetValue(
        wetWalls(
          room,
          stackWalls(design).map(function (wid) {
            return rewall(from, room, wid, wallSpan(from, wid) / 2).wall;
          }),
        ),
      );
    }
    var next = Object.assign({}, design, { room: room });
    next.items = design.items.map(function (it) {
      var at = rewall(from, room, it.wall, it.offset);
      return Object.assign({}, it, { wall: at.wall, offset: at.offset });
    });
    next.electrical = electricalOf(design).map(function (p) {
      if (p.kind === "fan") return Object.assign({}, p, { height: room.h });
      var at = rewall(from, room, p.wall, p.offset);
      return Object.assign({}, p, {
        wall: at.wall,
        offset: at.offset,
        height: clamp(p.height, 0.3, room.h - 0.4),
      });
    });
    next.windows = windowsOf(design).map(function (w) {
      var at = rewall(from, room, w.wall, w.offset);
      var height = Math.min(w.height, Math.max(WINDOW.min, room.h - 0.25 - WINDOW.minSill));
      return Object.assign({}, w, {
        wall: at.wall,
        offset: at.offset,
        height: height,
        sill: clamp(w.sill, WINDOW.minSill, Math.max(WINDOW.minSill, room.h - 0.25 - height)),
      });
    });
    return next;
  }

  return {
    TYPES: TYPES,
    WALL_IDS: WALL_IDS,
    WALL_LETTERS: WALL_LETTERS,
    LIMITS: LIMITS,
    MAX_ITEMS: MAX_ITEMS,
    TEMPLATES: TEMPLATES,
    toFtIn: toFtIn,
    formatLength: formatLength,
    formatInches: formatInches,
    parseLength: parseLength,
    walls: walls,
    wallList: wallList,
    wallIds: wallIds,
    wallLetter: wallLetter,
    wallSpan: wallSpan,
    frontDepth: frontDepth,
    SHAPES: SHAPES,
    SHAPE_AT: SHAPE_AT,
    shapeOf: shapeOf,
    shapeLimits: shapeLimits,
    fitShape: fitShape,
    defaultShape: defaultShape,
    cutsOf: cutsOf,
    outline: outline,
    floorArea: floorArea,
    perimeter: perimeter,
    interiorPoint: interiorPoint,
    sizeOf: sizeOf,
    geometry: geometry,
    validate: validate,
    errorsOf: errorsOf,
    hasErrors: hasErrors,
    findSpots: findSpots,
    addItem: addItem,
    arrange: arrange,
    snap: snap,
    measure: measure,
    toPlacements: toPlacements,
    outlines: outlines,
    counts: counts,
    STACK_LIMIT: STACK_LIMIT,
    stackWall: stackWall,
    stackWalls: stackWalls,
    stackRun: stackRun,
    nearestStack: nearestStack,
    drainRun: drainRun,
    suggestStack: suggestStack,
    setStack: setStack,
    toggleStack: toggleStack,
    MAX_ELECTRICAL: MAX_ELECTRICAL,
    ELECTRICAL_KINDS: ELECTRICAL_KINDS,
    ELECTRICAL_IDS: ["outlet", "switch", "light", "fan"],
    electrical: electricalOf,
    electricalPose: electricalPose,
    validateElectrical: validateElectrical,
    electricalGaps: electricalGaps,
    suggestElectrical: suggestElectrical,
    setSwitch: setSwitch,
    switchOf: switchOf,
    switchedBy: switchedBy,
    snapElectrical: snapElectrical,
    moveElectrical: moveElectrical,
    nearestElectrical: nearestElectrical,
    addElectrical: addElectrical,
    removeElectrical: removeElectrical,
    toElectricalPlacements: toElectricalPlacements,
    electricalPoints: electricalPoints,
    wallAreas: wallAreas,
    WINDOW: WINDOW,
    MAX_WINDOWS: MAX_WINDOWS,
    windows: windowsOf,
    windowSize: windowSize,
    validateWindows: validateWindows,
    addWindow: addWindow,
    moveWindow: moveWindow,
    removeWindow: removeWindow,
    toWindowPlacements: toWindowPlacements,
    defaultOpts: defaultOpts,
    emptyDesign: emptyDesign,
    fromTemplate: fromTemplate,
    sanitize: sanitize,
    encode: encode,
    decode: decode,
    resize: resize,
  };
});
