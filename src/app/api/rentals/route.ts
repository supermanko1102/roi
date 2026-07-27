import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { MIN_RENT_BUILDING_AGE, MAX_RENT_BUILDING_AGE } from "@/lib/rent";
import { cityPrefixRe } from "@/lib/cities";
import { MAP_CACHE_HEADERS, parseBbox } from "@/lib/api-params";

export const dynamic = "force-dynamic";

const RESIDENTIAL = "^(住宅大樓|華廈|透天厝|公寓|套房)";

// 屋齡 1–10 年租賃實登：能透過 building_community 歸戶者聚成社區級點位(與預售建案同口徑)，
// 其餘同門牌彙總成棟級點位。社宅包租代管件納入顯示但獨立聚合並帶 is_social 旗標；
// 行情統計(compute-stats/compute-zone-rents)本就排除社宅,此處只影響地圖呈現。
// 租賃 CSV 沒有完整建案名；只有能歸戶者才顯示正式名稱。
export async function GET(req: NextRequest) {
  const bboxResult = parseBbox(req.nextUrl.searchParams.get("bbox"));
  if (bboxResult.error) return NextResponse.json({ error: bboxResult.error }, { status: 400 });
  const bbox = bboxResult.value;
  const within = bbox
    ? sql`AND g.lng BETWEEN ${bbox[0]} AND ${bbox[2]}
          AND g.lat BETWEEN ${bbox[1]} AND ${bbox[3]}`
    : sql``;

  const result = await db.execute(sql`
    WITH rental_base AS (
      SELECT DISTINCT r.addr_key, r.city, r.district, r.address, r.deal_date,
             r.monthly_rent, r.housing_rent, r.parking_rent, r.area_ping, r.rent_per_ping,
             r.build_year, r.building_type, (r.is_social IS TRUE) AS is_social
      FROM rent_deals r
      WHERE r.addr_key IS NOT NULL
        AND r.build_year BETWEEN extract(year FROM now()) - ${MAX_RENT_BUILDING_AGE}
                              AND extract(year FROM now()) - ${MIN_RENT_BUILDING_AGE}
        AND r.building_type ~ ${RESIDENTIAL}
        AND r.monthly_rent BETWEEN 3000 AND 200000
        AND r.area_ping BETWEEN 3 AND 200
        AND r.rent_per_ping BETWEEN 150 AND 5000
    )
    SELECT * FROM (
    SELECT COALESCE('c' || bc.community_id::text, r.addr_key) AS key,
           r.is_social,
           min(r.city) AS city, min(r.district) AS district,
           avg(g.lng)::float AS lng, avg(g.lat)::float AS lat,
           COALESCE(max(pc.name), max(c.name)) AS community_name,
           min(r.addr_key) AS rep_addr,
           count(DISTINCT r.addr_key)::int AS doors,
           max(r.build_year)::int AS build_year,
           mode() WITHIN GROUP (ORDER BY r.building_type) AS building_type,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY r.monthly_rent)::numeric AS monthly_rent,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY r.housing_rent)::numeric AS housing_rent,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY r.parking_rent)
             FILTER (WHERE r.parking_rent > 0)::numeric AS parking_rent,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY r.area_ping)::numeric AS area_ping,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY r.rent_per_ping)::numeric AS rent_per_ping,
           count(*)::int AS deal_count, max(r.deal_date) AS last_deal,
           row_number() OVER (PARTITION BY r.is_social
             ORDER BY max(r.deal_date) DESC NULLS LAST) AS rn
    FROM rental_base r
    JOIN geocode_cache g ON g.addr_key = r.addr_key AND g.precision = 'door'
    LEFT JOIN building_community bc ON bc.addr_key = r.addr_key
    LEFT JOIN communities c ON c.case_no = bc.case_no
    LEFT JOIN physical_communities pc ON pc.id = bc.community_id
    WHERE g.lng IS NOT NULL AND g.lat IS NOT NULL ${within}
    GROUP BY COALESCE('c' || bc.community_id::text, r.addr_key), r.is_social
    ) t
    WHERE t.rn <= 8000 -- 市場/社宅各自截舊,社宅加入不會擠掉市場點
    ORDER BY t.last_deal DESC NULLS LAST
  `);

  const currentYear = new Date().getFullYear();
  return NextResponse.json({
    type: "FeatureCollection",
    meta: {
      min_age: MIN_RENT_BUILDING_AGE, max_age: MAX_RENT_BUILDING_AGE,
      // 社宅件以 is_social 旗標分開聚合呈現;各級行情統計仍全數排除社宅。
      social_flagged_separately: true, count: result.rows.length,
    },
    features: result.rows.map((row: any) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [+row.lng, +row.lat] },
      properties: {
        key: `${row.key}${row.is_social ? "|s" : ""}`,
        name: row.community_name ?? null,
        city: row.city,
        district: row.district,
        // 只顯示棟級門牌(社區點取代表門牌)，不公開樓層或室號。
        address: String(row.rep_addr).replace(cityPrefixRe, ""),
        doors: +row.doors,
        is_social: row.is_social === true,
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
  }, { headers: MAP_CACHE_HEADERS });
}
