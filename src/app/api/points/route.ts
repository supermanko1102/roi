import { NextRequest, NextResponse } from "next/server";
import { loadUnifiedPoints, toFeatureCollection } from "@/lib/points";
import { ROOM_BANDS, type RoomBand } from "@/lib/rooms";
import { MAP_CACHE_HEADERS, parseBbox, parseCity, validText } from "@/lib/api-params";
import { getProjectMetrics } from "@/lib/project-metrics";

export const dynamic = "force-dynamic";

// 統一點位 GeoJSON(建案+棟級,屋齡帶為屬性;取代 /api/projects + /api/buildings 的地圖用途)
// 篩選:?district=桃園區 或 ?bbox=minLng,minLat,maxLng,maxLat(視窗載入)
// ?rooms=1|2|3|4p 時價格/總價/筆數改用該房數帶的彙總,無該格局的點不回傳
export async function GET(req: NextRequest) {
  const district = req.nextUrl.searchParams.get("district") ?? undefined;
  if (district && !validText(district, 30))
    return NextResponse.json({ error: "bad district" }, { status: 400 });
  const cityResult = parseCity(req.nextUrl.searchParams.get("city"));
  if (cityResult.error) return NextResponse.json({ error: cityResult.error }, { status: 400 });
  const roomsParam = req.nextUrl.searchParams.get("rooms");
  const rooms = ROOM_BANDS.includes(roomsParam as RoomBand) ? (roomsParam as RoomBand) : undefined;
  const kind = req.nextUrl.searchParams.get("kind") === "presale" ? ("presale" as const) : undefined;

  const bboxResult = parseBbox(district ? null : req.nextUrl.searchParams.get("bbox"));
  if (bboxResult.error) return NextResponse.json({ error: bboxResult.error }, { status: 400 });
  const bbox = bboxResult.value ?? undefined;

  // 判讀指標(比行情/租金回報/解約率)算不出來不該讓地圖點位跟著掛掉
  const [pts, metrics] = await Promise.all([
    loadUnifiedPoints({ city: cityResult.value ?? undefined, district, bbox, rooms, kind }),
    getProjectMetrics().catch((e) => { console.error("[points] metrics failed", e); return null; }),
  ]);
  return NextResponse.json(toFeatureCollection(pts, metrics), { headers: MAP_CACHE_HEADERS });
}
