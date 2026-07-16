/**
 * 生活圈租金行情:把租賃件歸到生活圈,算圈級市場租金中位(元/坪/月,排除社宅)
 *
 * 歸圈兩段式,零外部 API:
 *   1. 門牌直配:租賃地址去樓層 → geocode_cache 已有座標(與買賣門牌重疊約 38%)→ 點在圈內
 *   2. 街道多數決:用已定位門牌統計「區|街(|巷)→生活圈」(得票 ≥60% 且 n≥3 才採用),
 *      沒座標的租賃件按街道歸圈
 * 篩選口徑與 compute-stats 一致:住宅類、屋齡 ≤8 年(或未知)。
 * 寫入 zone_stats(整批重建,可重複執行)。跑一次約數秒。
 */
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { createDb, zone_stats } from "../db/client";

const ZONES = path.join(import.meta.dirname, "..", "data", "taoyuan-zones.geojson");
const MAX_BUILDING_AGE = 8;
const RESIDENTIAL = /^(住宅大樓|華廈|透天厝|公寓|套房)/;
const VOTE_SHARE = 0.6, VOTE_MIN = 3;

type Ring = [number, number][];
function inRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
function makeContains(geom: any) {
  const polys: Ring[][] = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  let w = 180, e = -180, s = 90, n = -90;
  for (const rings of polys) for (const [x, y] of rings[0]) {
    if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
  }
  return (lng: number, lat: number) => {
    if (lng < w || lng > e || lat < s || lat > n) return false;
    for (const rings of polys) {
      if (!inRing(lng, lat, rings[0])) continue;
      if (!rings.slice(1).some((h) => inRing(lng, lat, h))) return true;
    }
    return false;
  };
}

// 「桃園市中壢區環北路３９８號」→ 區|街(段) 與 區|街(段)|巷(門牌是全形數字)
function streetKeys(addr: string): { street: string | null; lane: string | null } {
  const m = addr.match(/^桃園市([^區]+區)(.+?(?:路|街|大道)(?:[一二三四五六七八九十]段)?)/);
  if (!m) return { street: null, lane: null };
  const lane = addr.match(/([0-9０-９]+巷)/);
  return { street: `${m[1]}|${m[2]}`, lane: lane ? `${m[1]}|${m[2]}|${lane[1]}` : null };
}
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function main() {
  const { db, pool } = createDb();
  const zones = JSON.parse(fs.readFileSync(ZONES, "utf-8")).features
    .map((f: any) => ({ name: f.properties.name as string, contains: makeContains(f.geometry) }));
  const zoneOf = (lng: number, lat: number) =>
    zones.find((z: any) => z.contains(lng, lat))?.name ?? null;

  // 已定位門牌 → 所在圈;同時累積街道得票
  const { rows: geos } = await db.execute(sql`
    SELECT addr_key, lng, lat FROM geocode_cache
    WHERE precision = 'door' AND addr_key LIKE '桃園市%'`);
  const addrZone = new Map<string, string>();
  const votes = new Map<string, Map<string, number>>();
  for (const g of geos as { addr_key: string; lng: number; lat: number }[]) {
    const z = zoneOf(+g.lng, +g.lat);
    if (!z) continue;
    addrZone.set(g.addr_key, z);
    const { street, lane } = streetKeys(g.addr_key);
    for (const k of [street, lane]) {
      if (!k) continue;
      const v = votes.get(k) ?? votes.set(k, new Map()).get(k)!;
      v.set(z, (v.get(z) ?? 0) + 1);
    }
  }
  const majority = new Map<string, string>();
  for (const [k, v] of votes) {
    const total = [...v.values()].reduce((a, b) => a + b, 0);
    const [top, n] = [...v.entries()].sort((a, b) => b[1] - a[1])[0];
    if (total >= VOTE_MIN && n / total >= VOTE_SHARE) majority.set(k, top);
  }

  // 租賃件歸圈(口徑同 compute-stats:住宅、屋齡帶內、排除社宅)
  const { rows: rents } = await db.execute(sql`
    SELECT addr_key, rent_per_ping, is_social, building_type, build_year FROM rent_deals
    WHERE rent_per_ping > 0 AND addr_key IS NOT NULL
      AND (build_year IS NULL OR build_year >= extract(year FROM now()) - ${MAX_BUILDING_AGE})`);
  const byZone = new Map<string, number[]>();
  let hitDoor = 0, hitStreet = 0, missed = 0;
  for (const r of rents as any[]) {
    if (r.building_type && !RESIDENTIAL.test(r.building_type)) continue;
    let z = addrZone.get(r.addr_key);
    if (z) hitDoor++;
    else {
      const { street, lane } = streetKeys(r.addr_key);
      z = (lane && majority.get(lane)) || (street && majority.get(street)) || undefined;
      if (z) hitStreet++; else { missed++; continue; }
    }
    if (r.is_social) continue; // 圈級只算市場件(社宅租金非行情)
    (byZone.get(z) ?? byZone.set(z, []).get(z)!).push(+r.rent_per_ping);
  }

  await db.delete(zone_stats);
  const out = [...byZone.entries()].map(([zone, xs]) => ({
    zone, median_rent_ping_market: Math.round(median(xs)), rent_samples_market: xs.length,
  }));
  if (out.length) await db.insert(zone_stats).values(out);

  console.log(`[zone-rents] 歸圈:門牌直配 ${hitDoor}、街道多數決 ${hitStreet}、圈外/未知 ${missed}`);
  for (const o of out.sort((a, b) => b.rent_samples_market - a.rent_samples_market))
    console.log(`  ${o.zone}: ${o.median_rent_ping_market} 元/坪(n=${o.rent_samples_market})`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
