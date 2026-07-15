import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

// 區界 GeoJSON(靜態)+ 區統計(DB)合併輸出
export async function GET() {
  const geoPath = path.join(process.cwd(), "data", "taoyuan-districts.geojson");
  const geo = JSON.parse(fs.readFileSync(geoPath, "utf-8"));
  const { rows } = await pool.query("SELECT * FROM district_stats");
  const byName = Object.fromEntries(rows.map((r) => [r.district, r]));
  for (const f of geo.features) {
    const s = byName[f.properties.name];
    f.properties = {
      name: f.properties.name,
      median_unit_price: s ? +s.median_unit_price : null,
      est_roi: s?.est_roi != null ? +s.est_roi : null,
      est_roi_market: s?.est_roi_market != null ? +s.est_roi_market : null,
      presale_count: s ? +s.presale_count : 0,
      rent_samples: s ? +s.rent_samples : 0,
      rent_samples_market: s ? +(s.rent_samples_market ?? 0) : 0,
      is_demo: s?.is_demo ?? true,
    };
  }
  return NextResponse.json(geo);
}
