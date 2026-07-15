import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { isNotNull } from "drizzle-orm";
import { db, buildings, projects } from "@/lib/db";

export const dynamic = "force-dynamic";

// 重劃區/生活圈:靜態示意邊界 + 圈內建案/棟級點聚合統計
// 圈內樣本少(點位僅數百~數千)直接在 JS 做 point-in-polygon,不動用 PostGIS

type Ring = [number, number][];
function inPoly(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return +(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(1);
};

export async function GET() {
  const geoPath = path.join(process.cwd(), "data", "taoyuan-zones.geojson");
  const geo = JSON.parse(fs.readFileSync(geoPath, "utf-8"));

  const [projs, bldgs] = await Promise.all([
    db.select({ lat: projects.lat, lng: projects.lng, unit_price: projects.unit_price,
                est_roi: projects.est_roi, deal_count: projects.deal_count })
      .from(projects).where(isNotNull(projects.lat)),
    db.select({ lat: buildings.lat, lng: buildings.lng,
                median_unit_price: buildings.median_unit_price, deal_count: buildings.deal_count })
      .from(buildings).where(isNotNull(buildings.lat)),
  ]);

  for (const f of geo.features) {
    const ring = f.geometry.coordinates[0] as Ring;
    const zp = projs.filter((p) => inPoly(p.lng!, p.lat!, ring));
    const zb = bldgs.filter((b) => inPoly(b.lng!, b.lat!, ring));
    f.properties = {
      ...f.properties,
      presale_unit_price: median(zp.map((p) => p.unit_price).filter((v): v is number => v != null)),
      est_roi: median(zp.map((p) => p.est_roi).filter((v): v is number => v != null)),
      project_count: zp.length,
      presale_deals: zp.reduce((s, p) => s + (p.deal_count ?? 0), 0),
      resale_unit_price: median(zb.map((b) => b.median_unit_price).filter((v): v is number => v != null)),
      resale_deals: zb.reduce((s, b) => s + (b.deal_count ?? 0), 0),
    };
  }
  return NextResponse.json(geo);
}
