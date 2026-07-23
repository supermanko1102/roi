/** 將點位落入生活圈並預算屋齡帶統計，供 /api/zones 直接讀取。 */
import fs from "node:fs";
import path from "node:path";
import { db, pool, zone_band_stats } from "../src/lib/db";
import { loadUnifiedPoints, type UnifiedPoint } from "../src/lib/points";
import { AGE_BANDS } from "../src/lib/age";
import { makeContains } from "../src/lib/geo";
import { CITY_NAMES } from "../src/lib/cities";
import { sql } from "drizzle-orm";
import { assertReplacementSafe } from "./replacement-safety";

const MIN_SAMPLES = 5;

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return +(sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2).toFixed(1);
};

function stats(points: UnifiedPoint[]) {
  const samples = points.reduce((sum, point) => sum + point.deal_count, 0);
  const price = samples >= MIN_SAMPLES
    ? median(points.map((point) => point.price).filter((value): value is number => value != null))
    : null;
  return { samples, median_unit_price: price };
}

async function main() {
  const allowEmpty = process.argv.includes("--allow-empty");
  const geo = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "zones.geojson"), "utf-8"));
  const points = await loadUnifiedPoints();
  const rows: (typeof zone_band_stats.$inferInsert)[] = [];

  for (const feature of geo.features as any[]) {
    const city = String(feature.properties.city ?? "");
    const zone = String(feature.properties.name ?? "");
    if (!CITY_NAMES.includes(city) || !zone) continue;
    const contains = makeContains(feature.geometry);
    const inside = points.filter((point) => contains(point.lng, point.lat));
    rows.push({ city, zone, band: "all", ...stats(inside) });
    for (const band of AGE_BANDS)
      rows.push({ city, zone, band, ...stats(inside.filter((point) => point.band === band)) });
  }

  const [{ n: previousPopulated }] = (await db.execute(sql`
    SELECT count(*)::int AS n FROM zone_band_stats WHERE samples > 0
  `)).rows as { n: number }[];
  const nextPopulated = rows.filter((row) => row.samples > 0).length;
  assertReplacementSafe("[zone-bands] 有樣本帶", previousPopulated, nextPopulated, allowEmpty);
  await db.transaction(async (tx) => {
    await tx.delete(zone_band_stats);
    if (rows.length) await tx.insert(zone_band_stats).values(rows);
  });
  console.log(`[zone-bands] ${rows.length} 筆`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
