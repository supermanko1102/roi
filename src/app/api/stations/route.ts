import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

// 軌道車站與交流道:etl/fetch-stations.ts 產出的靜態 geojson。
// 不在 API 端過濾城市:檔案本身就是閘門(啟用新城市後重跑 fetch-stations 重新產生),
// 且機捷北段等跨市站是刻意保留的,bbox 過濾會截斷路線。
export async function GET() {
  const p = path.join(process.cwd(), "data", "stations.geojson");
  return NextResponse.json(JSON.parse(fs.readFileSync(p, "utf-8")));
}
