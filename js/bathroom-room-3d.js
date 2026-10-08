// The 3D bathroom: an orbitable room, rendered as realistically as this
// pipeline reasonably allows — real-world proportions, PBR materials
// (glazed-porcelain clearcoat, chrome), image-based lighting, real shadows.
// js/studio.js decides what is in the room and where (js/room-plan.js) and
// hands it over with setPlan(); this module draws it, with the Kohler
// products picked, the surfaces' real tiles and paints, and the studio's
// outlines and floor marks. Self-hosted Three.js (js/vendor/three/), no
// build step.
//
// This module is the only first-party file using ES module import/export
// (see eslint.config.js) — everything else on the page is a classic
// <script>. window.BathroomRoom3D is always a safe object to call: a
// WebGL failure (unsupported/disabled) is caught inside ensureScene() and
// never reaches js/studio.js's event handlers.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

var Layout = window.BathroomRoomLayout;
// Button labels in the page's language (js/i18n.js). Kohler product names
// stay as they are; only the words describing them are translated.
var T = window.I18n.t;

var PANEL_ID = "room-3d";
var CANVAS_WRAP_ID = "room-3d-canvas";

// Outward-normal wall specs for the shell (BackSide culling needs the
// normal pointing AWAY from the room interior, so whichever wall sits
// between the orbiting camera and the interior is the one that vanishes).
// This is deliberately the mirror image of js/bathroom-room-layout.js's
// wall.facingY, which orients FIXTURES to face INTO the room instead.
function shellWalls(widthFt, lengthFt) {
  return [
    { id: "N", spanFt: widthFt, rotY: Math.PI, x: widthFt / 2, z: 0 },
    { id: "E", spanFt: lengthFt, rotY: Math.PI / 2, x: widthFt, z: lengthFt / 2 },
    { id: "S", spanFt: widthFt, rotY: 0, x: widthFt / 2, z: lengthFt },
    { id: "W", spanFt: lengthFt, rotY: -Math.PI / 2, x: 0, z: lengthFt / 2 },
  ];
}

// Inward-facing normal per wall id — mirrors js/bathroom-room-layout.js's
// wallsFor() normalX/normalZ (kept as a small local literal here rather
// than importing that module's internals, matching this file's existing
// convention of duplicating the tiny bits of wall geometry it needs).
var WALL_INWARD_NORMAL = { N: { x: 0, z: 1 }, E: { x: -1, z: 0 }, S: { x: 0, z: -1 }, W: { x: 1, z: 0 } };

// Which shared material (see buildMaterials()) represents a fixture type's
// primary visible finish — matched by reference identity against the
// already-built `mat` object, so none of the buildX() functions need any
// per-mesh tagging. Fixture types not listed here (currently just
// Shower_Quantity, whose finish signal — glass panels + a porcelain pan —
// isn't a meaningful single color to retint) simply never get tinted.
var FIXTURE_FINISH_MATERIAL_KEY = {
  Toilet_Quantity: "porcelainGloss",
  Sink_Quantity: "porcelain",
  Bathtub_Quantity: "porcelain",
  Shower_Door_Quantity: "brass",
  Door_Quantity: "doorTone",
  Vanity_Quantity: "cabinetWood",
  Cabinet_Quantity: "cabinetWood",
  Mirror_Quantity: "brass",
  Mirror_Huge_Quantity: "brass",
  Shower_Shelf_Quantity: "brass",
};

// Retints every mesh in `instance` using the fixture type's designated
// finish material (if any) toward `colorHex` — a single cloned material
// shared across every matching mesh within this one instance, so a
// toilet's bowl and tank (both porcelainGloss) get the same tinted clone
// rather than two separate ones.
function applyFixtureFinish(instance, fixtureKey, mat, colorHex) {
  var materialKey = FIXTURE_FINISH_MATERIAL_KEY[fixtureKey];
  var sharedMaterial = materialKey && mat[materialKey];
  if (!sharedMaterial) return;
  var tinted = null;
  instance.traverse(function (child) {
    // Real product models (see FIXTURE_MODELS) mark their own finish
    // surface with userData.finishBase instead of sharing `mat`'s material.
    // It's a `mat` key, not the material itself: clone() deep-copies
    // userData through JSON, which would turn a material into a plain object.
    var base =
      child.isMesh && (mat[child.userData.finishBase] || (child.material === sharedMaterial && sharedMaterial));
    if (base) {
      if (!tinted) {
        tinted = base.clone();
        tinted.color.setHex(colorHex);
        // Marks this as a clone made just for this instance, as opposed to
        // every mesh still pointing at the shared, reused-forever template
        // material — rebuildFixtures() uses this to know which materials
        // it's safe (and necessary) to dispose() when a fixture is rebuilt.
        tinted.userData.isFinishClone = true;
      }
      child.material = tinted;
    }
  });
}

// Releases GPU resources (compiled shader program) for the one-off tinted
// material clones applyFixtureFinish() creates. The template's own shared
// geometries/materials (still referenced by every future template.clone())
// are deliberately left untouched.
function disposeFixtureInstance(instance) {
  instance.traverse(function (child) {
    if (child.isMesh && child.material && child.material.userData && child.material.userData.isFinishClone) {
      child.material.dispose();
    }
  });
}

// Retints every already-placed instance of fixtureKey in place — used by
// setFixtureFinish() so picking a product's finish doesn't have to pay for
// a full rebuildFixtures() (which recomputes the whole layout and
// re-instantiates every fixture in the room) just to change a color.
// colorHex null resets back to the shared, untinted material. Placement
// itself never depends on fixtureFinishes, so this never needs to touch
// Layout.computeLayout() at all.
function updateFixtureFinishInstances(s, fixtureKey, colorHex) {
  var materialKey = FIXTURE_FINISH_MATERIAL_KEY[fixtureKey];
  var sharedMaterial = materialKey && s.mat[materialKey];
  if (!sharedMaterial) return;
  s.fixtureGroup.children.forEach(function (instance) {
    if (instance.userData.fixtureKey !== fixtureKey) return;
    instance.traverse(function (child) {
      if (child.isMesh && child.material && child.material.userData && child.material.userData.isFinishClone) {
        child.material.dispose();
        child.material = s.mat[child.userData.finishBase] || sharedMaterial;
      }
    });
    if (colorHex != null) applyFixtureFinish(instance, fixtureKey, s.mat, colorHex);
  });
}

