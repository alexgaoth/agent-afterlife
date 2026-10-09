// The temple compound, in metres. North is -z; the gate is at +z; the main hall faces south.
// Plan after the 1123 武成王庙: main hall on a platform with a front terrace and steps, two long
// side halls (两庑) open to the courtyard, a paved path (甬道) from the gate, a stele and an incense
// burner beside it, a pair of pines inside the gate.
import * as THREE from "three";
import { paint, PIGMENT } from "./statue.js";

const TILE = 0x46504b, PLASTER = 0xd9cfb6, COLUMN = 0x8f2f22, TERRACE = 0xa49e8c;

// ------------------------------------------------------------------ canvas textures
function canvasTexture(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function seeded(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }

const paving = () => canvasTexture(512, 512, (x, w, h) => {
  const r = seeded(7);
  x.fillStyle = "#9d9787"; x.fillRect(0, 0, w, h);
  for (let row = 0; row < 8; row++) {
    const off = (row % 2) * 32;
    for (let col = -1; col < 5; col++) {
      const v = 150 + Math.floor(r() * 12);
      x.fillStyle = `rgb(${v},${v - 6},${v - 18})`;
      x.fillRect(col * 128 + off + 2, row * 64 + 2, 124, 60);
    }
  }
}, [24, 24]);

const roofTiles = () => canvasTexture(64, 256, (x, w, h) => {
  x.fillStyle = "#56605a"; x.fillRect(0, 0, w, h);
  x.fillStyle = "#3a433f"; x.fillRect(0, 0, 10, h);           // a row of cover tiles
  x.fillStyle = "#6a746d"; x.fillRect(12, 0, 4, h);
  for (let y = 0; y < h; y += 16) { x.fillStyle = "rgba(20,24,22,.35)"; x.fillRect(0, y, w, 2); }
});

const bandPainting = () => canvasTexture(256, 64, (x, w, h) => {
  // 彩画 on beams: azurite and malachite bands with a gold edge.
  x.fillStyle = "#2f5b8a"; x.fillRect(0, 0, w, h);
  x.fillStyle = "#3d8a6e"; for (let i = 0; i < w; i += 64) x.fillRect(i, 8, 32, h - 16);
  x.fillStyle = "#c39a45"; x.fillRect(0, 0, w, 5); x.fillRect(0, h - 5, w, 5);
}, [6, 1]);

const coffers = () => canvasTexture(256, 256, (x, w, h) => {
  // 平棊: the gridded ceiling.
  x.fillStyle = "#2c3b33"; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    x.fillStyle = (i + j) % 2 ? "#2a4a66" : "#356a58"; x.fillRect(i * 64 + 6, j * 64 + 6, 52, 52);
    x.strokeStyle = "#c39a45"; x.lineWidth = 2; x.beginPath(); x.arc(i * 64 + 32, j * 64 + 32, 14, 0, Math.PI * 2); x.stroke();
  }
}, [6, 3]);

const clouds = () => canvasTexture(512, 512, (x, w, h) => {
  // A painted screen (背屏): auspicious cloud scrolls on cinnabar.
  x.fillStyle = "#8f2f22"; x.fillRect(0, 0, w, h);
  const r = seeded(11);
  for (let k = 0; k < 14; k++) {
    const cx = r() * w, cy = r() * h, s = 30 + r() * 40;
    x.strokeStyle = k % 2 ? "#c39a45" : "#e6dcc6"; x.lineWidth = 6;
    for (let i = 0; i < 3; i++) { x.beginPath(); x.arc(cx + i * s * 0.9, cy, s * 0.5, Math.PI, Math.PI * 2.6); x.stroke(); }
  }
  x.strokeStyle = "#c39a45"; x.lineWidth = 14; x.strokeRect(7, 7, w - 14, h - 14);
});

// ------------------------------------------------------------------ helpers
function box(parent, size, pos, color, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size), mat || paint(color));
  m.position.set(...pos); m.castShadow = m.receiveShadow = true; parent.add(m);
  return m;
}
function texMat(tex, color = 0xffffff) { return new THREE.MeshToonMaterial({ map: tex, color, gradientMap: paint(0).gradientMap }); }

