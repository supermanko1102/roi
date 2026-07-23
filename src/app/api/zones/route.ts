import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { db, zone_band_stats } from "@/lib/db";
import { AGE_BANDS } from "@/lib/age";
import { CITY_NAMES } from "@/lib/cities";
import { DETAIL_CACHE_HEADERS } from "@/lib/api-params";

export const dynamic = "force-dynamic";

// 重劃區/生活圈:官方 GIS 邊界 + ETL 預算的 zone_band_stats。

export async function GET() {
  const geoPath = path.join(process.cwd(), "data", "zones.geojson");
  const geo = JSON.parse(fs.readFileSync(geoPath, "utf-8"));
  geo.features = geo.features.filter((f: any) => CITY_NAMES.includes(f.properties.city));

  const stats = await db.select().from(zone_band_stats);
  const byZone = new Map(stats.map((row) => [`${row.city}|${row.zone}|${row.band}`, row]));

  for (const f of geo.features) {
    const props: Record<string, unknown> = { ...f.properties };
    for (const band of ["all", ...AGE_BANDS]) {
      const stat = byZone.get(`${f.properties.city}|${f.properties.name}|${band}`);
      props[`price_${band}`] = stat?.median_unit_price ?? null;
      props[`n_${band}`] = stat?.samples ?? 0;
    }
    f.properties = props;
  }

  return NextResponse.json(geo, { headers: DETAIL_CACHE_HEADERS });
}
