// Painted clay statues (彩塑), built from primitives. One per seated agent.
// Look follows Song court dress: civil officials in 展脚幞头 (the long-winged hat) holding a 笏,
// martial ones in helmet and shoulder armour. Colours are the mural mineral pigments.
// Every choice comes from a hash of the agent id, so an agent always looks the same.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { generationCn, nameOnTablet } from "./seating.js";

export const PIGMENT = {
  azurite: 0x2f5b8a, malachite: 0x3d8a6e, cinnabar: 0xa8382a, ochre: 0xb07a3a,
  chalk: 0xe6dcc6, ink: 0x2a2420, gold: 0xc39a45, lacquer: 0x1d1916, stone: 0x8e8c80,
};
const ROBES = [PIGMENT.azurite, PIGMENT.malachite, PIGMENT.cinnabar, PIGMENT.ochre, 0x4a6b4f, 0x6b3b2e];
const SKINS = [0xd9ab8c, 0xcf9a78, 0xe2c2a6, 0xc4886a];

// Flat bands of light, like pigment laid inside an ink outline.
const ramp = (() => {
  const t = new THREE.DataTexture(new Uint8Array([120, 175, 225, 255]), 4, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true;
  return t;
})();
const matCache = new Map();
export function paint(color) {
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshToonMaterial({ color, gradientMap: ramp }));
  return matCache.get(color);
}

function hash(s) {
  let h = 2166136261;
  for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];

function mesh(geo, color, parent, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  const m = new THREE.Mesh(geo, paint(color));
  m.position.set(...pos); m.rotation.set(...rot); m.scale.set(...scale);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** 须弥座: the stepped pedestal every statue (and every empty seat) stands on. */
export function pedestal(width, depth, height = 0.45) {
  const g = new THREE.Group();
  mesh(new THREE.BoxGeometry(width, height * 0.3, depth), PIGMENT.stone, g, [0, height * 0.15, 0]);
  mesh(new THREE.BoxGeometry(width * 0.86, height * 0.4, depth * 0.86), PIGMENT.cinnabar, g, [0, height * 0.5, 0]);
  mesh(new THREE.BoxGeometry(width * 1.02, height * 0.3, depth * 1.02), PIGMENT.stone, g, [0, height * 0.85, 0]);
  g.userData.top = height;
  return g;
}

function robeGeometry(seated) {
  // Lathe profile (radius, height): wide hem, waist, chest, shoulders, neck.
  const pts = seated
    ? [[0.001, 0], [0.42, 0], [0.4, 0.15], [0.3, 0.45], [0.31, 0.7], [0.34, 0.84], [0.12, 0.94], [0.001, 0.95]]
    : [[0.001, 0], [0.44, 0], [0.41, 0.12], [0.3, 0.6], [0.27, 0.95], [0.3, 1.22], [0.33, 1.38], [0.12, 1.5], [0.001, 1.51]];
  return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 20);
}

// ------------------------------------------------------------------ custom models

/** 鼎: a bronze tripod censer, with one incense stick per day the agent served (up to 12). */
function censer(parent, days, z) {
  const g = new THREE.Group(); g.position.set(0, 0, z); parent.add(g);
  const bowl = new THREE.LatheGeometry([[0.001, 0.2], [0.13, 0.21], [0.17, 0.28], [0.18, 0.38], [0.16, 0.42], [0.001, 0.42]]
    .map(([r, y]) => new THREE.Vector2(r, y)), 16);
  mesh(bowl, BRONZE, g);
  for (let i = 0; i < 3; i++) {                                         // three legs
    const a = (i / 3) * Math.PI * 2;
    mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.22, 6), BRONZE, g, [Math.cos(a) * 0.11, 0.11, Math.sin(a) * 0.11]);
  }
  for (const s of [-1, 1]) mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 10, Math.PI), BRONZE, g, [s * 0.15, 0.45, 0], [0, Math.PI / 2, 0]); // ears
  const n = Math.min(12, Math.max(1, days));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, rr = n > 1 ? 0.06 + (i % 2) * 0.03 : 0;
    mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.26, 4), 0x7a3b22, g, [Math.cos(a) * rr, 0.53, Math.sin(a) * rr]);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), EMBER);
    tip.position.set(Math.cos(a) * rr, 0.665, Math.sin(a) * rr); tip.userData.keep = true; g.add(tip);
  }
}

