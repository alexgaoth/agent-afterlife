// The temple: load data, seat it, build the compound, walk it in first person.
import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { loadData, ranked, living, passersBy, epitaph, shownStats, notify, onOpenRequest } from "../shared/afterlife.js";

// Timing marks (performance.getEntriesByType("mark")): afterlife:data, afterlife:fonts, afterlife:scene, afterlife:first-frame.
const mark = (name) => performance.mark(`afterlife:${name}`);
// The enter button says what is happening until the first frame is drawn, then it opens the temple.
const progress = (text) => { const b = document.getElementById("enter"); if (b && b.disabled) b.textContent = text; };
const painted = () => new Promise((r) => setTimeout(r, 30));   // let the page show the new text (a timer also runs in a background tab)
import { insights, honours } from "../shared/insights.js";
import { drawInsight } from "./insight-art.js";
import { buildSteleForest } from "./steles.js";
import { buildAvenue } from "./avenue.js";
import { buildPilgrims } from "./pilgrims.js";
import { seat, ZONES, GROUP_CN, cnNumber, cnDate, generationCn, nameOnTablet } from "./seating.js";
import { statue, emptySeat, PIGMENT, paint } from "./statue.js";
import { buildWorld } from "./world.js";
import { Mural } from "./mural.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const TIER = { main: "main", companion: "companion", hallEast: "hall", hallWest: "hall", wingsEast: "wings", wingsWest: "wings" };

const { data, errors } = await loadData();
mark("data");
if (!data) {
  $("intro").hidden = true;
  $("error").hidden = false;
  $("error-list").innerHTML = errors.map((e) => `<li>${e.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))}</li>`).join("");
  throw new Error("invalid data");
}
await Promise.all(['28px "Ma Shan Zheng"', '24px "IM Fell English"'].map((f) => document.fonts.load(f).catch(() => {})));
mark("fonts");
progress("Raising the halls");
await painted();

// ------------------------------------------------------------------ scene
// ?still=1 keeps the last frame in the drawing buffer, so a screenshot after the loop stops still sees it.
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance", preserveDrawingBuffer: params.get("still") === "1" });
// ?quality=low draws fewer pixels (the mural effect costs per pixel); it is the default on a software renderer
// (no GPU: SwiftShader, llvmpipe), where a full-size frame takes seconds. ?quality=high forces full size.
const quality = params.get("quality") || (softwareGL(renderer) ? "low" : "high");
renderer.setPixelRatio(quality === "low" ? 0.6 : Math.min(devicePixelRatio, 1.5));
// The scene is one image to assistive technology; the text version (linked first on the page) has the same content.
Object.assign(renderer.domElement, { tabIndex: 0 });
renderer.domElement.setAttribute("role", "img");
renderer.domElement.setAttribute("aria-label", "A walkable temple of AI agents. Arrow keys walk and turn, [ and ] go from statue to statue, E reads one. The text version has the same content.");
function softwareGL(r) {
  try {
    const gl = r.getContext(), ext = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
  } catch { return false; }
}
renderer.shadowMap.enabled = quality !== "low"; renderer.shadowMap.type = THREE.PCFSoftShadowMap;   // low: no shadow pass
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
const honour = honours(data);
for (const s of seats) {
  const at = world.seats[s.zone][s.no - 1];
  const g = s.agent ? statue(s.agent, TIER[s.zone], honour.get(s.agent.id)) : emptySeat(TIER[s.zone]);
  g.position.set(at.x, at.y, at.z); g.rotation.y = at.r;
  scene.add(g);
  if (s.agent) g.traverse((o) => o.isMesh && pickable.push(o));
}
const seatedByRank = seats.filter((x) => x.agent)
  .map((x) => ({ at: world.seats[x.zone][x.no - 1], zone: x.zone, agent: x.agent, rank: placement.get(x.agent.id).rank }))
  .sort((a, b) => a.rank - b.rank);

// Living agents walk the courtyard as pilgrims (香客). They take a seat when their session ends.
const alive = living(data);
const pilgrims = buildPilgrims(scene, alive, { floorAt: world.floorAt });
if (pilgrims) pickable.push(...pilgrims.meshes);

// 碑林: one stele per insight along the path. Look at one and press E for its page in the annals.
const steleFaces = buildSteleForest(scene, insights(data), world.colliders);
pickable.push(...steleFaces);

