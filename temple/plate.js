// 手持: what you inspect, held up before you. Look at a stele, a statue, an ancestral tablet or a pilgrim and press E
// (or click): a thing shaped after it comes up into your hands, close enough to read.
//   stele     a small stone stele, its letters cut, its title in gold
//   statue    the black-lacquer tablet from its pedestal, written in gold
//   ancestor  a red-lacquer tablet (牌位) on its base, written in gold
//   pilgrim   a wooden waist token (腰牌) on a red cord, its letters burnt in
// The mouse turns it in your hands (a little, as wrists would); click, E or Esc puts it down. The world behind dims.
// It is drawn after the mural effect, so the writing stays sharp, with its own light: daylight, or a lamp at night.
import * as THREE from "three";
import { CJK, cjk } from "./fonts.js";

const KINDS = {
  stele:    { w: 0.62, h: 0.88, d: 0.09, shape: "stele", palette: "stone", top: 70 },
  statue:   { w: 0.56, h: 0.88, d: 0.045, shape: "gui", palette: "black", top: 150 },
  ancestor: { w: 0.54, h: 0.88, d: 0.045, shape: "crown", palette: "red", top: 140, base: true },
  pilgrim:  { w: 0.52, h: 0.78, d: 0.03, shape: "token", palette: "wood", top: 120, cord: true },
};
const CW = 1000;                                       // face texture width in pixels; height follows the shape
const RISE = 0.5, SINK = 0.32;                         // seconds
const LATIN = `"IM Fell English", ${CJK}`;
const font = (px) => `${px}px ${LATIN}`;

/** Returns { scene, open(content, kind, t, key), close(t), update(t, camera, { night, dt }), tilt(dx, dy),
 *  setTilt(yawDeg, pitchDeg), holding, id, kind, text }. Draw `scene` after the painted scene, depth cleared. */
