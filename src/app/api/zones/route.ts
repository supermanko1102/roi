import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { loadUnifiedPoints, type UnifiedPoint } from "@/lib/points";
import { AGE_BANDS } from "@/lib/age";
import { makeContains } from "@/lib/geo";
import { CITY_NAMES } from "@/lib/cities";

export const dynamic = "force-dynamic";

const MIN_SAMPLES = 5; // 帶內成交筆數門檻,不足給 null(前端顯示 —)

// 重劃區/生活圈:官方 GIS 邊界(etl/build-zones.ts 產出)+ 圈內統一點位的屋齡帶聚合
// 圈內樣本少(點位僅數百~數千)直接在 JS 做 point-in-polygon,不動用 PostGIS

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
  const geoPath = path.join(process.cwd(), "data", "zones.geojson");
  const geo = JSON.parse(fs.readFileSync(geoPath, "utf-8"));
  geo.features = geo.features.filter((f: any) => CITY_NAMES.includes(f.properties.city));

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
