// The Graveyard. Draws an English churchyard from any document that follows
// schema/afterlife.schema.json. Nothing here knows agent names, counts or metric labels.
//
//   top 3 ranked        monuments in front of the church
//   other ranked        headstones in rows, best first; size and shape by merit tier
//   passers-by          a corner of small unmarked stones
//   living              lanterns at the lychgate
//
// All text from the data goes in with textContent. SVG strings below hold only numbers.

import { loadData, ranked, living, passersBy, epitaph, shownStats } from "../shared/afterlife.js";

const SCHEMA_URL = "../schema/afterlife.schema.json";
const README_URL = "https://github.com/alexgaoth/agent-afterlife#bring-your-own-data";
const params = new URLSearchParams(location.search);
const dataParam = params.get("data");
const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ small helpers

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false && c !== "") el.append(c instanceof Node ? c : String(c));
  return el;
}

/** ?data= is written relative to the site root (the landing page passes it on unchanged),
 *  but this page is one folder down. Resolve it against the root, then hand it to loadData. */
function dataSearch() {
  if (!dataParam) return "";
  let url = dataParam;
  try { if (!/^([a-z][a-z0-9+.-]*:|\/)/i.test(dataParam)) url = new URL(dataParam, new URL("../", location.href)).href; } catch { /* keep as given */ }
  return "?data=" + encodeURIComponent(url);
}
const keepData = (path) => path + (dataParam ? "?data=" + encodeURIComponent(dataParam) : "");

function hash(s) { let x = 2166136261; for (const c of String(s)) x = Math.imul(x ^ c.codePointAt(0), 16777619); return x >>> 0; }
function rng(seed) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const r1 = (n) => Math.round(n * 10) / 10;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ymd = (s) => s.slice(0, 10).split("-").map(Number);
const day = (s) => { const [y, m, d] = ymd(s); return `${d} ${MONTHS[m - 1]} ${y}`; };

/** "5 Jan 2026 to 8 Jan 2026", shortened when the years match. */
function span(a) {
  if (!a.ended) return `Since ${day(a.born)}`;
  const [by, bm, bd] = ymd(a.born), [ey] = ymd(a.ended);
  if (a.born.slice(0, 10) === a.ended.slice(0, 10)) return day(a.born);
  return by === ey ? `${bd} ${MONTHS[bm - 1]} to ${day(a.ended)}` : `${day(a.born)} to ${day(a.ended)}`;
}
/** A compact form for the smallest stones: "5-8 Jan 2026". */
function shortSpan(a) {
  if (!a.ended) return day(a.born);
  const [by, bm, bd] = ymd(a.born), [ey, em, ed] = ymd(a.ended);
  if (a.born.slice(0, 10) === a.ended.slice(0, 10)) return day(a.born);
  if (by === ey && bm === em) return `${bd}-${ed} ${MONTHS[em - 1]} ${ey}`;
  if (by === ey) return `${bd} ${MONTHS[bm - 1]}-${ed} ${MONTHS[em - 1]} ${ey}`;
  return `${by}-${ey}`;
}

const ORD = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth", "Eleventh", "Twelfth"];
function roman(n) {
  let s = "";
  for (const [v, r] of [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]]) while (n >= v) { s += r; n -= v; }
  return s;
}
const ordinal = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const isUnnamed = (a) => !a.name || !a.name.trim() || /^(unnamed|unknown|anonymous)$/i.test(a.name.trim());

let nameCount = {};
/** "the Third" (or "XIV" past twelve). Empty when the name was used only once. */
function generation(a, short = false) {
  if (isUnnamed(a) || !a.generation) return "";
  if (a.generation === 1 && (nameCount[a.name] || 0) < 2) return "";
  if (short || a.generation > ORD.length) return roman(a.generation);
  return `the ${ORD[a.generation - 1]}`;
}
const fullName = (a) => isUnnamed(a) ? "One unnamed" : [a.name.trim(), generation(a)].filter(Boolean).join(" ");

// ------------------------------------------------------------------ drawings

