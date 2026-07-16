import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, buildings, building_community, communities, sale_deals, rent_deals, district_stats } from "@/lib/db";

export const dynamic = "force-dynamic";

// 抽屜詳情:棟 + 社區歸戶 + 成交明細(有社區就給全社區,樣本較足)+ 區租金行情
export async function GET(req: NextRequest) {
  const addr = req.nextUrl.searchParams.get("addr");
  if (!addr) return NextResponse.json({ error: "addr required" }, { status: 400 });

  const [b] = await db.select().from(buildings).where(eq(buildings.addr_key, addr));
  if (!b) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [bc] = await db.select({ case_no: building_community.case_no, name: communities.name,
                                 households: communities.households, first_reg: communities.first_reg })
    .from(building_community)
    .innerJoin(communities, eq(communities.case_no, building_community.case_no))
    .where(eq(building_community.addr_key, addr));

  let dealAddrs = [addr];
  let community = null;
  if (bc) {
    const sibs = await db.select({ addr_key: building_community.addr_key })
      .from(building_community).where(eq(building_community.case_no, bc.case_no));
    dealAddrs = sibs.map((s) => s.addr_key);
    community = { name: bc.name, households: bc.households, first_reg: bc.first_reg,
                  building_count: dealAddrs.length };
  }

  const deals = await db.select({
    addr_key: sale_deals.addr_key, deal_date: sale_deals.deal_date,
    total_price: sale_deals.total_price, area_ping: sale_deals.area_ping,
    parking_area_ping: sale_deals.parking_area_ping, unit_price: sale_deals.unit_price,
    rooms: sale_deals.rooms, baths: sale_deals.baths, floor_no: sale_deals.floor_no,
  }).from(sale_deals)
    .where(inArray(sale_deals.addr_key, dealAddrs))
    .orderBy(desc(sale_deals.deal_date)).limit(400);

  // 租金行情三層備援的前兩層:社區自己的租賃件(實登2.0起租賃有完整門牌)+ 區級
  const commRents = await db.select({ rp: rent_deals.rent_per_ping }).from(rent_deals)
    .where(and(
      inArray(rent_deals.addr_key, dealAddrs),
      eq(rent_deals.is_social, false),
      sql`${rent_deals.rent_per_ping} > 0`,
      sql`(${rent_deals.building_type} IS NULL OR ${rent_deals.building_type} ~ '^(住宅大樓|華廈|透天厝|公寓|套房)')`,
    ));
  const rps = commRents.map((r) => r.rp!).sort((a, b) => a - b);
  const commMedian = rps.length
    ? (rps.length % 2 ? rps[rps.length >> 1] : (rps[(rps.length >> 1) - 1] + rps[rps.length >> 1]) / 2)
    : null;

  const [ds] = await db.select({
    rent_ping_market: district_stats.median_rent_ping_market,
    rent_samples_market: district_stats.rent_samples_market,
  }).from(district_stats).where(eq(district_stats.district, b.district));

  return NextResponse.json({
    building: b, community, deals,
    rent: {
      community_rent_ping: commMedian, community_samples: rps.length,
      rent_ping_market: ds?.rent_ping_market ?? null,
      rent_samples_market: ds?.rent_samples_market ?? null,
    },
  });
}