/** A polearm standing at the statue's side: 戟 (halberd) or, for a red-faced general, 偃月刀 (crescent glaive). */
function polearm(parent, kind, x) {
  const g = new THREE.Group(); g.position.set(x, 0, 0.12); parent.add(g);
  mesh(new THREE.CylinderGeometry(0.022, 0.022, 2.3, 8), PIGMENT.cinnabar, g, [0, 1.15, 0]);
  for (const y of [0.4, 1.0, 1.6]) mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 8), PIGMENT.gold, g, [0, y, 0]);
  const blade = new THREE.Shape();
  if (kind === "glaive") {
    // A broad crescent on the long side, a notch on the back.
    blade.moveTo(0, 0); blade.quadraticCurveTo(0.26, 0.12, 0.2, 0.62); blade.quadraticCurveTo(0.08, 0.38, 0, 0.42); blade.lineTo(0, 0);
  } else {
    // 戟: a spear point and a crescent side blade.
    blade.moveTo(0, 0); blade.lineTo(0.03, 0.34); blade.lineTo(0, 0.46); blade.lineTo(-0.03, 0.34); blade.lineTo(0, 0);
    blade.moveTo(0.02, 0.12); blade.quadraticCurveTo(0.2, 0.08, 0.22, 0.26); blade.quadraticCurveTo(0.12, 0.18, 0.02, 0.2); blade.lineTo(0.02, 0.12);
  }
  const geo = new THREE.ExtrudeGeometry(blade, { depth: 0.012, bevelEnabled: false });
  geo.translate(0, 0, -0.006);
  mesh(geo, STEEL, g, [0, 2.28, 0]);
}

const BRONZE = 0x6a5530, STEEL = 0x8e9a98, GILT = 0xc9a23a, GILT_FACE = 0xe2c060;
const EMBER = new THREE.MeshBasicMaterial({ color: 0xff8a3a });

/** Merge every mesh under root that shares a material into one mesh: a few draw calls per statue
 *  instead of about 25. Meshes marked userData.keep (tablet, embers) stay as they are. */
function mergeByMaterial(root) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const buckets = new Map(), done = [];
  root.traverse((o) => {
    if (!o.isMesh || o.userData.keep) return;
    // Every input non-indexed: extruded shapes are, and mergeGeometries needs them all alike.
    let geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    for (const k of Object.keys(geo.attributes)) if (!["position", "normal", "uv"].includes(k)) geo.deleteAttribute(k);
    if (!buckets.has(o.material)) buckets.set(o.material, []);
    buckets.get(o.material).push(geo); done.push(o);
  });
  for (const o of done) o.parent.remove(o);
  for (const [material, geos] of buckets) {
    const m = new THREE.Mesh(mergeGeometries(geos, false), material);
    m.castShadow = m.receiveShadow = true; root.add(m);
  }
}

/** A statue for one agent. tier: main | companion | hall | wings. Faces +z, stands on y = 0.
 *  honour (shared/insights.js honours()): gilded = top 10% by merit, days = days served,
 *  percentile = merit rank among working agents; they set gilding, incense sticks and height. */