// Headstone outlines per tier. viewBox width 100; heights differ.
const SHAPES = {
  large: { hgt: 150, paths: [
    "M3,150 V50 A47,47 0 0 1 97,50 V150Z",
    "M3,150 V60 Q3,28 50,3 Q97,28 97,60 V150Z",
    "M2,150 V38 H9 Q11,7 50,5 Q89,7 91,38 H98 V150Z",
  ], top: 30 },
  medium: { hgt: 128, paths: [
    "M3,128 V30 Q50,2 97,30 V128Z",
    "M3,128 V47 A47,47 0 0 1 97,47 V128Z",
    "M3,128 V24 H13 Q50,0 87,24 H97 V128Z",
  ], top: 28 },
  small: { hgt: 100, paths: [
    "M4,100 V24 Q50,4 96,24 V100Z",
    "M4,100 V36 A46,34 0 0 1 96,36 V100Z",
    "M4,100 V15 L15,4 H85 L96,15 V100Z",
  ], top: 30 },
};

function stoneSvg(tier, a) {
  const R = rng(hash(a.id));
  const shape = SHAPES[tier];
  const v = Math.floor(R() * shape.paths.length);
  const d = shape.paths[v], H = shape.hgt, tint = Math.floor(R() * 4);
  let lichen = "";
  const spots = 2 + Math.floor(R() * 5);
  for (let i = 0; i < spots; i++) {
    // lichen grows in small clusters, mostly low on the stone and near its edges
    const x = r1(R() < 0.5 ? 8 + R() * 20 : 72 + R() * 20), y = r1(H * (0.55 + R() * 0.4));
    const c = R() < 0.6 ? "#bdbc92" : "#8e9d78", o = r1(0.1 + R() * 0.12);
    for (let k = 0; k < 3; k++) lichen += `<circle cx="${r1(x + (R() - 0.5) * 7)}" cy="${r1(y + (R() - 0.5) * 7)}" r="${r1(0.8 + R() * 2.2)}" fill="${c}" opacity="${o}"/>`;
  }
  let carving = "";
  if (tier === "large") {
    // an inner carved panel and a small device at the head
    carving = `<path d="${d}" transform="translate(9 9) scale(.82 .84)" fill="none" stroke="#2a302e" stroke-opacity=".5" stroke-width="1.3"/>` +
      `<path d="${d}" transform="translate(9.6 9.8) scale(.82 .84)" fill="none" stroke="#e6ece8" stroke-opacity=".14" stroke-width="1"/>`;
    carving += R() < 0.5
      ? `<path d="M50,20 V40 M43,27 H57" stroke="#2a302e" stroke-opacity=".6" stroke-width="2.2" fill="none"/><path d="M50.8,21 V41 M43.8,28 H57.8" stroke="#e6ece8" stroke-opacity=".16" stroke-width="1" fill="none"/>`
      : `<circle cx="50" cy="31" r="8" fill="none" stroke="#2a302e" stroke-opacity=".55" stroke-width="1.8"/><circle cx="50.6" cy="31.8" r="8" fill="none" stroke="#e6ece8" stroke-opacity=".14" stroke-width=".9"/>`;
  }
  return `<svg viewBox="0 0 100 ${H}" aria-hidden="true" focusable="false">
    <path d="${d}" fill="url(#st${tint})"/>
    <path d="${d}" fill="url(#g-shade)"/>
    <path d="${d}" fill="#fff" filter="url(#grain)" opacity=".55"/>
    ${lichen}${carving}
    <path d="${d}" fill="url(#g-moss)"/>
    <path d="${d}" fill="none" stroke="#e8eee9" stroke-opacity=".16" stroke-width=".9"/>
  </svg>`;
}

