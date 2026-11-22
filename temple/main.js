// The temple: load data, seat it, build the compound, walk it in first person.
import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { loadData, ranked, living, passersBy, notify, onOpenRequest } from "../shared/afterlife.js";

// Timing marks (performance.getEntriesByType("mark")): afterlife:data, afterlife:fonts, afterlife:scene, afterlife:first-frame.
const mark = (name) => performance.mark(`afterlife:${name}`);
// The enter button says what is happening until the first frame is drawn, then it opens the temple.
const progress = (text) => { const b = document.getElementById("enter"); if (b && b.disabled) b.textContent = text; };
const painted = () => new Promise((r) => setTimeout(r, 30));   // let the page show the new text (a timer also runs in a background tab)
import { insights, honours, records, holderOn } from "../shared/insights.js";
import { days, asOf } from "../shared/timeline.js";
import { drawInsight } from "./insight-art.js";
import { buildSteleForest } from "./steles.js";
import { buildAvenue } from "./avenue.js";
import { buildPlaques } from "./plaques.js";
import { buildAncestralHall } from "./ancestral.js";
import { buildPilgrims } from "./pilgrims.js";
import { buildSpeech } from "./speech.js";
import { buildSound } from "./sound.js";
import { buildVoices } from "./voices.js";
import { buildHeld } from "./plate.js";
import { buildSky, weatherFor } from "./sky.js";
import { cjk, loadCjk } from "./fonts.js";
import { seat, ZONES, GROUP_CN, cnNumber, cnDate, generationCn, nameOnTablet } from "./seating.js";
import { statue, emptySeat, PIGMENT, paint } from "./statue.js";
import { meaning, shipping } from "./meaning.js";
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
// One Chinese typeface: load the glyphs for every character the code writes and for the fleet's names first.
await Promise.all([loadCjk(data.agents.map((a) => a.name).join("")), document.fonts.load('24px "IM Fell English"').catch(() => {})]);
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
// The scene is one image to assistive technology, with a label that says how to walk it by keyboard.
Object.assign(renderer.domElement, { tabIndex: 0 });
renderer.domElement.setAttribute("role", "img");
renderer.domElement.setAttribute("aria-label", "A walkable temple of AI agents. Arrow keys walk and turn, [ and ] go from statue to statue, E reads one.");
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
const held = buildHeld();                          // 手持: what you inspect comes up into your hands (temple/plate.js)
let nowT = 0, lastT = 0;                           // the time of the frame last drawn: what you hold rises and sinks by it
let lookingKind = "statue";                        // what the gaze is on: stele, statue, ancestor or pilgrim
const mural = new Mural(renderer);
if (params.get("plain") === "1") mural.enabled = false;

// ------------------------------------------------------------------ the seated, as of a day (the timeline)
// The temple shows the fleet as it stood on one day: by default the last, which is the fleet as it is. The
// timeline (top of the screen; , and . step a day, P replays) re-seats it for any earlier day.
const agentById = new Map(data.agents.map((a) => [a.id, a]));
const allDays = days(data), lastDay = allDays.at(-1) || "";
let viewDay = lastDay;
let replay = null;                                 // the timeline's replay timer, when it plays
let order = [], seats = [], outside = [], placement = new Map(), honour = new Map(), dress = { byId: new Map(), legend: [] };
let statueSpots = [], seatedByRank = [], alive = [], pilgrims = null, speech = null, voices = null;
const voiceLog = [];                               // record mode: what was said aloud (kept across days)
const staticPickable = [];                         // plaques, steles, lanterns, tablets: they do not change with the day
let statuePickable = [], pickable = [];
const statueCache = new Map(), placed = [];        // statues already built (by agent and look), and those in the scene now

