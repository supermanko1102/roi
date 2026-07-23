import test from "node:test";
import assert from "node:assert/strict";
import type { EtlRunMetrics } from "../db/schema";
import { parseBbox, parseCity } from "../src/lib/api-params";
import { evaluateQuality } from "../etl/quality-check";
import { assertReplacementSafe } from "../etl/replacement-safety";

const metrics = (count: number): EtlRunMetrics => ({
  tables: Object.fromEntries([
    "sale_deals", "presale_deals", "rent_deals", "projects", "buildings",
    "communities", "district_band_stats", "zone_band_stats",
  ].map((name) => [name, count])),
  latest_deals: { sale: "2026-07-01", presale: "2026-07-01", rent: "2026-07-01" },
  geocode: { total: 100, precise: 60, project_precise: 20 },
  integrity: { orphan_case_links: 0, orphan_building_cases: 0, orphan_entity_links: 0 },
  warnings: [],
});

test("bbox validation rejects malformed, reversed, and oversized queries", () => {
  assert.deepEqual(parseBbox("121,24,122,25").value, [121, 24, 122, 25]);
  assert.equal(parseBbox("122,24,121,25").error, "bad bbox range");
  assert.equal(parseBbox("120,20,124,25").error, "bbox too large");
  assert.equal(parseBbox("x,24,122,25").error, "bad bbox");
  assert.equal(parseCity("台北市").value, "臺北市");
  assert.equal(parseCity("不存在市").error, "bad city");
});

test("quality gate rejects empty or sharply regressed data", () => {
  assert.deepEqual(evaluateQuality(metrics(100), null).errors, []);
  const current = metrics(60);
  current.latest_deals.sale = "2026-06-01";
  const result = evaluateQuality(current, metrics(100));
  assert.ok(result.errors.some((error) => error.includes("跌幅超過 30%")));
  assert.ok(result.errors.some((error) => error.includes("倒退")));
});

test("replacement guard runs before destructive publishes", () => {
  assert.doesNotThrow(() => assertReplacementSafe("test", 100, 80));
  assert.throws(() => assertReplacementSafe("test", 100, 60), /跌幅超過 30%/);
  assert.throws(() => assertReplacementSafe("test", 0, 0), /新資料為 0 筆/);
  assert.doesNotThrow(() => assertReplacementSafe("test", 100, 0, true));
});
