import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db, building_community, communities, physical_communities, projects, rent_deals } from "@/lib/db";
import { MIN_RENT_BUILDING_AGE, MAX_RENT_BUILDING_AGE } from "@/lib/rent";
import { cityPrefixRe } from "@/lib/cities";
import { DETAIL_CACHE_HEADERS, validText } from "@/lib/api-params";

export const dynamic = "force-dynamic";

// 租賃抽屜詳情:一個地圖點(社區 "c<community_id>" 或門牌 addr_key)的歷史租約明細。
// 市場件與社宅件都回傳(以 is_social 區分),行情中位數由前端只用市場件計算。
// 若該社區可對應到有成交統計的建案,回傳 project 供前端一鍵跳建案抽屜。
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!validText(key, 120)) return NextResponse.json({ error: "bad key" }, { status: 400 });

  // 與 /api/rentals 相同的樣本口徑,抽屜筆數才對得上地圖點位
  const baseFilter = and(
    sql`${rent_deals.build_year} BETWEEN extract(year FROM now()) - ${MAX_RENT_BUILDING_AGE}
                                     AND extract(year FROM now()) - ${MIN_RENT_BUILDING_AGE}`,
    sql`${rent_deals.building_type} ~ '^(住宅大樓|華廈|透天厝|公寓|套房)'`,
    sql`${rent_deals.monthly_rent} BETWEEN 3000 AND 200000`,
    sql`${rent_deals.area_ping} BETWEEN 3 AND 200`,
    sql`${rent_deals.rent_per_ping} BETWEEN 150 AND 5000`,
  );

  // 三種鍵:社區 "n|城市|區|建案名"(地圖現行)、舊制 "c<community_id>"(相容舊分享網址)、門牌 addr_key
  const nameMatch = /^n\|([^|]+)\|([^|]+)\|(.+)$/.exec(key!);
  const communityMatch = /^c(\d{1,10})$/.exec(key!);
  let addrKeys: string[];
  let caseNos: string[] = [];
  let name: string | null = null;
  if (nameMatch) {
    const [, keyCity, keyDistrict, keyName] = nameMatch;
    name = keyName;
    // 同名備查案(分期)與同名實體社區的門牌都收進來,與地圖聚合口徑一致
    const cases = await db.select({ case_no: communities.case_no }).from(communities)
      .where(and(eq(communities.city, keyCity), eq(communities.district, keyDistrict), eq(communities.name, keyName)));
    const pcs = await db.select({ id: physical_communities.id }).from(physical_communities)
      .where(and(eq(physical_communities.city, keyCity), eq(physical_communities.district, keyDistrict), eq(physical_communities.name, keyName)));
    caseNos = cases.map((r) => r.case_no);
    const filters = [
      caseNos.length ? inArray(building_community.case_no, caseNos) : null,
      pcs.length ? inArray(building_community.community_id, pcs.map((r) => r.id)) : null,
    ].filter((f) => f != null);
    if (!filters.length) return NextResponse.json({ error: "not found" }, { status: 404 });
    const members = await db.select({
      addr_key: building_community.addr_key, case_no: building_community.case_no,
    }).from(building_community).where(filters.length === 1 ? filters[0] : or(...filters));
    if (!members.length) return NextResponse.json({ error: "not found" }, { status: 404 });
    addrKeys = [...new Set(members.map((m) => m.addr_key))];
    caseNos = [...new Set(members.map((m) => m.case_no))];
  } else if (communityMatch) {
    const communityId = Number(communityMatch[1]);
    const members = await db.select({
      addr_key: building_community.addr_key, case_no: building_community.case_no,
    }).from(building_community).where(eq(building_community.community_id, communityId));
    if (!members.length) return NextResponse.json({ error: "not found" }, { status: 404 });
    addrKeys = members.map((m) => m.addr_key);
    caseNos = [...new Set(members.map((m) => m.case_no))];
    const [pc] = await db.select({ name: physical_communities.name })
      .from(physical_communities).where(eq(physical_communities.id, communityId));
    name = pc?.name ?? null;
  } else {
    addrKeys = [key!];
    const [bc] = await db.select({ case_no: building_community.case_no })
      .from(building_community).where(eq(building_community.addr_key, key!));
    if (bc) caseNos = [bc.case_no];
  }

  const leases = await db.selectDistinct({
    deal_date: rent_deals.deal_date, addr_key: rent_deals.addr_key,
    city: rent_deals.city, district: rent_deals.district,
    floor_no: rent_deals.floor_no, total_floors: rent_deals.total_floors,
    area_ping: rent_deals.area_ping, rooms: rent_deals.rooms, halls: rent_deals.halls,
    rental_type: rent_deals.rental_type, building_type: rent_deals.building_type,
    build_year: rent_deals.build_year,
    monthly_rent: rent_deals.monthly_rent, housing_rent: rent_deals.housing_rent,
    parking_rent: rent_deals.parking_rent, rent_per_ping: rent_deals.rent_per_ping,
    is_social: rent_deals.is_social,
  }).from(rent_deals)
    .where(and(inArray(rent_deals.addr_key, addrKeys), baseFilter))
    .orderBy(desc(rent_deals.deal_date)).limit(400);
  if (!leases.length) return NextResponse.json({ error: "not found" }, { status: 404 });

  // 歸戶社區若對應到有成交統計的建案 → 提供跳轉;同社區多備查案取第一個有建案者
  let project: { city: string; district: string; name: string } | null = null;
  if (caseNos.length) {
    const [row] = await db.select({
      city: projects.city, district: projects.district, name: projects.name,
    }).from(communities)
      .innerJoin(projects, and(
        eq(projects.name, communities.name),
        eq(projects.city, communities.city),
        eq(projects.district, communities.district),
      ))
      .where(inArray(communities.case_no, caseNos)).limit(1);
    project = row ?? null;
    if (!communityMatch && !name) {
      const [c] = await db.select({ name: communities.name })
        .from(communities).where(inArray(communities.case_no, caseNos));
      name = c?.name ?? null;
    }
  }

  const { city, district } = leases[0];
  const doors = new Set(leases.map((l) => l.addr_key)).size;
  const stripAddr = (addrKey: string | null) =>
    addrKey ? addrKey.replace(cityPrefixRe, "").replace(district, "") : null;
  return NextResponse.json({
    key,
    name,
    city,
    district,
    // 只顯示棟級門牌(社區點取代表門牌),不公開樓層室號組合以外的個資
    address: stripAddr([...leases.map((l) => l.addr_key)].sort()[0]),
    doors,
    build_year: Math.max(...leases.map((l) => l.build_year ?? 0)) || null,
    building_type: leases[0].building_type,
    project,
    leases: leases.map(({ addr_key, city: _c, district: _d, ...l }) => ({
      ...l, addr: stripAddr(addr_key),
    })),
  }, { headers: DETAIL_CACHE_HEADERS });
}