/** A hip roof with concave slopes and swept-up corners. Eave rectangle W x D at y=0, ridge of length L at height H, along x. */
function hipRoof(W, D, L, H, lift, tex) {
  const g = new THREE.Group();
  const liftAt = (s) => lift * Math.abs(2 * s - 1) ** 4;
  const faces = [
    (s) => [[-W / 2 + s * W, liftAt(s), D / 2], [-L / 2 + s * L, H, 0]],
    (s) => [[W / 2 - s * W, liftAt(s), -D / 2], [L / 2 - s * L, H, 0]],
    (s) => [[W / 2, liftAt(s), D / 2 - s * D], [L / 2, H, 0]],
    (s) => [[-W / 2, liftAt(s), -D / 2 + s * D], [-L / 2, H, 0]],
  ];
  const S = 28, T = 12;
  faces.forEach((face, fi) => {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= S; i++) for (let j = 0; j <= T; j++) {
      const s = i / S, t = j / T, [E, R] = face(s);
      pos.push(E[0] + (R[0] - E[0]) * t, E[1] + (R[1] - E[1]) * t ** 1.7, E[2] + (R[2] - E[2]) * t);
      uv.push(s * (fi < 2 ? W : D) / 1.2, t * 3);
    }
    for (let i = 0; i < S; i++) for (let j = 0; j < T; j++) {
      const a = i * (T + 1) + j, b = a + T + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ map: tex, color: 0xffffff, side: THREE.DoubleSide, gradientMap: paint(0).gradientMap }));
    m.castShadow = m.receiveShadow = true; g.add(m);
  });
  // Main ridge, hip ridges and the 鸱吻 at the ridge ends.
  box(g, [L + 0.6, 0.45, 0.45], [0, H + 0.15, 0], PIGMENT.ink);
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const pts = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      pts.push(new THREE.Vector3(sx * (W / 2 + (L / 2 - W / 2) * t), lift + (H - lift) * t ** 1.7 + 0.12, sz * (D / 2) * (1 - t)));
    }
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.16, 6), paint(PIGMENT.ink));
    tube.castShadow = true; g.add(tube);
  }
  for (const sx of [-1, 1]) {
    const chiwen = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.16, 8, 16, Math.PI * 1.3), paint(PIGMENT.ink));
    chiwen.position.set(sx * (L / 2 + 0.1), H + 0.85, 0); chiwen.rotation.set(0, sx > 0 ? Math.PI : 0, -0.6);
    g.add(chiwen);
  }
  return g;
}

/** A hall: columns, walls on three sides, painted beams, brackets, roof. Open on the +z side (local). */
function hall(parent, { w, d, colH, floor, bays, roofH, overhang, ceiling, door = 0 }) {
  const g = new THREE.Group();
  const tiles = roofTiles(), beam = new THREE.MeshToonMaterial({ map: bandPainting(), gradientMap: paint(0).gradientMap });
  const xs = Array.from({ length: bays + 1 }, (_, i) => -w / 2 + (i * w) / bays);
  for (const x of xs) for (const z of [-d / 2, d / 2]) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, colH, 12), paint(COLUMN));
    c.position.set(x, floor + colH / 2, z); c.castShadow = c.receiveShadow = true; g.add(c);
    box(g, [0.8, 0.25, 0.8], [x, floor + 0.12, z], PIGMENT.stone);                                  // column base
    for (let k = 0; k < 3; k++) box(g, [0.5 + k * 0.35, 0.22, 0.5 + k * 0.2], [x, floor + colH + 0.11 + k * 0.22, z],
                                    k % 2 ? PIGMENT.malachite : PIGMENT.azurite);                  // 斗拱, simplified
  }
  for (const z of [-d / 2, d / 2]) box(g, [w + 0.4, 0.45, 0.4], [0, floor + colH - 0.2, z], 0, beam);   // 阑额 beams
  if (door) {                                                                                     // back wall, with a doorway
    for (const sx of [-1, 1]) box(g, [(w - door) / 2, colH, 0.35], [sx * (w + door) / 4, floor + colH / 2, -d / 2 - 0.1], PLASTER);
    box(g, [door, colH * 0.35, 0.35], [0, floor + colH * 0.825, -d / 2 - 0.1], PLASTER);
  } else box(g, [w, colH, 0.35], [0, floor + colH / 2, -d / 2 - 0.1], PLASTER);                // back wall
  for (const sx of [-1, 1]) box(g, [0.35, colH, d], [sx * (w / 2 + 0.1), floor + colH / 2, 0], PLASTER);
  if (!door) box(g, [w, 0.9, 0.36], [0, floor + 0.45, -d / 2 - 0.08], PIGMENT.cinnabar);          // red dado
  if (ceiling) {
    const c = new THREE.Mesh(new THREE.PlaneGeometry(w, d), texMat(coffers()));
    c.rotation.x = Math.PI / 2; c.position.y = floor + colH + 0.7; g.add(c);
  }
  const roof = hipRoof(w + overhang * 2, d + overhang * 2, Math.max(0.5, w - d * 0.9), roofH, 0.9, tiles);
  roof.position.y = floor + colH + 0.66; g.add(roof);
  parent.add(g);
  return g;
}