function isDarkTheme() {
  var attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark") return true;
  if (attr === "light") return false;
  return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// ---------------------------------------------------------------------
// Realistic-geometry helpers (toilet, and reusable for later fixtures).
// ---------------------------------------------------------------------

// A THREE.LatheGeometry from a hand-placed (radius, height) side-profile,
// revolved around Y then stretched along Z — the standard, pragmatic way to
// turn a lathe's circular cross-section into a real fixture's elongated
// footprint without hand-lofting a full custom mesh.
function latheProfileGeometry(profilePoints, zScale, segments) {
  var pts = profilePoints.map(function (p) {
    return new THREE.Vector2(p[0], p[1]);
  });
  var geo = new THREE.LatheGeometry(pts, segments || 32);
  geo.scale(1, 1, zScale);
  geo.computeVertexNormals();
  return geo;
}

// A rounded-rectangle outline, y from 0 to height, centered on x — the
// front-face profile for roundedBoxGeometry below.
function roundedFrontShape(width, height, radius) {
  var w2 = width / 2;
  var r = Math.min(radius, w2, height / 2);
  var shape = new THREE.Shape();
  shape.moveTo(-w2 + r, 0);
  shape.lineTo(w2 - r, 0);
  shape.quadraticCurveTo(w2, 0, w2, r);
  shape.lineTo(w2, height - r);
  shape.quadraticCurveTo(w2, height, w2 - r, height);
  shape.lineTo(-w2 + r, height);
  shape.quadraticCurveTo(-w2, height, -w2, height - r);
  shape.lineTo(-w2, r);
  shape.quadraticCurveTo(-w2, 0, -w2 + r, 0);
  return shape;
}

// A soft-edged box (rounded corners + beveled top/bottom), extruded along Z
// so it lands directly in this file's fixture convention: x centered, y
// from 0 (floor) to height, z from 0 (at the wall) to depth (into the
// room) — e.g. a toilet tank/lid, no post-hoc rotation needed.
function roundedBoxGeometry(width, height, depth, cornerRadius, bevelSize) {
  var shape = roundedFrontShape(width, height, cornerRadius);
  var geo = new THREE.ExtrudeGeometry(shape, {
    depth: depth,
    bevelEnabled: true,
    bevelThickness: bevelSize,
    bevelSize: bevelSize,
    bevelSegments: 3,
    curveSegments: 8,
  });
  geo.computeVertexNormals();
  return geo;
}

// An open horseshoe ring (a real toilet seat's shape, unlike a closed
// torus) — an ellipse swept by TubeGeometry, left open across a front gap.
// centerZ/frontZ locate the ellipse in this fixture's z=0-at-wall space.
function horseshoeSeatGeometry(radiusX, radiusZ, centerZ, tubeRadius, gapDegrees) {
  var gapHalf = (gapDegrees / 2) * (Math.PI / 180);
  var start = Math.PI / 2 + gapHalf;
  var end = Math.PI / 2 - gapHalf + Math.PI * 2;
  var steps = 40;
  var points = [];
  for (var i = 0; i <= steps; i++) {
    var theta = start + ((end - start) * i) / steps;
    points.push(new THREE.Vector3(radiusX * Math.cos(theta), 0, centerZ + radiusZ * Math.sin(theta)));
  }
  var curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.5);
  var geo = new THREE.TubeGeometry(curve, 64, tubeRadius, 12, false);
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------
// Fixture primitives: one shared geometry/material set built once, one
// template Group per fixture key built once, cloned cheaply (shared
// geometry/material references, not re-uploaded) for every placement.
// ---------------------------------------------------------------------
function buildMaterials(isDark) {
  var porcelain = new THREE.MeshLambertMaterial({ color: isDark ? 0x8a8377 : 0x6b6358 });
  var cabinetWood = new THREE.MeshLambertMaterial({ color: isDark ? 0x5c564c : 0x46413a });
  var doorTone = new THREE.MeshLambertMaterial({ color: isDark ? 0xa79c85 : 0xcfc3ad });
  var glass = new THREE.MeshLambertMaterial({ color: 0xdce6e6, transparent: true, opacity: 0.3 });
  var brass = new THREE.MeshStandardMaterial({
    color: isDark ? 0xcda15f : 0xb3874a,
    metalness: 0.6,
    roughness: 0.35,
  });
  // Glazed ceramic: a thin glossy clearcoat over a mostly-diffuse white
  // body is what actually reads as "porcelain" under image-based lighting,
  // rather than a flat white color.
  var porcelainGloss = new THREE.MeshPhysicalMaterial({
    color: isDark ? 0xe8e6df : 0xfdfcf9,
    roughness: 0.22,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  });
  // The seat/lid is a separate molded piece (resin or coated wood) — a
  // little less glossy than the ceramic bowl/tank, same family of material.
  var seatResin = new THREE.MeshPhysicalMaterial({
    color: isDark ? 0xe4e2db : 0xfbfaf6,
    roughness: 0.35,
    metalness: 0,
    clearcoat: 0.5,
    clearcoatRoughness: 0.15,
  });
  // Brushed stainless (the Bachata sink bowl).
  var stainless = new THREE.MeshStandardMaterial({ color: 0xc4c7c9, roughness: 0.38, metalness: 0.9 });
  var chrome = new THREE.MeshPhysicalMaterial({
    color: 0xd8dadb,
    roughness: 0.12,
    metalness: 1,
    clearcoat: 0.3,
  });
  // Stone/quartz vanity top — only used once a real undermount bowl
  // swaps the vanity to buildUndermountVanity().
  var countertop = new THREE.MeshStandardMaterial({ color: isDark ? 0xd9d5cc : 0xeeebe5, roughness: 0.35 });
  // A whole vanity's painted cabinet (the Kohler vanities come in white).
  var vanityPaint = new THREE.MeshStandardMaterial({ color: isDark ? 0xdcd9d2 : 0xf3f1ec, roughness: 0.6 });
  // Dark anodized aluminum (the Maxstow medicine cabinets' frame).
  var darkMetal = new THREE.MeshStandardMaterial({ color: 0x3c3d40, roughness: 0.4, metalness: 0.7 });
  // A light fixture's glass shade, lit from inside.
  var shadeGlass = new THREE.MeshStandardMaterial({
    color: 0xf6f1e6,
    emissive: 0xfff1d6,
    emissiveIntensity: 0.55,
    roughness: 0.3,
  });
  // Mirror glass: a smooth, fully metallic surface, so it reflects the
  // room's environment light instead of showing the wall through it.
  var mirrorGlass = new THREE.MeshStandardMaterial({ color: 0xdfe5e8, roughness: 0.04, metalness: 1 });
  return {
    countertop: countertop,
    vanityPaint: vanityPaint,
    darkMetal: darkMetal,
    shadeGlass: shadeGlass,
    mirrorGlass: mirrorGlass,
    stainless: stainless,
    porcelain: porcelain,
    cabinetWood: cabinetWood,
    doorTone: doorTone,
    glass: glass,
    brass: brass,
    porcelainGloss: porcelainGloss,
    seatResin: seatResin,
    chrome: chrome,
  };
}

// Side-profile (radius, height) of an elongated toilet bowl, floor to rim,
// bottom to top — a skirted column that narrows through a waist then
// flares to the rim, with a shallow visible interior just inside the lip.
// Revolved by latheProfileGeometry() and stretched in Z to go from a round
// lathe cross-section to a real elongated-bowl footprint.
var TOILET_BOWL_PROFILE = [
  [0.0, 0.0],
  [0.4, 0.0],
  [0.43, 0.08],
  [0.4, 0.25],
  [0.36, 0.55],
  [0.4, 0.85],
  [0.48, 1.05],
  [0.52, 1.18],
  [0.5, 1.27],
  [0.34, 1.3],
  [0.22, 1.28],
  [0.16, 1.1],
  [0.11, 0.85],
  [0.09, 0.68],
  [0.0, 0.62],
];
var TOILET_BOWL_Z_SCALE = 1.4;
var TOILET_SEAT_CENTER_Z = 0.85;

function buildToiletGeometries() {
  var bowl = latheProfileGeometry(TOILET_BOWL_PROFILE, TOILET_BOWL_Z_SCALE, 40);
  var seat = horseshoeSeatGeometry(0.48, 0.62 * TOILET_BOWL_Z_SCALE, TOILET_SEAT_CENTER_Z, 0.045, 70);
  var hingeStub = new THREE.CylinderGeometry(0.025, 0.025, 0.16, 8);
  var flushLever = new THREE.CapsuleGeometry(0.022, 0.1, 4, 8);
  return {
    bowl: bowl,
    seat: seat,
    hingeStub: hingeStub,
    flushLever: flushLever,
    // Style A — skirted two-piece: boxier, visibly separate tank + lid.
    // Deep enough (z) to bury its back half in the bowl's own bulk at this
    // height range — the bowl profile ends at the rim (y=1.3), so without
    // real overlap the tank would visibly float above/behind it.
    tankA: roundedBoxGeometry(1.05, 1.3, 0.85, 0.1, 0.025),
    lidA: roundedBoxGeometry(1.15, 0.08, 0.9, 0.12, 0.02),
    // Style B — one-piece seamless: a rounder, lower, pill-like upper body
    // that overlaps down into the bowl instead of sitting apart from it.
    tankB: roundedBoxGeometry(0.95, 1.05, 0.85, 0.32, 0.03),
  };
}

function buildGeometries() {
  return {
    toilet: buildToiletGeometries(),
    sinkBasin: new THREE.CylinderGeometry(0.7, 0.6, 0.15, 16),
    sinkColumn: new THREE.CylinderGeometry(0.18, 0.22, 2.4, 12),
    bathtubOuter: new THREE.BoxGeometry(5.2, 1.6, 2.6),
    bathtubInner: new THREE.BoxGeometry(4.7, 1.1, 2.1),
    showerPanel: new THREE.PlaneGeometry(3.2, 6.5),
    showerPan: new THREE.BoxGeometry(3, 0.1, 3),
    showerHeadArm: new THREE.CylinderGeometry(0.025, 0.025, 0.45, 8),
    showerHeadElbow: new THREE.SphereGeometry(0.035, 8, 8),
    showerHeadDisc: new THREE.CylinderGeometry(0.22, 0.22, 0.04, 24),
    showerDoorPanel: new THREE.PlaneGeometry(2.5, 6.5),
    showerDoorFrameEdge: new THREE.BoxGeometry(0.06, 6.5, 0.06),
    doorSlab: new THREE.BoxGeometry(2.5, 6.75, 0.15),
    doorKnob: new THREE.SphereGeometry(0.05, 8, 8),
    doorFrameEdge: new THREE.BoxGeometry(0.06, 6.75, 0.06),
    vanityBody: new THREE.BoxGeometry(2.5, 2.6, 1.6),
    vanityBasin: new THREE.CylinderGeometry(0.55, 0.5, 0.12, 16),
    vanityLowerBody: new THREE.BoxGeometry(2.5, 2.0, 1.6),
    vanityApronX: new THREE.BoxGeometry(2.5, 0.5, 0.05),
    vanityApronZ: new THREE.BoxGeometry(0.05, 0.5, 1.5),
    cabinetBody: new THREE.BoxGeometry(1.6, 2.6, 1.4),
    mirrorGlass: new THREE.PlaneGeometry(1.85, 2.35),
    mirrorFrameEdge: new THREE.BoxGeometry(0.06, 2.35, 0.06),
    mirrorHugeGlass: new THREE.PlaneGeometry(3.35, 3.85),
    mirrorHugeFrameEdge: new THREE.BoxGeometry(0.06, 3.85, 0.06),
    shelfBody: new THREE.BoxGeometry(0.8, 0.15, 0.2),
  };
}

function frameStrips(edgeGeometry, mat, width, height) {
  var group = new THREE.Group();
  var top = new THREE.Mesh(edgeGeometry, mat);
  top.rotation.z = Math.PI / 2;
  // edgeGeometry is a thin bar authored along its own local Y axis, length
  // `height` (its own vertical-edge length — see the *FrameEdge geometries
  // above, always built and called with the same value). Rotating 90° about
  // Z swaps local X/Y into world Y/X, so to land a `width`-long horizontal
  // bar the LENGTH axis (local Y) needs rescaling to `width` — scaling
  // local X instead (the bar's thin cross-section) leaves the unscaled
  // length axis, now `height` long, swapped onto world X: a slab roughly
  // `height` wide by `width` thick instead of a thin `width`-long strip.
  top.scale.set(1, width / height, 1);
  top.position.set(0, height / 2, 0);
  var bottom = top.clone();
  bottom.position.set(0, -height / 2, 0);
  var left = new THREE.Mesh(edgeGeometry, mat);
  left.position.set(-width / 2, 0, 0);
  var right = left.clone();
  right.position.set(width / 2, 0, 0);
  group.add(top, bottom, left, right);
  return group;
}

// Shared by both toilet styles: the bowl, seat, hinge stubs and flush
// lever are identical — only the tank/lid (and how they're attached to the
// bowl) tell the two styles apart.
function addToiletBowlAndSeat(g, geo, mat) {
  var bowl = new THREE.Mesh(geo.toilet.bowl, mat.porcelainGloss);
  bowl.position.set(0, 0, TOILET_SEAT_CENTER_Z);
  var seat = new THREE.Mesh(geo.toilet.seat, mat.seatResin);
  seat.position.set(0, 1.33, 0);
  var hingeR = new THREE.Mesh(geo.toilet.hingeStub, mat.seatResin);
  hingeR.rotation.z = Math.PI / 2;
  hingeR.position.set(0.09, 1.33, TOILET_SEAT_CENTER_Z - 0.62 * TOILET_BOWL_Z_SCALE + 0.04);
  var hingeL = hingeR.clone();
  hingeL.position.x = -0.09;
  g.add(bowl, seat, hingeR, hingeL);
}

function addFlushLever(g, geo, mat, x, y, z) {
  var lever = new THREE.Mesh(geo.toilet.flushLever, mat.chrome);
  lever.rotation.z = Math.PI / 2;
  lever.position.set(x, y, z);
  g.add(lever);
}

// Local origin sits on the wall (z=0); the fixture projects forward into
// the room as z increases, matching every other floor fixture builder in
// this file.

// Style A — skirted two-piece (elongated bowl, continuous floor-to-rim
// skirt hiding the trapway, a visibly separate compact tank + lid, chrome
// side lever). Reference: the first supplied toilet photo.
function buildToiletStyleA(geo, mat) {
  var g = new THREE.Group();
  addToiletBowlAndSeat(g, geo, mat);
  var tank = new THREE.Mesh(geo.toilet.tankA, mat.porcelainGloss);
  tank.position.set(0, 0.86, 0);
  var lid = new THREE.Mesh(geo.toilet.lidA, mat.porcelainGloss);
  lid.position.set(0, 2.2, -0.04);
  addFlushLever(g, geo, mat, 0.545, 1.75, 0.65);
  g.add(tank, lid);
  return g;
}

// Style B — one-piece seamless (bowl and a rounder, lower "pill" upper
// body overlapped into one continuous glossy form — no separate lid seam).
// Reference: the third supplied toilet photo.
function buildToiletStyleB(geo, mat) {
  var g = new THREE.Group();
  addToiletBowlAndSeat(g, geo, mat);
  var tank = new THREE.Mesh(geo.toilet.tankB, mat.porcelainGloss);
  tank.position.set(0, 0.75, 0.04);
  addFlushLever(g, geo, mat, 0.5, 1.45, 0.6);
  g.add(tank);
  return g;
}

function buildSink(geo, mat) {
  var g = new THREE.Group();
  var basin = new THREE.Mesh(geo.sinkBasin, mat.porcelain);
  basin.position.set(0, 2.4, 0.4);
  var column = new THREE.Mesh(geo.sinkColumn, mat.porcelain);
  column.position.set(0, 1.2, 0.4);
  g.add(basin, column);
  return g;
}

function buildBathtub(geo, mat) {
  var g = new THREE.Group();
  var outer = new THREE.Mesh(geo.bathtubOuter, mat.porcelain);
  outer.position.set(0, 0.8, 1.3);
  var inner = new THREE.Mesh(geo.bathtubInner, mat.porcelain);
  inner.position.set(0, 1.15, 1.25);
  g.add(outer, inner);
  return g;
}

function buildShower(geo, mat) {
  // Back panel sits at the wall (z~0); the enclosure opens toward the room
  // at z=3.2, where a paired Shower_Door_Quantity instance attaches.
  var g = new THREE.Group();
  var back = new THREE.Mesh(geo.showerPanel, mat.glass);
  back.position.set(0, 3.25, 0.05);
  var left = new THREE.Mesh(geo.showerPanel, mat.glass);
  left.rotation.y = Math.PI / 2;
  left.position.set(-1.6, 3.25, 1.6);
  var right = left.clone();
  right.position.set(1.6, 3.25, 1.6);
  var pan = new THREE.Mesh(geo.showerPan, mat.porcelain);
  pan.position.set(0, 0.05, 1.6);
  // Wall-mounted shower head: an elbow at the wall, an angled arm, and a
  // disc head facing down into the shower — chrome, matching the toilet's
  // flush lever/mirror-frame hardware finish.
  var headElbow = new THREE.Mesh(geo.showerHeadElbow, mat.chrome);
  headElbow.position.set(0, 6.3, 0.08);
  var headArm = new THREE.Mesh(geo.showerHeadArm, mat.chrome);
  headArm.rotation.x = Math.PI / 2.3;
  headArm.position.set(0, 6.18, 0.28);
  var headDisc = new THREE.Mesh(geo.showerHeadDisc, mat.chrome);
  headDisc.rotation.x = Math.PI / 2.1;
  headDisc.position.set(0, 6.0, 0.48);
  // Hidden when a Kohler showerhead is picked (see addProductParts()).
  [headElbow, headArm, headDisc].forEach(function (m) {
    m.userData.standardShowerHead = true;
  });
  g.add(back, left, right, pan, headElbow, headArm, headDisc);
  return g;
}

function buildShowerDoor(geo, mat) {
  var g = new THREE.Group();
  var panel = new THREE.Mesh(geo.showerDoorPanel, mat.glass);
  panel.position.set(0, 3.25, 0);
  var frame = frameStrips(geo.showerDoorFrameEdge, mat.brass, 2.5, 6.5);
  frame.position.set(0, 3.25, 0);
  g.add(panel, frame);
  return g;
}

function buildEntryDoor(geo, mat) {
  var g = new THREE.Group();
  var slab = new THREE.Mesh(geo.doorSlab, mat.doorTone);
  slab.position.set(0, 3.375, 0);
  var knob = new THREE.Mesh(geo.doorKnob, mat.brass);
  knob.position.set(0.95, 3.0, 0.1);
  g.add(slab, knob);
  return g;
}

// An entry point without a door: no slab, no knob — just a trimmed
// rectangular opening in the wall (same footprint a real door would use),
// so it reads as a doorway rather than a plain, unbroken wall.
function buildEntryArchway(geo, mat) {
  var g = new THREE.Group();
  var frame = frameStrips(geo.doorFrameEdge, mat.doorTone, 2.5, 6.75);
  frame.position.set(0, 3.375, 0);
  g.add(frame);
  return g;
}

function buildVanity(geo, mat) {
  var g = new THREE.Group();
  var body = new THREE.Mesh(geo.vanityBody, mat.cabinetWood);
  body.position.set(0, 1.3, 0.8);
  var basin = new THREE.Mesh(geo.vanityBasin, mat.porcelain);
  basin.position.set(0, 2.66, 0.8);
  g.add(body, basin);
  return g;
}

function buildCabinet(geo, mat) {
  var g = new THREE.Group();
  var body = new THREE.Mesh(geo.cabinetBody, mat.cabinetWood);
  body.position.set(0, 1.3, 0.7);
  g.add(body);
  return g;
}

// Hung like the Kohler mirrors: bottom edge at MIRROR_BOTTOM_FT (clear of a
// vanity top and faucet), on the wall's face rather than sunk into it. The
// group's origin is the layout's mountHeight, so the parts are offset from it.
function buildMirror(geo, mat, huge) {
  var g = new THREE.Group();
  var glassGeo = huge ? geo.mirrorHugeGlass : geo.mirrorGlass;
  var edgeGeo = huge ? geo.mirrorHugeFrameEdge : geo.mirrorFrameEdge;
  var width = huge ? 3.35 : 1.85;
  var height = huge ? 3.85 : 2.35;
  var mountY = Layout.FIXTURE_LAYOUT[huge ? "Mirror_Huge_Quantity" : "Mirror_Quantity"].mountHeight;
  var centerY = MIRROR_BOTTOM_FT + height / 2 - mountY;
  var glass = new THREE.Mesh(glassGeo, mat.mirrorGlass);
  glass.position.set(0, centerY, 0.02);
  var frame = frameStrips(edgeGeo, mat.brass, width, height);
  frame.position.set(0, centerY, 0.03);
  g.add(glass, frame);
  return g;
}

function buildShowerShelf(geo, mat) {
  var g = new THREE.Group();
  var shelf = new THREE.Mesh(geo.shelfBody, mat.brass);
  shelf.position.set(0, 0, 0);
  g.add(shelf);
  return g;
}

// Toilets are built separately (see buildToiletTemplates below) since,
// unlike every other fixture, they have two interchangeable styles the
// visitor can pick between live.
// ---------------------------------------------------------------------
// Real product models
// ---------------------------------------------------------------------
// Manufacturer/catalog 3D models, converted from .obj by
// tools/models/obj-to-glb.mjs into this file's fixture convention (feet,
// Y up, back on the wall at z = 0, projecting toward +z, resting on the
// floor or — wall-hung — at its real mount height). Loaded after the scene
// is up; until one arrives (or if it fails to), the procedural stand-in
// for that fixture type keeps rendering, so nothing here can break the
// preview. The source OBJs carry no usable materials, so every mesh gets
// the shared glazed-porcelain material (and stays retintable by
// setFixtureFinish() via userData.finishBase).
var FIXTURE_MODELS = {
  Toilet_Quantity: "models/fixtures/toilet.glb",
  Sink_Quantity: "models/fixtures/sink.glb",
};

// Fetched lazily, the first time a fixture of that type is actually placed
// (see rebuildFixtures()) — most visitors never add a tub, and pulling
// every model up front competes with the studio's own work for the main
// thread on slower devices.
var fixtureModelLoader = null;

// Model paths are relative to the site root; the Spanish and Portuguese
// pages live one folder down (es/, pt/), so resolve them from this file.
function siteUrl(path) {
  return new URL("../" + path, import.meta.url).href;
}

function ensureFixtureModel(s, fixtureKey) {
  if (!FIXTURE_MODELS[fixtureKey] || s.modelRequests[fixtureKey]) return;
  s.modelRequests[fixtureKey] = true;
  if (!fixtureModelLoader) fixtureModelLoader = new GLTFLoader();
  fixtureModelLoader.load(
    siteUrl(FIXTURE_MODELS[fixtureKey]),
    function (gltf) {
      var template = gltf.scene;
      template.traverse(function (child) {
        if (child.isMesh) {
          child.material = s.mat.porcelainGloss;
          child.userData.finishBase = "porcelainGloss";
        }
      });
      if (fixtureKey === "Toilet_Quantity") {
        // One real model replaces both procedural styles — the style
        // switch only chooses between stand-ins, so it's hidden once a
        // real toilet is showing (see rebuildFixtures()).
        s.toiletTemplates.A = template;
        s.toiletTemplates.B = template;
      } else {
        s.fixtureTemplates[fixtureKey] = template;
      }
      s.realModels[fixtureKey] = true;
      markDirty();
    },
    undefined,
    function (err) {
      var retry = function () {
        s.modelRequests[fixtureKey] = false;
      };
      if (!modelLoadFailed(s, fixtureKey, retry)) return;
      console.warn("3D preview: couldn't load " + FIXTURE_MODELS[fixtureKey] + ", keeping the stand-in.", err);
    },
  );
}

// ---------------------------------------------------------------------
// Kohler product switcher
// ---------------------------------------------------------------------
// The Studio Kohler models (models/products/kohler/, converted from the
// Restor .obj downloads — see that folder's manifest.json for each one's
// name, source and conversion flags), grouped into slots the visitor can
// flip between with a dropdown per slot above the canvas. Purely visual:
// nothing here feeds the estimate's pricing.
//
// Positions are in the fixture's own frame (feet, back on the wall at
// z = 0), and some depend on another slot's pick — a tub faucet sits on
// whichever tub is showing, a sink faucet behind whichever bowl is in the
// vanity — so each option's place() gets every slot's current option.
//   body:      this slot's model IS the fixture (replaces the stand-in or
//              the default model), rather than being added onto it
//   url: null  the slot's stand-in: the procedural/default model for a
//              body slot, or nothing at all ("none") for an add-on
//   footprint: a body's real size, fed to Layout.computeLayout() so
//              clearance/fit checks follow the picked product
//   available: (sel) -> false when the option doesn't go with another
//              slot's pick (a 60 in. sliding door on a 36 in. base); the
//              slot then shows its first option that does, and the
//              dropdown says why (unavailableReason, an i18n key)
//   extras:    more models placed with the option (a showerhead's arm)
//   anchor:    "topCenter" — place() gives where the model's top center
//              goes, for parts that are rotated before placing
//   deckLine:  a deck-mounted faucet's mounting-hole line, measured from
//              its model's back edge
//   dropIn:    a drop-in or alcove tub ("oval" or "rect" basin) — drawn set
//              into a stone tub deck (see buildTubDeck) instead of standing
//              on its bare shell
//   alcove:    an alcove tub with its own apron (or a tub-and-walls kit),
//              set against the wall as it is: no deck, and no floor filler
//   hasWalls:  a shower kit with its walls built in (no separate wall kit)
//   complete:  a whole vanity (cabinet, top and bowl in one model): the
//              vanity sink row goes away, and the faucet sits on its top
//   parts:     { meshName: material key } for a model converted with its
//              parts kept apart (cabinet, top, bowl, hardware)
//   keepMaterials: the model's own materials and textures (a fan grille
//              that only exists as a texture), not one of ours
//   recessed:  a medicine cabinet set into the wall, its door standing
//              just proud of the wall's face

// Where a mirror's bottom edge goes: ~10 in. above a 31 in. vanity top.
var MIRROR_BOTTOM_FT = 3.4;
// A whole vanity stands taller (about 36 in.) than the drawn one, so the
// mirror goes up with it to stay clear of the faucet.
function mirrorBottom(sel) {
  return sel.vanity.complete ? MIRROR_BOTTOM_FT + Math.round((sel.vanity.deckY - 2.6) * 100) / 100 : MIRROR_BOTTOM_FT;
}

// Kohler vanity lights sold at Home Depot (under their model numbers
// without the K-), from KOHLER Co.'s 3D Warehouse models with the shades
// kept apart from the metal: [model number, the metal's material].
var VANITY_LIGHTS = [
  ["31769-SC02-CPL", "chrome"],
  ["31770-SC03-CPL", "chrome"],
  ["31756-SC02-BNL", "stainless"],
  ["31757-SC03-CPL", "chrome"],
  ["38398-SC03-2GL", "brass"],
  ["38399-SC04-CPL", "chrome"],
  ["26849-SC04-CPL", "chrome"],
  ["28973-SC04-BNL", "stainless"],
  ["35875-SC04-BNL", "stainless"],
];

// Product slots for electrical points rather than placed fixtures: the
// slot's fixtureKey for each kind of point.
var ELECTRICAL_SLOT_KEYS = { light: "Light_Point" };

// Marks the electrical points in the room as placed, so their slots show.
function addElectricalKeys(placedKeys) {
  (state.electrical || []).forEach(function (p) {
    if (ELECTRICAL_SLOT_KEYS[p.kind]) placedKeys[ELECTRICAL_SLOT_KEYS[p.kind]] = true;
  });
  return placedKeys;
}

// Kohler medicine cabinets: mirror doors over a cabinet box. Recessed ones
// sit in the wall; the surface-mount Maxstow ones hang on it, in their dark
// anodized frame (models converted with that frame as a "metal" part).
function medicineCabinet(id, recessed) {
  return {
    id: id,
    url: kohlerUrl(id),
    material: "mirrorGlass",
    parts: recessed ? null : { metal: "darkMetal" },
    recessed: recessed,
  };
}

// Top of a shower arm's wall flange (about 80 in.).
var SHOWER_ARM_TOP_FT = 6.75;

// Deck-mounted sink faucets, shared by the vanity and the pedestal/wall
// sink rows (each row gets its own copies, since place() differs).
// mount: the faucet holes it needs — "single" (one hole), "centerset" (three
// holes 4 in. apart) or "widespread" (three holes 8 in. apart).
var SINK_FAUCETS = [
  { id: "K-14410-4-CP", url: "models/products/kohler/K-14410-4-CP.glb", deckLine: 0.17, mount: "widespread" },
  { id: "K-77974-9-CP", url: "models/products/kohler/K-77974-9-CP.glb", deckLine: 0.11, mount: "widespread" },
  { id: "K-14402-4A-CP", url: "models/products/kohler/K-14402-4A-CP.glb", deckLine: 0.12, mount: "single" },
  { id: "K-73167-4-CP", url: "models/products/kohler/K-73167-4-CP.glb", deckLine: 0.03, mount: "single" },
  { id: "K-77958-4A-CP", url: "models/products/kohler/K-77958-4A-CP.glb", deckLine: 0.26, mount: "single" },
  { id: "K-35951-4-CP", url: "models/products/kohler/K-35951-4-CP.glb", deckLine: 0.11, mount: "centerset" },
  { id: "K-27388-4-CP", url: "models/products/kohler/K-27388-4-CP.glb", deckLine: 0.09, mount: "centerset" },
  // Components spouts go in with the Components handles either side.
  {
    id: "K-77969-CP",
    url: "models/products/kohler/K-77969-CP.glb",
    deckLine: 0.08,
    mount: "widespread",
    handles: { url: "models/products/kohler/K-77974-9-CP.glb", deckLine: 0.11 },
  },
  {
    id: "K-77967-CP",
    url: "models/products/kohler/K-77967-CP.glb",
    deckLine: 0.1,
    mount: "widespread",
    handles: { url: "models/products/kohler/K-77974-9-CP.glb", deckLine: 0.11 },
  },
];

// Which faucets each sink's drilling takes (a sink's `holes`; a bowl with
// none, like an undermount, takes any faucet, since that goes in the
// countertop). A single-handle faucet also fits a 4 in. centerset sink with
// its deck plate.
var FAUCET_FITS = {
  single: ["single"],
  centerset: ["centerset", "single"],
  widespread: ["widespread"],
};

// deck(sel) -> { y, line }: the deck height and faucet-hole line (from the
// wall) of whatever the faucets in this row sit on.
// bowl(sel): the sink option the faucets in this row go on.
function sinkFaucetOptions(deck, bowl) {
  return SINK_FAUCETS.map(function (f) {
    var opt = { id: f.id, url: f.url, material: "chrome", deckLine: f.deckLine };
    opt.available = function (sel) {
      var holes = bowl(sel).holes;
      return !holes || FAUCET_FITS[holes].indexOf(f.mount) !== -1;
    };
    opt.unavailableReason = "room3d.wrongHoles";
    opt.place = function (sel) {
      var d = deck(sel);
      return [0, d.y, d.line - f.deckLine];
    };
    if (f.handles) {
      opt.extras = [
        {
          url: f.handles.url,
          material: "chrome",
          place: function (sel) {
            var d = deck(sel);
            return [0, d.y, d.line - f.handles.deckLine];
          },
        },
      ];
    }
    return opt;
  });
}

// Wall-hung accessories: centered on (x, centerY) on the wall behind.
function onWall(x, centerY) {
  return function (sel, opt, size) {
    return [x, centerY - size.y / 2, 0];
  };
}

function accessoryOptions(ids, material, place) {
  return [{ id: "none", url: null }].concat(
    ids.map(function (id) {
      return { id: id, url: productUrl(id), material: material, place: place };
    }),
  );
}

function noneLast(options) {
  return options.slice(1).concat(options[0]);
}

var TOWEL_BARS = ["K-14436-CP", "K-14435-CP", "K-78373-CP", "K-14441-CP"];
var PAPER_HOLDERS = ["K-14377-CP", "K-13504-CP", "K-73147-CP", "K-78382-CP"];
var GRAB_BARS = ["K-10542-CP", "K-10544-CP", "K-11895-BS", "K-25161-CP", "80001024-V"];
var ROBE_HOOKS = ["K-14443-CP", "K-23529-CP"];

// Each bar's overall length, flanges included (ft).
var GRAB_BAR_LENGTHS = {
  "K-10542-CP": 2.23,
  "K-10544-CP": 3.23,
  "K-11895-BS": 3.2,
  "K-25161-CP": 3.2,
  "80001024-V": 2.02,
};

// fits(sel, length): whether a bar that long goes on this fixture's wall.
function grabBarOptions(place, fits) {
  return accessoryOptions(GRAB_BARS, "chrome", place).map(function (opt) {
    // The Purist and Sterling bars are brushed stainless, not chrome.
    if (opt.id === "K-11895-BS" || opt.id === "80001024-V") opt.material = "stainless";
    if (opt.url && fits) {
      opt.available = function (sel) {
        return fits(sel, GRAB_BAR_LENGTHS[opt.id]);
      };
      opt.unavailableReason = "room3d.tooLong";
    }
    return opt;
  });
}

function isFreestandingTub(sel) {
  return !sel.tub.dropIn && !sel.tub.alcove;
}

function kohlerUrl(id) {
  return "models/products/kohler/" + id + ".glb";
}

function broanUrl(id) {
  return "models/products/broan/" + id + ".glb";
}

// The Sterling models (models/products/sterling/, from Sterling's own
// 3D Warehouse catalog — see that folder's manifest.json), named by their
// Home Depot model numbers.
// Kohler vanities sold whole (cabinet, quartz top and undermount bowl
// assembled), from KOHLER Co.'s 3D Warehouse models: models/products/kohler/
// with their parts kept apart. width/depth: the model's size (ft); holes:
// the top's faucet drilling (the 24 in. ones have one hole, the rest 8 in.
// widespread), all 0.2 ft from the back.
var VANITY_PARTS = { body: "vanityPaint", top: "countertop", bowl: "porcelainGloss", metal: "stainless" };

function kohlerVanity(id, width, depth, deckY) {
  return {
    id: id,
    url: kohlerUrl(id),
    complete: true,
    parts: VANITY_PARTS,
    holes: width < 2.2 ? "single" : "widespread",
    deckY: deckY,
    faucetLine: 0.2,
    footprint: { wallSpan: width, depth: depth },
  };
}

function sterlingUrl(id) {
  return "models/products/sterling/" + id + ".glb";
}

function productUrl(id) {
  return /^K-/.test(id) ? kohlerUrl(id) : sterlingUrl(id);
}

// A 60 in. Sterling alcove tub (or tub-and-walls kit): depth and rim
// height in feet, wallSpan when it isn't 5 ft.
function sterlingAlcoveTub(id, depth, rimY, wallSpan) {
  return {
    id: id,
    url: sterlingUrl(id),
    alcove: true,
    footprint: { wallSpan: wallSpan || 5, depth: depth },
    depth: depth,
    rimY: rimY,
    deckZ: 0.15,
  };
}

// A Sterling shower base or kit: 60 in. wide when opts.wide, else 36 in.
function sterlingShowerBase(id, opts) {
  var width = opts.wide ? 5 : 3;
  return {
    id: id,
    url: sterlingUrl(id),
    wide: !!opts.wide,
    hasWalls: !!opts.hasWalls,
    width: width,
    depth: opts.depth,
    curbY: opts.curbY,
    footprint: { wallSpan: opts.wide ? 5 : 3.05, depth: opts.depth + 0.03 },
  };
}

function tubDepth(tub) {
  return tub.depth || (tub.footprint && tub.footprint.depth) || 2.85;
}

var isWideBase = function (sel) {
  return !!sel.showerBase.wide;
};
var isNarrowShower = function (sel) {
  return !sel.showerBase.wide;
};

// For accessories a room has one of, whatever the number of toilets.
function firstOnly(placement) {
  return placement.index > 0;
}

var PRODUCT_SLOTS = [
  {
    id: "toilet",
    fixtureKey: "Toilet_Quantity",
    body: true,
    options: [
      // The generic toilet the room has always shown (models/fixtures/).
      { id: "standard-toilet", url: null },
      { id: "K-31648-0", url: kohlerUrl("K-31648-0"), footprint: { wallSpan: 1.7, depth: 2.45 } },
      { id: "K-31626-DRY-0", url: kohlerUrl("K-31626-DRY-0"), footprint: { wallSpan: 1.7, depth: 2.45 } },
      { id: "K-31641-0", url: kohlerUrl("K-31641-0") },
      { id: "K-3619-0", url: kohlerUrl("K-3619-0"), footprint: { wallSpan: 1.7, depth: 2.5 } },
      { id: "K-3981-0", url: kohlerUrl("K-3981-0"), footprint: { wallSpan: 1.7, depth: 2.35 } },
      { id: "K-3940-0", url: kohlerUrl("K-3940-0"), footprint: { wallSpan: 1.7, depth: 2.35 } },
      { id: "402321-0", url: sterlingUrl("402321-0"), footprint: { wallSpan: 1.7, depth: 2.45 } },
      { id: "402320-0", url: sterlingUrl("402320-0"), footprint: { wallSpan: 1.7, depth: 2.3 } },
      { id: "402322-0", url: sterlingUrl("402322-0"), footprint: { wallSpan: 1.7, depth: 2.45 } },
      { id: "402324-0", url: sterlingUrl("402324-0"), footprint: { wallSpan: 1.7, depth: 2.45 } },
      { id: "402325-0", url: sterlingUrl("402325-0"), footprint: { wallSpan: 1.7, depth: 2.45 } },
      { id: "402078-0", url: sterlingUrl("402078-0"), footprint: { wallSpan: 1.7, depth: 2.43 } },
      { id: "402210-0", url: sterlingUrl("402210-0"), footprint: { wallSpan: 1.7, depth: 2.46 } },
    ],
  },
  {
    id: "paperHolder",
    fixtureKey: "Toilet_Quantity",
    // Beside the toilet at the usual 26 in., clear of the tank.
    // Beside the toilet so it never pokes into the fixture next door (see
    // paperHolderSpot): on the wall behind it where there's room, otherwise
    // turned to face the toilet on the side wall of a corner, or on the
    // side of a shower, vanity or cabinet next to it.
    options: accessoryOptions(PAPER_HOLDERS, "chrome", function (sel, opt, size, ctx) {
      var spot = ctx.paperHolder;
      return spot.facing ? [spot.x, 2.15 - size.y / 2, 1.3] : [spot.x, 2.15 - size.y / 2, 0];
    }).map(function (opt) {
      if (opt.url) {
        opt.pickSpot = true;
        opt.rotationFor = function (ctx) {
          return [0, ctx.paperHolder.facing ? -ctx.paperHolder.side * (Math.PI / 2) : 0, 0];
        };
      }
      return opt;
    }),
  },
  {
    id: "towelBar",
    fixtureKey: "Toilet_Quantity",
    // One per room, over the first toilet.
    skip: firstOnly,
    // Over the toilet, about 55 in. up.
    options: accessoryOptions(TOWEL_BARS, "chrome", onWall(0, 4.6)),
  },
  {
    id: "exhaustFan",
    fixtureKey: "Toilet_Quantity",
    // One per room, over the first toilet.
    skip: firstOnly,
    options: [
      { id: "none", url: null },
      {
        id: "K-34454-NA",
        url: kohlerUrl("K-34454-NA"),
        needsWiring: true,
        material: "porcelain",
        // Converted grille-forward; tipped up so the grille faces the
        // floor, flush with the ceiling over the toilet.
        rotation: [Math.PI / 2, 0, 0],
        place: function (sel, opt, size, ctx) {
          return [0, ctx.heightFt, 1.2 - size.y / 2];
        },
      },
      // Broan-NuTone LoProfile, grille down, the housing above the ceiling.
      {
        id: "LP80",
        url: broanUrl("LP80"),
        needsWiring: true,
        keepMaterials: true,
        place: function (sel, opt, size, ctx) {
          return [0, ctx.heightFt - 0.02, 1.2 - size.z / 2];
        },
      },
    ],
  },
  {
    id: "tub",
    fixtureKey: "Bathtub_Quantity",
    body: true,
    options: [
      // The freestanding tub PR #9 shipped (Kohler's Stargaze K-24010-0);
      // its footprint is the layout's default one. rimY: top of the back
      // rim; deckZ: that rim's middle.
      {
        id: "freestanding",
        url: "models/fixtures/bathtub.glb",
        mmn: "K-24010-0",
        rimY: 2.08,
        deckZ: 0.235,
        depth: 2.85,
      },
      { id: "K-8332-0", url: kohlerUrl("K-8332-0"), rimY: 1.99, deckZ: 0.1, depth: 2.83 },
      {
        id: "K-1184-0",
        dropIn: "rect",
        url: kohlerUrl("K-1184-0"),
        footprint: { wallSpan: 5.1, depth: 2.75 },
        rimY: 1.65,
        deckZ: 0.145,
      },
      {
        id: "K-R23217-RA-0",
        dropIn: "rect",
        url: kohlerUrl("K-R23217-RA-0"),
        footprint: { wallSpan: 5, depth: 2.6 },
        rimY: 1.21,
        deckZ: 0.15,
      },
      {
        id: "K-R23217-LA-0",
        dropIn: "rect",
        url: kohlerUrl("K-R23217-LA-0"),
        footprint: { wallSpan: 5, depth: 2.6 },
        rimY: 1.21,
        deckZ: 0.15,
      },
      {
        id: "K-1946-RA-0",
        dropIn: "rect",
        url: kohlerUrl("K-1946-RA-0"),
        footprint: { wallSpan: 5, depth: 2.6 },
        rimY: 1.57,
        deckZ: 0.15,
      },
      {
        id: "K-1163-0",
        dropIn: "oval",
        url: kohlerUrl("K-1163-0"),
        footprint: { wallSpan: 5.1, depth: 3.55 },
        rimY: 1.75,
        deckZ: 0.2,
      },
      {
        id: "K-1165-0",
        dropIn: "oval",
        url: kohlerUrl("K-1165-0"),
        footprint: { wallSpan: 6.1, depth: 3.6 },
        rimY: 1.76,
        deckZ: 0.21,
      },
      // Sterling alcove tubs, and tub-and-shower kits with their walls.
      sterlingAlcoveTub("71171110-0", 2.51, 1.5),
      sterlingAlcoveTub("71171120-0", 2.51, 1.5),
      sterlingAlcoveTub("71171112-0", 2.52, 1.72),
      sterlingAlcoveTub("71171122-0", 2.52, 1.72),
      sterlingAlcoveTub("71121110-0", 2.67, 1.66),
      sterlingAlcoveTub("71121120-0", 2.67, 1.66),
      sterlingAlcoveTub("71121112-0", 2.71, 1.6),
      sterlingAlcoveTub("71121122-0", 2.71, 1.6),
      sterlingAlcoveTub("96136-0", 2.46, 1.85, 5.6),
      sterlingAlcoveTub("71220110-0", 2.78, 1.5),
      sterlingAlcoveTub("71220120-0", 2.78, 1.5),
      sterlingAlcoveTub("71370120-0", 2.6, 1.5),
    ],
  },
  {
    id: "tubFaucet",
    fixtureKey: "Bathtub_Quantity",
    options: [
      {
        id: "K-14426-CP",
        url: kohlerUrl("K-14426-CP"),
        material: "chrome",
        place: function (sel) {
          return [0, sel.tub.rimY + 0.2, 0];
        },
      },
      // Needs a deck to stand on: only the drop-in tubs have one.
      {
        id: "K-73081-4-CP",
        url: kohlerUrl("K-73081-4-CP"),
        material: "chrome",
        deckLine: 0.105,
        ownHandles: true,
        available: function (sel) {
          return !!sel.tub.dropIn;
        },
        unavailableReason: "room3d.needsDeck",
        place: function (sel, opt) {
          return [0, sel.tub.rimY, sel.tub.deckZ - opt.deckLine];
        },
      },
      // Floor-mount fillers stand on the room side of the tub, turned so
      // the spout reaches back over it. base: the riser's center in the
      // model (x, z), before that half turn.
      // Only for a freestanding tub (a drop-in's deck is in the way). These
      // are trims with their own handle; the valve in the floor is extra.
      {
        id: "K-T97328-4-CP",
        url: kohlerUrl("K-T97328-4-CP"),
        material: "chrome",
        base: [0.06, 0.2],
        ownHandles: true,
        needsValve: true,
        available: isFreestandingTub,
        unavailableReason: "room3d.needsFreestanding",
      },
      {
        id: "K-T73087-4-CP",
        url: kohlerUrl("K-T73087-4-CP"),
        material: "chrome",
        base: [0.04, 0.22],
        ownHandles: true,
        needsValve: true,
        available: isFreestandingTub,
        unavailableReason: "room3d.needsFreestanding",
      },
    ],
  },
  {
    id: "tubValve",
    fixtureKey: "Bathtub_Quantity",
    // Above the spout (and any grab bar), centered on the tub. A trim by
    // default, since the wall spout needs one; "none" goes last, and is all
    // that's left when the tub faucet has its own handles.
    options: noneLast(
      accessoryOptions(["K-T14501-4-CP", "K-TS14423-4-CP", "K-TS73115-4-CP"], "chrome", function (sel, opt, size) {
        return [0, sel.tub.rimY + 1.4 - size.y / 2, 0];
      }),
    ).map(function (opt) {
      if (opt.url) {
        opt.available = function (sel) {
          return !sel.tubFaucet.ownHandles;
        };
        opt.unavailableReason = "room3d.faucetHasHandles";
      }
      return opt;
    }),
  },
  {
    id: "tubGrabBar",
    fixtureKey: "Bathtub_Quantity",
    options: grabBarOptions(function (sel, opt, size) {
      return [0, sel.tub.rimY + 0.75 - size.y / 2, 0];
    }),
  },
  {
    id: "vanity",
    fixtureKey: "Vanity_Quantity",
    body: true,
    options: [
      // The cabinet drawn here, with the sink and top picked below.
      { id: "standard-vanity", url: null },
      kohlerVanity("K-33577-ASB-0", 2.01, 1.56, 2.966),
      kohlerVanity("K-33578-ASB-0", 2.51, 1.56, 2.966),
      kohlerVanity("K-33579-ASB-0", 3.01, 1.56, 2.966),
      kohlerVanity("K-33580-ASB-0", 4.01, 1.56, 2.966),
      kohlerVanity("K-33535-ASB-0", 2.05, 1.58, 2.982),
      kohlerVanity("K-33536-ASB-0", 2.55, 1.58, 2.982),
      kohlerVanity("K-33537-ASB-0", 3.04, 1.58, 2.982),
      kohlerVanity("K-33538-ASB-0", 4.05, 1.58, 2.982),
      kohlerVanity("K-33551-ASB-0", 2.01, 1.62, 2.982),
      kohlerVanity("K-33552-ASB-0", 2.51, 1.62, 2.982),
      kohlerVanity("K-33553-ASB-0", 3.01, 1.62, 2.982),
      kohlerVanity("K-33554-ASB-0", 4.01, 1.62, 2.982),
      kohlerVanity("K-33543-ASB-0", 2.04, 1.58, 2.982),
      kohlerVanity("K-33545-ASB-0", 3.03, 1.58, 2.982),
      kohlerVanity("K-33546-ASB-0", 4.03, 1.58, 2.982),
    ],
  },
  {
    id: "vanitySink",
    fixtureKey: "Vanity_Quantity",
    // A whole vanity comes with its own top and bowl.
    showIf: function (sel) {
      return !sel.vanity.complete;
    },
    options: [
      // centerZ: where the bowl's center sits in the vanity; hole: the
      // countertop cutout's radii, just inside the bowl's top opening;
      // faucetLine: where the faucet's holes go, behind the cutout.
      {
        id: "K-2874-0",
        url: kohlerUrl("K-2874-0"),
        material: "porcelainGloss",
        height: 0.477,
        depth: 1.284,
        centerZ: 0.92,
        hole: { rx: 0.67, rz: 0.54 },
        faucetLine: 0.235,
      },
      {
        id: "K-2608-SU-NA",
        url: kohlerUrl("K-2608-SU-NA"),
        material: "stainless",
        height: 0.492,
        depth: 1.39,
        centerZ: 0.88,
        hole: { rx: 0.68, rz: 0.55 },
        faucetLine: 0.2,
      },
      {
        id: "K-2210-G-0",
        url: kohlerUrl("K-2210-G-0"),
        material: "porcelainGloss",
        height: 0.615,
        depth: 1.342,
        centerZ: 0.92,
        hole: { rx: 0.69, rz: 0.56 },
        faucetLine: 0.22,
      },
      // Drop-in: its rim rests on the countertop instead of hanging under it.
      {
        id: "K-7806-0",
        url: kohlerUrl("K-7806-0"),
        material: "porcelainGloss",
        dropIn: true,
        height: 0.509,
        depth: 1.445,
        centerZ: 0.86,
        hole: { rx: 0.62, rz: 0.62 },
        faucetLine: 0.1,
      },
      {
        id: "442007-U-0",
        url: sterlingUrl("442007-U-0"),
        material: "porcelainGloss",
        height: 0.59,
        depth: 1.2,
        centerZ: 0.85,
        hole: { rx: 0.73, rz: 0.49 },
        faucetLine: 0.2,
      },
      {
        id: "442040-0",
        url: sterlingUrl("442040-0"),
        material: "porcelainGloss",
        height: 0.69,
        depth: 1.28,
        centerZ: 0.89,
        hole: { rx: 0.68, rz: 0.53 },
        faucetLine: 0.2,
      },
      {
        id: "S1201-0",
        url: sterlingUrl("S1201-0"),
        material: "stainless",
        dropIn: true,
        height: 0.44,
        depth: 0.99,
        centerZ: 0.7,
        hole: { rx: 0.6, rz: 0.4 },
        faucetLine: 0.12,
      },
      // Vanity tops with the bowl cast in: they ARE the countertop, and the
      // cabinet under them is stretched to their size.
      { id: "K-3048-1-0", holes: "single", top: { width: 2.134, depth: 1.853, height: 0.544 }, faucetLine: 0.2 },
      { id: "K-3049-1-0", holes: "single", top: { width: 2.636, depth: 1.853, height: 0.506 }, faucetLine: 0.25 },
      { id: "K-3051-1-0", holes: "single", top: { width: 3.134, depth: 1.859, height: 0.541 }, faucetLine: 0.25 },
      { id: "K-3052-1-0", holes: "single", top: { width: 3.633, depth: 1.853, height: 0.544 }, faucetLine: 0.2 },
      { id: "K-3053-1-0", holes: "single", top: { width: 4.132, depth: 1.859, height: 0.555 }, faucetLine: 0.25 },
      // A stone top cut for an undermount bowl: shown with the Caxton bowl
      // (K-2210-G-0) under its round cutout.
      {
        id: "K-14031-BU-96",
        holes: "single",
        material: "countertop",
        top: { width: 2.583, depth: 1.822, height: 0.063, slab: true },
        faucetLine: 0.2,
        extras: [
          {
            url: kohlerUrl("K-2210-G-0"),
            material: "porcelainGloss",
            place: function () {
              return [0, 2.5 - 0.615, 0.92 - 1.342 / 2];
            },
          },
        ],
      },
    ],
  },
  {
    id: "vanityFaucet",
    fixtureKey: "Vanity_Quantity",
    options: sinkFaucetOptions(
      function (sel) {
        var top = sel.vanity.complete ? sel.vanity : sel.vanitySink;
        return { y: top.deckY, line: top.faucetLine };
      },
      function (sel) {
        return sel.vanity.complete ? sel.vanity : sel.vanitySink;
      },
    ),
  },
  {
    id: "sink",
    fixtureKey: "Sink_Quantity",
    body: true,
    // deckY / faucetLine: the faucet deck's height and hole line. lift:
    // raises a wall-hung model (converted floor-standing) to its rim height.
    options: [
      // The wall-hung sink the room already shows (models/fixtures/sink.glb
      // is this Pinoir).
      { id: "K-2035-4-0", url: null, holes: "centerset", deckY: 2.8, faucetLine: 0.24 },
      { id: "K-2032-0", url: kohlerUrl("K-2032-0"), holes: "centerset", lift: 2.18, deckY: 2.81, faucetLine: 0.38 },
      { id: "K-2362-8-0", url: kohlerUrl("K-2362-8-0"), holes: "widespread", deckY: 2.86, faucetLine: 0.22 },
      { id: "K-5265-4-0", url: kohlerUrl("K-5265-4-0"), holes: "centerset", deckY: 2.94, faucetLine: 0.22 },
      { id: "442124-0", url: sterlingUrl("442124-0"), holes: "centerset", deckY: 2.75, faucetLine: 0.2 },
    ],
  },
  {
    id: "sinkFaucet",
    fixtureKey: "Sink_Quantity",
    options: sinkFaucetOptions(
      function (sel) {
        return { y: sel.sink.deckY, line: sel.sink.faucetLine };
      },
      function (sel) {
        return sel.sink;
      },
    ),
  },
  {
    id: "showerBase",
    fixtureKey: "Shower_Quantity",
    body: true,
    // width/depth: the base's size; curbY: its threshold height, where a
    // door stands. wide: a 60 in. alcove base (sliding doors, 60 in. walls).
    options: [
      // The glass enclosure and pan the room has always shown.
      { id: "glass-enclosure", url: null, width: 3.2, depth: 3.2, curbY: 0.1 },
      {
        id: "K-8459-0",
        url: kohlerUrl("K-8459-0"),
        wide: true,
        width: 5,
        depth: 2.67,
        curbY: 0.27,
        footprint: { wallSpan: 5, depth: 2.7 },
      },
      {
        id: "K-8458-0",
        url: kohlerUrl("K-8458-0"),
        wide: true,
        width: 5,
        depth: 2.67,
        curbY: 0.27,
        footprint: { wallSpan: 5, depth: 2.7 },
      },
      {
        id: "K-9163-0",
        url: kohlerUrl("K-9163-0"),
        wide: true,
        width: 5,
        depth: 2.65,
        curbY: 0.27,
        footprint: { wallSpan: 5, depth: 2.7 },
      },
      {
        id: "K-9396-0",
        url: kohlerUrl("K-9396-0"),
        width: 3,
        depth: 3,
        curbY: 0.23,
        footprint: { wallSpan: 3.05, depth: 3.05 },
      },
      {
        id: "K-8644-0",
        url: kohlerUrl("K-8644-0"),
        width: 3,
        depth: 2.83,
        curbY: 0.23,
        footprint: { wallSpan: 3.05, depth: 2.9 },
      },
      sterlingShowerBase("72181110-0", { wide: true, depth: 2.67, curbY: 0.3 }),
      sterlingShowerBase("72181120-0", { wide: true, depth: 2.67, curbY: 0.3 }),
      sterlingShowerBase("72171110-0", { wide: true, depth: 2.5, curbY: 0.32 }),
      sterlingShowerBase("72171120-0", { wide: true, depth: 2.5, curbY: 0.32 }),
      sterlingShowerBase("72131100-0", { wide: true, depth: 2.83, curbY: 0.4 }),
      sterlingShowerBase("72101100-0", { depth: 2.83, curbY: 0.33 }),
      // Shower kits: base and walls in one.
      sterlingShowerBase("72180116-0", { wide: true, depth: 2.77, curbY: 0.3, hasWalls: true }),
      sterlingShowerBase("72180126-0", { wide: true, depth: 2.77, curbY: 0.3, hasWalls: true }),
      sterlingShowerBase("72240100-0", { depth: 3.1, curbY: 0.3, hasWalls: true }),
    ],
  },
  {
    id: "showerWalls",
    fixtureKey: "Shower_Quantity",
    // Part of the shower's body (see showerBodyTemplate), only with a
    // Kohler base: the Choreograph kit made for that base's size.
    body: true,
    showIf: function (sel) {
      return !!sel.showerBase.url && !sel.showerBase.hasWalls;
    },
    options: [
      {
        id: "choreograph-72",
        available: isWideBase,
        kit: function () {
          return kohlerUrl("K-97618-0");
        },
      },
      {
        id: "choreograph-96",
        // 96 in. tall: needs at least an 8 ft ceiling.
        available: function () {
          return Layout.computeRoomDimensions(state.dims).heightFt >= 8;
        },
        unavailableReason: "room3d.ceilingTooLow",
        kit: function (base) {
          return kohlerUrl(base.wide ? "K-97615-0" : "K-97611-0");
        },
        // The 96 in. kits' inside corners get the matching corner joints.
        corners: kohlerUrl("K-97635-0"),
      },
    ],
  },
  {
    id: "showerDoor",
    fixtureKey: "Shower_Door_Quantity",
    body: true,
    options: [
      {
        id: "standard-door",
        url: null,
        available: function (sel) {
          return !sel.showerBase.url;
        },
      },
      { id: "K-R706851-8L-BL", url: kohlerUrl("K-R706851-8L-BL"), material: "glass", available: isWideBase },
      { id: "K-707615-8L-BL", url: kohlerUrl("K-707615-8L-BL"), material: "glass", available: isWideBase },
      { id: "K-706015-L-BL", url: kohlerUrl("K-706015-L-BL"), material: "glass", available: isWideBase },
      { id: "K-27582-10L-BL", url: kohlerUrl("K-27582-10L-BL"), material: "glass", available: isNarrowShower },
      { id: "K-27583-10L-BL", url: kohlerUrl("K-27583-10L-BL"), material: "glass", available: isNarrowShower },
      { id: "5976-59S", url: sterlingUrl("5976-59S"), material: "glass", available: isWideBase },
      { id: "581075-59N-G05", url: sterlingUrl("581075-59N-G05"), material: "glass", available: isWideBase },
    ],
  },
  {
    id: "showerValve",
    fixtureKey: "Shower_Quantity",
    // Centered at a standard 48 in. valve height, just in front of the
    // enclosure's back panel.
    options: ["K-T73117-4-CP", "K-T78027-9-CP", "K-T72770-4-CP"].map(function (id) {
      return {
        id: id,
        url: kohlerUrl(id),
        material: "chrome",
        wallCenterY: 4,
        place: function (sel, opt, size) {
          return [0, opt.wallCenterY - size.y / 2, 0.06];
        },
      };
    }),
  },
  {
    id: "showerHead",
    fixtureKey: "Shower_Quantity",
    // Each head hangs from its arm's tip (arm tip: z out from the wall,
    // y below the flange's top). Replaces the stand-in's own head.
    options: [
      showerHeadOption("K-965-AK-CP", "K-933-CP", { z: 0.67, drop: 0.37 }),
      showerHeadOption("K-24805-CP", "K-933-CP", { z: 0.67, drop: 0.37 }),
      // The Occasion rainhead is modeled tipped 45 degrees; leveled here.
      showerHeadOption("K-27051-CP", "K-26322-CP", { z: 1.12, drop: 0.3 }, [Math.PI / 4, 0, 0]),
      {
        id: "K-22166-CP",
        url: kohlerUrl("K-22166-CP"),
        material: "chrome",
        place: onWall(0.9, 4.4),
      },
    ],
  },
  {
    id: "showerGrabBar",
    fixtureKey: "Shower_Quantity",
    // Only bars that fit between the side walls.
    options: grabBarOptions(
      function (sel, opt, size) {
        return [0, 2.9 - size.y / 2, 0.06];
      },
      function (sel, length) {
        return length <= sel.showerBase.width - 0.2;
      },
    ),
  },
  {
    id: "showerShelf",
    fixtureKey: "Shower_Shelf_Quantity",
    body: true,
    options: [
      { id: "standard-shelf", url: null },
      { id: "K-97621", url: kohlerUrl("K-97621"), material: "porcelain" },
      { id: "K-97622", url: kohlerUrl("K-97622"), material: "porcelain" },
      { id: "K-97623", url: kohlerUrl("K-97623"), material: "porcelain" },
      { id: "K-14440-CP", url: kohlerUrl("K-14440-CP"), material: "glass" },
      // Floor-to-ceiling storage column.
      { id: "K-97630", url: kohlerUrl("K-97630"), material: "porcelain", floorStanding: true },
    ],
  },
  {
    id: "mirror",
    fixtureKey: "Mirror_Quantity",
    body: true,
    options: [
      { id: "standard-mirror", url: null },
      { id: "K-31364-BLL", url: kohlerUrl("K-31364-BLL"), material: "chrome" },
      { id: "K-31367-BLL", url: kohlerUrl("K-31367-BLL"), material: "chrome" },
      { id: "K-31368", url: kohlerUrl("K-31368"), material: "chrome" },
      medicineCabinet("K-3073-NA", true),
      medicineCabinet("K-99000-NA", true),
      medicineCabinet("K-99002-NA", true),
      medicineCabinet("K-99003-SCF-NA", true),
      medicineCabinet("K-99007-NA", true),
      medicineCabinet("K-81144-DA1", false),
      medicineCabinet("K-81146-DA1", false),
    ],
  },
  {
    id: "mirrorLarge",
    fixtureKey: "Mirror_Huge_Quantity",
    body: true,
    options: [
      { id: "standard-mirror", url: null },
      { id: "K-31365-BLL", url: kohlerUrl("K-31365-BLL"), material: "chrome" },
      { id: "K-31369-BLL", url: kohlerUrl("K-31369-BLL"), material: "chrome" },
      { id: "K-99573-TL-NA", url: kohlerUrl("K-99573-TL-NA"), material: "chrome", needsWiring: true },
      medicineCabinet("K-99008-NA", true),
      medicineCabinet("K-99010-NA", true),
    ],
  },
  {
    id: "robeHook",
    fixtureKey: "Door_Quantity",
    // On the entry door's room-side face, at about 66 in.; an open archway
    // has no door to hang it on.
    skip: function (p) {
      return p.hasDoor === false;
    },
    options: accessoryOptions(ROBE_HOOKS, "chrome", function (sel, opt, size) {
      return [-0.7, 5.5 - size.y / 2, 0.075];
    }),
  },
  {
    id: "vanityLight",
    // Not a placed fixture: drawn at each light point the Electrical step
    // put over a mirror (see rebuildElectrical()).
    fixtureKey: "Light_Point",
    body: true,
    options: [{ id: "standard-light", url: null }].concat(
      VANITY_LIGHTS.map(function (light) {
        return { id: light[0], url: kohlerUrl(light[0]), parts: { metal: light[1], glass: "shadeGlass" } };
      }),
    ),
  },
];

function showerHeadOption(headId, armId, tip, rotation) {
  return {
    id: headId,
    url: kohlerUrl(headId),
    material: "chrome",
    rotation: rotation,
    anchor: "topCenter",
    place: function () {
      return [0, SHOWER_ARM_TOP_FT - tip.drop + 0.03, tip.z];
    },
    extras: [
      {
        url: kohlerUrl(armId),
        material: "chrome",
        place: function (sel, opt, size) {
          return [0, SHOWER_ARM_TOP_FT - size.y, 0];
        },
      },
    ],
  };
}

// Tub parts that need more than one number to place.
productOption(productSlot("tubFaucet"), "K-T97328-4-CP").rotation = [0, Math.PI, 0];
productOption(productSlot("tubFaucet"), "K-T73087-4-CP").rotation = [0, Math.PI, 0];
["K-T97328-4-CP", "K-T73087-4-CP"].forEach(function (id) {
  var filler = productOption(productSlot("tubFaucet"), id);
  filler.place = function (sel) {
    // The half turn maps the riser's (x, z) to (-x, -z): land it 4 in.
    // in front of the tub's front edge.
    return [filler.base[0], 0, tubDepth(sel.tub) + 0.35 + filler.base[1]];
  };
});

// Sink bowls and vanity tops have no place() of their own: they all hang
// off the 2.5 ft countertop line, laid out here in one spot.
productSlot("vanitySink").options.forEach(function (sink) {
  if (sink.top) {
    sink.url = kohlerUrl(sink.id);
    sink.material = sink.material || "porcelainGloss";
    // A slab is set on the cabinet; a cast-iron top's bowl hangs below its
    // surface, which is level with the other countertops.
    sink.deckY = sink.top.slab ? 2.5 + sink.top.height : 2.6;
    sink.footprint = { wallSpan: sink.top.width + 0.05, depth: sink.top.depth + 0.05 };
    sink.place = function () {
      return [0, sink.deckY - sink.top.height, 0];
    };
    return;
  }
  sink.deckY = 2.6;
  sink.place = function () {
    // Undermount: rim tucked just under the countertop's cutout. Drop-in:
    // rim resting just on top of it.
    var rimY = sink.dropIn ? 2.62 : 2.5;
    return [0, rimY - sink.height, sink.centerZ - sink.depth / 2];
  };
});

function defaultProductPicks() {
  var picks = {};
  PRODUCT_SLOTS.forEach(function (slot) {
    picks[slot.id] = slot.options[0].id;
  });
  return picks;
}

function productSlot(slotId) {
  for (var i = 0; i < PRODUCT_SLOTS.length; i++) if (PRODUCT_SLOTS[i].id === slotId) return PRODUCT_SLOTS[i];
  return null;
}

function productOption(slot, optionId) {
  for (var i = 0; i < slot.options.length; i++) if (slot.options[i].id === optionId) return slot.options[i];
  return null;
}

// slotId -> the option showing: the pick, unless it doesn't go with an
// earlier slot's (the slot's first option that does, then). Slots are in
// dependency order, so a door sees the base already resolved.
function selectedProducts(picks) {
  picks = picks || state.productPicks;
  var sel = {};
  PRODUCT_SLOTS.forEach(function (slot) {
    var opt = productOption(slot, picks[slot.id]) || slot.options[0];
    if (opt.available && !opt.available(sel)) {
      opt =
        slot.options.filter(function (o) {
          return !o.available || o.available(sel);
        })[0] || opt;
    }
    sel[slot.id] = opt;
  });
  return sel;
}

// Footprint overrides for Layout.computeLayout(): only a pick that
// declares its own size changes anything. picks defaults to
// state.productPicks.
function productFootprints(picks) {
  var sel = selectedProducts(picks);
  var out = {};
  PRODUCT_SLOTS.forEach(function (slot) {
    var opt = sel[slot.id];
    if (slot.showIf && !slot.showIf(sel)) return;
    if (opt && opt.footprint) out[slot.fixtureKey] = opt.footprint;
  });
  return out;
}

// Footprints for the studio's placements: the picked products' real sizes
// over the defaults, keeping each type's mount (the paper holder and
// accessories look for floor fixtures beside them).
function planFootprints(picks) {
  var out = {};
  var sized = productFootprints(picks);
  Object.keys(Layout.FIXTURE_LAYOUT).forEach(function (key) {
    out[key] = Object.assign({}, Layout.FIXTURE_LAYOUT[key], sized[key] || {});
  });
  // A vanity top is the countertop: the cabinet under it is stretched to
  // its size (see buildUndermountVanity()).
  var sel = selectedProducts(picks);
  if (!sel.vanity.complete && sel.vanitySink.top) {
    out.Vanity_Quantity.wallSpan = sel.vanitySink.top.width;
    out.Vanity_Quantity.depth = Math.max(sel.vanitySink.top.depth, out.Vanity_Quantity.depth);
  }
  return out;
}

// The size of each kind of fixture in js/room-plan.js's terms ({ type:
// { span, depth, height } }), for the products picked (or `picks`).
var PLAN_TYPE_KEYS = {
  toilet: "Toilet_Quantity",
  vanity: "Vanity_Quantity",
  sink: "Sink_Quantity",
  tub: "Bathtub_Quantity",
  shower: "Shower_Quantity",
  cabinet: "Cabinet_Quantity",
  door: "Door_Quantity",
};

function planSizes(picks) {
  var fps = planFootprints(picks);
  var out = {};
  Object.keys(PLAN_TYPE_KEYS).forEach(function (type) {
    var fp = fps[PLAN_TYPE_KEYS[type]];
    out[type] = { span: fp.wallSpan, depth: fp.depth, height: fp.height };
  });
  return out;
}

var productModelLoader = null;

// Fetched lazily — only the picked option of a slot whose fixture is
// actually placed — and cached for the life of the scene, so flipping back
// to an option is instant. s.productModels[url] is the loaded template
// (with its bounding-box size in userData.size), or false while in flight.
// A model that fails is tried twice more, after MODEL_RETRY_MS. If it still
// fails it's marked null (the stand-in shows, and the room says so), and
// the next change to the room after MODEL_RETRY_AFTER_FAIL_MS tries again.
var MODEL_RETRY_MS = [1500, 4000];
var MODEL_RETRY_AFTER_FAIL_MS = 15000;

function modelLoadFailed(s, key, retry) {
  var tries = (s.modelTries[key] || 0) + 1;
  s.modelTries[key] = tries;
  if (tries <= MODEL_RETRY_MS.length) {
    setTimeout(
      function () {
        retry();
        markDirty();
      },
      MODEL_RETRY_MS[tries - 1],
    );
    return false;
  }
  s.modelTries[key] = 0;
  s.modelFailedAt[key] = Date.now();
  return true;
}

function ensureProductModel(s, opt) {
  var entry = s.productModels[opt.url];
  if (entry !== undefined) {
    if (entry !== null || Date.now() - s.modelFailedAt[opt.url] < MODEL_RETRY_AFTER_FAIL_MS) return;
  }
  s.productModels[opt.url] = false;
  if (!productModelLoader) productModelLoader = new GLTFLoader();
  productModelLoader.load(
    siteUrl(opt.url),
    function (gltf) {
      var model = gltf.scene;
      var materialKey = opt.material || "porcelainGloss";
      var material = s.mat[materialKey];
      model.traverse(function (child) {
        if (!child.isMesh || opt.keepMaterials) return;
        var partKey = opt.parts && opt.parts[child.name];
        if (partKey) {
          child.material = s.mat[partKey];
          return;
        }
        child.material = material;
        // Porcelain bodies stay retintable by setFixtureFinish(); chrome
        // and steel trim keep their finish.
        if (!opt.material) child.userData.finishBase = materialKey;
      });
      model.userData.size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
      s.productModels[opt.url] = model;
      markDirty();
    },
    undefined,
    function (err) {
      var retry = function () {
        delete s.productModels[opt.url];
      };
      if (!modelLoadFailed(s, opt.url, retry)) return;
      console.warn("3D preview: couldn't load " + opt.url + ", showing the stand-in.", err);
      s.productModels[opt.url] = null;
      markDirty();
    },
  );
}

// Every model an option places: its own plus any extras.
function optionModels(opt) {
  return opt.url ? [opt].concat(opt.extras || []) : [];
}

// Starts any of these models' fetches; true once all of them are loaded.
function productModelsReady(s, models) {
  var ready = true;
  models.forEach(function (m) {
    ensureProductModel(s, m);
    if (!s.productModels[m.url]) ready = false;
  });
  return ready;
}

// Builds (once per key) and caches a body template.
function cachedBodyTemplate(s, key, build) {
  if (!s.bodyTemplates[key]) s.bodyTemplates[key] = build();
  return s.bodyTemplates[key];
}

// A loaded model wrapped in a group so it can sit offset from the
// fixture's origin.
function offsetModel(model, x, y, z) {
  var g = new THREE.Group();
  g.userData.sharedModel = true; // disposeGroup leaves the clone's geometry alone
  var m = model.clone(true);
  m.position.set(x, y, z);
  g.add(m);
  return g;
}

// Whether fixtureKey's body comes from a product slot pick (so parts on it
// wait for that body to load): always for the tub and vanity, and for the
// others once a Kohler model is picked over the stand-in.
function productOwnsBody(fixtureKey, sel) {
  if (fixtureKey === "Bathtub_Quantity" || fixtureKey === "Vanity_Quantity") return true;
  if (fixtureKey === "Toilet_Quantity") return !!sel.toilet.url;
  if (fixtureKey === "Sink_Quantity") return !!sel.sink.url;
  if (fixtureKey === "Shower_Quantity") return !!sel.showerBase.url;
  return false;
}

// The fixture template to clone for fixtureKey, when a product slot owns
// its body: the picked tub, toilet, sink, shower base, door, shelf or
// mirror model, or a vanity cut out for the picked bowl. null = no slot
// owns it, its pick is the stand-in, or its model hasn't arrived yet — so
// the caller keeps whatever it would otherwise use.
function productBodyTemplate(s, fixtureKey, sel) {
  if (fixtureKey === "Bathtub_Quantity") {
    ensureProductModel(s, sel.tub);
    var tub = s.productModels[sel.tub.url];
    if (!tub || !sel.tub.dropIn) return tub || null;
    if (!s.tubTemplates[sel.tub.id]) {
      var g = new THREE.Group();
      g.add(tub.clone(true), buildTubDeck(s.mat, tub.userData.size, sel.tub));
      s.tubTemplates[sel.tub.id] = g;
    }
    return s.tubTemplates[sel.tub.id];
  }
  if (fixtureKey === "Vanity_Quantity") {
    if (sel.vanity.url) return productModelsReady(s, [sel.vanity]) ? s.productModels[sel.vanity.url] : null;
    if (!productModelsReady(s, optionModels(sel.vanitySink))) return null;
    var key = sel.vanitySink.id;
    if (!s.vanityTemplates[key]) s.vanityTemplates[key] = buildUndermountVanity(s.geo, s.mat, sel.vanitySink);
    return s.vanityTemplates[key];
  }
  if (fixtureKey === "Toilet_Quantity") {
    if (!sel.toilet.url || !productModelsReady(s, [sel.toilet])) return null;
    return s.productModels[sel.toilet.url];
  }
  if (fixtureKey === "Sink_Quantity") {
    var sink = sel.sink;
    if (!sink.url || !productModelsReady(s, [sink])) return null;
    return cachedBodyTemplate(s, "sink|" + sink.id, function () {
      return offsetModel(s.productModels[sink.url], 0, sink.lift || 0, 0);
    });
  }
  if (fixtureKey === "Shower_Quantity") return showerBodyTemplate(s, sel);
  if (fixtureKey === "Shower_Door_Quantity") {
    var door = sel.showerDoor;
    if (!door.url || !productModelsReady(s, [door])) return null;
    // The door instance sits at the shower's open edge; the panel stands
    // on the base's threshold, centered on that line.
    return cachedBodyTemplate(s, "door|" + door.id + "|" + sel.showerBase.id, function () {
      var model = s.productModels[door.url];
      return offsetModel(model, 0, sel.showerBase.curbY, -model.userData.size.z / 2);
    });
  }
  if (fixtureKey === "Shower_Shelf_Quantity") {
    var shelf = sel.showerShelf;
    if (!shelf.url || !productModelsReady(s, [shelf])) return null;
    // The shelf instance is centered on the shower's back wall at the
    // layout's 48 in. mount height. Kohler shelves go higher and off to one
    // side, clear of the valve; the storage column stands on the floor.
    return cachedBodyTemplate(s, "shelf|" + shelf.id + "|" + sel.showerBase.id, function () {
      var model = s.productModels[shelf.url];
      var size = model.userData.size;
      var mountY = Layout.FIXTURE_LAYOUT.Shower_Shelf_Quantity.mountHeight;
      var x = Math.max(0, sel.showerBase.width / 2 - 0.4 - size.x / 2);
      var y = shelf.floorStanding ? -mountY : 0.9 - size.y / 2;
      return offsetModel(model, x, y, 0.02);
    });
  }
  if (fixtureKey === "Mirror_Quantity" || fixtureKey === "Mirror_Huge_Quantity") {
    var mirror = fixtureKey === "Mirror_Quantity" ? sel.mirror : sel.mirrorLarge;
    var bottom = mirrorBottom(sel);
    if (!mirror.url) {
      // The plain mirror goes up over a whole vanity too.
      if (bottom === MIRROR_BOTTOM_FT || !s.fixtureTemplates[fixtureKey]) return null;
      return cachedBodyTemplate(s, "mirror|" + fixtureKey + "|" + bottom, function () {
        return offsetModel(s.fixtureTemplates[fixtureKey], 0, bottom - MIRROR_BOTTOM_FT, 0);
      });
    }
    if (!productModelsReady(s, [mirror])) return null;
    // Wall-mounted instances sit at the layout's mountHeight; the Kohler
    // mirror hangs its bottom edge at MIRROR_BOTTOM_FT instead, on the
    // wall's face (its back at z = 0), not sunk into it.
    return cachedBodyTemplate(s, "mirror|" + mirror.id + "|" + bottom, function () {
      var mountY = Layout.FIXTURE_LAYOUT[fixtureKey].mountHeight;
      var model = s.productModels[mirror.url];
      // A recessed cabinet's door stands 3/4 in. proud of the wall.
      var z = mirror.recessed ? 0.06 - model.userData.size.z : 0.005;
      return offsetModel(model, 0, bottom - mountY, z);
    });
  }
  return null;
}

// A Kohler shower: the picked base, and around it the Choreograph wall kit
// made for that base's size (plus corner joints on the 96 in. kits).
function showerBodyTemplate(s, sel) {
  var base = sel.showerBase;
  if (!base.url) return null;
  if (base.hasWalls) {
    if (!productModelsReady(s, [base])) return null;
    return s.productModels[base.url];
  }
  var walls = sel.showerWalls;
  var kit = { url: walls.kit(base), material: "porcelain" };
  var corners = walls.corners ? { url: walls.corners, material: "porcelain" } : null;
  var models = [base, kit].concat(corners ? [corners] : []);
  if (!productModelsReady(s, models)) return null;
  return cachedBodyTemplate(s, "shower|" + base.id + "|" + kit.url, function () {
    var g = new THREE.Group();
    g.add(s.productModels[base.url].clone(true));
    var kitModel = s.productModels[kit.url].clone(true);
    g.add(kitModel);
    if (corners) {
      var halfW = s.productModels[kit.url].userData.size.x / 2 - 0.04;
      [-halfW, halfW].forEach(function (x) {
        var joint = s.productModels[corners.url].clone(true);
        joint.position.set(x, 0, 0.02);
        g.add(joint);
      });
    }
    return g;
  });
}

// Adds every non-body slot's picked model(s) onto one placed instance.
// Parts on a fixture whose body comes from a slot wait for that body, since
// their positions are measured against it. ctx: { heightFt } of the room.
function addProductParts(s, instance, placement, sel, bodyReady, ctx) {
  var fixtureKey = placement.fixtureKey;
  PRODUCT_SLOTS.forEach(function (slot) {
    if (slot.fixtureKey !== fixtureKey || slot.body) return;
    if (slot.skip && slot.skip(placement)) return;
    var opt = sel[slot.id];
    var models = optionModels(opt);
    if (!models.length || !productModelsReady(s, models) || !bodyReady) return;
    if (opt.pickSpot) ctx.paperHolder = paperHolderSpot(ctx, placement, s.productModels[opt.url].userData.size);
    models.forEach(function (m) {
      var model = s.productModels[m.url];
      var part = model.clone(true);
      var rotation = m.rotationFor ? m.rotationFor(ctx) : m.rotation;
      if (rotation) part.rotation.set(rotation[0], rotation[1], rotation[2]);
      var p = m.place(sel, opt, model.userData.size, ctx);
      part.position.set(p[0], p[1], p[2]);
      if (m.anchor === "topCenter") {
        // Rotated first, so line up by where it actually ends up.
        part.updateMatrixWorld(true);
        var box = new THREE.Box3().setFromObject(part);
        part.position.x += p[0] - (box.min.x + box.max.x) / 2;
        part.position.y += p[1] - box.max.y;
        part.position.z += p[2] - (box.min.z + box.max.z) / 2;
      }
      instance.add(part);
    });
    // A real showerhead replaces the stand-in enclosure's own.
    if (slot.id === "showerHead") {
      instance.traverse(function (child) {
        if (child.userData.standardShowerHead) child.visible = false;
      });
    }
  });
}

// The switcher's fixture tabs: one per placed fixture, each showing only
// that fixture's dropdowns, so the rows never crowd out the room itself.
var PRODUCT_GROUPS = [
  { id: "toilet", fixtureKeys: ["Toilet_Quantity"] },
  { id: "tub", fixtureKeys: ["Bathtub_Quantity"] },
  { id: "vanity", fixtureKeys: ["Vanity_Quantity"] },
  { id: "sink", fixtureKeys: ["Sink_Quantity"] },
  { id: "shower", fixtureKeys: ["Shower_Quantity", "Shower_Door_Quantity", "Shower_Shelf_Quantity"] },
  { id: "mirror", fixtureKeys: ["Mirror_Quantity", "Mirror_Huge_Quantity"] },
  { id: "door", fixtureKeys: ["Door_Quantity"] },
  { id: "lighting", fixtureKeys: ["Light_Point"] },
];

function productGroupOf(slot) {
  for (var i = 0; i < PRODUCT_GROUPS.length; i++) {
    if (PRODUCT_GROUPS[i].fixtureKeys.indexOf(slot.fixtureKey) !== -1) return PRODUCT_GROUPS[i].id;
  }
  return null;
}

function slotShown(slot, placedKeys, sel) {
  return !!placedKeys[slot.fixtureKey] && (!slot.showIf || slot.showIf(sel));
}

// Each of a slot's options with its label and, when it can't be picked
// right now, why: it doesn't go with another pick, or (for a slot that's
// showing) it's too big for where its fixture stands.
function slotOptionStates(slot, sel, shown) {
  return slot.options.map(function (opt) {
    var reason = null;
    if (opt.available && !opt.available(sel)) reason = T(opt.unavailableReason || "room3d.noFit");
    else if (shown && sel[slot.id] !== opt && productWouldDrop(slot, opt)) reason = T("room3d.tooBig");
    return { id: opt.id, label: T("room3d.option." + opt.id), reason: reason };
  });
}

// ---------------------------------------------------------------------
// Product picks for the estimate
// ---------------------------------------------------------------------
// The studio's Products step lists each placed fixture's choices, and the
// estimate names whatever is showing by Kohler model number.

function mmnFromUrl(url) {
  var m = /\/products\/(?:kohler|sterling|broan)\/([A-Z0-9-]+)\.glb$/.exec(url || "");
  return m ? m[1] : null;
}

// The Kohler model numbers an option puts in the room: its model and any
// extras (a showerhead's arm, a spout's handles, the bowl under a top),
// or for the walls, the kit (and corner joints) made for the base showing.
// A stand-in or "none" has none.
function optionMmns(slot, opt, sel) {
  var urls;
  if (slot.id === "showerWalls") {
    if (!sel.showerBase.url || sel.showerBase.hasWalls) return [];
    urls = [opt.kit(sel.showerBase)].concat(opt.corners ? [opt.corners] : []);
  } else {
    urls = optionModels(opt).map(function (m) {
      return m.url;
    });
  }
  var out = urls.map(mmnFromUrl).filter(Boolean);
  if (opt.mmn) out.unshift(opt.mmn);
  // The Pinoir sink is the room's own default model file.
  if (!out.length && !opt.url && /^K-/.test(opt.id)) out.push(opt.id);
  return out;
}

// The fixtures in the room as the plan stands right now (not the last ones
// drawn, which may lag a frame behind a change).
function currentLayout() {
  var placements = state.plan || [];
  var placedKeys = {};
  placements.forEach(function (p) {
    placedKeys[p.fixtureKey] = true;
  });
  return { layout: { placements: placements }, placedKeys: addElectricalKeys(placedKeys) };
}

function productGroupDef(groupId) {
  for (var i = 0; i < PRODUCT_GROUPS.length; i++) if (PRODUCT_GROUPS[i].id === groupId) return PRODUCT_GROUPS[i];
  return null;
}

// Frames every placed instance of a tab's fixtures, from in front of them.
function focusCameraOn(s, group) {
  var box = new THREE.Box3();
  var facing = null;
  s.fixtureGroup.children.forEach(function (inst) {
    if (group.fixtureKeys.indexOf(inst.userData.fixtureKey) === -1) return;
    box.expandByObject(inst);
    if (facing === null) facing = inst.rotation.y;
  });
  if (box.isEmpty()) return false;
  var center = box.getCenter(new THREE.Vector3());
  var size = box.getSize(new THREE.Vector3());
  var dir = new THREE.Vector3(Math.sin(facing), 0.55, Math.cos(facing)).normalize();
  var distance = Math.max(size.x, size.y, size.z) * 1.6 + 3;
  var dims = Layout.computeRoomDimensions(state.dims);
  var diag = Math.sqrt(dims.widthFt * dims.widthFt + dims.lengthFt * dims.lengthFt);
  s.controls.minDistance = Math.min(distance, 2);
  s.controls.maxDistance = Math.max(distance, clamp(diag * 1.9, 12, 160));
  s.cameraLerp = {
    from: s.camera.position.clone(),
    to: center.clone().addScaledVector(dir, distance),
    targetFrom: s.controls.target.clone(),
    targetTo: center,
    start: performance.now(),
    durationMs: 700,
  };
  needsRender = true;
  return true;
}

// Whether picking opt for slot would make the design stop fitting: a
// longer tub than its wall has room for, say. The studio decides
// (setFitCheck()); only a pick that changes a fixture's size can.
var planFitCheck = null;

function productWouldDrop(slot, opt) {
  if (!planFitCheck) return false;
  var picks = Object.assign({}, state.productPicks);
  picks[slot.id] = opt.id;
  var next = planSizes(picks);
  if (JSON.stringify(next) === JSON.stringify(planSizes())) return false;
  return !planFitCheck(next);
}

// The deck a drop-in tub is set into: stone side panels from the floor up
// to just under the rim, and a top with a cutout a little inside the rim's
// outer edge — so the rim rests on it and the bare underside of the shell
// is hidden, as it would be installed. Sized from the tub model itself.
function buildTubDeck(mat, size, tub) {
  var w = size.x;
  var d = size.z;
  var topY = tub.rimY - 0.06;
  var g = new THREE.Group();
  var t = 0.05;
  var front = new THREE.Mesh(new THREE.BoxGeometry(w, topY, t), mat.countertop);
  front.position.set(0, topY / 2, d - t / 2);
  var left = new THREE.Mesh(new THREE.BoxGeometry(t, topY, d - t), mat.countertop);
  left.position.set(-w / 2 + t / 2, topY / 2, (d - t) / 2);
  var right = left.clone();
  right.position.x = w / 2 - t / 2;
  // Top plate, drawn in x/y and laid flat like the vanity countertop.
  var shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(w / 2, -d);
  shape.lineTo(-w / 2, -d);
  shape.closePath();
  var inset = 0.15;
  var hole = new THREE.Path();
  if (tub.dropIn === "oval") {
    hole.absellipse(0, -d / 2, w / 2 - inset, d / 2 - inset, 0, Math.PI * 2, true);
  } else {
    var hx = w / 2 - inset;
    var hz = d - inset;
    var r = 0.3;
    hole.moveTo(-hx + r, -inset);
    hole.lineTo(hx - r, -inset);
    hole.quadraticCurveTo(hx, -inset, hx, -inset - r);
    hole.lineTo(hx, -hz + r);
    hole.quadraticCurveTo(hx, -hz, hx - r, -hz);
    hole.lineTo(-hx + r, -hz);
    hole.quadraticCurveTo(-hx, -hz, -hx, -hz + r);
    hole.lineTo(-hx, -inset - r);
    hole.quadraticCurveTo(-hx, -inset, -hx + r, -inset);
  }
  shape.holes.push(hole);
  var top = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false, curveSegments: 32 }),
    mat.countertop,
  );
  top.rotation.x = -Math.PI / 2;
  top.position.y = topY - 0.04;
  g.add(front, left, right, top);
  return g;
}

