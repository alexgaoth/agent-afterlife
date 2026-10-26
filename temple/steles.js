// 碑林: a forest of steles. Each insight about the fleet (shared/insights.js) is carved on its own
// stele, under a small pavilion (碑亭), in pairs along the path, the way temples kept their records.
import * as THREE from "three";
import { paint, PIGMENT } from "./statue.js";
import { box, hipRoof, roofTiles } from "./world.js";
import { drawInsight } from "./insight-art.js";

// Where each insight stands (x, z) and which way its face turns (toward the path).
const PLACES = {
  concentration: [-5.2, -6],
  chronicle: [-5.2, 6], longevity: [5.2, 6],
  lineage: [-5.2, 18], quality: [5.2, 18],
};
const STONE = 0x6f6d64;

function carving(ins) {
  const c = document.createElement("canvas"); c.width = 360; c.height = 800;
  const x = c.getContext("2d");
  x.fillStyle = "#6f6d64"; x.fillRect(0, 0, 360, 800);
  x.strokeStyle = "#57554d"; x.lineWidth = 7; x.strokeRect(16, 16, 328, 768);
  x.fillStyle = "#2a2622"; x.textAlign = "center";
  x.font = '96px "Ma Shan Zheng", "Kaiti SC", serif';                       // the title, carved large
  [...(ins.cn + "碑")].forEach((ch, i) => x.fillText(ch, 180, 130 + i * 98));
  drawInsight(x, ins, 34, 460, 292, 230, "stone");                           // the chart
  x.fillStyle = "#2a2622"; x.font = '24px "IM Fell English", Georgia, serif';
  x.fillText(ins.title, 180, 740, 300);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return new THREE.MeshBasicMaterial({ map: t });
}

/** Adds the steles to the scene. Returns the faces to look at (userData.agentId = "insight:<key>"). */
export function buildSteleForest(scene, list, colliders) {
  const faces = [];
  const tiles = roofTiles();
  for (const ins of list) {
    const at = PLACES[ins.key];
    if (!at) continue;
    const g = new THREE.Group();
    g.position.set(at[0], 0, at[1]); g.rotation.y = at[0] < 0 ? Math.PI / 2 : -Math.PI / 2;
    scene.add(g);
    box(g, [2.2, 0.6, 1.4], [0, 0.3, 0], PIGMENT.stone);                          // plinth (a 龟趺, simplified)
    const slab = box(g, [1.6, 3.6, 0.42], [0, 2.4, 0], STONE);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.42, 24, 1, false, 0, Math.PI), paint(STONE));
    head.rotation.set(Math.PI / 2, 0, Math.PI / 2, "ZYX"); head.position.y = 4.2; head.castShadow = true; g.add(head);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.44, 3.2), carving(ins));
    face.position.set(0, 2.4, 0.215); face.userData.agentId = "insight:" + ins.key; g.add(face);
    faces.push(face);
    // 碑亭: four columns and a small hip roof over the stele.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 4.8, 10), paint(0x8f2f22));
      col.position.set(sx * 1.45, 2.4, sz * 1.25); col.castShadow = true; g.add(col);
    }
    const roof = hipRoof(4.6, 4.2, 0.4, 1.7, 0.35, tiles); roof.position.y = 4.8; g.add(roof);
    colliders.push([at[0] - 1.6, at[0] + 1.6, at[1] - 1.6, at[1] + 1.6]);
    void slab;
  }
  return faces;
}
