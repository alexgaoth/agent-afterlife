// Draws one insight (shared/insights.js) onto a 2D canvas, in one of two hands:
//   "stone"  incised into a stele: pale strokes on grey stone, for the 碑林 in the courtyard
//   "ink"    brushed onto paper: dark ink, for the 年鉴 (Annals) scroll
// One drawing for both, so the carving and the scroll always agree. lang "zh" writes the labels in Chinese (the tablet
// you hold when you inspect a stele).
import { CJK } from "./fonts.js";

const WORDS = {
  en: { top: (p) => `top 10% → ${p}%`, agents: "agents, least to most →", half: (d) => `half by day ${d}`,
    days: (t) => `${t} day${t === 1 ? "" : "s"}`, still: "still working", meritDay: "merit a day", unit: (u) => u || "median",
    count: "agents", row: (l) => l, font: `"IM Fell English", Georgia, serif` },
  zh: { top: (p) => `前十分之一 → ${p}%`, agents: "智能体，由少到多 →", half: (d) => `第${d}日过半`,
    days: (t) => `${t}日`, still: "尚在", meritDay: "日均功德",
    unit: (u) => ({ "median merit a day": "日均功德中位数", "median merit": "功德中位数", "% of merit": "功德占比 %" })[u] || "中位数",
    count: "智能体数", font: CJK,
    row: (l) => ({ "1 day": "一日", "2 days": "二日", "3+ days": "三日以上", "1st": "首代", "2nd": "二代", "3rd": "三代", "4th+": "四代以上",
      Mon: "一", Tue: "二", Wed: "三", Thu: "四", Fri: "五", Sat: "六", Sun: "日" })[l] ?? l },
};

const HANDS = {
  stone: { bg: "#6f6d64", line: "#2b2924", faint: "rgba(43,41,36,.35)", fill: "rgba(43,41,36,.28)", text: "#26241f", mark: "#5a2a20" },
  ink:   { bg: null,      line: "#2a2420", faint: "rgba(42,36,32,.28)", fill: "rgba(42,36,32,.16)", text: "#2a2420", mark: "#a8382a" },
};

