import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { db, projects } from "@/lib/db";

export const dynamic = "force-dynamic";

// 篩選:?district=桃園區 或 ?bbox=minLng,minLat,maxLng,maxLat(視窗載入)
export async function GET(req: NextRequest) {
  const district = req.nextUrl.searchParams.get("district");
  const bboxParam = req.nextUrl.searchParams.get("bbox");

  let where: SQL | undefined;
  if (district) {
    where = eq(projects.district, district);
  } else if (bboxParam) {
    const [w, s, e, n] = bboxParam.split(",").map(Number);
    if (![w, s, e, n].every(Number.isFinite))
      return NextResponse.json({ error: "bad bbox" }, { status: 400 });
    where = and(gte(projects.lng, w), lte(projects.lng, e),
                gte(projects.lat, s), lte(projects.lat, n));
  }

  const rows = await db.select().from(projects).where(where)
    .orderBy(sql`${projects.est_roi} DESC NULLS LAST`);
  return NextResponse.json(rows);
}