// The vanity once a real bowl is going in: the same 2.5 x 2.6 x 1.6 ft
// cabinet, but solid only up to just under the bowl, with thin aprons
// around an open top and a stone countertop with a cutout sized to that
// bowl — so looking down you see into the bowl rather than a solid box
// top. A vanity top (sink.top) is its own countertop: the cabinet is
// stretched to sit just inside it instead, with no stone top.
function buildUndermountVanity(geo, mat, sink) {
  var g = new THREE.Group();
  var cabinet = new THREE.Group();
  var body = new THREE.Mesh(geo.vanityLowerBody, mat.cabinetWood);
  body.position.set(0, 1.0, 0.8);
  var front = new THREE.Mesh(geo.vanityApronX, mat.cabinetWood);
  front.position.set(0, 2.25, 1.575);
  var back = front.clone();
  back.position.z = 0.025;
  var left = new THREE.Mesh(geo.vanityApronZ, mat.cabinetWood);
  left.position.set(-1.225, 2.25, 0.8);
  var right = left.clone();
  right.position.x = 1.225;
  cabinet.add(body, front, back, left, right);
  if (sink.top) {
    cabinet.scale.set((sink.top.width - 0.08) / 2.5, 1, (sink.top.depth - 0.06) / 1.6);
    g.add(cabinet);
    return g;
  }
  var top = new THREE.Mesh(vanityCountertopGeometry(sink), mat.countertop);
  top.rotation.x = -Math.PI / 2;
  top.position.set(0, 2.5, 0);
  g.add(cabinet, top);
  return g;
}