function seatFleet(view) {
  order = ranked(view);
  ({ seats, outside, placement } = seat(order));
  honour = honours(view);
  // What the dress says: general or strategist, robe colour by tool (temple/meaning.js).
  dress = meaning(seats.filter((x) => x.agent && x.zone !== "main").map((x) => x.agent));
  for (const g of placed) scene.remove(g);
  placed.length = 0; statuePickable = [];
  for (const s of seats) {
    const at = world.seats[s.zone][s.no - 1];
    let key, g;
    if (s.agent) {
      const h = honour.get(s.agent.id) || {}, d = dress.byId.get(s.agent.id) || {};
      key = `${s.agent.id}|${s.zone}|${h.gilded ? 1 : 0}|${Math.min(12, h.days || 1)}|${Math.round((h.percentile ?? 0.5) * 8)}|${d.role}|${d.robe}`;
      g = statueCache.get(key) || statue(s.agent, TIER[s.zone], { ...h, ...d });
    } else {
      key = `empty|${s.zone}|${s.no}`;
      g = statueCache.get(key) || emptySeat(TIER[s.zone]);
    }
    statueCache.set(key, g);
    g.position.set(at.x, at.y, at.z); g.rotation.y = at.r;
    scene.add(g); placed.push(g);
    if (s.agent) g.traverse((o) => o.isMesh && statuePickable.push(o));
  }
  statueSpots = seats.filter((x) => x.agent && x.zone !== "main").map((x) => ({ agent: x.agent, at: world.seats[x.zone][x.no - 1],
    gilded: !!honour.get(x.agent.id)?.gilded, role: dress.byId.get(x.agent.id)?.role }));
  seatedByRank = seats.filter((x) => x.agent)
    .map((x) => ({ at: world.seats[x.zone][x.no - 1], zone: x.zone, agent: x.agent, rank: placement.get(x.agent.id).rank }))
    .sort((a, b) => a.rank - b.rank);
  // Living agents walk the courtyard as pilgrims (香客). They take a seat when their session ends.
  if (pilgrims) for (const m of pilgrims.meshes) { scene.remove(m); m.geometry.dispose(); }
  alive = living(view);
  pilgrims = buildPilgrims(scene, alive, { floorAt: world.floorAt });
  // ?speak=all: every pilgrim near you speaks (screenshots). ?bubbles=1: bubbles even with sound on.
  speech = pilgrims ? buildSpeech(scene, statueSpots, pilgrims.walkers, { all: params.get("speak") === "all", world: scene, skip: pilgrims.meshes,
    voices: () => voices, record: params.get("record") === "1",
    voiceRange: Number(params.get("voiceRange")) || undefined, bubbles: params.get("bubbles") === "1", log: voiceLog }) : null;
  pickable = [...staticPickable, ...statuePickable, ...(pilgrims ? pilgrims.meshes : [])];
}

// 匾额: the temple's name over the middle bay of the main hall, the fleet's records over the bays beside it.
const fleetRecords = records(data);
const recordByKey = new Map(fleetRecords.map((r) => [r.key, r]));
staticPickable.push(...buildPlaques(scene, fleetRecords).meshes);

// 祠堂: the lineages, in the side court through the doorway in the west wall.
const ancestral = buildAncestralHall(scene, data, world.ancestralHall);
staticPickable.push(...ancestral.meshes);

// 碑林: one stele per insight along the path. Look at one and press E for its page in the annals.
const steleFaces = buildSteleForest(scene, insights(data), world.colliders);
staticPickable.push(...steleFaces);

// 灯道: one stone lantern per work day along the path, gate (oldest) to hall (newest), lit by that day's merit.
const avenue = buildAvenue(scene, insights(data).find((i) => i.key === "chronicle").chart?.rows || [], world.colliders);
if (avenue.fires) staticPickable.push(avenue.fires);
/** What looking at something and pressing E (or clicking) does. */
function act(id) {
  if (held.holding) { held.close(nowT); looking = null; return; }     // holding something: put it down first
  if (id.startsWith("insight:")) inspect(id);
  else if (id.startsWith("record:") || id === "plaque:name") openAnnals("records");
  else if (id.startsWith("day:")) openAnnals("chronicle");
  else inspect(id, { kind: lookingKind });
}

// 天: the hour where the visitor is sets the sky; the fleet's work on the day shown sets the weather (temple/sky.js).
const sky = buildSky(scene, world.lights, { fires: avenue.fires });
const meritByDay = new Map((insights(data).find((i) => i.key === "chronicle").chart?.rows || []).map((r) => [r.date, r.merit]));
const usualDay = (() => { const m = [...meritByDay.values()].filter((x) => x > 0).sort((a, b) => a - b); return m.length ? m[Math.floor(m.length / 2)] : 0; })();
const hourNow = () => { const t = params.get("time"); if (t) { const [h, mm = 0] = t.split(":").map(Number); return h + mm / 60; } const d = new Date(); return d.getHours() + d.getMinutes() / 60; };
const weatherOn = (day) => params.get("weather") || weatherFor(meritByDay.get(day) || 0, usualDay);
sky.set({ hour: hourNow() });
if (!params.get("time") && params.get("record") !== "1") setInterval(() => sky.set({ hour: hourNow() }), 60000);   // follow the clock

