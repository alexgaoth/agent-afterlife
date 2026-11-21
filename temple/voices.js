// 人声: the pilgrims' voices. temple/voices holds synthetic voices (CosyVoice 3; see CREDITS.md there): every line
// of temple/speech.js, and the names of the historical Chinese generals the published fleet is named after. A line
// about an enshrined agent plays its name, a short pause, then the rest. A name not in the pack cannot be said, so
// that pilgrim says a line without a name. No pack (or a copy without it): the pilgrims speak in bubbles.
import * as THREE from "three";

const BASE = new URL("./voices/", import.meta.url).href;

/** sound: temple/sound.js (its listener exists after the first click). */
export function buildVoices(sound) {
  let pack = null;
  const ready = fetch(`${BASE}manifest.json`).then((r) => (r.ok ? r.json() : null)).then((m) => { pack = m; return m; }).catch(() => null);
  const loader = new THREE.AudioLoader(), buffers = new Map();
  const buffer = (src) => buffers.get(src) || buffers.set(src, loader.loadAsync(BASE + src)).get(src);

  /** The voice a pilgrim speaks in: the same one each time. */
  const voiceOf = (id) => pack.voices[hash(String(id)) % pack.voices.length];
  const hasName = (name, voice) => !!pack?.names[name]?.dur[voice];
  /** What to play for a line: [{ src, at, dur }] (src under temple/voices/, at = seconds from the start), or null. */
  function clips(lineId, name, voice) {
    const line = pack?.lines[lineId];
    if (!line?.dur[voice]) return null;
    const rest = { src: `lines/${voice}/${lineId}.mp3`, dur: line.dur[voice] };
    if (!line.named) return [{ ...rest, at: 0 }];
    if (!hasName(name, voice)) return null;
    const n = pack.names[name], first = n.dur[voice];
    return [{ src: `names/${voice}/${n.file}.mp3`, at: 0, dur: first }, { ...rest, at: +(first + pack.gap).toFixed(3) }];
  }
  /** Play the clips from a point in the scene (anchor: an Object3D the caller moves with the speaker). */
  function play(list, anchor) {
    const listener = sound.listener;
    if (!listener) return;
    Promise.all(list.map((c) => buffer(c.src))).then((bufs) => {
      bufs.forEach((b, i) => {
        const a = new THREE.PositionalAudio(listener);
        a.setBuffer(b); a.setRefDistance(3); a.setRolloffFactor(1.1); a.setVolume(1);
        a.onEnded = () => { a.isPlaying = false; anchor.remove(a); };
        anchor.add(a); a.play(list[i].at);          // started together, so the pause between name and line holds
      });
    }).catch(() => {});
  }
  return { get pack() { return pack; }, ready, voiceOf, hasName, clips, play, on: () => !!sound.listener && !sound.muted };
}

function hash(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0; return h; }
