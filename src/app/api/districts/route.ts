import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const MIN_SAMPLES = 5; // 樣本不足時單價給 null,前端顯示「資料不足」
const RESIDENTIAL = "^(住宅大樓|華廈|透天厝|公寓|套房)";

// 區界 GeoJSON(靜態)+ 屋齡帶中位單價(即時 SQL 聚合,萬/坪、扣車位)
// 帶:presale(預售)/ 0_5 / 5_10 / 10_20 / 20p / all(全部,含屋齡不明)
export async function GET() {
  const geoPath = path.join(process.cwd(), "data", "taoyuan-districts.geojson");
  const geo = JSON.parse(fs.readFileSync(geoPath, "utf-8"));

  const { rows } = await db.execute(sql`
    WITH deals AS (
      SELECT district, unit_price,
             CASE WHEN build_year IS NULL THEN 'unknown'
                  WHEN extract(year FROM now()) - build_year < 5  THEN '0_5'
                  WHEN extract(year FROM now()) - build_year < 10 THEN '5_10'
                  WHEN extract(year FROM now()) - build_year < 20 THEN '10_20'
                  ELSE '20p' END AS band
      FROM sale_deals
      WHERE building_type ~ ${RESIDENTIAL} AND unit_price > 0
        AND raw_season IS DISTINCT FROM 'demo'
      UNION ALL
      SELECT district, unit_price, 'presale' FROM presale_deals WHERE unit_price > 0
    )
    SELECT district, coalesce(band, 'all') AS band,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY unit_price) AS mup,
           count(*)::int AS n
    FROM deals
    GROUP BY GROUPING SETS ((district, band), (district))
  `) as unknown as { rows: { district: string; band: string; mup: number | null; n: number }[] };

  const byDistrict = new Map<string, Record<string, number | null>>();
  for (const r of rows) {
    const d = byDistrict.get(r.district) ?? {};
    d[`price_${r.band}`] = r.n >= MIN_SAMPLES && r.mup != null ? +(+r.mup).toFixed(1) : null;
    d[`n_${r.band}`] = r.n;
    byDistrict.set(r.district, d);
  }

  for (const f of geo.features) {
    const d = byDistrict.get(f.properties.name) ?? {};
    f.properties = {
      name: f.properties.name,
      price_all: d.price_all ?? null, n_all: d.n_all ?? 0,
      price_presale: d.price_presale ?? null, n_presale: d.n_presale ?? 0,
      price_0_5: d.price_0_5 ?? null, n_0_5: d.n_0_5 ?? 0,
      price_5_10: d.price_5_10 ?? null, n_5_10: d.n_5_10 ?? 0,
      price_10_20: d.price_10_20 ?? null, n_10_20: d.n_10_20 ?? 0,
      price_20p: d.price_20p ?? null, n_20p: d.n_20p ?? 0,
    };
  }
  return NextResponse.json(geo);
}
