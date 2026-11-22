#!/usr/bin/env node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { serve } from "../cli/site.js";
import { chronicle } from "../shared/insights.js";
import { duckIntervals, mixVoices, planVoices } from "./record-voices.mjs";
import { INSPECTIONS, INSPECTION_SECONDS, PLATE_OPTS, inspectionPose, inspectionSchedule, pickTarget } from "./tour-inspections.mjs";

const DATA = "https://raw.githubusercontent.com/alexgaoth/agent-afterlife/data/afterlife-zh.json";
const WIDTH = 1920, HEIGHT = 1080, FPS = 30;
// The original walk uses 150.8 route units for 118 seconds. Insert holds
// in those same units so the existing legs keep their pace.
const SCORE_RATE = 150.8 / 118;
const PILGRIM_HOLD = 3 * SCORE_RATE;
const WING_HOLD = 6 * SCORE_RATE;
const TURN = 4 * SCORE_RATE;
const REPLAY = 8 * SCORE_RATE;
const TERRACE = 2 * TURN + REPLAY;
const DUSK = 11 * SCORE_RATE; // 10 seconds of dusk, then one second of fade
const DURATION = 118 + 3 + 6 + 16 + 11 + INSPECTIONS.length * INSPECTION_SECONDS;
const INSPECTION_SPAN = INSPECTION_SECONDS * SCORE_RATE;
const STEPS_PER_SPAN = 48;
const SOUNDS = fileURLToPath(new URL("../temple/sounds/", import.meta.url));
const SOUND_CREDITS = "https://github.com/alexgaoth/agent-afterlife/blob/main/temple/sounds/CREDITS.md";
const VOICE_CREDITS = "https://github.com/alexgaoth/agent-afterlife/blob/main/temple/voices/CREDITS.md";
const abort = new AbortController();
const { signal } = abort;
const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const lerp = (a, b, u) => a + (b - a) * u;
const ease = (u) => u * u * (3 - 2 * u);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Match the east row in temple/avenue.js. Choose the midpoint between lanterns
// rather than recording a crossing that only works with one fleet's data.
function eastCrossing(rows, z, from, to) {
  const count = Math.min(60, rows.length);
  const row = [34];
  for (let i = 1; i < count; i += 2) row.push(34 - 49 * i / (count - 1));
  row.push(-15);
  const gaps = row.slice(1).map((at, i) => clamp((at + row[i]) / 2, from, to));
  // Stay between the adjacent steles as well as between the lanterns.
  const clearance = (at) => Math.min(...row.map((light) => Math.abs(light - at)));
  return [z, ...gaps].sort((a, b) => {
    const da = clearance(a), db = clearance(b);
    if (da >= .75 && db >= .75) return Math.abs(a - z) - Math.abs(b - z);
    return db - da;
  })[0];
}