export function buildHeld() {
  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight(0xf6e8cc, 0x3e342a, 1.15);
  const key = new THREE.DirectionalLight(0xffe8c6, 1.6);
  const lamp = new THREE.PointLight(0xffb066, 0, 4, 1.2);
  scene.add(hemi, key, key.target, lamp);
  // The world behind, dimmed: a dark veil just in front of the eye, darker at the edges.
  const veil = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: vignette(), transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
  veil.renderOrder = -1; scene.add(veil);
  let held = null, id = null, text = "", kindNow = null;
  const aim = { yaw: 0, pitch: 0 }, now = { yaw: 0, pitch: 0 };
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), upv = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, "YXZ");

  function open(content, kind, t, k = null) {
    if (held) dispose(held);
    const spec = KINDS[kind] || KINDS.statue;
    held = { group: build(content, spec), spec, t0: t, closing: null };
    scene.add(held.group);
    aim.yaw = aim.pitch = now.yaw = now.pitch = 0;
    id = k; kindNow = kind; text = plain(content);
    return text;
  }
  function close(t) { if (held && held.closing === null) held.closing = t; }
  /** Turn it by a mouse movement (pixels). */
  function tilt(dx, dy) { aim.yaw = clamp(aim.yaw + dx * 0.09, -24, 24); aim.pitch = clamp(aim.pitch + dy * 0.07, -16, 16); }
  /** Turn it to an angle (degrees), for recordings. */
  function setTilt(yaw, pitch) { aim.yaw = yaw; aim.pitch = pitch; }

  function update(t, camera, { night = false, dt = 1 / 30, drift = true } = {}) {
    if (!held) { veil.material.opacity = 0; return; }
    const up = ease(clamp((t - held.t0) / RISE, 0, 1));
    const down = held.closing === null ? 0 : clamp((t - held.closing) / SINK, 0, 1);
    if (down >= 1) { dispose(held); held = null; id = null; kindNow = null; text = ""; veil.material.opacity = 0; return; }
    const f = up * (1 - ease(down));
    // Distance: the thing fills about four fifths of the view's height, and fits its width too.
    const { w, h } = held.spec, tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), tanH = tanV * camera.aspect;
    const H = h + (held.spec.base ? 0.06 : 0) + (held.spec.cord ? 0.05 : 0);
    const dist = Math.max(H / (0.8 * 2 * tanV), w / (0.86 * 2 * tanH));
    // Ease toward the wrists' angle and drift back to face you; sway a little, as held things do.
    const k = 1 - Math.exp(-dt * 7);
    now.yaw += (aim.yaw - now.yaw) * k; now.pitch += (aim.pitch - now.pitch) * k;
    if (drift) { aim.yaw *= Math.exp(-dt * 0.6); aim.pitch *= Math.exp(-dt * 0.6); }
    const swayYaw = 0.9 * Math.sin(t * 0.7), swayPitch = 0.6 * Math.sin(t * 0.5 + 1);
    camera.getWorldDirection(fwd);
    right.set(1, 0, 0).applyQuaternion(camera.quaternion); upv.set(0, 1, 0).applyQuaternion(camera.quaternion);
    // In front of the eye, coming up from below as it is lifted.
    held.group.position.copy(camera.position).addScaledVector(fwd, dist).addScaledVector(upv, -(1 - f) * H * 1.3 - H * 0.02);
    e.set(THREE.MathUtils.degToRad(now.pitch + swayPitch - 22 * (1 - f)), THREE.MathUtils.degToRad(now.yaw + swayYaw), 0);
    held.group.quaternion.copy(camera.quaternion).multiply(q.setFromEuler(e));
    veil.position.copy(camera.position).addScaledVector(fwd, 0.2);
    veil.quaternion.copy(camera.quaternion);
    veil.scale.set(0.2 * 2 * tanH * 1.1, 0.2 * 2 * tanV * 1.1, 1);
    veil.material.opacity = 0.62 * f;
    // Light from above and to the left of the eye; at night a lamp held beside it.
    key.position.copy(camera.position).addScaledVector(right, -1.2).addScaledVector(upv, 1.6).addScaledVector(fwd, 0.2);
    key.target.position.copy(held.group.position);
    hemi.intensity = night ? 0.45 : 1.15; key.intensity = night ? 0.35 : 1.6;
    lamp.intensity = night ? 2.2 : 0;
    lamp.position.copy(camera.position).addScaledVector(right, 0.45).addScaledVector(upv, -0.1);
  }

  function dispose(p) {
    scene.remove(p.group);
    p.group.traverse((o) => { o.geometry?.dispose(); for (const m of [].concat(o.material || [])) { m.map?.dispose(); m.normalMap?.dispose(); m.dispose(); } });
  }

  return { scene, open, close, update, tilt, setTilt,
    get holding() { return !!held && held.closing === null; }, get shown() { return !!held; },
    get id() { return id; }, get kind() { return kindNow; }, get text() { return text; } };
}

/** The object: a slab of its outline (sides in its material), the written face, and its fittings. */
function build(c, spec) {
  const { w, h, d } = spec, P = PALETTES[spec.palette];
  const group = new THREE.Group();
  const shape = outline(spec);
  const sideMat = new THREE.MeshStandardMaterial({ map: P.sideTexture(), color: P.side, roughness: P.rough });
  const slab = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 20 }), sideMat);
  slab.position.z = -d / 2;
  const ch = Math.round(CW * h / w);
  const { map, normalMap } = face(c, spec, ch);
  const faceGeo = new THREE.ShapeGeometry(shape, 20);
  const uv = faceGeo.attributes.uv, pos = faceGeo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + w / 2) / w, pos.getY(i) / h);
  const front = new THREE.Mesh(faceGeo, new THREE.MeshStandardMaterial({ map, normalMap, normalScale: new THREE.Vector2(1.4, 1.4), roughness: P.rough }));
  front.position.z = d / 2 + 0.0065;
  const ink = new THREE.LineBasicMaterial({ color: 0x1d1a17, transparent: true, opacity: 0.7 });
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(slab.geometry, 30), ink); edges.position.copy(slab.position);
  group.add(slab, front, edges);
  if (spec.base) {                                    // 座: the tablet stands in a low base
    const base = new THREE.Mesh(new THREE.BoxGeometry(w * 1.18, 0.06, d * 2.6), sideMat);
    base.position.y = -0.03; group.add(base);
  }
  if (spec.cord) {                                    // 绳: a red silk cord through the hole at the top
    const silk = new THREE.MeshStandardMaterial({ color: 0x9e2a1c, roughness: 0.7 });
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 8, 24), silk);
    loop.position.set(0, h - 0.045, 0); loop.rotation.y = Math.PI / 2; group.add(loop);
  }
  // Its origin is the slab's middle, so it turns about its centre in the hands.
  group.children.forEach((o) => { o.position.y -= h / 2; o.renderOrder = 5; });
  return group;
}