export function drawInsight(ctx, ins, x, y, w, h, hand = "ink", lang = "en") {
  const H = HANDS[hand], L = WORDS[lang] || WORDS.en;
  ctx.save();
  ctx.translate(x, y);
  if (H.bg) { ctx.fillStyle = H.bg; ctx.fillRect(0, 0, w, h); }
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  const fs = Math.max(12, Math.round(w / 26));                    // labels scale with the drawing
  const pad = { l: fs * 2.4, r: fs, t: fs, b: fs * 2 };
  const W = w - pad.l - pad.r, Ht = h - pad.t - pad.b;
  const X = (u) => pad.l + u * W, Y = (v) => pad.t + (1 - v) * Ht;
  ctx.font = `${fs}px ${L.font}`;
  ctx.fillStyle = H.text; ctx.strokeStyle = H.line;

  const axes = () => {
    ctx.strokeStyle = H.faint; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(1), Y(0)); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(0), Y(1)); ctx.stroke();
  };
  const c = ins.chart;
  if (!c) {
    ctx.textAlign = "center"; ctx.fillText(lang === "zh" && ins.findingCn ? ins.findingCn : ins.finding, w / 2, h / 2);
  } else if (c.kind === "lorenz") {
    // Line of equality, the Lorenz curve, and the gap between them (the Gini area) shaded.
    axes();
    ctx.setLineDash([4, 5]); ctx.strokeStyle = H.faint; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(1), Y(1)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = H.fill; ctx.beginPath(); ctx.moveTo(X(0), Y(0));
    for (const [u, v] of c.points) ctx.lineTo(X(u), Y(v));
    ctx.lineTo(X(1), Y(1)); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = H.line; ctx.lineWidth = Math.max(2.6, fs / 6); ctx.beginPath();
    c.points.forEach(([u, v], i) => (i ? ctx.lineTo(X(u), Y(v)) : ctx.moveTo(X(u), Y(v)))); ctx.stroke();
    // Mark where the top 10% begins.
    const p = c.points.find(([u]) => u >= 0.9) || c.points.at(-1);
    ctx.fillStyle = H.mark; ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = H.text; ctx.textAlign = "right";
    ctx.fillText(L.top(Math.round((1 - p[1]) * 100)), X(p[0]) - 8, Y(p[1]) + 4);
    ctx.textAlign = "left"; ctx.fillText(L.agents, X(0), h - fs * 0.4);
  } else if (c.kind === "survival") {
    // A step curve: the share of agents still working after each day, shaded beneath; the median marked.
    axes();
    const T = c.rows.length, U = (t) => t / T;
    const pts = [[0, 1]];
    for (const r of c.rows) { pts.push([U(r.t), pts.at(-1)[1]]); pts.push([U(r.t), r.s]); }
    ctx.fillStyle = H.fill; ctx.beginPath(); ctx.moveTo(X(0), Y(0));
    for (const [u, v] of pts) ctx.lineTo(X(u), Y(v));
    ctx.lineTo(X(1), Y(0)); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = H.line; ctx.lineWidth = Math.max(2.6, fs / 6); ctx.beginPath();
    pts.forEach(([u, v], i) => (i ? ctx.lineTo(X(u), Y(v)) : ctx.moveTo(X(u), Y(v)))); ctx.stroke();
    ctx.setLineDash([4, 5]); ctx.strokeStyle = H.faint; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(X(0), Y(0.5)); ctx.lineTo(X(1), Y(0.5)); ctx.stroke(); ctx.setLineDash([]);
    if (c.median) {
      const u = U(c.median);
      ctx.fillStyle = H.mark; ctx.beginPath(); ctx.arc(X(u), Y(0.5), 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = H.text; ctx.textAlign = u > 0.6 ? "right" : "left";
      ctx.fillText(L.half(c.median), X(u) + (u > 0.6 ? -8 : 8), Y(0.5) - 8);
    }
    ctx.fillStyle = H.text; ctx.textAlign = "left"; ctx.fillText("0", X(0), h - fs * 0.3);
    ctx.textAlign = "right"; ctx.fillText(L.days(T), X(1), h - fs * 0.3);
    ctx.save(); ctx.translate(fs, Y(0.5)); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center"; ctx.fillText(L.still, 0, 0); ctx.restore();
  } else if (c.kind === "days") {
    // Merit per day as bars; births tick up from the baseline, deaths tick down.
    axes();
    const max = Math.max(...c.rows.map((r) => r.merit), 1), n = c.rows.length, bw = W / n;
    c.rows.forEach((r, i) => {
      ctx.fillStyle = H.line; const bh = (r.merit / max) * Ht * 0.92;
      ctx.fillRect(pad.l + i * bw + bw * 0.18, Y(0) - bh, bw * 0.64, bh);
      ctx.fillStyle = H.mark;
      if (r.ended) ctx.fillRect(pad.l + i * bw + bw * 0.4, Y(0) + 3, bw * 0.2, Math.min(14, 3 + r.ended));
    });
    ctx.fillStyle = H.text; ctx.textAlign = "left"; ctx.fillText(c.rows[0].date.slice(5), X(0), h - fs * 0.3);
    ctx.textAlign = "right"; ctx.fillText(c.rows.at(-1).date.slice(5), X(1), h - fs * 0.3);
    ctx.save(); ctx.translate(fs, Y(0.5)); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center"; ctx.fillText(L.meritDay, 0, 0); ctx.restore();
  } else if (c.kind === "bars" || c.kind === "histogram") {
    axes();
    const key = c.kind === "bars" ? "median" : "n";
    const max = Math.max(...c.rows.map((r) => r[key] || 0), 1e-9), n = c.rows.length, bw = W / n;
    c.rows.forEach((r, i) => {
      const v = r[key] || 0, bh = (v / max) * Ht * 0.9, bx = pad.l + i * bw;
      ctx.fillStyle = H.line; ctx.fillRect(bx + bw * 0.2, Y(0) - bh, bw * 0.6, bh);
      ctx.fillStyle = H.text; ctx.textAlign = "center";
      if (c.kind === "bars") {
        ctx.fillText(`${L.row(r.label)} (${r.n})`, bx + bw / 2, h - fs * 0.4);   // every bar shows its sample size
        if (r.n) ctx.fillText(`${v}`, bx + bw / 2, Y(0) - bh - 5);
      } else if (i % 2 === 0) ctx.fillText(L.row(r.label), bx + bw * 0.2, h - fs * 0.4);
    });
    ctx.save(); ctx.translate(fs, Y(0.5)); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center";
    ctx.fillText(c.kind === "bars" ? L.unit(c.unit) : L.count, 0, 0); ctx.restore();
  }
  ctx.restore();
}
