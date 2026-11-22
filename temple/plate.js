// 石牌: what you read when you inspect something in the temple. A carved stone tablet rises out of the paving beside
// what you look at, turned toward you, and stays there as an object in the world: walk round it, step back, read it
// at an angle. The letters are cut into the stone (a normal map lets the light catch their edges), the name is in
// gold leaf. E again, or walking away, lowers it.
// The tablet is drawn after the mural effect, like the speech bubbles, so the carving stays sharp; its own lights
// follow the time of day, and a plane at the paving hides the part still below ground as it rises.
import * as THREE from "three";
import { CJK, cjk } from "./fonts.js";

const W = 0.92, H = 1.22, DEPTH = 0.15, BASE = 0.6;    // slab width and height, thickness; base (趺) height, metres
const PX = 1100;                                      // face texture pixels per metre
const RISE = 0.9, SINK = 0.55;                        // seconds
const LATIN = `"IM Fell English", ${CJK}`;
const latin = (px, style = "") => `${style} ${px}px ${LATIN}`.trim();

/**
 * floorAt(x, z): the ground height. Returns { scene, open(content, camera, t, opts), close(t), update(t, camera, light),
 * at, id, text }. Draw `scene` after the painted scene, with depth cleared and renderer.localClippingEnabled on.
 */
export function buildPlates({ floorAt }) {
  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight(0xf6e8cc, 0x3e342a, 1.2);
  const key = new THREE.DirectionalLight(0xffe8c6, 1.55);            // from above and to the left: carving shows
  const lamp = new THREE.PointLight(0xffb066, 0, 7, 1.4);              // at night, a lantern's warmth from beside you
  scene.add(hemi, key, key.target, lamp);
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let plate = null, id = null, text = "";
  const tmp = new THREE.Vector3();

  /**
   * Raise a tablet for `content` ({ seal, name, gen, sub, lines, stats, series, draw, honours, foot }) beside where the camera
   * looks: `side` metres to the right of the line of sight (negative: left), `dist` metres ahead.
   */
  function open(content, camera, t, { side = 0.62, dist = 1.75, key: k = null } = {}) {
    if (plate) dispose(plate);
    const yaw = Math.atan2(-camera.getWorldDirection(tmp).x, -tmp.z);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const x = camera.position.x + fx * dist + rx * side, z = camera.position.z + fz * dist + rz * side;
    const y = floorAt(x, z);
    const group = tablet(content);
    group.position.set(x, y, z);
    group.rotation.y = Math.atan2(camera.position.x - x, camera.position.z - z);   // its face toward the visitor
    group.userData.floor = y;
    scene.add(group);
    plate = { group, t0: t, closing: null, x, z };
    id = k; text = plain(content);
    return text;
  }
  function close(t) { if (plate && plate.closing === null) plate.closing = t; }

  function update(t, camera, { night = false } = {}) {
    if (!plate) return;
    // Walking away lowers it, as a visitor would expect of a thing that rose for them.
    if (plate.closing === null && Math.hypot(camera.position.x - plate.x, camera.position.z - plate.z) > 4.5) plate.closing = t;
    const up = ease(Math.min(1, Math.max(0, (t - plate.t0) / RISE)));
    const down = plate.closing === null ? 0 : Math.min(1, (t - plate.closing) / SINK);
    if (down >= 1) { dispose(plate); plate = null; id = null; text = ""; return; }
    const h = BASE + H + 0.05, f = up * (1 - ease(down));
    plate.group.position.y = plate.group.userData.floor - h * (1 - f);
    ground.constant = -plate.group.userData.floor;
    // Light: daylight from the upper left; at night the sky light fades and a warm lamp stands beside the visitor.
    hemi.intensity = night ? 0.45 : 1.2;
    key.intensity = night ? 0.3 : 1.55;
    key.position.set(plate.group.position.x - 3, plate.group.userData.floor + 5, plate.group.position.z + 2);
    key.target.position.set(plate.x, plate.group.userData.floor + 1, plate.z);
    lamp.intensity = night ? 3.2 : 0;
    lamp.position.copy(camera.position).add(tmp.set(-0.6, 0.2, 0).applyQuaternion(camera.quaternion));
  }

  function tablet(c) {
    const group = new THREE.Group();
    const stone = stoneTexture();
    const side = new THREE.MeshStandardMaterial({ map: stone, color: 0xa9aca3, roughness: 0.94, clippingPlanes: [ground] });
    const shape = outline();
    const slab = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: DEPTH, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 18 }), side);
    slab.position.set(0, BASE, -DEPTH / 2);
    const { map, normalMap } = carve(c);
    const faceGeo = new THREE.ShapeGeometry(shape, 18);
    const uv = faceGeo.attributes.uv, pos = faceGeo.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + W / 2) / W, pos.getY(i) / H);
    const face = new THREE.Mesh(faceGeo, new THREE.MeshStandardMaterial({ map, normalMap, normalScale: new THREE.Vector2(1.6, 1.6), roughness: 0.86, clippingPlanes: [ground] }));
    face.position.set(0, BASE, DEPTH / 2 + 0.0135);
    // 趺: a low stepped base the slab stands in.
    const base = new THREE.Mesh(new THREE.BoxGeometry(W + 0.24, BASE, DEPTH + 0.34), side);
    base.position.y = BASE / 2;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(W + 0.12, 0.06, DEPTH + 0.2), side);
    cap.position.y = BASE + 0.03;
    // Ink outlines, like everything else the mural painted.
    const ink = new THREE.LineBasicMaterial({ color: 0x1d1a17, transparent: true, opacity: 0.75, clippingPlanes: [ground] });
    const edges = [slab, base, cap].map((m) => { const l = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 28), ink); l.position.copy(m.position); return l; });
    group.add(slab, face, base, cap, ...edges);
    group.rotation.order = "YXZ";
    group.children.forEach((m) => { m.renderOrder = 20; });
    return group;
  }

  function dispose(p) {
    scene.remove(p.group);
    p.group.traverse((o) => { o.geometry?.dispose(); for (const m of [].concat(o.material || [])) { m.map?.dispose(); m.normalMap?.dispose(); m.dispose(); } });
  }

  return { scene, open, close, update, get at() { return plate ? { x: plate.x, z: plate.z } : null; }, get id() { return id; }, get text() { return text; } };
}