export function statue(agent, tier, honour = {}) {
  const r = hash(agent.id);
  const seated = tier === "main";
  const martial = tier !== "main" && r() < 0.42;
  const painted = pick(r, ROBES);
  // 金身: honoured statues are gilded all over, robe included, as such statues were in temples.
  const robe = honour.gilded ? GILT : painted;
  const redFace = r() < 0.06;                            // now and then a red face, as painted generals have
  // 金身: the top 10% by merit are gilded, face and hands and trim, as honoured statues were.
  const trim = honour.gilded || r() < 0.6 ? PIGMENT.gold : PIGMENT.chalk;
  const skin = honour.gilded ? GILT_FACE : redFace ? 0x9c4030 : pick(r, SKINS);
  // Height within a group follows merit: up to 8% shorter or taller than the group's size.
  const scale = { main: 1.55, companion: 1.2, hall: 1.0, wings: 0.86 }[tier] * (0.92 + 0.16 * (honour.percentile ?? 0.5));

  const g = new THREE.Group();
  const base = pedestal(seated ? 1.9 : 1.0, seated ? 1.5 : 0.8);
  g.add(base);
  const fig = new THREE.Group();
  fig.position.y = base.userData.top;
  g.add(fig);

  let shoulderY;
  if (seated) {
    // Throne, lap and footstool, then a shorter torso.
    // Black-lacquer throne edged in gold, then thighs, a robe draped over the front, a footstool.
    mesh(new THREE.BoxGeometry(1.3, 0.55, 0.9), PIGMENT.lacquer, fig, [0, 0.27, -0.1]);
    mesh(new THREE.BoxGeometry(1.36, 0.06, 0.96), PIGMENT.gold, fig, [0, 0.56, -0.1]);
    mesh(new THREE.BoxGeometry(1.2, 1.1, 0.1), PIGMENT.lacquer, fig, [0, 1.1, -0.56]);
    mesh(new THREE.BoxGeometry(1.28, 0.08, 0.14), PIGMENT.gold, fig, [0, 1.66, -0.56]);
    for (const s of [-1, 1]) mesh(new THREE.CapsuleGeometry(0.15, 0.5, 4, 10), robe, fig, [s * 0.2, 0.68, 0.12], [Math.PI / 2, 0, 0]);
    mesh(new THREE.CylinderGeometry(0.3, 0.46, 0.62, 4), robe, fig, [0, 0.33, 0.42], [0, Math.PI / 4, 0], [1, 1, 0.45]);
    mesh(new THREE.BoxGeometry(0.9, 0.12, 0.35), PIGMENT.lacquer, fig, [0, 0.06, 0.66]); // footstool
    const torso = mesh(robeGeometry(true), robe, fig, [0, 0.55, -0.12], [0, 0, 0], [1, 1, 0.78]);
    shoulderY = torso.position.y + 0.84;
  } else {
    mesh(robeGeometry(false), robe, fig, [0, 0, 0], [0, 0, 0], [1, 1, 0.78]);
    mesh(new THREE.CylinderGeometry(0.43, 0.45, 0.07, 20), trim, fig, [0, 0.04, 0], [0, 0, 0], [1, 1, 0.78]); // hem band
    shoulderY = 1.38;
  }
  // Belt.
  mesh(new THREE.TorusGeometry(0.29, 0.03, 6, 20), martial ? PIGMENT.gold : PIGMENT.chalk, fig,
       [0, seated ? 1.12 : 0.95, seated ? -0.12 : 0], [Math.PI / 2, 0, 0], [1, 0.78, 1]);

  // Big Song sleeves hanging to the hands, which meet at the chest holding a 笏.
  const handY = shoulderY - 0.3, handZ = seated ? 0.22 : 0.3;
  for (const s of [-1, 1]) {
    const from = new THREE.Vector3(s * 0.3, shoulderY - 0.04, seated ? -0.12 : 0);
    const to = new THREE.Vector3(s * 0.09, handY, handZ);
    const len = from.distanceTo(to);
    const sleeve = mesh(new THREE.CylinderGeometry(0.1, 0.17, len, 10), robe, fig);
    sleeve.position.copy(from).lerp(to, 0.5);
    sleeve.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), from.clone().sub(to).normalize());
    mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.06, 10), trim, fig, to.toArray(), [0.4, 0, s * 0.3]);
  }
  mesh(new THREE.BoxGeometry(0.07, 0.3, 0.02), PIGMENT.chalk, fig, [0, handY + 0.05, handZ + 0.06], [-0.2, 0, 0]); // 笏, held at the chest

  if (martial && r() < 0.7) polearm(fig, redFace ? "glaive" : "halberd", 0.46);
  if (martial) {
    for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.22, 0.06, 0.3), PIGMENT.gold, fig, [s * 0.3, shoulderY, 0], [0, 0, s * -0.45]);
    mesh(new THREE.BoxGeometry(0.46, 0.34, 0.06), PIGMENT.ochre, fig, [0, shoulderY - 0.24, 0.21]);  // breastplate
  }

  // Neck, head, beard.
  const headY = shoulderY + 0.24, headZ = seated ? -0.12 : 0;
  mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 8), skin, fig, [0, shoulderY + 0.07, headZ]);
  mesh(new THREE.SphereGeometry(0.13, 16, 12), skin, fig, [0, headY, headZ], [0, 0, 0], [0.95, 1.15, 1]);
  // Painted face: eyes and brows; a beard for some.
  for (const s of [-1, 1]) {
    mesh(new THREE.SphereGeometry(0.016, 6, 4), PIGMENT.ink, fig, [s * 0.045, headY + 0.02, headZ + 0.118]);
    mesh(new THREE.BoxGeometry(0.06, 0.012, 0.01), PIGMENT.ink, fig, [s * 0.05, headY + 0.06, headZ + 0.12], [0, 0, s * -0.2]);
  }
  if (r() < 0.55) mesh(new THREE.ConeGeometry(0.045, 0.16 + r() * 0.08, 8), PIGMENT.ink, fig, [0, headY - 0.17, headZ + 0.08], [Math.PI, 0, 0]);

  if (martial) {
    // Helmet with a red crest.
    mesh(new THREE.SphereGeometry(0.15, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), PIGMENT.gold, fig, [0, headY + 0.04, headZ]);
    mesh(new THREE.ConeGeometry(0.035, 0.18, 6), PIGMENT.cinnabar, fig, [0, headY + 0.24, headZ]);
    mesh(new THREE.BoxGeometry(0.34, 0.12, 0.05), PIGMENT.gold, fig, [0, headY - 0.04, headZ - 0.12]);   // neck guard
  } else {
    // 展脚幞头: a black cap with two long, flat wings.
    mesh(new THREE.BoxGeometry(0.26, 0.17, 0.25), PIGMENT.lacquer, fig, [0, headY + 0.15, headZ - 0.01]);
    mesh(new THREE.SphereGeometry(0.11, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), PIGMENT.lacquer, fig, [0, headY + 0.23, headZ - 0.04]);
    mesh(new THREE.BoxGeometry(1.0, 0.025, 0.05), PIGMENT.lacquer, fig, [0, headY + 0.13, headZ - 0.13]);
  }

  // The agent's tablet (牌位) on the front edge of the pedestal.
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.5), tabletMaterial(agent));
  plaque.position.set(0, base.userData.top + 0.25, (seated ? 0.75 : 0.42) + 0.01);
  plaque.userData.keep = true;
  g.add(plaque);
  censer(g, honour.days ?? 1, seated ? 1.15 : 0.75);

  mergeByMaterial(g);
  g.scale.setScalar(scale);
  g.traverse((o) => { o.userData.agentId = agent.id; });
  g.userData.agentId = agent.id;
  return g;
}

