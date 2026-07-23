import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { db, district_band_stats } from "@/lib/db";
import { CITY_NAMES } from "@/lib/cities";
import { DETAIL_CACHE_HEADERS } from "@/lib/api-params";

export const dynamic = "force-dynamic";

const MIN_SAMPLES = 5; // 樣本不足時單價給 null,前端顯示「資料不足」

// 區界 GeoJSON(靜態,含北北桃三市;依 CITIES 過濾=上線開關)
// + 屋齡帶中位單價(ETL 預算,萬/坪、扣車位)
// 帶:presale(預售)/ 0_5 / 5_10 / 10_20 / 20p / all(全部,含屋齡不明)
export async function GET() {
  const geoPath = path.join(process.cwd(), "data", "districts.geojson");
  const geo = JSON.parse(fs.readFileSync(geoPath, "utf-8"));
  geo.features = geo.features.filter((f: any) => CITY_NAMES.includes(f.properties.city));

  const rows = await db.select().from(district_band_stats);

  const byDistrict = new Map<string, Record<string, number | null>>();
  for (const r of rows) {
    if (r.city == null || r.district == null) continue;
    const key = `${r.city}|${r.district}`;
    const d = byDistrict.get(key) ?? {};
    d[`price_${r.band}`] = r.samples >= MIN_SAMPLES && r.median_unit_price != null
      ? +r.median_unit_price.toFixed(1) : null;
    d[`n_${r.band}`] = r.samples;
    byDistrict.set(key, d);
  }

  for (const f of geo.features) {
    const d = byDistrict.get(`${f.properties.city}|${f.properties.name}`) ?? {};
    f.properties = {
      city: f.properties.city,
      name: f.properties.name,
      price_all: d.price_all ?? null, n_all: d.n_all ?? 0,
      price_presale: d.price_presale ?? null, n_presale: d.n_presale ?? 0,
      price_0_5: d.price_0_5 ?? null, n_0_5: d.n_0_5 ?? 0,
      price_5_10: d.price_5_10 ?? null, n_5_10: d.n_5_10 ?? 0,
      price_10_20: d.price_10_20 ?? null, n_10_20: d.n_10_20 ?? 0,
      price_20p: d.price_20p ?? null, n_20p: d.n_20p ?? 0,
    };
  }
  return NextResponse.json(geo, { headers: DETAIL_CACHE_HEADERS });
}