// Monuments. viewBox width 200. `ins` is where the inscription sits, in percent: left, top, width, height.
const MONUMENTS = {
  // first place: an obelisk on a stepped plinth
  first: { hgt: 420, ins: [23, 65.4, 46, 21.6], svg: `
    <rect x="12" y="398" width="176" height="22" fill="url(#g-dark)"/><rect x="12" y="398" width="176" height="2" fill="#c3c9c3" opacity=".35"/>
    <rect x="28" y="380" width="144" height="18" fill="url(#g-front)"/><rect x="28" y="380" width="144" height="2" fill="#c3c9c3" opacity=".4"/>
    <rect x="36" y="370" width="128" height="10" fill="url(#g-dark)"/>
    <rect x="42" y="268" width="100" height="102" fill="url(#g-front)"/><rect x="142" y="268" width="16" height="102" fill="url(#g-lit)"/>
    <rect x="42" y="268" width="100" height="102" fill="#fff" filter="url(#grain)" opacity=".5"/>
    <rect x="47" y="273" width="90" height="92" fill="none" stroke="#2a302e" stroke-opacity=".45" stroke-width="1.2"/>
    <rect x="36" y="256" width="128" height="12" fill="url(#g-lit)"/><rect x="36" y="266" width="128" height="2" fill="#2a302e" opacity=".5"/>
    <rect x="62" y="246" width="66" height="10" fill="url(#g-front)"/><rect x="128" y="246" width="12" height="10" fill="url(#g-lit)"/>
    <path d="M70,246 L116,246 L108,58 L80,58Z" fill="url(#g-front)"/><path d="M116,246 L130,246 L120,58 L108,58Z" fill="url(#g-lit)"/>
    <path d="M70,246 L116,246 L108,58 L80,58Z" fill="#fff" filter="url(#grain)" opacity=".5"/>
    <path d="M80,58 L108,58 L100,24Z" fill="url(#g-front)"/><path d="M108,58 L120,58 L100,24Z" fill="url(#g-lit)"/>
    <circle cx="94" cy="150" r="12" fill="none" stroke="#2a302e" stroke-opacity=".55" stroke-width="2"/>
    <circle cx="94.7" cy="150.8" r="12" fill="none" stroke="#e6ece8" stroke-opacity=".15" stroke-width="1"/>
    <circle cx="60" cy="356" r="5" fill="#c4c39a" opacity=".22"/><circle cx="70" cy="361" r="3" fill="#93a27e" opacity=".25"/><circle cx="128" cy="292" r="4" fill="#c4c39a" opacity=".18"/>
    <rect x="12" y="330" width="176" height="90" fill="url(#g-moss)"/>
    <path d="M100,24 L120,58 L130,246 M158,268 V370" fill="none" stroke="#e8eee9" stroke-opacity=".22" stroke-width="1"/>` },
  // second: a draped urn on a pedestal
  second: { hgt: 380, ins: [24, 60.6, 45, 26], svg: `
    <rect x="16" y="360" width="168" height="20" fill="url(#g-dark)"/><rect x="16" y="360" width="168" height="2" fill="#c3c9c3" opacity=".35"/>
    <rect x="30" y="344" width="140" height="16" fill="url(#g-front)"/><rect x="30" y="344" width="140" height="2" fill="#c3c9c3" opacity=".4"/>
    <rect x="38" y="334" width="124" height="10" fill="url(#g-dark)"/>
    <rect x="44" y="222" width="98" height="112" fill="url(#g-front)"/><rect x="142" y="222" width="14" height="112" fill="url(#g-lit)"/>
    <rect x="44" y="222" width="98" height="112" fill="#fff" filter="url(#grain)" opacity=".5"/>
    <rect x="49" y="227" width="88" height="102" fill="none" stroke="#2a302e" stroke-opacity=".45" stroke-width="1.2"/>
    <rect x="38" y="210" width="124" height="12" fill="url(#g-lit)"/><rect x="38" y="220" width="124" height="2" fill="#2a302e" opacity=".5"/>
    <path d="M84,210 L89,198 H111 L116,210Z" fill="url(#g-front)"/>
    <rect x="94" y="186" width="12" height="12" fill="url(#g-dark)"/>
    <path d="M68,140 Q64,186 100,188 Q136,186 132,140 Q130,122 114,116 H86 Q70,122 68,140Z" fill="url(#g-front)"/>
    <path d="M100,116 H114 Q130,122 132,140 Q136,186 100,188Z" fill="url(#g-lit)" opacity=".55"/>
    <rect x="88" y="102" width="24" height="14" fill="url(#g-front)"/><rect x="104" y="102" width="8" height="14" fill="url(#g-lit)" opacity=".7"/>
    <path d="M82,104 Q100,86 118,104Z" fill="url(#g-lit)"/>
    <circle cx="100" cy="86" r="6" fill="url(#g-lit)"/>
    <path d="M70,146 Q98,172 131,142" fill="none" stroke="#4f5653" stroke-width="6"/>
    <path d="M70,144 Q98,168 131,140" fill="none" stroke="#aeb4ae" stroke-width="4.5" stroke-linecap="round"/>
    <path d="M90,102 Q76,106 71,128 Q66,150 73,174 Q79,168 84,173 Q85,150 94,132 Q102,118 110,104Z" fill="#a9afa9"/>
    <path d="M90,102 Q76,106 71,128 Q66,150 73,174 Q79,168 84,173 Q85,150 94,132 Q102,118 110,104Z" fill="#fff" filter="url(#grain)" opacity=".45"/>
    <path d="M82,112 Q74,134 77,168 M92,112 Q84,132 82,158" fill="none" stroke="#5b625f" stroke-width="1.1"/>
    <circle cx="60" cy="318" r="5" fill="#c4c39a" opacity=".2"/><circle cx="126" cy="246" r="3.5" fill="#93a27e" opacity=".25"/>
    <rect x="16" y="300" width="168" height="80" fill="url(#g-moss)"/>
    <path d="M132,140 Q136,186 100,188 M156,222 V334" fill="none" stroke="#e8eee9" stroke-opacity=".22" stroke-width="1"/>` },
  // third: a Celtic cross on a calvary base
  third: { hgt: 380, ins: [21, 69.6, 50, 25.4], svg: `
    <rect x="20" y="362" width="160" height="18" fill="url(#g-dark)"/><rect x="20" y="362" width="160" height="2" fill="#c3c9c3" opacity=".35"/>
    <rect x="40" y="262" width="104" height="100" fill="url(#g-front)"/><rect x="144" y="262" width="16" height="100" fill="url(#g-lit)"/>
    <rect x="40" y="262" width="104" height="100" fill="#fff" filter="url(#grain)" opacity=".5"/>
    <rect x="52" y="250" width="92" height="12" fill="url(#g-lit)"/><rect x="144" y="250" width="10" height="12" fill="#cfd5cf"/>
    <rect x="52" y="260" width="92" height="2" fill="#2a302e" opacity=".5"/>
    <path d="M88,250 L112,250 L110,116 L90,116Z" fill="url(#g-front)"/><path d="M112,250 L118,250 L116,116 L110,116Z" fill="url(#g-lit)"/>
    <path fill-rule="evenodd" d="M64,104 a36,36 0 1,0 72,0 a36,36 0 1,0 -72,0Z M73,104 a27,27 0 1,1 54,0 a27,27 0 1,1 -54,0Z" fill="url(#g-front)"/>
    <rect x="52" y="93" width="96" height="22" fill="url(#g-front)"/><rect x="146" y="93" width="6" height="22" fill="url(#g-lit)"/>
    <rect x="89" y="34" width="22" height="70" fill="url(#g-front)"/><rect x="111" y="34" width="5" height="70" fill="url(#g-lit)"/>
    <path d="M88,250 L112,250 L110,116 L90,116Z M52,93 H148 V115 H52Z M89,34 H111 V104 H89Z" fill="#fff" filter="url(#grain)" opacity=".45"/>
    <circle cx="100" cy="104" r="8" fill="url(#g-lit)"/>
    <rect x="93" y="126" width="14" height="104" fill="none" stroke="#3c4441" stroke-width="1.1" stroke-opacity=".6"/>
    <path d="M100,130 Q107,137 100,144 Q93,151 100,158 Q107,165 100,172 Q93,179 100,186 Q107,193 100,200 Q93,207 100,214 Q107,221 100,228 M100,130 Q93,137 100,144 Q107,151 100,158 Q93,165 100,172 Q107,179 100,186 Q93,193 100,200 Q107,207 100,214 Q93,221 100,228" fill="none" stroke="#3c4441" stroke-width="1.4" stroke-opacity=".7"/>
    <path d="M60,98 H84 M116,98 H140 M100,44 V82" fill="none" stroke="#3c4441" stroke-width="1.2" stroke-opacity=".5"/>
    <circle cx="56" cy="350" r="5" fill="#c4c39a" opacity=".22"/><circle cx="64" cy="344" r="3" fill="#93a27e" opacity=".26"/><circle cx="74" cy="110" r="3" fill="#c4c39a" opacity=".2"/>
    <rect x="20" y="300" width="160" height="80" fill="url(#g-moss)"/>
    <path d="M136,104 a36,36 0 0,0 -20,-32 M160,262 V362 M116,34 V93" fill="none" stroke="#e8eee9" stroke-opacity=".22" stroke-width="1"/>` },
};