/** Show the temple as of `day`: seats, statues, pilgrims, lanterns, the edict stele, the count, the timeline. */
function showDay(day) {
  viewDay = allDays.includes(day) ? day : lastDay;
  const view = viewDay === lastDay ? data : { ...asOf(data, viewDay), options: data.options };
  seatFleet(view);
  avenue.showUntil?.(viewDay);
  // The stele carries the newest edict of that day, in columns, right to left.
  carveStele(world.stele, view.edicts.at(-1), order.length - outside.length);
  sky.set({ weather: weatherOn(viewDay) });
  if ($("count")) $("count").textContent = countLine(view);
  syncTimeline();
}
showDay(params.get("day") || lastDay);

// ------------------------------------------------------------------ walking
const controls = new PointerLockControls(camera, renderer.domElement);
const EYE = 1.6, RADIUS = 0.35;
const start = (params.get("cam") || "0,0,34,0,0").split(",").map(Number);   // x, y, z, yaw°, pitch°
camera.position.set(start[0], world.floorAt(start[0], start[2]) + EYE + start[1], start[2]);
camera.rotation.order = "YXZ";
camera.rotation.set(THREE.MathUtils.degToRad(start[4] || 0), THREE.MathUtils.degToRad(start[3] || 0), 0);

// 声: real recordings (temple/sounds); they start with the first click on "Enter the temple". M mutes.
const sound = buildSound(camera, scene, { isNight: () => sky.isNight() });
voices = buildVoices(sound);                       // the pilgrims speak aloud once sound is on (temple/voices.js)
const soundState = () => { const h = $("sound-state"); if (h) h.textContent = sound.muted ? "sound off" : "sound on"; };

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
  if (e.code === "KeyE" && held.holding && !looking) held.close(nowT);
  if (e.code === "KeyY" && !$("annals").open) { const k = held.id?.startsWith("insight:") ? held.id.slice(8) : undefined; held.close(nowT); openAnnals(k); }
  if (e.code === "KeyM") { sound.toggle(); soundState(); }
  if ((e.code === "BracketRight" || e.code === "BracketLeft") && exploring()) { e.preventDefault(); stepToStatue(e.code === "BracketRight" ? 1 : -1); }
  if (e.code === "Escape" && keyboardMode && !$("annals").open) { if (held.holding) held.close(nowT); else setKeyboardMode(false); }
});
addEventListener("keyup", (e) => keys.delete(e.code));
$("enter").addEventListener("click", () => {
  sound.start(); soundState();
  if (params.get("keys") === "1" || !renderer.domElement.requestPointerLock) return setKeyboardMode(true);
  controls.lock();
});
controls.addEventListener("lock", () => { keyboardMode = false; $("intro").hidden = true; $("resume").hidden = true; $("hud").hidden = false; });
// Esc while holding something: the browser lets go of the mouse, and the thing is put down. A click walks on.
controls.addEventListener("unlock", () => {
  if (held.holding) { held.close(nowT); $("resume").hidden = false; return; }
  if ($("resume").hidden) $("intro").hidden = false;
});
$("resume").addEventListener("click", () => { $("resume").hidden = true; controls.lock(); });
// While you hold something the mouse turns it in your hands instead of turning your head.
addEventListener("mousemove", (e) => { if (held.holding && (controls.isLocked || keyboardMode)) held.tilt(e.movementX || 0, e.movementY || 0); });

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
    $("label").innerHTML = `<b>${esc(nameOnTablet(agent))} ${generationCn(agent)}</b><span>${esc(whereCn(agent))}</span><kbd>E</kbd>`;
  }
}
renderer.domElement.addEventListener("click", () => {
  if (controls.isLocked && held.holding) held.close(nowT);          // a click puts down what you hold
  else if (controls.isLocked && looking) act(looking);
});