/** An empty seat: its pedestal, and nothing on it. */
export function emptySeat(tier) {
  const g = pedestal(tier === "wings" ? 0.86 : 1.0, 0.7);
  g.scale.setScalar(tier === "wings" ? 0.86 : 1);
  return g;
}

// ------------------------------------------------------------------ tablet texture

export function tabletMaterial(agent) {
  const c = document.createElement("canvas");
  c.width = 96; c.height = 240;
  const x = c.getContext("2d");
  x.fillStyle = "#1d1916"; x.fillRect(0, 0, 96, 240);
  x.strokeStyle = "#c39a45"; x.lineWidth = 3; x.strokeRect(6, 6, 84, 228);
  x.fillStyle = "#d9b45f"; x.textAlign = "center"; x.textBaseline = "middle";
  const name = nameOnTablet(agent);
  let y = 22;
  if (/^[㐀-鿿]+$/.test(name)) {
    x.font = '28px "Ma Shan Zheng", "Kaiti SC", serif';
    for (const ch of name) { x.fillText(ch, 48, y + 10); y += 30; }
  } else {
    // A Latin name runs down the tablet, turned on its side, as in vertical Chinese text.
    x.save(); x.font = '24px "IM Fell English", Georgia, serif';
    const w = Math.min(120, x.measureText(name).width);
    x.translate(48, y + w / 2); x.rotate(Math.PI / 2); x.fillText(name, 0, 0, 120); x.restore();
    y += w + 10;
  }
  x.font = '26px "Ma Shan Zheng", "Kaiti SC", serif';
  for (const ch of generationCn(agent)) { if (y > 225) break; x.fillText(ch, 48, y + 12); y += 28; }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: tex });
}
