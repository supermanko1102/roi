import assert from "node:assert/strict";
import test from "node:test";
import {
  PointGrid, cancelRate, deviation, devLabel, grossYield, recentPriceUsable, weightedMedian,
} from "../src/lib/metrics-core";
import { sortSummaries } from "../src/lib/map-view";
import type { ProjectSummary } from "../src/components/product-kit";

const peers = [
  { key: "a", price: 40, deals: 20 },
  { key: "b", price: 50, deals: 20 },
  { key: "c", price: 60, deals: 20 },
  { key: "self", price: 55, deals: 10 },
];

test("weighted median follows deal counts", () => {
  assert.equal(weightedMedian([{ value: 30, weight: 1 }, { value: 50, weight: 10 }]), 50);
  assert.equal(weightedMedian([]), null);
});

test("deviation compares against other projects only", () => {
  const d = deviation("self", 55, 10, peers);
  assert.deepEqual(d, { dev: 10, price: 50, projects: 3, deals: 60 });
});

test("deviation refuses thin or implausible comparisons", () => {
  assert.equal(deviation("self", 55, 2, peers), null, "own deals too few");
  assert.equal(deviation("self", 55, 10, peers.slice(0, 2)), null, "too few peers");
  assert.equal(deviation("self", 55, 10, peers.map((p) => ({ ...p, deals: 5 }))), null, "too few peer deals");
  assert.equal(deviation("self", 20, 10, peers), null, "gap too large to be the same product");
  assert.equal(deviation("self", null, 10, peers), null);
});

test("recent price sanity check", () => {
  assert.equal(recentPriceUsable(22.5, 107), false);
  assert.equal(recentPriceUsable(50, 45), true);
  assert.equal(recentPriceUsable(50, null), true);
  assert.equal(recentPriceUsable(null, 45), false);
});

test("gross yield is annual rent per ping over price per ping", () => {
  assert.equal(grossYield(800, 40), 2.4);
  assert.equal(grossYield(null, 40), null);
  assert.equal(grossYield(800, 0), null);
  assert.equal(grossYield(4000, 5), null, "implausibly high yield is dropped");
});

test("cancel rate needs enough deals", () => {
  assert.equal(cancelRate(8, 1), null);
  assert.equal(cancelRate(95, 5), 5);
});

test("dev label stays neutral inside the threshold", () => {
  assert.equal(devLabel(2.4), "差不多");
  assert.equal(devLabel(8.2), "貴 8%");
  assert.equal(devLabel(-12.6), "便宜 13%");
});

test("point grid finds points within radius", () => {
  const grid = new PointGrid([
    { lat: 25.0, lng: 121.3, id: "here" },
    { lat: 25.005, lng: 121.3, id: "550m" },
    { lat: 25.03, lng: 121.3, id: "3.3km" },
  ]);
  assert.deepEqual(grid.within(25.0, 121.3, 1000).map((p) => p.id).sort(), ["550m", "here"]);
  assert.equal(grid.within(25.0, 121.3, 4000).length, 3);
});

test("list sorting puts projects without the metric last", () => {
  const base: ProjectSummary = {
    key: "", name: "", city: "桃園市", district: "中壢區", lng: 121, lat: 25, price: 40, total: 1200, area: 30,
    deals: 10, cancels: 0, stationM: null, recentN: 0, lastDeal: null, dev: null, devBase: null,
    yieldPct: null, yieldSrc: null, cancelRate: null,
  };
  const list: ProjectSummary[] = [
    { ...base, key: "a", name: "甲", dev: 5, yieldPct: 2, lastDeal: "2026-01-01" },
    { ...base, key: "b", name: "乙" },
    { ...base, key: "c", name: "丙", dev: -8, yieldPct: 3, lastDeal: "2026-05-01" },
  ];
  assert.deepEqual(sortSummaries(list, "cheap").map((p) => p.key), ["c", "a", "b"]);
  assert.deepEqual(sortSummaries(list, "yield").map((p) => p.key), ["c", "a", "b"]);
  assert.deepEqual(sortSummaries(list, "recent").map((p) => p.key), ["c", "a", "b"]);
});
