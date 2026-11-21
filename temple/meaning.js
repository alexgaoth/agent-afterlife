// What a statue's dress says. Two things carry data; the rest (face, beard, hat or helmet shape details) only
// tells statues apart.
//   Role: a general (armour, helmet, a polearm) shipped more per hour of work than the median seated agent;
//   a strategist (scholar's cap, robe, a feather fan) did its work more by planning, reviewing and talking.
//   Shipping = PRs merged + commits / 4 + issues closed / 2, from whichever of those stats the data has.
//   Robe colour: the agent's tool (a "tool" stat), else its model (a "model" stat), the same colour for the same
//   value; without either the robe colour carries no data.
// The main seat keeps the king's dress.
import { PIGMENT } from "./statue.js";

const PALETTE = [PIGMENT.azurite, PIGMENT.malachite, PIGMENT.cinnabar, PIGMENT.ochre, 0x4a6b4f, 0x6b3b2e, 0x5a4a7a, 0x2f6b6b];
const OTHER = 0x8e8c80;
const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : 0);

export function shipping(a) {
  const s = a.stats || {};
  return num(s.merged ?? s.prs_merged) + num(s.commits) / 4 + num(s.issues) / 2;
}
function hours(a) {
  if (typeof a.stats?.hours === "number") return a.stats.hours;
  return (a.series || []).reduce((t, x) => t + num(x.weight), 0);
}

/**
 * For the seated agents (main seat excluded): Map id -> { role, robe, tool }, and a legend for the annals.
 * role is null when the data has no shipping stats at all; robe is null without a tool or model stat.
 */
export function meaning(seated) {
  const rate = new Map(seated.map((a) => [a.id, shipping(a) / Math.max(hours(a), 0.5)]));
  const anyShipping = seated.some((a) => shipping(a) > 0);
  const sorted = [...rate.values()].sort((x, y) => x - y);
  const median = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 0;
  const key = seated.some((a) => typeof a.stats?.tool === "string") ? "tool" : seated.some((a) => typeof a.stats?.model === "string") ? "model" : null;
  const counts = new Map();
  if (key) for (const a of seated) { const v = a.stats?.[key]; if (typeof v === "string") counts.set(v, (counts.get(v) || 0) + 1); }
  const values = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v);
  const colourOf = new Map(values.map((v, i) => [v, PALETTE[i] ?? OTHER]));
  const byId = new Map(seated.map((a) => [a.id, {
    role: anyShipping ? (rate.get(a.id) >= median ? "general" : "strategist") : null,
    robe: key && typeof a.stats?.[key] === "string" ? colourOf.get(a.stats[key]) : null,
    tool: key ? a.stats?.[key] ?? null : null,
  }]));
  const legend = values.slice(0, PALETTE.length).map((v) => ({ value: v, colour: colourOf.get(v) }));
  if (values.length > PALETTE.length) legend.push({ value: "others", colour: OTHER });
  return { byId, legend, colourKey: key, roles: anyShipping };
}
