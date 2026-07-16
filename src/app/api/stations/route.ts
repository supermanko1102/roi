import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

// 軌道車站(機捷/台鐵/綠線施工中):etl/fetch-stations.ts 產出的靜態 geojson
export async function GET() {
  const p = path.join(process.cwd(), "data", "stations.geojson");
  return NextResponse.json(JSON.parse(fs.readFileSync(p, "utf-8")));
}