function vanityCountertopGeometry(sink) {
  // Drawn in x/y then laid flat (rotation.x = -PI/2 maps y -> -z), so the
  // shape's y runs from 0 at the wall to -1.6 at the front edge.
  var shape = new THREE.Shape();
  shape.moveTo(-1.25, 0);
  shape.lineTo(1.25, 0);
  shape.lineTo(1.25, -1.6);
  shape.lineTo(-1.25, -1.6);
  shape.closePath();
  var hole = new THREE.Path();
  hole.absellipse(0, -sink.centerZ, sink.hole.rx, sink.hole.rz, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  return new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: false, curveSegments: 32 });
}

function buildToiletTemplates(geo, mat) {
  return { A: buildToiletStyleA(geo, mat), B: buildToiletStyleB(geo, mat) };
}

function buildFixtureTemplates(geo, mat) {
  return {
    Sink_Quantity: buildSink(geo, mat),
    Bathtub_Quantity: buildBathtub(geo, mat),
    Shower_Quantity: buildShower(geo, mat),
    Shower_Door_Quantity: buildShowerDoor(geo, mat),
    Door_Quantity: buildEntryDoor(geo, mat),
    Door_Quantity_Archway: buildEntryArchway(geo, mat),
    Vanity_Quantity: buildVanity(geo, mat),
    Cabinet_Quantity: buildCabinet(geo, mat),
    Mirror_Quantity: buildMirror(geo, mat, false),
    Mirror_Huge_Quantity: buildMirror(geo, mat, true),
    Shower_Shelf_Quantity: buildShowerShelf(geo, mat),
  };
}

