// 天: the sky follows the hour where the visitor is, and the weather follows the fleet's work on the day shown.
//   Hour: dawn, day, dusk and night blend into each other: the plaster-coloured haze of day, warm dusk, a dark
//   indigo night with a cold moon; lamps and lanterns burn brighter as it darkens.
//   Weather: that day's merit against the fleet's usual day (the median of days with work): clear above it (晴),
//   a thin mist around it (薄雾), overcast below it (阴), rain when little was done (雨).
// ?time=HH[:MM] and ?weather=clear|mist|overcast|rain set them by hand (screenshots, recordings).
import * as THREE from "three";
export { weatherFor } from "../shared/timeline.js";

const KEYS = [   // hour, background/fog, hemisphere sky, ground, strength, sun colour, strength, sun position, sky tint, lamps
  { h: 0, bg: 0x283042, hs: 0x6a7aa6, hg: 0x2c2c34, hi: 0.85, sc: 0xa8bce6, si: 0.5, sp: [40, 70, -20], tint: 0x3a4560, lamp: 1.9 },
  { h: 5, bg: 0x2e3648, hs: 0x7282aa, hg: 0x2e2e36, hi: 0.9, sc: 0xb0c0e6, si: 0.5, sp: [60, 40, -10], tint: 0x4a5270, lamp: 1.8 },
  { h: 6.5, bg: 0xd8b8a8, hs: 0xf0d0c0, hg: 0x7a6a5a, hi: 1.6, sc: 0xffc8a0, si: 1.1, sp: [80, 25, 10], tint: 0xe0b8a8, lamp: 1.0 },
  { h: 9, bg: 0xd8ccae, hs: 0xf2e4c4, hg: 0x8a7a62, hi: 2.4, sc: 0xffe2b0, si: 1.8, sp: [-30, 80, 18], tint: 0xffffff, lamp: 0.6 },
  { h: 16, bg: 0xd8ccae, hs: 0xf2e4c4, hg: 0x8a7a62, hi: 2.4, sc: 0xffe2b0, si: 1.8, sp: [-30, 80, 18], tint: 0xffffff, lamp: 0.6 },
  { h: 18.5, bg: 0xd9a878, hs: 0xf0c090, hg: 0x7a5a42, hi: 1.6, sc: 0xff9a50, si: 1.2, sp: [-80, 25, 30], tint: 0xe0a070, lamp: 1.1 },
  { h: 20, bg: 0x2e3648, hs: 0x7282aa, hg: 0x2e2e36, hi: 0.9, sc: 0xb0c0e6, si: 0.5, sp: [40, 70, -20], tint: 0x4a5270, lamp: 1.8 },
  { h: 24, bg: 0x283042, hs: 0x6a7aa6, hg: 0x2c2c34, hi: 0.85, sc: 0xa8bce6, si: 0.5, sp: [40, 70, -20], tint: 0x3a4560, lamp: 1.9 },
];
const WEATHER = {
  clear: { cn: "晴", en: "clear", near: 45, far: 150, sun: 1, hemi: 1, grey: 0 },
  mist: { cn: "薄雾", en: "a thin mist", near: 22, far: 105, sun: 0.75, hemi: 0.95, grey: 0.15 },
  overcast: { cn: "阴", en: "overcast", near: 14, far: 85, sun: 0.35, hemi: 0.85, grey: 0.38 },
  rain: { cn: "雨", en: "rain", near: 16, far: 95, sun: 0.22, hemi: 0.75, grey: 0.42 },
};
const GREY = new THREE.Color(0x8e8e88);

export function buildSky(scene, { hemi, sun, lamps, sky }, { fires = null } = {}) {
  const c1 = new THREE.Color(), c2 = new THREE.Color(), out = new THREE.Color();
  let hour = 12, weather = "clear";
  // Rain: short streaks in a box that follows the visitor; where each streak is depends only on the time.
  const N = 1400, box = { w: 50, h: 22 };
  const pos = new Float32Array(N * 6), seed = Float32Array.from({ length: N * 3 }, () => Math.random());
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xc9ced6, transparent: true, opacity: 0.45, fog: false }));
  rain.frustumCulled = false; rain.visible = false; scene.add(rain);

  function lerpKey(h) {
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++;
    const a = KEYS[i], b = KEYS[i + 1], u = Math.min(1, Math.max(0, (h - a.h) / (b.h - a.h || 1)));
    const col = (k) => out.copy(c1.set(a[k])).lerp(c2.set(b[k]), u).getHex();
    const num = (k) => a[k] + (b[k] - a[k]) * u;
    return { bg: col("bg"), hs: col("hs"), hg: col("hg"), hi: num("hi"), sc: col("sc"), si: num("si"), tint: col("tint"), lamp: num("lamp"),
      sp: a.sp.map((v, j) => v + (b.sp[j] - v) * u) };
  }

  function apply() {
    const k = lerpKey(hour), w = WEATHER[weather];
    const bg = new THREE.Color(k.bg).lerp(GREY, w.grey);
    scene.background = bg; scene.fog.color.copy(bg); scene.fog.near = w.near; scene.fog.far = w.far;
    hemi.color.set(k.hs); hemi.groundColor.set(k.hg); hemi.intensity = k.hi * w.hemi;
    sun.color.set(k.sc); sun.intensity = k.si * w.sun; sun.position.set(...k.sp);
    for (const l of lamps) l.intensity = (l.userData.base ?? l.intensity) * k.lamp * (weather === "clear" ? 1 : 1.1);
    sky.material.color.set(k.tint).lerp(GREY, w.grey);
    if (fires) fires.material.color.setScalar(0.55 + 0.6 * (k.lamp - 0.6) / 1.3);
    rain.visible = weather === "rain";
  }

  /** Move the rain with the visitor; call once per frame. */
  function update(t, camera) {
    if (!rain.visible) return;
    const p = camera.position;
    for (let i = 0; i < N; i++) {
      const x = p.x + (seed[i * 3] - 0.5) * box.w, z = p.z + (seed[i * 3 + 1] - 0.5) * box.w;
      const y = (box.h - ((t * 16 + seed[i * 3 + 2] * box.h) % box.h)) + p.y - 6;
      pos.set([x, y, z, x - 0.04, y - 0.55, z], i * 6);
    }
    geo.attributes.position.needsUpdate = true;
  }

  return {
    set(o = {}) { if (o.hour !== undefined) hour = ((o.hour % 24) + 24) % 24; if (o.weather) weather = WEATHER[o.weather] ? o.weather : "clear"; apply(); },
    update,
    isNight: () => hour < 5.5 || hour >= 19.5,
    get weather() { return { key: weather, ...WEATHER[weather] }; },
    get hour() { return hour; },
  };
}
