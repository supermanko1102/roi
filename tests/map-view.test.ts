import assert from "node:assert/strict";
import test from "node:test";
import { filterPoints } from "../src/lib/map-view";
import type { PresaleFC } from "../src/lib/map-types";

const householdValues = [100, 101, 150, 260, 261, 500, 501, null] as const;
const points: PresaleFC = {
  type: "FeatureCollection",
  features: householdValues.map((households, index) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [121.3 + index * 0.001, 25] },
    properties: {
      kind: "presale",
      band: "presale",
      city: "桃園市",
      district: "桃園區",
      price: 50,
      deal_count: 3,
      median_total: 1_500,
      name: households == null ? "戶數未知" : `${households}戶`,
      ...(households == null ? {} : { households }),
    },
  })),
};

const namesFor = (householdMin: number | null, householdMax: number | null) => filterPoints(points, {
  totalBand: "all",
  householdMin,
  householdMax,
  query: "",
  nearMetro: false,
  nearIC: false,
})!.features.map((feature) => feature.properties.name);

test("household filters accept arbitrary inclusive ranges", () => {
  assert.deepEqual(namesFor(120, 260), ["150戶", "260戶"]);
  assert.deepEqual(namesFor(null, 100), ["100戶"]);
  assert.deepEqual(namesFor(501, null), ["501戶"]);
});

test("unknown household counts remain visible only when the filter is unlimited", () => {
  assert.equal(namesFor(null, null).includes("戶數未知"), true);
  assert.equal(namesFor(null, 100).includes("戶數未知"), false);
});