// Each leg specifies its end time, ground path in metres, and head turns as
// [fraction of leg, yaw, pitch]. Use unwrapped yaw for turns across south.
const baseRoute = (outbound, inbound) => [
  { end: 16.8, path: [[0, 48], [0, 42], [0.1, 38], [0.4, 32], [0.4, 23]], gaze: [[0, 0, 22], [.28, 0, 2], [.68, 3, 4], [1, -10, 3]] },
  { end: 22.5, path: [[0.4, 23], [0.5, 20], [0.4, 17.5]],
    gaze: [[0, -10, 3], [.35, 30, 6], [.77, 40, 6], [1, 53, 8]] },
  { end: 26.1, path: [[0.4, 17.5]], gaze: [[0, 53, 8], [.3, 56, 8], [.68, -53, 7], [1, -96, 3]] },
  { end: 38.8, path: [[0.4, 17.5], [1.7, outbound], [4.2, outbound], [7, 12.1], [12, 10], [15.4, 8.3], [16.8, 8.1]],
    gaze: [[0, -96, 3], [.32, -65, 0], [.67, -69, 0], [1, -53, 4]] },
  { end: 45, path: [[16.8, 8.1]], gaze: [[0, -53, 4], [.40, -105, 3], [.65, -84, 3], [.91, -94, 3], [1, -135, 3]] },
  { end: 58.5, path: [[16.8, 8.1], [12, 6.6], [7.3, 3.8], [4.2, inbound], [1.7, inbound], [1, 0]],
    gaze: [[0, -135, 3], [.48, -281, 1], [.76, -306, 5], [1, -360, 6]] },
  { end: 73.7, path: [[1, 0], [1.5, -3], [1.8, -9.8], [1.8, -13.7], [0.3, -16.8], [0, -19.5], [0, -21.5]],
    gaze: [[0, -360, 6], [.6, -356, 10], [1, -360, 26]] },
  { end: 77.3, path: [[0, -21.5]], gaze: [[0, -360, 26], [.54, -354, 28], [1, -360, 23]] },
  { end: 84, path: [[0, -21.5], [0, -26], [0, -30]], gaze: [[0, -360, 23], [.44, -360, 5], [1, -360, 9]] },
  { end: 95, path: [[0, -30]],
    gaze: [[0, -360, 9], [.19, -360, 9], [.41, -307, 3], [.79, -413, 3], [1, -413, 3]] },
  { end: 107.5, path: [[0, -30], [0, -24], [0, -19], [-0.7, -16], [-2.5, -15.8], [-5.5, -16]],
    gaze: [[0, -413, 3], [.54, -572, 0], [.91, -634, 0], [1, -634, 0]] },
  // Pass north of the west wing, then line up with the doorway in the perimeter wall.
  { end: 128.5, path: [[-5.5, -16], [-12, -16.8], [-16, -17.9], [-21.8, -18.3], [-24.5, -20], [-29, -20], [-33, -20]],
    gaze: [[0, -634, 0], [.26, -613, 1], [.63, -654, 5], [.86, -630, 12], [1, -630, 23]] },
  { end: 133.0, path: [[-33, -20], [-36.8, -20]], gaze: [[0, -630, 23], [.2, -630, 23], [.85, -630, 5], [1, -630, 5]] },
  { end: 141.0, path: [[-36.8, -20]], gaze: [[0, -630, 5], [.36, -630, 5], [1, -810, 1]] },
  { end: 147.0, path: [[-36.8, -20], [-34.5, -20], [-30, -20]], gaze: [[0, -810, 1], [1, -810, 4]] },
  { end: 150.8, path: [[-30, -20]], gaze: [[0, -810, 4], [1, -807, 5]] },
];

function route(outbound, inbound, shots) {
  const legs = [];
  let added = 0;
  for (const leg of baseRoute(outbound, inbound)) {
    if (leg.end === 26.1) added += PILGRIM_HOLD;
    if (leg.end === 45) added += WING_HOLD;
    legs.push({ ...leg, end: leg.end + added });
    const shot = shots.find(({ after }) => after === leg.end);
    if (shot) {
      const [, yaw, pitch] = leg.gaze.at(-1);
      legs.push({ end: leg.end + (added += INSPECTION_SPAN), path: [leg.path.at(-1)],
        gaze: [[0, yaw, pitch], [1, yaw, pitch]], shot });
    }
    if (leg.end !== 77.3) continue;
    const path = [[0, -21.5]], north = [-360, 23], south = [-180, -6];
    legs.push({ end: leg.end + (added += TURN), path, gaze: [[0, ...north], [1, ...south]] });
    legs.push({ end: leg.end + (added += REPLAY), path, gaze: [[0, ...south], [1, ...south]], replay: true });
    legs.push({ end: leg.end + (added += TURN), path, gaze: [[0, ...south], [1, ...north]] });
  }
  added += DUSK;
  const hold = legs.at(-1);
  // Keep the original closing pan, then hold the same view while the light changes.
  hold.gaze[1][0] = (150.8 - 147) / (150.8 - 147 + DUSK);
  hold.gaze.push([1, ...hold.gaze[1].slice(1)]);
  hold.end = 150.8 + added;
  return legs;
}

const samples = [
  ["01-gate", .2], ["02-pilgrims", 14.7], ["03-steles", 25, PILGRIM_HOLD],
  ["04-east-wing", 41.5, PILGRIM_HOLD + .75 * WING_HOLD], ["05-terrace", 75.3, PILGRIM_HOLD + WING_HOLD],
  ["05a-timeline", 77.3, PILGRIM_HOLD + WING_HOLD + TURN + .77 * REPLAY],
  ["06-main-hall", 85.5, PILGRIM_HOLD + WING_HOLD + TERRACE],
  ["07-ancestral-hall", 134.5, PILGRIM_HOLD + WING_HOLD + TERRACE],
  ["08-side-court", 148.5, PILGRIM_HOLD + WING_HOLD + TERRACE],
  ["09-dusk", 150.8, PILGRIM_HOLD + WING_HOLD + TERRACE + 9.8 * SCORE_RATE],
];

