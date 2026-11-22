// 祠堂: the ancestral hall in the side court. A lineage is all the agents that carried one name; each panel holds
// one lineage, a tablet (牌位) per generation, oldest first. The longest lineages get the panels (back wall
// first). A panel is one canvas, so a lineage costs one draw call; gaze finds the tablet from where the look
// lands on the panel (its uv).
import * as THREE from "three";
import { cjk, CJK } from "./fonts.js";
import { cnNumber } from "./seating.js";
import { board } from "./plaques.js";

const COLS = 6, ROWS = 9, HEAD = 0.17;            // grid of tablets under a header band (fraction of the height)
const ordinal = (n) => (n <= 99 ? `第${cnNumber(n)}代` : `#${n}`);

/** The lineages worth a panel: names with two generations or more, longest first. */
export function lineages(data) {
  const by = new Map();
  for (const a of data.agents) if (a.name !== "Unnamed") (by.get(a.name) || by.set(a.name, []).get(a.name)).push(a);
  return [...by].filter(([, list]) => list.length >= 2)
    .map(([name, list]) => ({ name, agents: list.sort((x, y) => (x.generation || 0) - (y.generation || 0) || x.born.localeCompare(y.born)) }))
    .sort((a, b) => b.agents.length - a.agents.length || a.name.localeCompare(b.name));
}

/** Which agents a panel shows, in order: all of them, or the founder, a gap, and the newest. */
function shown(list) {
  const cap = COLS * ROWS;
  if (list.length <= cap) return list;
  return [list[0], { gap: list.length - (cap - 1) }, ...list.slice(-(cap - 2))];
}

function panelTexture(lin, cells) {
  const c = document.createElement("canvas"); c.width = 768; c.height = Math.round(768 * 3.0 / 1.95);
  const g = c.getContext("2d"), W = c.width, H = c.height;
  g.fillStyle = "#3a1712"; g.fillRect(0, 0, W, H);                                   // lacquered shelf back
  g.fillStyle = "#b8913f"; g.fillRect(0, 0, W, H * HEAD);
  g.fillStyle = "#1c140e"; g.fillRect(W * 0.03, H * 0.012, W * 0.94, H * HEAD - H * 0.024);
  g.fillStyle = "#f2d68c"; g.textAlign = "center"; g.textBaseline = "middle";
  g.font = `${Math.round(H * 0.05)}px "IM Fell English", ${CJK}`;   // a name may be Chinese
  g.fillText(lin.name, W / 2, H * 0.06, W * 0.9);
  g.font = cjk(Math.round(H * 0.036));
  g.fillText(`${lin.agents.length} 代 · 世系`, W / 2, H * 0.125);
  const cw = W / COLS, ch = (H * (1 - HEAD)) / ROWS;
  cells.forEach((a, i) => {
    const x = (i % COLS) * cw, y = H * HEAD + Math.floor(i / COLS) * ch;
    if (a.gap) {
      g.fillStyle = "rgba(242,214,140,.7)"; g.font = `${Math.round(ch * 0.28)}px Georgia, serif`;
      g.fillText(`… ${a.gap} …`, x + cw / 2, y + ch / 2);
      return;
    }
    // A tablet: a red board with a rounded head on a small base, gilt rim, its generation and its last day.
    const tx = x + cw * 0.18, tw = cw * 0.64, ty = y + ch * 0.1, th = ch * 0.78;
    g.fillStyle = "#2a1a10"; g.fillRect(tx - cw * 0.04, ty + th - ch * 0.08, tw + cw * 0.08, ch * 0.1);
    g.fillStyle = a.status === "alive" ? "#6b5a2a" : "#7a2118";
    g.beginPath(); g.moveTo(tx, ty + th * 0.18); g.quadraticCurveTo(tx + tw / 2, ty - th * 0.06, tx + tw, ty + th * 0.18);
    g.lineTo(tx + tw, ty + th - ch * 0.08); g.lineTo(tx, ty + th - ch * 0.08); g.closePath(); g.fill();
    g.strokeStyle = "#c9a45c"; g.lineWidth = 2; g.stroke();
    g.fillStyle = "#f2d68c";
    g.font = cjk(Math.round(Math.min(tw * 0.34, ch * 0.2)));
    const label = ordinal(a.generation || i + 1);
    [...label].slice(0, 5).forEach((chr, k, arr) => g.fillText(chr, tx + tw / 2, ty + th * 0.22 + k * (th * 0.56) / Math.max(arr.length, 3)));
    g.font = `${Math.round(ch * 0.1)}px Georgia, serif`; g.fillStyle = "rgba(242,214,140,.8)";
    g.fillText((a.ended || "now").slice(5), tx + tw / 2, ty + th - ch * 0.15);
  });
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

/** Fill the hall's panel slots. Returns { meshes, agentAt(hit) } for the gaze. */
export function buildAncestralHall(scene, data, hall) {
  const lins = lineages(data).slice(0, hall.panels.length);
  const meshes = [];
  lins.forEach((lin, k) => {
    const slot = hall.panels[k], cells = shown(lin.agents);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(slot.w, slot.h), new THREE.MeshBasicMaterial({ map: panelTexture(lin, cells) }));
    m.position.set(slot.x, slot.y + slot.h / 2, slot.z); m.rotation.y = slot.ry;
    m.userData.lineage = { name: lin.name, cells };
    scene.add(m); meshes.push(m);
  });
  const sign = board("世德祠", { w: 2.4, h: 0.9 });
  sign.position.set(hall.front.x, hall.front.y, hall.front.z); sign.rotation.set(0, Math.PI / 2, 0); sign.rotateX(-0.16);
  sign.userData.agentId = "plaque:ancestral";
  scene.add(sign);
  meshes.push(sign);
  return {
    meshes,
    count: lins.length,
    /** Every tablet, where it hangs: [{ id, name, merit, panel, x, y, z }] (panel 0-4: the back wall). */
    tablets() {
      const out = [], p = new THREE.Vector3();
      meshes.forEach((m, panel) => {
        const lin = m.userData.lineage;
        if (!lin) return;
        const { width: w, height: h } = m.geometry.parameters;
        lin.cells.forEach((a, i) => {
          if (!a || a.gap) return;
          const u = ((i % COLS) + 0.5) / COLS, v = HEAD + ((Math.floor(i / COLS) + 0.5) / ROWS) * (1 - HEAD);
          m.updateMatrixWorld(); p.set((u - 0.5) * w, (0.5 - v) * h, 0).applyMatrix4(m.matrixWorld);
          out.push({ id: a.id, name: a.name, merit: a.merit, panel, x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3) });
        });
      });
      return out;
    },
    /** The agent on the tablet a ray hit, or null (header, gap or empty shelf). */
    agentAt(hit) {
      const lin = hit.object.userData.lineage;
      if (!lin || !hit.uv) return null;
      const v = 1 - hit.uv.y;
      if (v < HEAD) return null;
      const col = Math.floor(hit.uv.x * COLS), row = Math.floor(((v - HEAD) / (1 - HEAD)) * ROWS);
      const a = lin.cells[row * COLS + col];
      return a && !a.gap ? a.id : null;
    },
  };
}