/** Outlines, origin at the bottom middle. */
function outline({ w, h, shape }) {
  const s = new THREE.Shape(), x = w / 2;
  if (shape === "stele") {                            // straight sides, the top corners cut round
    const r = w * 0.22;
    s.moveTo(-x, 0); s.lineTo(x, 0); s.lineTo(x, h - r); s.quadraticCurveTo(x, h, x - r, h); s.lineTo(-x + r, h); s.quadraticCurveTo(-x, h, -x, h - r);
  } else if (shape === "gui") {                       // 圭: a pointed top
    const p = w * 0.3;
    s.moveTo(-x, 0); s.lineTo(x, 0); s.lineTo(x, h - p); s.lineTo(0, h); s.lineTo(-x, h - p);
  } else if (shape === "crown") {                     // 牌位: shoulders, then a domed crown
    const sh = h * 0.84;
    s.moveTo(-x, 0); s.lineTo(x, 0); s.lineTo(x, sh); s.lineTo(x * 0.86, sh + h * 0.02);
    s.quadraticCurveTo(x * 0.86, h, 0, h); s.quadraticCurveTo(-x * 0.86, h, -x * 0.86, sh + h * 0.02); s.lineTo(-x, sh);
  } else {                                            // 腰牌: rounded all round, a hole for the cord
    const r = w * 0.16;
    s.moveTo(-x + r, 0); s.lineTo(x - r, 0); s.quadraticCurveTo(x, 0, x, r); s.lineTo(x, h - r); s.quadraticCurveTo(x, h, x - r, h);
    s.lineTo(-x + r, h); s.quadraticCurveTo(-x, h, -x, h - r); s.lineTo(-x, r); s.quadraticCurveTo(-x, 0, -x + r, 0);
    const hole = new THREE.Path(); hole.absarc(0, h - 0.045, 0.016, 0, Math.PI * 2, true); s.holes.push(hole);
  }
  s.closePath();
  return s;
}

// Materials: how each kind looks and how its writing is made. lit: the light edge of a cut; line: border and rules.
const PALETTES = {
  stone: { side: 0xa9aca3, rough: 0.9, sideTexture: () => tex(256, 256, (g) => stone2d(g, 256, 256)), ground: (g, w, h) => stone2d(g, w, h),
    ink: "#2f3332", soft: "#3a3e3c", lit: "rgba(236,232,222,.55)", line: "#343837", gold: true, seal: null, sealInk: "#7a2a1e" },
  black: { side: 0x2a2622, rough: 0.42, sideTexture: () => tex(16, 16, (g) => { g.fillStyle = "#1e1b18"; g.fillRect(0, 0, 16, 16); }), ground: (g, w, h) => lacquer(g, w, h, ["#26221e", "#141210"]),
    ink: "#d8b766", soft: "#bfa261", lit: "rgba(0,0,0,.6)", line: "#c9a24f", gold: true, seal: "#8e2a1d", sealInk: "#e8cd86" },
  red:   { side: 0x6e2219, rough: 0.45, sideTexture: () => tex(16, 16, (g) => { g.fillStyle = "#6a2018"; g.fillRect(0, 0, 16, 16); }), ground: (g, w, h) => lacquer(g, w, h, ["#8a2e21", "#5a1a12"]),
    ink: "#e6c676", soft: "#dbb96a", lit: "rgba(40,6,2,.6)", line: "#d8b25a", gold: true, seal: "#2a1410", sealInk: "#e6c676" },
  wood:  { side: 0xb48a58, rough: 0.8, sideTexture: () => tex(256, 256, (g) => wood(g, 256, 256)), ground: (g, w, h) => wood(g, w, h),
    ink: "#3a2412", soft: "#4a3018", lit: "rgba(255,236,200,.4)", line: "#4a3018", gold: false, seal: "#9e2a1c", sealInk: "#f3e2c0" },
};

