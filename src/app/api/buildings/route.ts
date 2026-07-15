import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

// 棟級點位 GeoJSON(給 MapLibre cluster source)
export async function GET(req: NextRequest) {
  const district = req.nextUrl.searchParams.get("district");
  const { rows } = district
    ? await pool.query("SELECT * FROM buildings WHERE district=$1", [district])
    : await pool.query("SELECT * FROM buildings");
  return NextResponse.json({
    type: "FeatureCollection",
    features: rows.map((b) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [+b.lng, +b.lat] },
      properties: {
        addr_key: b.addr_key,
        district: b.district,
        deal_count: +b.deal_count,
        median_unit_price: b.median_unit_price != null ? +(+b.median_unit_price).toFixed(2) : null,
        median_total: b.median_total != null ? +(+b.median_total).toFixed(0) : null,
        building_type: b.building_type,
        build_year: b.build_year,
        last_deal: b.last_deal,
      },
    })),
  });
}
