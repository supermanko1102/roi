import assert from "node:assert/strict";
import test from "node:test";
import { distanceToGeomM } from "../src/lib/geo";

const square = {
  type: "Polygon",
  coordinates: [[
    [121.30, 25.01],
    [121.31, 25.01],
    [121.31, 25.02],
    [121.30, 25.02],
    [121.30, 25.01],
  ]],
};

test("distanceToGeomM returns zero inside a zone", () => {
  assert.equal(distanceToGeomM(25.015, 121.305, square), 0);
});

test("distanceToGeomM measures from the polygon edge", () => {
  const distance = distanceToGeomM(25.015, 121.299, square);
  assert.ok(distance > 95 && distance < 110, `unexpected distance: ${distance}`);
});
