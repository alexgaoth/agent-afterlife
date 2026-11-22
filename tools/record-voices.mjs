import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const RATE = 48_000;
// Lift the quiet voice pack above the ducked bed. The final limiter handles
// peaks when two voices overlap.
const VOICE_LEVEL = 5.4;
const DUCK_DISTANCE = 8;
const decode = promisify(execFile);

/** The listener follows the camera. Negative pan is left. Gain excludes the voice bus level. */
export function spatialVoice({ x, y, z, yaw }, speaker) {
  const dx = speaker.x - x, dz = speaker.z - z;
  const horizontal = Math.hypot(dx, dz);
  const distance = Math.hypot(horizontal, speaker.y - y);
  const angle = yaw * Math.PI / 180;
  const pan = horizontal ? .7 * (dx * Math.cos(angle) - dz * Math.sin(angle)) / horizontal : 0;
  const gain = 3 / (3 + 1.1 * Math.max(0, distance - 3));
  return { distance, pan, gain };
}

export function planVoices(log, cameraAt) {
  return log.map((line) => ({
    ...line,
    clips: line.clips.map((clip) => {
      const start = line.t + clip.at;
      return { ...clip, start, ...spatialVoice(cameraAt(start), line.at), level: VOICE_LEVEL };
    }),
  }));
}

// Duck across the gap between a name and its line. Join overlapping intervals
// so several nearby speakers never deepen the duck.
export function duckIntervals(log) {
  const spans = log.flatMap(({ clips }) => {
    if (!clips.some((clip) => clip.distance <= DUCK_DISTANCE)) return [];
    return [[Math.min(...clips.map((c) => c.start)), Math.max(...clips.map((c) => c.start + c.dur))]];
  }).sort(([a], [b]) => a - b);
  const merged = [];
  for (const [start, end] of spans) {
    const prev = merged.at(-1);
    if (prev && start <= prev[1]) prev[1] = Math.max(prev[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

function wavBuffer(frames) {
  const wav = Buffer.alloc(44 + frames * 8);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(3, 20); // IEEE float
  wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(RATE, 24);
  wav.writeUInt32LE(RATE * 8, 28);
  wav.writeUInt16LE(8, 32);
  wav.writeUInt16LE(32, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  return wav;
}

/** Decode each unique clip once. Sum directly into a stereo float WAV, for the final limiter. */
export async function mixVoices(log, seconds, out, signal) {
  const frames = Math.round(seconds * RATE), wav = wavBuffer(frames);
  const clips = new Map();
  for (const { clips: line } of log) for (const clip of line) {
    const { src, start, gain, pan, level } = clip;
    const offset = Math.round(start * RATE);
    if (offset >= frames) continue;
    if (!clips.has(src)) {
      // Accept only files from the voice pack, not paths or URLs from the data feed.
      if (!/^(?:lines|names)\/[\w-]+\/[\w-]+\.mp3$/.test(src)) throw new Error(`Invalid voice clip: ${src}`);
      const file = fileURLToPath(new URL(`../temple/voices/${src}`, import.meta.url));
      const { stdout } = await decode("ffmpeg", [
        "-v", "error", "-xerror", "-i", file, "-map", "0:a:0", "-ac", "1", "-ar", String(RATE), "-f", "f32le", "pipe:1",
      ], { encoding: "buffer", maxBuffer: 4 * 1024 * 1024, signal });
      clips.set(src, stdout);
    }
    const mono = clips.get(src);
    const count = Math.min(mono.length / 4, frames - offset);
    const angle = (pan + 1) * Math.PI / 4;
    const left = gain * level * Math.cos(angle), right = gain * level * Math.sin(angle);
    for (let i = 0; i < count; i++) {
      const s = mono.readFloatLE(i * 4), at = 44 + (offset + i) * 8;
      wav.writeFloatLE(wav.readFloatLE(at) + s * left, at);
      wav.writeFloatLE(wav.readFloatLE(at + 4) + s * right, at + 4);
    }
  }
  await writeFile(out, wav, { signal });
}