function lanternSvg() {
  return `<svg viewBox="0 0 40 96" aria-hidden="true" focusable="false">
    <circle class="glow" cx="20" cy="54" r="26" fill="url(#g-glow)"/>
    <path d="M20,0 V16" stroke="#3a3f3c" stroke-width="1.4"/>
    <circle cx="20" cy="18" r="3" fill="none" stroke="#4a504c" stroke-width="1.4"/>
    <path d="M10,32 L20,21 L30,32Z" fill="#2a2f2c"/><path d="M20,21 L30,32" stroke="#7f8b87" stroke-opacity=".4" stroke-width="1"/>
    <rect x="11" y="32" width="18" height="34" fill="#3a2a17"/>
    <path class="flame" d="M20,40 Q25,50 23,57 Q20,62 17,57 Q15,50 20,40Z" fill="url(#g-flame)"/>
    <rect x="12" y="33" width="16" height="32" fill="#e3a857" opacity=".2"/>
    <path d="M11,32 V66 M29,32 V66 M20,32 V40 M20,60 V66 M11,49 H14 M26,49 H29" stroke="#262b28" stroke-width="2"/>
    <rect x="9" y="66" width="22" height="5" fill="#2a2f2c"/><path d="M16,71 L20,77 L24,71Z" fill="#2a2f2c"/>
  </svg>`;
}