/** The written face, laid out as blocks; the space left over is shared out between them. */
function face(c, spec, ch) {
  const P = PALETTES[spec.palette], cw = CW;
  const col = document.createElement("canvas"); col.width = cw; col.height = ch;
  const hgt = document.createElement("canvas"); hgt.width = cw; hgt.height = ch;
  const g = col.getContext("2d"), hg = hgt.getContext("2d");
  P.ground(g, cw, ch);
  hg.fillStyle = "#fff"; hg.fillRect(0, 0, cw, ch);
  const M = 64, inner = cw - 2 * M;
  const write = (t, x, y, f, o = {}) => cutText(g, hg, P, t, x, y, f, o);
  const line = (path, width, faint) => cutPath(g, hg, P, path, width, faint);
  border(line, spec, cw, ch);
  const blocks = [];
  if (c.seal) blocks.push({ h: 104, draw: (y) => {
    const sw = 82 * [...c.seal].length + 40, box = (x) => { x.beginPath(); x.roundRect(cw / 2 - sw / 2, y, sw, 100, 12); };
    if (P.seal) { g.fillStyle = P.seal; box(g); g.fill(); }
    line(box, 3.5);
    write(c.seal, cw / 2, y + 52, cjk(70), { color: P.sealInk });
  } });
  const big = [...c.name].length > 5 ? 96 : 140;
  g.font = cjk(big); const nameW = g.measureText(c.name).width;
  g.font = cjk(46); const genW = c.gen ? g.measureText(c.gen).width + 20 : 0;
  const sub = wrap(g, c.sub || "", cjk(38), inner - 30).slice(0, 3);
  blocks.push({ h: big + 24 + sub.length * 50, draw: (y) => {
    const nx = cw / 2 - (nameW + genW) / 2;
    write(c.name, nx + nameW / 2, y + big / 2, cjk(big), { gold: P.gold, heavy: true });
    if (c.gen) write(c.gen, nx + nameW + 20 + (genW - 20) / 2, y + big * 0.7, cjk(46), { color: P.soft });
    sub.forEach((l, i) => write(l, cw / 2, y + big + 34 + i * 50, cjk(38), { color: P.soft }));
  } });
  blocks.push({ h: 20, draw: (y) => rule(line, cw / 2, y + 10, 280) });
  for (const ln of c.lines || []) {
    const fs = ln.size || 38, f = cjk(fs);
    const ls = wrap(g, ln.text, f, inner - 40).slice(0, ln.max || 3);
    blocks.push({ h: ls.length * fs * 1.35, draw: (y) => ls.forEach((l, i) => write(l, cw / 2, y + fs * 0.68 + i * fs * 1.35, f)) });
  }
  const stats = (c.stats || []).slice(0, 6);
  if (stats.length) {
    const cols = Math.min(3, stats.length), rows = Math.ceil(stats.length / cols), cellW = inner / cols;
    blocks.push({ h: rows * 138, draw: (y) => stats.forEach((s, i) => {
      const row = Math.floor(i / cols), inRow = Math.min(cols, stats.length - row * cols);
      const cx = cw / 2 + cellW * ((i % cols) - (inRow - 1) / 2), cy = y + row * 138;
      const val = String(s.value), fs = val.length > 8 ? 50 : 74;
      write(val, cx, cy + 40, font(fs), { heavy: true });
      write(s.label, cx, cy + 100, cjk(32), { color: P.soft });
    }) });
  }
  if (c.draw) blocks.push({ h: 400, draw: (y) => c.draw(g, M + 30, y, inner - 60, 390) });
  if (c.series?.length > 1) blocks.push({ h: 220, draw: (y) => {
    const x0 = M + 76, x1 = cw - M - 34, top = y + 8, bot = y + 172;
    const vx = (i) => x0 + (i * (x1 - x0)) / (c.series.length - 1), vy = (val) => bot - (clamp(val, 0, 100) / 100) * (bot - top);
    for (const val of [0, 50, 100]) {
      line((x) => { x.beginPath(); x.moveTo(x0, vy(val)); x.lineTo(x1, vy(val)); }, val === 50 ? 1.8 : 1.1, true);
      write(String(val), x0 - 30, vy(val), font(25), { color: P.soft });
    }
    line((x) => { x.beginPath(); c.series.forEach((s, i) => (i ? x.lineTo(vx(i), vy(s.value)) : x.moveTo(vx(i), vy(s.value)))); }, 5.5);
    write(c.seriesLabel || "", cw / 2, bot + 36, cjk(30), { color: P.soft });
  } });
  const honours = (c.honours || []).slice(0, 2);
  if (honours.length) blocks.push({ h: honours.length * 48, draw: (y) => honours.forEach((x, i) => write(x, cw / 2, y + 24 + i * 48, cjk(34), { gold: true })) });
  if (c.foot) blocks.push({ h: 42, draw: (y) => write(c.foot, cw / 2, y + 21, cjk(32), { color: P.soft }) });
  const top = spec.top, bottom = ch - 66, used = blocks.reduce((n, b) => n + b.h, 0);
  const gap = Math.max(16, Math.min(64, (bottom - top - used) / Math.max(1, blocks.length - 1)));
  let y = top;
  for (const b of blocks) { if (y + b.h > bottom + 4) break; b.draw(y); y += b.h + gap; }
  const map = new THREE.CanvasTexture(col); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
  const normalMap = new THREE.CanvasTexture(normals(hg, cw, ch)); normalMap.anisotropy = 8;
  return { map, normalMap };
}

