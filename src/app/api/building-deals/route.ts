import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

// 單一門牌的歷史成交列表
export async function GET(req: NextRequest) {
  const addr = req.nextUrl.searchParams.get("addr");
  if (!addr) return NextResponse.json({ error: "addr required" }, { status: 400 });
  const { rows } = await pool.query(
    `SELECT address, deal_date, total_price, area_ping, unit_price, unit_price_main, build_year
     FROM sale_deals WHERE addr_key=$1 ORDER BY deal_date DESC LIMIT 50`,
    [addr]
  );
  return NextResponse.json(rows);
}
