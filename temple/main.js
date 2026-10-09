// The temple: load data, seat it, build the compound, walk it in first person.
import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { loadData, ranked, living, passersBy, epitaph, shownStats } from "../shared/afterlife.js";
import { seat, ZONES, GROUP_CN, cnNumber, cnDate, generationCn, nameOnTablet } from "./seating.js";
import { statue, emptySeat, PIGMENT, paint } from "./statue.js";
import { buildWorld } from "./world.js";
import { Mural } from "./mural.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const TIER = { main: "main", companion: "companion", hallEast: "hall", hallWest: "hall", wingsEast: "wings", wingsWest: "wings" };

const { data, errors } = await loadData();
if (!data) {
  $("intro").hidden = true;
  $("error").hidden = false;
  $("error-list").innerHTML = errors.map((e) => `<li>${e.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))}</li>`).join("");
  throw new Error("invalid data");
}
await Promise.all(['28px "Ma Shan Zheng"', '24px "IM Fell English"'].map((f) => document.fonts.load(f).catch(() => {})));

// ------------------------------------------------------------------ scene
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xd8ccae);           // the bare plaster of an old wall
scene.fog = new THREE.Fog(0xd8ccae, 45, 150);
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 300);
const world = buildWorld(scene);
const mural = new Mural(renderer);
if (params.get("plain") === "1") mural.enabled = false;

// ------------------------------------------------------------------ the seated
const order = ranked(data);
const { seats, outside, placement } = seat(order);
const agentById = new Map(data.agents.map((a) => [a.id, a]));
const pickable = [];
for (const s of seats) {
  const at = world.seats[s.zone][s.no - 1];
  const g = s.agent ? statue(s.agent, TIER[s.zone]) : emptySeat(TIER[s.zone]);
  g.position.set(at.x, at.y, at.z); g.rotation.y = at.r;
  scene.add(g);
  if (s.agent) g.traverse((o) => o.isMesh && pickable.push(o));
}

// Living agents: lanterns on a beam outside the gate. They take a seat when their session ends.
const alive = living(data);
if (alive.length) {
  // Strings of at most 14 lanterns, one above another, on posts outside the gate.
  const perRow = 14, rows = Math.ceil(alive.length / perRow), width = Math.min(alive.length, perRow) * 0.8 + 1;
  for (let row = 0; row < rows; row++) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(width, 0.12, 0.12), paint(PIGMENT.lacquer));
    beam.position.set(0, 4.4 - row * 0.9, 49); scene.add(beam);
  }
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 4.5, 0.22), paint(PIGMENT.lacquer));
    post.position.set(sx * width / 2, 2.25, 49); scene.add(post);
  }
  alive.forEach((a, i) => {
    const row = Math.floor(i / perRow), col = i % perRow, inRow = Math.min(perRow, alive.length - row * perRow);
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), new THREE.MeshBasicMaterial({ color: 0xd8582e }));
    lantern.scale.y = 1.25;
    lantern.position.set((col - (inRow - 1) / 2) * 0.8, 4.0 - row * 0.9, 49);
    lantern.userData.agentId = a.id; scene.add(lantern); pickable.push(lantern);
    if (i % 4 === 0) { const glow = new THREE.PointLight(0xff9a50, 2.5, 5); glow.position.copy(lantern.position); scene.add(glow); }
  });
}

// The stele carries the newest edict, in columns, right to left.
carveStele(world.stele, data.edicts.at(-1), order.length - outside.length);

// ------------------------------------------------------------------ walking
const controls = new PointerLockControls(camera, renderer.domElement);
const EYE = 1.6, RADIUS = 0.35;
const start = (params.get("cam") || "0,0,34,0,0").split(",").map(Number);   // x, y, z, yaw°, pitch°
camera.position.set(start[0], world.floorAt(start[0], start[2]) + EYE + start[1], start[2]);
camera.rotation.order = "YXZ";
camera.rotation.set(THREE.MathUtils.degToRad(start[4] || 0), THREE.MathUtils.degToRad(start[3] || 0), 0);

const keys = new Set();
addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (e.code === "KeyE" && looking && controls.isLocked) { openScroll(looking); }
});
addEventListener("keyup", (e) => keys.delete(e.code));
$("enter").addEventListener("click", () => controls.lock());
controls.addEventListener("lock", () => { $("intro").hidden = true; $("hud").hidden = false; });
controls.addEventListener("unlock", () => { if (!$("scroll").open) { $("intro").hidden = false; } });
renderer.domElement.addEventListener("click", () => { if (controls.isLocked && looking) openScroll(looking); });