/** Writing: on stone and wood a cut (a recess, one edge lit); on lacquer a gilt incision. */
function cutText(g, hg, P, text, x, y, f, { gold = false, color = P.ink, heavy = false } = {}) {
  for (const ctx of [g, hg]) { ctx.font = f; ctx.textAlign = "center"; ctx.textBaseline = "middle"; }
  g.fillStyle = P.lit; g.fillText(text, x + 1.6, y + 1.8);
  if (gold) {
    const gr = g.createLinearGradient(0, y - 60, 0, y + 60);
    gr.addColorStop(0, "#f6dc92"); gr.addColorStop(0.5, "#cba24c"); gr.addColorStop(1, "#8e6b2a");
    g.fillStyle = gr;
  } else g.fillStyle = color;
  g.fillText(text, x, y);
  hg.fillStyle = "#000"; hg.fillText(text, x, y);
  if (heavy || !/[㐀-鿿]/.test(text)) {       // a hairline more for numbers and the thin Latin face
    g.lineWidth = hg.lineWidth = 1.3; g.strokeStyle = g.fillStyle; hg.strokeStyle = "#000";
    g.strokeText(text, x, y); hg.strokeText(text, x, y);
  }
}
function cutPath(g, hg, P, path, width, faint = false) {
  for (const [ctx, style, dx, alpha] of [[g, P.lit, 1.3, 1], [g, P.line, 0, faint ? 0.55 : 1], [hg, "#000", 0, 1]]) {
    ctx.save(); ctx.translate(dx, dx); path(ctx); ctx.strokeStyle = style; ctx.globalAlpha = alpha; ctx.lineWidth = width; ctx.stroke(); ctx.restore();
  }
}
function rule(line, x, y, half) {
  line((c) => { c.beginPath(); c.moveTo(x - half, y); c.lineTo(x - 18, y); c.moveTo(x + 18, y); c.lineTo(x + half, y); }, 2.5);
  line((c) => { c.beginPath(); c.moveTo(x, y - 9); c.lineTo(x + 11, y); c.lineTo(x, y + 9); c.lineTo(x - 11, y); c.closePath(); }, 2.5);
}
/** A double line just inside the outline. */
function border(line, spec, cw, ch) {
  const sx = cw / spec.w, sy = ch / spec.h;
  for (const [inset, wd] of [[0.022, 4], [0.034, 2]]) {
    const pts = outline({ ...spec, w: spec.w - 2 * inset, h: spec.h - 2 * inset }).getPoints(24);
    line((x) => { x.beginPath(); pts.forEach((p, i) => { const px = cw / 2 + p.x * sx, py = ch - (p.y + inset) * sy; i ? x.lineTo(px, py) : x.moveTo(px, py); }); x.closePath(); }, wd);
  }
}

