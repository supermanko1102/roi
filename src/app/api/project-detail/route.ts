import { NextRequest, NextResponse } from "next/server";
import { DETAIL_CACHE_HEADERS, parseCity, validText } from "@/lib/api-params";
import { loadProjectDetail } from "@/lib/project-detail";

export const dynamic = "force-dynamic";

// 建案抽屜詳情:彙總 + 備查資訊(戶數/建照/完工)+ 全部成交明細(含解約件,前端自行拆分計算)
// key 用 (city, district, name):projects 的自然鍵,與 room_stats/points 一致
// city 缺省視為桃園市:多城市之前發出的分享網址沒有 city 段,要繼續能開
export async function GET(req: NextRequest) {
  const cityResult = parseCity(req.nextUrl.searchParams.get("city") || "桃園市");
  if (cityResult.error || !cityResult.value)
    return NextResponse.json({ error: "bad city" }, { status: 400 });
  const city = cityResult.value;
  const district = req.nextUrl.searchParams.get("district");
  const name = req.nextUrl.searchParams.get("name");
  if (!district || !name) return NextResponse.json({ error: "district & name required" }, { status: 400 });
  if (!validText(district, 30) || !validText(name, 160))
    return NextResponse.json({ error: "bad district or name" }, { status: 400 });

  const detail = await loadProjectDetail(city, district, name);
  if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(detail, { headers: DETAIL_CACHE_HEADERS });
}
