import test from "node:test";
import assert from "node:assert/strict";
import { makeTour } from "../tools/record-tour.mjs";
import { duckIntervals, planVoices, spatialVoice } from "../tools/record-voices.mjs";

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const duration = 154;

test("terrace replay holds its view for eight seconds and advances the fleet over six", () => {
  const tour = makeTour(duration, Array(52));
  const replay = Array.from({ length: duration * 30 }, (_, i) => tour.frame(i / 30))
    .filter(({ history }) => history !== null);
  assert.equal(replay.length, 240);
  assert.deepEqual(new Set(replay.map(({ x, z, yaw, pitch, hour }) => JSON.stringify([x, z, yaw, pitch, hour]))),
    new Set(["[0,-21.5,-180,-6,10.5]"]));
  assert.equal(replay[0].history, 0);
  const replayStart = 77.3 * 118 / 150.8 + 3 + 6 + 4;
  near(tour.frame(replayStart + 1).history, 0);
  near(tour.frame(replayStart + 4).history, .5);
  near(tour.frame(replayStart + 7).history, 1);
  assert.equal(replay.at(-1).history, 1);
  assert.equal(new Set(replay.map(({ history }) => Math.floor(history * 51))).size, 52);
  assert.equal(tour.frame(replay.at(-1).t + 1 / 30).history, null);
});

test("dusk and the fade hold the closing view after the original walk", () => {
  const tour = makeTour(duration, Array(52));
  near(tour.duskStart, 143);
  assert.equal(tour.frame(142.9).hour, 10.5);
  near(tour.frame(143.01).hour, 16.503);
  near(tour.frame(148).hour, 18);
  near(tour.frame(153).hour, 19.5);
  assert.equal(tour.frame(duration).hour, 19.5);
  for (const time of [143, 148, duration]) {
    const { x, z } = tour.frame(time);
    assert.deepEqual([x, z], [-30, -20]);
  }
  assert.equal(tour.samples.size, 10);
});

test("voice gain has a three-metre reference and pan follows the listener", () => {
  const camera = { x: 0, y: 1.6, z: 0, yaw: 0 };
  assert.equal(spatialVoice(camera, { x: 0, y: 1.6, z: -2 }).gain, 1);
  const east = spatialVoice(camera, { x: 6, y: 1.6, z: 0 });
  near(east.pan, .7);
  near(east.gain, 3 / (3 + 1.1 * 3));
  near(spatialVoice({ ...camera, yaw: 180 }, { x: 6, y: 1.6, z: 0 }).pan, -.7);
  near(spatialVoice(camera, { x: 0, y: 5.6, z: -3 }).distance, 5);
});

test("each clip uses its own start pose and nearby lines duck as one interval", () => {
  const clip = (at, dur) => ({ src: "lines/scholar/self-0.mp3", at, dur });
  const nearSpeaker = { x: 1, y: 1, z: 0 }, farSpeaker = { x: 30, y: 1, z: 0 };
  const log = planVoices([
    { t: 2, at: nearSpeaker, clips: [clip(0, .5), clip(.75, 1.25)] },
    { t: 3.5, at: nearSpeaker, clips: [clip(0, 1)] },
    { t: 10, at: farSpeaker, clips: [clip(0, 1)] },
  ], (t) => ({ x: 0, y: 1, z: 0, yaw: t < 2.5 ? 0 : 180 }));
  assert.deepEqual(log[0].clips.map(({ start }) => start), [2, 2.75]);
  near(log[0].clips[0].pan, .7);
  near(log[0].clips[1].pan, -.7);
  assert.deepEqual(duckIntervals(log), [[2, 4.5]]);
});