/** The slab's outline: straight sides, the top corners cut round (抹角), as on a Song stele. */
function outline() {
  const r = 0.2, s = new THREE.Shape();
  s.moveTo(-W / 2, 0); s.lineTo(W / 2, 0); s.lineTo(W / 2, H - r);
  s.quadraticCurveTo(W / 2, H, W / 2 - r, H); s.lineTo(-W / 2 + r, H);
  s.quadraticCurveTo(-W / 2, H, -W / 2, H - r); s.closePath();
  return s;
}

/** The carved face: a colour map (stone, cut letters, gold name) and a normal map from a height map of the cuts.
 *  The face is laid out as blocks; the space left over is shared out between them, so a short record does not leave
 *  the lower half bare and a long one does not crowd. */
function carve(c) {
  const cw = Math.round(W * PX), ch = Math.round(H * PX);
  const col = document.createElement("canvas"); col.width = cw; col.height = ch;
  const hgt = document.createElement("canvas"); hgt.width = cw; hgt.height = ch;
  const g = col.getContext("2d"), hg = hgt.getContext("2d");
  stone2d(g, cw, ch);
  hg.fillStyle = "#fff"; hg.fillRect(0, 0, cw, ch);
  const M = 70, inner = cw - 2 * M;                                  // margin inside the carved border
  for (const [inset, wd] of [[30, 5], [44, 2.5]]) cutPath(g, hg, (x) => roundedTop(x, inset, cw, ch), wd);
  const blocks = [];                                                 // { h, draw(y) }: y is the block's top
  // 额: the seal in a cartouche at the head of the stone.
  if (c.seal) blocks.push({ h: 112, draw: (y) => {
    const sw = 86 * [...c.seal].length + 44;
    cutPath(g, hg, (x) => { x.beginPath(); x.roundRect(cw / 2 - sw / 2, y, sw, 108, 14); }, 4);
    cutText(g, hg, c.seal, cw / 2, y + 56, cjk(74), { fill: "#7a2a1e" });
  } });
  // The name in gold leaf, its generation cut beside it; under it, where it stands.
  const big = [...c.name].length > 5 ? 100 : 146;
  g.font = cjk(big); const nameW = g.measureText(c.name).width;
  g.font = cjk(48); const genW = c.gen ? g.measureText(c.gen).width + 20 : 0;
  const sub = wrap(g, c.sub || "", latin(37), inner - 20).slice(0, 2);
  blocks.push({ h: big + 22 + sub.length * 48, draw: (y) => {
    const nx = cw / 2 - (nameW + genW) / 2;
    cutText(g, hg, c.name, nx + nameW / 2, y + big / 2, cjk(big), { gold: true });
    if (c.gen) cutText(g, hg, c.gen, nx + nameW + 20 + (genW - 20) / 2, y + big * 0.68, cjk(48));
    sub.forEach((l, i) => cutText(g, hg, l, cw / 2, y + big + 30 + i * 48, latin(37)));
  } });
  blocks.push({ h: 20, draw: (y) => rule(g, hg, cw / 2, y + 10, 320) });
  for (const line of c.lines || []) {
    const fs = line.size || 38, font = latin(fs, line.italic ? "italic" : "");
    const ls = wrap(g, line.text, font, inner - 30).slice(0, line.max || 3);
    blocks.push({ h: ls.length * fs * 1.3, draw: (y) => ls.forEach((l, i) => cutText(g, hg, l, cw / 2, y + fs * 0.65 + i * fs * 1.3, font)) });
  }
  // Numbers: up to six, three to a row, the figure large and its name small beneath.
  const stats = (c.stats || []).slice(0, 6);
  if (stats.length) {
    const cols = Math.min(3, stats.length), rows = Math.ceil(stats.length / cols), cellW = inner / cols;
    blocks.push({ h: rows * 140, draw: (y) => stats.forEach((s, i) => {
      const row = Math.floor(i / cols), inRow = Math.min(cols, stats.length - row * cols);   // a short last row is centred
      const cx = cw / 2 + cellW * ((i % cols) - (inRow - 1) / 2), cy = y + row * 140;
      const v = String(s.value), fs = v.length > 8 ? 52 : 76;
      cutText(g, hg, v, cx, cy + 40, latin(fs));
      cutText(g, hg, s.label, cx, cy + 100, latin(31), { color: "#363a38" });
    }) });
  }
  // A chart (a stele's), drawn as the steles draw theirs.
  if (c.draw) blocks.push({ h: 420, draw: (y) => c.draw(g, M + 30, y, inner - 60, 400) });
  // The score, day by day, as a cut line.
  if (c.series?.length > 1) blocks.push({ h: 230, draw: (y) => {
    const x0 = M + 76, x1 = cw - M - 34, top = y + 8, bot = y + 180;
    const vx = (i) => x0 + (i * (x1 - x0)) / (c.series.length - 1), vy = (v) => bot - (Math.max(0, Math.min(100, v)) / 100) * (bot - top);
    for (const v of [0, 50, 100]) {
      cutPath(g, hg, (x) => { x.beginPath(); x.moveTo(x0, vy(v)); x.lineTo(x1, vy(v)); }, v === 50 ? 1.8 : 1.1);
      cutText(g, hg, String(v), x0 - 30, vy(v), latin(25));
    }
    cutPath(g, hg, (x) => { x.beginPath(); c.series.forEach((s, i) => (i ? x.lineTo(vx(i), vy(s.value)) : x.moveTo(vx(i), vy(s.value)))); }, 5.5);
    cutText(g, hg, c.seriesLabel || "Score per work day", cw / 2, bot + 36, latin(28, "italic"), { color: "#363a38" });
  } });
  const honours = (c.honours || []).slice(0, 2);
  if (honours.length) blocks.push({ h: honours.length * 46, draw: (y) => honours.forEach((h, i) => cutText(g, hg, h, cw / 2, y + 22 + i * 46, latin(33), { gold: true })) });
  if (c.foot) blocks.push({ h: 40, draw: (y) => cutText(g, hg, c.foot, cw / 2, y + 20, latin(34)) });
  // Share out the space: the head sits under the border, the rest spread evenly down to the foot.
  const top = 78, bottom = ch - 70, used = blocks.reduce((n, b) => n + b.h, 0);
  const gap = Math.max(18, Math.min(70, (bottom - top - used) / Math.max(1, blocks.length - 1)));
  let y = top;
  for (const b of blocks) { if (y + b.h > bottom + 4) break; b.draw(y); y += b.h + gap; }
  const map = new THREE.CanvasTexture(col); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
  const normalMap = new THREE.CanvasTexture(normals(hg, cw, ch)); normalMap.anisotropy = 8;
  return { map, normalMap };
}

