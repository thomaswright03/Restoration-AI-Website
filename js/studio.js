// Room Designer 3D — the design studio (designer.html).
//
// A homeowner designs their bathroom here, one step at a time: the room
// (its size and doorways), the layout (the fixtures, each against a wall
// where it fits), the products (Kohler models at their real size), the
// finishes (floor, walls, ceiling) and the estimate, which goes to the
// business with the request form. Everything shows live in the 3D room
// (js/bathroom-room-3d.js) and on a measured floor plan drawn here as SVG;
// what fits where is js/room-plan.js's call.
//
// The design is kept in this browser as it changes, and travels in a link
// (#design=...), so a homeowner can come back to it or send it on, and the
// business opens exactly what was designed.
(function () {
  "use strict";

  var Plan = window.RoomPlan;
  var Pricing = window.BathroomPricing;
  var Materials = window.MaterialsPricing;
  var I18n = window.I18n;
  var T = I18n.t;
  var BIZ = window.DesignerBusiness || { name: "", phone: "", email: "", slug: "demo" };
  var SVG_NS = "http://www.w3.org/2000/svg";
  var IN = 1 / 12;

  var STEPS = ["room", "layout", "products", "finishes", "estimate"];
  var ADDABLE = ["toilet", "vanity", "sink", "tub", "shower", "cabinet"];
  var MAX_DOORS = 3;
  var STORE_KEY = "rd3d_design_" + (BIZ.slug || "demo");
  var HASH_KEY = "design";
  // Tile and plank floors are bought with extra for cuts and breakage;
  // walls take two coats of paint.
  var TILE_WASTE = 1.1;
  var PAINT_COATS = 2;
  // The surface products (js/materials-pricing.js CATALOG) for each finish.
  var SURFACE_CATS = ["floorTile", "flooring", "wallTile", "wallPaint", "ceilingPaint"];

  // ---------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    setAttrs(el, attrs);
    append(el, kids);
    return el;
  }

  function s(tag, attrs, kids) {
    var el = document.createElementNS(SVG_NS, tag);
    setAttrs(el, attrs);
    append(el, kids);
    return el;
  }

  function setAttrs(el, attrs) {
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "class") el.setAttribute("class", v);
      else if (k === "text") el.textContent = v;
      else if (k === "icon") el.insertAdjacentHTML("afterbegin", icon(v));
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    });
  }

  function append(el, kids) {
    (kids || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function num(n, places) {
    var f = Math.pow(10, places === undefined ? 3 : places);
    return Math.round(n * f) / f;
  }

  function copy(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  var len = Plan.formatLength;

  // ---------------------------------------------------------------------
  // Icons (24 x 24, drawn in the text color)
  // ---------------------------------------------------------------------
  var ICONS = {
    toilet:
      '<path d="M7 4h7v5H7z"/><path d="M6 9h9c1 0 1.6.8 1.4 1.8l-1 5.2A3 3 0 0 1 12.5 18.5h-1A3 3 0 0 1 8.6 16l-1-5.2C7.4 9.8 8 9 9 9"/><path d="M8.5 18.5 8 21m7-2.5.5 2.5"/>',
    vanity:
      '<rect x="4" y="12" width="16" height="8" rx="1"/><ellipse cx="12" cy="9.5" rx="6" ry="2.5"/><path d="M12 5v2"/>',
    sink: '<path d="M4 9h16"/><path d="M5 9a7 5 0 0 0 14 0"/><path d="M11 14v7h2v-7"/><path d="M12 4v3"/>',
    tub: '<path d="M3 12h18v2a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5z"/><path d="M5 12V6a2 2 0 0 1 4 0"/><path d="M7 19l-1 2m12-2 1 2"/>',
    shower: '<path d="M5 21V8a4 4 0 0 1 8 0"/><path d="M10 11h6"/><path d="M11 14v1M13 14v2M15 14v1M12 17v1M14 18v1"/>',
    cabinet: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M12 3v18"/><path d="M10 11v2M14 11v2"/>',
    door: '<path d="M5 21V4a1 1 0 0 1 1-1h9v18"/><path d="M15 3l4 2v16h-4"/><path d="M12 12h.01"/><path d="M3 21h18"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    restart: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    cube: '<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/>',
    plan: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 11h7v10M14 3v6h7"/>',
    walk: '<circle cx="13" cy="4" r="2"/><path d="m9 22 2-6-2-3 1.5-5h3l2 4 3 1.5"/><path d="M9.5 13 6 15"/>',
    frame: '<path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    duplicate:
      '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    left: '<path d="m15 6-6 6 6 6"/>',
    right: '<path d="m9 6 6 6-6 6"/>',
    arrange:
      '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.2 2.2M16.2 16.2l2.2 2.2M5.6 18.4l2.2-2.2M16.2 7.8l2.2-2.2"/><circle cx="12" cy="12" r="2.5"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    download: '<path d="M12 3v12m0 0-4-4m4 4 4-4"/><path d="M4 17v3h16v-3"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    send: '<path d="M4 12 20 4l-6 16-3-7z"/><path d="m11 13 9-9"/>',
  };

  function icon(name) {
    return (
      '<svg class="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      (ICONS[name] || "") +
      "</svg>"
    );
  }

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  var room3d = null; // window.BathroomRoom3D once the 3D module is on the page
  var has3d = false; // the 3D room is drawing
  var DEFAULT_PICKS = {};
  var design = null;
  var sizes = null;
  var issues = {};
  var past = [];
  var future = [];
  var lastMerge = null;
  var config = null;
  var ui = {
    step: "room",
    view: "3d",
    selected: null,
    hover: null,
    drag: null,
    arrange: null, // { options: [...] } while "Arrange it for me" shows its choices
    messageEdited: false,
    livePrices: null, // { zip, store, results } from the pricing service
  };
  var els = {};

  function findItem(id, d) {
    return (d || design).items.filter(function (it) {
      return it.id === id;
    })[0];
  }

  function itemsOf(type, d) {
    return (d || design).items.filter(function (it) {
      return it.type === type;
    });
  }

  // "Vanity", or "Vanity 2" when there's more than one.
  function itemName(item, d) {
    var same = itemsOf(item.type, d);
    var base = T("studio.type." + item.type);
    return same.length > 1 ? base + " " + (same.indexOf(item) + 1) : base;
  }

  // "the vanity" (es "el mueble de lavabo"), for sentences about it.
  function theName(id, d) {
    if (id === "wall") return T("studio.the.wall");
    if (id === "ceiling") return T("studio.the.ceiling");
    var item = findItem(id, d);
    if (!item) return T("studio.the.wall");
    var same = itemsOf(item.type, d);
    var base = T("studio.the." + item.type);
    return same.length > 1 ? base + " " + (same.indexOf(item) + 1) : base;
  }

  function letter(wallId) {
    return Plan.WALL_LETTERS[wallId];
  }

  // How many fixtures (and doors) don't fit where they are.
  function errorCount(list) {
    return Object.keys(list).filter(function (id) {
      return Plan.errorsOf(list, id).length > 0;
    }).length;
  }

  // How many fit, but tighter than recommended.
  function tightCount(list) {
    return Object.keys(list).filter(function (id) {
      return (list[id] || []).length > 0 && !Plan.errorsOf(list, id).length;
    }).length;
  }

  // How a fixture is doing: "error", "warn" or "ok".
  function toneOf(id, list) {
    var mine = (list || issues)[id] || [];
    if (
      mine.some(function (x) {
        return x.level === "error";
      })
    )
      return "error";
    return mine.length ? "warn" : "ok";
  }

  // One sentence per problem with item, in the page's language.
  function issueText(item, x, d) {
    var data = { need: x.need, have: x.have, other: theName(x.other, d) };
    var key = "studio.issue." + x.code;
    if (x.code === "side" && item.type !== "toilet") key = "studio.issue.sideGap";
    if ((x.code === "front" || x.code === "tightFront") && x.other === "wall") key += "Wall";
    return T(key, data);
  }

  // ---------------------------------------------------------------------
  // Changing the design
  // ---------------------------------------------------------------------
  // Every change goes through here: it's kept for Undo, drawn, checked and
  // saved. merge: a key; repeated changes with the same key within a
  // second (nudging with the arrow keys) undo as one.
  function commit(next, opts) {
    opts = opts || {};
    var now = Date.now();
    var merging = opts.merge && lastMerge && lastMerge.key === opts.merge && now - lastMerge.at < 1200;
    if (!merging) {
      past.push(design);
      if (past.length > 100) past.shift();
    }
    lastMerge = opts.merge ? { key: opts.merge, at: now } : null;
    future = [];
    design = next;
    refresh(opts);
  }

  function undo() {
    if (!past.length) return;
    future.push(design);
    design = past.pop();
    lastMerge = null;
    refresh({ announce: T("studio.undone") });
  }

  function redo() {
    if (!future.length) return;
    past.push(design);
    design = future.pop();
    lastMerge = null;
    refresh({ announce: T("studio.redone") });
  }

  function withItem(d, id, change) {
    return Object.assign({}, d, {
      items: d.items.map(function (it) {
        return it.id === id ? Object.assign({}, it, change) : it;
      }),
    });
  }

  function withoutItem(d, id) {
    return Object.assign({}, d, {
      items: d.items.filter(function (it) {
        return it.id !== id;
      }),
    });
  }

  function withFinishes(change) {
    return Object.assign({}, design, { finishes: Object.assign({}, design.finishes, change) });
  }

  // Redraws everything for the design as it is now.
  function refresh(opts) {
    opts = opts || {};
    applyProducts();
    sizes = room3d ? room3d.itemSizes() : null;
    issues = Plan.validate(design, sizes);
    if (ui.selected && !findItem(ui.selected)) ui.selected = null;
    if (!opts.keepArrange) ui.arrange = null;
    push3d();
    renderStage();
    renderBar();
    // quiet: a slider being dragged; the panel catches up when it's let go.
    if (!opts.quiet) renderPanel();
    if (opts.announce) announce(opts.announce);
    saveSoon();
  }

  // The 3D room's product picks follow the design's.
  function applyProducts() {
    if (!room3d) return;
    var picks = Object.assign({}, DEFAULT_PICKS, design.products);
    Object.keys(picks).forEach(function (slotId) {
      room3d.setProductPick(slotId, picks[slotId]);
    });
  }

  // ---------------------------------------------------------------------
  // Keeping the design
  // ---------------------------------------------------------------------
  var saveTimer = null;

  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({ design: design, savedAt: Date.now() }));
      } catch (e) {
        /* storage blocked or full: the design still works for this visit */
      }
    }, 300);
  }

  function savedDesign() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORE_KEY));
      return raw && Plan.sanitize(raw.design);
    } catch (e) {
      return null;
    }
  }

  function linkedDesign() {
    var m = new RegExp("[#&]" + HASH_KEY + "=([A-Za-z0-9_-]+)").exec(window.location.hash);
    return m ? Plan.decode(m[1]) : null;
  }

  function shareUrl() {
    var url = window.location.href.split("#")[0];
    return url + "#" + HASH_KEY + "=" + Plan.encode(design);
  }

  function copyLink() {
    var url = shareUrl();
    var done = function () {
      toast(T("studio.linkCopied"));
    };
    var fallback = function () {
      openLinkDialog(url);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, fallback);
    } else {
      fallback();
    }
  }

  function openLinkDialog(url) {
    var dialog = els.linkDialog;
    var input = dialog.querySelector("input");
    input.value = url;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    input.focus();
    input.select();
  }

  // ---------------------------------------------------------------------
  // Where things are
  // ---------------------------------------------------------------------
  function wallOf(wallId, d) {
    return Plan.walls((d || design).room)[wallId];
  }

  // A point a along a wall and depth into the room, in room feet.
  function wallPoint(wall, a, depth) {
    return { x: wall.ox + wall.dx * a + wall.nx * depth, z: wall.oz + wall.dz * a + wall.nz * depth };
  }

  // How the 3D room stands a fixture: { x, z, rotationY, wall }.
  function poseOf(item, d) {
    var wall = wallOf(item.wall, d);
    var p = wallPoint(wall, item.offset, 0);
    return { x: p.x, z: p.z, rotationY: wall.rotY, wall: item.wall };
  }

  // The middle of a fixture's footprint, room feet.
  function centerOf(item, d) {
    var size = Plan.sizeOf(item, sizes);
    return wallPoint(wallOf(item.wall, d), item.offset, size.depth / 2);
  }

  function moveItem(d, id, wallId, offset) {
    return withItem(d, id, { wall: wallId, offset: num(offset, 4) });
  }

  // The wall to the left (prev) or right (next) of this one, going round
  // the room A, B, C, D: one's right end is the next one's left end.
  function neighborWall(wallId, dir) {
    var i = Plan.WALL_IDS.indexOf(wallId);
    return Plan.WALL_IDS[(i + (dir > 0 ? 1 : 3)) % 4];
  }

  // The tile panels around each tub: the wall behind it and, where it
  // fills a corner, the end wall beside it, up to 6 ft.
  function surroundPanels(d) {
    var out = [];
    itemsOf("tub", d).forEach(function (item) {
      var g = Plan.geometry(item, d.room, sizes);
      var span = g.wall.span;
      out.push({ wallId: item.wall, a0: g.a0, a1: g.a1, top: 6 });
      if (g.a0 < 2 * IN) {
        var left = neighborWall(item.wall, -1);
        var leftSpan = Plan.wallSpan(d.room, left);
        out.push({ wallId: left, a0: leftSpan - g.size.depth, a1: leftSpan, top: 6 });
      }
      if (g.a1 > span - 2 * IN) {
        out.push({ wallId: neighborWall(item.wall, 1), a0: 0, a1: g.size.depth, top: 6 });
      }
    });
    return out;
  }

  // A door's swing on the floor: hinged at its left end, opening into the
  // room.
  function doorSwing(item, d) {
    var wall = wallOf(item.wall, d);
    var span = Plan.sizeOf(item, sizes).span;
    var hinge = wallPoint(wall, item.offset - span / 2, 0);
    return { x: hinge.x, z: hinge.z, r: span, ax: wall.dx, az: wall.dz, bx: wall.nx, bz: wall.nz };
  }

  // The gaps around a fixture, for labels: [{ from, to, mid, text }] in
  // room feet at floor level, left, right and in front.
  function gapsOf(item, d) {
    var m = Plan.measure(d, item.id, sizes);
    if (!m) return [];
    var wall = wallOf(item.wall, d);
    var size = Plan.sizeOf(item, sizes);
    var half = size.span / 2;
    var depthMid = Math.min(size.depth / 2, 1);
    var out = [];
    var add = function (a0, d0, a1, d1, dist, kind) {
      if (!(dist > 0.04)) return;
      var from = wallPoint(wall, a0, d0);
      var to = wallPoint(wall, a1, d1);
      out.push({
        from: from,
        to: to,
        mid: { x: (from.x + to.x) / 2, z: (from.z + to.z) / 2 },
        text: len(dist),
        kind: kind,
      });
    };
    if (item.type !== "door") {
      add(item.offset - half - m.left.dist, depthMid, item.offset - half, depthMid, m.left.dist, "left");
      add(item.offset + half, depthMid, item.offset + half + m.right.dist, depthMid, m.right.dist, "right");
      add(item.offset, size.depth, item.offset, size.depth + m.front.dist, m.front.dist, "front");
    } else {
      add(0, 0.25, item.offset - half, 0.25, item.offset - half, "left");
      add(item.offset + half, 0.25, wall.span, 0.25, wall.span - item.offset - half, "right");
    }
    return out;
  }

  // Marks on the 3D floor: every door's swing, and the selected (or
  // dragged) fixture's footprint and the clear floor it needs.
  function floorMarks(d, list, id) {
    var marks = [];
    d.items.forEach(function (item) {
      if (item.type === "door" && (item.opts || {}).kind !== "opening") {
        marks.push({ arc: doorSwing(item, d), tone: item.id === id ? toneOf(id, list) : "info", fill: 0.1 });
      }
    });
    if (id) {
      var tone = toneOf(id, list);
      Plan.outlines(d, sizes).forEach(function (o) {
        if (o.id !== id) return;
        o.zones.forEach(function (z) {
          if (z.kind === "swing") return;
          marks.push(Object.assign({ tone: tone, fill: 0.14 }, z.rect));
        });
        marks.push(Object.assign({ tone: tone, fill: 0.3 }, o.body));
      });
    }
    return marks;
  }

  // ---------------------------------------------------------------------
  // The floor plan (SVG, room feet; wall A at the top)
  // ---------------------------------------------------------------------
  var WALL_T = 0.35; // drawn wall thickness, feet
  var planIds = 0;

  // opts: { mini, list (issues), selected, hover, zones (show every
  // fixture's clear floor), interactive }
  // Draws into `into` (an <svg> kept across redraws, so a drag's pointer
  // capture survives) or a new <svg>.
  function planSvg(d, opts, into) {
    opts = opts || {};
    var room = d.room;
    var list = opts.list || {};
    var mini = !!opts.mini;
    var big = Math.max(room.w, room.l);
    var fs = clamp(big * 0.042, 0.3, 0.95);
    var margin = mini ? (opts.tags ? WALL_T + fs * 2 : 0.55) : WALL_T + fs * 3.4;
    var id = "p" + ++planIds;
    var svg = into ? clear(into) : s("svg");
    setAttrs(svg, {
      class: "plan-svg" + (mini ? " is-mini" : ""),
      viewBox: [-margin, -margin, room.w + 2 * margin, room.l + 2 * margin]
        .map(function (n) {
          return num(n, 3);
        })
        .join(" "),
      "aria-hidden": mini ? "true" : null,
      role: mini ? null : "group",
      "aria-label": mini ? null : T("studio.plan.label", { w: len(room.w), l: len(room.l) }),
    });
    if (!mini) {
      svg.appendChild(
        s("defs", null, [
          s("pattern", { id: id + "-grid", width: 1, height: 1, patternUnits: "userSpaceOnUse" }, [
            s("path", { d: "M 1 0 L 0 0 0 1", class: "plan-grid-line" }),
          ]),
        ]),
      );
    }
    svg.appendChild(
      s("rect", {
        x: 0,
        y: 0,
        width: room.w,
        height: room.l,
        class: "plan-floor",
        fill: mini ? null : "url(#" + id + "-grid)",
      }),
    );

    var outlines = Plan.outlines(d, sizes);
    // Clear floor: the selected fixture's, or everyone's.
    outlines.forEach(function (o) {
      if (!opts.zones && o.id !== opts.selected) return;
      var tone = toneOf(o.id, list);
      o.zones.forEach(function (z) {
        if (z.kind === "swing") return;
        svg.appendChild(rectEl(z.rect, "plan-zone is-" + tone + " is-" + z.kind));
      });
    });

    // Fixtures.
    d.items.forEach(function (item) {
      if (item.type === "door") return;
      svg.appendChild(fixtureEl(d, item, list, opts, fs));
    });

    // Walls with their doorways cut out, then the doors.
    Plan.WALL_IDS.forEach(function (wid) {
      var wall = wallOf(wid, d);
      var gaps = d.items
        .filter(function (it) {
          return it.type === "door" && it.wall === wid;
        })
        .map(function (it) {
          var half = Plan.sizeOf(it, sizes).span / 2;
          return [it.offset - half, it.offset + half];
        })
        .sort(function (p, q) {
          return p[0] - q[0];
        });
      var cursor = -WALL_T;
      gaps.forEach(function (g) {
        if (g[0] > cursor) svg.appendChild(wallSegment(wall, cursor, g[0]));
        cursor = Math.max(cursor, g[1]);
      });
      if (wall.span + WALL_T > cursor) svg.appendChild(wallSegment(wall, cursor, wall.span + WALL_T));
    });
    d.items.forEach(function (item) {
      if (item.type === "door") svg.appendChild(doorEl(d, item, list, opts, fs));
    });

    if (mini && !opts.tags) return svg;

    // Wall letters and the room's size.
    Plan.WALL_IDS.forEach(function (wid) {
      var wall = wallOf(wid, d);
      var p = wallPoint(wall, wall.span / 2, -(WALL_T + fs * 1.05));
      svg.appendChild(
        s("g", { class: "plan-wall-tag" }, [
          s("circle", { cx: num(p.x), cy: num(p.z), r: num(fs * 0.78) }),
          s("text", { x: num(p.x), y: num(p.z), "font-size": num(fs * 0.95), dy: "0.35em" }, [letter(wid)]),
        ]),
      );
    });
    if (mini) return svg;
    svg.appendChild(
      dimension({ x: 0, z: -(WALL_T + fs * 2.6) }, { x: room.w, z: -(WALL_T + fs * 2.6) }, len(room.w), fs, false),
    );
    svg.appendChild(
      dimension({ x: -(WALL_T + fs * 2.6), z: 0 }, { x: -(WALL_T + fs * 2.6), z: room.l }, len(room.l), fs, true),
    );

    // The selected fixture's gaps.
    var sel = opts.selected && findItem(opts.selected, d);
    if (sel) {
      gapsOf(sel, d).forEach(function (g) {
        svg.appendChild(dimension(g.from, g.to, g.text, fs * 0.82, false, "plan-gap"));
      });
    }
    return svg;
  }

  function rectEl(r, cls) {
    return s("rect", { x: num(r.x0), y: num(r.z0), width: num(r.x1 - r.x0), height: num(r.z1 - r.z0), class: cls });
  }

  function wallSegment(wall, a0, a1) {
    var p0 = wallPoint(wall, a0, -WALL_T);
    var p1 = wallPoint(wall, a1, 0);
    return rectEl(
      { x0: Math.min(p0.x, p1.x), x1: Math.max(p0.x, p1.x), z0: Math.min(p0.z, p1.z), z1: Math.max(p0.z, p1.z) },
      "plan-wall",
    );
  }

  // The SVG transform that draws a fixture in its own frame (x along its
  // wall from its center, y out into the room).
  function itemTransform(item, d) {
    var wall = wallOf(item.wall, d);
    var o = wallPoint(wall, item.offset, 0);
    return "matrix(" + [wall.dx, wall.dz, wall.nx, wall.nz, num(o.x), num(o.z)].join(" ") + ")";
  }

  function fixtureEl(d, item, list, opts, fs) {
    var size = Plan.sizeOf(item, sizes);
    var w = size.span;
    var dp = size.depth;
    var tone = toneOf(item.id, list);
    var g = s("g", {
      class:
        "plan-item is-" +
        tone +
        (item.id === opts.selected ? " is-selected" : "") +
        (item.id === opts.hover ? " is-hover" : ""),
      "data-id": item.id,
    });
    if (opts.interactive) {
      g.setAttribute("tabindex", "0");
      g.setAttribute("role", "button");
      g.setAttribute("aria-label", itemLabel(item, d));
      if (item.id === opts.selected) g.setAttribute("aria-pressed", "true");
    }
    var body = s("g", { transform: itemTransform(item, d) });
    body.appendChild(s("rect", { x: num(-w / 2), y: 0, width: num(w), height: num(dp), rx: 0.08, class: "plan-body" }));
    symbolFor(item.type, w, dp, (item.opts || {}).count).forEach(function (el) {
      body.appendChild(el);
    });
    g.appendChild(body);
    if (!opts.mini) {
      var c = centerOf(item, d);
      var label = T("studio.short." + item.type);
      g.appendChild(
        s("text", { x: num(c.x), y: num(c.z), class: "plan-item-label", "font-size": num(fs * 0.62), dy: "0.35em" }, [
          label,
        ]),
      );
    }
    return g;
  }

  // Simple line drawings of each fixture, from above, in its own frame.
  function symbolFor(type, w, dp) {
    var out = [];
    var cls = "plan-symbol";
    if (type === "toilet") {
      out.push(
        s("rect", {
          x: num(-w * 0.36),
          y: num(dp * 0.04),
          width: num(w * 0.72),
          height: num(dp * 0.24),
          rx: 0.05,
          class: cls,
        }),
      );
      out.push(s("ellipse", { cx: 0, cy: num(dp * 0.63), rx: num(w * 0.27), ry: num(dp * 0.33), class: cls }));
    } else if (type === "vanity") {
      var bowls = w >= 4.6 ? [-w / 4, w / 4] : [0];
      bowls.forEach(function (x) {
        out.push(
          s("ellipse", {
            cx: num(x),
            cy: num(dp * 0.55),
            rx: num(Math.min(w * 0.3, 0.75)),
            ry: num(dp * 0.27),
            class: cls,
          }),
        );
      });
    } else if (type === "sink") {
      out.push(s("ellipse", { cx: 0, cy: num(dp * 0.52), rx: num(w * 0.4), ry: num(dp * 0.38), class: cls }));
    } else if (type === "tub") {
      var inset = Math.min(0.22, dp * 0.12);
      out.push(
        s("rect", {
          x: num(-w / 2 + inset),
          y: num(inset),
          width: num(w - 2 * inset),
          height: num(dp - 2 * inset),
          rx: num(dp * 0.3),
          class: cls,
        }),
      );
      out.push(s("circle", { cx: num(-w / 2 + inset + 0.45), cy: num(dp / 2), r: 0.1, class: cls }));
    } else if (type === "shower") {
      out.push(
        s("path", {
          d:
            "M " +
            num(-w / 2) +
            " 0 L " +
            num(w / 2) +
            " " +
            num(dp) +
            " M " +
            num(w / 2) +
            " 0 L " +
            num(-w / 2) +
            " " +
            num(dp),
          class: cls + " is-faint",
        }),
      );
      out.push(s("circle", { cx: 0, cy: num(dp / 2), r: 0.14, class: cls }));
    } else if (type === "cabinet") {
      out.push(s("path", { d: "M 0 " + num(dp * 0.15) + " L 0 " + num(dp), class: cls }));
    }
    return out;
  }

  function doorEl(d, item, list, opts, fs) {
    var span = Plan.sizeOf(item, sizes).span;
    var kind = (item.opts || {}).kind;
    var tone = toneOf(item.id, list);
    var g = s("g", {
      class:
        "plan-item plan-door is-" +
        tone +
        (item.id === opts.selected ? " is-selected" : "") +
        (item.id === opts.hover ? " is-hover" : ""),
      "data-id": item.id,
    });
    if (opts.interactive) {
      g.setAttribute("tabindex", "0");
      g.setAttribute("role", "button");
      g.setAttribute("aria-label", itemLabel(item, d));
      if (item.id === opts.selected) g.setAttribute("aria-pressed", "true");
    }
    var body = s("g", { transform: itemTransform(item, d) });
    var half = span / 2;
    // Something to grab: the opening itself.
    body.appendChild(
      s("rect", {
        x: num(-half),
        y: num(-WALL_T),
        width: num(span),
        height: num(WALL_T + 0.25),
        class: "plan-door-hit",
      }),
    );
    if (kind === "opening") {
      body.appendChild(s("path", { d: "M " + num(-half) + " 0 L " + num(half) + " 0", class: "plan-door-sill" }));
    } else {
      body.appendChild(
        s("path", {
          d: "M " + num(-half) + " " + num(span) + " A " + num(span) + " " + num(span) + " 0 0 0 " + num(half) + " 0",
          class: "plan-door-swing",
        }),
      );
      body.appendChild(
        s("path", { d: "M " + num(-half) + " 0 L " + num(-half) + " " + num(span), class: "plan-door-leaf" }),
      );
    }
    g.appendChild(body);
    if (!opts.mini && kind === "new") {
      var c = wallPoint(wallOf(item.wall, d), item.offset, 0.55);
      g.appendChild(
        s("text", { x: num(c.x), y: num(c.z), class: "plan-item-label", "font-size": num(fs * 0.55), dy: "0.35em" }, [
          T("studio.short.newDoor"),
        ]),
      );
    }
    return g;
  }

  // A measured line between two points with its length written on it.
  function dimension(from, to, text, fs, vertical, cls) {
    var g = s("g", { class: cls || "plan-dim" });
    var dx = to.x - from.x;
    var dz = to.z - from.z;
    var length = Math.sqrt(dx * dx + dz * dz) || 1;
    var ux = dx / length;
    var uz = dz / length;
    var tick = fs * 0.35;
    g.appendChild(s("path", { d: "M " + num(from.x) + " " + num(from.z) + " L " + num(to.x) + " " + num(to.z) }));
    [from, to].forEach(function (p) {
      g.appendChild(
        s("path", {
          d:
            "M " +
            num(p.x - uz * tick) +
            " " +
            num(p.z + ux * tick) +
            " L " +
            num(p.x + uz * tick) +
            " " +
            num(p.z - ux * tick),
        }),
      );
    });
    var mx = (from.x + to.x) / 2;
    var mz = (from.z + to.z) / 2;
    var label = s("text", { x: num(mx), y: num(mz), "font-size": num(fs * 0.8), dy: "0.35em" }, [text]);
    if (vertical) label.setAttribute("transform", "rotate(-90 " + num(mx) + " " + num(mz) + ")");
    g.appendChild(
      s("rect", {
        class: "plan-dim-bg",
        x: num(mx - fs * 1.4),
        y: num(mz - fs * 0.45),
        width: num(fs * 2.8),
        height: num(fs * 0.9),
        rx: num(fs * 0.2),
        transform: vertical ? "rotate(-90 " + num(mx) + " " + num(mz) + ")" : null,
      }),
    );
    g.appendChild(label);
    return g;
  }

  // "Toilet on wall B, center 2′ 3″ from the left corner."
  function itemLabel(item, d) {
    return T("studio.itemAt", { name: itemName(item, d), wall: letter(item.wall), at: len(item.offset) });
  }

  // ---------------------------------------------------------------------
  // The stage: the 3D room or the plan, with its labels
  // ---------------------------------------------------------------------
  function push3d() {
    if (!room3d) return;
    var f = design.finishes;
    room3d.setRoomSize(design.room.w, design.room.l, design.room.h);
    room3d.setPlan(Plan.toPlacements(design, sizes));
    room3d.setScope("floorFinish", f.floor);
    // Around the tub is tiled (setSurround()); the rest is painted.
    room3d.setScope("walls", f.walls === "tileWet" ? "paint" : f.walls);
    room3d.setScope("paintCeiling", f.ceiling);
    SURFACE_CATS.forEach(function (cat) {
      var product = surfaceProduct(cat);
      var key = product ? product.id : "";
      if (pushed3d[cat] === key) return;
      pushed3d[cat] = key;
      room3d.setSurfaceFinish(cat, product);
    });
    room3d.setSurround(f.walls === "tileWet" ? surroundPanels(design) : []);
  }
  var pushed3d = {};

  // Draws the stage for the design, or for `preview` (a fixture being
  // dragged) with its own issues.
  function renderStage(preview, previewIssues) {
    var d = preview || design;
    var list = previewIssues || issues;
    var plan = ui.view === "plan" || !has3d;
    els.planWrap.hidden = !plan;
    if (els.room) els.room.hidden = plan;
    if (plan) {
      planSvg(d, { list: list, selected: ui.selected, hover: ui.hover, interactive: true }, els.planSvg);
    } else {
      planSvg(d, { mini: true, tags: true, list: list, selected: ui.selected }, els.miniSvg);
      // While dragging, the outline says whether it fits where it is.
      room3d.setHighlight(ui.selected, ui.drag && ui.drag.moved ? toneOf(ui.selected, list) : "select", ui.hover);
      room3d.setMarks(floorMarks(d, list, ui.selected));
      setLabels(d);
    }
    renderStatus(list, !!preview);
  }

  // Labels over the 3D room: the wall letters, and the selected fixture's
  // name and the gaps around it. Kept as room points; positionLabels()
  // puts them on screen every frame.
  var labelSpecs = [];

  function setLabels(d) {
    var room = d.room;
    var specs = [];
    // A wall's letter sits high on the wall when it's in view, or on the
    // floor's edge when the wall is cut away (positionLabels()).
    Plan.WALL_IDS.forEach(function (wid) {
      var wall = wallOf(wid, d);
      var top = wallPoint(wall, wall.span / 2, 0.05);
      var base = wallPoint(wall, wall.span / 2, -0.55);
      specs.push({
        x: base.x,
        y: 0,
        z: base.z,
        wall: { id: wid, top: { x: top.x, y: Math.max(room.h - 0.7, 1), z: top.z } },
        text: letter(wid),
        cls: "studio-label is-wall",
      });
    });
    var sel = ui.selected && findItem(ui.selected, d);
    if (sel) {
      var size = Plan.sizeOf(sel, sizes);
      var c = centerOf(sel, d);
      specs.push({
        x: c.x,
        y: Math.min(size.height, room.h - 0.3) + 0.35,
        z: c.z,
        text: itemName(sel, d),
        cls: "studio-label is-name is-" + toneOf(sel.id, ui.drag && ui.drag.issues ? ui.drag.issues : issues),
      });
      gapsOf(sel, d).forEach(function (g) {
        specs.push({ x: g.mid.x, y: 0.05, z: g.mid.z, text: g.text, cls: "studio-label is-gap" });
      });
    }
    labelSpecs = specs;
    var layer = els.labels;
    while (layer.children.length < specs.length) layer.appendChild(h("span"));
    while (layer.children.length > specs.length) layer.removeChild(layer.lastChild);
    specs.forEach(function (spec, i) {
      var el = layer.children[i];
      if (el.textContent !== spec.text) el.textContent = spec.text;
      if (el.className !== spec.cls) el.className = spec.cls;
    });
    positionLabels();
  }

  function positionLabels() {
    if (!has3d) return;
    var layer = els.labels;
    var cam = room3d.cameraPosition();
    labelSpecs.forEach(function (spec, i) {
      var el = layer.children[i];
      var at = spec;
      if (spec.wall && cam) {
        var w = wallOf(spec.wall.id);
        var inside = (cam.x - w.ox) * w.nx + (cam.z - w.oz) * w.nz > 0;
        if (inside) at = spec.wall.top;
      }
      var p = room3d.project(at.x, at.y, at.z);
      if (!el || !p) return;
      el.hidden = !p.visible;
      el.style.transform = "translate(" + Math.round(p.x) + "px," + Math.round(p.y) + "px) translate(-50%,-50%)";
    });
  }

  // The chip over the stage: whether everything fits, or while a fixture
  // is dragged, whether it fits where it is.
  function renderStatus(list, previewing) {
    var chip = els.status;
    var kind;
    var text;
    if (previewing && ui.drag) {
      kind = toneOf(ui.drag.id, list);
      text = T("studio.status.drag." + kind);
    } else {
      var errors = errorCount(list);
      var warns = tightCount(list);
      kind = errors ? "error" : warns ? "warn" : "ok";
      text = errors
        ? T(errors === 1 ? "studio.status.problem" : "studio.status.problems", { n: errors })
        : warns
          ? T(warns === 1 ? "studio.status.tight" : "studio.status.tights", { n: warns })
          : T("studio.status.ok");
    }
    chip.className = "studio-status is-" + kind;
    clear(chip);
    chip.insertAdjacentHTML("afterbegin", icon(kind === "ok" ? "check" : "alert"));
    chip.appendChild(h("span", { text: text }));
    chip.disabled = !!previewing;
  }

  // The first fixture with a problem (or, failing that, a tight spot).
  function firstTrouble() {
    var withError = design.items.filter(function (it) {
      return toneOf(it.id) === "error";
    })[0];
    return (
      withError ||
      design.items.filter(function (it) {
        return toneOf(it.id) === "warn";
      })[0] ||
      null
    );
  }

  function setView(view) {
    if (!has3d && view !== "plan") return;
    if (view === "walk" && !itemsOf("door").length) {
      toast(T("studio.walk.noDoor"));
      return;
    }
    var was = ui.view;
    ui.view = view;
    if (view === "plan") {
      if (room3d) room3d.hide();
    } else {
      if (was === "plan") room3d.show();
      var shown = room3d.setView(view === "walk" ? "walk" : "orbit");
      ui.view = shown === "walk" ? "walk" : "3d";
    }
    renderViewbar();
    renderStage();
    renderHint();
  }

  function renderViewbar() {
    var bar = els.viewbar;
    Array.prototype.forEach.call(bar.querySelectorAll("[data-view]"), function (btn) {
      var on = btn.getAttribute("data-view") === ui.view;
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.disabled = !has3d && btn.getAttribute("data-view") !== "plan";
    });
    els.frameBtn.hidden = ui.view === "plan" || !has3d;
    els.mini.hidden = ui.view === "plan" || !has3d;
  }

  function renderHint() {
    var key = !has3d
      ? "studio.hint.plan"
      : ui.view === "plan"
        ? "studio.hint.plan"
        : ui.view === "walk"
          ? "studio.hint.walk"
          : "studio.hint.3d";
    els.hint.textContent = T(key);
  }

  // ---------------------------------------------------------------------
  // Selecting and dragging
  // ---------------------------------------------------------------------
  function select(id, opts) {
    opts = opts || {};
    if (ui.selected === id && !opts.force) return;
    ui.selected = id || null;
    // The panel stays on its step: picking something up in the room while
    // choosing finishes shouldn't throw the finishes away. The chip over the
    // stage (renderSelChip) leads to its settings.
    renderStage();
    renderBar();
    renderPanel();
    if (id && opts.announce !== false) announce(itemLabel(findItem(id)));
  }

  function hover(id) {
    if (ui.hover === id) return;
    ui.hover = id || null;
    if (ui.drag) return;
    if (ui.view === "plan" || !has3d) {
      Array.prototype.forEach.call(els.planSvg.querySelectorAll(".plan-item"), function (g) {
        g.classList.toggle("is-hover", g.getAttribute("data-id") === ui.hover);
      });
    } else {
      room3d.setHighlight(ui.selected, "select", ui.hover);
    }
  }

  function beginDrag(id, e, grab) {
    var item = findItem(id);
    if (!item) return;
    var c = centerOf(item);
    ui.drag = {
      id: id,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      offX: grab ? c.x - grab.x : 0,
      offZ: grab ? c.z - grab.z : 0,
      planeY: grab && grab.y !== undefined ? grab.y : 0,
      snap: null,
      preview: null,
      issues: null,
    };
  }

  // The fixture follows the pointer to the room point (x, z): onto the
  // nearest wall, sliding to the nearest spot where it fits.
  function dragTo(x, z) {
    var drag = ui.drag;
    var snapped = Plan.snap(design, drag.id, x + drag.offX, z + drag.offZ, sizes);
    if (!snapped) return;
    drag.snap = snapped;
    drag.preview = moveItem(design, drag.id, snapped.wall, snapped.offset);
    drag.issues = Plan.validate(drag.preview, sizes);
    if (has3d && ui.view !== "plan") room3d.previewItem(drag.id, poseOf(findItem(drag.id, drag.preview), drag.preview));
    renderStage(drag.preview, drag.issues);
  }

  function endDrag(cancelled) {
    var drag = ui.drag;
    ui.drag = null;
    if (!drag) return;
    if (!drag.moved || cancelled || !drag.snap) {
      if (drag.moved) refresh();
      return;
    }
    var item = findItem(drag.id);
    if (drag.snap.valid) {
      var moved = findItem(drag.id, drag.preview);
      if (moved.wall === item.wall && Math.abs(moved.offset - item.offset) < 1e-6) {
        refresh();
        return;
      }
      commit(drag.preview, { announce: itemLabel(moved, drag.preview) });
    } else {
      var why = Plan.errorsOf(drag.issues, drag.id)[0];
      refresh();
      toast(
        why ? T("studio.dropRefused", { reason: issueText(item, why, drag.preview) }) : T("studio.dropRefusedPlain"),
      );
    }
  }

  function wire3d() {
    var wrap = els.canvasWrap;
    // Captured before OrbitControls sees it: a press on a fixture picks it
    // up instead of turning the room.
    wrap.addEventListener(
      "pointerdown",
      function (e) {
        if (!has3d || e.button !== 0) return;
        var hit = room3d.pickItem(e.clientX, e.clientY);
        if (!hit) {
          ui.pressEmpty = { x: e.clientX, y: e.clientY };
          return;
        }
        ui.pressEmpty = null;
        e.stopPropagation();
        e.preventDefault();
        select(hit.itemId);
        beginDrag(hit.itemId, e, hit.point);
        var canvas = wrap.querySelector("canvas");
        if (canvas) canvas.setPointerCapture(e.pointerId);
        wrap.classList.add("is-dragging");
      },
      true,
    );
    wrap.addEventListener("pointermove", function (e) {
      var drag = ui.drag;
      if (!drag) {
        if (e.pointerType === "mouse" && !e.buttons) {
          var hit = room3d.pickItem(e.clientX, e.clientY);
          hover(hit ? hit.itemId : null);
          wrap.classList.toggle("can-drag", !!hit);
        }
        return;
      }
      if (e.pointerId !== drag.pointerId) return;
      if (!drag.moved && Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) < 5) return;
      drag.moved = true;
      var p = room3d.floorPoint(e.clientX, e.clientY, drag.planeY);
      if (p) dragTo(p.x, p.z);
    });
    var up = function (e) {
      if (ui.drag && e.pointerId === ui.drag.pointerId) {
        wrap.classList.remove("is-dragging");
        endDrag(e.type === "pointercancel");
        return;
      }
      // A click on empty floor (not a turn of the room) lets go.
      var press = ui.pressEmpty;
      ui.pressEmpty = null;
      if (press && Math.abs(e.clientX - press.x) + Math.abs(e.clientY - press.y) < 5 && ui.selected) select(null);
    };
    wrap.addEventListener("pointerup", up);
    wrap.addEventListener("pointercancel", up);
    wrap.addEventListener("pointerleave", function () {
      if (!ui.drag) hover(null);
    });
  }

  // Room point under a page point on the plan.
  function planPoint(e) {
    var svg = els.planSvg;
    var m = svg.getScreenCTM();
    if (!m) return null;
    var pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    var p = pt.matrixTransform(m.inverse());
    return { x: p.x, z: p.y };
  }

  function wirePlan() {
    var svg = els.planSvg;
    svg.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      var g = e.target.closest && e.target.closest(".plan-item");
      if (!g) {
        ui.pressEmpty = { x: e.clientX, y: e.clientY };
        return;
      }
      e.preventDefault();
      var id = g.getAttribute("data-id");
      select(id);
      var p = planPoint(e);
      beginDrag(id, e, p ? { x: p.x, z: p.z } : null);
      svg.setPointerCapture(e.pointerId);
      g = svg.querySelector('.plan-item[data-id="' + id + '"]');
      if (g) g.focus({ preventScroll: true });
    });
    svg.addEventListener("pointermove", function (e) {
      var drag = ui.drag;
      if (!drag) {
        if (e.pointerType === "mouse") {
          var g = e.target.closest && e.target.closest(".plan-item");
          hover(g ? g.getAttribute("data-id") : null);
        }
        return;
      }
      if (e.pointerId !== drag.pointerId) return;
      if (!drag.moved && Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) < 4) return;
      drag.moved = true;
      var p = planPoint(e);
      if (p) dragTo(p.x, p.z);
    });
    var up = function (e) {
      if (ui.drag && e.pointerId === ui.drag.pointerId) {
        endDrag(e.type === "pointercancel");
        var g = ui.selected && svg.querySelector('.plan-item[data-id="' + ui.selected + '"]');
        if (g) g.focus({ preventScroll: true });
        return;
      }
      var press = ui.pressEmpty;
      ui.pressEmpty = null;
      if (press && Math.abs(e.clientX - press.x) + Math.abs(e.clientY - press.y) < 5 && ui.selected) select(null);
    };
    svg.addEventListener("pointerup", up);
    svg.addEventListener("pointercancel", up);
    svg.addEventListener("keydown", function (e) {
      var g = e.target.closest && e.target.closest(".plan-item");
      if (!g) return;
      var id = g.getAttribute("data-id");
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        select(id, { force: true });
        var again = svg.querySelector('.plan-item[data-id="' + id + '"]');
        if (again) again.focus({ preventScroll: true });
      }
    });
    svg.addEventListener("focusin", function (e) {
      var g = e.target.closest && e.target.closest(".plan-item");
      if (g && g.getAttribute("data-id") !== ui.selected && !ui.drag) {
        select(g.getAttribute("data-id"));
        var again = svg.querySelector('.plan-item[data-id="' + ui.selected + '"]');
        if (again) again.focus({ preventScroll: true });
      }
    });
  }

  // Arrow keys move the selected fixture along its wall, the way the arrow
  // points on screen (1 in., or 6 in. with Shift); Delete removes it;
  // Escape lets go. Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z or Ctrl+Y redoes.
  function onKey(e) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    var mod = e.ctrlKey || e.metaKey;
    if (mod && !typing && (e.key === "z" || e.key === "Z")) {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && !typing && (e.key === "y" || e.key === "Y")) {
      e.preventDefault();
      redo();
      return;
    }
    if (typing || mod || !ui.selected) return;
    var inStudio = els.studio.contains(e.target) || e.target === document.body;
    if (!inStudio) return;
    var dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (dirs[e.key] && !/^(BUTTON|A)$/.test(e.target.tagName)) {
      e.preventDefault();
      var item = findItem(ui.selected);
      var wall = wallOf(item.wall);
      var along = dirs[e.key][0] * wall.dx + dirs[e.key][1] * wall.dz;
      if (!along) return;
      nudge(item, along * (e.shiftKey ? 6 : 1) * IN);
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && !/^(BUTTON|A)$/.test(e.target.tagName)) {
      e.preventDefault();
      removeItem(ui.selected);
      return;
    }
    if (e.key === "Escape" && !ui.drag) select(null);
  }

  function nudge(item, delta) {
    var span = Plan.wallSpan(design.room, item.wall);
    var half = Plan.sizeOf(item, sizes).span / 2;
    var next = clamp(item.offset + delta, Math.min(half, span / 2), Math.max(span - half, span / 2));
    if (Math.abs(next - item.offset) < 1e-6) return;
    var d = moveItem(design, item.id, item.wall, next);
    commit(d, { merge: "nudge:" + item.id, announce: itemLabel(findItem(item.id, d), d) });
    keepFocus();
  }

  // After a redraw, focus goes back to the selected fixture on the plan.
  function keepFocus() {
    if (ui.view !== "plan" && has3d) return;
    var g = ui.selected && els.planSvg.querySelector('.plan-item[data-id="' + ui.selected + '"]');
    if (g) g.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------------
  // The bar: steps, undo, link, start over, the estimate total
  // ---------------------------------------------------------------------
  function goTo(step) {
    if (STEPS.indexOf(step) === -1) return;
    ui.step = step;
    renderBar();
    renderPanel({ top: true });
    if (step === "products" && has3d && ui.selected) room3d.focusProductGroup(null);
    var heading = els.panel.querySelector("h2");
    if (!heading) return;
    // On a phone the room stays pinned above the panel: the new step starts
    // just under it, not hidden behind it.
    var stage = els.body.firstElementChild;
    var pinned = stage && getComputedStyle(stage).position === "sticky";
    heading.focus({ preventScroll: pinned });
    if (pinned) {
      var top = els.body.getBoundingClientRect().top + window.scrollY - (parseFloat(getComputedStyle(stage).top) || 0);
      if (window.scrollY > top) window.scrollTo(0, top);
    }
  }

  function renderBar() {
    Array.prototype.forEach.call(els.steps.querySelectorAll("[data-step]"), function (btn) {
      var on = btn.getAttribute("data-step") === ui.step;
      if (on) btn.setAttribute("aria-current", "step");
      else btn.removeAttribute("aria-current");
    });
    els.studio.setAttribute("data-step", ui.step);
    var last = els.steps.querySelector('[data-label="estimate"]');
    if (last) last.textContent = stepShort("estimate");
    els.undo.disabled = !past.length;
    els.redo.disabled = !future.length;
    if (estimatorOn()) {
      var est = estimate();
      els.total.hidden = false;
      els.totalValue.textContent = Pricing.money(est.grandTotal);
    } else {
      els.total.hidden = true;
    }
  }

  var toastTimer = null;

  // A short note at the bottom of the stage, with an optional action
  // (Undo, Rearrange) for a few seconds.
  function toast(text, action) {
    var el = els.toast;
    clear(el);
    el.appendChild(h("span", { text: text }));
    if (action) {
      el.appendChild(
        h("button", {
          type: "button",
          class: "studio-toast-action",
          text: action.label,
          onclick: function () {
            el.hidden = true;
            action.run();
          },
        }),
      );
    }
    el.appendChild(
      h("button", {
        type: "button",
        class: "studio-toast-close",
        "aria-label": T("studio.close"),
        icon: "close",
        onclick: function () {
          el.hidden = true;
        },
      }),
    );
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(
      function () {
        el.hidden = true;
      },
      action ? 8000 : 5000,
    );
  }

  function announce(text) {
    els.live.textContent = "";
    setTimeout(function () {
      els.live.textContent = text;
    }, 30);
  }

  // ---------------------------------------------------------------------
  // The panel: one step at a time
  // ---------------------------------------------------------------------
  // Redrawn whenever the design changes. Focus and scroll stay where they
  // were: whatever had focus is found again by its data-key.
  var panelBusy = false;
  var panelAgain = null;

  function renderPanel(opts) {
    // A field losing focus as the old panel is taken down can change the
    // design (and ask for the panel again): that waits until this one is up.
    if (panelBusy) {
      panelAgain = Object.assign({}, panelAgain, opts);
      return;
    }
    panelBusy = true;
    try {
      drawPanel(opts || {});
    } finally {
      panelBusy = false;
    }
    if (panelAgain) {
      var again = panelAgain;
      panelAgain = null;
      renderPanel(again);
    }
  }

  function drawPanel(opts) {
    var panel = els.panel;
    var active = document.activeElement;
    var key = active && panel.contains(active) ? active.getAttribute("data-key") : null;
    var inForm = active && els.request.contains(active) ? active : null;
    var scroll = panel.scrollTop;
    // The request form is kept, not rebuilt (what's typed in it stays): it
    // waits, hidden, in its place on the page until the last step shows it.
    els.request.hidden = true;
    els.requestHome.appendChild(els.request);
    clear(panel);
    var body = h("div", { class: "studio-step is-" + ui.step });
    ({ room: roomStep, layout: layoutStep, products: productsStep, finishes: finishesStep, estimate: estimateStep })[
      ui.step
    ](body);
    body.appendChild(stepNav());
    panel.appendChild(body);
    panel.scrollTop = opts.top ? 0 : scroll;
    if (key) {
      var again = panel.querySelector('[data-key="' + key + '"]');
      if (again && !again.disabled) again.focus({ preventScroll: true });
    }
    if (inForm && document.body.contains(inForm)) inForm.focus({ preventScroll: true });
    renderSelChip();
  }

  // Without the price estimator the last step only sends the design.
  function stepShort(step) {
    return T("studio.step." + (step === "estimate" && !estimatorOn() ? "send" : step) + ".short");
  }

  function stepHead(step) {
    var n = STEPS.indexOf(step) + 1;
    return h("header", { class: "studio-step-head" }, [
      h("p", { class: "studio-step-count", text: T("studio.stepOf", { n: n, total: STEPS.length }) }),
      h("h2", { tabindex: "-1", text: T("studio.step." + step + ".title") }),
      h("p", { class: "studio-step-intro", text: T("studio.step." + step + ".intro") }),
    ]);
  }

  function section(title, kids, cls) {
    return h(
      "section",
      { class: "studio-section" + (cls ? " " + cls : "") },
      [title ? h("h3", { text: title }) : null].concat(kids),
    );
  }

  function stepNav() {
    var i = STEPS.indexOf(ui.step);
    var prev = STEPS[i - 1];
    var next = STEPS[i + 1];
    return h("nav", { class: "studio-step-nav", "aria-label": T("studio.stepNav") }, [
      prev
        ? h("button", {
            type: "button",
            class: "btn btn-secondary",
            "data-key": "nav-prev",
            text: T("studio.back", { step: stepShort(prev) }),
            onclick: function () {
              goTo(prev);
            },
          })
        : h("span"),
      next
        ? h("button", {
            type: "button",
            class: "btn btn-primary",
            "data-key": "nav-next",
            text: T("studio.next", { step: stepShort(next) }),
            onclick: function () {
              goTo(next);
            },
          })
        : null,
    ]);
  }

  // Buttons that work like radio buttons: [{ value, label, icon }].
  function choiceGroup(label, options, current, onPick, key) {
    return h(
      "div",
      { class: "studio-choices", role: "group", "aria-label": label },
      options.map(function (o) {
        var on = o.value === current;
        return h(
          "button",
          {
            type: "button",
            class: "studio-choice",
            "aria-pressed": on ? "true" : "false",
            "data-key": key + "-" + o.value,
            disabled: o.disabled ? true : null,
            title: o.title || null,
            onclick: function () {
              if (!on) onPick(o.value);
            },
          },
          [o.icon ? h("span", { class: "studio-choice-icon", icon: o.icon }) : null, h("span", { text: o.label })],
        );
      }),
    );
  }

  function wallChoice(current, onPick, key, label) {
    return choiceGroup(
      label || T("studio.wall"),
      Plan.WALL_IDS.map(function (wid) {
        return { value: wid, label: T("studio.wallN", { letter: letter(wid) }) };
      }),
      current,
      onPick,
      key,
    );
  }

  function toggle(label, checked, onChange, key, help) {
    var id = "studio-" + key;
    return h("div", { class: "studio-toggle" }, [
      h("input", {
        type: "checkbox",
        id: id,
        role: "switch",
        "data-key": key,
        checked: checked ? true : null,
        onchange: function (e) {
          onChange(e.target.checked);
        },
      }),
      h("label", { for: id }, [h("span", { text: label }), help ? h("small", { text: help }) : null]),
    ]);
  }

  // A length field that takes feet and inches ("8' 6\"", "8 6", "102 in"),
  // with 1 in. steps either side. onSet(ft) returns an error message or
  // nothing.
  function lengthField(key, label, valueFt, onSet, help) {
    var id = "studio-" + key;
    var error = h("p", { class: "studio-field-error", id: id + "-error", hidden: true });
    var input = h("input", {
      type: "text",
      id: id,
      class: "studio-length",
      inputmode: "decimal",
      autocomplete: "off",
      spellcheck: "false",
      value: len(valueFt),
      "data-key": key,
      "aria-describedby": id + "-help " + id + "-error",
    });
    function set(ft) {
      var message = onSet(ft);
      if (message) {
        error.textContent = message;
        error.hidden = false;
        input.setAttribute("aria-invalid", "true");
      }
    }
    // Enter handles the text at once; the browser's own change event for
    // the same text (when the field loses focus) is then nothing new.
    var handled = input.value;
    input.addEventListener("change", function () {
      if (input.value === handled) return;
      handled = input.value;
      var ft = Plan.parseLength(input.value);
      if (ft === null) {
        error.textContent = T("studio.lengthError");
        error.hidden = false;
        input.setAttribute("aria-invalid", "true");
        return;
      }
      set(ft);
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        input.dispatchEvent(new Event("change"));
      }
    });
    var step = function (dir) {
      return function (e) {
        var ft = Plan.parseLength(input.value);
        set((ft === null ? valueFt : ft) + dir * (e.shiftKey ? 1 : IN));
      };
    };
    return h("div", { class: "studio-field" }, [
      h("label", { for: id, text: label }),
      h("div", { class: "studio-stepper" }, [
        h("button", {
          type: "button",
          "data-key": key + "-less",
          "aria-label": T("studio.inchLess", { what: label }),
          text: "−",
          onclick: step(-1),
        }),
        input,
        h("button", {
          type: "button",
          "data-key": key + "-more",
          "aria-label": T("studio.inchMore", { what: label }),
          text: "+",
          onclick: step(1),
        }),
      ]),
      h("p", { class: "studio-field-help", id: id + "-help", text: help || T("studio.lengthHelp") }),
      error,
    ]);
  }

  // ---------- Step 1: the room ----------
  var templateCache = {};

  function templateDesign(id) {
    if (!templateCache[id]) templateCache[id] = Plan.fromTemplate(id, sizes);
    return templateCache[id];
  }

  function roomStep(body) {
    body.appendChild(stepHead("room"));

    var grid = h("div", { class: "studio-templates" });
    Plan.TEMPLATES.forEach(function (tpl) {
      var thumb = h("span", { class: "studio-template-thumb", "data-template": tpl.id });
      if (templateCache[tpl.id]) thumb.appendChild(planSvg(templateCache[tpl.id], { mini: true }));
      grid.appendChild(
        h(
          "button",
          {
            type: "button",
            class: "studio-template",
            "data-key": "tpl-" + tpl.id,
            onclick: function () {
              useTemplate(tpl.id);
            },
          },
          [
            thumb,
            h("span", { class: "studio-template-name", text: T("studio.template." + tpl.id) }),
            h("span", { class: "studio-template-size", text: len(tpl.room.w) + " × " + len(tpl.room.l) }),
          ],
        ),
      );
    });
    body.appendChild(section(T("studio.room.start"), [grid]));
    fillTemplateThumbs();

    var room = design.room;
    var setDim = function (key) {
      return function (ft) {
        var lim = Plan.LIMITS;
        var min = key === "h" ? lim.minH : lim.min;
        var max = key === "h" ? lim.maxH : key === "w" ? lim.maxW : lim.maxL;
        if (ft < min - 1e-6 || ft > max + 1e-6) return T("studio.lengthRange", { min: len(min), max: len(max) });
        resizeRoom(key, num(ft, 4));
        return null;
      };
    };
    body.appendChild(
      section(T("studio.room.size"), [
        h("div", { class: "studio-size-grid" }, [
          lengthField("size-w", T("studio.room.width"), room.w, setDim("w"), T("studio.room.widthHelp")),
          lengthField("size-l", T("studio.room.length"), room.l, setDim("l"), T("studio.room.lengthHelp")),
          lengthField("size-h", T("studio.room.height"), room.h, setDim("h"), T("studio.room.heightHelp")),
        ]),
        h("p", {
          class: "studio-note",
          text: T("studio.room.area", { area: Pricing.formatQty(num(room.w * room.l, 1)) }),
        }),
      ]),
    );

    var doors = itemsOf("door");
    var doorKids = doors.map(function (door, i) {
      return h("div", { class: "studio-card" + (door.id === ui.selected ? " is-selected" : "") }, [
        h("div", { class: "studio-card-head" }, [
          h("h4", { text: doors.length > 1 ? T("studio.doorN", { n: i + 1 }) : T("studio.type.door") }),
          h("button", {
            type: "button",
            class: "studio-icon-btn",
            "data-key": "door-remove-" + door.id,
            "aria-label": T("studio.removeWhat", { what: itemName(door) }),
            title: T("studio.remove"),
            icon: "trash",
            onclick: function () {
              removeItem(door.id);
            },
          }),
        ]),
        inspector(door),
      ]);
    });
    if (!doors.length) doorKids.push(h("p", { class: "studio-note", text: T("studio.room.noDoor") }));
    if (doors.length < MAX_DOORS) {
      doorKids.push(
        h(
          "button",
          {
            type: "button",
            class: "btn btn-secondary studio-add-door",
            "data-key": "door-add",
            onclick: function () {
              addFixture("door");
            },
          },
          [h("span", { icon: "plus" }), T(doors.length ? "studio.room.addDoor" : "studio.room.addFirstDoor")],
        ),
      );
    }
    body.appendChild(section(T("studio.room.doors"), doorKids));
  }

  // Template thumbnails are worked out a few at a time (arranging the
  // biggest takes a moment) and drawn in as they're ready.
  var thumbsPending = false;

  function fillTemplateThumbs() {
    if (thumbsPending) return;
    var missing = Plan.TEMPLATES.filter(function (tpl) {
      return !templateCache[tpl.id];
    }).sort(function (a, b) {
      return a.items.length - b.items.length;
    });
    if (!missing.length) return;
    thumbsPending = true;
    setTimeout(function () {
      thumbsPending = false;
      var tpl = missing[0];
      templateDesign(tpl.id);
      var slot = els.panel.querySelector('[data-template="' + tpl.id + '"]');
      if (slot && !slot.firstChild) slot.appendChild(planSvg(templateCache[tpl.id], { mini: true }));
      fillTemplateThumbs();
    }, 30);
  }

  function useTemplate(id) {
    var tpl = copy(templateDesign(id));
    tpl.finishes = copy(design.finishes);
    tpl.products = copy(design.products);
    ui.selected = null;
    commit(tpl, { announce: T("studio.templateUsed", { name: T("studio.template." + id) }) });
    toast(T("studio.templateUsed", { name: T("studio.template." + id) }), { label: T("studio.undo"), run: undo });
  }

  function resizeRoom(key, ft) {
    var room = Object.assign({}, design.room);
    room[key] = ft;
    var before = errorCount(issues);
    var next = Plan.resize(design, room);
    commit(next);
    if (errorCount(issues) > before) {
      toast(T("studio.resizeBroke"), { label: T("studio.rearrange"), run: arrangeNow });
    }
  }

  // ---------- Step 2: the layout ----------
  function layoutStep(body) {
    body.appendChild(stepHead("layout"));
    var full = design.items.length >= Plan.MAX_ITEMS;
    body.appendChild(
      section(T("studio.layout.add"), [
        h(
          "div",
          { class: "studio-add-grid" },
          ADDABLE.map(function (type) {
            return h(
              "button",
              {
                type: "button",
                class: "studio-add",
                "data-key": "add-" + type,
                disabled: full ? true : null,
                onclick: function () {
                  addFixture(type);
                },
              },
              [h("span", { class: "studio-add-icon", icon: type }), h("span", { text: T("studio.type." + type) })],
            );
          }),
        ),
        full ? h("p", { class: "studio-note", text: T("studio.layout.full", { n: Plan.MAX_ITEMS }) }) : null,
      ]),
    );

    var fixtures = design.items.filter(function (it) {
      return it.type !== "door";
    });
    body.appendChild(
      section(T("studio.layout.arrange"), [
        h("p", { class: "studio-note", text: T("studio.layout.arrangeHelp") }),
        h(
          "button",
          {
            type: "button",
            class: "btn btn-secondary studio-arrange-btn",
            "data-key": "arrange",
            disabled: fixtures.length ? null : true,
            onclick: showArrangements,
          },
          [h("span", { icon: "arrange" }), T("studio.layout.arrangeBtn")],
        ),
        ui.arrange ? arrangeChoices() : null,
      ]),
    );

    var trouble = design.items.filter(function (it) {
      return (issues[it.id] || []).length;
    });
    if (trouble.length) {
      body.appendChild(
        section(T("studio.layout.check"), [
          h(
            "ul",
            { class: "studio-issues" },
            trouble.map(function (it) {
              return h("li", { class: "is-" + toneOf(it.id) }, [
                h("span", { class: "studio-issue-icon", icon: toneOf(it.id) === "error" ? "alert" : "info" }),
                h("span", { class: "studio-issue-text" }, [
                  h("strong", { text: itemName(it) + ": " }),
                  issues[it.id]
                    .map(function (x) {
                      return issueText(it, x);
                    })
                    .join(" "),
                ]),
                h("button", {
                  type: "button",
                  class: "studio-link-btn",
                  "data-key": "show-" + it.id,
                  text: T("studio.show"),
                  onclick: function () {
                    select(it.id, { force: true });
                  },
                }),
              ]);
            }),
          ),
        ]),
      );
    }

    var list = h("ul", { class: "studio-items" });
    fixtures.forEach(function (it) {
      var on = it.id === ui.selected;
      var tone = toneOf(it.id);
      var row = h("li", { class: "studio-item" + (on ? " is-selected" : "") }, [
        h(
          "button",
          {
            type: "button",
            class: "studio-item-btn",
            "aria-expanded": on ? "true" : "false",
            "data-key": "item-" + it.id,
            onclick: function () {
              select(on ? null : it.id);
            },
          },
          [
            h("span", { class: "studio-item-icon", icon: it.type }),
            h("span", { class: "studio-item-text" }, [
              h("strong", { text: itemName(it) }),
              h("small", { text: T("studio.itemWhere", { wall: letter(it.wall), at: len(it.offset) }) }),
            ]),
            h("span", {
              class: "studio-item-status is-" + tone,
              icon: tone === "ok" ? "check" : "alert",
              title: T("studio.tone." + tone),
            }),
            h("span", { class: "visually-hidden", text: T("studio.tone." + tone) }),
          ],
        ),
        on ? inspector(it) : null,
      ]);
      list.appendChild(row);
    });
    body.appendChild(
      section(T("studio.layout.inRoom"), [
        fixtures.length ? list : h("p", { class: "studio-note", text: T("studio.layout.empty") }),
      ]),
    );
  }

  // Everything about one fixture (or door): which wall, where along it,
  // its options, the room around it and what's wrong.
  function inspector(item) {
    var wrap = h("div", { class: "studio-inspector" });
    var span = Plan.wallSpan(design.room, item.wall);
    var size = Plan.sizeOf(item, sizes);
    var half = size.span / 2;
    var k = "insp-" + item.id;

    wrap.appendChild(
      h("div", { class: "studio-field" }, [
        h("span", { class: "studio-field-label", text: T("studio.wall") }),
        wallChoice(
          item.wall,
          function (wid) {
            moveToWall(item, wid);
          },
          k + "-wall",
          T("studio.wallFor", { what: itemName(item) }),
        ),
      ]),
    );

    // Position along the wall: a slider and nudges.
    var min = Math.min(half, span / 2);
    var max = Math.max(span - half, span / 2);
    var readout = h("output", { class: "studio-readout", for: "studio-" + k + "-pos" });
    var setReadout = function (offset) {
      readout.textContent =
        item.type === "door"
          ? T("studio.edgeFromLeft", { at: len(Math.max(0, offset - half)) })
          : T("studio.centerFromLeft", { at: len(offset) });
    };
    setReadout(item.offset);
    var slider = h("input", {
      type: "range",
      id: "studio-" + k + "-pos",
      min: num(min, 4),
      max: num(max, 4),
      step: num(IN, 6),
      value: num(item.offset, 4),
      "data-key": k + "-pos",
      "aria-label": T("studio.positionOf", { what: itemName(item) }),
      disabled: max - min < 1e-6 ? true : null,
    });
    slider.addEventListener("input", function () {
      var offset = Number(slider.value);
      setReadout(offset);
      slider.setAttribute("aria-valuetext", readout.textContent);
      var d = moveItem(design, item.id, item.wall, offset);
      commit(d, { merge: "slide:" + item.id, quiet: true });
    });
    slider.addEventListener("change", function () {
      refresh();
    });
    slider.setAttribute("aria-valuetext", readout.textContent);
    wrap.appendChild(
      h("div", { class: "studio-field" }, [
        h("label", { class: "studio-field-label", for: "studio-" + k + "-pos", text: T("studio.position") }),
        h("div", { class: "studio-slide" }, [
          h("button", {
            type: "button",
            class: "studio-icon-btn",
            "data-key": k + "-left",
            "aria-label": T("studio.nudgeLeft"),
            icon: "left",
            onclick: function (e) {
              nudge(findItem(item.id), -(e.shiftKey ? 6 : 1) * IN);
            },
          }),
          slider,
          h("button", {
            type: "button",
            class: "studio-icon-btn",
            "data-key": k + "-right",
            "aria-label": T("studio.nudgeRight"),
            icon: "right",
            onclick: function (e) {
              nudge(findItem(item.id), (e.shiftKey ? 6 : 1) * IN);
            },
          }),
        ]),
        readout,
      ]),
    );

    // Its own options.
    var o = item.opts || {};
    var setOpt = function (name) {
      return function (value) {
        var opts = Object.assign({}, item.opts);
        opts[name] = value;
        commit(withItem(design, item.id, { opts: opts }));
      };
    };
    if (item.type === "vanity" || item.type === "sink") {
      wrap.appendChild(
        h("div", { class: "studio-field" }, [
          h("span", { class: "studio-field-label", text: T("studio.opt.mirror") }),
          choiceGroup(
            T("studio.opt.mirror"),
            ["standard", "large", "none"].map(function (v) {
              return { value: v, label: T("studio.opt.mirror." + v) };
            }),
            o.mirror,
            setOpt("mirror"),
            k + "-mirror",
          ),
        ]),
      );
    }
    if (item.type === "shower") {
      wrap.appendChild(toggle(T("studio.opt.glassDoor"), o.glassDoor, setOpt("glassDoor"), k + "-glass"));
      wrap.appendChild(toggle(T("studio.opt.shelf"), o.shelf, setOpt("shelf"), k + "-shelf"));
    }
    if (item.type === "door") {
      wrap.appendChild(
        h("div", { class: "studio-field" }, [
          h("span", { class: "studio-field-label", text: T("studio.opt.door") }),
          choiceGroup(
            T("studio.opt.door"),
            ["existing", "new", "opening"].map(function (v) {
              return { value: v, label: T("studio.opt.door." + v) };
            }),
            o.kind,
            setOpt("kind"),
            k + "-kind",
          ),
        ]),
      );
    }

    // The room around it.
    var m = Plan.measure(design, item.id, sizes);
    if (m && item.type !== "door") {
      wrap.appendChild(
        h("dl", { class: "studio-gaps" }, [
          h("dt", { text: T("studio.gap.left") }),
          h("dd", { text: T("studio.gapTo", { gap: len(m.left.dist), what: theName(m.left.what) }) }),
          h("dt", { text: T("studio.gap.right") }),
          h("dd", { text: T("studio.gapTo", { gap: len(m.right.dist), what: theName(m.right.what) }) }),
          h("dt", { text: T("studio.gap.front") }),
          h("dd", { text: T("studio.gapTo", { gap: len(m.front.dist), what: theName(m.front.what) }) }),
        ]),
      );
      wrap.appendChild(
        h("p", {
          class: "studio-note",
          text: T("studio.size", { w: Plan.formatInches(size.span), d: Plan.formatInches(size.depth) }),
        }),
      );
    }

    var mine = issues[item.id] || [];
    if (mine.length) {
      wrap.appendChild(
        h(
          "ul",
          { class: "studio-issues is-compact" },
          mine.map(function (x) {
            return h("li", { class: "is-" + x.level }, [
              h("span", { class: "studio-issue-icon", icon: x.level === "error" ? "alert" : "info" }),
              h("span", { class: "studio-issue-text", text: issueText(item, x) }),
            ]);
          }),
        ),
      );
    }

    var actions = h("div", { class: "studio-inspector-actions" }, [
      item.type !== "door"
        ? h(
            "button",
            {
              type: "button",
              class: "btn btn-secondary btn-sm",
              "data-key": k + "-best",
              onclick: function () {
                bestSpot(item);
              },
            },
            [h("span", { icon: "target" }), T("studio.bestSpot")],
          )
        : null,
      item.type !== "door"
        ? h(
            "button",
            {
              type: "button",
              class: "btn btn-secondary btn-sm",
              "data-key": k + "-dup",
              disabled: design.items.length >= Plan.MAX_ITEMS ? true : null,
              onclick: function () {
                addFixture(item.type, item.opts);
              },
            },
            [h("span", { icon: "duplicate" }), T("studio.duplicate")],
          )
        : null,
      item.type !== "door"
        ? h(
            "button",
            {
              type: "button",
              class: "btn btn-secondary btn-sm is-danger",
              "data-key": k + "-remove",
              onclick: function () {
                removeItem(item.id);
              },
            },
            [h("span", { icon: "trash" }), T("studio.remove")],
          )
        : null,
    ]);
    if (actions.children.length) wrap.appendChild(actions);
    return wrap;
  }

  function addFixture(type, opts) {
    var res = Plan.addItem(design, type, sizes, opts ? copy(opts) : undefined);
    ui.selected = res.item.id;
    if (type !== "door" && ui.step !== "layout" && ui.step !== "room") ui.step = "layout";
    commit(res.design, { announce: itemLabel(res.item, res.design) });
    if (res.placed) {
      toast(T("studio.added", { name: itemName(res.item, res.design), wall: letter(res.item.wall) }), {
        label: T("studio.undo"),
        run: undo,
      });
    } else {
      toast(T("studio.addedNoRoom", { name: itemName(res.item, res.design) }), {
        label: T("studio.rearrange"),
        run: arrangeNow,
      });
    }
  }

  function removeItem(id) {
    var item = findItem(id);
    if (!item) return;
    var name = itemName(item);
    ui.selected = null;
    commit(withoutItem(design, id), { announce: T("studio.removed", { name: name }) });
    toast(T("studio.removed", { name: name }), { label: T("studio.undo"), run: undo });
  }

  // Onto another wall: its best spot there, or for a door the spot nearest
  // the middle; if it fits nowhere on that wall, the middle (shown red).
  function moveToWall(item, wallId) {
    var probe = Object.assign({}, item, { wall: wallId });
    var spots = Plan.findSpots(design, probe, sizes, { walls: [wallId], step: 2 * IN });
    var span = Plan.wallSpan(design.room, wallId);
    var offset;
    if (spots.length) {
      offset =
        item.type === "door"
          ? spots.reduce(function (p, q) {
              return Math.abs(q.offset - span / 2) < Math.abs(p.offset - span / 2) ? q : p;
            }).offset
          : spots[0].offset;
    } else {
      offset = span / 2;
    }
    var d = moveItem(design, item.id, wallId, offset);
    commit(d, { announce: itemLabel(findItem(item.id, d), d) });
    if (!spots.length) toast(T("studio.noRoomOnWall", { name: itemName(item), wall: letter(wallId) }));
  }

  function bestSpot(item) {
    var spots = Plan.findSpots(design, item, sizes, { step: IN });
    if (!spots.length) {
      toast(T("studio.noSpot", { name: itemName(item) }), { label: T("studio.rearrange"), run: arrangeNow });
      return;
    }
    var d = moveItem(design, item.id, spots[0].wall, spots[0].offset);
    commit(d, { announce: itemLabel(findItem(item.id, d), d) });
  }

  // "Arrange it for me": a few different layouts that fit, to pick from.
  function showArrangements() {
    ui.arrange = { loading: true, options: [] };
    renderPanel();
    setTimeout(function () {
      var options = Plan.arrange(design, sizes, { count: 3 });
      ui.arrange = { options: options };
      renderPanel();
      var first = els.panel.querySelector('[data-key="arr-0"]');
      if (first) {
        first.focus({ preventScroll: true });
        first.parentNode.scrollIntoView({ block: "nearest" });
      }
    }, 20);
  }

  function arrangeNow() {
    var best = Plan.arrange(design, sizes, { count: 1 })[0];
    if (!best) return;
    commit(Object.assign({}, design, { items: best.items }), { announce: T("studio.arranged") });
    toast(T("studio.arranged"), { label: T("studio.undo"), run: undo });
  }

  // Within an inch of each other everywhere: the same layout to the eye.
  function sameLayout(a, b) {
    return (
      a.length === b.length &&
      a.every(function (it, i) {
        var other = b[i];
        return other && other.id === it.id && other.wall === it.wall && Math.abs(other.offset - it.offset) < IN;
      })
    );
  }

  function arrangeChoices() {
    if (ui.arrange.loading) return h("p", { class: "studio-note", role: "status", text: T("studio.layout.arranging") });
    var options = ui.arrange.options;
    if (!options.length) return h("p", { class: "studio-note", text: T("studio.layout.noArrangement") });
    var complete = options[0].placed === options[0].total;
    var onlyMine = options.length === 1 && sameLayout(options[0].items, design.items);
    var note = !complete ? "studio.layout.closest" : onlyMine ? "studio.layout.onlyOne" : null;
    var grid = h(
      "div",
      { class: "studio-arrangements" },
      options.map(function (opt, i) {
        var d = Object.assign({}, design, { items: opt.items });
        var list = Plan.validate(d, sizes);
        var current = sameLayout(opt.items, design.items);
        var bad = opt.items.filter(function (it) {
          return it.type !== "door" && Plan.errorsOf(list, it.id).length;
        }).length;
        return h(
          "button",
          {
            type: "button",
            class: "studio-arrangement" + (current ? " is-current" : ""),
            "data-key": "arr-" + i,
            onclick: function () {
              ui.arrange = null;
              commit(d, { announce: T("studio.arranged") });
              toast(T("studio.arranged"), { label: T("studio.undo"), run: undo });
            },
          },
          [
            planSvg(d, { mini: true, list: list }),
            h("span", {
              class: "studio-arrangement-fit" + (bad ? " is-error" : ""),
              text: bad
                ? T("studio.layout.someFit", { n: opt.total - bad, total: opt.total })
                : T("studio.layout.allFit"),
            }),
            h("span", {
              class: "studio-arrangement-use",
              text: current ? T("studio.layout.current") : T("studio.layout.use"),
            }),
          ],
        );
      }),
    );
    return note ? h("div", {}, [h("p", { class: "studio-note", text: T(note) }), grid]) : grid;
  }

  // ---------- Step 3: products ----------
  var GROUP_ICONS = {
    toilet: "toilet",
    tub: "tub",
    vanity: "vanity",
    sink: "sink",
    shower: "shower",
    mirror: "frame",
    door: "door",
  };

  function productsStep(body) {
    body.appendChild(stepHead("products"));
    var groups = room3d ? room3d.getProductGroups() : [];
    if (!groups.length) {
      body.appendChild(section(null, [h("p", { class: "studio-note", text: T("studio.products.empty") })]));
      return;
    }
    var items = room3d.getProductPricingItems();
    groups.forEach(function (group) {
      var standIn = items.some(function (it) {
        return it.groupId === group.id && !it.mmns.length;
      });
      var card = h("div", { class: "studio-card studio-product-card", "data-group": group.id }, [
        h("div", { class: "studio-card-head" }, [
          h("h3", {}, [h("span", { class: "studio-card-icon", icon: GROUP_ICONS[group.id] || "cube" }), group.label]),
          has3d
            ? h(
                "button",
                {
                  type: "button",
                  class: "studio-link-btn",
                  "data-key": "focus-" + group.id,
                  onclick: function () {
                    focusGroup(group.id);
                  },
                },
                [T("studio.products.show")],
              )
            : null,
        ]),
      ]);
      group.slots.forEach(function (slot) {
        var id = "studio-product-" + slot.id;
        var select = h(
          "select",
          { id: id, class: "studio-select", "data-key": "slot-" + slot.id },
          slot.options.map(function (opt) {
            return h("option", {
              value: opt.id,
              disabled: opt.reason ? true : null,
              selected: opt.id === slot.value ? true : null,
              text: opt.label + (opt.reason ? " (" + opt.reason + ")" : ""),
            });
          }),
        );
        select.value = slot.value;
        select.addEventListener("change", function () {
          room3d.setProductPick(slot.id, select.value);
          commit(Object.assign({}, design, { products: room3d.getProductPicks() }));
          focusGroup(group.id);
        });
        select.addEventListener("focus", function () {
          focusGroup(group.id);
        });
        card.appendChild(h("div", { class: "studio-field" }, [h("label", { for: id, text: slot.label }), select]));
      });
      if (standIn) {
        card.appendChild(
          h(
            "button",
            {
              type: "button",
              class: "btn btn-secondary btn-sm",
              "data-key": "real-" + group.id,
              onclick: function () {
                if (room3d.useRealProducts(group.id)) {
                  commit(Object.assign({}, design, { products: room3d.getProductPicks() }));
                  focusGroup(group.id);
                }
              },
            },
            [T("studio.products.useKohler")],
          ),
        );
      }
      body.appendChild(card);
    });
    body.appendChild(
      h("p", {
        class: "studio-note",
        text: T(productPricingOn() ? "studio.products.priceLive" : "studio.products.priceNote"),
      }),
    );
  }

  var focusedGroup = null;

  function focusGroup(groupId) {
    if (!has3d || ui.view === "plan" || focusedGroup === groupId) return;
    focusedGroup = groupId;
    room3d.focusProductGroup(groupId);
  }

  // ---------- Step 4: finishes ----------
  function surfaceOptions(cat) {
    return Materials ? Materials.getOptionsForCategory(cat, "") : [];
  }

  // The product shown and priced for a surface: the one picked, or the
  // first on the list.
  function surfaceProduct(cat, d) {
    var options = surfaceOptions(cat);
    var picked = (d || design).finishes.picks[cat];
    return (
      options.filter(function (o) {
        return o.id === picked;
      })[0] ||
      options[0] ||
      null
    );
  }

  // What the walls really are: "tile around the tub" with no tub is paint.
  function wallsOf(d) {
    var w = d.finishes.walls;
    return w === "tileWet" && !itemsOf("tub", d).length ? "paint" : w;
  }

  function finishesStep(body) {
    body.appendChild(stepHead("finishes"));
    var f = design.finishes;
    var set = function (change) {
      commit(withFinishes(change));
    };

    body.appendChild(
      section(T("studio.finish.demo"), [
        toggle(
          T("studio.finish.demoLabel"),
          f.demolition,
          function (on) {
            set({ demolition: on });
          },
          "fin-demo",
          T("studio.finish.demoHelp"),
        ),
      ]),
    );

    body.appendChild(
      section(T("studio.finish.floor"), [
        choiceGroup(
          T("studio.finish.floor"),
          [
            { value: "tile", label: T("studio.finish.floor.tile") },
            { value: "flooring", label: T("studio.finish.floor.flooring") },
            { value: "none", label: T("studio.finish.floor.none") },
          ],
          f.floor,
          function (v) {
            set({ floor: v });
          },
          "fin-floor",
        ),
        f.floor === "tile" ? swatches("floorTile") : null,
        f.floor === "flooring" ? swatches("flooring") : null,
      ]),
    );

    var walls = wallsOf(design);
    var hasTub = itemsOf("tub").length > 0;
    body.appendChild(
      section(T("studio.finish.walls"), [
        choiceGroup(
          T("studio.finish.walls"),
          [
            { value: "paint", label: T("studio.finish.walls.paint") },
            hasTub ? { value: "tileWet", label: T("studio.finish.walls.tileWet") } : null,
            { value: "tile", label: T("studio.finish.walls.tile") },
            { value: "none", label: T("studio.finish.walls.none") },
          ].filter(Boolean),
          walls,
          function (v) {
            set({ walls: v });
          },
          "fin-walls",
        ),
        walls === "tileWet" || walls === "tile" ? swatches("wallTile", T("studio.finish.wallTile")) : null,
        walls === "tileWet" || walls === "paint" ? swatches("wallPaint", T("studio.finish.wallPaint")) : null,
      ]),
    );

    body.appendChild(
      section(T("studio.finish.ceiling"), [
        toggle(
          T("studio.finish.ceilingLabel"),
          f.ceiling,
          function (on) {
            set({ ceiling: on });
          },
          "fin-ceiling",
        ),
        f.ceiling ? swatches("ceilingPaint") : null,
      ]),
    );
    if (!materialsOn()) body.appendChild(h("p", { class: "studio-note", text: T("studio.finish.notPriced") }));
  }

  // The products for a surface, as picture buttons with their price.
  function swatches(cat, title) {
    var current = surfaceProduct(cat);
    var options = surfaceOptions(cat);
    if (!options.length) return null;
    var priced = materialsOn();
    return h("div", { class: "studio-swatch-group" }, [
      title ? h("p", { class: "studio-swatch-title", text: title }) : null,
      h(
        "div",
        { class: "studio-swatches", role: "group", "aria-label": title || T("studio.finish.product") },
        options.map(function (opt) {
          var on = current && current.id === opt.id;
          return h(
            "button",
            {
              type: "button",
              class: "studio-swatch",
              "aria-pressed": on ? "true" : "false",
              "data-key": "sw-" + cat + "-" + opt.id,
              title: opt.name,
              onclick: function () {
                if (on) return;
                var picks = Object.assign({}, design.finishes.picks);
                picks[cat] = opt.id;
                commit(withFinishes({ picks: picks }));
              },
            },
            [
              opt.imageUrl
                ? h("img", { src: opt.imageUrl, alt: "", loading: "lazy", width: "64", height: "64" })
                : null,
              h("span", { class: "studio-swatch-name", text: shortName(opt.name) }),
              priced ? h("span", { class: "studio-swatch-price", text: unitPrice(cat, opt) }) : null,
            ],
          );
        }),
      ),
    ]);
  }

  // Retail names are long: the brand-and-model part is enough on a button.
  function shortName(name) {
    var cut = name.split(/\s+(?:\d|\(|in\.)/)[0];
    return (cut.length > 8 ? cut : name).replace(/\s*\(per [^)]*\)\s*$/i, "").slice(0, 60);
  }

  function unitPrice(cat, opt) {
    var per = cat === "wallPaint" || cat === "ceilingPaint" ? "studio.perGallon" : "studio.perSqFt";
    return T(per, { price: Pricing.money(opt.best.price) });
  }

  // ---------- The estimate ----------
  function estimatorOn() {
    return !!(config && config.priceEstimator && config.priceEstimator.enabled);
  }

  function materialsOn() {
    return !!(config && config.materialsEstimator && config.materialsEstimator.enabled);
  }

  function productPricingOn() {
    return !!(config && config.productPricing && config.productPricing.endpoint);
  }

  // What the pricing module needs from the design.
  function estimateInputs(d) {
    var areas = Plan.wallAreas(d, sizes);
    var values = Object.assign(
      {
        Bathroom_Width_Ft: num(d.room.w, 3),
        Bathroom_Length_Ft: num(d.room.l, 3),
        Bathroom_Height_Ft: num(d.room.h, 3),
        Wall_Openings_SqFt: areas.openingsSqFt,
        Wet_Wall_SqFt: areas.wetSqFt,
      },
      Plan.counts(d),
    );
    var f = d.finishes;
    var scope = { demolition: f.demolition, floorFinish: f.floor, walls: wallsOf(d), paintCeiling: f.ceiling };
    return { values: values, scope: scope };
  }

  // Labor, the surface materials and the Kohler products for the design:
  // { labor, materials: [{ cat, label, product, quantityLabel, cost }],
  //   products: [{ label, mmns, qty, url, cost (or null) }], ... totals }.
  function estimate(d) {
    d = d || design;
    var inputs = estimateInputs(d);
    var labor = Pricing.computePublicEstimate(inputs.values, inputs.scope);
    var materials = [];
    if (materialsOn()) {
      labor.lines.forEach(function (line) {
        if (SURFACE_CATS.indexOf(line.key) === -1) return;
        var product = surfaceProduct(line.key, d);
        if (!product) return;
        var paint = line.key === "wallPaint" || line.key === "ceilingPaint";
        var qty = num(line.qty * (paint ? PAINT_COATS : TILE_WASTE), 2);
        var cost = Materials.computeMaterialCost(line.key, qty, T("unit.sqft"), product.best.price);
        materials.push({
          cat: line.key,
          label: T("studio.material." + line.key),
          product: product,
          quantityLabel: cost.quantityLabel,
          cost: cost.cost,
        });
      });
    }
    var products = [];
    var live = ui.livePrices;
    var items = room3d && d === design ? room3d.getProductPricingItems() : [];
    items.forEach(function (item) {
      if (!item.mmns.length) return;
      var cost = null;
      if (live && live.results) {
        var each = 0;
        var all = item.mmns.every(function (m) {
          var r = live.results[m];
          if (!r || typeof r.price !== "number") return false;
          each += r.price;
          return true;
        });
        if (all) cost = Pricing.roundCents(each * item.qty);
      }
      products.push({
        groupId: item.groupId,
        slotId: item.slotId,
        label: item.slotLabel + ": " + item.productLabel,
        mmns: item.mmns,
        qty: item.qty,
        url: "https://www.homedepot.com/s/" + encodeURIComponent(item.mmns[0]),
        cost: cost,
        needsValve: item.needsValve,
        needsWiring: item.needsWiring,
      });
    });
    var materialsTotal = Pricing.roundCents(
      materials.reduce(function (sum, m) {
        return sum + m.cost;
      }, 0) +
        products.reduce(function (sum, p) {
          return sum + (p.cost || 0);
        }, 0),
    );
    var notes = [];
    var unpriced = products.filter(function (p) {
      return p.cost === null;
    });
    if (products.length && unpriced.length === products.length) notes.push(T("studio.est.productsNotPriced"));
    else if (unpriced.length) {
      notes.push(
        T("products.unpriced", {
          items: unpriced
            .map(function (p) {
              return p.label;
            })
            .join("; "),
        }),
      );
    }
    if (
      products.some(function (p) {
        return p.groupId === "vanity";
      })
    )
      notes.push(T("products.vanityCabinet"));
    if (
      products.some(function (p) {
        return p.needsValve;
      })
    )
      notes.push(T("products.valveNotIncluded"));
    var wired = products.filter(function (p) {
      return p.needsWiring;
    });
    if (wired.length) {
      notes.push(
        T("products.wiringNotIncluded", {
          items: wired
            .map(function (p) {
              return p.label;
            })
            .join(", "),
        }),
      );
    }
    var hasMaterials =
      materials.length > 0 ||
      products.some(function (p) {
        return p.cost !== null;
      });
    return {
      inputs: inputs,
      labor: labor,
      materials: materials,
      products: products,
      materialsTotal: materialsTotal,
      grandTotal: Pricing.roundCents(labor.subtotal + materialsTotal),
      hasMaterials: hasMaterials,
      notes: notes,
      signature: JSON.stringify(items),
    };
  }

  function totalLabel(est) {
    var key = est.hasMaterials ? "card.totalMaterials" : "card.total";
    return T(est.labor.plumbingFixtureCount > 0 ? key + "BeforePlumbing" : key);
  }

  function excludedLines(est) {
    var n = est.labor.plumbingFixtureCount;
    var list = [];
    if (n > 0)
      list.push({
        label: T("card.excluded.listedPlumbing", { n: Pricing.formatQty(n) }),
        value: T("card.excluded.extra"),
      });
    list.push({
      label: T(n > 0 ? "card.excluded.otherTrades" : "card.excluded.trades"),
      value: T("card.excluded.extra"),
    });
    list.push({
      label: T(est.hasMaterials ? "card.excluded.permits" : "card.excluded.materialsPermits"),
      value: T("card.excluded.notIncluded"),
    });
    return list;
  }

  function assumptions(est) {
    var list = Pricing.estimateAssumptions(est.inputs.values, est.inputs.scope, est.labor);
    if (est.materials.length)
      list.push(T("studio.est.materialQty", { waste: Math.round((TILE_WASTE - 1) * 100), coats: PAINT_COATS }));
    list.push(T("card.plumbingNote"));
    list.push(T(est.hasMaterials ? "card.materialsNote" : "card.alsoNotIncluded"));
    return list;
  }

  // The design in words, for the request form and the PDF.
  function designLines(d, est) {
    var out = [];
    out.push(T("studio.sum.room", { w: len(d.room.w), l: len(d.room.l), h: len(d.room.h) }));
    var doors = itemsOf("door", d).map(function (door) {
      return T("studio.sum.door", {
        wall: letter(door.wall),
        kind: T("studio.opt.door." + door.opts.kind).toLowerCase(),
      });
    });
    if (doors.length) out.push(doors.join("; "));
    d.items.forEach(function (it) {
      if (it.type === "door") return;
      out.push(
        T("studio.sum.item", { name: itemName(it, d), wall: letter(it.wall), at: len(it.offset) }) + itemExtras(it),
      );
    });
    out.push(T("studio.sum.work", { scope: Pricing.describeScope(est.inputs.scope) }));
    est.materials.forEach(function (m) {
      out.push(m.label + ": " + m.product.name);
    });
    est.products.forEach(function (p) {
      out.push(p.label + " (" + p.mmns.join(" + ") + ")" + (p.qty > 1 ? " × " + p.qty : ""));
    });
    return out;
  }

  function itemExtras(it) {
    var o = it.opts || {};
    var parts = [];
    if ((it.type === "vanity" || it.type === "sink") && o.mirror !== "none")
      parts.push(T("studio.opt.mirror." + o.mirror).toLowerCase());
    if (it.type === "shower" && o.glassDoor) parts.push(T("studio.opt.glassDoor").toLowerCase());
    if (it.type === "shower" && o.shelf) parts.push(T("studio.opt.shelf").toLowerCase());
    return parts.length ? " (" + parts.join(", ") + ")" : "";
  }

  // What goes in the request form's "Project details".
  function requestSummary(est) {
    var out = [T("studio.sum.title")];
    designLines(design, est).forEach(function (line) {
      out.push("- " + line);
    });
    if (estimatorOn()) {
      out.push("");
      out.push(T("studio.sum.labor", { total: Pricing.money(est.labor.subtotal) }));
      if (est.hasMaterials) out.push(T("studio.sum.materials", { total: Pricing.money(est.materialsTotal) }));
      out.push(totalLabel(est) + ": " + Pricing.money(est.grandTotal));
    }
    var problems = errorCount(issues);
    if (problems) out.push(T("studio.sum.problems", { n: problems }));
    out.push("");
    out.push(T("studio.sum.link"));
    out.push(shareUrl());
    return out.join("\n");
  }

  // ---------- Step 5: the estimate and the request ----------
  function estimateStep(body) {
    var priced = estimatorOn();
    body.appendChild(stepHead(priced ? "estimate" : "send"));
    var est = estimate();
    var problems = errorCount(issues);
    if (problems) {
      body.appendChild(
        h("div", { class: "studio-banner is-error", role: "note" }, [
          h("span", { icon: "alert" }),
          h("p", { text: T(problems === 1 ? "studio.est.problem" : "studio.est.problems", { n: problems }) }),
          h("button", {
            type: "button",
            class: "btn btn-secondary btn-sm",
            "data-key": "fix",
            text: T("studio.est.fix"),
            onclick: function () {
              var it = firstTrouble();
              ui.step = it && it.type === "door" ? "room" : "layout";
              select(it ? it.id : null, { force: true });
              renderBar();
            },
          }),
        ]),
      );
    }
    body.appendChild(priced ? estimateCard(est) : designCard(est));

    var pdfStatus = h("p", { class: "studio-pdf-status", role: "status", hidden: true });
    var pdfBtn = h(
      "button",
      {
        type: "button",
        class: "btn btn-secondary",
        "data-key": "pdf",
        onclick: function () {
          exportPdf(pdfBtn, pdfStatus);
        },
      },
      [h("span", { icon: "download" }), T("studio.est.pdf")],
    );
    body.appendChild(
      h("div", { class: "studio-est-actions" }, [
        pdfBtn,
        h("button", { type: "button", class: "btn btn-secondary", "data-key": "share", onclick: copyLink }, [
          h("span", { icon: "link" }),
          T("studio.copyLink"),
        ]),
      ]),
    );
    body.appendChild(pdfStatus);

    // The request form, filled in with the design.
    var message = document.getElementById("message");
    if (message && !ui.messageEdited) message.value = requestSummary(est);
    var service = document.getElementById("service");
    if (service && !ui.serviceEdited) service.value = design.finishes.demolition ? "full-bathroom" : "partial-bathroom";
    body.appendChild(
      section(
        T("studio.est.send", { business: BIZ.name }),
        [h("p", { class: "studio-note", text: T("studio.est.sendHelp") }), els.request],
        "studio-request-section",
      ),
    );
    els.request.hidden = false;
  }

  function lineEl(label, detail, amount, cls, image) {
    return h("div", { class: "studio-line" + (cls ? " " + cls : "") }, [
      image
        ? h("img", { class: "studio-line-thumb", src: image, alt: "", loading: "lazy", width: "36", height: "36" })
        : null,
      h("span", { class: "studio-line-label" }, [label, detail ? h("small", { text: detail }) : null]),
      h("span", { class: "studio-line-amount", text: amount }),
    ]);
  }

  function estimateCard(est) {
    var card = h("article", { class: "studio-estimate", "data-testid": "estimate-card" });
    card.appendChild(
      h("header", { class: "studio-estimate-head" }, [
        h("p", { class: "eyebrow", text: BIZ.name }),
        h("h3", { text: T("card.title") }),
        h("p", { class: "studio-note", text: T(est.hasMaterials ? "card.ledeMaterials" : "card.lede") }),
      ]),
    );
    var labor = h("div", { class: "studio-lines" }, [
      h("p", { class: "studio-lines-title", text: T("studio.est.labor") }),
    ]);
    est.labor.lines.forEach(function (l) {
      labor.appendChild(lineEl(l.label, l.detail, Pricing.money(l.cost)));
    });
    if (!est.labor.lines.length) labor.appendChild(lineEl(T("card.noWork"), null, Pricing.money(0)));
    card.appendChild(labor);
    if (est.hasMaterials) {
      card.appendChild(lineEl(T("card.laborSubtotal"), null, Pricing.money(est.labor.subtotal), "is-subtotal"));
      var mats = h("div", { class: "studio-lines" }, [
        h("p", { class: "studio-lines-title", text: T("studio.est.materials") }),
      ]);
      est.materials.forEach(function (m) {
        mats.appendChild(
          lineEl(
            m.label + ": " + shortName(m.product.name),
            m.quantityLabel + " · " + m.product.best.name,
            Pricing.money(m.cost),
            null,
            m.product.imageUrl,
          ),
        );
      });
      est.products.forEach(function (p) {
        if (p.cost === null) return;
        mats.appendChild(lineEl(p.label, p.mmns.join(" + ") + (p.qty > 1 ? " × " + p.qty : ""), Pricing.money(p.cost)));
      });
      card.appendChild(mats);
      card.appendChild(lineEl(T("card.materialsSubtotal"), null, Pricing.money(est.materialsTotal), "is-subtotal"));
    }
    var excluded = h("div", { class: "studio-lines is-excluded" });
    excludedLines(est).forEach(function (x) {
      excluded.appendChild(lineEl(x.label, null, x.value, "is-muted"));
    });
    card.appendChild(excluded);
    card.appendChild(
      h("div", { class: "studio-total" }, [
        h("span", { text: totalLabel(est) }),
        h("strong", { "data-testid": "estimate-total", text: Pricing.money(est.grandTotal) }),
      ]),
    );
    if (est.labor.plumbingFixtureCount > 0) {
      card.appendChild(
        h("p", {
          class: "studio-note",
          text: T("card.plumbingTotalNote", { n: Pricing.formatQty(est.labor.plumbingFixtureCount) }),
        }),
      );
    }
    est.notes.forEach(function (n) {
      card.appendChild(h("p", { class: "studio-note", text: n }));
    });
    var products = productsList(est);
    if (products) card.appendChild(products);
    card.appendChild(
      h("details", { class: "studio-details" }, [
        h("summary", { text: T("card.assumptions") }),
        h(
          "ul",
          {},
          assumptions(est).map(function (a) {
            return h("li", { text: a });
          }),
        ),
      ]),
    );
    card.appendChild(
      h("p", {
        class: "studio-disclaimer",
        text: T(est.hasMaterials ? "card.disclaimerMaterials" : "card.disclaimer"),
      }),
    );
    return card;
  }

  // The Kohler products in the room, with their model numbers and where to
  // look them up, and (with a pricing service) live prices by ZIP code.
  function productsList(est) {
    var unpriced = est.products.filter(function (p) {
      return p.cost === null;
    });
    if (!unpriced.length && !productPricingOn()) return null;
    var wrap = h("div", { class: "studio-products" }, [
      h("p", { class: "studio-lines-title", text: T("studio.est.products") }),
    ]);
    var list = h("ul");
    unpriced.forEach(function (p) {
      list.appendChild(
        h("li", {}, [
          h("span", { text: p.label + (p.qty > 1 ? " × " + p.qty : "") + " " }),
          h("small", { text: p.mmns.join(" + ") }),
          " ",
          h("a", { href: p.url, target: "_blank", rel: "noopener noreferrer", class: "studio-ext-link" }, [
            T("studio.est.findAt"),
            h("span", { icon: "external" }),
            h("span", { class: "visually-hidden", text: T("studio.newTab") }),
          ]),
        ]),
      );
    });
    if (unpriced.length) wrap.appendChild(list);
    if (productPricingOn() && est.products.length) wrap.appendChild(livePriceForm(est));
    return wrap;
  }

  function livePriceForm(est) {
    var live = ui.livePrices;
    var stale = live && live.signature !== est.signature;
    var zip = h("input", {
      type: "text",
      id: "studio-zip",
      inputmode: "numeric",
      autocomplete: "postal-code",
      maxlength: "10",
      "data-key": "zip",
      value: live ? live.zip : "",
    });
    var status = h("p", { class: "studio-note", role: "status" });
    if (live && live.loading) status.textContent = T("products.checking", { zip: live.zip });
    else if (stale) status.textContent = T("products.roomChanged");
    else if (live && live.failed) status.textContent = T("studio.est.priceFailed");
    else if (live && live.store) status.textContent = T("products.retailer", { store: live.store });
    var form = h(
      "form",
      {
        class: "studio-zip-form",
        novalidate: true,
        onsubmit: function (e) {
          e.preventDefault();
          var digits = zip.value.replace(/\D/g, "").slice(0, 5);
          if (digits.length !== 5) {
            status.textContent = T("materials.zipError");
            zip.setAttribute("aria-invalid", "true");
            zip.focus();
            return;
          }
          fetchLivePrices(digits);
        },
      },
      [
        h("label", { for: "studio-zip", text: T("studio.est.zip") }),
        zip,
        h("button", {
          type: "submit",
          class: "btn btn-secondary btn-sm",
          "data-key": "zip-go",
          disabled: live && live.loading ? true : null,
          text: T(stale ? "products.reprice" : "studio.est.getPrices"),
        }),
      ],
    );
    return h("div", { class: "studio-live" }, [form, status]);
  }

  // Asks the pricing service (site-config.json productPricing.endpoint, see
  // tools/pricing-service/) for each model's price at the Home Depot store
  // nearest the ZIP code.
  function fetchLivePrices(zip) {
    var items = room3d.getProductPricingItems();
    var mmns = [];
    items.forEach(function (item) {
      item.mmns.forEach(function (m) {
        if (mmns.indexOf(m) === -1) mmns.push(m);
      });
    });
    var signature = JSON.stringify(items);
    ui.livePrices = { zip: zip, loading: true, signature: signature };
    renderPanel();
    var controller = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (controller) controller.abort();
    }, 150000);
    fetch(config.productPricing.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ zip: zip, mmns: mmns }),
      signal: controller ? controller.signal : undefined,
    })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .catch(function () {
        return null;
      })
      .then(function (data) {
        clearTimeout(timer);
        ui.livePrices =
          data && data.results
            ? { zip: zip, results: data.results, store: data.store || "", signature: signature }
            : { zip: zip, failed: true, signature: signature };
        renderPanel();
        renderBar();
      });
  }

  // Without the price estimator: the design itself, to send.
  function designCard(est) {
    return h("article", { class: "studio-estimate" }, [
      h("header", { class: "studio-estimate-head" }, [
        h("p", { class: "eyebrow", text: BIZ.name }),
        h("h3", { text: T("studio.est.yourDesign") }),
      ]),
      h(
        "ul",
        { class: "studio-design-lines" },
        designLines(design, est).map(function (line) {
          return h("li", { text: line });
        }),
      ),
    ]);
  }

  // ---------- The PDF ----------
  // The floor plan as shapes in room feet, for js/estimate-pdf.js to draw.
  function pdfPlan(d) {
    var room = d.room;
    var shapes = { w: room.w, l: room.l, rects: [], arcs: [], texts: [], lines: [] };
    Plan.WALL_IDS.forEach(function (wid) {
      var wall = wallOf(wid, d);
      var gaps = itemsOf("door", d)
        .filter(function (it) {
          return it.wall === wid;
        })
        .map(function (it) {
          var half = Plan.sizeOf(it, sizes).span / 2;
          return [it.offset - half, it.offset + half];
        })
        .sort(function (p, q) {
          return p[0] - q[0];
        });
      var cursor = -WALL_T;
      var seg = function (a0, a1) {
        var p0 = wallPoint(wall, a0, -WALL_T);
        var p1 = wallPoint(wall, a1, 0);
        shapes.rects.push({
          x0: Math.min(p0.x, p1.x),
          x1: Math.max(p0.x, p1.x),
          z0: Math.min(p0.z, p1.z),
          z1: Math.max(p0.z, p1.z),
          fill: [30, 41, 70],
        });
      };
      gaps.forEach(function (g) {
        if (g[0] > cursor) seg(cursor, g[0]);
        cursor = Math.max(cursor, g[1]);
      });
      if (wall.span + WALL_T > cursor) seg(cursor, wall.span + WALL_T);
      var tag = wallPoint(wall, wall.span / 2, -(WALL_T + 0.7));
      shapes.texts.push({ x: tag.x, z: tag.z, text: letter(wid), bold: true });
    });
    var list = Plan.validate(d, sizes);
    Plan.outlines(d, sizes).forEach(function (o) {
      var item = findItem(o.id, d);
      if (item.type === "door") return;
      var tone = toneOf(o.id, list);
      shapes.rects.push(
        Object.assign(
          {
            fill: tone === "error" ? [254, 226, 226] : [224, 242, 254],
            stroke: tone === "error" ? [220, 38, 38] : [37, 99, 235],
          },
          o.body,
        ),
      );
      var c = centerOf(item, d);
      shapes.texts.push({ x: c.x, z: c.z, text: itemName(item, d), small: true });
    });
    itemsOf("door", d).forEach(function (door) {
      if ((door.opts || {}).kind === "opening") return;
      var sw = doorSwing(door, d);
      shapes.arcs.push({ x: sw.x, z: sw.z, r: sw.r, ax: sw.ax, az: sw.az, bx: sw.bx, bz: sw.bz });
      shapes.lines.push({ x0: sw.x, z0: sw.z, x1: sw.x + sw.bx * sw.r, z1: sw.z + sw.bz * sw.r });
    });
    shapes.texts.push({ x: room.w / 2, z: -(WALL_T + 1.5), text: len(room.w) });
    shapes.texts.push({ x: -(WALL_T + 1.5), z: room.l / 2, text: len(room.l), vertical: true });
    return shapes;
  }

  function exportPdf(button, status) {
    if (button.disabled) return;
    var label = button.innerHTML;
    button.disabled = true;
    button.textContent = T("pdf.preparing");
    status.hidden = true;
    var picture = has3d && ui.view !== "plan" ? room3d.snapshot(1500, 950) : null;
    window.EstimatePdf.load()
      .then(function () {
        var est = estimate();
        var priced = estimatorOn();
        var lines = [];
        var totals = [];
        if (priced) {
          lines = est.labor.lines.map(function (r) {
            return { label: r.label, detail: r.detail, amount: Pricing.money(r.cost) };
          });
          est.materials.forEach(function (m) {
            lines.push({
              label: m.label + ": " + m.product.name,
              detail: m.quantityLabel + " · " + m.product.best.name,
              amount: Pricing.money(m.cost),
            });
          });
          est.products.forEach(function (p) {
            if (p.cost !== null)
              lines.push({ label: p.label, detail: p.mmns.join(" + "), amount: Pricing.money(p.cost) });
          });
          totals = est.hasMaterials
            ? [
                { label: T("card.laborSubtotal"), value: Pricing.money(est.labor.subtotal) },
                { label: T("card.materialsSubtotal"), value: Pricing.money(est.materialsTotal) },
                { label: totalLabel(est), value: Pricing.money(est.grandTotal), strong: true },
              ]
            : [{ label: totalLabel(est), value: Pricing.money(est.grandTotal), strong: true }];
        }
        var sections = [];
        var unpriced = est.products.filter(function (p) {
          return p.cost === null;
        });
        if (unpriced.length) {
          sections.push({
            title: T("studio.est.products"),
            items: unpriced.map(function (p) {
              return p.label + (p.qty > 1 ? " × " + p.qty : "") + " — " + p.mmns.join(" + ") + " — " + p.url;
            }),
          });
        }
        if (priced) sections.push({ title: T("card.assumptions"), items: assumptions(est) });
        sections.push({ title: T("studio.pdf.link"), items: [{ text: T("studio.pdf.open"), url: shareUrl() }] });
        var doc = window.EstimatePdf.build({
          heading: BIZ.name,
          title: T(priced ? "studio.pdf.title" : "studio.pdf.titleDesign"),
          picture: picture,
          plan: pdfPlan(design),
          planTitle: T("studio.pdf.plan"),
          designTitle: T("studio.pdf.design"),
          design: designLines(design, est),
          lines: lines,
          excluded: priced ? excludedLines(est) : [],
          totals: totals,
          afterTotal: priced
            ? est.notes
                .concat(
                  est.labor.plumbingFixtureCount > 0
                    ? [T("card.plumbingTotalNote", { n: Pricing.formatQty(est.labor.plumbingFixtureCount) })]
                    : [],
                )
                .concat([T(est.hasMaterials ? "card.disclaimerMaterials" : "card.disclaimer")])
            : [],
          sections: sections,
          footer: {
            business: BIZ.legalName ? T("card.businessNamed", { business: BIZ.name, name: BIZ.legalName }) : BIZ.name,
            phone: BIZ.phone,
            email: BIZ.email,
            date: new Date().toLocaleDateString(I18n.locale(), { year: "numeric", month: "long", day: "numeric" }),
          },
        });
        doc.save((BIZ.slug || "bathroom") + "-bathroom-design.pdf");
        button.disabled = false;
        button.innerHTML = label;
      })
      .catch(function (err) {
        console.warn(err);
        button.disabled = false;
        button.textContent = T("pdf.retry");
        status.hidden = false;
        status.textContent = T("pdf.failed");
        status.classList.add("is-error");
      });
  }

  // ---------------------------------------------------------------------
  // The selected fixture, over the stage (when the panel shows another step)
  // ---------------------------------------------------------------------
  function renderSelChip() {
    var chip = els.selChip;
    var item = ui.selected && findItem(ui.selected);
    var editing = item && (item.type === "door" ? ui.step === "room" : ui.step === "layout");
    if (!item || editing) {
      chip.hidden = true;
      return;
    }
    clear(chip);
    chip.appendChild(h("span", { class: "studio-selchip-icon", icon: item.type }));
    chip.appendChild(h("span", { class: "studio-selchip-name", text: itemName(item) }));
    chip.appendChild(
      h("button", {
        type: "button",
        class: "studio-link-btn",
        text: T("studio.edit"),
        onclick: function () {
          goTo(item.type === "door" ? "room" : "layout");
        },
      }),
    );
    chip.appendChild(
      h("button", {
        type: "button",
        class: "studio-icon-btn",
        "aria-label": T("studio.deselect"),
        icon: "close",
        onclick: function () {
          select(null);
        },
      }),
    );
    chip.hidden = false;
  }

  // ---------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------
  function buildChrome() {
    els.steps = document.getElementById("studio-steps");
    STEPS.forEach(function (step, i) {
      els.steps.appendChild(
        h(
          "button",
          {
            type: "button",
            class: "studio-step-btn",
            "data-step": step,
            onclick: function () {
              goTo(step);
            },
          },
          [
            h("span", { class: "studio-step-num", text: String(i + 1) }),
            h("span", { class: "studio-step-label", "data-label": step, text: T("studio.step." + step + ".short") }),
          ],
        ),
      );
    });
    var actions = document.getElementById("studio-actions");
    var action = function (name, labelKey, run) {
      var btn = h(
        "button",
        { type: "button", class: "studio-action", "aria-label": T(labelKey), title: T(labelKey), onclick: run },
        [h("span", { icon: name }), h("span", { class: "studio-action-label", text: T(labelKey) })],
      );
      actions.appendChild(btn);
      return btn;
    };
    els.undo = action("undo", "studio.undo", undo);
    els.redo = action("redo", "studio.redo", redo);
    action("link", "studio.share", copyLink);
    action("restart", "studio.startOver", startOver);
    els.total = h(
      "button",
      {
        type: "button",
        class: "studio-total-chip",
        hidden: true,
        onclick: function () {
          goTo("estimate");
        },
      },
      [h("span", { class: "studio-total-chip-label", text: T("studio.estimateChip") }), (els.totalValue = h("strong"))],
    );
    actions.appendChild(els.total);

    var viewbar = els.viewbar;
    var views = h(
      "div",
      { class: "studio-views", role: "group", "aria-label": T("studio.view") },
      [
        ["3d", "cube", "studio.view.3d"],
        ["plan", "plan", "studio.view.plan"],
        ["walk", "walk", "studio.view.walk"],
      ].map(function (v) {
        return h(
          "button",
          {
            type: "button",
            class: "studio-view-btn",
            "data-view": v[0],
            "aria-pressed": "false",
            onclick: function () {
              setView(v[0]);
            },
          },
          [h("span", { icon: v[1] }), h("span", { text: T(v[2]) })],
        );
      }),
    );
    els.frameBtn = h(
      "button",
      {
        type: "button",
        class: "studio-view-btn",
        title: T("studio.view.frame"),
        "aria-label": T("studio.view.frame"),
        onclick: function () {
          if (has3d) room3d.resetView();
          focusedGroup = null;
          if (ui.view === "walk") {
            ui.view = "3d";
            renderViewbar();
            renderHint();
          }
        },
      },
      [h("span", { icon: "frame" })],
    );
    els.status = h("button", {
      type: "button",
      class: "studio-status",
      onclick: function () {
        var it = firstTrouble();
        if (!it) return;
        ui.step = it.type === "door" ? "room" : "layout";
        renderBar();
        select(it.id, { force: true });
      },
    });
    viewbar.appendChild(views);
    viewbar.appendChild(els.frameBtn);
    viewbar.appendChild(els.status);
  }

  // On wide screens the studio fills the window below the page header (and
  // the demo note, when there is one), so the whole stage is in view.
  function fitStage() {
    var body = els.body;
    if (!body) return;
    if (!window.matchMedia || !window.matchMedia("(min-width: 901px)").matches) {
      body.style.height = "";
      return;
    }
    var top = body.getBoundingClientRect().top + window.pageYOffset;
    body.style.height = Math.round(window.innerHeight - top) + "px";
  }

  function startOver() {
    var fresh = Plan.fromTemplate("full5x8", sizes);
    fresh.products = copy(DEFAULT_PICKS);
    ui.selected = null;
    ui.step = "room";
    ui.livePrices = null;
    commit(fresh, { announce: T("studio.startedOver") });
    renderPanel({ top: true });
    toast(T("studio.startedOver"), { label: T("studio.undo"), run: undo });
  }

  // Whether the design still works with these fixture sizes (a product
  // that's bigger than the one picked now): no more problems than it has.
  function fitsWith(nextSizes) {
    return errorCount(Plan.validate(design, nextSizes)) <= errorCount(issues);
  }

  function init() {
    els.studio = document.getElementById("studio");
    if (!els.studio || !Plan || !Pricing) return;
    if (BIZ.unavailable) return;
    els.panel = document.getElementById("studio-panel");
    els.viewbar = document.getElementById("studio-viewbar");
    els.room = document.getElementById("room-3d");
    els.canvasWrap = document.getElementById("room-3d-canvas");
    els.labels = document.getElementById("studio-labels");
    els.planWrap = document.getElementById("studio-plan");
    els.mini = document.getElementById("studio-mini");
    els.hint = document.getElementById("studio-hint");
    els.toast = document.getElementById("studio-toast");
    els.live = document.getElementById("studio-live");
    els.selChip = document.getElementById("studio-selchip");
    els.request = document.getElementById("studio-request");
    els.requestHome = els.request.parentNode;
    els.linkDialog = document.getElementById("studio-link-dialog");
    els.body = els.studio.querySelector(".studio-body");
    els.planSvg = s("svg", { class: "plan-svg" });
    els.planWrap.appendChild(els.planSvg);
    els.miniSvg = s("svg", { class: "plan-svg is-mini" });
    els.mini.appendChild(els.miniSvg);
    els.mini.addEventListener("click", function () {
      setView("plan");
    });
    buildChrome();

    room3d =
      window.BathroomRoom3D && typeof window.BathroomRoom3D.setPlan === "function" ? window.BathroomRoom3D : null;
    if (room3d) {
      DEFAULT_PICKS = room3d.getProductPicks();
      room3d.setFitCheck(fitsWith);
      has3d = true;
    } else {
      ui.view = "plan";
    }
    sizes = room3d ? room3d.itemSizes() : null;

    var linked = linkedDesign();
    var saved = linked ? null : savedDesign();
    design = linked || saved || Plan.fromTemplate("full5x8", sizes);
    if (!design.products || !Object.keys(design.products).length) design.products = copy(DEFAULT_PICKS);
    if (linked) {
      // The link has done its job: from here on the design is this
      // browser's, and a reload shouldn't throw away changes.
      try {
        history.replaceState(null, "", window.location.href.split("#")[0]);
      } catch (e) {
        /* fine */
      }
    }

    wire3d();
    wirePlan();
    document.addEventListener("keydown", onKey);
    window.addEventListener("hashchange", function () {
      var next = linkedDesign();
      if (!next) return;
      ui.selected = null;
      commit(next);
      toast(T("studio.openedLink"));
      try {
        history.replaceState(null, "", window.location.href.split("#")[0]);
      } catch (e) {
        /* fine */
      }
    });
    var message = document.getElementById("message");
    if (message) {
      message.addEventListener("input", function () {
        ui.messageEdited = true;
      });
    }
    var service = document.getElementById("service");
    if (service) {
      service.addEventListener("change", function () {
        ui.serviceEdited = true;
      });
    }
    var form = document.getElementById("lead-form");
    if (form) {
      form.addEventListener("reset", function () {
        ui.messageEdited = false;
        ui.serviceEdited = false;
      });
    }
    els.linkDialog.addEventListener("click", function (e) {
      if (e.target.closest("[data-close]")) els.linkDialog.close();
    });

    if (room3d) {
      document.addEventListener("bathroomroom3d:unavailable", function () {
        has3d = false;
        ui.view = "plan";
        renderViewbar();
        renderStage();
        renderHint();
        renderPanel();
        toast(T("studio.no3d"));
      });
      room3d.onFrame(positionLabels);
      room3d.show();
    }

    renderViewbar();
    renderHint();
    refresh();
    fitStage();
    window.addEventListener("resize", fitStage);
    // The demo note above the studio appears once the page has loaded.
    document.addEventListener("DOMContentLoaded", fitStage);
    window.addEventListener("load", fitStage);
    if (linked) toast(T("studio.openedLink"));
    else if (saved) toast(T("studio.welcomeBack"), { label: T("studio.startOver"), run: startOver });

    var configReady = window.SiteConfig ? window.SiteConfig.ready : Promise.resolve(null);
    configReady.then(function (c) {
      config = c;
      renderBar();
      renderPanel();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
