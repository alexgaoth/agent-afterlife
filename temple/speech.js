// 香客之言: what the pilgrims say as they look on the enshrined, in everyday spoken Chinese, some of it in the voice
// of agents that are still working. A pilgrim speaks when it slows almost to a stop, about the honoured statue
// nearest to it (or the stele, or the lantern path); only a few speak at once, and only near the visitor.
// With sound on, they speak aloud (temple/voices.js): the name of the enshrined, a short pause, then the rest. With
// sound off (before the first click, or muted with M), they speak in bubbles: a sprite that faces the visitor from
// any side and has a fixed size in the world, so a bubble further away looks smaller.
// What is said and when depends only on the time, so a recording of the temple comes out the same each time.
import * as THREE from "three";
import { cjk } from "./fonts.js";

const SAY = {
  gilded: ["{n}，这可是金身啊，功劳头一份。", "{n}，看看这金身，就知道干了多少活。", "{n}，一百个里头才出一个金身，服了。", "{n}，这功劳，咱们是追不上了。"],
  general: ["{n}，真是一员猛将。", "{n}，披着盔甲拿着戟，真威风。", "{n}，当年提的合并请求，到现在还在呢。", "{n}，干什么成什么，厉害。", "{n}，看这像，跟上阵打仗似的。"],
  strategist: ["{n}，坐着出主意，仗就打赢了。", "{n}，手里拿着羽扇，想好了才动手。", "{n}，不拿兵器，光靠脑子也能成事。", "{n}，帮别人看了那么多代码，功劳也不小。"],
  any: ["{n}，咱们都得好好学学。", "{n}，人虽然走了，功劳还在。", "{n}，拜一拜，沾点勤快劲。", "{n}，这辈子干的活，没一件含糊的。", "{n}，敬的是这份实打实的活。"],
  stele: ["碑上刻的，都是最风光的那几天。", "看了这碑，才知道大家有多辛苦。", "数字不多，道理都在里头。", "这碑上写的，可一点不假。"],
  lantern: ["灯一天多一盏，功劳一天攒一点。", "一天一盏灯，一盏接一盏。", "灯越亮，说明活越多。"],
  self: ["我这活还没干完呢，得加把劲。", "也不知道咱们以后，能不能在这儿占个位子？", "提交一千行，不如合并一个。", "我也得勤快点，接着前辈干。", "这儿挺庄重的，说话小点声。", "香火一直没断过，大家都记着呢。", "前辈干的活，就是咱们的榜样。"],
};
const STELES = [[-5.2, -6], [5.2, -6], [-5.2, 6], [5.2, 6], [-5.2, 18], [5.2, 18], [-5.2, 28], [5.2, 28]];
const MAX_SHOWN = 4, MAX_VOICES = 2, NEAR = 26;   // bubbles at once, voices at once; metres from the visitor

/**
 * statues: [{ agent, at: {x,y,z}, gilded, role }] for the seated; walkers(): [{ id, position, pace }] from the
 * pilgrims. voices(): the voice pack (temple/voices.js) or null. record: no playback; each thing said aloud goes to
 * `log` instead ([{ t, id, voice, at: {x,y,z}, text, clips }]), for a recorder to mix into its sound track.
 * voiceRange: metres from the visitor in record mode. The live temple still uses NEAR.
 * bubbles: always bubbles, never voices.
 * Returns { update(t, camera), overlay, say(w, k), log }.
 */
