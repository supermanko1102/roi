import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const district = req.nextUrl.searchParams.get("district");
  const { rows } = district
    ? await pool.query("SELECT * FROM projects WHERE district=$1 ORDER BY est_roi DESC NULLS LAST", [district])
    : await pool.query("SELECT * FROM projects ORDER BY est_roi DESC NULLS LAST");
  return NextResponse.json(rows);
}
