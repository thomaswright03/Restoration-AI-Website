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
//     room: { w, l, h, wet },       feet: width (x), length (z), ceiling,
//                                  and the wall the plumbing stack is in
//     items: [ { id, type, wall, offset, opts } ],
//     electrical: [ { id, kind, wall, offset, height, for } ],
//     finishes: { demolition, floor, walls, ceiling, picks: {} },
//     products: { <3D product slot id>: <option id> } }
//
// Every fixture stands against a wall, facing into the room. wall is
// "N" (z = 0), "E" (x = w), "S" (z = l) or "W" (x = 0); offset is the
// distance in feet from the wall's left end (as seen standing in the room
// facing it) to the fixture's center. The people-facing names are the
// letters A to D (WALL_LETTERS).
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
(function (root, factory) {
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
    m = /^(\d+)\s*(?:ft|feet|foot|pies|pie|pés|pé|'|\s)\s*(\d+(?:\.\d+)?)\s*(?:in|inch|inches|pulg|pol|")?$/.exec(s);
    if (m) return Number(m[1]) + Number(m[2]) / 12;
    return null;
  }

  // -------------------------------------------------------------------
  // Walls and rectangles
  // -------------------------------------------------------------------
  // Each wall: where its left end is (ox, oz), which way it runs (dx, dz),
  // which way is into the room (nx, nz), how long it is and how deep the
  // room is in front of it. rotY turns a fixture modeled facing +z to face
  // into the room from this wall.
  function walls(room) {
    var w = room.w;
    var l = room.l;
    return {
      N: { id: "N", ox: 0, oz: 0, dx: 1, dz: 0, nx: 0, nz: 1, span: w, deep: l, rotY: 0 },
      E: { id: "E", ox: w, oz: 0, dx: 0, dz: 1, nx: -1, nz: 0, span: l, deep: w, rotY: -Math.PI / 2 },
      S: { id: "S", ox: w, oz: l, dx: -1, dz: 0, nx: 0, nz: -1, span: w, deep: l, rotY: Math.PI },
      W: { id: "W", ox: 0, oz: l, dx: 0, dz: -1, nx: 1, nz: 0, span: l, deep: w, rotY: Math.PI / 2 },
    };
  }

  function wallSpan(room, wallId) {
    return wallId === "N" || wallId === "S" ? room.w : room.l;
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
    return r.x0 >= -EPS && r.z0 >= -EPS && r.x1 <= room.w + EPS && r.z1 <= room.l + EPS;
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
    if (strip.d1 > wall.deep + EPS) return 0;
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
    var dist = wall.deep - g.size.depth;
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
      if (!inside(g.body, room) || g.size.depth > g.wall.deep + EPS) {
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

  function nearCorner(wall, a0, a1) {
    return { left: a0 < 2 * IN, right: a1 > wall.span - 2 * IN };
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
      if (g.wall.span <= g.wall.deep) score += 8;
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
      var opposite = { N: "S", S: "N", E: "W", W: "E" }[d.wall.id] === g.wall.id;
      if (opposite) {
        var center = (d.body.x0 + d.body.x1) / 2;
        var cz = (d.body.z0 + d.body.z1) / 2;
        var mine = (g.body.x0 + g.body.x1) / 2;
        var mz = (g.body.z0 + g.body.z1) / 2;
        var lined = g.wall.id === "N" || g.wall.id === "S" ? Math.abs(center - mine) < 1.5 : Math.abs(cz - mz) < 1.5;
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
    var wallList = opts.walls || WALL_IDS;
    wallList.forEach(function (wid) {
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
      return q.score - p.score || WALL_IDS.indexOf(p.wall) - WALL_IDS.indexOf(q.wall) || p.offset - q.offset;
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
      wall: "N",
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
    var best = null;
    WALL_IDS.forEach(function (wid) {
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
    var cands = [
      { wall: "N", dist: z, along: x },
      { wall: "E", dist: room.w - x, along: z },
      { wall: "S", dist: room.l - z, along: room.w - x },
      { wall: "W", dist: x, along: room.l - z },
    ].filter(function (c) {
      return wallSpan(room, c.wall) >= size.span - EPS;
    });
    if (!cands.length) return { wall: item.wall, offset: item.offset, valid: false, snapped: false };
    var best = cands.reduce(function (p, q) {
      return Math.abs(q.dist - size.depth / 2) < Math.abs(p.dist - size.depth / 2) ? q : p;
    });
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
  // A bathroom's drains all join one soil stack, which lives inside one
  // wall. Fixtures on that wall tie straight in; anything on another wall
  // needs a drain line run around to it, under the floor, falling about a
  // quarter inch per foot. That run costs money and can't go on forever,
  // so where the stack is decides what layouts are real.
  //
  // design.room.wet is that wall ("N", "E", "S" or "W"). The run is
  // measured the way a plumber would route it: around the room's
  // perimeter from the fixture to the nearest end of the stack wall.
  //
  // A toilet's 3 in. soil line is the fussy one (it needs the fall and a
  // big hole in the floor); a sink's 1.5 in. line travels much further.
  // FREE_RUN is the bit of slack that comes with cutting in at the corner.
  var STACK_LIMIT = { toilet: 10, tub: 14, shower: 14, vanity: 16, sink: 16 };
  // A fixture a few feet along from the stack wall ties in with ordinary
  // pipe under the floor and no one thinks twice; past that it's a job.
  var FREE_RUN = 3;

  function stackWall(design) {
    var wall = design && design.room ? design.room.wet : null;
    return WALL_IDS.indexOf(wall) === -1 ? "N" : wall;
  }

  // Whether the design says where the stack is. A design being arranged
  // from scratch doesn't yet: the layout decides, and the stack follows.
  function hasStack(design) {
    return !!design && !!design.room && WALL_IDS.indexOf(design.room.wet) !== -1;
  }

  // Distance around the room's perimeter from its NW corner, clockwise.
  // walls() chains head to tail (N ends where E starts, and so on), so a
  // wall's own offset adds straight onto where that wall begins.
  function perimeterAt(room, wallId, a) {
    var base = { N: 0, E: room.w, S: room.w + room.l, W: 2 * room.w + room.l };
    return base[wallId] + a;
  }

  function aroundTo(from, to, total) {
    var d = Math.abs(from - to) % total;
    return Math.min(d, total - d);
  }

  // Feet of new drain line a fixture needs where it stands: 0 on the
  // stack wall, otherwise the shorter way around to one of that wall's
  // ends. A fixture on the opposite wall picks up the whole side wall on
  // the way, which is why those runs get long.
  function stackRun(design, item, sizes) {
    var t = TYPES[item.type];
    if (!t || !t.wet || !hasStack(design)) return 0;
    var room = design.room;
    var stack = stackWall(design);
    if (item.wall === stack) return 0;
    var total = 2 * (room.w + room.l);
    var start = perimeterAt(room, stack, 0);
    var end = start + wallSpan(room, stack);
    var span = wallSpan(room, item.wall);
    var spots = [item.offset];
    if (t.drainEnd) {
      var half = sizeOf(item, sizes).span / 2;
      spots.push(item.offset - half, item.offset + half);
    }
    var best = Infinity;
    spots.forEach(function (a) {
      var me = perimeterAt(room, item.wall, clamp(a, 0, span));
      best = Math.min(best, aroundTo(me, start, total), aroundTo(me, end, total));
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
    var extra = { other: "stack", need: Math.round(limit * 12), have: Math.round(run * 12) };
    return [issue(run > limit + EPS ? "error" : "warn", run > limit + EPS ? "noStack" : "offStack", extra)];
  }

  // Total feet of new drain line the design needs, for the estimate.
  function drainRun(design, sizes) {
    return round(
      design.items.reduce(function (sum, it) {
        var run = stackRun(design, it, sizes);
        return sum + (run > FREE_RUN ? run : 0);
      }, 0),
      2,
    );
  }

  // The wall that suits the fixtures already in the room best, so the
  // person can be shown a sensible answer before they confirm it: the one
  // that leaves the least pipe to run, counting a toilet's soil line for
  // more than the rest because it's the one nobody wants to move.
  function suggestStack(design, sizes) {
    var best = null;
    WALL_IDS.forEach(function (wid) {
      var trial = setStack(design, wid);
      var total = trial.items.reduce(function (sum, it) {
        return sum + stackRun(trial, it, sizes) * (it.type === "toilet" ? 2.5 : 1);
      }, 0);
      if (!best || total < best.total) best = { wall: wid, total: total };
    });
    return best ? best.wall : "N";
  }

  function setStack(design, wallId) {
    if (WALL_IDS.indexOf(wallId) === -1) return design;
    return Object.assign({}, design, { room: Object.assign({}, design.room, { wet: wallId }) });
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
    var wall = walls(room)[p.wall] || walls(room).N;
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
    if (!wet.length) return { x: room.w / 2, z: room.l / 2 };
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
        });
      }
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
    });
    return out;
  }

  // Room-wide gaps in the electrical, as codes: noSwitch (a doorway with no
  // switch beside it), noLight, noFan (there's a tub or shower), noOutlet.
  function electricalGaps(design) {
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
    if (basins.length && !has("outlet")) out.push({ code: "noOutlet" });
    if (!has("light")) out.push({ code: "noLight" });
    if (itemsOfType(design, "door").length && !has("switch")) out.push({ code: "noSwitch" });
    if (wet.length && !has("fan")) out.push({ code: "noFan" });
    return out;
  }

  function itemsOfType(design, type) {
    return design.items.filter(function (it) {
      return it.type === type;
    });
  }

  // The wall round the corner from this one: dir +1 past its right end,
  // -1 past its left end (the walls run A, B, C, D around the room).
  function neighbor(wallId, dir) {
    var i = WALL_IDS.indexOf(wallId);
    return WALL_IDS[(i + (dir > 0 ? 1 : 3)) % 4];
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
      if (!have("outlet", basin.id)) {
        // Beside the basin: either side of it, or around a corner onto the
        // next wall, whichever free spot ends up nearest the basin itself.
        var hi = ELECTRICAL_KINDS.outlet.height;
        var spots = [
          { wall: basin.wall, want: basin.offset + half + 0.75 },
          { wall: basin.wall, want: basin.offset - half - 0.75 },
          { wall: neighbor(basin.wall, 1), want: 0 },
          { wall: neighbor(basin.wall, -1), want: wallSpan(room, neighbor(basin.wall, -1)) },
        ];
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
      if (!have("light", basin.id)) add("light", basin.wall, basin.offset, lightHeight, basin.id, 1.5);
    });
    if (!basins.length && !have("light")) {
      // No vanity: a light on the wall across from the first doorway.
      var door0 = itemsOfType(design, "door")[0];
      var wall = door0 ? { N: "S", S: "N", E: "W", W: "E" }[door0.wall] : "N";
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
      if (!have("switch", door.id)) add("switch", door.wall, want, ELECTRICAL_KINDS.switch.height, door.id);
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
    var cands = [
      { wall: "N", dist: z, along: x },
      { wall: "E", dist: room.w - x, along: z },
      { wall: "S", dist: room.l - z, along: room.w - x },
      { wall: "W", dist: x, along: room.l - z },
    ];
    var best = cands.reduce(function (p, q) {
      return q.dist < p.dist ? q : p;
    });
    var span = wallSpan(room, best.wall);
    var half = kind.plate.w / 2;
    var offset = round(clamp(best.along, half, span - half), 4);
    var height = round(clamp(y, Math.max(kind.minHeight, 0.3), room.h - 0.4), 3);
    var cand = Object.assign({}, point, { wall: best.wall, offset: offset, height: height });
    var others = electricalOf(design);
    var valid = !electricalIssues(design, sizes, cand, null, others).some(isError);
    return { wall: best.wall, offset: offset, height: height, valid: valid };
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
      return { design: withElectrical(design, list), point: fan, placed: true };
    }
    var coverings = wallCoverings(design, sizes);
    var height = Math.min(ELECTRICAL_KINDS[kind].height, room.h - 1.1);
    var best = null;
    WALL_IDS.forEach(function (wid) {
      var at = freeOffset(design, sizes, kind, wid, wallSpan(room, wid) / 2, height, "room", coverings, list);
      if (at !== null && !best) best = { wall: wid, offset: at };
    });
    var spot = best || { wall: "N", offset: wallSpan(room, "N") / 2 };
    var p = {
      id: newElectricalId(list),
      kind: kind,
      wall: spot.wall,
      offset: round(spot.offset, 4),
      height: round(height, 3),
      for: "room",
    };
    list.push(p);
    return { design: withElectrical(design, list), point: p, placed: !!best };
  }

  function removeElectrical(design, id) {
    return withElectrical(
      design,
      electricalOf(design).filter(function (p) {
        return p.id !== id;
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

  // Wall areas, sq ft: the full walls less the doorways (openingsSqFt), and
  // the tub surround a "tile around the tub" job tiles (wetSqFt): the wall
  // behind each tub and the ends of it against a side wall, up to 6 ft
  // off the floor.
  var SURROUND_TOP_FT = 6;
  var DOOR_OPENING = { w: 2.5, h: 6.75 };

  function wallAreas(design, sizes) {
    var room = design.room;
    var gross = 2 * room.h * (room.w + room.l);
    var openings = 0;
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
      finishes: finishesDefault(),
      products: {},
    };
  }

  // The common bathrooms people start from. Fixtures are listed with their
  // wall; arrange() places them for real, so a template always fits. wet
  // is the wall the plumbing stack is in, opposite the door.
  var TEMPLATES = [
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
      return [bad, drainRun(trial, sizes), tight];
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
    design.room.wet = tpl.room.wet || "N";
    var door = { id: "door", type: "door", wall: tpl.door.wall, offset: tpl.door.offset, opts: defaultOpts("door") };
    design.items.push(door);
    tpl.items.forEach(function (type) {
      design.items.push({ id: newId(design), type: type, wall: "N", offset: 0, opts: defaultOpts(type) });
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
    }
    return suggestElectrical(design, sizes).design;
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
    if (WALL_IDS.indexOf(r.wet) !== -1) design.room.wet = r.wet;
    var seen = {};
    (Array.isArray(raw.items) ? raw.items : []).slice(0, MAX_ITEMS).forEach(function (it) {
      if (!it || !TYPES[it.type] || WALL_IDS.indexOf(it.wall) === -1) return;
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
      if (p.kind !== "fan" && WALL_IDS.indexOf(p.wall) === -1) return;
      seenPoints[id] = true;
      var forId = typeof p.for === "string" && /^[a-z0-9_-]{1,24}$/i.test(p.for) ? p.for : "room";
      design.electrical.push({
        id: id,
        kind: p.kind,
        wall: p.kind === "fan" ? null : p.wall,
        offset: p.kind === "fan" ? 0 : num(p.offset, 0, wallSpan(design.room, p.wall), 1),
        height: num(p.height, 0.3, design.room.h, ELECTRICAL_KINDS[p.kind].height || design.room.h),
        for: forId,
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
    return design;
  }

  // A design in a link: compact JSON, base64url. decode() returns null for
  // anything that isn't one.
  function encode(design) {
    var compact = {
      v: 3,
      room: {
        w: round(design.room.w, 3),
        l: round(design.room.l, 3),
        h: round(design.room.h, 3),
        wet: stackWall(design),
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
        };
      }),
      finishes: design.finishes,
      products: design.products,
    };
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
  function resize(design, room) {
    var next = Object.assign({}, design, {
      room: Object.assign({ wet: stackWall(design) }, room),
    });
    next.items = design.items.map(function (it) {
      var span = wallSpan(room, it.wall);
      return Object.assign({}, it, { offset: clamp(it.offset, 0, span) });
    });
    next.electrical = electricalOf(design).map(function (p) {
      if (p.kind === "fan") return Object.assign({}, p, { height: room.h });
      var span = wallSpan(room, p.wall);
      return Object.assign({}, p, {
        offset: clamp(p.offset, 0, span),
        height: clamp(p.height, 0.3, room.h - 0.4),
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
    wallSpan: wallSpan,
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
    stackRun: stackRun,
    drainRun: drainRun,
    suggestStack: suggestStack,
    setStack: setStack,
    MAX_ELECTRICAL: MAX_ELECTRICAL,
    ELECTRICAL_KINDS: ELECTRICAL_KINDS,
    ELECTRICAL_IDS: ["outlet", "switch", "light", "fan"],
    electrical: electricalOf,
    electricalPose: electricalPose,
    validateElectrical: validateElectrical,
    electricalGaps: electricalGaps,
    suggestElectrical: suggestElectrical,
    snapElectrical: snapElectrical,
    moveElectrical: moveElectrical,
    addElectrical: addElectrical,
    removeElectrical: removeElectrical,
    toElectricalPlacements: toElectricalPlacements,
    electricalPoints: electricalPoints,
    wallAreas: wallAreas,
    defaultOpts: defaultOpts,
    emptyDesign: emptyDesign,
    fromTemplate: fromTemplate,
    sanitize: sanitize,
    encode: encode,
    decode: decode,
    resize: resize,
  };
});