// ------------------------------------------------------------------ the compound
export function buildWorld(scene) {
  const colliders = [];                                   // [minX, maxX, minZ, maxZ]
  const solid = (x0, x1, z0, z1) => colliders.push([Math.min(x0, x1), Math.max(x0, x1), Math.min(z0, z1), Math.max(z0, z1)]);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), texMat(paving()));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  // Enclosing wall with a tiled cap; the gate opening is in the south wall.
  const W = 26, N = -48, S = 40;
  const wallMat = paint(0xb04a36);
  const wall = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const m = box(scene, [len, 3.2, 0.7], [(x0 + x1) / 2, 1.6, (z0 + z1) / 2], 0, wallMat);
    m.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    const cap = box(scene, [len + 0.4, 0.35, 1.3], [(x0 + x1) / 2, 3.35, (z0 + z1) / 2], TILE);
    cap.rotation.y = m.rotation.y;
    solid(x0 - 0.4, x1 + 0.4, z0 - 0.4, z1 + 0.4);
  };
  wall(-W, N, W, N); wall(-W, N, -W, S); wall(W, N, W, S); wall(-W, S, -2, S); wall(2, S, W, S);

  // Main hall (正殿) on its platform, with the front terrace (月台) and steps.
  const P = 1.2;
  box(scene, [28, P, 16], [0, P / 2, -34], TERRACE);
  box(scene, [16, P, 6.4], [0, P / 2, -23], TERRACE);
  for (let k = 0; k < 6; k++) box(scene, [5, P - k * 0.2, 0.5], [0, (P - k * 0.2) / 2, -19.55 + k * 0.5], TERRACE);
  const main = new THREE.Group(); main.position.z = -34; scene.add(main);
  hall(main, { w: 25, d: 13, colH: 5.6, floor: P, bays: 7, roofH: 5.2, overhang: 2.6, ceiling: true });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(7, 5), texMat(clouds()));
  screen.position.set(0, P + 2.7, -6.2); main.add(screen);
  // Walk limits: platform edges except the steps, hall walls.
  solid(-14, 14, -42.3, -41.6); solid(-14.3, -13.6, -42, -26); solid(13.6, 14.3, -42, -26);
  solid(-14, -8, -26.3, -25.8); solid(8, 14, -26.3, -25.8); solid(-8.3, -7.8, -26, -19.8); solid(7.8, 8.3, -26, -19.8);
  solid(-8, -2.6, -20, -19.6); solid(2.6, 8, -20, -19.6);
  solid(-12.8, 12.8, -41.1, -40.4); solid(-12.9, -12.3, -41, -27.5); solid(12.3, 12.9, -41, -27.5);

  // Side halls (两庑): long, open to the courtyard. Built along x, then turned to run north-south.
  const wingLen = 46, wingZ = 7;
  for (const side of [1, -1]) {
    const g = new THREE.Group();
    g.position.set(side * 19.5, 0, wingZ); g.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;  // open side faces the courtyard
    scene.add(g);
    box(g, [wingLen + 1, 0.5, 7.2], [0, 0.25, 0], TERRACE);
    hall(g, { w: wingLen, d: 6, colH: 3.6, floor: 0.5, bays: 12, roofH: 2.6, overhang: 1.4, ceiling: false });
    solid(side * 22.6, side * 23.4, wingZ - wingLen / 2, wingZ + wingLen / 2);   // back wall
  }

  // Gate (庙门).
  const gate = new THREE.Group(); gate.position.z = S; gate.rotation.y = Math.PI; scene.add(gate);
  hall(gate, { w: 12, d: 5, colH: 4.2, floor: 0, bays: 3, roofH: 3.4, overhang: 1.8, ceiling: false, door: 4 });
  for (const sx of [-1, 1]) solid(sx * 2, sx * 6.4, S - 0.4, S + 0.4);

  // The path (甬道), incense burner, stele and pines.
  box(scene, [4, 0.08, 56], [0, 0.04, 11], 0xa8a291);
  const burner = new THREE.Group(); burner.position.set(0, 0, -12); scene.add(burner);
  box(burner, [1.6, 0.9, 1.6], [0, 0.45, 0], PIGMENT.ink);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.8, 0.9, 16), paint(0x6a5530));
  bowl.position.y = 1.35; bowl.castShadow = true; burner.add(bowl);
  solid(-1.2, 1.2, -13.2, -10.8);

  const stele = new THREE.Group(); stele.position.set(5.2, 0, -6); stele.rotation.y = -Math.PI / 2; scene.add(stele);
  box(stele, [2.2, 0.7, 1.4], [0, 0.35, 0], PIGMENT.stone);           // 龟趺, simplified to a plinth
  const slab = box(stele, [1.5, 3.4, 0.4], [0, 2.4, 0], 0x6f6d64);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.4, 20, 1, false, 0, Math.PI), paint(0x6f6d64));
  head.rotation.set(Math.PI / 2, 0, Math.PI / 2, "ZYX"); head.position.y = 4.1; stele.add(head);   // a round head on the slab
  solid(4.4, 6, -7.2, -4.8);

  for (const sx of [-1, 1]) pine(scene, sx * 7, 30, sx);

  // 青绿山水: blue-green mountains painted on the paper sky all around, as a mural background.
  const sky = new THREE.Mesh(new THREE.CylinderGeometry(150, 150, 160, 64, 1, true), new THREE.MeshBasicMaterial({ map: mountains(), side: THREE.BackSide, fog: false }));
  sky.position.y = 40; scene.add(sky);

  // Lights: a late, warm afternoon; lamps inside the halls.
  scene.add(new THREE.HemisphereLight(0xf2e4c4, 0x8a7a62, 2.4));
  const sun = new THREE.DirectionalLight(0xffe2b0, 1.8);
  sun.position.set(-30, 80, 18); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 160 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const lamps = [[0, 6, -35, 40], [-7, 5, -31, 18], [7, 5, -31, 18]];
  for (const sx of [-1, 1]) for (let z = -12; z <= 26; z += 12) lamps.push([sx * 20, 3.4, z, 10]);
  for (const [x, y, z, i] of lamps) {
    const l = new THREE.PointLight(0xffb866, i, 18, 1.6); l.position.set(x, y, z); scene.add(l);
  }

  // Where each seat stands, and which way it faces (rotation about y; 0 faces south, toward the gate).
  const seats = {
    main: [{ x: 0, y: P, z: -38.2, r: 0 }],
    companion: [{ x: -4.6, y: P, z: -36.5, r: 0 }],
    hallEast: Array.from({ length: 5 }, (_, i) => ({ x: 10.6, y: P, z: -38.6 + i * 2.35, r: -Math.PI / 2 })),
    hallWest: Array.from({ length: 5 }, (_, i) => ({ x: -10.6, y: P, z: -38.6 + i * 2.35, r: Math.PI / 2 })),
    wingsEast: Array.from({ length: 29 }, (_, i) => ({ x: 20.6, y: 0.5, z: wingZ - 21.5 + (i * 43) / 28, r: -Math.PI / 2 })),
    wingsWest: Array.from({ length: 33 }, (_, i) => ({ x: -20.6, y: 0.5, z: wingZ - 21.5 + (i * 43) / 32, r: Math.PI / 2 })),
  };

  /** Height of the floor under (x, z): the platform, the steps, the side-hall floors. */
  function floorAt(x, z) {
    if (Math.abs(x) <= 14 && z >= -42 && z <= -26) return P;
    if (Math.abs(x) <= 8 && z > -26 && z <= -20) return P;
    if (Math.abs(x) <= 2.6 && z > -20 && z <= -17) return P * (1 - (z + 20) / 3);
    if (Math.abs(x) >= 16 && Math.abs(x) <= 23 && Math.abs(z - wingZ) <= wingLen / 2) return 0.5;
    return 0;
  }
  return { seats, colliders, floorAt, stele: { group: stele, slab }, bounds: { W, N, S } };
}