function blocked(x, z) {
  if (Math.abs(x) > world.bounds.W - 0.6 || z < world.bounds.N + 0.6 || z > 60) return true;
  return world.colliders.some(([x0, x1, z0, z1]) => x > x0 - RADIUS && x < x1 + RADIUS && z > z0 - RADIUS && z < z1 + RADIUS);
}
const dir = new THREE.Vector3(), side = new THREE.Vector3();
function walk(dt) {
  const speed = (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 7 : 3.6) * dt;
  const f = (keys.has("KeyW") || keys.has("ArrowUp") || touchWalk ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
  const s = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
  if (!f && !s) return;
  camera.getWorldDirection(dir); dir.y = 0; dir.normalize();
  side.crossVectors(dir, camera.up).normalize();
  const dx = (dir.x * f + side.x * s) * speed, dz = (dir.z * f + side.z * s) * speed;
  const p = camera.position, here = world.floorAt(p.x, p.z);
  const ok = (x, z) => !blocked(x, z) && world.floorAt(x, z) - here < 0.6;   // steps up to 0.6 m, no climbing walls
  if (ok(p.x + dx, p.z)) p.x += dx;
  if (ok(p.x, p.z + dz)) p.z += dz;
  p.y += (world.floorAt(p.x, p.z) + EYE - p.y) * Math.min(1, dt * 12);
}

// Touch: drag to look, hold the button to walk.
let touchWalk = false, lastTouch = null;
if (matchMedia("(pointer: coarse)").matches) {
  $("walk").hidden = false;
  $("walk").addEventListener("pointerdown", () => (touchWalk = true));
  addEventListener("pointerup", () => (touchWalk = false));
  renderer.domElement.addEventListener("touchmove", (e) => {
    const t = e.touches[0];
    if (lastTouch) {
      camera.rotation.y -= (t.clientX - lastTouch.x) * 0.005;
      camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x - (t.clientY - lastTouch.y) * 0.005, -1.2, 1.2);
    }
    lastTouch = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  renderer.domElement.addEventListener("touchend", () => (lastTouch = null));
  $("enter").addEventListener("click", () => { $("intro").hidden = true; $("hud").hidden = false; });
}

// ------------------------------------------------------------------ looking
const ray = new THREE.Raycaster(); ray.far = 9;
let looking = null, frame = 0;
function lookAround() {
  camera.updateMatrixWorld();
  ray.setFromCamera({ x: 0, y: 0 }, camera);
  const hit = ray.intersectObjects(pickable, false).find((h) => h.distance <= 9);   // only what is within reach
  const id = hit?.object.userData.agentId || null;
  if (id === looking) return;
  looking = id;
  const a = id && agentById.get(id);
  $("label").hidden = !a;
  if (a) $("label").innerHTML = `<b>${esc(nameOnTablet(a))} ${generationCn(a)}</b><span>${esc(where(a))}</span><kbd>E</kbd>`;
}

function where(a) {
  if (a.status === "alive") return "Still working. Seated when its session ends.";
  const p = placement.get(a.id);
  if (!p) return "A passer-by.";
  if (p.zone === "outside") return `Merit rank ${p.rank}. Waits outside the gate: every seat is taken.`;
  return `${ZONES[p.zone].cn}, seat ${p.no}, in the seat of ${p.orig}. Merit rank ${p.rank}.`;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ------------------------------------------------------------------ the scroll
function openScroll(id) {
  const a = agentById.get(id);
  if (!a) return;
  controls.unlock();
  const p = placement.get(a.id);
  const seal = a.status === "alive" ? "在世" : p ? (p.zone === "outside" ? "庙外" : GROUP_CN[ZONES[p.zone].group]) : "过客";
  const stats = [{ label: "Merit", value: a.merit }, ...shownStats(a, data.metrics)].slice(0, 4);
  $("scroll-body").innerHTML = `
    <span class="seal" aria-hidden="true">${seal}</span>
    <h2>${esc(nameOnTablet(a))} ${generationCn(a)}</h2>
    <p class="seat">${esc(a.id)}. ${esc(where(a))}</p>
    <p class="epitaph">${esc(epitaph(a, data.metrics))}</p>
    <dl>${stats.map((s) => `<div><dt>${esc(s.label)}</dt><dd>${esc(s.value)}</dd></div>`).join("")}</dl>
    ${sparkline(a.series)}
    <p class="foot">${a.born}${a.ended ? ` to ${a.ended}` : ", still working"}</p>`;
  $("scroll").showModal();
}
$("scroll").addEventListener("close", () => { $("intro").hidden = false; });
$("scroll").addEventListener("click", (e) => { if (e.target === $("scroll")) $("scroll").close(); });

function sparkline(series) {
  if (!series?.length) return "";
  const w = 440, h = 96, n = series.length, l = 28;
  const x = (i) => (n === 1 ? (w + l) / 2 : l + 8 + (i * (w - l - 16)) / (n - 1));
  const y = (v) => h - 18 - (v / 100) * (h - 26);
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Score per work day">
    ${[0, 50, 100].map((v) => `<text x="${l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text><line x1="${l}" x2="${w}" y1="${y(v)}" y2="${y(v)}" class="${v === 50 ? "mid" : ""}"/>`).join("")}
    <polyline points="${series.map((s, i) => `${x(i)},${y(s.value)}`).join(" ")}"/>
    ${series.map((s, i) => `<circle cx="${x(i)}" cy="${y(s.value)}" r="3.5"><title>${s.date}: ${s.value}</title></circle>`).join("")}
  </svg>`;
}

// ------------------------------------------------------------------ the stele
function carveStele({ slab }, edict, enshrined) {
  const c = document.createElement("canvas"); c.width = 300; c.height = 680;
  const x = c.getContext("2d");
  x.fillStyle = "#6f6d64"; x.fillRect(0, 0, 300, 680);
  x.strokeStyle = "#57554d"; x.lineWidth = 6; x.strokeRect(14, 14, 272, 652);
  x.fillStyle = "#2a2622"; x.textAlign = "center";
  x.font = '64px "Ma Shan Zheng", "Kaiti SC", serif'; x.fillText("诏", 150, 96);
  const KIND = { founded: "初建", enshrined: "入祀", promoted: "升", demoted: "降", removed: "黜" };
  const who = (id) => { const a = agentById.get(id); return a ? `${nameOnTablet(a)}${generationCn(a)}` : id; };
  const lines = !edict ? [`初建武庙`, `入祀${cnNumber(enshrined)}位`] : [
    cnDate(edict.date),
    ...edict.items.slice(0, 4).map((i) => i.kind === "founded" ? `初建武庙 入祀${cnNumber(i.count || 0)}位`
      : `${KIND[i.kind]} ${who(i.agent)}${i.from ? ` 自${GROUP_CN[i.from]}` : ""}${i.to ? ` ${i.kind === "removed" ? "出" : "入"}${GROUP_CN[i.to]}` : ""}`),
  ];
  // Columns right to left; Chinese characters upright, Latin words turned on their side.
  x.font = '30px "Ma Shan Zheng", "Kaiti SC", serif';
  lines.forEach((line, col) => {
    const cx = 236 - col * 52;
    let y = 150;
    for (const part of line.match(/[㐀-鿿]|[^㐀-鿿\s]+|\s/g) || []) {
      if (part === " ") { y += 12; continue; }
      if (/[㐀-鿿]/.test(part)) { x.fillText(part, cx, y + 26); y += 34; }
      else {
        x.save(); x.font = '22px "IM Fell English", Georgia, serif';
        const w = x.measureText(part).width;
        x.translate(cx, y + w / 2 + 4); x.rotate(Math.PI / 2); x.fillText(part, 0, 7); x.restore(); y += w + 10;
      }
    }
  });
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 3.2), new THREE.MeshBasicMaterial({ map: tex }));
  face.position.set(0, slab.position.y, 0.21);
  slab.parent.add(face);
}

// ------------------------------------------------------------------ frame loop
$("count").textContent = `${order.length - outside.length} enshrined, ${alive.length} still working, ${passersBy(data).length} passers-by`;
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  mural.setSize(innerWidth, innerHeight);
}
addEventListener("resize", resize); resize();
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  if (controls.isLocked || touchWalk) walk(dt);
  if (frame++ % 6 === 0) lookAround();
  mural.render(scene, camera);
});
if (params.get("cam")) { $("intro").hidden = true; }   // a set camera (for links and screenshots) skips the intro
if (params.get("read")) { $("intro").hidden = true; openScroll(params.get("read")); }   // ?read=<agent id> opens its scroll