// Centripetal Catmull-Rom. The table maps distance to position so short spans
// between control points do not make the camera slow down.
function pathTable(points) {
  const table = [{ distance: 0, point: points[0] }];
  for (let i = 0; i < points.length - 1; i++) {
    const b = points[i], c = points[i + 1];
    const a = points[i - 1] ?? b.map((v, d) => 2 * v - c[d]);
    const d = points[i + 2] ?? c.map((v, j) => 2 * v - b[j]);
    const t1 = Math.sqrt(dist(a, b)), t2 = t1 + Math.sqrt(dist(b, c)), t3 = t2 + Math.sqrt(dist(c, d));
    for (let step = 1; step <= STEPS_PER_SPAN; step++) {
      const t = lerp(t1, t2, step / STEPS_PER_SPAN);
      const point = b.map((_, j) => {
        const q0 = lerp(a[j], b[j], t / t1);
        const q1 = lerp(b[j], c[j], (t - t1) / (t2 - t1));
        const q2 = lerp(c[j], d[j], (t - t2) / (t3 - t2));
        return lerp(lerp(q0, q1, t / t2), lerp(q1, q2, (t - t1) / (t3 - t1)), (t - t1) / (t2 - t1));
      });
      const prev = table.at(-1);
      table.push({ distance: prev.distance + dist(prev.point, point), point });
    }
  }
  return table;
}

export function makeTour(seconds, rows, shots = INSPECTIONS) {
  const legs = route(eastCrossing(rows, 14.8, 12.3, 15.1), eastCrossing(rows, 3.25, 1.5, 3.35), shots);
  const scale = seconds / legs.at(-1).end;
  const duskStart = seconds - DUSK * scale;
  // Fit one spline to each run of connected legs. No abrupt tangent change at a leg boundary.
  const runs = [];
  const inspections = [];
  let start = 0, run, walked = 0;
  const timeline = legs.map(({ end, path, gaze, replay, shot }) => {
    const moving = path.length > 1;
    if (moving && !run) {
      run = { start: start * scale, points: [path[0]], marks: [{ t: start * scale, index: 0 }] };
      runs.push(run);
    }
    if (!moving) run = undefined;
    if (run) {
      run.points.push(...path.slice(1));
      run.marks.push({ t: end * scale, index: run.points.length - 1 });
      run.end = end * scale;
    }
    const leg = { start: start * scale, end: end * scale, gaze, run, replay, point: path[0], shot };
    if (shot) inspections.push({ ...inspectionSchedule(shot, leg.start, leg.end, FPS), start: leg.start, end: leg.end });
    start = end;
    return leg;
  });
  for (const r of runs) {
    r.table = pathTable(r.points);
    r.walked = walked;
    walked += r.table.at(-1).distance;
    for (const m of r.marks) m.distance = r.table[m.index * STEPS_PER_SPAN].distance;
    for (let i = 0; i < r.marks.length; i++) {
      const a = r.marks[i - 1], m = r.marks[i], b = r.marks[i + 1];
      m.speed = a && b ? Math.min((m.distance - a.distance) / (m.t - a.t), (b.distance - m.distance) / (b.t - m.t)) : 0;
    }
  }

  function position(t, leg) {
    const r = leg.run;
    if (!r) return [...leg.point, 0];
    const i = r.marks.findIndex((mark) => mark.t >= t && mark !== r.marks[0]);
    const a = r.marks[i - 1], b = r.marks[i];
    const dt = b.t - a.t, elapsed = t - a.t, leftOver = b.t - t;
    // Hold a steady pace between short speed ramps. Integrate the eased
    // velocity on either side, with matching speeds where legs join.
    const ramp = Math.min(1.1, dt / 3);
    const pace = (b.distance - a.distance - ramp * (a.speed + b.speed) / 2) / (dt - ramp);
    const rampDistance = (d, speed) => {
      const u = d / ramp;
      return speed * d + (pace - speed) * ramp * u ** 3 * (1 - u / 2);
    };
    const s = elapsed < ramp ? a.distance + rampDistance(elapsed, a.speed)
      : leftOver < ramp ? b.distance - rampDistance(leftOver, b.speed)
      : a.distance + ramp * (a.speed + pace) / 2 + (elapsed - ramp) * pace;
    let lo = 0, hi = r.table.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (r.table[mid].distance < s) lo = mid; else hi = mid;
    }
    const left = r.table[lo], right = r.table[hi];
    const f = clamp((s - left.distance) / (right.distance - left.distance));
    const bob = .014 * Math.sin((s + r.walked) * 2 * Math.PI / .72)
      * ease(clamp(Math.min(t - r.start, r.end - t) / .55));
    return [lerp(left.point[0], right.point[0], f), lerp(left.point[1], right.point[1], f), bob];
  }

  const legAt = (t) => timeline.find((leg) => t <= leg.end) ?? timeline.at(-1);
  function frame(time) {
    const t = clamp(time, 0, seconds), leg = legAt(t);
    const u = clamp((t - leg.start) / (leg.end - leg.start));
    const i = leg.gaze.findIndex(([at], index) => index > 0 && at >= u);
    const [a, yaw0, pitch0] = leg.gaze[i - 1], [b, yaw1, pitch1] = leg.gaze[i];
    const turn = ease((u - a) / (b - a));
    const [x, z, bob] = position(t, leg);
    // Average floor height over a short distance in time to soften platform edges.
    const ground = Array.from({ length: 13 }, (_, j) => {
      const at = clamp(t + (j - 6) * .055, 0, seconds);
      return position(at, legAt(at)).slice(0, 2);
    });
    const dusk = clamp((t - duskStart) / ((DUSK - SCORE_RATE) * scale));
    // Hold on the oldest and newest views for one second each.
    const history = leg.replay ? clamp((u - .125) / .75) : null;
    return {
      x, z, yaw: lerp(yaw0, yaw1, turn), pitch: lerp(pitch0, pitch1, turn), bob, ground, t, shot: leg.shot?.kind,
      hour: t < duskStart ? 10.5 : lerp(16.5, 19.5, dusk), history,
    };
  }
  const remap = (base, holds = 0) => (base + holds + shots.filter(({ after }) => after < base).length * INSPECTION_SPAN) * scale;
  const frames = new Map(samples.map(([name, base, holds]) => [Math.round(remap(base, holds) * FPS), name]));
  for (const shot of inspections) frames.set(shot.sampleFrame, shot.sample);
  return {
    frame, runs, inspections,
    bell: remap(82.1, PILGRIM_HOLD + WING_HOLD + TERRACE),
    drum: remap(150.8, PILGRIM_HOLD + WING_HOLD + TERRACE + 4 * SCORE_RATE),
    chimes: [remap(9), remap(39.5, PILGRIM_HOLD), remap(67, PILGRIM_HOLD + WING_HOLD),
      remap(121, PILGRIM_HOLD + WING_HOLD + TERRACE), remap(130, PILGRIM_HOLD + WING_HOLD + TERRACE)],
    duskStart, samples: frames,
  };
}

