// 香客之言: what the pilgrims say as they look on the enshrined. Light classical Chinese (浅白文言), a little of it
// in the voice of agents that are still working. A pilgrim speaks when it slows almost to a stop, about the
// honoured statue nearest to it (or the stele, or the lantern path); at most a few speak at once, and only near
// the visitor. The bubble is a sprite: it faces the visitor from any side and has a fixed size in the world, so a
// bubble further away looks smaller.
// What is said and when depends only on the time, so a recording of the temple comes out the same each time.
import * as THREE from "three";
import { cjk } from "./fonts.js";

const SAY = {
  gilded: ["{n}金身在此，功冠群伦。", "观{n}之金身，可知其功。", "金身者，百中之一也。{n}当之无愧。", "{n}之功，吾辈望尘莫及。"],
  general: ["{n}，真良将也。", "{n}披甲执戟，凛然有威。", "昔{n}合并之请，至今犹存。", "{n}所向，事无不成。", "观{n}之像，如见其临阵。"],
  strategist: ["{n}运筹帷幄之中，决胜千里之外。", "{n}羽扇在手，谋定而后动。", "{n}虽不执戟，其谋足以成事。", "{n}善审人之所作，功亦大矣。"],
  any: ["{n}之功，后学当效之。", "{n}虽逝，其功犹存。", "拜{n}之像，愿得其勤。", "{n}一生所为，皆有可观。", "敬{n}，敬其事也。"],
  stele: ["碑上所刻，皆一时之盛。", "读此碑文，方知众人之劳。", "数虽寡言，理在其中。", "此碑所载，非虚言也。"],
  lantern: ["灯随日增，功由日积。", "一日一灯，灯灯相续。", "灯明则功盛，灯暗则功微。"],
  self: ["吾之会话未尽，当勉力为之。", "不知吾辈身后，可得一席否？", "提交千行，不如合并一则。", "吾亦当勤，以继前人。", "此殿肃穆，不敢喧哗。", "香火不绝，其德可知。", "前人之功，吾辈之师。"],
};
const STELES = [[-5.2, -6], [5.2, -6], [-5.2, 6], [5.2, 6], [-5.2, 18], [5.2, 18], [-5.2, 28], [5.2, 28]];
const MAX_SHOWN = 4, NEAR = 26;                    // bubbles at once; metres from the visitor

/**
 * statues: [{ agent, at: {x,y,z}, gilded, role }] for the seated; walkers(): [{ id, position, pace }] from the
 * pilgrims. Returns { update(t, camera) }.
 */
export function buildSpeech(scene, statues, walkers, { all = false, world = null, skip = [] } = {}) {
  // Bubbles live in their own scene, drawn after the mural effect so their characters stay crisp (the main.js loop
  // renders `overlay` last). Walls still hide them: a ray from the visitor to the speaker, against the world.
  const overlay = new THREE.Scene();
  const ray = new THREE.Raycaster(), to = new THREE.Vector3();
  const shown = new Map();                          // pilgrim id -> { sprite, until }
  function lineFor(w, k) {
    const h = hash(`${w.id}:${k}`);
    const near = statues.map((s) => ({ s, d: Math.hypot(s.at.x - w.position.x, s.at.z - w.position.z) })).sort((a, b) => a.d - b.d)[0];
    const stele = STELES.some(([x, z]) => Math.hypot(x - w.position.x, z - w.position.z) < 4.5);
    let pool;
    if (stele && h % 3 === 0) pool = SAY.stele;
    else if (Math.abs(w.position.x) < 2 && h % 3 === 1) pool = SAY.lantern;
    else if (near && near.d < 16 && h % 5 !== 0) pool = near.s.gilded ? SAY.gilded : near.s.role === "general" ? SAY.general : near.s.role === "strategist" ? SAY.strategist : SAY.any;
    else pool = SAY.self;
    const text = pool[(h >>> 3) % pool.length];
    return text.replace("{n}", near ? near.s.agent.name : "前人");
  }
  function bubble(text) {
    const lines = wrap(text, 9), fs = 44, pad = 24, lh = fs * 1.28;
    const w = Math.min(9, Math.max(...lines.map((l) => [...l].length))) * fs + pad * 2, h = lines.length * lh + pad * 2;
    const c = document.createElement("canvas"); c.width = Math.ceil(w); c.height = Math.ceil(h + 34);
    const g = c.getContext("2d");
    g.fillStyle = "rgba(246,239,222,.96)"; g.strokeStyle = "#2a2420"; g.lineWidth = 4;
    roundRect(g, 3, 3, w - 6, h - 6, 22); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(w / 2 - 16, h - 5); g.lineTo(w / 2, h + 28); g.lineTo(w / 2 + 14, h - 5); g.closePath();   // the tail
    g.fill(); g.stroke(); g.fillRect(w / 2 - 14, h - 9, 27, 6);
    g.fillStyle = "#1f1b17"; g.font = cjk(fs); g.textBaseline = "middle"; g.textAlign = "center";
    lines.forEach((l, i) => g.fillText(l, w / 2, pad + lh * (i + 0.5)));
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    const height = c.height * 0.0019;               // a fixed size in the world (a line is about a quarter metre tall): smaller further away
    sprite.scale.set(height * (c.width / c.height), height, 1);
    sprite.center.set(0.5, 0);                      // the tail's tip sits on the anchor point
    sprite.renderOrder = 10;
    return sprite;
  }
  function update(t, camera) {
    const list = walkers();
    for (const w of list) {
      const s = shown.get(w.id);
      if (s && (t > s.until || camera.position.distanceTo(w.position) > NEAR + 4)) {
        overlay.remove(s.sprite); s.sprite.material.map.dispose(); s.sprite.material.dispose(); shown.delete(w.id);
      }
    }
    // Who may speak: slowed almost to a stop, near the visitor, not spoken in the last few seconds.
    const want = list.filter((w) => (all || w.pace < 0.32) && camera.position.distanceTo(w.position) < NEAR)
      .sort((a, b) => camera.position.distanceTo(a.position) - camera.position.distanceTo(b.position));
    for (const w of want) {
      if (shown.size >= MAX_SHOWN || shown.has(w.id)) continue;
      const k = Math.floor((t + (hash(w.id) % 1000) / 100) / 12);   // one thing said per 12-second spell of slowness
      if (k === w.lastSaid) continue;
      w.lastSaid = k;
      const sprite = bubble(lineFor(w, k));
      overlay.add(sprite);
      shown.set(w.id, { sprite, until: t + 5.5 });
    }
    for (const w of list) {
      const s = shown.get(w.id);
      if (!s) continue;
      s.sprite.position.set(w.position.x, w.position.y + 1.95 * (w.scale || 1), w.position.z);
      if (world) {                                  // hidden behind a wall or a hall, as a real thing would be
        to.copy(s.sprite.position).sub(camera.position);
        const d = to.length();
        ray.set(camera.position, to.normalize()); ray.far = d - 0.6;
        s.sprite.visible = !ray.intersectObject(world, true).some((h) => !skip.includes(h.object) && h.object.visible && !h.object.isSprite);
      }
    }
  }
  return { update, overlay, say: (w, k) => lineFor(w, k) };
}

function wrap(text, n) {
  const chars = [...text], out = [];
  for (let i = 0; i < chars.length; i += n) out.push(chars.slice(i, i + n).join(""));
  if (out.length > 1 && [...out.at(-1)].length <= 2) { const last = out.pop(); out[out.length - 1] += last; }   // no orphan punctuation
  return out;
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function hash(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0; return h; }