// ---------------------------------------------------------------------
// Scene state
// ---------------------------------------------------------------------
var state = {
  scope: {},
  dims: { widthFt: null, lengthFt: null, heightFt: null },
  // The stand-in toilet's style: A = skirted two-piece.
  selectedToiletStyle: "A",
  cameraMode: "orbit", // "orbit" | "walkin"
  walkInEntryIndex: 0,
  // fixtureKey -> hex color, see setFixtureFinish().
  fixtureFinishes: {},
  // Surface category (floorTile, wallPaint, ...) -> the picked product's
  // surface spec (js/surface-finishes.js), see setSurfaceFinish().
  surfacePicks: {},
  // PRODUCT_SLOTS id -> picked option id.
  productPicks: defaultProductPicks(),
  // What to draw (js/room-plan.js toPlacements()), see setPlan().
  plan: [],
  // Tile panels on the walls around a tub, see setSurround().
  surround: [],
  // Outlets, switches, lights and the fan (js/room-plan.js
  // toElectricalPlacements()), see setElectrical().
  electrical: [],
  // While one fixture is being worked on, the item ids to show on their
  // own (setIsolate()); null shows the whole room.
  isolate: null,
};
var dirty = true;
// Redrawing every frame at full PBR+shadow cost even while the scene is
// completely static (no typing, camera settled) is wasted GPU/CPU on every
// viewer's device — this flag lets the render loop skip the actual draw
// call whenever nothing has changed since the last one.
var needsRender = true;
var threeState = null; // null = not tried yet, false = tried and failed, object = live scene

function ensureScene() {
  if (threeState !== null) return threeState;
  try {
    var panel = document.getElementById(PANEL_ID);
    var wrap = document.getElementById(CANVAS_WRAP_ID);
    if (!panel || !wrap) {
      threeState = false;
      return threeState;
    }

    var isDark = isDarkTheme();
    var renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    wrap.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.setAttribute("aria-label", T("room3d.canvasLabel"));

    var scene = new THREE.Scene();
    var sky = skyColors(isDark);
    scene.background = new THREE.Color(sky.sky);

    // Image-based lighting from a procedurally generated studio-like room
    // (self-hosted, no external HDR file) — this is what makes the
    // porcelain clearcoat and chrome actually pick up soft reflections
    // instead of looking flat. Generated once; not per-rebuild.
    var pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    var camera = new THREE.PerspectiveCamera(ORBIT_FOV, 1, 0.1, 200);

    var hemi = new THREE.HemisphereLight(sky.sky, sky.ground, 0.7);
    var dir = new THREE.DirectionalLight(0xffffff, 1.8);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.bias = -0.0015;
    dir.shadow.normalBias = 0.02;
    scene.add(hemi, dir, dir.target);

    var controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !reducedMotion();
    controls.dampingFactor = 0.08;
    // Straight down for a plan-like look, never under the floor.
    controls.minPolarAngle = 0.02;
    controls.maxPolarAngle = 1.48;
    controls.screenSpacePanning = true;
    // Fires on every drag and on every damping-settle frame afterward, and
    // stops firing once the camera is genuinely still — exactly the signal
    // the render loop needs to know a frame is worth actually drawing.
    controls.addEventListener("change", function () {
      // Panning stays over the room.
      var dims = Layout.computeRoomDimensions(state.dims);
      var t = controls.target;
      t.set(clamp(t.x, 0, dims.widthFt), clamp(t.y, 0, dims.heightFt), clamp(t.z, 0, dims.lengthFt));
      needsRender = true;
    });

    var geo = buildGeometries();
    var mat = buildMaterials(isDark);
    var fixtureTemplates = buildFixtureTemplates(geo, mat);
    var toiletTemplates = buildToiletTemplates(geo, mat);
    var fixtureGroup = new THREE.Group();
    scene.add(fixtureGroup);

    var shellMaterials = {
      floor: new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }),
      wall: new THREE.MeshStandardMaterial({ side: THREE.BackSide }),
      ceiling: new THREE.MeshStandardMaterial({ side: THREE.BackSide }),
    };
    var shellGroup = new THREE.Group();
    scene.add(shellGroup);

    // Tile around a tub (setSurround()).
    var surroundGroup = new THREE.Group();
    scene.add(surroundGroup);
    var surroundMaterial = new THREE.MeshStandardMaterial();

    // Outlets, switches, lights and the fan (setElectrical()).
    var electricalGroup = new THREE.Group();
    scene.add(electricalGroup);

    // The studio's marks on the floor (setMarks()) and the outlines of the
    // selected fixture and the one under the pointer (setHighlight()),
    // drawn over everything else so they never hide inside a model.
    var markGroup = new THREE.Group();
    scene.add(markGroup);
    var selectBox = new THREE.Box3Helper(new THREE.Box3(), STUDIO_TONES.select);
    var hoverBox = new THREE.Box3Helper(new THREE.Box3(), STUDIO_TONES.info);
    [selectBox, hoverBox].forEach(function (helper) {
      helper.visible = false;
      helper.material.depthTest = false;
      helper.material.transparent = true;
      helper.renderOrder = 20;
      scene.add(helper);
    });
    hoverBox.material.opacity = 0.7;

    // Products whose 3D model couldn't load (see ensureProductModel()).
    var modelNote = document.createElement("p");
    modelNote.className = "room-3d-note";
    modelNote.setAttribute("role", "status");
    modelNote.hidden = true;
    panel.appendChild(modelNote);

    var resizeObserver = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(function () {
        applySize();
      });
      resizeObserver.observe(wrap);
    }

    function applySize() {
      var w = wrap.clientWidth || 1;
      var h = wrap.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      needsRender = true;
    }

    threeState = {
      isDark: isDark,
      renderer: renderer,
      scene: scene,
      camera: camera,
      controls: controls,
      raycaster: new THREE.Raycaster(),
      geo: geo,
      mat: mat,
      fixtureTemplates: fixtureTemplates,
      toiletTemplates: toiletTemplates,
      realModels: {}, // fixtureKey -> true once its real model replaced the stand-in
      modelRequests: {}, // fixtureKey -> true once its model fetch has started
      productModels: {}, // PRODUCT_SLOTS option url -> loaded template, false while loading, null if it failed
      modelTries: {}, // model url or fixtureKey -> failed tries in a row
      modelFailedAt: {}, // model url -> when it last gave up
      vanityTemplates: {}, // vanity sink option id -> buildUndermountVanity() template
      tubTemplates: {}, // drop-in tub option id -> tub model + buildTubDeck()
      bodyTemplates: {}, // productBodyTemplate() cache for the other product bodies
      fixtureGroup: fixtureGroup,
      shellMaterials: shellMaterials,
      shellGroup: shellGroup,
      shellGeometries: [],
      wallMeshesById: {},
      surroundGroup: surroundGroup,
      surroundMaterial: surroundMaterial,
      electricalGroup: electricalGroup,
      markGroup: markGroup,
      selectBox: selectBox,
      hoverBox: hoverBox,
      lastDims: null,
      lastEntryPlacements: [],
      hemi: hemi,
      dirLight: dir,
      modelNote: modelNote,
      applySize: applySize,
      cameraLerp: null, // { from, to, target, start } while animating, else null
      running: false,
    };
    applySize();
    watchTheme(threeState);
    window.BathroomRoom3D.available = true;
  } catch (err) {
    console.warn("3D preview unavailable:", err);
    threeState = false;
  }
  return threeState;
}

// The scene's background and sky light for the page's theme.
function skyColors(isDark) {
  return isDark ? { sky: 0x162038, ground: 0x0b1122 } : { sky: 0xf5f7fb, ground: 0xeef2f8 };
}

// Follows a switch between the light and dark themes while the room is open.
function watchTheme(s) {
  function update() {
    var dark = isDarkTheme();
    if (dark === s.isDark) return;
    s.isDark = dark;
    var sky = skyColors(dark);
    s.scene.background.setHex(sky.sky);
    s.hemi.color.setHex(sky.sky);
    s.hemi.groundColor.setHex(sky.ground);
    rebuildFinishes(s);
    rebuildSurround(s);
    needsRender = true;
  }
  if (typeof MutationObserver !== "undefined") {
    new MutationObserver(update).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  }
  var mq = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
  if (mq && mq.addEventListener) mq.addEventListener("change", update);
}

// ---------------------------------------------------------------------
// Rebuild: shell (only when dimensions actually changed) + finishes +
// fixtures, driven entirely by the pure layout module.
// ---------------------------------------------------------------------
function disposeShellGeometries(s) {
  s.shellGeometries.forEach(function (g) {
    g.dispose();
  });
  s.shellGeometries = [];
  while (s.shellGroup.children.length) {
    s.shellGroup.remove(s.shellGroup.children[0]);
  }
}

function feetUVs(geometry, uFt, vFt) {
  var uv = geometry.attributes.uv;
  for (var i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uFt, uv.getY(i) * vFt);
  uv.needsUpdate = true;
  return geometry;
}

