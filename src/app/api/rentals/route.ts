import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { MIN_RENT_BUILDING_AGE, MAX_RENT_BUILDING_AGE } from "@/lib/rent";

export const dynamic = "force-dynamic";

const RESIDENTIAL = "^(住宅大樓|華廈|透天厝|公寓|套房)";

// 屋齡 1–10 年市場租賃實登：同門牌彙總成一個棟級點位，排除社宅與非住宅用途。
// 租賃 CSV 沒有完整建案名；只有能透過 building_community 配對者才顯示正式名稱。
export async function GET(req: NextRequest) {
  const bboxParam = req.nextUrl.searchParams.get("bbox");
  let bbox: [number, number, number, number] | null = null;
  if (bboxParam) {
    const values = bboxParam.split(",").map(Number);
    if (values.length !== 4 || !values.every(Number.isFinite))
      return NextResponse.json({ error: "bad bbox" }, { status: 400 });
    bbox = values as [number, number, number, number];
  }
  const within = bbox
    ? sql`AND g.lng BETWEEN ${bbox[0]} AND ${bbox[2]}
          AND g.lat BETWEEN ${bbox[1]} AND ${bbox[3]}`
    : sql``;

  const result = await db.execute(sql`
    WITH rental_base AS (
      SELECT DISTINCT r.addr_key, r.district, r.address, r.deal_date,
             r.monthly_rent, r.housing_rent, r.parking_rent, r.area_ping, r.rent_per_ping,
             r.build_year, r.building_type
      FROM rent_deals r
      WHERE r.addr_key IS NOT NULL
        AND r.is_social IS NOT TRUE
        AND r.build_year BETWEEN extract(year FROM now()) - ${MAX_RENT_BUILDING_AGE}
                              AND extract(year FROM now()) - ${MIN_RENT_BUILDING_AGE}
        AND r.building_type ~ ${RESIDENTIAL}
        AND r.monthly_rent BETWEEN 3000 AND 200000
        AND r.area_ping BETWEEN 3 AND 200
        AND r.rent_per_ping BETWEEN 150 AND 5000
    )
    SELECT r.addr_key, min(r.district) AS district,
           g.lng, g.lat, max(c.name) AS community_name,
           max(r.build_year)::int AS build_year,
           mode() WITHIN GROUP (ORDER BY r.building_type) AS building_type,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY r.monthly_rent)::numeric AS monthly_rent,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY r.housing_rent)::numeric AS housing_rent,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY r.parking_rent)
             FILTER (WHERE r.parking_rent > 0)::numeric AS parking_rent,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY r.area_ping)::numeric AS area_ping,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY r.rent_per_ping)::numeric AS rent_per_ping,
           count(*)::int AS deal_count, max(r.deal_date) AS last_deal
    FROM rental_base r
    JOIN geocode_cache g ON g.addr_key = r.addr_key AND g.precision = 'door'
    LEFT JOIN building_community bc ON bc.addr_key = r.addr_key
    LEFT JOIN communities c ON c.case_no = bc.case_no
    WHERE g.lng IS NOT NULL AND g.lat IS NOT NULL ${within}
    GROUP BY r.addr_key, g.lng, g.lat
    ORDER BY max(r.deal_date) DESC NULLS LAST
    LIMIT 8000
  `);

  const currentYear = new Date().getFullYear();
  return NextResponse.json({
    type: "FeatureCollection",
    meta: {
      min_age: MIN_RENT_BUILDING_AGE, max_age: MAX_RENT_BUILDING_AGE,
      excludes_social_housing: true, count: result.rows.length,
    },
    features: result.rows.map((row: any) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [+row.lng, +row.lat] },
      properties: {
        key: row.addr_key,
        name: row.community_name ?? null,
        district: row.district,
        // 只顯示棟級門牌，不公開樓層或室號。
        address: String(row.addr_key).replace(/^桃園市/, ""),
        building_type: row.building_type,
        build_year: row.build_year,
        age: Math.max(0, currentYear - row.build_year),
        monthly_rent: Math.round(+row.monthly_rent),
        housing_rent: Math.round(+(row.housing_rent ?? row.monthly_rent)),
        parking_rent: row.parking_rent == null ? null : Math.round(+row.parking_rent),
        area_ping: +(+row.area_ping).toFixed(1),
        rent_per_ping: Math.round(+row.rent_per_ping),
        deal_count: +row.deal_count,
        last_deal: row.last_deal,
        rent_label: `${Math.round(+row.monthly_rent / 1000) / 10}萬/月`,
      },
    })),
  });
}
