import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

// 軌道路線幾何(機捷/台鐵/綠線施工中):etl/fetch-rail-lines.ts 產出的靜態 geojson
export async function GET() {
  const p = path.join(process.cwd(), "data", "rail-lines.geojson");
  return NextResponse.json(JSON.parse(fs.readFileSync(p, "utf-8")));
}