export function buildSpeech(scene, statues, walkers, { all = false, world = null, skip = [], voices = () => null, record = false, voiceRange = NEAR, bubbles = false, log = [] } = {}) {
  // Bubbles live in their own scene, drawn after the mural effect so their characters stay crisp (the main.js loop
  // renders `overlay` last). Walls still hide them: a ray from the visitor to the speaker, against the world.
  const overlay = new THREE.Scene();
  const ray = new THREE.Raycaster(), to = new THREE.Vector3();
  const shown = new Map();                          // pilgrim id -> { sprite, until }
  const speaking = new Map();                       // pilgrim id -> { until, anchor }
  const recent = [];                                // the last few lines said, so two pilgrims do not repeat each other
  /** What pilgrim w says on its k-th spell of slowness: { id, text, name } (name: the enshrined agent's, or null). */
  function lineFor(w, k, canName = () => true) {
    const h = hash(`${w.id}:${k}`);
    const near = statues.map((s) => ({ s, d: Math.hypot(s.at.x - w.position.x, s.at.z - w.position.z) })).sort((a, b) => a.d - b.d)[0];
    const stele = STELES.some(([x, z]) => Math.hypot(x - w.position.x, z - w.position.z) < 4.5);
    let group;
    if (stele && h % 3 === 0) group = "stele";
    else if (Math.abs(w.position.x) < 2 && h % 3 === 1) group = "lantern";
    else if (near && near.d < 16 && h % 5 !== 0 && canName(near.s.agent.name)) group = near.s.gilded ? "gilded" : near.s.role === "general" ? "general" : near.s.role === "strategist" ? "strategist" : "any";
    else group = "self";
    let i = (h >>> 3) % SAY[group].length;
    for (let j = 0; j < SAY[group].length && recent.includes(`${group}-${i}`); j++) i = (i + 1) % SAY[group].length;
    const text = SAY[group][i];
    const name = text.includes("{n}") ? near.s.agent.name : null;
    return { id: `${group}-${i}`, text: name ? text.replace("{n}", name) : text, name };
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
  const heard = (id) => { recent.push(id); if (recent.length > 8) recent.shift(); };
  const head = (w) => new THREE.Vector3(w.position.x, w.position.y + 1.55 * (w.scale || 1), w.position.z);
  /** Say it aloud; false when the pack cannot (then the pilgrim stays quiet this time). */
  function speak(w, k, t, v) {
    const voice = v.voiceOf(w.id);
    const line = lineFor(w, k, (name) => v.hasName(name, voice));
    const clips = v.clips(line.id, line.name, voice);
    if (!clips) return false;
    heard(line.id);
    const end = Math.max(...clips.map((c) => c.at + c.dur));
    if (record) {
      const at = head(w);
      log.push({ t: +t.toFixed(3), id: w.id, voice, at: { x: +at.x.toFixed(2), y: +at.y.toFixed(2), z: +at.z.toFixed(2) }, text: line.text, clips });
      speaking.set(w.id, { until: t + end + 0.8 });
    } else {
      const anchor = new THREE.Object3D(); anchor.position.copy(head(w)); scene.add(anchor);
      v.play(clips, anchor);
      speaking.set(w.id, { until: t + end + 0.8, anchor });
    }
    return true;
  }
  function update(t, camera) {
    const list = walkers(), byId = new Map(list.map((w) => [w.id, w]));
    for (const w of list) {
      const s = shown.get(w.id);
      if (s && (t > s.until || camera.position.distanceTo(w.position) > NEAR + 4)) {
        overlay.remove(s.sprite); s.sprite.material.map.dispose(); s.sprite.material.dispose(); shown.delete(w.id);
      }
    }
    for (const [id, s] of speaking) {
      if (t > s.until || !byId.has(id)) { if (s.anchor) scene.remove(s.anchor); speaking.delete(id); }
      else if (s.anchor) s.anchor.position.copy(head(byId.get(id)));   // the voice walks with the speaker
    }
    const v = bubbles ? null : voices();
    const aloud = !!v?.pack && (record || v.on());
    const range = record && aloud ? voiceRange : NEAR;
    // Who may speak: slowed almost to a stop, near the visitor, not spoken in the last few seconds.
    const want = list.filter((w) => (all || w.pace < 0.32)
      && camera.position.distanceTo(record && aloud ? head(w) : w.position) < range)
      .sort((a, b) => camera.position.distanceTo(a.position) - camera.position.distanceTo(b.position));
    for (const w of want) {
      if (shown.has(w.id) || speaking.has(w.id)) continue;
      if (aloud ? speaking.size >= MAX_VOICES : shown.size >= MAX_SHOWN) continue;
      const k = Math.floor((t + (hash(w.id) % 1000) / 100) / 12);   // one thing said per 12-second spell of slowness
      if (k === w.lastSaid) continue;
      w.lastSaid = k;
      if (aloud) { speak(w, k, t, v); continue; }
      const line = lineFor(w, k);
      heard(line.id);
      const sprite = bubble(line.text);
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
  return { update, overlay, say: (w, k) => lineFor(w, k).text, log };
}

function wrap(text, n) {
  const chars = [...text], out = [];
  for (let i = 0; i < chars.length; i += n) out.push(chars.slice(i, i + n).join(""));
  if (out.length > 1 && [...out.at(-1)].length <= 2) { const last = out.pop(); out[out.length - 1] += last; }   // no orphan punctuation
  return out;
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function hash(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0; return h; }
