import test from "node:test";
import assert from "node:assert/strict";
import { getParkingInfo } from "../src/lib/deal-parking";

test("parking count is authoritative even when price and area are not split", () => {
  const parking = getParkingInfo({
    parking_count: 1,
    parking_type: "坡道平面",
    parking_price: 0,
    parking_area_ping: 0,
  });
  assert.equal(parking.included, true);
  assert.equal(parking.known, true);
  assert.equal(parking.count, 1);
});

test("zero parking and legacy unknown parking remain distinct", () => {
  const none = getParkingInfo({
    parking_count: 0,
    parking_type: null,
    parking_price: 0,
    parking_area_ping: 0,
  });
  const unknown = getParkingInfo({
    parking_count: null,
    parking_type: null,
    parking_price: 0,
    parking_area_ping: 0,
  });
  assert.deepEqual([none.included, none.known], [false, true]);
  assert.deepEqual([unknown.included, unknown.known], [false, false]);
});

test("legacy rows with a parking price still infer included parking", () => {
  const parking = getParkingInfo({
    parking_count: null,
    parking_type: null,
    parking_price: 240,
    parking_area_ping: 10.4,
  });
  assert.equal(parking.included, true);
  assert.equal(parking.known, false);
});
