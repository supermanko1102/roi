import { NextRequest, NextResponse } from "next/server";
import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { db, building_community, communities, presale_deals, projects, sale_deals, contract_materials } from "@/lib/db";
import { ageBand } from "@/lib/age";
import { DETAIL_CACHE_HEADERS, parseCity, validText } from "@/lib/api-params";

export const dynamic = "force-dynamic";

// 建案抽屜詳情:彙總 + 備查資訊(戶數/建照/完工)+ 全部成交明細(含解約件,前端自行拆分計算)
// key 用 (city, district, name):projects 的自然鍵,與 room_stats/points 一致
// city 缺省視為桃園市:多城市之前發出的分享網址沒有 city 段,要繼續能開
export async function GET(req: NextRequest) {
  const cityResult = parseCity(req.nextUrl.searchParams.get("city") || "桃園市");
  if (cityResult.error || !cityResult.value)
    return NextResponse.json({ error: "bad city" }, { status: 400 });
  const city = cityResult.value;
  const district = req.nextUrl.searchParams.get("district");
  const name = req.nextUrl.searchParams.get("name");
  if (!district || !name) return NextResponse.json({ error: "district & name required" }, { status: 400 });
  if (!validText(district, 30) || !validText(name, 160))
    return NextResponse.json({ error: "bad district or name" }, { status: 400 });

  const [p] = await db.select().from(projects)
    .where(and(eq(projects.name, name), eq(projects.city, city), eq(projects.district, district)));
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });

  // 備查建案可能同名多筆(分期),優先取有完工日(使照 > 首次登記)的那筆
  const comms = await db.select().from(communities)
    .where(and(eq(communities.name, name), eq(communities.city, city), eq(communities.district, district)));
  const comm = comms.find((c) => (c.use_issue_date ?? c.first_reg) != null) ?? comms[0] ?? null;

  const deals = await db.select({
    deal_date: presale_deals.deal_date, total_price: presale_deals.total_price,
    area_ping: presale_deals.area_ping, unit_price: presale_deals.unit_price,
    rooms: presale_deals.rooms, baths: presale_deals.baths,
    floor_no: presale_deals.floor_no, total_floors: presale_deals.total_floors,
    unit_id: presale_deals.unit_id,
    is_cancelled: presale_deals.is_cancelled, cancel_date: presale_deals.cancel_date,
  }).from(presale_deals)
    .where(and(eq(presale_deals.project_name, name), eq(presale_deals.city, city), eq(presale_deals.district, district)))
    .orderBy(asc(presale_deals.deal_date)).limit(1500);

  // 契約建材設備表(只在成功抽到時才回傳)
  const [mat] = await db.select({
    sections: contract_materials.sections, pdf_url: contract_materials.pdf_url,
  }).from(contract_materials)
    .where(and(
      eq(contract_materials.project_name, name),
      eq(contract_materials.city, city),
      eq(contract_materials.district, district),
      eq(contract_materials.status, "ok"),
    ));
  const materials = mat
    ? { sections: JSON.parse(mat.sections ?? "[]") as { title: string; body: string }[], pdf_url: mat.pdf_url }
    : null;

  const regDate = comm?.use_issue_date ?? comm?.first_reg;
  const regYear = regDate ? new Date(regDate).getFullYear() : null;
  const nowYear = new Date().getFullYear();
  const completed = regYear != null && regYear <= nowYear;

  // 交屋後轉售:地號歸戶(building_community)把 a 檔門牌接回本案。
  // 只取交屋(使照/首次登記)之後的成交——預售期交易可能同時揭露在 a/b 檔,以日期切開避免重複。
  let resales: {
    deal_date: string | null; floor_no: number | null; rooms: number | null; baths: number | null;
    total_price: number | null; unit_price: number | null; area_ping: number | null;
  }[] = [];
  const caseNos = comms.map((c) => c.case_no);
  if (completed && regDate && caseNos.length) {
    resales = await db.select({
      deal_date: sale_deals.deal_date, floor_no: sale_deals.floor_no,
      rooms: sale_deals.rooms, baths: sale_deals.baths,
      total_price: sale_deals.total_price, unit_price: sale_deals.unit_price,
      area_ping: sale_deals.area_ping,
    }).from(sale_deals)
      .innerJoin(building_community, eq(building_community.addr_key, sale_deals.addr_key))
      .where(and(inArray(building_community.case_no, caseNos), gt(sale_deals.deal_date, regDate)))
      .orderBy(desc(sale_deals.deal_date)).limit(200);
  }

  return NextResponse.json({
    project: p,
    community: comm && {
      households: comm.households, street: comm.street, permit_no: comm.permit_no,
      first_reg: comm.first_reg, declare_date: comm.declare_date,
      use_issue_date: comm.use_issue_date, phases: comms.length,
    },
    band: completed ? ageBand(regYear, nowYear) : "presale",
    build_year: completed ? regYear : null,
    deals,
    resales,
    materials,
  }, { headers: DETAIL_CACHE_HEADERS });
}
