import { and, eq, gte, isNotNull, lte, type SQL } from "drizzle-orm";
import { db, buildings, building_community, communities, projects } from "@/lib/db";
import { ageBand, type AgeBand } from "@/lib/age";

// 統一點位:建案(presale_deals 彙總)與棟級(sale_deals 歸戶)合流成單一實體,
// 屋齡帶是屬性不是頻道。/api/points 與 /api/zones 共用,口徑才不會漂移。

export type UnifiedPoint = {
  kind: "presale" | "resale";     // 資料來源(預售彙總 vs 中古歸戶),非使用者面向的分類
  band: AgeBand;
  lat: number; lng: number;
  district: string;
  price: number | null;           // 扣車位中位單價(萬/坪)
  deal_count: number;
  name: string | null;            // 社區/建案名(2021 後備查案才有)
  addr_key: string | null;        // 棟級點才有,開抽屜用
  building_type: string | null;
  build_year: number | null;      // 棟級=完工年;建案=first_reg 年(完工交屋)
  median_total: number | null;    // 中位總價(萬)
  median_area: number | null;     // 中位坪數(建案才有)
};

type Bbox = [number, number, number, number];

export async function loadUnifiedPoints(opts: { bbox?: Bbox; district?: string } = {}): Promise<UnifiedPoint[]> {
  const { bbox, district } = opts;
  const box = (lat: any, lng: any): SQL | undefined =>
    bbox ? and(gte(lng, bbox[0]), lte(lng, bbox[2]), gte(lat, bbox[1]), lte(lat, bbox[3])) : undefined;

  const [bldgs, projs, comms, linked] = await Promise.all([
    db.select({
      addr_key: buildings.addr_key, district: buildings.district,
      lat: buildings.lat, lng: buildings.lng, deal_count: buildings.deal_count,
      median_unit_price: buildings.median_unit_price, median_total: buildings.median_total,
      building_type: buildings.building_type, build_year: buildings.build_year,
      community: communities.name,
    }).from(buildings)
      .leftJoin(building_community, eq(building_community.addr_key, buildings.addr_key))
      .leftJoin(communities, eq(communities.case_no, building_community.case_no))
      .where(and(isNotNull(buildings.lat),
                 district ? eq(buildings.district, district) : box(buildings.lat, buildings.lng)))
      .limit(bbox || district ? 8000 : 200000), // 視窗載入才需要護欄;全量給圈級聚合用不可截斷
    db.select().from(projects)
      .where(and(isNotNull(projects.lat),
                 district ? eq(projects.district, district) : box(projects.lat, projects.lng))),
    db.select({ case_no: communities.case_no, name: communities.name,
                district: communities.district, first_reg: communities.first_reg })
      .from(communities),
    db.selectDistinct({ case_no: building_community.case_no }).from(building_community),
  ]);

  const nowYear = new Date().getFullYear();
  const pts: UnifiedPoint[] = bldgs.map((b) => ({
    kind: "resale", band: ageBand(b.build_year, nowYear),
    lat: b.lat!, lng: b.lng!, district: b.district,
    price: b.median_unit_price, deal_count: b.deal_count ?? 0,
    name: b.community, addr_key: b.addr_key,
    building_type: b.building_type, build_year: b.build_year,
    median_total: b.median_total, median_area: null,
  }));

  // 建案 → 備查建案(name+district)接完工日:
  //   未備查/未完工 → 預售帶;已完工 → 依 first_reg 落帶;
  //   已完工且該案已有中古歸戶點位 → 略過(同社區避免雙點,棟級點已代表它)
  const commByKey = new Map<string, typeof comms>();
  for (const c of comms) {
    const k = `${c.district}|${c.name}`;
    (commByKey.get(k) ?? commByKey.set(k, []).get(k)!).push(c);
  }
  const linkedSet = new Set(linked.map((l) => l.case_no));

  for (const p of projs) {
    const matches = commByKey.get(`${p.district}|${p.name}`) ?? [];
    const m = matches.find((c) => c.first_reg != null) ?? matches[0];
    const regYear = m?.first_reg ? new Date(m.first_reg).getFullYear() : null;
    const completed = regYear != null && regYear <= nowYear;
    if (completed && matches.some((c) => linkedSet.has(c.case_no))) continue;
    pts.push({
      kind: "presale", band: completed ? ageBand(regYear, nowYear) : "presale",
      lat: p.lat!, lng: p.lng!, district: p.district,
      price: p.unit_price, deal_count: p.deal_count ?? 0,
      name: p.name, addr_key: null,
      building_type: null, build_year: completed ? regYear : null,
      median_total: p.median_total, median_area: p.median_area,
    });
  }
  return pts;
}

export function toFeatureCollection(pts: UnifiedPoint[]) {
  return {
    type: "FeatureCollection" as const,
    features: pts.map((p) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
      properties: {
        kind: p.kind, band: p.band, district: p.district,
        price: p.price != null ? +p.price.toFixed(1) : null,
        deal_count: p.deal_count,
        median_total: p.median_total != null ? +p.median_total.toFixed(0) : null,
        ...(p.median_area != null ? { median_area: +p.median_area.toFixed(1) } : {}),
        ...(p.name ? { name: p.name } : {}),
        ...(p.addr_key ? { addr_key: p.addr_key } : {}),
        ...(p.building_type ? { building_type: p.building_type } : {}),
        ...(p.build_year != null ? { build_year: p.build_year } : {}),
      },
    })),
  };
}
