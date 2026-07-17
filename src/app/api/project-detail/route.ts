import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db, communities, presale_deals, projects } from "@/lib/db";
import { ageBand } from "@/lib/age";

export const dynamic = "force-dynamic";

// 建案抽屜詳情:彙總 + 備查資訊(戶數/建照/完工)+ 全部成交明細(含解約件,前端自行拆分計算)
// key 用 (district, name):projects 的自然鍵,與 room_stats/points 一致
export async function GET(req: NextRequest) {
  const district = req.nextUrl.searchParams.get("district");
  const name = req.nextUrl.searchParams.get("name");
  if (!district || !name) return NextResponse.json({ error: "district & name required" }, { status: 400 });

  const [p] = await db.select().from(projects)
    .where(and(eq(projects.name, name), eq(projects.district, district)));
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });

  // 備查建案可能同名多筆(分期),優先取有完工日的那筆
  const comms = await db.select().from(communities)
    .where(and(eq(communities.name, name), eq(communities.district, district)));
  const comm = comms.find((c) => c.first_reg != null) ?? comms[0] ?? null;

  const deals = await db.select({
    deal_date: presale_deals.deal_date, total_price: presale_deals.total_price,
    area_ping: presale_deals.area_ping, unit_price: presale_deals.unit_price,
    rooms: presale_deals.rooms, baths: presale_deals.baths,
    floor_no: presale_deals.floor_no, total_floors: presale_deals.total_floors,
    unit_id: presale_deals.unit_id,
    is_cancelled: presale_deals.is_cancelled, cancel_date: presale_deals.cancel_date,
  }).from(presale_deals)
    .where(and(eq(presale_deals.project_name, name), eq(presale_deals.district, district)))
    .orderBy(asc(presale_deals.deal_date)).limit(1500);

  const regYear = comm?.first_reg ? new Date(comm.first_reg).getFullYear() : null;
  const nowYear = new Date().getFullYear();
  const completed = regYear != null && regYear <= nowYear;

  return NextResponse.json({
    project: p,
    community: comm && {
      households: comm.households, street: comm.street, permit_no: comm.permit_no,
      first_reg: comm.first_reg, declare_date: comm.declare_date, phases: comms.length,
    },
    band: completed ? ageBand(regYear, nowYear) : "presale",
    build_year: completed ? regYear : null,
    deals,
  });
}