function blocked(x, z) {
  if (!world.inBounds(x, z)) return true;
  return world.colliders.some(([x0, x1, z0, z1]) => x > x0 - RADIUS && x < x1 + RADIUS && z > z0 - RADIUS && z < z1 + RADIUS);
}
const dir = new THREE.Vector3(), side = new THREE.Vector3();
function walk(dt) {
  const speed = (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 7 : 3.6) * dt;
  const f = (keys.has("KeyW") || keys.has("ArrowUp") || touchWalk ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
  const s = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
  const turn = (keys.has("ArrowLeft") ? 1 : 0) - (keys.has("ArrowRight") ? 1 : 0);   // arrows turn, so no mouse is needed
  if (turn) camera.rotation.y += turn * 1.9 * dt;
  sound.walking(!!(f || s), keys.has("ShiftLeft") || keys.has("ShiftRight"));
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
    : hit.object.userData.lineage ? ancestral.agentAt(hit)
    : hit.object.userData.ids ? hit.object.userData.ids[hit.instanceId] : hit.object.userData.agentId || null;
  lookingKind = !hit ? "statue" : hit.object.userData.lineage ? "ancestor" : id?.startsWith("insight:") ? "stele"
    : agentById.get(id)?.status === "alive" ? "pilgrim" : "statue";
  if (id === looking) return;
  looking = id;
  if (id && id.startsWith("day:")) {
    const d = avenue.days[+id.slice(4)];
    $("label").hidden = false;
    $("label").innerHTML = `<b>${cnDate(d.date)}</b><span>${d.date}: ${d.merit} merit, ${d.active} agents at work${d.ended ? `, ${d.ended} ended` : ""}.</span><kbd>E</kbd>`;
    return;
  }
  if (id === "plaque:ancestral") {
    $("label").hidden = false;
    $("label").innerHTML = `<b>世德祠</b><span>The ancestral hall: every name carried by more than one agent, a tablet for each generation, oldest first.</span>`;
    return;
  }
  if (id === "plaque:name") {
    $("label").hidden = false;
    $("label").innerHTML = `<b>武成王庙</b><span>The temple of the King of Martial Accomplishment. The plaques beside it hold the fleet's records.</span><kbd>E</kbd>`;
    return;
  }
  if (id && id.startsWith("record:")) {
    const r = recordByKey.get(id.slice(7));
    const h = viewDay === lastDay ? r.holder : holderOn(r, viewDay), before = h && r.history[r.history.indexOf(h) - 1];
    if (!h) { $("label").hidden = false; $("label").innerHTML = `<b>${r.cn}</b><span>${esc(r.title)}: not yet set on ${viewDay}.</span>`; return; }
    $("label").hidden = false;
    $("label").innerHTML = `<b>${r.cn}</b><span>${esc(r.title)}: ${esc(r.key === "lineage" ? h.name : h.id)}, ${h.value}${esc(r.unit)}, since ${h.date}.${before ? ` Before: ${esc(r.key === "lineage" ? before.name : before.id)}, ${before.value}${esc(r.unit)}.` : ""}</span><kbd>E</kbd>`;
    return;
  }
  if (id && id.startsWith("insight:")) {
    const ins = insights(data).find((i) => "insight:" + i.key === id);
    $("label").hidden = false;
    $("label").innerHTML = `<b>${ins.cn}碑</b><span>${esc(ins.titleCn || ins.title)}</span><kbd>E</kbd>`;
    return;
  }
  const a = id && agentById.get(id);
  $("label").hidden = !a;
  if (a) $("label").innerHTML = `<b>${esc(nameOnTablet(a))} ${generationCn(a)}</b><span>${esc(whereCn(a))}</span><kbd>E</kbd>`;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ------------------------------------------------------------------ what you hold (手持)
// Everything written on it is Chinese (PR stays PR): this is the temple. The graveyard keeps its English.
const METRIC_CN = { merged: "合并 PR", prs: "合并 PR", "PRs merged": "合并 PR", issues: "已结议题", "Issues closed": "已结议题",
  hours: "工时", "Hours worked": "工时", commits: "提交", Commits: "提交", sessions: "会话", tokens: "用量", cost: "花费" };
const metricCn = (m) => METRIC_CN[m.key] || METRIC_CN[m.label] || m.label;
const unitCn = (u) => (u === " h" ? " 时" : u || "");
function whereCn(a) {
  if (a.status === "alive") return "香客，尚在任事。会话终了，方入座。";
  const p = placement.get(a.id);
  if (!p) return "过客。";
  if (p.zone === "outside") return `功德第${cnNumber(p.rank)}。座已满，候于门外。`;
  return `${ZONES[p.zone].cn}，第${cnNumber(p.no)}座，${p.orig}旧位。功德第${cnNumber(p.rank)}。`;
}
function epitaphCn(a, days) {
  if (a.epitaph) return a.epitaph;
  const top = data.metrics.map((m) => [m, a.stats[m.key]]).find(([, v]) => typeof v === "number" && v >= 10);
  if (top) return `${metricCn(top[0])} ${top[1]}${unitCn(top[0].unit)}，其功可记。`;
  if (days >= 4) return `连任${cnNumber(days)}日，未尝稍歇。`;
  if (a.merit < 0.1) return "来而观之，去而无迹。";
  return "读多写少，问必中肯。";
}
/** Inspect an agent or a stele: a thing shaped after it comes up into your hands. Returns its words. */
function inspect(id, { kind } = {}) {
  const a = agentById.get(id);
  const content = id.startsWith("insight:") ? steleTablet(id.slice(8)) : agentTablet(a);
  if (!content) return null;
  notify("select", { id });
  const k = id.startsWith("insight:") ? "stele" : a.status === "alive" ? "pilgrim" : kind === "ancestor" ? "ancestor" : "statue";
  const text = held.open(content, k, nowT, id);
  $("plate-text").textContent = text;               // the same words for a screen reader
  $("label").hidden = true;                         // what you hold says it all
  return text;
}
function agentTablet(a) {
  if (!a) return null;
  const p = placement.get(a.id), d = dress.byId.get(a.id), h = honour.get(a.id) || {};
  const seal = a.status === "alive" ? "在世" : p ? GROUP_CN[p.zone === "outside" ? "outside" : ZONES[p.zone].group] : "过客";
  const role = d?.role === "general" ? "武将：每个工时所成，多于常人。" : d?.role === "strategist" ? "谋士：所为多在筹划与审阅。" : "";
  const days = new Set(a.series.map((x) => x.date)).size;
  const stats = [{ label: "功德", value: +(+a.merit).toFixed(1) },
    ...data.metrics.filter((m) => a.stats[m.key] !== undefined).map((m) => ({ label: metricCn(m), value: `${a.stats[m.key]}${unitCn(m.unit)}` }))];
  if (stats.length < 6) stats.push({ label: "任事日数", value: days });
  const records = fleetRecords.filter((r) => (viewDay === lastDay ? r.holder : holderOn(r, viewDay))?.id === a.id).map((r) => `执「${r.cn}」匾`);
  return {
    seal, name: nameOnTablet(a), gen: generationCn(a), sub: whereCn(a),
    lines: [role && { text: role + (d?.tool ? `袍色：${d.tool}。` : ""), size: 35, max: 2 }, { text: epitaphCn(a, days), size: 40, max: 2 }].filter(Boolean),
    stats: stats.slice(0, 6), series: a.series, seriesLabel: "每日评分",
    honours: [h.gilded && "金身：功德居前十分之一", ...records].filter(Boolean),
    foot: `${cnDate(a.born)}${a.ended ? `至${cnDate(a.ended)}` : "起，尚在任事"}`,
  };
}
function steleTablet(key) {
  const ins = insights(data).find((i) => i.key === key);
  if (!ins) return null;
  return { seal: "碑", name: `${ins.cn}碑`, sub: ins.titleCn || ins.title, lines: [{ text: ins.findingCn || ins.finding, size: 36, max: 6 }],
    draw: ins.chart ? (g, x, y, w, h) => drawInsight(g, ins, x, y, w, h, "stone", "zh") : null };
}

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
    <section class="panel${focus === "records" ? " focus" : ""}" id="panel-records">
      <h3><b>匾额</b>The fleet's records</h3>
      ${fleetRecords.map((r) => `<p><b>${r.cn}</b> ${esc(r.title)}: ${esc(r.key === "lineage" ? r.holder.name : r.holder.id)}, ${r.holder.value}${esc(r.unit)}, since ${r.holder.date}.${r.history.length > 1 ? ` Held before by ${r.history.slice(0, -1).reverse().slice(0, 3).map((e) => `${esc(r.key === "lineage" ? e.name : e.id)} (${e.value})`).join(", ")}${r.history.length > 4 ? ", …" : ""}.` : ""}</p>`).join("")}
      <p class="n">Each plaque over the main hall holds one record. A record is set when a life ends; a better one takes the plaque.</p>
    </section>
    <section class="panel" id="panel-reading">
      <h3><b>读法</b>How to read the statues</h3>
      <p><b>金身</b> Gilded all over: the top 10% of working agents by merit (${[...honour.values()].filter((h) => h.gilded).length} here).</p>
      <p><b>香</b> Incense in the tripod censer: one stick for each day the agent served, up to twelve.</p>
      <p><b>高</b> Height: within its group, a statue stands up to 8% taller or shorter by its merit rank.</p>
      <p><b>位</b> Seat: merit rank picks the group, the day it began picks the seat, as in the 1123 record.</p>
      ${dress.roles ? `<p><b>甲</b> Armour, helmet and a halberd: a general, who shipped more per hour of work than the median enshrined agent (PRs merged, commits, issues closed). <b>扇</b> Scholar's cap, robe and a feather fan: a strategist, whose work was more planning and reviewing.</p>` : ""}
      ${dress.colourKey ? `<p><b>色</b> Robe colour: the agent's ${dress.colourKey}. ${dress.legend.map((l) => `<span class="swatch" style="background:#${l.colour.toString(16).padStart(6, "0")}"></span>${esc(l.value)}`).join(" ")}</p>` : ""}
      <p><b>天</b> The sky follows the hour where you are: day, dusk, night. The weather follows the fleet's work on the day shown, against its usual day: clear (晴) above it, a thin mist (薄雾) around it, overcast (阴) below it, rain (雨) when little was done.</p>
      <p class="n">Sound: real recordings, a temple bell (Zōjō-ji, Tokyo, the surviving form of the Song bronze bell), a great drum (Suzhou), birds (the Temple of Heaven, Beijing), eave bells (a mountain temple in Korea), wind in pines, footsteps on stone, night insects. <a href="https://github.com/alexgaoth/agent-afterlife/blob/main/temple/sounds/CREDITS.md" target="_blank" rel="noopener">Credits and licences</a>. The pilgrims speak in synthetic voices (CosyVoice 3); with sound off they speak in bubbles. M turns it off.</p>
      <p class="n">${dress.roles ? "" : "Armour or robe, "}${dress.colourKey ? "" : "robe colour, "}face, beard and the shape of hat or helmet only tell agents apart; they carry no data.</p>
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


// ------------------------------------------------------------------ the stele
function carveStele({ slab }, edict, enshrined) {
  const c = document.createElement("canvas"); c.width = 300; c.height = 680;
  const x = c.getContext("2d");
  x.fillStyle = "#6f6d64"; x.fillRect(0, 0, 300, 680);
  x.strokeStyle = "#57554d"; x.lineWidth = 6; x.strokeRect(14, 14, 272, 652);
  x.fillStyle = "#2a2622"; x.textAlign = "center";
  x.font = cjk(64); x.fillText("诏", 150, 96);
  const KIND = { founded: "初建", enshrined: "入祀", promoted: "升", demoted: "降", removed: "黜" };
  const who = (id) => { const a = agentById.get(id); return a ? `${nameOnTablet(a)}${generationCn(a)}` : id; };
  const lines = !edict ? [`初建武庙`, `入祀${cnNumber(enshrined)}位`] : [
    cnDate(edict.date),
    ...edict.items.slice(0, 4).map((i) => i.kind === "founded" ? `初建武庙 入祀${cnNumber(i.count || 0)}位`
      : `${KIND[i.kind]} ${who(i.agent)}${i.from ? ` 自${GROUP_CN[i.from]}` : ""}${i.to ? ` ${i.kind === "removed" ? "出" : "入"}${GROUP_CN[i.to]}` : ""}`),
  ];
  // Columns right to left; Chinese characters upright, Latin words turned on their side.
  x.font = cjk(30);
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
function countLine(view) {
  return `${order.length - outside.length} enshrined, ${alive.length} still working, ${passersBy({ ...view, options: data.options }).length} passers-by${viewDay !== lastDay ? ` · as of ${viewDay}` : ""} · ${sky.weather.cn} ${sky.weather.en}`;
}

// ------------------------------------------------------------------ the timeline
// A slider over every day of the fleet (usable when the mouse is free), and keys while walking: , and . step a
// day, P replays from the first day (one day each 0.6 s). The last day is the fleet as it is.
function syncTimeline() {
  const r = $("tl-day"), i = allDays.indexOf(viewDay);
  if (!r) return;
  r.max = String(Math.max(0, allDays.length - 1)); r.value = String(i);
  $("tl-label").textContent = `${cnDate(viewDay)} · ${viewDay}${viewDay === lastDay ? " · today" : ""}`;
  $("tl-play").textContent = replay ? "❚❚" : "▶";
}
function stepDay(k) { const i = allDays.indexOf(viewDay); showDay(allDays[Math.max(0, Math.min(allDays.length - 1, i + k))]); }
function toggleReplay() {
  if (replay) { clearInterval(replay); replay = null; syncTimeline(); return; }
  if (viewDay === lastDay) showDay(allDays[0]);
  replay = setInterval(() => { if (viewDay === lastDay) toggleReplay(); else stepDay(1); }, 600);
  syncTimeline();
}
$("tl-day")?.addEventListener("input", (e) => showDay(allDays[Number(e.target.value)]));
$("tl-play")?.addEventListener("click", toggleReplay);
if (params.get("record") !== "1" && allDays.length > 1) $("timeline").hidden = false;
addEventListener("keydown", (e) => {
  if (e.target.closest?.("dialog, input, textarea") && e.target.id !== "tl-day") return;
  if (e.code === "Comma") stepDay(-1);
  else if (e.code === "Period") stepDay(1);
  else if (e.code === "KeyP") toggleReplay();
});
syncTimeline();
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  mural.setSize(innerWidth, innerHeight);
}
addEventListener("resize", resize); resize();
const clock = new THREE.Clock();
scene.updateMatrixWorld(true);   // so the first gaze check (before any frame is drawn) sees objects where they stand
mark("scene");
progress("Lighting the lanterns");
const still = params.get("still") === "1";   // ?still=1 draws a few frames and stops: for screenshots and tests

/** Everything that moves with time, then the frame: pilgrims, their speech, the painted scene, then on top of it the
 *  tablet (crisp, with its own depth) and the bubbles. */
function drawAt(t, gaze = false, showSpeech = true) {
  nowT = t;
  pilgrims?.update(t);
  if (showSpeech) speech?.update(t, camera);
  sky.update(t, camera);
  if (gaze) lookAround();
  held.update(t, camera, { night: sky.isNight(), dt: Math.min(0.1, Math.max(0, t - lastT)), drift: params.get("record") !== "1" });
  lastT = t;
  controls.enabled = !held.shown;                   // holding something: the mouse turns it, not your head
  mural.render(scene, camera);
  if (held.shown) {
    renderer.autoClear = false; renderer.clearDepth(); renderer.render(held.scene, camera); renderer.autoClear = true;
  }
  if (showSpeech && speech?.overlay.children.length) {   // the speech bubbles, crisp, on top of the painted scene
    renderer.autoClear = false; renderer.render(speech.overlay, camera); renderer.autoClear = true;
  }
}

// ?record=1: no loop and no page furniture; a recorder steps time itself (tools/record-tour.mjs). It sets the
// camera, calls render(t) once per video frame and captures the canvas, so a video is smooth however slow the
// machine is, and the same every time.
if (params.get("record") === "1") {
  $("intro").hidden = true; $("hud").hidden = true;
  let labels = false;
  const toRad = THREE.MathUtils.degToRad;
  window.afterlife = {
    camera, eye: EYE, floorAt: world.floorAt,
    /** Stand at x, z (on the floor there, plus `rise` metres), facing yaw/pitch in degrees (yaw 0 = toward the main hall). */
    pose(x, z, yaw = 0, pitch = 0, rise = 0) {
      camera.position.set(x, world.floorAt(x, z) + EYE + rise, z);
      camera.rotation.set(toRad(pitch), toRad(yaw), 0);
    },
    lookAt(x, y, z) { camera.lookAt(x, y, z); },
    render(t, { speech = true } = {}) { drawAt(t, labels, speech); },
    labels(on) { labels = !!on; if (!on) $("label").hidden = true; },
    openAnnals(key) { openAnnals(key); },
    closeAnnals() { if ($("annals").open) $("annals").close(); },
    scrollAnnals(px) { $("annals-body").scrollLeft -= px; },
    setDay(day) { showDay(day); },
    setTime(hour) { sky.set({ hour }); },
    setWeather(w) { sky.set({ weather: w || weatherOn(viewDay) }); },
    days: allDays,
    /** What the pilgrims said aloud so far: [{ t, id, voice, at: {x,y,z}, text, clips: [{ src, at, dur }] }]; src is under temple/voices/. */
    voiceLog: () => voiceLog,
    /** Inspect what the camera looks at, as E does: its tablet rises. Returns what was inspected, or null. */
    inspectAt() { looking = null; lookAround(); $("label").hidden = !labels; if (!looking || looking.startsWith("day:") || looking.startsWith("record:") || looking.startsWith("plaque:")) return null; inspect(looking, { kind: lookingKind }); return looking; },
    /** Inspect an agent (by id) or a stele ("insight:<key>"). opts: { side, dist } in metres. */
    inspect(id, opts = {}) { return inspect(id, opts); },
    /** What is held now: { id, kind } or null. */
    holding: () => (held.shown ? { id: held.id, kind: held.kind } : null),
    /** The pilgrims at render time t (their walk depends only on t): [{ id, name, merit, x, y, z, scale }]. */
    pilgrimsAt(t) {
      if (!pilgrims) return [];
      pilgrims.update(t);
      return pilgrims.walkers().map((w) => { const a = agentById.get(w.id);
        return { id: w.id, name: a?.name ?? null, merit: a?.merit ?? 0, x: +w.position.x.toFixed(3), y: +w.position.y.toFixed(3), z: +w.position.z.toFixed(3), scale: w.scale || 1 }; });
    },
    /** The ancestral tablets, where they hang: [{ id, name, merit, panel, x, y, z }]. */
    tablets: () => ancestral.tablets(),
    /** The seated, where they sit: [{ id, name, zone, x, y, z, role, gilded }] (y: the seat's floor). */
    statues: () => seats.filter((x) => x.agent).map((x) => { const at = world.seats[x.zone][x.no - 1];
      return { id: x.agent.id, name: x.agent.name, zone: x.zone, x: at.x, y: at.y, z: at.z, role: dress.byId.get(x.agent.id)?.role || null, gilded: !!honour.get(x.agent.id)?.gilded }; }),
    /** Lower the tablet (it sinks over half a second of render time). */
    closePlate() { held.close(nowT); },
    /** Turn what is held to an angle in degrees (yaw: positive turns its face to the left; pitch: positive tips its top away). */
    tiltPlate(yaw, pitch) { held.setTilt(yaw, pitch); },
    ready: false,
  };
  voices.ready.then(() => { window.afterlife.ready = true; });   // the pack (or its absence) is known before the first frame
  mark("first-frame");
} else renderer.setAnimationLoop(() => {
  if (still && frame > 1) {   // two frames: the first uploads textures
    // Freeze: copy the last frame into an <img>, which any screenshot sees, then stop rendering.
    renderer.setAnimationLoop(null);
    const img = new Image(); img.src = renderer.domElement.toDataURL("image/png"); img.id = "still";
    img.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;z-index:0";
    document.body.prepend(img);
    return;
  }
  const dt = Math.min(0.05, clock.getDelta());
  if (exploring() && !held.shown) walk(dt); else sound.walking(false);
  drawAt(still ? (Number(params.get("t")) || 0) : clock.elapsedTime, frame++ % 6 === 0);   // ?still=1: the same moment on every load
  if (frame === 1) {
    mark("first-frame");
    const enter = $("enter"); enter.disabled = false; enter.textContent = "Enter the temple";
    const t = Object.fromEntries(performance.getEntriesByType("mark").filter((m) => m.name.startsWith("afterlife:")).map((m) => [m.name.slice(10), Math.round(m.startTime)]));
    notify("shown", { ms: t["first-frame"], marks: t, quality });       // embedders can hide their spinner now
  }
  if (frame === 31) notify("steady", { msPerFrame: Math.round((performance.now() - performance.getEntriesByName("afterlife:first-frame")[0].startTime) / 30), quality });
});
if (params.get("cam")) { $("intro").hidden = true; }   // a set camera (for links and screenshots) skips the intro
onOpenRequest((id) => { $("intro").hidden = true; inspect(id); });
if (params.get("read")) { $("intro").hidden = true; inspect(params.get("read")); }   // ?read=<agent id> raises its tablet
if (params.get("annals") !== null) { $("intro").hidden = true; openAnnals(params.get("annals") || undefined); }   // ?annals[=key]
