// The gestures are timed in seconds at the default tour pace.
export const INSPECTION_SECONDS = 6.2;
export const INSPECTIONS = [
  { kind: "stele", after: 22.5, sample: "03a-inspect-stele", aim: [-4.98, 2.4, 18], id: "insight:lineage" },
  { kind: "general", after: 45, sample: "04a-inspect-general", zone: "wingsEast" },
  { kind: "pilgrim", after: 58.5, sample: "04b-inspect-pilgrim" },
  { kind: "main", after: 84, sample: "06a-inspect-main", zone: "main" },
];

const OPEN = .75, CLOSE = 5.45;
const smooth = (u) => {
  u = Math.max(0, Math.min(1, u));
  return u * u * (3 - 2 * u);
};
const mix = (a, b, u) => a + (b - a) * u;
const rad = Math.PI / 180;
const unwrap = (yaw, reference) => yaw + 360 * Math.round((reference - yaw) / 360);

export function inspectionSchedule(shot, start, end, fps) {
  const frameAt = (t) => Math.ceil((start + (end - start) * t / INSPECTION_SECONDS) * fps);
  return { ...shot, openFrame: frameAt(OPEN), sampleFrame: frameAt(2.85), closeFrame: frameAt(CLOSE) };
}

function aimAngles(frame, [x, y, z], eye) {
  const dx = x - frame.x, dz = z - frame.z;
  return {
    yaw: unwrap(Math.atan2(-dx, -dz) / rad, frame.yaw),
    pitch: Math.atan2(y - eye, Math.hypot(dx, dz)) / rad,
  };
}

/** Choose a real target on today's route. A missing target never becomes a substitute tablet. */
export function pickTarget(shot, frame, statues, panelCount, tablets = [], pilgrims = []) {
  if (shot.aim) return { aim: shot.aim, id: shot.id };
  if (shot.kind === "pilgrim") {
    // A living agent, still at work: the one that has earned the most among those within reach when the tablet rises.
    const near = pilgrims.filter((p) => Math.hypot(p.x - frame.x, p.z - frame.z) < 8);
    if (!near.length) throw new Error("No pilgrim within reach for the pilgrim inspection");
    const p = near.reduce((best, p) => (p.merit > best.merit ? p : best));
    return { aim: [p.x, p.y + 1.05 * p.scale, p.z], id: p.id };
  }
  if (shot.kind === "ancestor" && tablets.some((t) => t.panel < 5 && t.merit > 0)) {
    // The tablet on the back wall whose agent earned the most: a tablet that shows real work.
    const t = tablets.filter((x) => x.panel < 5).reduce((best, x) => (x.merit > best.merit ? x : best));
    return { aim: [t.x, t.y, t.z], id: t.id };
  }
  if (shot.kind === "ancestor") {
    if (!panelCount) throw new Error("The fleet has no ancestral panels");
    // First occupied cell on the back-wall panel nearest the centre aisle.
    // Match temple/world.js (panel placement) and temple/ancestral.js (grid).
    const panel = Math.min(2, panelCount - 1);
    const z = -20 + (panel - 2) * 2.25 + 1.95 * (0.5 - 0.5 / 6);
    const y = 1.15 + 3 * (1 - .17 - .83 * .5 / 9);
    return { aim: [-42.8, y, z] };
  }
  const candidates = statues.filter((s) => s.zone === shot.zone && (shot.kind !== "general" || s.role === "general"));
  if (!candidates.length) throw new Error(`No statue for the ${shot.kind} inspection`);
  // The closest general along the wing is in the pan's field of view.
  const s = candidates.reduce((best, s) => Math.abs(s.z - frame.z) < Math.abs(best.z - frame.z) ? s : best);
  return { aim: [s.x, s.y + 1.4, s.z], id: s.id };
}

export const PLATE_OPTS = {};

/** Aim at the thing and hold still while it is held up before you; then turn back to the route. */
export function inspectionPose(frame, elapsed, target, eye) {
  const { yaw, pitch } = aimAngles(frame, target.aim, eye);
  const acquire = smooth(elapsed / OPEN);
  const release = smooth((elapsed - 5.6) / .6);
  return {
    ...frame,
    yaw: mix(mix(frame.yaw, yaw, acquire), frame.yaw, release),
    pitch: mix(mix(frame.pitch, pitch, acquire), frame.pitch, release),
  };
}

/** How the held thing is turned in the hands while it is read: [yaw, pitch] in degrees, or null before and after. */
export function heldTilt(elapsed) {
  const from = OPEN + .55, to = CLOSE;
  if (elapsed < from || elapsed > to) return null;
  const u = (elapsed - from) / (to - from);
  return [16 * Math.sin(2 * Math.PI * u) * (1 - .35 * u), -5 * Math.sin(Math.PI * u)];
}
