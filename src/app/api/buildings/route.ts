import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, lte, type SQL } from "drizzle-orm";
import { db, buildings, building_community, communities } from "@/lib/db";

export const dynamic = "force-dynamic";

// 棟級點位 GeoJSON(給 MapLibre cluster source)
// 篩選:?district=桃園區 或 ?bbox=minLng,minLat,maxLng,maxLat(視窗載入)
export async function GET(req: NextRequest) {
  const district = req.nextUrl.searchParams.get("district");
  const bboxParam = req.nextUrl.searchParams.get("bbox");

  let where: SQL | undefined;
  if (district) {
    where = eq(buildings.district, district);
  } else if (bboxParam) {
    const [w, s, e, n] = bboxParam.split(",").map(Number);
    if (![w, s, e, n].every(Number.isFinite))
      return NextResponse.json({ error: "bad bbox" }, { status: 400 });
    where = and(gte(buildings.lng, w), lte(buildings.lng, e),
                gte(buildings.lat, s), lte(buildings.lat, n));
  }

  const rows = await db.select({
    addr_key: buildings.addr_key,
    district: buildings.district,
    lat: buildings.lat,
    lng: buildings.lng,
    deal_count: buildings.deal_count,
    median_unit_price: buildings.median_unit_price,
    median_total: buildings.median_total,
    building_type: buildings.building_type,
    build_year: buildings.build_year,
    last_deal: buildings.last_deal,
    community: communities.name, // 社區歸戶(僅實登2.0後備查的建案有)
  }).from(buildings)
    .leftJoin(building_community, eq(building_community.addr_key, buildings.addr_key))
    .leftJoin(communities, eq(communities.case_no, building_community.case_no))
    .where(where).limit(8000);
  return NextResponse.json({
    type: "FeatureCollection",
    features: rows.map((b) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [b.lng, b.lat] },
      properties: {
        addr_key: b.addr_key,
        district: b.district,
        deal_count: b.deal_count,
        median_unit_price: b.median_unit_price != null ? +b.median_unit_price.toFixed(2) : null,
        median_total: b.median_total != null ? +b.median_total.toFixed(0) : null,
        building_type: b.building_type,
        build_year: b.build_year,
        last_deal: b.last_deal,
        ...(b.community ? { community: b.community } : {}),
      },
    })),
  });
}
