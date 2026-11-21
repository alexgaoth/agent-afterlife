// 匾额: plaques under the eaves of the main hall. The middle bay carries the temple's name; the bays beside it
// carry the fleet's records, one each, in order of importance from the middle out. A plaque says the record in
// four characters; looking at it shows who holds it, since when, and who held it before.
import * as THREE from "three";

const HALL_FRONT_Z = -27.5 + 0.42;                 // just in front of the main hall's front columns
const BAY = 25 / 7;                                // the main hall: 25 m wide, 7 bays
const ORDER = [-1, 1, -2, 2, -3, 3];               // bays from the middle out, east first as in the seating

function board(text, { w, h, name }) {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = Math.round((1024 * h) / w);
  const g = c.getContext("2d"), W = c.width, H = c.height;
  // Gilt frame with a cinnabar inner rule, black lacquer field.
  g.fillStyle = "#b8913f"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#6e1d14"; g.fillRect(W * 0.03, H * 0.08, W * 0.94, H * 0.84);
  g.fillStyle = name ? "#1e2c3c" : "#17130f"; g.fillRect(W * 0.045, H * 0.12, W * 0.91, H * 0.76);
  g.strokeStyle = "rgba(232,200,126,.55)"; g.lineWidth = H * 0.012; g.strokeRect(W * 0.065, H * 0.16, W * 0.87, H * 0.68);
  // Characters read right to left, as old plaques do.
  const chars = [...text].reverse();
  const cell = (W * 0.84) / chars.length;
  g.font = `${Math.round(Math.min(cell * 0.92, H * 0.68))}px "Ma Shan Zheng", "Kaiti SC", "STKaiti", serif`;
  g.textAlign = "center"; g.textBaseline = "middle";
  chars.forEach((ch, i) => {
    const x = W * 0.08 + cell * (i + 0.5), y = H * 0.52;
    g.fillStyle = "rgba(0,0,0,.45)"; g.fillText(ch, x + H * 0.012, y + H * 0.012);
    g.fillStyle = "#f2d68c"; g.fillText(ch, x, y);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), [
    ...Array(4).fill(new THREE.MeshLambertMaterial({ color: 0x8a6a2c })),
    // The face is unlit: gilt characters read even in the shade under the eaves.
    new THREE.MeshBasicMaterial({ map: tex }), new THREE.MeshLambertMaterial({ color: 0x3a2a1c }),
  ]);
}

/** Hang the name plaque and one plaque per record. Returns { meshes } (the record plaques are pickable). */
export function buildPlaques(scene, records, { floor = 1.2, colH = 5.6 } = {}) {
  const y = floor + colH - 0.95;                   // under the lintel
  const hang = (mesh, x, big) => {
    mesh.position.set(x, y + (big ? 0.12 : 0), HALL_FRONT_Z);
    mesh.rotation.x = -0.16;                       // leaning out toward the visitor, as plaques hang
    scene.add(mesh);
  };
  const name = board("武成王庙", { w: 3.1, h: 1.15, name: true });
  name.userData.agentId = "plaque:name";
  hang(name, 0, true);
  const meshes = [name];
  records.slice(0, ORDER.length).forEach((r, i) => {
    const m = board(r.cn, { w: 2.75, h: 1.05 });
    m.userData.agentId = `record:${r.key}`;
    hang(m, ORDER[i] * BAY, false);
    meshes.push(m);
  });
  return { meshes };
}
