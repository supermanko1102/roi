import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, projects } from "@/lib/db";
import { MAP_CACHE_HEADERS } from "@/lib/api-params";

export const dynamic = "force-dynamic";

// 全量建案搜尋索引:含尚無座標的案(工地位置為路段/地號、樂居未收錄等),
// 搜尋命中無座標案時前端直接開抽屜、不飛地圖。輕量欄位,一次載入。
export async function GET() {
  const rows = await db.select({
    name: projects.name, city: projects.city, district: projects.district,
    deal_count: projects.deal_count, unit_price: projects.unit_price,
    lat: projects.lat, lng: projects.lng,
  }).from(projects).where(eq(projects.is_demo, false));

  return NextResponse.json(rows.map((r) => ({
    name: r.name, city: r.city, district: r.district,
    deal_count: r.deal_count, unit_price: r.unit_price,
    geo: r.lat != null,
  })), { headers: MAP_CACHE_HEADERS });
}