function stone2d(g, w, h) {
  g.fillStyle = "#9da197"; g.fillRect(0, 0, w, h);
  let s = 7; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < (w * h) / 110; i++) { g.fillStyle = `rgba(${r() < 0.5 ? "40,44,42" : "235,236,228"},${0.03 + r() * 0.05})`; const d = 1 + r() * 3; g.fillRect(r() * w, r() * h, d, d); }
  g.strokeStyle = "rgba(60,66,62,.10)"; g.lineWidth = 1.5;
  for (let i = 0; i < 7; i++) { g.beginPath(); let x = r() * w, y = r() * h; g.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (r() - 0.5) * 140; y += r() * 90; g.lineTo(x, y); } g.stroke(); }
  g.globalCompositeOperation = "multiply"; g.fillStyle = "rgb(226,212,184)"; g.fillRect(0, 0, w, h); g.globalCompositeOperation = "source-over";
}
function lacquer(g, w, h, [a, b]) {
  const gr = g.createLinearGradient(0, 0, w * 0.4, h); gr.addColorStop(0, a); gr.addColorStop(1, b);
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  let s = 11; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.strokeStyle = "rgba(255,240,210,.035)"; g.lineWidth = 1;            // the fine crackle of old lacquer
  for (let i = 0; i < 260; i++) { g.beginPath(); const x = r() * w, y = r() * h; g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 40, y + (r() - 0.5) * 40); g.stroke(); }
  const sheen = g.createLinearGradient(0, 0, w, 0); sheen.addColorStop(0.2, "rgba(255,255,255,0)"); sheen.addColorStop(0.5, "rgba(255,245,225,.06)"); sheen.addColorStop(0.8, "rgba(255,255,255,0)");
  g.fillStyle = sheen; g.fillRect(0, 0, w, h);
}
function wood(g, w, h) {
  g.fillStyle = "#c39a64"; g.fillRect(0, 0, w, h);
  let s = 5; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < Math.max(40, w / 6); i++) {                       // grain, running the length of the token
    g.strokeStyle = `rgba(${r() < 0.6 ? "110,70,32" : "230,200,150"},${0.08 + r() * 0.12})`; g.lineWidth = 1 + r() * 3;
    const x = r() * w, amp = 10 * r(); g.beginPath(); g.moveTo(x, 0);
    for (let y = 0; y <= h; y += h / 12) g.lineTo(x + Math.sin(y * 0.01 + i) * amp, y);
    g.stroke();
  }
}
function tex(w, h, paint) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; paint(c.getContext("2d"));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function vignette() {
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const g = c.getContext("2d"), gr = g.createRadialGradient(128, 128, 30, 128, 128, 182);
  gr.addColorStop(0, "rgba(16,11,6,.5)"); gr.addColorStop(1, "rgba(10,6,3,1)");
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
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

/** Lines that fit `max` pixels: by character for Chinese (punctuation never starts a line), by word otherwise. */
function wrap(g, text, f, max) {
  g.font = f;
  const parts = /[㐀-鿿]/.test(text) ? [...text] : text.split(/(?<=\s)/);
  const out = []; let line = "";
  for (const p of parts) {
    if (g.measureText(line + p).width > max && line) {
      if (/^[，。；：、）！？]$/.test(p)) { out.push(line + p); line = ""; } else { out.push(line.trim()); line = p.trimStart(); }
    } else line += p;
  }
  if (line.trim()) out.push(line.trim());
  return out;
}
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const ease = (x) => 1 - (1 - x) ** 3;
/** The words, as plain text, for a screen reader. */
function plain(c) {
  return [c.seal, `${c.name}${c.gen ? " " + c.gen : ""}`, c.sub, ...(c.lines || []).map((l) => l.text),
    ...(c.stats || []).map((s) => `${s.label} ${s.value}`), ...(c.honours || []), c.foot].filter(Boolean).map((x) => x.replace(/[。.]$/, "")).join("。") + "。";
}