function lychgateSvg() {
  return `<svg class="lychgate" viewBox="0 0 400 236" aria-hidden="true" focusable="false">
    <path d="M130,178 H270 V236 H130Z" fill="#151b18"/>
    <path d="M150,236 Q200,222 250,236Z" fill="#232a27"/>
    <rect x="116" y="104" width="14" height="132" fill="#2b2824"/><rect x="270" y="104" width="14" height="132" fill="#2b2824"/>
    <rect x="110" y="214" width="26" height="22" fill="#2e3532"/><rect x="264" y="214" width="26" height="22" fill="#2e3532"/>
    <path d="M129,104 V214 M283,104 V214" stroke="#8a948f" stroke-opacity=".28"/>
    <rect x="102" y="96" width="196" height="10" fill="#2b2824"/>
    <path d="M130,154 Q134,112 170,106 M270,154 Q266,112 230,106" fill="none" stroke="#2b2824" stroke-width="7"/>
    <path d="M76,110 L200,18 L324,110 L313,114 L200,32 L87,114Z" fill="#232927"/>
    <path d="M108,100 L200,34 L292,100Z" fill="#1c1f1d"/>
    <path d="M154,100 V67 M200,100 V34 M246,100 V67 M130,100 L200,50 L270,100" stroke="#2f2c28" stroke-width="3" fill="none"/>
    <path d="M84,106 L200,22 L316,106" fill="none" stroke="#3a413e" stroke-width="2.4" stroke-dasharray="1 7"/>
    <path d="M200,18 L324,110" stroke="#9aa59f" stroke-opacity=".4" stroke-width="1.4"/>
    <path d="M200,18 V6 M193,11 H207" stroke="#2b2824" stroke-width="3"/>
  </svg>`;
}

