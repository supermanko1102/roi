import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { loadUnifiedPoints, type UnifiedPoint } from "@/lib/points";
import { AGE_BANDS } from "@/lib/age";

export const dynamic = "force-dynamic";

const MIN_SAMPLES = 5; // 帶內成交筆數門檻,不足給 null(前端顯示 —)

// 重劃區/生活圈:官方 GIS 邊界(etl/build-zones.ts 產出)+ 圈內統一點位的屋齡帶聚合
// 圈內樣本少(點位僅數百~數千)直接在 JS 做 point-in-polygon,不動用 PostGIS

type Ring = [number, number][];
function inRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
// Polygon / MultiPolygon,含挖洞;先過 bbox 再算,點多時省時間
function makeContains(geom: any) {
  const polys: Ring[][] = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  let w = 180, e = -180, s = 90, n = -90;
  for (const rings of polys) for (const [x, y] of rings[0]) {
    if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
  }
  return (lng: number, lat: number): boolean => {
    if (lng < w || lng > e || lat < s || lat > n) return false;
    for (const rings of polys) {
      if (!inRing(lng, lat, rings[0])) continue;
      let hole = false;
      for (let i = 1; i < rings.length; i++) if (inRing(lng, lat, rings[i])) { hole = true; break; }
      if (!hole) return true;
    }
    return false;
  };
}
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return +(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(1);
};

// 帶內聚合:點位中位單價(點的 median 再取 median,與棟級口徑一致)+ 成交筆數
function bandStats(pts: UnifiedPoint[]) {
  const n = pts.reduce((s, p) => s + p.deal_count, 0);
  const price = n >= MIN_SAMPLES
    ? median(pts.map((p) => p.price).filter((v): v is number => v != null)) : null;
  return { price, n };
}

export async function GET() {
  const geoPath = path.join(process.cwd(), "data", "taoyuan-zones.geojson");
  const geo = JSON.parse(fs.readFileSync(geoPath, "utf-8"));

  const points = await loadUnifiedPoints();

  for (const f of geo.features) {
    const contains = makeContains(f.geometry);
    const inside = points.filter((p) => contains(p.lng, p.lat));
    const props: Record<string, unknown> = { ...f.properties };
    const all = bandStats(inside);
    props.price_all = all.price; props.n_all = all.n;
    for (const band of AGE_BANDS) {
      const s = bandStats(inside.filter((p) => p.band === band));
      props[`price_${band}`] = s.price;
      props[`n_${band}`] = s.n;
    }
    f.properties = props;
  }
  return NextResponse.json(geo);
}