// 灯道: one stone lantern per work day along the path, gate (oldest) to hall (newest), lit by that day's merit.
const avenue = buildAvenue(scene, insights(data).find((i) => i.key === "chronicle").chart?.rows || [], world.colliders);
if (avenue.fires) pickable.push(avenue.fires);
/** What looking at something and pressing E (or clicking) does. */
function act(id) {
  if (id.startsWith("insight:")) openAnnals(id.slice(8));
  else if (id.startsWith("day:")) openAnnals("chronicle");
  else openScroll(id);
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

// Keyboard mode: walking without pointer lock, for keyboard users and where the lock is refused (some iframes,
// some browsers). It starts by itself when the lock fails, or with ?keys=1; Esc leaves it.
let keyboardMode = false;
const exploring = () => controls.isLocked || keyboardMode || touchWalk;
function setKeyboardMode(on) {
  keyboardMode = on;
  $("intro").hidden = on; $("hud").hidden = !on;
  if (on) renderer.domElement.focus();
}
document.addEventListener("pointerlockerror", () => setKeyboardMode(true));

const keys = new Set();
addEventListener("keydown", (e) => {
  if (e.target.closest?.("dialog, input, textarea")) return;
  keys.add(e.code);
  if ((e.code === "KeyE" || (e.code === "Enter" && keyboardMode)) && looking && exploring()) act(looking);
  if (e.code === "KeyY" && !$("annals").open) openAnnals();
  if ((e.code === "BracketRight" || e.code === "BracketLeft") && exploring()) { e.preventDefault(); stepToStatue(e.code === "BracketRight" ? 1 : -1); }
  if (e.code === "Escape" && keyboardMode && !$("scroll").open && !$("annals").open) setKeyboardMode(false);
});
addEventListener("keyup", (e) => keys.delete(e.code));
$("enter").addEventListener("click", () => {
  if (params.get("keys") === "1" || !renderer.domElement.requestPointerLock) return setKeyboardMode(true);
  controls.lock();
});
controls.addEventListener("lock", () => { keyboardMode = false; $("intro").hidden = true; $("hud").hidden = false; });
controls.addEventListener("unlock", () => { if (!$("scroll").open) { $("intro").hidden = false; } });

// [ and ]: stand before the previous or next enshrined statue, by merit rank. The label (role=status) says who it is.
let statueAt = -1;
function stepToStatue(step) {
  const list = seatedByRank;
  if (!list.length) return;
  statueAt = (statueAt + step + list.length) % list.length;
  const { at, agent, zone } = list[statueAt];
  const fx = Math.sin(at.r), fz = Math.cos(at.r);                    // the way the statue faces
  const back = zone === "main" || zone === "companion" ? 4.2 : 2.6;   // the two great statues need more room
  const x = at.x + fx * back, z = at.z + fz * back;
  camera.position.set(x, world.floorAt(x, z) + EYE, z);
  camera.lookAt(at.x, at.y + 1.7, at.z);
  looking = null; lookAround();
  if (looking !== agent.id) {                                         // the gaze missed: say it anyway
    looking = agent.id;
    $("label").hidden = false;
    $("label").innerHTML = `<b>${esc(nameOnTablet(agent))} ${generationCn(agent)}</b><span>${esc(where(agent))}</span><kbd>E</kbd>`;
  }
}
renderer.domElement.addEventListener("click", () => {
  if (controls.isLocked && looking) act(looking);
});

function blocked(x, z) {
  if (Math.abs(x) > world.bounds.W - 0.6 || z < world.bounds.N + 0.6 || z > 60) return true;
  return world.colliders.some(([x0, x1, z0, z1]) => x > x0 - RADIUS && x < x1 + RADIUS && z > z0 - RADIUS && z < z1 + RADIUS);
}
const dir = new THREE.Vector3(), side = new THREE.Vector3();
function walk(dt) {
  const speed = (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 7 : 3.6) * dt;
  const f = (keys.has("KeyW") || keys.has("ArrowUp") || touchWalk ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
  const s = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
  const turn = (keys.has("ArrowLeft") ? 1 : 0) - (keys.has("ArrowRight") ? 1 : 0);   // arrows turn, so no mouse is needed
  if (turn) camera.rotation.y += turn * 1.9 * dt;
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
  const id = !hit ? null : hit.object === avenue.fires ? "day:" + hit.instanceId
    : hit.object.userData.ids ? hit.object.userData.ids[hit.instanceId] : hit.object.userData.agentId || null;
  if (id === looking) return;
  looking = id;
  if (id && id.startsWith("day:")) {
    const d = avenue.days[+id.slice(4)];
    $("label").hidden = false;
    $("label").innerHTML = `<b>${cnDate(d.date)}</b><span>${d.date}: ${d.merit} merit, ${d.active} agents at work${d.ended ? `, ${d.ended} ended` : ""}.</span><kbd>E</kbd>`;
    return;
  }
  if (id && id.startsWith("insight:")) {
    const ins = insights(data).find((i) => "insight:" + i.key === id);
    $("label").hidden = false;
    $("label").innerHTML = `<b>${ins.cn}碑</b><span>${esc(ins.title)}</span><kbd>E</kbd>`;
    return;
  }
  const a = id && agentById.get(id);
  $("label").hidden = !a;
  if (a) $("label").innerHTML = `<b>${esc(nameOnTablet(a))} ${generationCn(a)}</b><span>${esc(where(a))}</span><kbd>E</kbd>`;
}

function where(a) {
  if (a.status === "alive") return "A pilgrim, still working. It takes a seat when its session ends.";
  const p = placement.get(a.id);
  if (!p) return "A passer-by.";
  if (p.zone === "outside") return `Merit rank ${p.rank}. Waits outside the gate: every seat is taken.`;
  return `${ZONES[p.zone].cn}, seat ${p.no}, in the seat of ${p.orig}. Merit rank ${p.rank}.`;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ------------------------------------------------------------------ the scroll
function openScroll(id) {
  notify("select", { id });
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

// ------------------------------------------------------------------ the annals (年鉴)
const fleetInsights = insights(data);
function openAnnals(focus) {
  controls.unlock();
  $("annals-body").innerHTML = fleetInsights.map((ins) => `
    <section class="panel${ins.key === focus ? " focus" : ""}" id="panel-${ins.key}">
      <h3><b>${ins.cn}</b>${esc(ins.title)}</h3>
      <canvas width="680" height="360" data-key="${ins.key}"></canvas>
      <p>${esc(ins.finding)}</p>
    </section>`).join("") + `
    <section class="panel" id="panel-reading">
      <h3><b>读法</b>How to read the statues</h3>
      <p><b>金身</b> Gilded all over: the top 10% of working agents by merit (${[...honour.values()].filter((h) => h.gilded).length} here).</p>
      <p><b>香</b> Incense in the tripod censer: one stick for each day the agent served, up to twelve.</p>
      <p><b>高</b> Height: within its group, a statue stands up to 8% taller or shorter by its merit rank.</p>
      <p><b>位</b> Seat: merit rank picks the group, the day it began picks the seat, as in the 1123 record.</p>
      <p class="n">Robe colour, hat or helmet, beard and weapon only tell agents apart; they carry no data.</p>
    </section>`;
  for (const c of $("annals-body").querySelectorAll("canvas")) {
    drawInsight(c.getContext("2d"), fleetInsights.find((i) => i.key === c.dataset.key), 0, 0, c.width, c.height, "ink");
  }
  $("annals").showModal();
  const sheet = $("annals-body");
  sheet.scrollLeft = 0;                                    // right to left: start at the right end
  if (focus) $("panel-" + focus)?.scrollIntoView({ inline: "center", block: "nearest" });
}
// The wheel moves the handscroll sideways: down reads on, toward the left.
$("annals-body").addEventListener("wheel", (e) => {
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
  e.preventDefault();
  $("annals-body").scrollLeft -= e.deltaY;
}, { passive: false });
$("annals").addEventListener("close", () => { $("intro").hidden = false; });
$("open-annals").addEventListener("click", () => { $("intro").hidden = true; openAnnals(); });
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
mark("scene");
progress("Lighting the lanterns");
const still = params.get("still") === "1";   // ?still=1 draws a few frames and stops: for screenshots and tests
renderer.setAnimationLoop(() => {
  if (still && frame > 1) {   // two frames: the first uploads textures
    // Freeze: copy the last frame into an <img>, which any screenshot sees, then stop rendering.
    renderer.setAnimationLoop(null);
    const img = new Image(); img.src = renderer.domElement.toDataURL("image/png"); img.id = "still";
    img.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;z-index:0";
    document.body.prepend(img);
    return;
  }
  const dt = Math.min(0.05, clock.getDelta());
  if (exploring()) walk(dt);
  pilgrims?.update(still ? 0 : clock.elapsedTime);   // ?still=1: the same positions on every load
  if (frame++ % 6 === 0) lookAround();
  mural.render(scene, camera);
  if (frame === 1) {
    mark("first-frame");
    const enter = $("enter"); enter.disabled = false; enter.textContent = "Enter the temple";
    const t = Object.fromEntries(performance.getEntriesByType("mark").filter((m) => m.name.startsWith("afterlife:")).map((m) => [m.name.slice(10), Math.round(m.startTime)]));
    notify("shown", { ms: t["first-frame"], marks: t, quality });       // embedders can hide their spinner now
  }
  if (frame === 31) notify("steady", { msPerFrame: Math.round((performance.now() - performance.getEntriesByName("afterlife:first-frame")[0].startTime) / 30), quality });
});
if (params.get("cam")) { $("intro").hidden = true; }   // a set camera (for links and screenshots) skips the intro
onOpenRequest((id) => { $("intro").hidden = true; openScroll(id); });
if (params.get("read")) { $("intro").hidden = true; openScroll(params.get("read")); }   // ?read=<agent id> opens its scroll
if (params.get("annals") !== null) { $("intro").hidden = true; openAnnals(params.get("annals") || undefined); }   // ?annals[=key]
