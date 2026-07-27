import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { MIN_RENT_BUILDING_AGE, MAX_RENT_BUILDING_AGE } from "@/lib/rent";
import { cityPrefixRe } from "@/lib/cities";
import { MAP_CACHE_HEADERS, parseBbox } from "@/lib/api-params";

export const dynamic = "force-dynamic";

const RESIDENTIAL = "^(住宅大樓|華廈|透天厝|公寓|套房)";

// 屋齡 1–10 年租賃實登：能歸戶出建案名者按「城市|區|建案名」聚成一個社區點
// (與預售建案點同口徑,分期備查案也合併;實體社區名 physical_communities 優先),
// 配不到名字的門牌彙總成棟級點位。
// 同社區的市場件與社宅包租代管件合併為單一點:有市場件即為市場點(社宅筆數附註),
// 純社宅才成為社宅點(is_social=true)。行情統計(compute-stats/compute-zone-rents)
// 本就排除社宅,此處只影響地圖呈現。
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
    SELECT COALESCE(
             'n|' || COALESCE(pc.city, c.city) || '|' || COALESCE(pc.district, c.district)
                  || '|' || COALESCE(pc.name, c.name),
             r.addr_key) AS key,
           min(r.city) AS city, min(r.district) AS district,
           avg(g.lng)::float AS lng, avg(g.lat)::float AS lat,
           COALESCE(max(pc.name), max(c.name)) AS community_name,
           min(r.addr_key) AS rep_addr,
           count(DISTINCT r.addr_key)::int AS doors,
           max(r.build_year)::int AS build_year,
           mode() WITHIN GROUP (ORDER BY r.building_type) AS building_type,
           count(*) FILTER (WHERE NOT r.is_social)::int AS m_cnt,
           count(*) FILTER (WHERE r.is_social)::int AS s_cnt,
           max(r.deal_date) FILTER (WHERE NOT r.is_social) AS m_last,
           max(r.deal_date) FILTER (WHERE r.is_social) AS s_last,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY r.monthly_rent)
             FILTER (WHERE NOT r.is_social)::numeric AS m_monthly,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY r.housing_rent)
             FILTER (WHERE NOT r.is_social)::numeric AS m_housing,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY r.parking_rent)
             FILTER (WHERE NOT r.is_social AND r.parking_rent > 0)::numeric AS m_parking,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY r.area_ping)
             FILTER (WHERE NOT r.is_social)::numeric AS m_area,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY r.rent_per_ping)
             FILTER (WHERE NOT r.is_social)::numeric AS m_per_ping,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY r.monthly_rent)
             FILTER (WHERE r.is_social)::numeric AS s_monthly,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY r.housing_rent)
             FILTER (WHERE r.is_social)::numeric AS s_housing,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY r.area_ping)
             FILTER (WHERE r.is_social)::numeric AS s_area,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY r.rent_per_ping)
             FILTER (WHERE r.is_social)::numeric AS s_per_ping
    FROM rental_base r
    JOIN geocode_cache g ON g.addr_key = r.addr_key AND g.precision = 'door'
    LEFT JOIN building_community bc ON bc.addr_key = r.addr_key
    LEFT JOIN communities c ON c.case_no = bc.case_no
    LEFT JOIN physical_communities pc ON pc.id = bc.community_id
    WHERE g.lng IS NOT NULL AND g.lat IS NOT NULL ${within}
    GROUP BY 1
    ORDER BY GREATEST(
      coalesce(max(r.deal_date) FILTER (WHERE NOT r.is_social), '1900-01-01'),
      coalesce(max(r.deal_date) FILTER (WHERE r.is_social), '1900-01-01')) DESC
    LIMIT 12000
  `);

  const currentYear = new Date().getFullYear();
  return NextResponse.json({
    type: "FeatureCollection",
    meta: {
      min_age: MIN_RENT_BUILDING_AGE, max_age: MAX_RENT_BUILDING_AGE,
      // 社宅件與市場件同點合併,純社宅點才帶 is_social;各級行情統計仍全數排除社宅。
      social_flagged_separately: true, count: result.rows.length,
    },
    features: result.rows.map((row: any) => {
      // 有市場件 → 市場點(社宅筆數附註);純社宅 → 社宅點,數字取社宅中位
      const social = +row.m_cnt === 0;
      const monthly = social ? +row.s_monthly : +row.m_monthly;
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [+row.lng, +row.lat] },
        properties: {
          key: row.key,
          name: row.community_name ?? null,
          city: row.city,
          district: row.district,
          // 只顯示棟級門牌(社區點取代表門牌)，不公開樓層或室號。
          address: String(row.rep_addr).replace(cityPrefixRe, ""),
          doors: +row.doors,
          is_social: social,
          social_count: +row.s_cnt,
          building_type: row.building_type,
          build_year: row.build_year,
          age: Math.max(0, currentYear - row.build_year),
          monthly_rent: Math.round(monthly),
          housing_rent: Math.round(+((social ? row.s_housing : row.m_housing) ?? monthly)),
          parking_rent: social || row.m_parking == null ? null : Math.round(+row.m_parking),
          area_ping: +(+(social ? row.s_area : row.m_area)).toFixed(1),
          rent_per_ping: Math.round(+(social ? row.s_per_ping : row.m_per_ping)),
          deal_count: social ? +row.s_cnt : +row.m_cnt,
          last_deal: social ? row.s_last : row.m_last,
          rent_label: `${Math.round(monthly / 1000) / 10}萬/月`,
        },
      };
    }),
  }, { headers: MAP_CACHE_HEADERS });
}