/** Cut text: a dark recess with a lit lower edge in the colour map, a groove in the height map. */
function cutText(g, hg, text, x, y, font, { gold = false, fill = null, color = "#2f3332" } = {}) {
  for (const ctx of [g, hg]) { ctx.font = font; ctx.textAlign = "center"; ctx.textBaseline = "middle"; }
  g.fillStyle = "rgba(236,232,222,.55)"; g.fillText(text, x + 1.6, y + 1.8);           // the lit edge of the cut
  if (gold) {
    const gr = g.createLinearGradient(0, y - 60, 0, y + 60);
    gr.addColorStop(0, "#f3d98e"); gr.addColorStop(0.5, "#c8a04a"); gr.addColorStop(1, "#8c6a28");
    g.fillStyle = gr;
  } else g.fillStyle = fill || color;
  g.fillText(text, x, y);
  hg.fillStyle = "#000"; hg.fillText(text, x, y);
  if (!/[\u3400-\u9fff]/.test(text)) {                              // a hairline more for the thin Latin face
    g.lineWidth = hg.lineWidth = 1.3; g.strokeStyle = g.fillStyle; hg.strokeStyle = "#000";
    g.strokeText(text, x, y); hg.strokeText(text, x, y);
  }
}
function cutPath(g, hg, path, width) {
  for (const [ctx, style, dx] of [[g, "rgba(236,232,222,.5)", 1.4], [g, "#343837", 0], [hg, "#000", 0]]) {
    ctx.save(); ctx.translate(dx, dx); path(ctx); ctx.strokeStyle = style; ctx.lineWidth = width; ctx.stroke(); ctx.restore();
  }
}
function rule(g, hg, x, y, half) {
  cutPath(g, hg, (c) => { c.beginPath(); c.moveTo(x - half, y); c.lineTo(x - 18, y); c.moveTo(x + 18, y); c.lineTo(x + half, y); }, 2.5);
  cutPath(g, hg, (c) => { c.beginPath(); c.moveTo(x, y - 9); c.lineTo(x + 11, y); c.lineTo(x, y + 9); c.lineTo(x - 11, y); c.closePath(); }, 2.5);
}
function roundedTop(x, inset, cw, ch) {
  const r = 0.2 * PX - inset * 0.6;
  x.beginPath(); x.moveTo(inset, ch - inset); x.lineTo(inset, inset + r); x.quadraticCurveTo(inset, inset, inset + r, inset);
  x.lineTo(cw - inset - r, inset); x.quadraticCurveTo(cw - inset, inset, cw - inset, inset + r); x.lineTo(cw - inset, ch - inset); x.closePath();
}

