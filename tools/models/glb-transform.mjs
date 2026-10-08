// Re-roots a .glb's scene under one node that converts it to the 3D
// room's convention (feet, Y up, back at z = 0, centered on x, sitting on
// y = 0), keeping its own materials and textures — for a model whose look
// lives in a texture (a fan grille) that obj-to-glb.mjs would drop.
//
//   node tools/models/glb-transform.mjs in.glb out.glb [--flip] [--drop <regex>] [--keep <in>]
//
// --flip  turn it upside down first (a ceiling fan modeled grille-up)
// --drop  leave out the parts whose material name matches this regex (a
//         fan's housing, which sits above the ceiling out of sight)
// --keep  keep only the triangles within this many inches of the bottom
//         (after --flip): the face that shows below the ceiling
// Input units are meters (glTF's own unit).

import { readFileSync, writeFileSync } from "node:fs";

const [input, output, ...flags] = process.argv.slice(2);
const flip = flags.includes("--flip");
const dropAt = flags.indexOf("--drop");
const drop = dropAt === -1 ? null : new RegExp(flags[dropAt + 1]);
const keepAt = flags.indexOf("--keep");
const keepIn = keepAt === -1 ? null : Number(flags[keepAt + 1]);
const buf = readFileSync(input);
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.slice(20, 20 + jsonLen).toString());
const rest = buf.slice(20 + jsonLen);

if (drop) {
  for (const mesh of gltf.meshes) {
    mesh.primitives = mesh.primitives.filter((p) => !drop.test((gltf.materials[p.material] || {}).name || ""));
  }
  // A mesh left with nothing to draw comes off its node.
  gltf.nodes.forEach((n) => {
    if (n.mesh !== undefined && !gltf.meshes[n.mesh].primitives.length) delete n.mesh;
  });
}


function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k];
  return o;
}
function local(n) {
  if (n.matrix) return n.matrix;
  const t = n.translation || [0, 0, 0];
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1];
  const s = n.scale || [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0,
    2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0,
    2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
// The scene's bounds after `root`, from each POSITION accessor's min/max corners.
function bounds(root) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const walk = (ni, M) => {
    const n = gltf.nodes[ni];
    const W = mul(M, local(n));
    if (n.mesh !== undefined) {
      for (const p of gltf.meshes[n.mesh].primitives) {
        const a = gltf.accessors[p.attributes.POSITION];
        for (let c = 0; c < 8; c++) {
          const v = [0, 1, 2].map((k) => (c >> k) & 1 ? a.max[k] : a.min[k]);
          for (let k = 0; k < 3; k++) {
            const w = W[k] * v[0] + W[4 + k] * v[1] + W[8 + k] * v[2] + W[12 + k];
            min[k] = Math.min(min[k], w);
            max[k] = Math.max(max[k], w);
          }
        }
      }
    }
    for (const c of n.children || []) walk(c, W);
  };
  for (const r of gltf.scenes[gltf.scene || 0].nodes) walk(r, root);
  return { min, max };
}

const FT = 1 / 0.3048;
let root = [FT, 0, 0, 0, 0, flip ? -FT : FT, 0, 0, 0, 0, flip ? -FT : FT, 0, 0, 0, 0, 1];
const b = bounds(root);
root[12] = -(b.min[0] + b.max[0]) / 2;
root[13] = -b.min[1];
root[14] = -b.min[2];
// Triangles reaching higher than --keep inches above the bottom become
// degenerate (all three corners on one vertex), so nothing draws them.
if (keepIn !== null) {
  const bin = rest.slice(8);
  const limit = keepIn / 12;
  const walk = (ni, M) => {
    const n = gltf.nodes[ni];
    const W = mul(M, local(n));
    if (n.mesh !== undefined) {
      for (const p of gltf.meshes[n.mesh].primitives) {
        const pa = gltf.accessors[p.attributes.POSITION];
        const pv = gltf.bufferViews[pa.bufferView];
        const pStride = pv.byteStride || 12;
        const pOff = (pv.byteOffset || 0) + (pa.byteOffset || 0);
        const y = (i) => {
          const o = pOff + i * pStride;
          const v = [bin.readFloatLE(o), bin.readFloatLE(o + 4), bin.readFloatLE(o + 8)];
          return W[1] * v[0] + W[5] * v[1] + W[9] * v[2] + W[13];
        };
        const ia = gltf.accessors[p.indices];
        const iv = gltf.bufferViews[ia.bufferView];
        const size = { 5121: 1, 5123: 2, 5125: 4 }[ia.componentType];
        const iOff = (iv.byteOffset || 0) + (ia.byteOffset || 0);
        const read = (k) => (size === 4 ? bin.readUInt32LE : size === 2 ? bin.readUInt16LE : bin.readUInt8).call(bin, iOff + k * size);
        const write = (k, v) => (size === 4 ? bin.writeUInt32LE : size === 2 ? bin.writeUInt16LE : bin.writeUInt8).call(bin, v, iOff + k * size);
        for (let t = 0; t + 2 < ia.count; t += 3) {
          const tri = [read(t), read(t + 1), read(t + 2)];
          if (tri.some((i) => y(i) > limit)) for (let c = 0; c < 3; c++) write(t + c, tri[0]);
        }
      }
    }
    for (const c of n.children || []) walk(c, W);
  };
  for (const r of gltf.scenes[gltf.scene || 0].nodes) walk(r, root);
}

const scene = gltf.scenes[gltf.scene || 0];
gltf.nodes.push({ name: "room-frame", matrix: root, children: scene.nodes });
scene.nodes = [gltf.nodes.length - 1];

let json = Buffer.from(JSON.stringify(gltf), "utf8");
json = Buffer.concat([json, Buffer.alloc(((json.length + 3) & ~3) - json.length, 0x20)]);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(20 + json.length + rest.length, 8);
header.writeUInt32LE(json.length, 12);
header.writeUInt32LE(0x4e4f534a, 16);
writeFileSync(output, Buffer.concat([header, json, rest]));
const size = [0, 1, 2].map((k) => ((b.max[k] - b.min[k]) * 12).toFixed(1));
console.log(`${output}: ${size.join(" x ")} in. (W x H x D)`);
