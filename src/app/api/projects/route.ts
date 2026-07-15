import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, projects } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const district = req.nextUrl.searchParams.get("district");
  const rows = await db.select().from(projects)
    .where(district ? eq(projects.district, district) : undefined)
    .orderBy(sql`${projects.est_roi} DESC NULLS LAST`);
  return NextResponse.json(rows);
}