async function run(command, args, capture = false) {
  const child = spawn(command, args, { signal, stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"] });
  let stdout = "";
  if (capture) child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  const [code] = await once(child, "close");
  if (code !== 0) throw new Error(`${command} exited with code ${code}`);
  return stdout.trim();
}

class DevTools {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.open = once(this.ws, "open", { signal });
    this.ws.addEventListener("message", ({ data }) => {
      const { id, result, error } = JSON.parse(data);
      const request = this.pending.get(id);
      if (request) error ? request.reject(new Error(error.message)) : request.resolve(result);
    });
    this.ws.addEventListener("close", () => {
      for (const req of this.pending.values()) req.reject(new Error("Chrome disconnected"));
    });
  }

  async call(method, params = {}) {
    await this.open;
    signal.throwIfAborted();
    const id = ++this.id;
    let timeout;
    try {
      return await new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`Chrome timed out: ${method}`)), 30_000);
        this.pending.set(id, { resolve, reject });
        this.ws.send(JSON.stringify({ id, method, params }));
      });
    } finally {
      clearTimeout(timeout);
      this.pending.delete(id);
    }
  }

  async evaluate(expression) {
    const { result, exceptionDetails } = await this.call("Runtime.evaluate", { expression, returnByValue: true });
    if (exceptionDetails) throw new Error(result.description ?? exceptionDetails.text);
    return result.value;
  }
}

