/**
 * 樂居批次候選清單:租賃地圖窗口(屋齡 1–10 年)內未歸戶的門牌,
 * 按「同街道前綴 × 完工年」聚成社區候選,依門牌數排序輸出。
 *
 * 用途:挑前面的大聚落去樂居查建案名 → 寫進 etl/coord-overrides.json
 * (格式 {city, district, name, address},address 用清單裡的 sample 門牌)
 * → pnpm etl:geocode-lots && pnpm etl:match-leju。
 * 大型純出租聚落(完工新、租約多、無買賣者)多半是整棟社宅/青年宅,
 * 樂居查不到就跳過,等社宅開放資料管線。
 *
 * 用法:tsx etl/report-unmatched-clusters.ts [--json tmp/leju-candidates.json]
 */
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { createDb } from "../db/client";
import { MIN_RENT_BUILDING_AGE, MAX_RENT_BUILDING_AGE } from "../src/lib/rent";

async function main() {
  const jsonIdx = process.argv.indexOf("--json");
  const outFile = jsonIdx >= 0
    ? process.argv[jsonIdx + 1] ?? "tmp/leju-candidates.json"
    : null;
  const { db, pool } = createDb();

  const { rows } = await db.execute(sql`
    WITH doors AS (
      SELECT DISTINCT r.addr_key, max(r.build_year) AS build_year,
             min(r.city) AS city, min(r.district) AS district, count(*) AS leases
      FROM rent_deals r
      JOIN geocode_cache g ON g.addr_key = r.addr_key AND g.precision = 'door'
      WHERE r.addr_key IS NOT NULL
        AND r.build_year BETWEEN extract(year FROM now()) - ${MAX_RENT_BUILDING_AGE}
                              AND extract(year FROM now()) - ${MIN_RENT_BUILDING_AGE}
        AND r.building_type ~ '^(住宅大樓|華廈|透天厝|公寓|套房)'
        AND r.monthly_rent BETWEEN 3000 AND 200000
        AND r.area_ping BETWEEN 3 AND 200
        AND r.rent_per_ping BETWEEN 150 AND 5000
      GROUP BY r.addr_key
    ),
    un AS (
      SELECT d.*, g.lat, g.lng,
             (SELECT count(*) FROM sale_deals s WHERE s.addr_key = d.addr_key) AS sales
      FROM doors d
      JOIN geocode_cache g ON g.addr_key = d.addr_key AND g.precision = 'door'
      LEFT JOIN building_community bc ON bc.addr_key = d.addr_key
      WHERE bc.addr_key IS NULL
    )
    SELECT city, district,
           regexp_replace(addr_key, '[０-９]+[之-]?[０-９]*號$', '') AS street,
           build_year,
           count(*)::int AS doors, sum(leases)::int AS leases, sum(sales)::int AS sales,
           avg(lat)::float AS lat, avg(lng)::float AS lng,
           (array_agg(addr_key ORDER BY leases DESC))[1:3] AS samples
    FROM un
    GROUP BY city, district, 3, build_year
    ORDER BY count(*) DESC
    LIMIT 200
  `);

  type Row = {
    city: string; district: string; street: string; build_year: number;
    doors: number; leases: number; sales: number; lat: number; lng: number; samples: string[];
  };
  const clusters = (rows as Row[]).filter((r) => r.doors >= 3);
  console.log(`[unmatched] 未歸戶聚落(≥3 門牌)共 ${clusters.length} 個;前 25:`);
  for (const r of clusters.slice(0, 25)) {
    // 買賣為 0 的新完工大聚落幾乎確定是整棟社宅/青年宅
    const tag = r.sales === 0 && r.build_year >= 2021 ? "〔疑似整棟社宅〕" : "";
    console.log(
      `  ${r.city}${r.district} ${r.street.replace(r.city, "").replace(r.district, "")}` +
      ` ${r.build_year}年完工・${r.doors} 門牌・${r.leases} 租約・${r.sales} 買賣${tag}` +
      `  例:${r.samples[0]?.replace(r.city, "").replace(r.district, "")}`);
  }
  if (outFile) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(clusters, null, 2));
    console.log(`[unmatched] 完整清單 ${clusters.length} 筆 → ${outFile}`);
  }
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
