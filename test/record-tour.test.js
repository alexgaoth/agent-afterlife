import test from "node:test";
import assert from "node:assert/strict";
import { makeTour } from "../tools/record-tour.mjs";

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test("terrace replay holds its view for eight seconds and advances the fleet over six", () => {
  const tour = makeTour(148, Array(52));
  const replay = Array.from({ length: 148 * 30 }, (_, i) => tour.frame(i / 30))
    .filter(({ history }) => history !== null);
  assert.equal(replay.length, 240);
  assert.deepEqual(new Set(replay.map(({ x, z, yaw, pitch, hour }) => JSON.stringify([x, z, yaw, pitch, hour]))),
    new Set(["[0,-21.5,-180,-6,10.5]"]));
  assert.equal(replay[0].history, 0);
  const replayStart = 77.3 * 118 / 150.8 + 3 + 4;
  near(tour.frame(replayStart + 1).history, 0);
  near(tour.frame(replayStart + 4).history, .5);
  near(tour.frame(replayStart + 7).history, 1);
  assert.equal(replay.at(-1).history, 1);
  assert.equal(new Set(replay.map(({ history }) => Math.floor(history * 51))).size, 52);
  assert.equal(tour.frame(replay.at(-1).t + 1 / 30).history, null);
});

test("dusk and the fade hold the closing view after the original walk", () => {
  const tour = makeTour(148, Array(52));
  near(tour.duskStart, 137);
  assert.equal(tour.frame(136.9).hour, 10.5);
  near(tour.frame(137.01).hour, 16.503);
  near(tour.frame(142).hour, 18);
  near(tour.frame(147).hour, 19.5);
  assert.equal(tour.frame(148).hour, 19.5);
  for (const time of [137, 142, 148]) {
    const { x, z } = tour.frame(time);
    assert.deepEqual([x, z], [-30, -20]);
  }
  assert.equal(tour.samples.size, 10);
});
