// 香客: living agents walk the courtyard as pilgrims among the enshrined. When a session ends, its agent
// stops walking and takes a seat (or a grave). Each pilgrim keeps to one closed route and now and then
// slows almost to a stop, as if reading a stele. All pilgrims are two instanced meshes: robes, and heads
// with hats; looking at one shows its name, as for a statue.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { paint, ramp } from "./statue.js";

// Closed routes (x, z) through open ground: the paved path between the lantern rows, and the east and west
// courts between the steles and the side halls.
const ROUTES = [
  [[1.1, 31], [1.1, -11], [-1.1, -11], [-1.1, 31]],
  [[10, 30], [12.6, 15], [10.4, 1], [12.6, -10], [8.4, -12], [8.2, 3], [9.2, 22]],
  [[-10, 30], [-12.6, 15], [-10.4, 1], [-12.6, -10], [-8.4, -12], [-8.2, 3], [-9.2, 22]],
];
// Undyed hemp, faded indigo, slate: pale lay clothes, quieter than the statues' mineral pigments.
const CLOTH = [0xa7b0ba, 0xc4b392, 0x9aa894, 0xb3a4b6, 0xd0bf9c, 0x8e9fb8, 0xc8b89a];
const SKIN = new THREE.Color(0xd2a283), HAT = new THREE.Color(0x221e1a);

function figure() {
  const body = new THREE.LatheGeometry(
    [[0.001, 0], [0.33, 0], [0.3, 0.35], [0.22, 0.9], [0.24, 1.2], [0.2, 1.34], [0.08, 1.42], [0.001, 1.43]].map(([r, y]) => new THREE.Vector2(r, y)), 12);
  // Hands clasped inside wide sleeves, held before the chest.
  const sleeves = new THREE.CapsuleGeometry(0.085, 0.3, 4, 10).rotateZ(Math.PI / 2).translate(0, 1.0, 0.17);
  const robe = mergeGeometries([body.toNonIndexed(), sleeves.toNonIndexed()]);
  const head = new THREE.SphereGeometry(0.13, 12, 9).translate(0, 1.56, 0);
  const hat = new THREE.CylinderGeometry(0.1, 0.12, 0.14, 10).translate(0, 1.7, 0);
  const tint = (g, c) => { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) c.toArray(a, i * 3); g.setAttribute("color", new THREE.BufferAttribute(a, 3)); return g; };
  return { robe, top: mergeGeometries([tint(head.toNonIndexed(), SKIN), tint(hat.toNonIndexed(), HAT)]) };
}

/** Pilgrims for the living agents (at most `max`, the newest). Returns null, or { meshes, ids, update(seconds) }. */
export function buildPilgrims(scene, alive, { floorAt = () => 0, max = 60 } = {}) {
  const who = alive.slice(-max);
  if (!who.length) return null;
  const curves = ROUTES.map((r) => new THREE.CatmullRomCurve3(r.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, "centripetal"));
  const lengths = curves.map((c) => c.getLength());
  const geo = figure();
  const robes = new THREE.InstancedMesh(geo.robe, paint(0xffffff), who.length);
  const tops = new THREE.InstancedMesh(geo.top, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: ramp }), who.length);
  const walkers = who.map((a, i) => {
    const h = hash(a.id);
    robes.setColorAt(i, new THREE.Color(CLOTH[h % CLOTH.length]));
    const route = i % 3;
    const onRoute = Math.floor(i / 3), sharing = Math.ceil((who.length - route) / 3);
    return { route, start: (onRoute / Math.max(1, sharing)) * lengths[route], speed: 0.45 + ((h >>> 4) % 100) / 300,
             scale: 0.94 + ((h >>> 11) % 100) / 900, beat: (h >>> 17) % 628 / 100, dir: (h >>> 25) & 1 ? 1 : -1 };
  });
  const ids = who.map((a) => a.id);
  // Instances move every frame: one sphere around the whole courtyard keeps them pickable and never culled.
  for (const m of [robes, tops]) {
    m.castShadow = m.receiveShadow = true;
    m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 10), 40);
    m.frustumCulled = false;
    m.userData.ids = ids;
    scene.add(m);
  }
  const p = new THREE.Vector3(), tan = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), m4 = new THREE.Matrix4();
  function update(t) {
    walkers.forEach((w, i) => {
      // Distance walked: speed × (t + a slow swell), so the pace falls to a tenth now and then: a pause.
      const d = w.start + w.dir * w.speed * (t + (0.9 * Math.sin(0.35 * t + w.beat)) / 0.35);
      const u = (((d / lengths[w.route]) % 1) + 1) % 1;
      curves[w.route].getPointAt(u, p);
      curves[w.route].getTangentAt(u, tan).multiplyScalar(w.dir);
      const pace = 1 + 0.9 * Math.cos(0.35 * t + w.beat);                 // 0.1 .. 1.9
      p.y = floorAt(p.x, p.z) + Math.abs(Math.sin(t * 5.5 + w.beat)) * 0.025 * Math.min(1, pace);
      q.setFromAxisAngle(up, Math.atan2(tan.x, tan.z));
      m4.compose(p, q, s.setScalar(w.scale));
      robes.setMatrixAt(i, m4); tops.setMatrixAt(i, m4);
    });
    robes.instanceMatrix.needsUpdate = tops.instanceMatrix.needsUpdate = true;
  }
  update(0);
  if (robes.instanceColor) robes.instanceColor.needsUpdate = true;
  return { meshes: [robes, tops], ids, update };
}

function hash(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0; return h; }
