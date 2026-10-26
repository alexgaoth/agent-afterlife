// 灯道: an avenue of stone lanterns (石灯笼) along the path, one per work day. The oldest day stands
// at the gate, the newest at the main-hall steps, so walking in is walking through the fleet's
// history. Each lantern's fire burns as bright as that day's fleet merit (shared/insights.js chronicle).
// All lanterns share one geometry: InstancedMesh, one draw call per part, a colour per fire.
import * as THREE from "three";
import { paint, PIGMENT } from "./statue.js";

const GATE_Z = 34, STEPS_Z = -15, SIDE_X = 2.9, MAX_DAYS = 60;

/** rows: chronicle(data).chart.rows. Returns the fire mesh (raycast: instanceId → day) and the days shown. */
export function buildAvenue(scene, rows, colliders) {
  const days = rows.slice(-MAX_DAYS);
  const n = days.length;
  if (!n) return { fires: null, days };
  const max = Math.max(...days.map((d) => d.merit), 1e-9);

  // One lantern, made of parts in its own coordinates (y up from the ground).
  const parts = [
    { geo: new THREE.BoxGeometry(0.62, 0.22, 0.62), y: 0.11, color: PIGMENT.stone },        // base
    { geo: new THREE.CylinderGeometry(0.11, 0.13, 0.95, 8), y: 0.7, color: PIGMENT.stone },  // post
    { geo: new THREE.BoxGeometry(0.5, 0.08, 0.5), y: 1.2, color: PIGMENT.stone },            // platform
    { geo: new THREE.ConeGeometry(0.46, 0.32, 4), y: 1.82, rotY: Math.PI / 4, color: PIGMENT.stone }, // roof
    { geo: new THREE.SphereGeometry(0.07, 8, 6), y: 2.02, color: PIGMENT.stone },            // finial
  ];
  // The firebox: four corner posts around a glowing core.
  const posts = new THREE.BoxGeometry(0.06, 0.4, 0.06);
  const core = new THREE.BoxGeometry(0.3, 0.32, 0.3);

  const place = (i) => {
    const t = n === 1 ? 0.5 : i / (n - 1);
    return { x: i % 2 ? SIDE_X : -SIDE_X, z: GATE_Z + (STEPS_Z - GATE_Z) * t };
  };
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();

  for (const part of parts) {
    const im = new THREE.InstancedMesh(part.geo, paint(part.color), n);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), part.rotY || 0);
    for (let i = 0; i < n; i++) { const at = place(i); im.setMatrixAt(i, m.compose(p.set(at.x, part.y, at.z), q, s)); }
    im.castShadow = im.receiveShadow = true; scene.add(im);
  }
  const postMesh = new THREE.InstancedMesh(posts, paint(PIGMENT.stone), n * 4);
  q.identity();
  for (let i = 0; i < n; i++) {
    const at = place(i);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b], k) => postMesh.setMatrixAt(i * 4 + k, m.compose(p.set(at.x + a * 0.17, 1.44, at.z + b * 0.17), q, s)));
    colliders.push([at.x - 0.4, at.x + 0.4, at.z - 0.4, at.z + 0.4]);
  }
  scene.add(postMesh);

  // The fire: dark when the fleet did nothing that day, amber at the busiest day.
  const fires = new THREE.InstancedMesh(core, new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
  const dark = new THREE.Color(0x3a2e24), bright = new THREE.Color(0xffc067), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const at = place(i);
    fires.setMatrixAt(i, m.compose(p.set(at.x, 1.44, at.z), q, s));
    fires.setColorAt(i, c.copy(dark).lerp(bright, Math.sqrt(days[i].merit / max)));   // sqrt: a dim day still shows a little light
  }
  fires.instanceColor.needsUpdate = true;
  fires.userData.days = days;
  scene.add(fires);
  return { fires, days };
}
