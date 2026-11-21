#!/usr/bin/env node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { serve } from "../cli/site.js";
import { chronicle } from "../shared/insights.js";

const DATA = "https://raw.githubusercontent.com/alexgaoth/agent-afterlife/data/afterlife.json";
const WIDTH = 1920, HEIGHT = 1080, FPS = 30, DURATION = 118;
const STEPS_PER_SPAN = 48;
const SOUNDS = fileURLToPath(new URL("../temple/sounds/", import.meta.url));
const SOUND_CREDITS = "https://github.com/alexgaoth/agent-afterlife/blob/main/temple/sounds/CREDITS.md";
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
const route = (outbound, inbound) => [
  { end: 13.2, path: [[0, 48], [0, 42], [0.1, 38], [0.4, 31.5]], gaze: [[0, 0, 22], [.34, 0, 2], [1, 3, 4]] },
  { end: 15.6, path: [[0.4, 31.5]], gaze: [[0, 3, 4], [1, 16, 5]] },
  { end: 26.1, path: [[0.4, 31.5], [0.4, 27], [0.5, 22], [0.4, 17.5]],
    gaze: [[0, 16, 5], [.24, 60, 9], [.47, 4, 3], [.84, -67, 7], [1, -96, 3]] },
  { end: 38.8, path: [[0.4, 17.5], [1.7, outbound], [4.2, outbound], [7, 12.1], [12, 10], [15.4, 8.3], [16.8, 8.1]],
    gaze: [[0, -96, 3], [.32, -65, 0], [.67, -69, 0], [1, -53, 4]] },
  { end: 45, path: [[16.8, 8.1]], gaze: [[0, -53, 4], [.77, -135, 3], [1, -135, 3]] },
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
const samples = [
  ["01-gate", .2], ["02-pilgrims", 14], ["03-steles", 24],
  ["04-east-wing", 41.5], ["05-terrace", 75.3], ["06-main-hall", 85.5],
  ["07-ancestral-hall", 134.5], ["08-side-court", 148.5],
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

function makeTour(seconds, rows) {
  const legs = route(eastCrossing(rows, 14.8, 12.3, 15.1), eastCrossing(rows, 3.25, 1.5, 3.35));
  const scale = seconds / legs.at(-1).end;
  // Fit one spline to each run of connected legs. No abrupt tangent change at a leg boundary.
  const runs = [];
  let start = 0, run, walked = 0;
  const timeline = legs.map(({ end, path, gaze }) => {
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
    const leg = { start: start * scale, end: end * scale, gaze, run, point: path[0] };
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
    return [x, z, lerp(yaw0, yaw1, turn), lerp(pitch0, pitch1, turn), bob, ground, t];
  }
  return {
    frame, runs,
    bell: 82.1 * scale, drum: 146 * scale,
    chimes: [9, 39.5, 67, 121, 130].map((t) => t * scale),
    samples: new Map(samples.map(([name, t]) => [Math.round(t * scale * FPS), name])),
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
      const url = `http://127.0.0.1:${server.address().port}/temple/?record=1&still=1&quality=high&data=data.json`;
      const nav = await cdp.call("Page.navigate", { url });
      if (nav.errorText) throw new Error(nav.errorText);
      const layout = await until(() => cdp.evaluate(`(() => {
        const error = document.querySelector("#error:not([hidden])");
        if (error) throw new Error(error.innerText);
        if (window.afterlife?.ready) {
          window.afterlife.labels(false);
          const canvas = document.querySelector("canvas");
          return [innerWidth, innerHeight, devicePixelRatio, canvas.width, canvas.height];
        }
      })()`), "the temple. Check the data URL, WebGL, and access to jsDelivr");
      if (String(layout) !== `${WIDTH},${HEIGHT},1,${WIDTH},${HEIGHT}`) {
        throw new Error(`Expected a ${WIDTH}x${HEIGHT} canvas and viewport. Received: ${layout}`);
      }

      console.log(`Capturing ${preview ? "tour previews" : `${count} frames at ${WIDTH}x${HEIGHT}`}`);
      const started = performance.now();
      for (let i = 0; i < count; i++) {
        const sample = tour.samples.get(i);
        // Preview steps the simulation at 6 fps between the full-resolution samples.
        if (preview && i % 5 !== 0 && !sample) continue;
        const args = JSON.stringify(tour.frame(i / FPS));
        await cdp.evaluate(`(([x, z, yaw, pitch, bob, ground, t]) => {
          const a = window.afterlife;
          const y = ground.reduce((sum, [gx, gz]) => sum + a.floorAt(gx, gz), 0) / ground.length;
          a.pose(x, z, yaw, pitch, y - a.floorAt(x, z) + bob);
          a.render(t);
        })(${args})`);
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
async function audioPlan(seconds, tour) {
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
  await loop("birds-day", .09);
  await loop("footsteps-stone", .19, `,volume='if(isnan(t),0,${gate})':eval=frame`);
  await cue("eave-bells", .14, tour.chimes, 7);
  await cue("bell", .25, [tour.bell]);
  await cue("drum", .22, [tour.drum]);
  if (!tracks.length) return ["-an"];
  const fade = Math.min(seconds / 2, 1);
  // Leave a small margin below -1 dBFS for peaks added by AAC encoding.
  filters.push(`${tracks.join("")}amix=inputs=${tracks.length}:normalize=0,apad,atrim=duration=${seconds},`
    + `afade=d=${fade},afade=t=out:st=${seconds - fade}:d=${fade},volume=3.4,alimiter=limit=0.85114:level=0:latency=1[audio]`);
  return [
    ...inputs, "-filter_complex", filters.join(";"), "-map", "0:v:0", "-map", "[audio]", "-c:a", "aac", "-b:a", "192k",
    "-metadata", `comment=Temple field recordings, edited and mixed. Sound credits and licenses: ${SOUND_CREDITS}`,
  ];
}

async function main() {
  const { values } = parseArgs({ options: {
    out: { type: "string" }, data: { type: "string", default: DATA }, seconds: { type: "string", default: String(DURATION) },
    frames: { type: "string" }, preview: { type: "boolean" }, help: { type: "boolean", short: "h" },
  } });
  if (values.help) {
    console.log("Usage: node tools/record-tour.mjs --out <file.mp4> [--data <URL or JSON file>] [--seconds N] [--frames <dir>]");
    console.log("To check the route without encoding: node tools/record-tour.mjs --preview --frames <dir>");
    return;
  }
  if (typeof WebSocket === "undefined") throw new Error("Use Node 22+, or Node 20 with --experimental-websocket");
  const requested = Number(values.seconds);
  if (!Number.isFinite(requested) || requested < 1) throw new Error("--seconds must be at least 1");
  if (values.preview ? !values.frames || values.out : !values.out || !/\.mp4$/i.test(values.out)) {
    throw new Error("Use --out <file.mp4>, or --preview --frames <dir>");
  }
  const out = values.out ? resolve(values.out) : null;
  const sampleDir = values.frames ? resolve(values.frames) : null;
  const count = Math.round(requested * FPS), seconds = count / FPS;
  const data = await loadData(values.data);
  const tour = makeTour(seconds, chronicle(data).chart.rows);
  if (out) {
    await run("ffmpeg", ["-version"], true);
    await mkdir(dirname(out), { recursive: true });
  }
  if (sampleDir) await mkdir(sampleDir, { recursive: true });
  const root = await mkdtemp(join(out ? dirname(out) : sampleDir, ".record-tour-"));
  const started = performance.now();
  try {
    await capture(root, data, tour, count, sampleDir, values.preview);
    if (!out) return;
    const audio = await audioPlan(seconds, tour);
    const fade = Math.min(FPS, Math.floor(count / 2));
    console.log(`Encoding ${seconds.toFixed(2)} s${audio[0] === "-an" ? " without audio (no recordings found)" : " with temple audio"}`);
    const encoded = join(root, "tour.mp4");
    await run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-framerate", String(FPS), "-start_number", "0", "-i", join(root, "frame-%06d.jpg"),
      ...audio, "-vf", `scale=in_color_matrix=bt601:out_color_matrix=bt709:in_range=full:out_range=tv,format=yuv420p,fade=t=out:s=${count - fade}:n=${fade - 1}`,
      "-c:v", "libx264", "-crf", "17", "-preset", "slow", "-threads:v", "4", "-pix_fmt", "yuv420p", "-r", String(FPS),
      "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-t", String(seconds), "-movflags", "+faststart", encoded,
    ]);
    await rename(encoded, out);
    console.log(`Wrote ${out} in ${((performance.now() - started) / 1000).toFixed(1)} s`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

for (const event of ["SIGINT", "SIGTERM"]) {
  process.once(event, () => abort.abort(new Error(`Recording stopped (${event})`)));
}
main().catch((error) => {
  console.error(`record-tour: ${error.message}`);
  process.exitCode = 1;
});