/** A line of score per work day, 0 to 100. One series, so no legend; the caption names it. */
function chart(series) {
  const pts = [...series].filter((s) => typeof s.value === "number").sort((a, b) => a.date.localeCompare(b.date));
  if (!pts.length) return null;
  const W = 480, H = 150, L = 30, Rr = 12, T = 10, B = 26;
  const t = (s) => Date.UTC(...ymd(s).map((v, i) => (i === 1 ? v - 1 : v)));
  const t0 = t(pts[0].date), t1 = t(pts[pts.length - 1].date);
  const x = (p) => (t1 === t0 ? L + (W - L - Rr) / 2 : L + ((t(p.date) - t0) / (t1 - t0)) * (W - L - Rr));
  const y = (v) => T + (1 - v / 100) * (H - T - B);
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("aria-hidden", "true");
  const add = (tag, at, text) => { const e = document.createElementNS(NS, tag); for (const k in at) e.setAttribute(k, at[k]); if (text != null) e.textContent = text; svg.append(e); return e; };
  for (const v of [0, 50, 100]) {
    add("line", { x1: L, x2: W - Rr, y1: y(v), y2: y(v), stroke: "#1e2321", "stroke-opacity": v === 0 ? 0.45 : 0.18, "stroke-width": 1 });
    add("text", { x: L - 8, y: y(v) + 4, "text-anchor": "end", class: "axis" }, v);
  }
  if (pts.length > 1) add("polyline", { points: pts.map((p) => `${r1(x(p))},${r1(y(p.value))}`).join(" "), fill: "none", stroke: "#1e2321", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" });
  for (const p of pts) {
    const g = document.createElementNS(NS, "g"); svg.append(g);
    const c = document.createElementNS(NS, "circle");
    Object.entries({ cx: r1(x(p)), cy: r1(y(p.value)), r: 4, fill: "#1e2321", stroke: "#a3a89f", "stroke-width": 2 }).forEach(([k, v]) => c.setAttribute(k, v));
    const hit = document.createElementNS(NS, "circle");
    Object.entries({ cx: r1(x(p)), cy: r1(y(p.value)), r: 12, fill: "transparent" }).forEach(([k, v]) => hit.setAttribute(k, v));
    const tip = document.createElementNS(NS, "title"); tip.textContent = `${day(p.date)}: ${p.value}`;
    g.append(c, hit, tip);
  }
  add("text", { x: L, y: H - 6, class: "axis" }, day(pts[0].date));
  if (pts.length > 1) add("text", { x: W - Rr, y: H - 6, "text-anchor": "end", class: "axis" }, day(pts[pts.length - 1].date));
  const table = h("table", { class: "sr" }, h("caption", {}, "Score per work day"),
    h("tr", {}, h("th", {}, "Date"), h("th", {}, "Score")),
    pts.map((p) => h("tr", {}, h("td", {}, day(p.date)), h("td", {}, p.value))));
  return [svg, table];
}

// ------------------------------------------------------------------ the scene

let DATA, RANK = new Map(), RANKED = [], opener = null;

function inscription(a, tier, ins) {
  const style = `--ix:${ins[0]}%;--iy:${ins[1]}%;--iw:${ins[2]}%;--ih:${ins[3]}%`;
  const kids = [];
  if (isUnnamed(a)) {
    if (tier === "small") kids.push(h("span", { class: "unnamed" }, "Unknown"));
    else kids.push(h("span", { class: "lies" }, "Here lies"), h("span", { class: "unnamed" }, "one unnamed"));
  } else {
    kids.push(h("span", { class: "nm" }, a.name.trim() + (tier === "small" && generation(a, true) ? " " + generation(a, true) : "")));
    if (tier !== "small" && generation(a)) kids.push(h("span", { class: "gen" }, generation(a)));
  }
  kids.push(h("span", { class: "dt" }, tier === "small" ? shortSpan(a) : span(a)));
  if (tier === "large" || tier === "monument") kids.push(h("span", { class: "ep" }, epitaph(a, DATA.metrics)));
  return h("span", { class: "ins", style }, kids);
}

function label(a) {
  const rank = RANK.get(a.id);
  const where = rank ? `Ranked ${ordinal(rank)} of ${RANKED.length}` : a.status === "alive" ? "Still working" : "A passer-by";
  return `${fullName(a)}. ${span(a)}. ${where}. Open details.`;
}

function monument(a, which) {
  const m = MONUMENTS[which];
  const R = rng(hash(a.id));
  const btn = h("button", { type: "button", class: `monument ${which}`, "aria-label": label(a), "data-id": a.id, style: `--lean:${r1((R() - 0.5) * 0.8)}deg`, onclick: () => open(a, btn) });
  btn.insertAdjacentHTML("afterbegin", `<svg viewBox="0 0 200 ${m.hgt}" aria-hidden="true" focusable="false">${m.svg}</svg>`);
  const ins = m.ins;
  btn.append(inscription(a, "monument", ins));
  return h("li", {}, btn);
}

function headstone(a, tier) {
  const R = rng(hash(a.id) ^ 0x9e37);
  const lean = (R() - 0.5) * (tier === "small" ? 5 : tier === "medium" ? 3.2 : 2.2);
  const btn = h("button", { type: "button", class: `stone ${tier}`, "aria-label": label(a), "data-id": a.id, style: `--lean:${r1(lean)}deg`, onclick: () => open(a, btn) });
  const offset = `--dy:${Math.round(R() * 16)}px;--dx:${Math.round((R() - 0.5) * 10)}px`;
  btn.insertAdjacentHTML("afterbegin", stoneSvg(tier, a));
  const top = SHAPES[tier].top;
  btn.append(inscription(a, tier, [10, top, 80, 100 - top - 8]));
  return h("li", { style: offset }, btn);
}

function renderYard(yard) {
  yard.replaceChildren();
  if (!RANKED.length) {
    yard.append(h("div", { class: "notice" },
      h("h2", {}, DATA.agents.length ? "No headstones yet" : "No one rests here yet"),
      h("p", {}, DATA.agents.length
        ? "Every agent in this document is still working or only passed through."
        : "This document has no agents. Add some to its agents list and they will be laid to rest here."),
      h("p", {}, h("a", { href: SCHEMA_URL }, "The data schema"), " lists the fields each agent needs.")));
    return;
  }
  const top = RANKED.slice(0, 3), rest = RANKED.slice(3);
  yard.append(h("h2", { class: "sr" }, "Monuments to the most worthy"),
    h("ol", { class: "monuments" }, top.map((a, i) => monument(a, ["first", "second", "third"][i]))));
  if (!rest.length) return;
  // Merit tiers by position, so any distribution of merit gives a sensible churchyard.
  const nLarge = Math.ceil(rest.length * 0.11), nMedium = nLarge + Math.ceil(rest.length * 0.32);
  const tiers = [["large", rest.slice(0, nLarge), 4], ["medium", rest.slice(nLarge, nMedium), 4 + nLarge], ["small", rest.slice(nMedium), 4 + nMedium]];
  const names = { large: "Headstones nearest the church", medium: "Headstones in the middle rows", small: "Headstones in the far rows" };
  for (const [tier, list, start] of tiers) {
    if (!list.length) continue;
    yard.append(h("section", { class: `plot plot-${tier}`, "aria-label": names[tier] },
      h("ol", { class: "row", start }, list.map((a) => headstone(a, tier)))));
  }
}

function renderCorner(el, P) {
  el.replaceChildren();
  if (!P.length) { el.hidden = true; return; }
  el.hidden = false;
  const R = rng(hash(P.map((a) => a.id).join("|")));
  const mounds = h("div", { class: "mounds", "aria-hidden": "true" });
  for (let i = 0; i < Math.min(P.length, 28); i++) mounds.append(h("span", { class: "mound", style: `--lean:${r1((R() - 0.5) * 12)}deg;--h:${Math.round(9 + R() * 7)}px` }));
  const line = P.length === 1 ? "Here lies one passer-by" : `Here lie ${P.length} passers-by`;
  el.append(h("h2", { class: "sr" }, "Passers-by"), mounds,
    h("details", {}, h("summary", {}, line),
      h("ul", { class: "passers" }, P.map((a) => {
        const b = h("button", { type: "button", "aria-label": label(a), onclick: () => open(a, b) },
          isUnnamed(a) ? "Unknown" : fullName(a), h("span", { class: "when" }, shortSpan(a)));
        return h("li", {}, b);
      }))));
}

function renderGate(el, lane, L) {
  el.replaceChildren();
  el.insertAdjacentHTML("afterbegin", lychgateSvg());
  lane.replaceChildren();
  if (!L.length) return;
  lane.append(h("h2", {}, "Still working"),
    h("ul", { class: "lanterns" }, L.map((a) => {
      const b = h("button", { type: "button", class: "lantern", "aria-label": label(a), "data-id": a.id, style: `--d:${-r1((hash(a.id) % 300) / 100)}s`, onclick: () => open(a, b) });
      b.insertAdjacentHTML("afterbegin", lanternSvg());
      b.append(h("span", { class: "lname" }, isUnnamed(a) ? "Unknown" : a.name.trim()));
      if (generation(a)) b.append(h("span", { class: "lgen" }, generation(a)));
      return h("li", {}, b);
    })));
}

// ------------------------------------------------------------------ the tablet

const dialog = $("tablet");

function open(a, from) {
  opener = from || null;
  const rank = RANK.get(a.id);
  $("t-place").textContent = rank ? `${ordinal(rank)} of ${RANKED.length}` : a.status === "alive" ? "Still working" : "A passer-by, unranked";
  $("t-name").textContent = isUnnamed(a) ? "One unnamed" : a.name.trim();
  $("t-gen").textContent = generation(a);
  $("t-gen").hidden = !generation(a);
  $("t-dates").textContent = span(a);
  const ep = a.status === "alive" ? (a.epitaph || "") : epitaph(a, DATA.metrics);
  $("t-ep").textContent = ep;
  $("t-ep").hidden = !ep;
  const facts = [["Merit", String(a.merit)]];
  if (typeof a.score === "number") facts.push(["Score", `${a.score} of 100`]);
  for (const s of shownStats(a, DATA.metrics)) facts.push([s.label, s.value]);
  $("t-facts").replaceChildren(...facts.map(([k, v]) => h("div", {}, h("dt", {}, k), h("dd", {}, v))));
  const c = a.series && a.series.length ? chart(a.series) : null;
  $("t-chart").replaceChildren(...(c ? [...c, h("figcaption", {}, "Score per day of work, 0 to 100")] : []));
  $("t-chart").hidden = !c;
  const url = $("t-url");
  url.hidden = !(a.url && /^https?:\/\//i.test(a.url));
  if (!url.hidden) url.href = a.url;
  if (!dialog.open) dialog.showModal();
  $("t-close").focus();
  const u = new URL(location.href); u.searchParams.set("agent", a.id); history.replaceState(null, "", u);
}

dialog.addEventListener("close", () => {
  const u = new URL(location.href); u.searchParams.delete("agent"); history.replaceState(null, "", u);
  if (opener && document.contains(opener)) opener.focus();
});
dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
$("t-close").addEventListener("click", () => dialog.close());

// ------------------------------------------------------------------ start

function showErrors(errors) {
  const yard = $("yard");
  yard.removeAttribute("aria-busy");
  yard.replaceChildren(h("div", { class: "notice", role: "alert" },
    h("h2", {}, "This churchyard could not be drawn"),
    h("p", {}, errors.length === 1 ? "The data document has a problem:" : `The data document has ${errors.length} problems:`),
    h("ul", {}, errors.map((e) => h("li", {}, e))),
    h("p", {}, "Check it against ", h("a", { href: SCHEMA_URL }, "the data schema"), ", or read ", h("a", { href: README_URL }, "how to bring your own data"), "."),
    h("p", {}, h("a", { href: "./" }, "See the demo churchyard"))));
  $("tally").textContent = "";
  $("lane").replaceChildren(h("a", { href: SCHEMA_URL }, "The data schema"));
}

async function main() {
  for (const a of document.querySelectorAll("[data-home]")) a.href = keepData("../");
  const { data, errors, source } = await loadData(dataSearch());
  if (!data) return showErrors(errors);
  DATA = data;
  nameCount = {};
  for (const a of data.agents) if (!isUnnamed(a)) nameCount[a.name] = (nameCount[a.name] || 0) + 1;
  RANKED = ranked(data);
  RANK = new Map(RANKED.map((a, i) => [a.id, i + 1]));
  const P = passersBy(data), L = living(data);

  if (data.title) { $("fleet").textContent = data.title; $("fleet").hidden = false; document.title = `${data.title} | The Graveyard`; }
  const parts = [];
  if (RANKED.length + P.length) parts.push(`${RANKED.length + P.length} at rest, the most worthy nearest the church.`);
  if (L.length) parts.push(`${L.length} still working.`);
  $("tally").textContent = parts.join(" ");

  const yard = $("yard");
  renderYard(yard);
  yard.removeAttribute("aria-busy");
  if (P.length || L.length) {
    $("boundary").hidden = false;
    renderCorner($("corner"), P);
    renderGate($("gate"), $("gate-lane"), L);
  }
  $("lane").replaceChildren(...(source === "demo"
    ? ["Showing a made-up demo fleet. To show your own agents, see ", h("a", { href: README_URL }, "the data schema"), "."]
    : [h("a", { href: SCHEMA_URL }, "The data schema")]));

  const want = params.get("agent");
  const a = want && data.agents.find((x) => x.id === want);
  if (a) open(a, document.querySelector(`[data-id="${CSS.escape(a.id)}"]`));
}

main();
