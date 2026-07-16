import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { isNotNull } from "drizzle-orm";
import { db, buildings, projects, zone_stats } from "@/lib/db";

const MIN_RENT_SAMPLES = 8; // 圈級租金樣本門檻,不足就退回建案自帶的區級推估

export const dynamic = "force-dynamic";

// 重劃區/生活圈:官方 GIS 邊界(etl/build-zones.ts 產出)+ 圈內建案/棟級點聚合統計
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

export async function GET() {
  const geoPath = path.join(process.cwd(), "data", "taoyuan-zones.geojson");
  const geo = JSON.parse(fs.readFileSync(geoPath, "utf-8"));

  const [projs, bldgs, zrents] = await Promise.all([
    db.select({ lat: projects.lat, lng: projects.lng, unit_price: projects.unit_price,
                est_roi: projects.est_roi_market, deal_count: projects.deal_count })
      .from(projects).where(isNotNull(projects.lat)),
    db.select({ lat: buildings.lat, lng: buildings.lng,
                median_unit_price: buildings.median_unit_price, deal_count: buildings.deal_count })
      .from(buildings).where(isNotNull(buildings.lat)),
    db.select().from(zone_stats),
  ]);
  const rentByZone = new Map(zrents.map((z) => [z.zone, z]));

  for (const f of geo.features) {
    const contains = makeContains(f.geometry);
    const zp = projs.filter((p) => contains(p.lng!, p.lat!));
    const zb = bldgs.filter((b) => contains(b.lng!, b.lat!));
    const presale = median(zp.map((p) => p.unit_price).filter((v): v is number => v != null));
    const resale = median(zb.map((b) => b.median_unit_price).filter((v): v is number => v != null));
    const zr = rentByZone.get(f.properties.name);
    const rent = zr && (zr.rent_samples_market ?? 0) >= MIN_RENT_SAMPLES
      ? zr.median_rent_ping_market : null;
    const roi = (unit: number | null) =>
      rent != null && unit ? +((rent * 12) / (unit * 10000) * 100).toFixed(2) : null;
    f.properties = {
      ...f.properties,
      presale_unit_price: presale,
      // 圈級投報:優先用圈內租金行情;樣本不足退回圈內建案(區級租金)推估的中位
      est_roi: roi(presale) ?? median(zp.map((p) => p.est_roi).filter((v): v is number => v != null)),
      est_roi_resale: roi(resale),
      rent_ping_market: rent,
      rent_samples_market: zr?.rent_samples_market ?? 0,
      project_count: zp.length,
      presale_deals: zp.reduce((s, p) => s + (p.deal_count ?? 0), 0),
      resale_unit_price: resale,
      resale_deals: zb.reduce((s, b) => s + (b.deal_count ?? 0), 0),
    };
  }
  return NextResponse.json(geo);
}