/** Grey-green limestone (青石): an even ground with grain, faint veins and pits. Deterministic. */
function stone2d(g, w, h) {
  g.fillStyle = "#9da197"; g.fillRect(0, 0, w, h);
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${r() < 0.5 ? "40,44,42" : "235,236,228"},${0.03 + r() * 0.05})`; const d = 1 + r() * 3; g.fillRect(r() * w, r() * h, d, d); }
  g.strokeStyle = "rgba(60,66,62,.10)"; g.lineWidth = 1.5;
  for (let i = 0; i < 7; i++) { g.beginPath(); let x = r() * w, y = r() * h; g.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (r() - 0.5) * 140; y += r() * 90; g.lineTo(x, y); } g.stroke(); }
  const v = g.createRadialGradient(w / 2, h * 0.45, w * 0.2, w / 2, h / 2, w * 0.9);
  v.addColorStop(0, "rgba(255,255,255,0)"); v.addColorStop(1, "rgba(30,34,32,.18)");
  g.fillStyle = v; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = "multiply"; g.fillStyle = "rgb(226,212,184)"; g.fillRect(0, 0, w, h);   // the mural's warm paper
  g.globalCompositeOperation = "source-over";
}
let stoneCache = null;
function stoneTexture() {
  if (!stoneCache) { const c = document.createElement("canvas"); c.width = c.height = 256; stone2d(c.getContext("2d"), 256, 256); stoneCache = c; }
  const t = new THREE.CanvasTexture(stoneCache); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A tangent-space normal map from the height map (white = the face, black = cut), at half resolution. */
function normals(hg, w, h) {
  const sw = w >> 1, sh = h >> 1;
  const small = document.createElement("canvas"); small.width = sw; small.height = sh;
  const sg = small.getContext("2d");
  sg.filter = "blur(1.2px)"; sg.drawImage(hg.canvas, 0, 0, sw, sh);
  const src = sg.getImageData(0, 0, sw, sh).data, out = sg.createImageData(sw, sh), o = out.data;
  const at = (x, y) => src[(Math.min(sh - 1, Math.max(0, y)) * sw + Math.min(sw - 1, Math.max(0, x))) * 4] / 255;
  const k = 3.2;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const du = (at(x + 1, y) - at(x - 1, y)) * k, dv = -(at(x, y + 1) - at(x, y - 1)) * k;   // canvas y runs down, v up
    const len = Math.hypot(du, dv, 1), i = (y * sw + x) * 4;
    o[i] = ((-du / len) * 0.5 + 0.5) * 255; o[i + 1] = ((-dv / len) * 0.5 + 0.5) * 255; o[i + 2] = ((1 / len) * 0.5 + 0.5) * 255; o[i + 3] = 255;
  }
  sg.putImageData(out, 0, 0);
  return small;
}

function wrap(g, text, font, max) {
  g.font = font;
  const words = /[㐀-鿿]/.test(text) && !text.includes(" ") ? [...text] : text.split(/(?<=\s)/);
  const out = []; let line = "";
  for (const w of words) {
    if (g.measureText(line + w).width > max && line) { out.push(line.trim()); line = w.trimStart(); } else line += w;
  }
  if (line.trim()) out.push(line.trim());
  return out;
}
const ease = (x) => 1 - (1 - x) ** 3;
/** The tablet's words as plain text, for a screen reader. */
function plain(c) {
  return [c.seal, `${c.name}${c.gen ? " " + c.gen : ""}`, c.sub, ...(c.lines || []).map((l) => l.text),
    ...(c.stats || []).map((s) => `${s.label}: ${s.value}`), ...(c.honours || []), c.foot].filter(Boolean).join(". ");
}
