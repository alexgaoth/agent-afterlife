// 声: the temple's sound, from real recordings (temple/sounds/CREDITS.md). Nothing plays until the visitor enters:
// browsers allow sound only after a click. Wind in the pines all the time; birds by day, insects by night; bronze
// eave bells at the corners of the main hall and at the gate, louder as you come near; footsteps on the stone
// paving while you walk; on entering, the bell by day and the drum by night (晨钟暮鼓). M mutes, and remembers.
import * as THREE from "three";

const BASE = new URL("./sounds/", import.meta.url).href;
const FILES = ["wind-pines", "birds-day", "night-insects", "eave-bells", "footsteps-stone", "bell", "drum"];
const EAVES = [[-12.9, 7.2, -27.3], [12.9, 7.2, -27.3], [-6.6, 5, 40.4], [6.6, 5, 40.4], [-38, 4.8, -13.6]];   // hall corners, gate, 祠堂

export function buildSound(camera, scene, { isNight = () => { const h = new Date().getHours(); return h < 6 || h >= 19; } } = {}) {
  let listener = null, buffers = null, steps = null, loading = null;
  let muted = safeGet("afterlife:muted") === "1";
  const loops = [];

  function loop(buffer, volume, at) {
    const a = at ? new THREE.PositionalAudio(listener) : new THREE.Audio(listener);
    a.setBuffer(buffer); a.setLoop(true); a.setVolume(volume);
    if (at) { a.setRefDistance(5); a.setRolloffFactor(1.4); const o = new THREE.Object3D(); o.position.set(...at); o.add(a); scene.add(o); }
    a.offset = Math.random() * buffer.duration;                     // so copies of one loop are not in step
    a.play(); loops.push(a);
    return a;
  }

  /** Load the recordings and start the ambience; then the bell or the drum. Call from a click. */
  function start() {
    if (loading) return loading;
    listener = new THREE.AudioListener();
    camera.add(listener);
    listener.setMasterVolume(muted ? 0 : 1);
    const loader = new THREE.AudioLoader();
    loading = Promise.all(FILES.map((f) => loader.loadAsync(`${BASE}${f}.mp3`).then((b) => [f, b]))).then((list) => {
      buffers = Object.fromEntries(list);
      const night = isNight();
      loop(buffers["wind-pines"], 0.32);
      loop(buffers[night ? "night-insects" : "birds-day"], night ? 0.3 : 0.22);
      for (const at of EAVES) { const b = loop(buffers["eave-bells"], 0.55, at); b.setPlaybackRate(0.96 + Math.random() * 0.08); }
      steps = new THREE.Audio(listener); steps.setBuffer(buffers["footsteps-stone"]); steps.setLoop(true); steps.setVolume(0.42);
      strike(night ? "drum" : "bell");
    }).catch(() => {});                                              // no sound files: the temple stays silent
    return loading;
  }

  /** One stroke of the bell or the drum. */
  function strike(name) {
    if (!buffers?.[name]) return;
    const a = new THREE.Audio(listener); a.setBuffer(buffers[name]); a.setVolume(name === "bell" ? 0.7 : 0.8); a.play();
  }

  /** Footsteps while the visitor walks; quicker when hurrying. */
  function walking(on, hurry = false) {
    if (!steps) return;
    steps.setPlaybackRate(hurry ? 1.55 : 1.2);
    if (on && !steps.isPlaying) steps.play();
    else if (!on && steps.isPlaying) steps.pause();
  }

  function toggle() {
    muted = !muted;
    safeSet("afterlife:muted", muted ? "1" : "0");
    listener?.setMasterVolume(muted ? 0 : 1);
    return muted;
  }

  return { start, strike, walking, toggle, get muted() { return muted; } };
}

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