/** Layered 青绿山水 ranges on paper: steep rounded peaks, azurite summits, malachite slopes, ochre feet,
 *  short ink texture strokes (皴), and cloud bands drifting between the ranges. */
function mountains() {
  return canvasTexture(4096, 1024, (x, w, h) => {
    const r = seeded(23);
    const sky = x.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#d9cfb4"); sky.addColorStop(1, "#e6dcc2");
    x.fillStyle = sky; x.fillRect(0, 0, w, h);
    const ranges = [
      { base: 0.80, top: 0.40, n: 150, wid: [10, 26], alpha: 0.5 },     // far
      { base: 0.84, top: 0.50, n: 110, wid: [14, 36], alpha: 0.8 },     // middle
      { base: 0.88, top: 0.62, n: 70, wid: [20, 48], alpha: 1.0 },      // near
    ];
    ranges.forEach((R, ri) => {
      const peaks = Array.from({ length: R.n }, () => ({
        cx: r() * w, wid: R.wid[0] + r() * (R.wid[1] - R.wid[0]),
        hgt: (R.base - R.top) * h * (0.45 + r() * 0.55),
      }));
      // The skyline: the highest rounded peak at each x (wrapping at the seam).
      const sky = new Float32Array(w / 4 + 1);
      for (let i = 0; i <= w / 4; i++) {
        const px = i * 4; let best = 0;
        for (const p of peaks) for (const off of [-w, 0, w]) {
          const d = Math.abs(px - p.cx - off) / p.wid;
          if (d < 1) best = Math.max(best, p.hgt * (1 - d * d) ** 0.4);
        }
        sky[i] = R.base * h - best;
      }
      const g = x.createLinearGradient(0, R.top * h, 0, R.base * h + 30);
      g.addColorStop(0, "#2f5b8a"); g.addColorStop(0.45, "#3d8a6e"); g.addColorStop(1, "#b07a3a");
      x.globalAlpha = R.alpha; x.fillStyle = g; x.beginPath(); x.moveTo(0, h);
      sky.forEach((y, i) => x.lineTo(i * 4, y)); x.lineTo(w, h); x.closePath(); x.fill();
      x.globalAlpha = 1;
      x.strokeStyle = "rgba(42,36,32,.6)"; x.lineWidth = 2.5; x.beginPath();
      sky.forEach((y, i) => (i ? x.lineTo(i * 4, y) : x.moveTo(0, y))); x.stroke();
      // 皴: short ink strokes down the slopes.
      x.strokeStyle = "rgba(42,36,32,.28)"; x.lineWidth = 1.5;
      for (let k = 0; k < 900; k++) {
        const i = Math.floor(r() * sky.length), y0 = sky[i] + 6 + r() * (R.base * h - sky[i]) * 0.8;
        if (y0 > R.base * h) continue;
        x.beginPath(); x.moveTo(i * 4, y0); x.lineTo(i * 4 + (r() - 0.5) * 8, y0 + 8 + r() * 14); x.stroke();
      }
      // A cloud band in front of each range.
      for (let k = 0; k < 6; k++) {
        const cy = R.base * h - 10 - r() * 40, cx = r() * w, len = 260 + r() * 420;
        x.fillStyle = "rgba(236,228,206,.92)";
        x.beginPath(); x.ellipse(cx, cy, len, 18 + ri * 4, 0, 0, Math.PI * 2); x.fill();
        x.strokeStyle = "rgba(42,36,32,.3)"; x.lineWidth = 2;
        for (let i = 0; i < 4; i++) { x.beginPath(); x.arc(cx - len * 0.6 + i * len * 0.4, cy, 16, Math.PI, Math.PI * 1.9); x.stroke(); }
      }
    });
  });
}

/** A 古松 drawn the painters' way: crooked trunk, flat layered canopies. */
function pine(scene, x, z, side) {
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  const pts = [[0, 0], [0.4, 2], [-0.3, 4], [0.5, 6], [0, 7.6]].map(([dx, y]) => new THREE.Vector3(dx * side, y, 0));
  const trunk = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.32, 8), paint(0x5a4232));
  trunk.castShadow = true; g.add(trunk);
  for (const [dx, y, s] of [[-2.2, 3.6, 1.6], [2.4, 4.8, 1.8], [-1.6, 6.2, 1.5], [1.2, 7.4, 1.4], [0, 8.4, 1.2]]) {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(s * 1.4, s * 1.6, 0.6, 9), paint(0x3d5a44));
    pad.position.set(dx * side, y, 0); pad.scale.z = 0.8; pad.castShadow = true; g.add(pad);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, Math.abs(dx) + 0.2, 6), paint(0x5a4232));
    arm.position.set(dx * side / 2, y - 0.4, 0); arm.rotation.z = Math.PI / 2; g.add(arm);
  }
}