async function until(get, description) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const result = await get();
    if (result) return result;
    await wait(100, null, { signal });
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function loadData(source) {
  if (!/^https?:\/\//.test(source)) return JSON.parse(await readFile(resolve(source), "utf8"));
  const response = await fetch(source, { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
  if (!response.ok) throw new Error(`Data request returned HTTP ${response.status}`);
  return response.json();
}

async function capture(root, data, tour, count, sampleDir, preview) {
  const profile = join(root, "chrome");
  const onMac = process.platform === "darwin";
  const chrome = process.env.CHROME_PATH || (onMac ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");
  const { server } = await serve({ data: () => data, port: 0, open: false, log: () => {} });
  let browser, done, cdp, exited, launchError;
  let stderr = "";
  try {
    browser = spawn(chrome, [
      "--headless=new", ...(onMac ? ["--use-angle=metal"] : []), "--no-proxy-server", "--hide-scrollbars",
      "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "about:blank",
    ], { stdio: ["ignore", "ignore", "pipe"] });
    done = new Promise((resolve) => browser.once("close", (code) => { exited = code ?? "signal"; resolve(); }));
    browser.once("error", (error) => { launchError = error; });
    browser.stderr.setEncoding("utf8").on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    const stopBrowser = () => browser.kill();
    signal.addEventListener("abort", stopBrowser, { once: true });
    try {
      const port = await until(async () => {
        if (launchError) throw launchError;
        if (exited !== undefined) throw new Error(`Chrome exited: ${exited}\n${stderr}`);
        const contents = await readFile(join(profile, "DevToolsActivePort"), "utf8").catch((e) => {
          if (e.code !== "ENOENT") throw e;
        });
        return contents?.split("\n")[0];
      }, "Chrome DevTools");
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal })).json();
      const target = targets.find(({ type }) => type === "page");
      if (!target) throw new Error("Chrome did not open a page");
      cdp = new DevTools(target.webSocketDebuggerUrl);
      await cdp.call("Page.enable");
      await cdp.call("Emulation.setDeviceMetricsOverride", {
        width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false,
      });
      // The weather URL option keeps showDay() from restoring historical weather.
      const url = `http://127.0.0.1:${server.address().port}/temple/?record=1&still=1&quality=high&weather=clear&voiceRange=12&data=data.json`;
      const nav = await cdp.call("Page.navigate", { url });
      if (nav.errorText) throw new Error(nav.errorText);
      const { layout, days } = await until(() => cdp.evaluate(`(() => {
        const error = document.querySelector("#error:not([hidden])");
        if (error) throw new Error(error.innerText);
        if (window.afterlife?.ready) {
          const a = window.afterlife;
          a.labels(false);
          a.setWeather("clear");
          a.setTime(10.5);
          const canvas = document.querySelector("canvas");
          return { layout: [innerWidth, innerHeight, devicePixelRatio, canvas.width, canvas.height], days: a.days };
        }
      })()`), "the temple. Check the data URL, WebGL, and access to jsDelivr");
      if (String(layout) !== `${WIDTH},${HEIGHT},1,${WIDTH},${HEIGHT}`) {
        throw new Error(`Expected a ${WIDTH}x${HEIGHT} canvas and viewport. Received: ${layout}`);
      }

      const lineages = new Map();
      for (const a of data.agents) if (a.name !== "Unnamed") lineages.set(a.name, (lineages.get(a.name) ?? 0) + 1);
      const panelCount = [...lineages.values()].filter((n) => n > 1).length;
      const shots = new Map();
      const statues = tour.inspections.length ? await cdp.evaluate("window.afterlife.statues()") : [];
      for (const shot of tour.inspections) {
        const frame = tour.frame((shot.start + shot.end) / 2);
        const target = pickTarget(shot, frame, statues, panelCount);
        const eye = await cdp.evaluate(`window.afterlife.floorAt(${frame.x}, ${frame.z}) + window.afterlife.eye`);
        shots.set(shot.kind, { ...shot, target, eye });
      }
      const poseAt = (time) => {
        const frame = tour.frame(time);
        const shot = shots.get(frame.shot);
        return shot ? inspectionPose(frame, (time - shot.start) * INSPECTION_SECONDS / (shot.end - shot.start), shot.target, shot.eye) : frame;
      };
      const inspected = new Set();
      console.log(`Capturing ${preview ? "tour previews" : `${count} frames at ${WIDTH}x${HEIGHT}`}`);
      console.log(`Terrace: ${days.length} days from ${days[0] ?? "none"} to ${days.at(-1) ?? "none"}`);
      const started = performance.now();
      const eyeHeights = new Float32Array(count);
      let lastDay = days.at(-1), lastHour = 10.5;
      for (let i = 0; i < count; i++) {
        const sample = tour.samples.get(i);
        const { x, z, yaw, pitch, bob, ground, t, hour, history, shot: kind } = poseAt(i / FPS);
        const shot = shots.get(kind);
        const open = i === shot?.openFrame ? shot.target : null;
        const close = i === shot?.closeFrame;
        const day = history === null ? days.at(-1) : days[Math.floor(history * (days.length - 1))];
        // Step speech at the full frame rate in previews, too, so it starts on the same frames.
        const args = JSON.stringify([x, z, yaw, pitch, bob, ground, t, day === lastDay ? null : day,
          hour === lastHour ? null : hour, history === null, open, close]);
        const [eye, id] = await cdp.evaluate(`(([x, z, yaw, pitch, bob, ground, t, day, hour, speech, open, close]) => {
          const a = window.afterlife;
          if (day !== null) a.setDay(day);
          if (hour !== null) a.setTime(hour);
          const y = ground.reduce((sum, [gx, gz]) => sum + a.floorAt(gx, gz), 0) / ground.length;
          a.pose(x, z, yaw, pitch, y - a.floorAt(x, z) + bob);
          let id = null;
          if (open) {
            for (const dy of [0, .12, -.12, .28, -.28]) {
              a.lookAt(open.aim[0], open.aim[1] + dy, open.aim[2]);
              id = a.inspectAt(${JSON.stringify(PLATE_OPTS)});
              if (id && (!open.id || id === open.id)) break;
            }
          }
          if (close) a.closePlate();
          a.render(t, { speech });
          return [a.camera.position.y, id];
        })(${args})`);
        eyeHeights[i] = eye;
        if (open) {
          if (!id || (open.id && id !== open.id) || inspected.has(id)) {
            throw new Error(`${kind} inspection at ${t.toFixed(2)} s did not hit a distinct target (hit ${id ?? "nothing"})`);
          }
          inspected.add(id);
          console.log(`Inspected ${kind} at ${t.toFixed(2)} s: ${id}`);
        }
        lastDay = day;
        lastHour = hour;
        if (!preview) {
          const { data } = await cdp.call("Page.captureScreenshot", { format: "jpeg", quality: 92 });
          await writeFile(join(root, `frame-${String(i).padStart(6, "0")}.jpg`), Buffer.from(data, "base64"));
        }
        if (sampleDir && sample) {
          const { data } = await cdp.call("Page.captureScreenshot", { format: "png" });
          await writeFile(join(sampleDir, `${sample}.png`), Buffer.from(data, "base64"));
        }
        if (!preview && ((i + 1) % 300 === 0 || i + 1 === count)) {
          const elapsed = (performance.now() - started) / 1000;
          console.log(`${i + 1}/${count} frames (${((i + 1) / elapsed).toFixed(1)} fps)`);
        }
      }
      console.log(`Capture finished in ${((performance.now() - started) / 1000).toFixed(1)} s`);
      const log = await cdp.evaluate("window.afterlife.voiceLog()");
      return planVoices(log, (time) => {
        const { x, z, yaw } = poseAt(time);
        const frame = clamp(time * FPS, 0, count - 1);
        const y = lerp(eyeHeights[Math.floor(frame)], eyeHeights[Math.ceil(frame)], frame % 1);
        return { x, y, z, yaw };
      });
    } finally {
      signal.removeEventListener("abort", stopBrowser);
    }
  } finally {
    cdp?.ws.close();
    if (browser && exited === undefined) browser.kill();
    await done;
    await new Promise((resolve) => server.close(resolve));
  }
}

// Build an FFmpeg graph from the local recordings. Missing sounds do not add synthetic audio.
async function audioPlan(seconds, tour, voiceTrack, duck) {
  const inputs = [], filters = [], tracks = [];
  async function add(name) {
    const path = join(SOUNDS, `${name}.mp3`);
    try { await access(path); } catch (e) { if (e.code === "ENOENT") return null; throw e; }
    inputs.push("-i", path);
    return `[${inputs.length / 2}:a]`;
  }
  async function loop(name, volume, envelope = "") {
    let src = await add(name);
    if (!src) return;
    const length = Number(await run("ffprobe", [
      "-v", "error", "-select_streams", "a:0", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", inputs.at(-1),
    ], true));
    if (!(length > 0)) throw new Error(`No audio duration for ${inputs.at(-1)}`);
    const overlap = Math.min(length / 4, name === "footsteps-stone" ? .12 : 1.5);
    // MP3 duration includes codec padding. Leave a little margin before trimming the final loop.
    const copies = Math.max(1, Math.ceil((seconds - overlap + .1) / (length - overlap)));
    if (copies > 1) {
      const parts = Array.from({ length: copies }, (_, i) => `[${name}-${i}]`);
      filters.push(`${src}asplit=${copies}${parts.join("")}`);
      src = parts[0];
      for (let i = 1; i < copies; i++) {
        const mix = `[${name}-loop${i}]`;
        filters.push(`${src}${parts[i]}acrossfade=d=${overlap}:c1=qsin:c2=qsin${mix}`);
        src = mix;
      }
    }
    filters.push(`${src}atrim=duration=${seconds},volume=${volume}${envelope}[${name}]`);
    tracks.push(`[${name}]`);
  }
  async function cue(name, volume, times, duration) {
    const src = await add(name);
    if (!src) return;
    const cues = times.map((_, i) => `[${name}-${i}]`);
    if (times.length > 1) filters.push(`${src}asplit=${times.length}${cues.join("")}`);
    const trim = duration ? `atrim=duration=${duration},afade=t=out:st=${duration - 2}:d=2,` : "";
    times.forEach((t, i) => {
      const out = `[${name}-at${i}]`;
      filters.push(`${times.length > 1 ? cues[i] : src}${trim}afade=d=${duration ? 1 : .08},volume=${volume},adelay=${Math.round(t * 1000)}:all=1${out}`);
      tracks.push(out);
    });
  }
  const gate = tour.runs.map(({ start, end }) => `max(0,min(1,min((t-${start})/0.4,(${end}-t)/0.4)))`).join("+");
  await loop("wind-pines", .18);
  const duskGain = `clip((t-${tour.duskStart})/(${seconds}-(${tour.duskStart})),0,1)`;
  await loop("birds-day", .09, `,volume='if(isnan(t),1,1-${duskGain})':eval=frame`);
  await loop("night-insects", .075, `,volume='if(isnan(t),0,${duskGain})':eval=frame`);
  await loop("footsteps-stone", .19, `,volume='if(isnan(t),0,${gate})':eval=frame`);
  await cue("eave-bells", .14, tour.chimes, 7);
  await cue("bell", .25, [tour.bell]);
  await cue("drum", .22, [tour.drum]);
  if (!tracks.length && !voiceTrack) return ["-an"];
  const mix = [];
  if (tracks.length) {
    // Short ramps avoid jumps in the bed. Cap the reduction when ramps overlap.
    const envelope = duck.map(([a, b]) => `clip(min((t-(${a}))/0.08+1,((${b})-t)/0.2+1),0,1)`).join("+");
    const attenuation = duck.length ? `,volume='if(isnan(t),1,1-0.29205*min(1,${envelope}))':eval=frame` : "";
    filters.push(`${tracks.join("")}amix=inputs=${tracks.length}:normalize=0,volume=3.4${attenuation}[bed]`);
    mix.push("[bed]");
  }
  if (voiceTrack) {
    inputs.push("-i", voiceTrack);
    mix.push(`[${inputs.length / 2}:a]`);
  }
  const fade = Math.min(seconds / 2, 1);
  const summed = mix.length > 1 ? `${mix.join("")}amix=inputs=${mix.length}:normalize=0,` : mix[0];
  // Leave headroom for true peaks from AAC encoding.
  filters.push(`${summed}apad,atrim=duration=${seconds},afade=d=${fade},afade=t=out:st=${seconds - fade}:d=${fade},`
    + "alimiter=limit=0.76:level=0:latency=1[audio]");
  const credits = [
    tracks.length && `Temple field recordings, edited and mixed: ${SOUND_CREDITS}`,
    voiceTrack && `Synthetic Mandarin voices: ${VOICE_CREDITS}`,
  ].filter(Boolean);
  return [
    ...inputs, "-filter_complex", filters.join(";"), "-map", "0:v:0", "-map", "[audio]", "-c:a", "aac",
    "-metadata", `comment=${credits.join(" | ")}`,
  ];
}

async function main() {
  const { values } = parseArgs({ options: {
    out: { type: "string" }, web: { type: "string" }, data: { type: "string", default: DATA }, seconds: { type: "string" },
    frames: { type: "string" }, preview: { type: "boolean" }, "no-inspections": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  } });
  if (values.help) {
    console.log("Usage: node tools/record-tour.mjs --out <file.mp4> [--web <file.mp4>] [--data <URL or JSON file>] [--seconds N] [--frames <dir>] [--no-inspections]");
    console.log("To check the route without encoding: node tools/record-tour.mjs --preview --frames <dir>");
    return;
  }
  if (typeof WebSocket === "undefined") throw new Error("Use Node 22+, or Node 20 with --experimental-websocket");
  const requested = Number(values.seconds ?? (values["no-inspections"] ? DURATION - INSPECTIONS.length * INSPECTION_SECONDS : DURATION));
  if (!Number.isFinite(requested) || requested < 1) throw new Error("--seconds must be at least 1");
  if (values.preview ? !values.frames || values.out || values.web
    : !values.out || !/\.mp4$/i.test(values.out) || (values.web && !/\.mp4$/i.test(values.web))) {
    throw new Error("Use --out <file.mp4> with optional --web <file.mp4>, or --preview --frames <dir>");
  }
  const out = values.out ? resolve(values.out) : null;
  const web = values.web ? resolve(values.web) : null;
  if (web && web === out) throw new Error("--out and --web must name separate files");
  const sampleDir = values.frames ? resolve(values.frames) : null;
  const count = Math.round(requested * FPS), seconds = count / FPS;
  const data = await loadData(values.data);
  const tour = makeTour(seconds, chronicle(data).chart.rows, values["no-inspections"] ? [] : INSPECTIONS);
  if (tour.inspections.some((s) => (s.closeFrame - s.openFrame) / FPS < .9 || s.end - s.closeFrame / FPS < .55)) {
    throw new Error("The tour is too short for the tablets to rise and sink. Increase --seconds or use --no-inspections.");
  }
  if (out) {
    await run("ffmpeg", ["-version"], true);
    await mkdir(dirname(out), { recursive: true });
  }
  if (sampleDir) await mkdir(sampleDir, { recursive: true });
  const root = await mkdtemp(join(out ? dirname(out) : sampleDir, ".record-tour-"));
  const started = performance.now();
  try {
    const voices = await capture(root, data, tour, count, sampleDir, values.preview);
    const report = JSON.stringify(voices, null, 2) + "\n";
    console.log(`Recorded ${voices.length} pilgrim lines (${voices.filter((line) => line.clips.length > 1).length} with names)`);
    if (values.preview) {
      await writeFile(join(sampleDir, "voices.json"), report);
      return;
    }
    const voiceTrack = voices.length ? join(root, "pilgrims.wav") : null;
    if (voiceTrack) await mixVoices(voices, seconds, voiceTrack, signal);
    const audio = await audioPlan(seconds, tour, voiceTrack, duckIntervals(voices));
    const fade = Math.min(FPS, Math.floor(count / 2));
    console.log(`Encoding ${seconds.toFixed(2)} s${audio[0] === "-an" ? " without audio (no recordings found)" : " with temple audio"}`);
    async function encode(destination, crf, bitrate, size = "") {
      // Put the temporary MP4 on the same filesystem as its destination.
      await mkdir(dirname(destination), { recursive: true });
      const temp = await mkdtemp(join(dirname(destination), ".encode-tour-"));
      const encoded = join(temp, "tour.mp4");
      try {
        await run("ffmpeg", [
          "-hide_banner", "-loglevel", "error", "-xerror", "-framerate", String(FPS), "-start_number", "0", "-i", join(root, "frame-%06d.jpg"),
          ...audio, ...(audio[0] === "-an" ? [] : ["-b:a", bitrate]),
          "-vf", `scale=${size}in_color_matrix=bt601:out_color_matrix=bt709:in_range=full:out_range=tv,format=yuv420p,fade=t=out:s=${count - fade}:n=${fade - 1}`,
          "-c:v", "libx264", "-crf", crf, "-preset", "slow", "-threads:v", "4", "-pix_fmt", "yuv420p", "-r", String(FPS),
          "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-t", String(seconds), "-movflags", "+faststart", encoded,
        ]);
        await rename(encoded, destination);
      } finally {
        await rm(temp, { recursive: true, force: true });
      }
      console.log(`Wrote ${destination} in ${((performance.now() - started) / 1000).toFixed(1)} s`);
    }
    await encode(out, "17", "192k");
    if (web) await encode(web, "23", "128k", "w=1280:h=720:flags=lanczos:");
    const audit = join(root, "voices.json");
    await writeFile(audit, report);
    await rename(audit, join(dirname(out), "voices.json"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const event of ["SIGINT", "SIGTERM"]) {
    process.once(event, () => abort.abort(new Error(`Recording stopped (${event})`)));
  }
  main().catch((error) => {
    console.error(`record-tour: ${error.message}`);
    process.exitCode = 1;
  });
}