function rebuildShell(s, widthFt, lengthFt, heightFt) {
  disposeShellGeometries(s);

  // UVs are rescaled to feet on the floor and walls, so a picked product's
  // texture (see applySurfaceFinish()) lands at its real size whatever the
  // room's dimensions — one shared repeat per material instead of one per wall.
  var floorGeo = feetUVs(new THREE.PlaneGeometry(widthFt, lengthFt), widthFt, lengthFt);
  var floor = new THREE.Mesh(floorGeo, s.shellMaterials.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(widthFt / 2, 0, lengthFt / 2);
  floor.receiveShadow = true;
  s.shellGroup.add(floor);
  s.shellGeometries.push(floorGeo);

  var ceilingGeo = new THREE.PlaneGeometry(widthFt, lengthFt);
  var ceiling = new THREE.Mesh(ceilingGeo, s.shellMaterials.ceiling);
  ceiling.rotation.x = -Math.PI / 2;
  ceiling.position.set(widthFt / 2, heightFt, lengthFt / 2);
  ceiling.receiveShadow = true;
  s.shellGroup.add(ceiling);
  s.shellGeometries.push(ceilingGeo);

  s.wallMeshesById = {};
  shellWalls(widthFt, lengthFt).forEach(function (w) {
    var wallGeo = feetUVs(new THREE.PlaneGeometry(w.spanFt, heightFt), w.spanFt, heightFt);
    var wall = new THREE.Mesh(wallGeo, s.shellMaterials.wall);
    wall.rotation.y = w.rotY;
    wall.position.set(w.x, heightFt / 2, w.z);
    wall.receiveShadow = true;
    wall.userData.wallId = w.id;
    s.shellGroup.add(wall);
    s.shellGeometries.push(wallGeo);
    s.wallMeshesById[w.id] = wall;
  });
}

// ---------------------------------------------------------------------
// Real-product surface finishes
// ---------------------------------------------------------------------
// A picked floor tile / wall tile / flooring / paint (see
// js/surface-finishes.js for the per-product specs) renders as PBR texture
// maps generated here on a canvas at the product's true unit size: albedo
// (tone-varied tiles or planks, grout, stone/wood/motif character), a
// normal map (grout joints recessed, subtle surface relief) and a
// roughness map (grout rougher than a glazed face). Shell UVs are in feet
// (see rebuildShell()), so repeat = 12 / repeat-unit-inches puts one real
// inch of product on one real inch of room. Generated once per product
// and cached; a spec with real `maps` files loads those instead.
var Surfaces = window.SurfaceFinishes;
var SURFACE_TEXTURE_MAX_PX = 1024;
// Aim for a repeat unit about this big so tile-to-tile tone variation
// doesn't visibly repeat every tile or two.
var SURFACE_UNIT_TARGET_IN = 36;
var surfaceTextureCache = {}; // spec.id -> { map, normalMap, roughnessMap }

// Deterministic per-product PRNG (mulberry32 over a string hash), so a
// product's generated texture is the same on every load.
function seededRandom(seedText) {
  var h = 2166136261;
  for (var i = 0; i < seedText.length; i++) {
    h ^= seedText.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return function () {
    h = (h + 0x6d2b79f5) | 0;
    var t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// "#rrggbb" scaled by (1 + f), still as "#rrggbb" (canvas takes it as-is).
function shadeHex(hex, f) {
  var n = parseInt(hex.slice(1), 16);
  var out = "#";
  [16, 8, 0].forEach(function (shift) {
    var c = clamp(Math.round(((n >> shift) & 255) * (1 + f)), 0, 255);
    out += ("0" + c.toString(16)).slice(-2);
  });
  return out;
}

function grayCss(v01) {
  var v = clamp(Math.round(v01 * 255), 0, 255);
  return "rgb(" + v + "," + v + "," + v + ")";
}

// Long side of the tile/plank runs along U (horizontally on walls, along
// the room's width on the floor), which is how these products are
// normally laid.
function surfaceRepeatUnit(spec) {
  var tileW = Math.max(spec.sizeIn[0], spec.sizeIn[1]);
  var tileH = Math.min(spec.sizeIn[0], spec.sizeIn[1]);
  var cols = Math.max(1, Math.round(SURFACE_UNIT_TARGET_IN / tileW));
  var rows = Math.max(2, Math.round(SURFACE_UNIT_TARGET_IN / tileH));
  if (spec.layout === "offset" && rows % 2) rows++; // half-bond needs pairs
  return { tileW: tileW, tileH: tileH, cols: cols, rows: rows, unitW: cols * tileW, unitH: rows * tileH };
}

function drawTileCharacter(ctx, spec, rand, x, y, w, h, base) {
  var i;
  if (spec.character === "stone") {
    for (i = 0; i < 26; i++) {
      var cx = x + rand() * w;
      var cy = y + rand() * h;
      var rad = (0.15 + rand() * 0.45) * h;
      var grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      // Fades to the SAME tone at zero alpha — fading to transparent black
      // would drag a dark ring into every blob.
      var blob = shadeHex(base, (rand() - 0.5) * 0.1);
      grad.addColorStop(0, blob);
      grad.addColorStop(1, blob + "00");
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, w, h);
    }
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = shadeHex(base, 0.12);
    for (i = 0; i < 3; i++) {
      ctx.lineWidth = 0.5 + rand() * 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y + rand() * h);
      ctx.bezierCurveTo(x + w * 0.33, y + rand() * h, x + w * 0.66, y + rand() * h, x + w, y + rand() * h);
      ctx.stroke();
    }
  } else if (spec.character === "wood") {
    // Grain runs along the plank's length (U).
    ctx.strokeStyle = spec.accent || shadeHex(base, -0.2);
    for (i = 0; i < 22; i++) {
      var gy = y + rand() * h;
      var amp = rand() * h * 0.08;
      var phase = rand() * Math.PI * 2;
      ctx.globalAlpha = 0.12 + rand() * 0.25;
      ctx.lineWidth = 0.4 + rand() * 1.4;
      ctx.beginPath();
      for (var sx = 0; sx <= w; sx += Math.max(2, w / 40)) {
        var sy = gy + Math.sin(phase + (sx / w) * Math.PI * 2 * (1 + rand() * 0.3)) * amp;
        if (sx === 0) ctx.moveTo(x + sx, sy);
        else ctx.lineTo(x + sx, sy);
      }
      ctx.stroke();
    }
  } else if (spec.character === "handmade") {
    // Glaze pooling toward the edges, a touch darker than the face.
    var edge = ctx.createRadialGradient(x + w / 2, y + h / 2, h * 0.2, x + w / 2, y + h / 2, w * 0.6);
    var pooled = shadeHex(base, -0.06);
    edge.addColorStop(0, pooled + "00");
    edge.addColorStop(1, pooled);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = edge;
    ctx.fillRect(x, y, w, h);
  } else if (spec.character === "encaustic") {
    // A printed quatrefoil: a center ring, quarter rings at each corner
    // (which join into full rings across neighboring tiles), and a center
    // diamond — the same repeat-across-the-grid read the real tile has.
    var s = Math.min(w, h);
    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = spec.accent;
    ctx.fillStyle = spec.accent;
    ctx.lineWidth = s * 0.07;
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, s * 0.26, 0, Math.PI * 2);
    ctx.stroke();
    [
      [x, y],
      [x + w, y],
      [x, y + h],
      [x + w, y + h],
    ].forEach(function (c) {
      ctx.beginPath();
      ctx.arc(c[0], c[1], s * 0.2, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y + h / 2 - s * 0.1);
    ctx.lineTo(x + w / 2 + s * 0.1, y + h / 2);
    ctx.lineTo(x + w / 2, y + h / 2 + s * 0.1);
    ctx.lineTo(x + w / 2 - s * 0.1, y + h / 2);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Tangent-space normal map from a grayscale height canvas (Sobel). Canvas
// rows run down while V runs up (CanvasTexture flips Y), hence the sign
// on the V gradient.
function normalCanvasFromHeight(heightCanvas, strength) {
  var w = heightCanvas.width;
  var h = heightCanvas.height;
  var src = heightCanvas.getContext("2d").getImageData(0, 0, w, h).data;
  var out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  var octx = out.getContext("2d");
  var img = octx.createImageData(w, h);
  var d = img.data;
  function at(px, py) {
    px = (px + w) % w;
    py = (py + h) % h;
    return src[(py * w + px) * 4] / 255;
  }
  for (var py = 0; py < h; py++) {
    for (var px = 0; px < w; px++) {
      var du = (at(px + 1, py) - at(px - 1, py)) * strength;
      var dv = -(at(px, py + 1) - at(px, py - 1)) * strength;
      var len = Math.sqrt(du * du + dv * dv + 1);
      var i = (py * w + px) * 4;
      d[i] = Math.round(((-du / len) * 0.5 + 0.5) * 255);
      d[i + 1] = Math.round(((-dv / len) * 0.5 + 0.5) * 255);
      d[i + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      d[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

function makeCanvas(w, h) {
  var c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function generateSurfaceCanvases(spec) {
  var unit = surfaceRepeatUnit(spec);
  var pxPerIn = Math.min(SURFACE_TEXTURE_MAX_PX / unit.unitW, SURFACE_TEXTURE_MAX_PX / unit.unitH);
  var W = Math.max(2, Math.round(unit.unitW * pxPerIn));
  var H = Math.max(2, Math.round(unit.unitH * pxPerIn));
  var albedo = makeCanvas(W, H);
  var height = makeCanvas(W, H);
  var rough = makeCanvas(W, H);
  var a = albedo.getContext("2d");
  var hctx = height.getContext("2d");
  var r = rough.getContext("2d");
  var rand = seededRandom(spec.id || spec.color);
  var grout = spec.grout || shadeHex(spec.color, -0.2);
  var groutPx = Math.max(1, (spec.groutIn || 0.0625) * pxPerIn);
  var tileW = unit.tileW * pxPerIn;
  var tileH = unit.tileH * pxPerIn;

  // Background = the joints: grout color, recessed, rough.
  a.fillStyle = grout;
  a.fillRect(0, 0, W, H);
  hctx.fillStyle = grayCss(0.1);
  hctx.fillRect(0, 0, W, H);
  r.fillStyle = grayCss(0.95);
  r.fillRect(0, 0, W, H);

  for (var row = 0; row < unit.rows; row++) {
    var rowOffset = 0;
    if (spec.layout === "offset") rowOffset = (row % 2) * (tileW / 2);
    else if (spec.layout === "stagger") rowOffset = rand() * tileW;
    for (var col = 0; col < unit.cols; col++) {
      var tone = shadeHex(spec.color, (rand() - 0.5) * 2 * (spec.variation || 0));
      var tileSeed = rand();
      var x0 = col * tileW + rowOffset;
      var y0 = row * tileH;
      // Drawn again one repeat unit to the left when it spills past the
      // right edge, so the texture wraps seamlessly.
      [x0, x0 - W].forEach(function (x) {
        if (x >= W || x + tileW <= 0) return;
        var gx = x + groutPx / 2;
        var gy = y0 + groutPx / 2;
        var gw = tileW - groutPx;
        var gh = tileH - groutPx;
        a.save();
        a.beginPath();
        a.rect(gx, gy, gw, gh);
        a.clip();
        a.fillStyle = tone;
        a.fillRect(gx, gy, gw, gh);
        drawTileCharacter(a, spec, seededRandom(String(tileSeed)), gx, gy, gw, gh, tone);
        a.restore();

        // Face raised above the joint, with a one-joint-wide eased edge.
        var bevel = Math.max(1, groutPx);
        for (var b = 0; b < 3; b++) {
          hctx.fillStyle = grayCss(0.55 + b * 0.2);
          hctx.fillRect(gx + (b * bevel) / 3, gy + (b * bevel) / 3, gw - (2 * b * bevel) / 3, gh - (2 * b * bevel) / 3);
        }
        r.fillStyle = grayCss(clamp(spec.roughness + (tileSeed - 0.5) * 0.06, 0.02, 1));
        r.fillRect(gx, gy, gw, gh);
      });
    }
  }
  return {
    albedo: albedo,
    normal: normalCanvasFromHeight(height, spec.kind === "plank" ? 1.5 : 3),
    rough: rough,
    unit: unit,
  };
}

function configureSurfaceTexture(s, tex, unitWIn, unitHIn, isColor) {
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(12 / unitWIn, 12 / unitHIn);
  tex.anisotropy = s.renderer.capabilities.getMaxAnisotropy();
  if (isColor) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function getSurfaceTextures(s, spec) {
  if (surfaceTextureCache[spec.id]) return surfaceTextureCache[spec.id];
  var textures;
  if (spec.maps) {
    var loader = new THREE.TextureLoader();
    var onLoad = function () {
      needsRender = true;
    };
    var mw = spec.maps.sizeIn[0];
    var mh = spec.maps.sizeIn[1];
    textures = {
      map: configureSurfaceTexture(s, loader.load(spec.maps.albedo, onLoad), mw, mh, true),
      normalMap: spec.maps.normal ? configureSurfaceTexture(s, loader.load(spec.maps.normal, onLoad), mw, mh) : null,
      roughnessMap: spec.maps.roughness
        ? configureSurfaceTexture(s, loader.load(spec.maps.roughness, onLoad), mw, mh)
        : null,
    };
  } else {
    var c = generateSurfaceCanvases(spec);
    textures = {
      map: configureSurfaceTexture(s, new THREE.CanvasTexture(c.albedo), c.unit.unitW, c.unit.unitH, true),
      normalMap: configureSurfaceTexture(s, new THREE.CanvasTexture(c.normal), c.unit.unitW, c.unit.unitH),
      roughnessMap: configureSurfaceTexture(s, new THREE.CanvasTexture(c.rough), c.unit.unitW, c.unit.unitH),
    };
  }
  surfaceTextureCache[spec.id] = textures;
  return textures;
}

// Dresses one shell material with a picked product's spec, or (spec null)
// back to the generic scope-driven color/roughness it had before.
function applySurfaceFinish(s, material, spec, fallbackHex, fallbackRoughness) {
  var hadMaps = !!material.map;
  if (spec && spec.kind !== "paint") {
    var t = getSurfaceTextures(s, spec);
    material.color.setHex(0xffffff);
    material.roughness = 1; // the roughness map carries the real values
    material.map = t.map;
    material.normalMap = t.normalMap;
    material.roughnessMap = t.roughnessMap;
  } else {
    if (spec) material.color.set(spec.color);
    else material.color.setHex(fallbackHex);
    material.roughness = spec ? spec.roughness : fallbackRoughness;
    material.map = null;
    material.normalMap = null;
    material.roughnessMap = null;
  }
  if (hadMaps !== !!material.map) material.needsUpdate = true;
}

// Roughness per finish — tile reads glossier/more reflective, paint and
// bare flooring read more matte, so the same scope-driven colors respond
// believably under the new image-based lighting instead of looking like
// flat color swatches.
function roughnessForFloorFinish(value) {
  if (value === "tile") return 0.35;
  if (value === "flooring") return 0.55;
  return 0.85;
}

function roughnessForWalls(value) {
  if (value === "tile") return 0.35;
  if (value === "paint") return 0.7;
  return 0.9;
}

function roughnessForCeiling(paintCeilingBool) {
  return paintCeilingBool === true ? 0.7 : 0.9;
}

function rebuildFinishes(s) {
  var isDark = s.isDark;
  var picked = Surfaces
    ? Surfaces.resolveSurfaces(state.scope, state.surfacePicks)
    : { floor: null, walls: null, ceiling: null };
  applySurfaceFinish(
    s,
    s.shellMaterials.floor,
    picked.floor,
    Layout.colorForFloorFinish(state.scope.floorFinish, isDark),
    roughnessForFloorFinish(state.scope.floorFinish),
  );
  applySurfaceFinish(
    s,
    s.shellMaterials.wall,
    picked.walls,
    Layout.colorForWalls(state.scope.walls, isDark),
    roughnessForWalls(state.scope.walls),
  );
  applySurfaceFinish(
    s,
    s.shellMaterials.ceiling,
    picked.ceiling,
    Layout.colorForCeiling(state.scope.paintCeiling, isDark),
    roughnessForCeiling(state.scope.paintCeiling),
  );
}

function setShadowFlags(object3d) {
  object3d.traverse(function (child) {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

// Fixtures with a flat, tall enough side to hang a paper holder on.
var SIDE_MOUNTS = ["Shower_Quantity", "Vanity_Quantity", "Cabinet_Quantity"];

// Where a paper holder of this size goes beside toilet placement p:
// { side, x, facing }. On the wall behind, a little past the tank, when
// that side has room for it; otherwise turned to face the toilet (facing)
// on a corner's side wall or a tall neighbor's side, at x; failing all of
// that, the roomier side.
function paperHolderSpot(ctx, p, size) {
  var rooms = [1, -1].map(function (side) {
    return { side: side, room: ctx.sideRoom(p, side, 2.3) };
  });
  var behind = rooms.filter(function (r) {
    return r.room.dist >= 1.15 + size.x / 2;
  })[0];
  if (behind) return { side: behind.side, x: behind.side * 1.15, facing: false };
  var beside = rooms.filter(function (r) {
    return r.room.what === "wall" || SIDE_MOUNTS.indexOf(r.room.what) !== -1;
  })[0];
  if (beside) return { side: beside.side, x: beside.side * beside.room.dist, facing: true };
  var roomier = rooms[0].room.dist >= rooms[1].room.dist ? rooms[0] : rooms[1];
  return { side: roomier.side, x: roomier.side * 1.15, facing: false };
}

// A box in a placed fixture's own frame (x along its wall, z out into the
// room), as the room-space axis-aligned box it covers.
function fixtureFrameBox(p, minX, maxX, minZ, maxZ) {
  var c = Math.cos(p.rotationY);
  var sn = Math.sin(p.rotationY);
  var xs = [];
  var zs = [];
  [minX, maxX].forEach(function (lx) {
    [minZ, maxZ].forEach(function (lz) {
      xs.push(p.x + lx * c + lz * sn);
      zs.push(p.z - lx * sn + lz * c);
    });
  });
  return {
    minX: Math.min.apply(null, xs),
    maxX: Math.max.apply(null, xs),
    minZ: Math.min.apply(null, zs),
    maxZ: Math.max.apply(null, zs),
  };
}

function rebuildFixtures(s, widthFt, lengthFt, heightFt) {
  while (s.fixtureGroup.children.length) {
    var old = s.fixtureGroup.children[0];
    disposeFixtureInstance(old);
    s.fixtureGroup.remove(old);
  }
  var layoutInput = { footprints: planFootprints() };
  var layout = { placements: state.plan || [] };
  s.lastEntryPlacements = layout.placements.filter(function (p) {
    return p.fixtureKey === "Door_Quantity";
  });
  var placedKeys = {};
  var sel = selectedProducts();
  var ctx = {
    heightFt: heightFt,
    // How much room a fixture has on one side (side: +1 = along its wall's
    // direction, -1 = back toward the wall's start), within `depth` ft of
    // the wall: { dist: from its centerline to the nearest thing, what:
    // "wall" (the room's corner) or the fixtureKey in the way }.
    sideRoom: function (p, side, depth) {
      var span = p.wallId === "N" || p.wallId === "S" ? widthFt : lengthFt;
      var room = { dist: side > 0 ? span - p.offsetFt : p.offsetFt, what: "wall" };
      var c = Math.cos(p.rotationY);
      var sn = Math.sin(p.rotationY);
      layout.placements.forEach(function (q) {
        if (q === p) return;
        var fp =
          (layoutInput.footprints && layoutInput.footprints[q.fixtureKey]) || Layout.FIXTURE_LAYOUT[q.fixtureKey];
        if (!fp || (fp.mount !== "floor" && q.fixtureKey !== "Shower_Door_Quantity")) return;
        var z0 = q.depthOffset || 0;
        var box = fixtureFrameBox(q, -fp.wallSpan / 2, fp.wallSpan / 2, z0, z0 + (fp.depth || 0.1));
        // That box's corners in p's own frame.
        var lx = [];
        var lz = [];
        [box.minX, box.maxX].forEach(function (wx) {
          [box.minZ, box.maxZ].forEach(function (wz) {
            lx.push((wx - p.x) * c - (wz - p.z) * sn);
            lz.push((wx - p.x) * sn + (wz - p.z) * c);
          });
        });
        if (Math.max.apply(null, lz) <= 0 || Math.min.apply(null, lz) >= depth) return;
        var near = side > 0 ? Math.min.apply(null, lx) : -Math.max.apply(null, lx);
        if (near > 0 && near < room.dist) room = { dist: near, what: q.fixtureKey };
      });
      return room;
    },
  };
  layout.placements.forEach(function (p) {
    placedKeys[p.fixtureKey] = true;
    ensureFixtureModel(s, p.fixtureKey);
    var productBody = productBodyTemplate(s, p.fixtureKey, sel);
    // An entry point without a door renders as a trimmed open archway —
    // no slab or knob — instead of the normal door template.
    var archway = p.fixtureKey === "Door_Quantity" && p.hasDoor === false;
    var template = archway
      ? s.fixtureTemplates.Door_Quantity_Archway
      : productBody ||
        (p.fixtureKey === "Toilet_Quantity"
          ? s.toiletTemplates[state.selectedToiletStyle]
          : s.fixtureTemplates[p.fixtureKey]);
    if (!template) return;
    var footprint = Layout.FIXTURE_LAYOUT[p.fixtureKey];
    // Wall-mounted builders (mirrors, shelf) are modeled centered on their
    // own origin, so they need placement.y (the mount height). Every other
    // builder in this file is modeled from a floor origin (y=0) upward, in
    // absolute heights — using placement.y for those would double-count
    // the vertical offset already baked into the template's meshes.
    var y = footprint && footprint.mount === "wall" ? p.y : 0;
    var instance = template.clone(true);
    addProductParts(s, instance, p, sel, !productOwnsBody(p.fixtureKey, sel) || !!productBody, ctx);
    instance.position.set(p.x, y, p.z);
    instance.rotation.y = p.rotationY;
    if (p.depthOffset) {
      instance.translateZ(p.depthOffset);
    }
    // setFixtureFinish() looks instances up by this to retint in place
    // without a full rebuild — see updateFixtureFinishInstances().
    instance.userData.fixtureKey = p.fixtureKey;
    instance.userData.placementIndex = p.index;
    // The studio's fixture this belongs to (a mirror or shower door rides
    // with its vanity or shower), and where it stands, for previewItem().
    instance.userData.itemId = p.itemId || null;
    instance.userData.pose = { x: p.x, y: y, z: p.z, rotationY: p.rotationY, depthOffset: p.depthOffset || 0 };
    // Its base, not a mirror or shelf on the wall above (for the outline).
    instance.userData.onWall = y > 0;
    // A door, mirror or shelf goes with its wall when the wall is cut away
    // (applyCutaway()).
    instance.userData.wallId = p.wallId;
    instance.userData.cutaway = y > 0 || p.fixtureKey === "Door_Quantity";
    var finish = state.fixtureFinishes[p.fixtureKey];
    if (finish != null) applyFixtureFinish(instance, p.fixtureKey, s.mat, finish);
    setShadowFlags(instance);
    s.fixtureGroup.add(instance);
  });
  showModelNote(s, addElectricalKeys(placedKeys), sel);
}

// Names the picked products showing as a stand-in because their model
// couldn't load. They're still what the estimate prices.
function showModelNote(s, placedKeys, sel) {
  if (!s.modelNote) return;
  var names = [];
  PRODUCT_SLOTS.forEach(function (slot) {
    if (!slotShown(slot, placedKeys, sel)) return;
    var opt = sel[slot.id];
    var failed = optionModels(opt).some(function (m) {
      return s.productModels[m.url] === null;
    });
    if (failed) names.push(T("room3d.option." + opt.id));
  });
  s.modelNote.hidden = !names.length;
  s.modelNote.textContent = names.length ? T("room3d.modelFailed", { list: names.join(", ") }) : "";
}

// Visitors who ask their system for less motion get cuts, not glides.
function reducedMotion() {
  return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function applyCameraLerp(s) {
  if (!s.cameraLerp) return;
  var t = reducedMotion() ? 1 : clamp((performance.now() - s.cameraLerp.start) / s.cameraLerp.durationMs, 0, 1);
  var eased = easeOutCubic(t);
  s.camera.position.lerpVectors(s.cameraLerp.from, s.cameraLerp.to, eased);
  // A focus move (focusCameraOn) turns to look at the fixture as it goes.
  if (s.cameraLerp.targetTo) s.controls.target.lerpVectors(s.cameraLerp.targetFrom, s.cameraLerp.targetTo, eased);
  if (t >= 1) s.cameraLerp = null;
}

// Walk-in: puts the camera at the chosen doorway (eye height) and reuses
// OrbitControls for looking around, by pointing its target an
// imperceptible epsilon into the room and clamping min/maxDistance to that
// same epsilon — the camera stays put (it can't orbit away or zoom) while
// a drag still turns the view.
function applyCameraMode(s) {
  if (!s) return;
  var dims = Layout.computeRoomDimensions(state.dims);
  if (state.cameraMode === "walkin") {
    var ep = (s.lastEntryPlacements || []).filter(function (p) {
      return p.index === state.walkInEntryIndex;
    })[0];
    if (!ep) {
      // That doorway is gone: back to the overview rather than leaving the
      // camera stranded where it was.
      state.cameraMode = "orbit";
    } else {
      var normal = WALL_INWARD_NORMAL[ep.wallId] || { x: 0, z: 1 };
      // A typical standing eye height, but never above the ceiling.
      var eyeHeight = Math.min(5.4, dims.heightFt - 0.8);
      var epsilon = 0.05;
      // Just through the doorway (the door itself is behind), with a wider
      // lens, the way a room looks when you walk into it.
      var inside = 0.3;
      setFov(s, WALK_FOV);
      s.cameraLerp = null;
      s.camera.position.set(ep.x + normal.x * inside, eyeHeight, ep.z + normal.z * inside);
      // Looking toward the middle of the room and down at the fixtures, but
      // not so steeply that the walls drop out of view.
      var look = new THREE.Vector3(dims.widthFt / 2, 0, dims.lengthFt / 2).sub(s.camera.position);
      look.y = 0;
      if (look.x * normal.x + look.z * normal.z <= 0.1) look.set(normal.x, 0, normal.z);
      var flat = look.length();
      look.y = -Math.min(eyeHeight - 2.2, flat * Math.tan((26 * Math.PI) / 180));
      s.controls.target.copy(s.camera.position).addScaledVector(look.normalize(), epsilon);
      s.controls.minDistance = epsilon;
      s.controls.maxDistance = epsilon;
      s.controls.enablePan = false;
      s.controls.update();
      needsRender = true;
      return;
    }
  }
  s.controls.enablePan = true;
  setFov(s, ORBIT_FOV);
  frameRoom(s, true);
}

var ORBIT_FOV = 50;
var WALK_FOV = 70;

function setFov(s, fov) {
  if (s.camera.fov === fov) return;
  s.camera.fov = fov;
  s.camera.updateProjectionMatrix();
}

// Where the camera looks at the whole room from: above the corner between
// walls B and C, far enough back that the room fills the view.
function overviewPose(s, aspect) {
  var dims = Layout.computeRoomDimensions(state.dims);
  var w = dims.widthFt;
  var l = dims.lengthFt;
  var h = dims.heightFt;
  aspect = aspect || s.camera.aspect || 1;
  var target = new THREE.Vector3(w / 2, h * 0.32, l / 2);
  var direction = new THREE.Vector3(0.62, 0.95, 1).normalize();
  // The nearest distance at which the whole room box (all eight corners)
  // is in view, leaving room at the top for the view buttons.
  var tanV = Math.tan((ORBIT_FOV * Math.PI) / 360);
  var tanH = tanV * aspect;
  var forward = direction.clone().negate();
  var right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  var up = new THREE.Vector3().crossVectors(right, forward);
  var corners = [];
  [0, w].forEach(function (x) {
    [0, h].forEach(function (y) {
      [0, l].forEach(function (z) {
        corners.push(new THREE.Vector3(x, y, z).sub(target));
      });
    });
  });
  var fits = function (d) {
    return corners.every(function (c) {
      var depth = d + c.dot(forward);
      if (depth <= 0.1) return false;
      var sx = c.dot(right) / (depth * tanH);
      var sy = c.dot(up) / (depth * tanV);
      return Math.abs(sx) <= 0.9 && sy <= 0.8 && sy >= -0.92;
    });
  };
  var lo = 1;
  var hi = 400;
  for (var i = 0; i < 40; i++) {
    var mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  return { target: target, position: target.clone().addScaledVector(direction, hi), distance: hi };
}

// What's drawn this frame:
//   - the walls between the camera and the room aren't drawn (they're only
//     seen from inside), so neither is a door, mirror, shelf or cover plate
//     on them: it would float in the air;
//   - while one fixture is being worked on (setIsolate()), the rest of the
//     room's fixtures step out of the way.
function applyCutaway(s, camera) {
  var dims = Layout.computeRoomDimensions(state.dims);
  var plane = { N: 0, E: dims.widthFt, S: dims.lengthFt, W: 0 };
  var p = camera.position;
  var only = state.isolate;
  function shown(inst, isFixture) {
    if (only && isFixture && only.indexOf(inst.userData.itemId) === -1) return false;
    var id = inst.userData.wallId;
    if (!inst.userData.cutaway || !WALL_INWARD_NORMAL[id]) return true;
    var n = WALL_INWARD_NORMAL[id];
    var along = id === "N" || id === "S" ? (p.z - plane[id]) * n.z : (p.x - plane[id]) * n.x;
    return along > -0.05;
  }
  s.fixtureGroup.children.forEach(function (inst) {
    inst.visible = shown(inst, true);
  });
  s.electricalGroup.children.forEach(function (inst) {
    inst.visible = shown(inst, false);
  });
}

// Points the camera at the whole room. animate: glide there.
function frameRoom(s, animate) {
  var dims = Layout.computeRoomDimensions(state.dims);
  var pose = overviewPose(s);
  var diag = Math.sqrt(dims.widthFt * dims.widthFt + dims.lengthFt * dims.lengthFt);
  s.controls.minDistance = clamp(diag * 0.3, 2, 12);
  s.controls.maxDistance = Math.max(pose.distance * 1.9, 14);
  if (animate) {
    s.cameraLerp = {
      from: s.camera.position.clone(),
      to: pose.position,
      targetFrom: s.controls.target.clone(),
      targetTo: pose.target,
      start: performance.now(),
      durationMs: 450,
    };
  } else {
    s.cameraLerp = null;
    s.camera.position.copy(pose.position);
    s.controls.target.copy(pose.target);
  }
  s.controls.update();
  needsRender = true;
}

function rebuild() {
  var s = threeState;
  if (!s) return;
  var dims = Layout.computeRoomDimensions(state.dims);
  var dimsChanged =
    !s.lastDims ||
    s.lastDims.widthFt !== dims.widthFt ||
    s.lastDims.lengthFt !== dims.lengthFt ||
    s.lastDims.heightFt !== dims.heightFt;

  if (dimsChanged) {
    rebuildShell(s, dims.widthFt, dims.lengthFt, dims.heightFt);

    // Directional light + its shadow camera frustum are sized to the
    // room's own diagonal so the shadow stays crisp at both the tiny
    // default footprint and the largest legal room.
    var diag = Math.sqrt(dims.widthFt * dims.widthFt + dims.lengthFt * dims.lengthFt);
    s.dirLight.position.set(dims.widthFt * 0.6, dims.heightFt * 2.2, dims.lengthFt * 0.6);
    s.dirLight.target.position.set(dims.widthFt / 2, 0, dims.lengthFt / 2);
    s.dirLight.target.updateMatrixWorld();
    var frustum = clamp(diag * 0.75, 3, 60);
    s.dirLight.shadow.camera.left = -frustum;
    s.dirLight.shadow.camera.right = frustum;
    s.dirLight.shadow.camera.top = frustum;
    s.dirLight.shadow.camera.bottom = -frustum;
    s.dirLight.shadow.camera.near = 0.5;
    s.dirLight.shadow.camera.far = dims.heightFt * 2.2 + frustum + 5;
    s.dirLight.shadow.camera.updateProjectionMatrix();

    // The first time straight there; after a resize, a glide to the new
    // framing (unless standing in the doorway, which follows below).
    if (state.cameraMode !== "walkin") frameRoom(s, !!s.lastDims);
    s.lastDims = dims;
  }

  rebuildFinishes(s);
  rebuildFixtures(s, dims.widthFt, dims.lengthFt, dims.heightFt);
  rebuildSurround(s);
  rebuildElectrical(s);
  applyStudioView(s);
  if (s.pendingFocus) {
    focusCameraOn(s, s.pendingFocus);
    s.pendingFocus = null;
  }
  // Follows the room if it resizes while walking in, or if the doorway
  // moved; a no-op re-pin when nothing moved.
  if (state.cameraMode === "walkin") applyCameraMode(s);
}

// ---------------------------------------------------------------------
// The design studio's view: outlines, floor marks, the tub surround
// ---------------------------------------------------------------------
var STUDIO_TONES = { select: 0x3b82f6, ok: 0x14b8a6, warn: 0xf59e0b, error: 0xef4444, info: 0x94a3b8 };
var studioView = { selected: null, tone: "select", hover: null, marks: [] };

// A wall's left end, direction along it and into the room (the same frames
// as js/room-plan.js walls()).
function wallFrame(wallId, w, l) {
  return {
    N: { ox: 0, oz: 0, dx: 1, dz: 0, nx: 0, nz: 1 },
    E: { ox: w, oz: 0, dx: 0, dz: 1, nx: -1, nz: 0 },
    S: { ox: w, oz: l, dx: -1, dz: 0, nx: 0, nz: -1 },
    W: { ox: 0, oz: l, dx: 0, dz: -1, nx: 1, nz: 0 },
  }[wallId];
}

// The box around a fixture's base (not a mirror or shelf above it).
// Only what's actually drawn: a fixture that's been cut away or stepped
// out of the way for another one has no box, so nothing is highlighted or
// pointed at where there's nothing to see.
function itemBox(s, itemId) {
  var box = new THREE.Box3();
  s.fixtureGroup.children.forEach(function (inst) {
    if (inst.userData.itemId === itemId && !inst.userData.onWall && inst.visible) box.expandByObject(inst);
  });
  if (box.isEmpty()) {
    s.electricalGroup.children.forEach(function (inst) {
      if (inst.userData.pointId === itemId && inst.visible) box.expandByObject(inst);
    });
  }
  return box;
}

function applyStudioView(s) {
  if (!s) return;
  [
    { helper: s.selectBox, id: studioView.selected, tone: studioView.tone },
    { helper: s.hoverBox, id: studioView.hover !== studioView.selected ? studioView.hover : null, tone: "info" },
  ].forEach(function (h) {
    var box = h.id ? itemBox(s, h.id) : null;
    if (!box || box.isEmpty()) {
      h.helper.visible = false;
      return;
    }
    h.helper.box.copy(box.expandByScalar(0.04));
    h.helper.material.color.setHex(STUDIO_TONES[h.tone] || STUDIO_TONES.select);
    h.helper.visible = true;
  });
  needsRender = true;
}

// Empties a group of one-off objects (marks, electrical points, the tub
// surround). Their geometry is built per object, so it's freed all the way
// down, except inside a product model's clone (offsetModel), which shares
// the cached model's geometry. Nested materials are shared caches
// (electricalMaterials, product models); only a top-level object's own
// material is freed, and never the shared surround material.
function disposeGroup(group) {
  while (group.children.length) {
    var child = group.children[0];
    group.remove(child);
    disposeGeometries(child);
    if (child.material && child.material !== threeState.surroundMaterial) child.material.dispose();
  }
}

function disposeGeometries(node) {
  if (node.userData.sharedModel) return;
  if (node.geometry) node.geometry.dispose();
  node.children.forEach(disposeGeometries);
}

// Each mark is a rectangle on the floor ({ x0, x1, z0, z1 }) or a door's
// swing ({ arc: { x, z, r, ax, az, bx, bz } }: the hinge, the radius and
// the directions the door sweeps between), filled faintly and edged in its
// tone.
function rebuildMarks(s) {
  disposeGroup(s.markGroup);
  studioView.marks.forEach(function (mark, i) {
    var color = STUDIO_TONES[mark.tone] || STUDIO_TONES.info;
    var y = 0.012 + i * 0.0008;
    var fillMaterial = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: mark.fill != null ? mark.fill : 0.2,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    var lineMaterial = new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: 0.9 });
    var shape;
    var outline;
    if (mark.arc) {
      var a = mark.arc;
      // CircleGeometry lies in x-y; laid flat, its angle t points at (cos t, -sin t).
      var from = Math.atan2(-a.az, a.ax);
      var sweep = Math.atan2(-a.bz, a.bx) - from;
      while (sweep > Math.PI) sweep -= 2 * Math.PI;
      while (sweep < -Math.PI) sweep += 2 * Math.PI;
      if (sweep < 0) {
        from += sweep;
        sweep = -sweep;
      }
      shape = new THREE.CircleGeometry(a.r, 24, from, sweep);
      var pts = [new THREE.Vector3(0, 0, 0)];
      for (var k = 0; k <= 24; k++) {
        var t = from + (sweep * k) / 24;
        pts.push(new THREE.Vector3(Math.cos(t) * a.r, Math.sin(t) * a.r, 0));
      }
      pts.push(new THREE.Vector3(0, 0, 0));
      outline = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMaterial);
      [shape, outline.geometry].forEach(function (g) {
        g.rotateX(-Math.PI / 2);
        g.translate(a.x, y, a.z);
      });
    } else {
      var w = mark.x1 - mark.x0;
      var d = mark.z1 - mark.z0;
      if (!(w > 0.001) || !(d > 0.001)) return;
      shape = new THREE.PlaneGeometry(w, d);
      shape.rotateX(-Math.PI / 2);
      shape.translate((mark.x0 + mark.x1) / 2, y, (mark.z0 + mark.z1) / 2);
      outline = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(mark.x0, y, mark.z0),
          new THREE.Vector3(mark.x1, y, mark.z0),
          new THREE.Vector3(mark.x1, y, mark.z1),
          new THREE.Vector3(mark.x0, y, mark.z1),
        ]),
        lineMaterial,
      );
    }
    var fill = new THREE.Mesh(shape, fillMaterial);
    fill.renderOrder = 5;
    outline.renderOrder = 6;
    s.markGroup.add(fill, outline);
  });
  needsRender = true;
}

// ---------------------------------------------------------------------
// Electrical: cover plates, the vanity light and the ceiling fan
// ---------------------------------------------------------------------
// Drawn here rather than loaded as models: a receptacle, a switch, a light
// bar and a fan grille are flat, simple shapes, and a 3 in. plate doesn't
// earn a download. Each one carries userData.pointId so the studio can
// pick it up and slide it along the wall.
var ELEC_COLORS = {
  plate: 0xf4f2ee,
  // A plate against a white wall disappears without a shadow line around
  // it, which a real one casts; this edge stands in for it.
  edge: 0x9aa0ad,
  dark: 0x2a2f3a,
  metal: 0xc9ccd2,
  glow: 0xfff3d6,
};

function electricalMaterials(s) {
  if (!s.elecMat) {
    s.elecMat = {
      plate: new THREE.MeshStandardMaterial({ color: ELEC_COLORS.plate, roughness: 0.55 }),
      edge: new THREE.MeshStandardMaterial({ color: ELEC_COLORS.edge, roughness: 0.8 }),
      dark: new THREE.MeshStandardMaterial({ color: ELEC_COLORS.dark, roughness: 0.7 }),
      metal: new THREE.MeshStandardMaterial({ color: ELEC_COLORS.metal, roughness: 0.4, metalness: 0.8 }),
      glow: new THREE.MeshStandardMaterial({
        color: ELEC_COLORS.glow,
        emissive: new THREE.Color(ELEC_COLORS.glow),
        emissiveIntensity: 0.9,
        roughness: 0.3,
      }),
    };
  }
  return s.elecMat;
}

// One point, modeled facing +z from its own origin (the wall surface).
function buildElectricalPiece(s, p) {
  var m = electricalMaterials(s);
  var g = new THREE.Group();
  var plate;
  if (p.kind === "outlet" || p.kind === "switch") {
    var edge = new THREE.Mesh(new THREE.BoxGeometry(p.width + 0.035, p.height + 0.035, 0.01), m.edge);
    edge.position.z = 0.005;
    g.add(edge);
    plate = new THREE.Mesh(new THREE.BoxGeometry(p.width, p.height, 0.035), m.plate);
    plate.position.z = 0.019;
    g.add(plate);
    if (p.kind === "outlet") {
      // Two receptacles, one above the other, each with its slots.
      [-1, 1].forEach(function (dir) {
        var face = new THREE.Mesh(new THREE.BoxGeometry(p.width * 0.55, p.height * 0.3, 0.012), m.plate);
        face.position.set(0, dir * p.height * 0.19, 0.04);
        g.add(face);
        [-1, 1].forEach(function (side) {
          var slot = new THREE.Mesh(new THREE.BoxGeometry(0.018, p.height * 0.12, 0.01), m.dark);
          slot.position.set(side * p.width * 0.12, dir * p.height * 0.21, 0.045);
          g.add(slot);
        });
        var ground = new THREE.Mesh(new THREE.CircleGeometry(0.014, 10), m.dark);
        ground.position.set(0, dir * p.height * 0.12, 0.046);
        g.add(ground);
      });
    } else {
      var rocker = new THREE.Mesh(new THREE.BoxGeometry(p.width * 0.5, p.height * 0.55, 0.022), m.plate);
      rocker.position.z = 0.044;
      rocker.rotation.x = -0.06;
      g.add(rocker);
      var seam = new THREE.Mesh(new THREE.BoxGeometry(p.width * 0.52, 0.01, 0.01), m.dark);
      seam.position.set(0, 0, 0.05);
      g.add(seam);
    }
  } else if (p.kind === "light") {
    var bar = new THREE.Mesh(new THREE.BoxGeometry(p.width, 0.1, 0.1), m.metal);
    bar.position.set(0, p.height / 2 - 0.05, 0.05);
    g.add(bar);
    var count = Math.max(2, Math.round(p.width / 0.6));
    for (var i = 0; i < count; i++) {
      var bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), m.glow);
      bulb.position.set((i - (count - 1) / 2) * (p.width / count), p.height / 2 - 0.22, 0.09);
      g.add(bulb);
    }
  } else if (p.kind === "fan") {
    // A grille in the ceiling, modeled facing down.
    var body = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.06, 1.05), m.plate);
    g.add(body);
    for (var k = -2; k <= 2; k++) {
      var fin = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.02, 0.07), m.dark);
      fin.position.set(0, -0.04, k * 0.17);
      g.add(fin);
    }
  }
  return g;
}

// The picked vanity light, centered on its point with its back on the
// wall; null for the drawn one, or until its model arrives.
function lightTemplate(s, light) {
  if (!light.url || !productModelsReady(s, [light])) return null;
  var model = s.productModels[light.url];
  return offsetModel(model, 0, -model.userData.size.y / 2, 0);
}

function rebuildElectrical(s) {
  disposeGroup(s.electricalGroup);
  var light = selectedProducts().vanityLight;
  (state.electrical || []).forEach(function (p) {
    var piece = (p.kind === "light" && lightTemplate(s, light)) || buildElectricalPiece(s, p);
    if (p.ceiling) {
      piece.position.set(p.x, p.y - 0.03, p.z);
    } else {
      piece.position.set(p.x, p.y, p.z);
      piece.rotation.y = p.rotationY || 0;
    }
    piece.userData.pointId = p.id;
    piece.userData.wallId = p.wallId || null;
    piece.userData.cutaway = !p.ceiling;
    setShadowFlags(piece);
    s.electricalGroup.add(piece);
  });
  needsRender = true;
}

// The tile around a tub when the walls are "tile around the tub": panels
// on the walls, in the picked wall tile (or a plain tile color).
function rebuildSurround(s) {
  disposeGroup(s.surroundGroup);
  if (!state.surround.length) return;
  var dims = Layout.computeRoomDimensions(state.dims);
  applySurfaceFinish(
    s,
    s.surroundMaterial,
    state.surfacePicks.wallTile || null,
    Layout.colorForWalls("tile", s.isDark),
    roughnessForWalls("tile"),
  );
  state.surround.forEach(function (p) {
    var f = wallFrame(p.wallId, dims.widthFt, dims.lengthFt);
    var span = p.a1 - p.a0;
    var top = Math.min(p.top, dims.heightFt);
    if (!f || !(span > 0) || !(top > 0)) return;
    var mesh = new THREE.Mesh(feetUVs(new THREE.PlaneGeometry(span, top), span, top), s.surroundMaterial);
    var along = (p.a0 + p.a1) / 2;
    mesh.position.set(f.ox + f.dx * along + f.nx * 0.015, top / 2, f.oz + f.dz * along + f.nz * 0.015);
    mesh.rotation.y = Math.atan2(f.nx, f.nz);
    mesh.receiveShadow = true;
    s.surroundGroup.add(mesh);
  });
  needsRender = true;
}

// Aims the raycaster through a page point. false when the canvas has no size.
function pointerRay(s, clientX, clientY) {
  var rect = s.renderer.domElement.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;
  s.raycaster.setFromCamera(
    new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1),
    s.camera,
  );
  return true;
}

// Called after every frame drawn, see onFrame().
var frameListeners = [];

function notifyFrame() {
  frameListeners.slice().forEach(function (fn) {
    try {
      fn();
    } catch (err) {
      console.error(err);
    }
  });
}

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------
function markDirty() {
  dirty = true;
}

// Called after every redraw of the room (a pick, a new plan, a model
// arriving), so the studio can keep its lists and the estimate in step
// with what the room shows. See onChange().
var changeListeners = [];

function notifyChange() {
  changeListeners.slice().forEach(function (fn) {
    try {
      fn();
    } catch (err) {
      console.error(err);
    }
  });
}

var unavailableAnnounced = false;

window.BathroomRoom3D = {
  available: false,

  // Starts drawing the room. Without WebGL (or if it fails to start) the
  // panel is hidden again and "bathroomroom3d:unavailable" fires once;
  // otherwise "bathroomroom3d:ready" fires once the scene exists.
  show: function () {
    var panel = document.getElementById(PANEL_ID);
    if (panel) panel.hidden = false;
    // ensureScene()'s first-ever call does real synchronous work (PMREM
    // environment generation, shader compilation) — deferred one frame so
    // the browser gets to paint the page first.
    requestAnimationFrame(function () {
      if (panel && panel.hidden) return; // hidden again before this ran
      var first = threeState === null;
      var s = ensureScene();
      if (!s) {
        if (panel) panel.hidden = true;
        if (!unavailableAnnounced) {
          unavailableAnnounced = true;
          document.dispatchEvent(new CustomEvent("bathroomroom3d:unavailable"));
        }
        return;
      }
      if (first) document.dispatchEvent(new CustomEvent("bathroomroom3d:ready"));
      if (s.running) return;
      s.running = true;
      s.renderer.setAnimationLoop(function tick() {
        if (dirty) {
          rebuild();
          dirty = false;
          needsRender = true;
          notifyChange();
        }
        if (s.cameraLerp) {
          applyCameraLerp(s);
          needsRender = true;
        }
        // Always ticked (cheap, no draw): keeps damping inertia settling
        // and fires the "change" listener above for as long as the camera
        // is actually still moving.
        s.controls.update();
        if (needsRender) {
          applyCutaway(s, s.camera);
          s.renderer.render(s.scene, s.camera);
          needsRender = false;
          notifyFrame();
        }
      });
    });
  },

  hide: function () {
    var panel = document.getElementById(PANEL_ID);
    if (panel) panel.hidden = true;
    if (threeState) {
      threeState.renderer.setAnimationLoop(null);
      threeState.running = false;
    }
  },

  // The room's inside size, feet.
  setRoomSize: function (widthFt, lengthFt, heightFt) {
    state.dims = { widthFt: widthFt, lengthFt: lengthFt, heightFt: heightFt };
    markDirty();
  },

  // How the floor, walls and ceiling look, by js/bathroom-pricing.js scope
  // key: floorFinish, walls, paintCeiling.
  setScope: function (fieldKey, value) {
    if (state.scope[fieldKey] === value) return;
    state.scope[fieldKey] = value;
    markDirty();
  },

  // What stands in the room: js/room-plan.js toPlacements().
  setPlan: function (placements) {
    state.plan = Array.isArray(placements) ? placements.slice() : [];
    markDirty();
  },

  // Each kind of fixture's size with the products picked (or `picks`), in
  // js/room-plan.js's terms: { type: { span, depth, height } }.
  itemSizes: function (picks) {
    return planSizes(picks);
  },

  // fn(sizes) answers whether the design still works with those fixture
  // sizes. A product that would break it is offered disabled, "too big".
  setFitCheck: function (fn) {
    planFitCheck = typeof fn === "function" ? fn : null;
  },

  // Shows optionId in slotId's place. Unknown ids are ignored.
  setProductPick: function (slotId, optionId) {
    var slot = productSlot(slotId);
    if (!slot || !productOption(slot, optionId) || state.productPicks[slotId] === optionId) return;
    state.productPicks[slotId] = optionId;
    markDirty();
  },

  getProductPicks: function () {
    return Object.assign({}, state.productPicks);
  },

  // Calls fn after every redraw of the room (a pick, a change to the plan,
  // a model arriving). Returns a function that stops calling it.
  onChange: function (fn) {
    changeListeners.push(fn);
    return function () {
      changeListeners = changeListeners.filter(function (other) {
        return other !== fn;
      });
    };
  },

  // The product choices for the fixtures in the room, by fixture: [{ id,
  // label, slots: [{ id, label, value, options: [{ id, label, reason }] }]
  // }]. reason is set on an option that can't be picked, saying why.
  getProductGroups: function () {
    var cur = currentLayout();
    var sel = selectedProducts();
    return PRODUCT_GROUPS.map(function (group) {
      var slots = PRODUCT_SLOTS.filter(function (slot) {
        return productGroupOf(slot) === group.id && slotShown(slot, cur.placedKeys, sel);
      }).map(function (slot) {
        return {
          id: slot.id,
          label: T("room3d.slot." + slot.id),
          value: sel[slot.id].id,
          options: slotOptionStates(slot, sel, true),
        };
      });
      return { id: group.id, label: T("room3d.group." + group.id), slots: slots };
    }).filter(function (g) {
      return g.slots.length > 0;
    });
  },

  // Swaps any stand-in still showing for this fixture (the generic toilet,
  // the plain mirror) for its first Kohler product that fits.
  useRealProducts: function (groupId) {
    var changed = false;
    PRODUCT_SLOTS.forEach(function (slot) {
      if (!slot.body || productGroupOf(slot) !== groupId) return;
      var sel = selectedProducts();
      if (optionMmns(slot, sel[slot.id], sel).length) return;
      var pick = slot.options.filter(function (opt) {
        return (
          optionMmns(slot, opt, sel).length && (!opt.available || opt.available(sel)) && !productWouldDrop(slot, opt)
        );
      })[0];
      if (pick) {
        state.productPicks[slot.id] = pick.id;
        changed = true;
      }
    });
    if (changed) markDirty();
    return changed;
  },

  // Turns the camera to frame a fixture's products; null goes back to the
  // whole room. Returns whether there was anything to frame.
  focusProductGroup: function (groupId) {
    var s = threeState;
    if (!s) return false;
    if (!groupId) {
      frameRoom(s, true);
      return true;
    }
    var group = productGroupDef(groupId);
    if (!group) return false;
    if (state.cameraMode === "walkin") {
      state.cameraMode = "orbit";
      s.controls.enablePan = true;
      setFov(s, ORBIT_FOV);
    }
    // The fixtures may not be drawn yet: frame them once the next rebuild
    // has placed them.
    if (dirty) {
      s.pendingFocus = group;
      return true;
    }
    return focusCameraOn(s, group);
  },

  // What to price or list: one item per showing product slot of each placed
  // fixture, with the Kohler model numbers it puts in the room and how many
  // of that fixture are placed. [{ groupId, slotId, slotLabel, optionId,
  // productLabel, mmns: [...], qty, needsValve, needsWiring }]. A stand-in
  // with no Kohler product comes with no mmns.
  getProductPricingItems: function () {
    var cur = currentLayout();
    var sel = selectedProducts();
    var items = [];
    PRODUCT_SLOTS.forEach(function (slot) {
      if (!slotShown(slot, cur.placedKeys, sel)) return;
      var opt = sel[slot.id];
      var mmns = optionMmns(slot, opt, sel);
      if (!mmns.length && (opt.id === "none" || slot.id === "showerWalls")) return;
      var qty = cur.layout.placements.filter(function (p) {
        return p.fixtureKey === slot.fixtureKey && !(slot.skip && slot.skip(p));
      }).length;
      Object.keys(ELECTRICAL_SLOT_KEYS).forEach(function (kind) {
        if (ELECTRICAL_SLOT_KEYS[kind] !== slot.fixtureKey) return;
        qty = (state.electrical || []).filter(function (p) {
          return p.kind === kind;
        }).length;
      });
      if (!qty) return;
      items.push({
        groupId: productGroupOf(slot),
        slotId: slot.id,
        slotLabel: T("room3d.slot." + slot.id),
        optionId: opt.id,
        productLabel: T("room3d.option." + opt.id),
        mmns: mmns,
        qty: qty,
        needsValve: !!opt.needsValve,
        needsWiring: !!opt.needsWiring,
      });
    });
    return items;
  },

  // Tints every fixture of this kind toward colorHex (null: back to its own
  // color).
  setFixtureFinish: function (fixtureKey, colorHex) {
    if (colorHex == null) delete state.fixtureFinishes[fixtureKey];
    else state.fixtureFinishes[fixtureKey] = colorHex;
    if (threeState) {
      updateFixtureFinishInstances(threeState, fixtureKey, colorHex);
      needsRender = true;
    } else {
      markDirty();
    }
  },

  // A real floor tile / wall tile / flooring / paint for the room's
  // surfaces (categoryKey: floorTile, wallTile, flooring, wallPaint,
  // ceilingPaint; product: a js/materials-pricing.js catalog option). The
  // floor, walls or ceiling show it — its tile size, layout, color, grout
  // and sheen — while the matching scope holds. null clears it.
  setSurfaceFinish: function (categoryKey, product) {
    var spec = Surfaces ? Surfaces.specFor(product) : null;
    if (spec) state.surfacePicks[categoryKey] = spec;
    else delete state.surfacePicks[categoryKey];
    if (threeState) {
      rebuildFinishes(threeState);
      rebuildSurround(threeState);
      needsRender = true;
    } else {
      markDirty();
    }
  },

  // Which picked product (by catalog id) each surface shows right now; null
  // where the plain color shows instead.
  getSurfaceFinishes: function () {
    var picked = Surfaces
      ? Surfaces.resolveSurfaces(state.scope, state.surfacePicks)
      : { floor: null, walls: null, ceiling: null };
    return {
      floor: picked.floor ? picked.floor.id : null,
      walls: picked.walls ? picked.walls.id : null,
      ceiling: picked.ceiling ? picked.ceiling.id : null,
    };
  },

  // The outlets, switches, lights and fan to draw (js/room-plan.js
  // toElectricalPlacements()).
  setElectrical: function (points) {
    state.electrical = Array.isArray(points) ? points.slice() : [];
    markDirty();
  },

  // Shows only these fixtures (item ids), so nothing stands in front of
  // the one being worked on; null shows the whole room again.
  setIsolate: function (itemIds) {
    var next = Array.isArray(itemIds) && itemIds.length ? itemIds.slice() : null;
    var same = (!next && !state.isolate) || (next && state.isolate && next.join("|") === state.isolate.join("|"));
    if (same) return;
    state.isolate = next;
    needsRender = true;
    if (threeState) applyCutaway(threeState, threeState.camera);
  },

  // The electrical point under a page point: { id, point: { x, y, z } }.
  pickElectrical: function (clientX, clientY) {
    var s = threeState;
    if (!s || !pointerRay(s, clientX, clientY)) return null;
    var hits = s.raycaster.intersectObjects(s.electricalGroup.children, true);
    for (var i = 0; i < hits.length; i++) {
      var o = hits[i].object;
      while (o && o.parent !== s.electricalGroup) o = o.parent;
      if (o && o.visible && o.userData.pointId) {
        var at = hits[i].point;
        return { id: o.userData.pointId, point: { x: at.x, y: at.y, z: at.z } };
      }
    }
    return null;
  },

  // Where a page point lands on the room's walls: { x, y, z, wallId }, or
  // null when it misses them. Only walls the camera is inside of count, so
  // a drag never jumps to a wall that isn't drawn.
  wallHit: function (clientX, clientY) {
    var s = threeState;
    if (!s || !pointerRay(s, clientX, clientY)) return null;
    var dims = Layout.computeRoomDimensions(state.dims);
    var plane = { N: 0, E: dims.widthFt, S: dims.lengthFt, W: 0 };
    var cam = s.camera.position;
    var best = null;
    Object.keys(WALL_INWARD_NORMAL).forEach(function (id) {
      var n = WALL_INWARD_NORMAL[id];
      var inside = id === "N" || id === "S" ? (cam.z - plane[id]) * n.z : (cam.x - plane[id]) * n.x;
      if (inside <= 0) return;
      var normal = new THREE.Vector3(n.x, 0, n.z);
      // The plane through the wall: n . x = n . (a point on it).
      var onWall = new THREE.Vector3(id === "E" ? plane.E : 0, 0, id === "S" ? plane.S : 0);
      var hit = new THREE.Vector3();
      if (!s.raycaster.ray.intersectPlane(new THREE.Plane(normal, -normal.dot(onWall)), hit)) return;
      if (hit.x < -0.1 || hit.x > dims.widthFt + 0.1 || hit.z < -0.1 || hit.z > dims.lengthFt + 0.1) return;
      if (hit.y < 0 || hit.y > dims.heightFt) return;
      var away = hit.distanceTo(cam);
      if (!best || away < best.away) best = { x: hit.x, y: hit.y, z: hit.z, wallId: id, away: away };
    });
    return best ? { x: best.x, y: best.y, z: best.z, wallId: best.wallId } : null;
  },

  // Moves one electrical point while it's dragged, without redrawing.
  previewElectrical: function (pointId, pose) {
    var s = threeState;
    if (!s) return;
    s.electricalGroup.children.forEach(function (inst) {
      if (inst.userData.pointId !== pointId) return;
      inst.position.set(pose.x, pose.y, pose.z);
      inst.rotation.y = pose.rotationY || 0;
      if (pose.wallId) inst.userData.wallId = pose.wallId;
    });
    applyStudioView(s);
    needsRender = true;
  },

  // Tile panels on the walls (a tub surround): [{ wallId, a0, a1, top }],
  // feet along the wall from its left end (as js/room-plan.js measures)
  // and up from the floor.
  setSurround: function (panels) {
    state.surround = (Array.isArray(panels) ? panels : []).filter(function (p) {
      return p && WALL_INWARD_NORMAL[p.wallId] && isFinite(p.a0) && isFinite(p.a1) && isFinite(p.top);
    });
    if (threeState) rebuildSurround(threeState);
  },

  // --- For the studio's pointer and labels ------------------------------

  // The fixture under a page point: { itemId, point: { x, y, z } } (feet)
  // or null.
  pickItem: function (clientX, clientY) {
    var s = threeState;
    if (!s || !pointerRay(s, clientX, clientY)) return null;
    var hits = s.raycaster.intersectObjects(s.fixtureGroup.children, true);
    for (var i = 0; i < hits.length; i++) {
      var o = hits[i].object;
      while (o && o.parent !== s.fixtureGroup) o = o.parent;
      if (o && o.visible && o.userData.itemId) {
        var p = hits[i].point;
        return { itemId: o.userData.itemId, point: { x: p.x, y: p.y, z: p.z } };
      }
    }
    return null;
  },

  // The room point under a page point, on the level plane at height y feet
  // (the floor by default): { x, z }, or null when the pointer is above
  // the horizon.
  floorPoint: function (clientX, clientY, y) {
    var s = threeState;
    if (!s || !pointerRay(s, clientX, clientY)) return null;
    var hit = new THREE.Vector3();
    var plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(y || 0));
    if (!s.raycaster.ray.intersectPlane(plane, hit)) return null;
    return { x: hit.x, z: hit.z };
  },

  // Shows a fixture at { x, z, rotationY, wall } (toPlacements() terms) without
  // redrawing the room, while it's dragged. The next setPlan() puts
  // everything back where the plan says.
  // Where the camera is, in room feet: { x, y, z }, or null.
  cameraPosition: function () {
    var s = threeState;
    if (!s) return null;
    return { x: s.camera.position.x, y: s.camera.position.y, z: s.camera.position.z };
  },

  previewItem: function (itemId, pose) {
    var s = threeState;
    if (!s) return;
    s.fixtureGroup.children.forEach(function (inst) {
      if (inst.userData.itemId !== itemId) return;
      var p = inst.userData.pose;
      inst.position.set(pose.x, p.y, pose.z);
      inst.rotation.y = pose.rotationY;
      if (p.depthOffset) inst.translateZ(p.depthOffset);
      if (pose.wall) inst.userData.wallId = pose.wall;
    });
    applyStudioView(s);
  },

  // Outlines the selected fixture in tone ("select", "ok", "warn" or
  // "error") and, fainter, the one under the pointer. null for none.
  setHighlight: function (selectedId, tone, hoverId) {
    studioView.selected = selectedId || null;
    studioView.tone = tone || "select";
    studioView.hover = hoverId || null;
    applyStudioView(threeState);
  },

  // Marks on the floor (clear floor space, a door's swing, a fixture's
  // footprint): [{ x0, x1, z0, z1, tone, fill }] or [{ arc, tone, fill }],
  // see rebuildMarks().
  setMarks: function (marks) {
    studioView.marks = Array.isArray(marks) ? marks.slice(0, 80) : [];
    if (threeState) rebuildMarks(threeState);
  },

  // "orbit" (around the room) or "walk" (standing in the first doorway).
  // Returns the view showing, "orbit" when there's no doorway to stand in.
  setView: function (mode) {
    var s = threeState;
    if (!s) return "orbit";
    var walk = mode === "walk" && (s.lastEntryPlacements || []).length > 0;
    state.cameraMode = walk ? "walkin" : "orbit";
    state.walkInEntryIndex = walk ? s.lastEntryPlacements[0].index : 0;
    applyCameraMode(s);
    return walk ? "walk" : "orbit";
  },

  // Back to the view of the whole room.
  resetView: function () {
    var s = threeState;
    if (!s) return;
    state.cameraMode = "orbit";
    applyCameraMode(s);
  },

  // Calls fn after every frame drawn (the camera moved, the room changed),
  // for labels that follow the room. Returns a function that stops it.
  onFrame: function (fn) {
    frameListeners.push(fn);
    return function () {
      frameListeners = frameListeners.filter(function (other) {
        return other !== fn;
      });
    };
  },

  // Where a room point (feet) shows, in CSS pixels from the canvas's top
  // left: { x, y, visible } (visible false behind the camera).
  project: function (x, y, z) {
    var s = threeState;
    if (!s) return null;
    var v = new THREE.Vector3(x, y, z).project(s.camera);
    var canvas = s.renderer.domElement;
    return {
      x: ((v.x + 1) / 2) * canvas.clientWidth,
      y: ((1 - v.y) / 2) * canvas.clientHeight,
      visible: v.z > -1 && v.z < 1,
    };
  },

  // The page point at the middle of a fixture, or null (for tests driving
  // a drag).
  itemScreenPoint: function (itemId) {
    var s = threeState;
    if (!s) return null;
    var box = itemBox(s, itemId);
    if (box.isEmpty()) return null;
    var c = box.getCenter(new THREE.Vector3());
    var v = c.project(s.camera);
    var rect = s.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  },

  // A picture of the whole room from the overview angle, without the
  // studio's outlines and marks: a JPEG data URL, or null.
  snapshot: function (width, height) {
    var s = threeState;
    if (!s) return null;
    width = width || 1200;
    height = height || 800;
    var size = s.renderer.getSize(new THREE.Vector2());
    var ratio = s.renderer.getPixelRatio();
    var camera = s.camera.clone();
    camera.fov = ORBIT_FOV;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    var pose = overviewPose(s, camera.aspect);
    camera.position.copy(pose.position);
    camera.lookAt(pose.target);
    var shown = [s.markGroup.visible, s.selectBox.visible, s.hoverBox.visible];
    s.markGroup.visible = s.selectBox.visible = s.hoverBox.visible = false;
    var url = null;
    try {
      s.renderer.setPixelRatio(1);
      s.renderer.setSize(width, height, false);
      applyCutaway(s, camera);
      s.renderer.render(s.scene, camera);
      url = s.renderer.domElement.toDataURL("image/jpeg", 0.9);
    } catch (err) {
      console.warn("3D preview: couldn't take a picture of the room.", err);
    }
    s.markGroup.visible = shown[0];
    s.selectBox.visible = shown[1];
    s.hoverBox.visible = shown[2];
    s.renderer.setPixelRatio(ratio);
    s.renderer.setSize(size.x, size.y, false);
    applyCutaway(s, s.camera);
    needsRender = true;
    return url;
  },
};
