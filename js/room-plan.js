// Room Designer 3D — the room plan: what is in the bathroom and where.
//
// Pure logic, no DOM and no Three.js, so it runs in the browser
// (window.RoomPlan) and in Node for the unit tests. js/studio.js keeps a
// design in this shape, asks this module whether it works, where a new
// fixture should go and how to arrange the whole room, and hands the
// result to js/bathroom-room-3d.js (toPlacements) to draw.
//
// A design:
//   { v: 2,
//     room: { w, l, h },            feet: width (x), length (z), ceiling
//     items: [ { id, type, wall, offset, opts } ],
//     finishes: { demolition, floor, walls, ceiling, picks: {} },
//     products: { <3D product slot id>: <option id> } }
//
// Every fixture stands against a wall, facing into the room. wall is
// "N" (z = 0), "E" (x = w), "S" (z = l) or "W" (x = 0); offset is the
// distance in feet from the wall's left end (as seen standing in the room
// facing it) to the fixture's center. The people-facing names are the
// letters A to D (WALL_LETTERS).
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
    },
    shower: {
      fixtureKey: "Shower_Quantity",
      size: { span: 3.2, depth: 3.2, height: 6.5 },
      front: { depth: 24, width: null },
      step: 24,
      wet: true,
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
  // anywhere: the middle of the longest wall it can stand against.
  function leastBad(design, item, sizes) {
    var room = design.room;
    var size = sizeOf(item, sizes);
    var best = null;
    WALL_IDS.forEach(function (wid) {
      var span = wallSpan(room, wid);
      var half = Math.min(size.span / 2, span / 2);
      [half, span / 2, span - half].forEach(function (a) {
        var cand = Object.assign({}, item, { wall: wid, offset: round(a, 4) });
        var errs = errorsOf(validate(withItem(design, cand), sizes), cand.id).length;
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
        // alternatives instead of the same spot nudged an inch.
        var chosen = [];
        var perWall = {};
        spots.forEach(function (s) {
          if (chosen.length >= perItem) return;
          perWall[s.wall] = (perWall[s.wall] || 0) + 1;
          if (perWall[s.wall] > Math.ceil(perItem / 2)) return;
          if (
            chosen.some(function (c) {
              return c.wall === s.wall && Math.abs(c.offset - s.offset) < 0.75;
            })
          )
            return;
          chosen.push(s);
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
    return { v: 2, room: { w: w, l: l, h: h }, items: [], finishes: finishesDefault(), products: {} };
  }

  // The common bathrooms people start from. Fixtures are listed with their
  // wall; arrange() places them for real, so a template always fits.
  var TEMPLATES = [
    {
      id: "full5x8",
      room: { w: 8, l: 5, h: 8 },
      door: { wall: "S", offset: 4.6 },
      items: ["tub", "vanity", "toilet"],
    },
    {
      id: "showerBath",
      room: { w: 8, l: 6, h: 8 },
      door: { wall: "S", offset: 4.5 },
      items: ["shower", "vanity", "toilet"],
    },
    {
      id: "primary",
      room: { w: 11, l: 9, h: 8.5 },
      door: { wall: "S", offset: 2 },
      items: ["tub", "shower", "vanity", "vanity", "toilet", "cabinet"],
    },
    {
      id: "half",
      room: { w: 5, l: 5, h: 8 },
      door: { wall: "S", offset: 2.5 },
      items: ["sink", "toilet"],
    },
    {
      id: "blank",
      room: { w: 8, l: 6, h: 8 },
      door: { wall: "S", offset: 4 },
      items: [],
    },
  ];

  function fromTemplate(templateId, sizes) {
    var tpl =
      TEMPLATES.filter(function (t) {
        return t.id === templateId;
      })[0] || TEMPLATES[0];
    var design = emptyDesign(tpl.room.w, tpl.room.l, tpl.room.h);
    var door = { id: "door", type: "door", wall: tpl.door.wall, offset: tpl.door.offset, opts: defaultOpts("door") };
    design.items.push(door);
    tpl.items.forEach(function (type) {
      design.items.push({ id: newId(design), type: type, wall: "N", offset: 0, opts: defaultOpts(type) });
    });
    if (tpl.items.length) {
      var best = arrange(design, sizes, { count: 1 })[0];
      if (best) design.items = best.items;
    }
    return design;
  }

  // -------------------------------------------------------------------
  // Keeping designs safe to load
  // -------------------------------------------------------------------
  // Whatever comes back from storage or a shared link is checked field by
  // field; anything unusable is dropped or reset to its default.
  function sanitize(raw) {
    if (!raw || typeof raw !== "object" || raw.v !== 2) return null;
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
      v: 2,
      room: { w: round(design.room.w, 3), l: round(design.room.l, 3), h: round(design.room.h, 3) },
      items: design.items.map(function (it) {
        return { id: it.id, type: it.type, wall: it.wall, offset: round(it.offset, 3), opts: it.opts };
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
    var next = Object.assign({}, design, { room: room });
    next.items = design.items.map(function (it) {
      var span = wallSpan(room, it.wall);
      return Object.assign({}, it, { offset: clamp(it.offset, 0, span) });
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
