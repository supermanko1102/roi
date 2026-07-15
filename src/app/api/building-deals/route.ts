import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db, sale_deals } from "@/lib/db";

export const dynamic = "force-dynamic";

// 單一門牌的歷史成交列表
export async function GET(req: NextRequest) {
  const addr = req.nextUrl.searchParams.get("addr");
  if (!addr) return NextResponse.json({ error: "addr required" }, { status: 400 });
  const rows = await db.select({
    address: sale_deals.address,
    deal_date: sale_deals.deal_date,
    total_price: sale_deals.total_price,
    area_ping: sale_deals.area_ping,
    unit_price: sale_deals.unit_price,
    unit_price_main: sale_deals.unit_price_main,
    build_year: sale_deals.build_year,
  }).from(sale_deals)
    .where(eq(sale_deals.addr_key, addr))
    .orderBy(desc(sale_deals.deal_date))
    .limit(50);
  return NextResponse.json(rows);
}
