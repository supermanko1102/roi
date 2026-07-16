import { NextRequest, NextResponse } from "next/server";
import { loadUnifiedPoints, toFeatureCollection } from "@/lib/points";
import { ROOM_BANDS, type RoomBand } from "@/lib/rooms";

export const dynamic = "force-dynamic";

// 統一點位 GeoJSON(建案+棟級,屋齡帶為屬性;取代 /api/projects + /api/buildings 的地圖用途)
// 篩選:?district=桃園區 或 ?bbox=minLng,minLat,maxLng,maxLat(視窗載入)
// ?rooms=1|2|3|4p 時價格/總價/筆數改用該房數帶的彙總,無該格局的點不回傳
export async function GET(req: NextRequest) {
  const district = req.nextUrl.searchParams.get("district") ?? undefined;
  const bboxParam = req.nextUrl.searchParams.get("bbox");
  const roomsParam = req.nextUrl.searchParams.get("rooms");
  const rooms = ROOM_BANDS.includes(roomsParam as RoomBand) ? (roomsParam as RoomBand) : undefined;
  const kind = req.nextUrl.searchParams.get("kind") === "presale" ? ("presale" as const) : undefined;

  let bbox: [number, number, number, number] | undefined;
  if (!district && bboxParam) {
    const v = bboxParam.split(",").map(Number);
    if (v.length !== 4 || !v.every(Number.isFinite))
      return NextResponse.json({ error: "bad bbox" }, { status: 400 });
    bbox = v as [number, number, number, number];
  }

  const pts = await loadUnifiedPoints({ district, bbox, rooms, kind });
  return NextResponse.json(toFeatureCollection(pts));
}
